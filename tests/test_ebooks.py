"""Ebook search: OAPEN (open-access books) and Internet Archive (books with a
CC / public-domain licence) searched side by side, results alternated, the
query kept free of search syntax, the language filter, one failing source,
the PDF looked up when a book is opened (with id checks), and the routes.
Version 2: Project Gutenberg, Open Library and Google Books, browsing shelves,
sort words, magazine categories and series, and Gutenberg text made into a PDF."""
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
        with mock.patch('urllib.request.urlopen', side_effect=sources(oapen, ARCHIVE)) as call, \
                mock.patch.object(server, 'EBOOK_DEFAULT', ('oapen', 'archive')):
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
        two = mock.patch.object(server, 'EBOOK_DEFAULT', ('oapen', 'archive'))
        with mock.patch('urllib.request.urlopen', side_effect=sources(oapen, urllib.error.URLError('down'))), two:
            out = server.ebook_search('budaya', lang='id')
        self.assertEqual([b['title'] for b in out['results']], ['Buku'], 'OAPEN ignores a language field: filtered here')
        self.assertEqual(out['errors'], ['Internet Archive tidak bisa dihubungi.'])
        with mock.patch('urllib.request.urlopen', side_effect=sources(urllib.error.URLError('x'), urllib.error.URLError('y'))), two:
            with self.assertRaises(RuntimeError):
                server.ebook_search('budaya')
        with self.assertRaises(ValueError):
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

    def test_archive_matches_titles_and_magazines_have_their_own_shelf(self):
        q = server.archive_title_query('after effect')
        self.assertIn('title:("after effect")^5', q)
        self.assertIn('(after OR afters) AND (effect OR effects)', q)
        books = [dict(title='Effect of rain after storms'), dict(title='Survey on the After Effects of Tsunami'), dict(title='Unrelated')]
        self.assertEqual([b['title'] for b in server.archive_rank(books, 'after effects')][0], 'Survey on the After Effects of Tsunami')
        asked = []
        def fake(url, what, **_):
            asked.append(url)
            return {'response': {'numFound': 0, 'docs': []}}
        with mock.patch.object(server, 'ebook_get', side_effect=fake):
            server.archive_books('radio', 1, None, magazines=True)
            server.archive_books('radio', 1, None)
        self.assertIn('collection%3Amagazine_rack', asked[0]); self.assertIn('description%3A', asked[1], 'falls back to the description')
        self.assertIn('NOT+collection%3Amagazine_rack', asked[2])

    def test_safe_search(self):
        # Campuses use the site: adult searches are refused, adult-looking results dropped,
        # look-alike words (Sussex, Essex, sexual health) are not touched.
        for q in ('playboy', 'majalah sexy', 'bokep'):
            with self.assertRaises(server.AdultSearch):
                server.ebook_search(q, source='magazine')
        for text in ('Sussex Archaeological Collections', 'Essex Review', 'Sexual health education', 'Popular Science'):
            self.assertFalse(server.adult(text), text)
        self.assertTrue(server.adult('Playboy June 1975'))
        docs = [{'identifier': 'ok1', 'title': 'Radio News'}, {'identifier': 'bad1', 'title': 'Erotic Tales Monthly'}]
        with mock.patch.object(server, 'ebook_get', return_value={'response': {'numFound': 2, 'docs': docs}}):
            books, _ = server.archive_books('radio', 1, None, magazines=True)
        self.assertEqual([b['id'] for b in books], ['ok1'])

    def test_routes(self):
        server.JOURNAL_CACHE.clear()
        self.assertEqual(self.get('/api/ebooks?q=a')[0], 400)
        with mock.patch.object(server, 'ebook_search', return_value={'results': [], 'more': False}) as search:
            self.assertEqual(self.get('/api/ebooks?q=sejarah+jawa&page=3&lang=id&src=weird')[0], 200)
        self.assertEqual(search.call_args, mock.call('sejarah jawa', 3, lang='id', source='all', sort='relevance', category=''))
        with mock.patch.object(server, 'ebook_search', return_value={'results': [], 'more': False}) as search:
            self.assertEqual(self.get('/api/ebooks?q=&src=magazine&sort=popular&cat=fotografi')[0], 200, 'an empty q browses')
        self.assertEqual(search.call_args, mock.call('', 1, lang=None, source='magazine', sort='popular', category='fotografi'))
        with mock.patch.object(server, 'ebook_pdf', return_value={'pdf': 'https://archive.org/download/a/a.pdf', 'size': 5}):
            status, body = self.get('/api/ebooks/pdf?src=archive&id=a')
        self.assertEqual((status, body['pdf'], body['maxBytes']), (200, 'https://archive.org/download/a/a.pdf', server.FETCH_MAX_BYTES))
        with mock.patch.object(server, 'ebook_pdf', return_value={'pdf': '', 'size': 0}):
            self.assertEqual(self.get('/api/ebooks/pdf?src=archive&id=a')[0], 404)
        self.assertEqual(self.get('/api/ebooks/pdf?src=archive&id=..%2Fx')[0], 400)


