"""Semantic Scholar beside OpenAlex: one shared request slot (1 request/second key),
a retry on a stray 429 and a pause after several, results merged without repeats
(OpenAlex's entry gets S2's PDF link), filters S2 cannot honour leave it out, and
an S2 result's PDF is found through its DOI."""
import json
from pathlib import Path
import sys
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

PAPER = {'paperId': 'a' * 40, 'title': 'Pendidikan  Karakter di Sekolah', 'year': 2025, 'venue': 'Jurnal Didaktika',
         'citationCount': 18, 'isOpenAccess': True, 'externalIds': {'DOI': '10.1234/abc.5'},
         'openAccessPdf': {'url': 'https://jurnal.example.id/article/download/1/2', 'license': 'CCBYSA'},
         'authors': [{'name': 'Sari'}, {'name': 'Budi'}]}


def reply(data):
    response = mock.MagicMock()
    response.read.return_value = json.dumps(data).encode()
    response.__enter__.return_value = response
    return response


def refused():
    return urllib.error.HTTPError('https://api.semanticscholar.org', 429, 'Too Many Requests', {}, None)


class SemanticScholarTests(unittest.TestCase):
    def setUp(self):
        server.S2_CACHE.clear()
        server.JOURNAL_CACHE.clear()
        server.S2_STATE.update(last=0.0, pause_until=0.0, refused=0)
        self.env = mock.patch.dict('os.environ', {'SEMANTIC_SCHOLAR_API_KEY': 'k' * 40})
        self.env.start()
        self.fast = mock.patch.object(server, 'S2_GAP', 0.0)
        self.fast.start()

    def tearDown(self):
        self.env.stop()
        self.fast.stop()

    def test_search_fields_and_licence(self):
        with mock.patch('urllib.request.urlopen', return_value=reply({'total': 1, 'data': [PAPER, {'paperId': 'bad', 'title': 'x'}]})) as call:
            out = server.s2_search('pendidikan karakter', page=2, year_from=2020)
        request = call.call_args.args[0]
        self.assertEqual(request.get_header('X-api-key'), 'k' * 40)
        self.assertIn('offset=20', request.full_url); self.assertIn('openAccessPdf=', request.full_url); self.assertIn('year=2020-', request.full_url)
        a, = out['results']
        self.assertEqual((a['id'], a['title'], a['doi'], a['license'], a['cited'], a['source'], a['abstract']),
                         ('S2' + 'a' * 40, 'Pendidikan Karakter di Sekolah', 'https://doi.org/10.1234/abc.5', 'cc-by-sa', 18, 's2', ''))
        self.assertEqual(server.s2_licence('CCBYNCND'), 'cc-by-nc-nd')
        with mock.patch('urllib.request.urlopen') as call:
            server.s2_search('pendidikan karakter', page=2, year_from=2020)
        call.assert_not_called()                                    # cached for the day

    def test_stray_429_is_retried_and_many_pause(self):
        with mock.patch('urllib.request.urlopen', side_effect=[refused(), reply({'total': 0, 'data': []})]) as call:
            server.s2_search('wayang')
        self.assertEqual(call.call_count, 2); self.assertEqual(server.S2_STATE['refused'], 0)
        with mock.patch('urllib.request.urlopen', side_effect=[refused(), refused(), refused()]):
            with self.assertRaises(RuntimeError):
                server.s2_search('batik')
            with self.assertRaises(RuntimeError):
                server.s2_search('gamelan')
        self.assertGreater(server.S2_STATE['pause_until'], 0, 'three refusals in a row: Semantic Scholar rests')
        with mock.patch('urllib.request.urlopen') as call:
            with self.assertRaises(RuntimeError):
                server.s2_search('keris')
        call.assert_not_called()

    def test_slot_spacing(self):
        with mock.patch.object(server, 'S2_GAP', 5.0):
            self.assertTrue(server.s2_slot(wait=0))
            self.assertFalse(server.s2_slot(wait=0.1), 'the next request waits for the gap, or gives up')

    def test_merge_without_repeats(self):
        openalex = dict(total=50, page=1, results=[
            dict(id='W1', title='Pendidikan Karakter di Sekolah', doi='https://doi.org/10.1234/ABC.5', pdf='', oa=False, source='openalex'),
            dict(id='W2', title='Lain', doi='', pdf='https://x/2.pdf', oa=True, source='openalex')])
        s2 = dict(total=80, results=[dict(id='S2' + 'a' * 40, title='Pendidikan Karakter di Sekolah', doi='https://doi.org/10.1234/abc.5',
                                          pdf='https://jurnal.example.id/a.pdf', oa=True, source='s2'),
                                     dict(id='S2' + 'b' * 40, title='Baru', doi='', pdf='', oa=True, source='s2')])
        with mock.patch.object(server, 'openalex_search', return_value=openalex), mock.patch.object(server, 's2_search', return_value=s2):
            out = server.journal_search('pendidikan karakter')
            self.assertEqual([a['id'] for a in out['results']], ['W1', 'S2' + 'b' * 40, 'W2'])
            self.assertEqual(out['results'][0]['pdf'], 'https://jurnal.example.id/a.pdf', "OpenAlex's entry gets S2's PDF")
            self.assertEqual(out['total'], 80)
        with mock.patch.object(server, 'openalex_search', return_value=openalex), mock.patch.object(server, 's2_search') as s2_call:
            server.journal_search('pendidikan karakter', lang='id')
            server.journal_search('pendidikan karakter', indonesia=True)
            server.journal_search('pendidikan karakter', sort='cited')
        s2_call.assert_not_called()
        with mock.patch.object(server, 'openalex_search', side_effect=RuntimeError('down')), mock.patch.object(server, 's2_search', return_value=s2):
            self.assertEqual(len(server.journal_search('pendidikan karakter')['results']), 2, 'OpenAlex down: S2 alone')

    def test_pdf_of_an_s2_result_through_its_doi(self):
        asked = []
        def fake(url, what, **_):
            asked.append(url)
            return {}
        with mock.patch.object(server, 'ebook_get', side_effect=fake):
            server.journal_candidates('S2' + 'a' * 40, 'https://x/a.pdf', '10.1234/abc.5')
        self.assertTrue(asked[0].startswith('https://api.openalex.org/works/doi:10.1234/abc.5?'))
        self.assertIn('api.unpaywall.org/v2/10.1234', asked[1])
        with self.assertRaises(ValueError):
            server.journal_pdf('S2xyz', '', '')
        server.JOURNAL_PDF_CACHE.clear()
        with mock.patch.object(server, 'journal_candidates', return_value=[]) as candidates:
            server.journal_pdf('S2' + 'c' * 40, '', 'https://doi.org/10.1234/abc.5')
        self.assertEqual(candidates.call_args.args, ('S2' + 'c' * 40, '', '10.1234/abc.5'))


if __name__ == '__main__':
    unittest.main()
