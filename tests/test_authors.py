"""Author profiles (Publish or Perish style, OpenAlex data): the citation metrics as PoP defines
them, author search, a profile (works paged, most cited first), and the routes."""
from pathlib import Path
import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def works(cites, year=2020, authors=1):
    return [{'cited': c, 'year': year, 'nAuthors': authors} for c in cites]


class MetricTests(unittest.TestCase):
    def test_h_g_i10(self):
        m = server.citation_metrics(works([25, 18, 12, 9, 5, 3, 1, 0]), 2026)
        self.assertEqual((m['papers'], m['citations']), (8, 73))
        self.assertEqual(m['h'], 5, '5 papers with 5+ citations')
        self.assertEqual(m['g'], 8, 'top 8 have 73 >= 64 citations')
        self.assertEqual(m['i10'], 3)
        self.assertEqual(m['years'], 7); self.assertEqual(m['citesPerYear'], round(73 / 7, 2))
        self.assertEqual(m['citesPerPaper'], round(73 / 8, 2))

    def test_g_is_bounded_and_h_edge_cases(self):
        self.assertEqual(server.citation_metrics(works([100]), 2026)['g'], 1)
        self.assertEqual(server.citation_metrics([], 2026)['h'], 0)
        self.assertEqual(server.h_of([3, 3, 3]), 3)
        self.assertEqual(server.h_of([10, 0, 0]), 1)

    def test_shared_authorship_and_age(self):
        ws = [{'cited': 40, 'year': 2016, 'nAuthors': 4}, {'cited': 20, 'year': 2024, 'nAuthors': 2}, {'cited': 6, 'year': 2025, 'nAuthors': 1}]
        m = server.citation_metrics(ws, 2026)
        self.assertEqual(m['hINorm'], 3, '10, 10, 6 citations per author')
        self.assertEqual(m['h'], 3)
        self.assertEqual(m['citesPerAuthor'], 26.0); self.assertEqual(m['papersPerAuthor'], round(0.25 + 0.5 + 1, 2))
        self.assertEqual(m['awcr'], round(40 / 11 + 20 / 3 + 6 / 2, 2))
        self.assertEqual(m['authorsPerPaper'], round(7 / 3, 2))
        self.assertEqual(m['hIAnnual'], round(3 / 11, 2))


AUTHOR = {'id': 'https://openalex.org/A42', 'display_name': 'Sri Hastanto', 'works_count': 3, 'cited_by_count': 66,
          'summary_stats': {'h_index': 3, 'i10_index': 2}, 'last_known_institutions': [{'display_name': 'ISI Surakarta', 'country_code': 'ID'}],
          'orcid': 'https://orcid.org/0000-0001-2345-6789', 'counts_by_year': [{'year': 2024, 'works_count': 1, 'cited_by_count': 20}, {'year': 2016, 'works_count': 1, 'cited_by_count': 5}]}


def work(i, cites, year):
    return {'id': f'https://openalex.org/W{i}', 'display_name': f'Karya {i}', 'publication_year': year, 'doi': f'https://doi.org/10.1/{i}',
            'cited_by_count': cites, 'authorships': [{'author': {'display_name': 'Sri Hastanto'}}, {'author': {'display_name': 'B Dua'}}],
            'primary_location': {'source': {'display_name': 'Jurnal Seni'}}, 'biblio': {'volume': '5', 'issue': '2', 'first_page': '10', 'last_page': '25'}}


class ProfileTests(unittest.TestCase):
    def test_search_needs_a_name(self):
        with self.assertRaises(ValueError):
            server.author_search(' ab ')

    def test_search(self):
        with mock.patch.object(server, 'openalex_get', return_value={'results': [AUTHOR]}) as get:
            out = server.author_search('  sri   hastanto ')
        self.assertEqual(get.call_args[0][1]['search'], 'sri hastanto')
        self.assertEqual(out[0], dict(id='A42', name='Sri Hastanto', works=3, cited=66, h=3, i10=2, institution='ISI Surakarta', country='ID', orcid='0000-0001-2345-6789'))

    def test_profile(self):
        pages = {1: {'meta': {'count': 3}, 'results': [work(1, 40, 2016), work(2, 20, 2024), work(3, 6, 2025)]}}

        def get(path, params):
            return AUTHOR if path == 'authors/A42' else pages[params['page']]
        with mock.patch.object(server, 'openalex_get', side_effect=get) as calls:
            p = server.author_profile('A42')
        self.assertEqual(calls.call_count, 2, 'one page of works was enough')
        works_call = calls.call_args_list[1][0][1]
        self.assertEqual((works_call['filter'], works_call['sort']), ('author.id:A42', 'cited_by_count:desc'))
        self.assertTrue(p['complete']); self.assertEqual(p['total'], 3)
        self.assertEqual(p['metrics']['h'], 3); self.assertEqual(p['metrics']['hINorm'], 3)   # 20, 10, 3 per author
        self.assertEqual([w['nAuthors'] for w in p['works']], [2, 2, 2])
        self.assertEqual(p['works'][0]['pages'], '10-25'); self.assertEqual(p['works'][0]['volume'], '5')
        self.assertNotIn('abstract', p['works'][0])
        self.assertEqual([y['year'] for y in p['byYear']], [2016, 2024])
        with self.assertRaises(ValueError):
            server.author_profile('W1')

    def test_routes(self):
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        base = f'http://127.0.0.1:{httpd.server_port}'

        def get(path):
            try:
                with urllib.request.urlopen(base + path) as r:
                    return r.status, json.loads(r.read())
            except urllib.error.HTTPError as e:
                with e:
                    return e.code, json.loads(e.read())
        try:
            with mock.patch.object(server, 'author_search', return_value=[{'id': 'A1'}]):
                self.assertEqual(get('/api/authors?q=harzing'), (200, {'authors': [{'id': 'A1'}]}))
            self.assertEqual(get('/api/authors?q=ab')[0], 400)
            self.assertEqual(get('/api/authors/profile?id=nope')[0], 400)
            with mock.patch.object(server, 'author_profile', side_effect=RuntimeError('OpenAlex tidak bisa dihubungi.')):
                self.assertEqual(get('/api/authors/profile?id=A1')[0], 502)
            with urllib.request.urlopen(base + '/authors.html') as r:
                self.assertEqual(r.status, 200); self.assertIn('Profil Penulis', r.read().decode('utf-8'))
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
