"""Ebook search: OAPEN (open-access books) and Internet Archive (books with a
CC / public-domain licence) searched side by side, results alternated, the
query kept free of search syntax, the language filter, one failing source,
the PDF looked up when a book is opened (with id checks), and the routes."""
import json
from pathlib import Path
import sys
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def reply(data):
    response = mock.MagicMock()
    response.read.return_value = json.dumps(data).encode()
    response.__enter__.return_value = response
    return response


def oapen_item(handle, title, language='English'):
    meta = {'dc.title': title, 'dc.language': language, 'dc.date.issued': '2019-05', 'publisher.name': 'Open Book Publishers',
            'dc.description.abstract': '" Ports of Indonesia "', 'oapen.pages': '396'}
    fields = [{'key': k, 'value': v} for k, v in meta.items()] + [{'key': 'dc.contributor.editor', 'value': 'Duffield, Colin'}]
    return {'handle': handle, 'metadata': fields}


ARCHIVE = {'response': {'numFound': 25, 'docs': [
    {'identifier': 'KitabPararaton', 'title': 'Kitab  Pararaton', 'creator': 'Anonim', 'year': '1481', 'language': ['ind', 'Indonesian'],
     'licenseurl': 'https://creativecommons.org/publicdomain/mark/1.0/', 'description': '<p>Kronik <b>Jawa</b></p>'},
    {'identifier': 'bad id/../x', 'title': 'Skipped'},
]}}


def sources(oapen, archive):
    """urlopen stand-in answering by host."""
    def answer(request, timeout=None):
        url = request.full_url
        if 'oapen' in url:
            if isinstance(oapen, Exception):
                raise oapen
            return reply(oapen)
        if isinstance(archive, Exception):
            raise archive
        return reply(archive)
    return answer


