"""Journal search (OpenAlex): the request (title+abstract search, filters,
sort, key), results mapped to articles with links, abstracts rebuilt,
caching, rate-limit message, and the /api/journals route."""
import json
import os
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

WORK = {
    'id': 'https://openalex.org/W123', 'display_name': '  Filsafat   Jawa dalam Novel ', 'publication_year': 2018,
    'doi': 'https://doi.org/10.1/abc', 'cited_by_count': 4, 'language': 'id',
    'authorships': [{'author': {'display_name': f'Penulis {n}'}} for n in range(10)] + [{'author': {'display_name': 'Penulis 0'}}],   # a repeat
    'primary_location': {'landing_page_url': 'https://jurnal.example/article/1', 'source': {'display_name': 'BAHAS', 'host_organization_name': 'UNIMED'}},
    'best_oa_location': {'pdf_url': 'https://jurnal.example/download/1.pdf', 'landing_page_url': 'https://jurnal.example/article/1', 'license': 'cc-by'},
    'open_access': {'is_oa': True},
    'abstract_inverted_index': {'Filsafat': [0], 'Jawa': [1], 'mengajarkan': [2], 'harmoni.': [3]},
}


def reply(data):
    response = mock.MagicMock()
    response.read.return_value = json.dumps(data).encode()
    response.__enter__.return_value = response
    return response


class JournalTests(unittest.TestCase):
    def setUp(self):
        server.JOURNAL_CACHE.clear()

    def test_request_and_mapping(self):
        with mock.patch.dict(os.environ, {'OPENALEX_API_KEY': 'k1', 'OPENALEX_MAILTO': ''}), \
             mock.patch('urllib.request.urlopen', return_value=reply({'meta': {'count': 173}, 'results': [WORK, dict(WORK, best_oa_location=None, open_access={'is_oa': False}, abstract_inverted_index=None)]})) as call:
            out = server.journal_search('filsafat, jawa', page=2, oa=True, year_from=2010, year_to=2024, lang='id', indonesia=True, sort='cited')
        query = parse_qs(urlsplit(call.call_args[0][0].full_url).query)
        filters = query['filter'][0].split(',')
        self.assertIn('is_oa:true', filters); self.assertIn('publication_year:2010-2024', filters)
        self.assertIn('language:id', filters); self.assertIn('institutions.country_code:id', filters)
        self.assertIn('title_and_abstract.search.exact:filsafat  jawa', filters, 'exact words in title + abstract; commas would split the filter')
        self.assertEqual((query['sort'][0], query['page'][0], query['api_key'][0]), ('cited_by_count:desc', '2', 'k1'))
        self.assertNotIn('mailto', query)
        self.assertEqual(out['total'], 173)
        first, closed = out['results']
        self.assertEqual(first['title'], 'Filsafat Jawa dalam Novel')
        self.assertEqual((len(first['authors']), first['moreAuthors']), (8, 2))
        self.assertEqual((first['journal'], first['publisher'], first['year'], first['license']), ('BAHAS', 'UNIMED', 2018, 'cc-by'))
        self.assertEqual(first['pdf'], 'https://jurnal.example/download/1.pdf')
        self.assertEqual(first['abstract'], 'Filsafat Jawa mengajarkan harmoni.')
        self.assertEqual((closed['pdf'], closed['oa'], closed['abstract']), ('', False, ''))
        self.assertEqual(closed['link'], 'https://jurnal.example/article/1', 'falls back to the publisher page')

    def test_cache_and_rate_limit(self):
        with mock.patch('urllib.request.urlopen', return_value=reply({'meta': {'count': 1}, 'results': [WORK]})) as call:
            server.journal_search('padi'); server.journal_search('padi')
        self.assertEqual(call.call_count, 1, 'the same search is served from the cache')
        error = urllib.error.HTTPError('u', 429, 'Too Many', {}, None)
        with mock.patch('urllib.request.urlopen', side_effect=error):
            with self.assertRaisesRegex(RuntimeError, 'Batas pencarian'):
                server.journal_search('jagung')

    def test_abstract_is_cut_on_a_word(self):
        index = {f'kata{n}': [n] for n in range(400)}
        text = server.abstract_text(index, limit=50)
        self.assertTrue(text.endswith('…')); self.assertLessEqual(len(text), 51)

    def test_pdf_links_on_an_article_page(self):
        html = ('<meta name="citation_pdf_url" content="https://j.example/index.php/jp/article/view/12/34">'
                '<a href="/index.php/jp/article/view/12/35">PDF</a>')
        links = server.pdf_links_in(html, 'https://j.example/index.php/jp/article/view/12')
        self.assertIn('https://j.example/index.php/jp/article/download/12/34', links, 'OJS viewer page -> download')
        self.assertIn('https://j.example/index.php/jp/article/download/12/35', links)
        self.assertLessEqual(len(links), 6)

    def test_journal_pdf_follows_the_page_to_the_real_pdf(self):
        server.JOURNAL_PDF_CACHE.clear()
        page = '<meta content="https://j.example/article/view/1/2" name="citation_pdf_url">'
        probes = {'https://doi.org/10.1/abc': (False, 0, page, 'https://j.example/article/view/1'),
                  'https://j.example/article/download/1/2': (True, 4096, '', 'https://j.example/article/download/1/2')}
        with mock.patch.object(server, 'journal_candidates', return_value=['https://doi.org/10.1/abc']),                 mock.patch.object(server, 'probe_pdf', side_effect=lambda u: probes.get(u, (False, 0, '', u))):
            self.assertEqual(server.journal_pdf('W123'), {'pdf': 'https://j.example/article/download/1/2', 'size': 4096})
        with self.assertRaises(ValueError):
            server.journal_pdf('../etc')
        server.JOURNAL_PDF_CACHE.clear()
        with mock.patch.object(server, 'journal_candidates', return_value=['https://x.example/page']),                 mock.patch.object(server, 'probe_pdf', return_value=(False, 0, '', 'https://x.example/page')):
            self.assertEqual(server.journal_pdf('W9'), {'pdf': '', 'size': 0}, 'a web page is never handed over as the PDF')

    def test_route(self):
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        base = f'http://127.0.0.1:{httpd.server_port}/api/journals'
        def get(query):
            try:
                with urllib.request.urlopen(base + query) as response:
                    return response.status, json.loads(response.read())
            except urllib.error.HTTPError as error:
                with error:
                    return error.code, json.loads(error.read())
        try:
            with mock.patch.object(server, 'journal_search', return_value={'total': 0, 'page': 1, 'results': []}) as search:
                self.assertEqual(get('?q=a')[0], 400, 'too short')
                self.assertEqual(get('?q=filsafat%20jawa&page=99&oa=0&from=2015&to=abc&id=1&lang=id&sort=bogus')[0], 200)
                args, kwargs = search.call_args
                self.assertEqual(args, ('filsafat jawa', 50))
                self.assertEqual(kwargs, dict(oa=False, year_from=2015, year_to=None, lang='id', indonesia=True, sort='relevance'))
            with mock.patch.object(server, 'journal_search', side_effect=RuntimeError('Batas pencarian harian tercapai.')):
                status, body = get('?q=padi')
                self.assertEqual(status, 502); self.assertIn('Batas', body['error'])
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