OPDS = """<feed><entry><id>https://www.gutenberg.org/ebooks/1342.opds</id><title>Pride and Prejudice</title>
<content type="text">Jane Austen</content></entry>
<entry><id>https://www.gutenberg.org/ebooks/62383.opds</id><title>A Biblia Sagrada &amp; mais</title>
<content type="text">49728 downloads</content></entry>
<entry><id>https://www.gutenberg.org/ebooks.opds/</id><title>No records found.</title></entry></feed>"""


class EbookV2Tests(unittest.TestCase):
    def setUp(self):
        server.JOURNAL_CACHE.clear()

    def test_sort_words_and_series(self):
        # Indonesian sort words are read as a sort; English ones are part of a title.
        self.assertEqual(server.read_intent('majalah populer fotografi', 'relevance'), ('fotografi', 'popular'))
        self.assertEqual(server.read_intent('buku sejarah terbaru', 'relevance')[1], 'newest')
        self.assertEqual(server.read_intent('popular science', 'relevance'), ('popular science', 'relevance'))
        self.assertEqual(server.series_name('The Popular Magazine v078 n04 [1925]'), 'The Popular Magazine')
        self.assertEqual(server.series_name('Popular Science Monthly Volume 77'), 'Popular Science Monthly')
        self.assertEqual(server.series_name('Byte_1983_June'), 'Byte')

    def test_gutenberg_from_its_catalogue_feed(self):
        with mock.patch.object(server, 'ebook_get', return_value=OPDS) as get:
            books, more = server.gutenberg_books('pride', 2, 'en')
        url = get.call_args.args[0]
        self.assertTrue(url.startswith('https://www.gutenberg.org/ebooks/search.opds/?'))
        self.assertEqual(parse_qs(urlsplit(url).query), {'query': ['pride l.en'], 'start_index': ['26']})
        self.assertEqual([(b['id'], b['title'], b['authors']) for b in books],
                         [('1342', 'Pride and Prejudice', ['Jane Austen']), ('62383', 'A Biblia Sagrada & mais', [])], 'a count is not an author')
        self.assertEqual(books[0]['cover'], 'https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg')
        self.assertFalse(more)
        with mock.patch.object(server, 'ebook_get', return_value=OPDS) as get:
            server.gutenberg_books('', 1, None)
        self.assertEqual(parse_qs(urlsplit(get.call_args.args[0]).query)['sort_order'], ['downloads'], 'browsing: the most read')
        self.assertEqual(server.ebook_pdf('gutenberg', '1342')['pdf'], '/api/ebooks/file?src=gutenberg&id=1342')
        with self.assertRaises(LookupError):
            server.ebook_pdf('google', 'abcdef123')

    def test_gutenberg_text_becomes_a_pdf(self):
        text = ('The Project Gutenberg eBook\nTitle: Kisah Uji\nAuthor: Penulis Contoh\n\n'
                '*** START OF THE PROJECT GUTENBERG EBOOK KISAH UJI ***\n\nCHAPTER I\n\n'
                + 'Sebuah kalimat yang cukup panjang untuk dibungkus ke beberapa baris. ' * 300
                + '\n\n[Illustration: gambar]\n\n*** END OF THE PROJECT GUTENBERG EBOOK KISAH UJI ***\nLicence text')
        server.GUTENBERG_PDF_CACHE.clear()
        with mock.patch.object(server, 'fetch_source', return_value=(text.encode(), 'pg1.txt', 'text/plain')) as fetch:
            pdf, name = server.gutenberg_pdf('77')
        self.assertEqual(fetch.call_args.args[0], 'https://www.gutenberg.org/cache/epub/77/pg77.txt')
        self.assertTrue(pdf.startswith(b'%PDF-')); self.assertEqual(name, 'Kisah_Uji.pdf')
        self.assertGreater(pdf.count(b'/Type /Page '), 3)
        self.assertNotIn(b'Licence text', pdf); self.assertNotIn(b'Illustration', pdf)
        with self.assertRaises(ValueError):
            server.gutenberg_pdf('../x')

    def test_browse_and_sources(self):
        called = []
        def source(name):
            def run(terms, page, lang, sort, category):
                called.append((name, terms, sort, category))
                return [dict(source=name, id=name, title=name.title(), authors=[], downloads=len(name))], False
            return run
        fakes = {k: source(k) for k in server.EBOOK_SOURCES}
        with mock.patch.dict(server.EBOOK_SOURCES, fakes), mock.patch.object(server, 'JOURNAL_CACHE', {}),                 mock.patch.object(server, 'archive_magazines', source('magazine')), \
                mock.patch.object(server, 'gutenberg_books', fakes['gutenberg']):
            out = server.ebook_search('', source='all')
            self.assertTrue(out['browse']); self.assertEqual([c[0] for c in called], ['gutenberg'], 'book shelf: Gutenberg only')
            called.clear()
            out = server.ebook_search('', source='magazine', category='fotografi')
            self.assertEqual(called, [('magazine', '', 'relevance', 'fotografi')]); self.assertIn('fotografi', out['categories'])
            called.clear()
            server.ebook_search('sejarah jawa', source='all')
            self.assertEqual(sorted(c[0] for c in called), sorted(server.EBOOK_DEFAULT), 'every default source (they run side by side: any order)')
            self.assertNotIn('magazine', [c[0] for c in called], 'books never mix with magazines')

    def test_google_books_fields(self):
        data = {'totalItems': 1, 'items': [{'id': 'abcDEF12', 'volumeInfo': {'title': 'Emma', 'authors': ['Jane Austen'], 'publishedDate': '1816'},
                                            'accessInfo': {'webReaderLink': 'http://play.google.com/books/reader?id=abcDEF12',
                                                           'pdf': {'isAvailable': True, 'downloadLink': 'http://books.google.com/books/download/x.pdf'}}},
                                           {'id': 'bad id!', 'volumeInfo': {'title': 'Skipped'}}]}
        with mock.patch.dict('os.environ', {'GOOGLE_BOOKS_API_KEY': 'k'}), mock.patch.object(server, 'ebook_get', return_value=data):
            books, more = server.google_books('emma', 1, 'en')
        self.assertEqual(len(books), 1); self.assertFalse(more)
        self.assertEqual((books[0]['readOnline'], books[0]['browserPdf']),
                         ('https://play.google.com/books/reader?id=abcDEF12', 'https://books.google.com/books/download/x.pdf'))
        with mock.patch.dict('os.environ', {'GOOGLE_BOOKS_API_KEY': ''}):
            self.assertEqual(server.google_books('emma', 1, 'en'), ([], False), 'no key: skipped quietly')


if __name__ == '__main__':
    unittest.main()