class EbookTests(unittest.TestCase):
    def setUp(self):
        server.JOURNAL_CACHE.clear()

    def test_both_sources_alternate(self):
        oapen = [oapen_item('20.500.12657/23656', 'Infrastructure Investment in Indonesia'), oapen_item('20.500.12657/1', 'Second'),
                 {'handle': 'evil/1', 'metadata': [{'key': 'dc.title', 'value': 'Bad handle'}]}]
        with mock.patch('urllib.request.urlopen', side_effect=sources(oapen, ARCHIVE)) as call:
            out = server.ebook_search('sejarah "jawa" OR title:(x)', page=2)
        urls = [c.args[0].full_url for c in call.call_args_list]
        oapen_q = parse_qs(urlsplit(next(u for u in urls if 'oapen' in u)).query)
        self.assertEqual(oapen_q['query'][0], 'sejarah jawa OR title x AND dc.type:book', 'no quotes/fields/brackets from the user')
        self.assertEqual((oapen_q['expand'][0], oapen_q['offset'][0]), ('metadata', '10'), 'no file listing in the search (slow)')
        ia_q = parse_qs(urlsplit(next(u for u in urls if 'archive' in u)).query)
        self.assertIn('licenseurl:*', ia_q['q'][0]); self.assertIn('NOT access-restricted-item:true', ia_q['q'][0])
        self.assertEqual(ia_q['page'][0], '2')
        self.assertEqual([b['title'] for b in out['results']], ['Infrastructure Investment in Indonesia', 'Kitab Pararaton', 'Second'])
        first, ia = out['results'][0], out['results'][1]
        self.assertEqual((first['source'], first['id'], first['year'], first['language'], first['pages']), ('oapen', '20.500.12657/23656', '2019', 'en', '396'))
        self.assertEqual((first['authors'], first['abstract'], first['licenseByUploader']), (['Duffield, Colin'], 'Ports of Indonesia', False))
        self.assertEqual((ia['source'], ia['id'], ia['language'], ia['abstract'], ia['licenseByUploader']), ('archive', 'KitabPararaton', 'id', 'Kronik Jawa', True))
        self.assertEqual(ia['cover'], 'https://archive.org/services/img/KitabPararaton')
        self.assertTrue(out['more'], '25 found, page 2 of 10')
        self.assertEqual(out['errors'], [])

    def test_language_filter_and_one_source_down(self):
        oapen = [oapen_item('20.500.12657/2', 'Buku', 'Indonesian'), oapen_item('20.500.12657/3', 'Boek', 'Dutch')]
        with mock.patch('urllib.request.urlopen', side_effect=sources(oapen, urllib.error.URLError('down'))):
            out = server.ebook_search('budaya', lang='id')
        self.assertEqual([b['title'] for b in out['results']], ['Buku'], 'OAPEN ignores a language field: filtered here')
        self.assertEqual(out['errors'], ['Internet Archive tidak bisa dihubungi.'])
        with mock.patch('urllib.request.urlopen', side_effect=sources(urllib.error.URLError('x'), urllib.error.URLError('y'))):
            with self.assertRaises(RuntimeError):
                server.ebook_search('budaya')
        with self.assertRaises(RuntimeError):
            server.ebook_search('"!"')

    def test_pdf_lookup(self):
        streams = {'bitstreams': [{'mimeType': 'image/jpeg', 'bundleName': 'THUMBNAIL', 'retrieveLink': '/rest/bitstreams/t/retrieve'},
                                  {'mimeType': 'application/pdf', 'bundleName': 'ORIGINAL', 'retrieveLink': '/rest/bitstreams/p/retrieve', 'sizeBytes': 37183089}]}
        with mock.patch('urllib.request.urlopen', return_value=reply(streams)) as call:
            self.assertEqual(server.ebook_pdf('oapen', '20.500.12657/23656'),
                             {'pdf': 'https://library.oapen.org/rest/bitstreams/p/retrieve', 'size': 37183089})
        self.assertEqual(call.call_args[0][0].full_url, 'https://library.oapen.org/rest/handle/20.500.12657/23656?expand=bitstreams')
        files = {'result': [{'name': 'x_text.pdf', 'format': 'Additional Text PDF', 'size': '9'},
                            {'name': 'Kitab Pararaton.pdf', 'format': 'Text PDF', 'source': 'original', 'size': '828010'},
                            {'name': 'x.epub', 'format': 'EPUB'}]}
        with mock.patch('urllib.request.urlopen', return_value=reply(files)):
            self.assertEqual(server.ebook_pdf('archive', 'KitabPararaton'),
                             {'pdf': 'https://archive.org/download/KitabPararaton/Kitab%20Pararaton.pdf', 'size': 828010})
        with mock.patch('urllib.request.urlopen', return_value=reply({'result': [{'name': 'a.epub'}]})):
            self.assertEqual(server.ebook_pdf('archive', 'no-pdf')['pdf'], '')
        for source, ident in (('archive', '../etc'), ('archive', 'a/b'), ('oapen', '20.500.12657/1/../x'), ('drive', 'x')):
            with self.assertRaises(ValueError):
                server.ebook_pdf(source, ident)


class EbookRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True); cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.httpd.server_port}'
        cls.open = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.httpd.server_close(); cls.thread.join()

    def get(self, path):
        try:
            with self.open.open(self.base + path) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            with e:
                return e.code, json.loads(e.read())

    def test_routes(self):
        server.JOURNAL_CACHE.clear()
        self.assertEqual(self.get('/api/ebooks?q=a')[0], 400)
        with mock.patch.object(server, 'ebook_search', return_value={'results': [], 'more': False}) as search:
            self.assertEqual(self.get('/api/ebooks?q=sejarah+jawa&page=3&lang=id&src=weird')[0], 200)
        self.assertEqual(search.call_args, mock.call('sejarah jawa', 3, lang='id', source='all'))
        with mock.patch.object(server, 'ebook_pdf', return_value={'pdf': 'https://archive.org/download/a/a.pdf', 'size': 5}):
            status, body = self.get('/api/ebooks/pdf?src=archive&id=a')
        self.assertEqual((status, body['pdf'], body['maxBytes']), (200, 'https://archive.org/download/a/a.pdf', server.FETCH_MAX_BYTES))
        with mock.patch.object(server, 'ebook_pdf', return_value={'pdf': '', 'size': 0}):
            self.assertEqual(self.get('/api/ebooks/pdf?src=archive&id=a')[0], 404)
        self.assertEqual(self.get('/api/ebooks/pdf?src=archive&id=..%2Fx')[0], 400)


if __name__ == '__main__':
    unittest.main()
