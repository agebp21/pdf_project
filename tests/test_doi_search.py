"""Journal search by DOI: DOIs (bare, doi:…, doi.org links, several) found in the query, each
looked up in OpenAlex, Crossref when OpenAlex doesn't know it, missing ones reported; an
article known only by its DOI still gets its open-access PDF looked up."""
from pathlib import Path
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

WORK = {'id': 'https://openalex.org/W123', 'display_name': 'Sharing  Research Data', 'publication_year': 2007,
        'doi': 'https://doi.org/10.1371/journal.pone.0000308', 'cited_by_count': 900, 'language': 'en',
        'authorships': [{'author': {'display_name': 'H. Piwowar'}}], 'primary_location': {'source': {'display_name': 'PLoS ONE'}},
        'best_oa_location': {'pdf_url': 'https://journals.plos.org/x.pdf', 'license': 'cc-by'}, 'open_access': {'is_oa': True}}
CROSSREF = {'message': {'title': ['Gamelan dan Laras'], 'author': [{'given': 'Sri', 'family': 'Hastanto'}], 'container-title': ['Jurnal Seni'],
                        'publisher': 'ISI', 'issued': {'date-parts': [[2019, 3]]}, 'abstract': '<jats:p>Tentang laras.</jats:p>'}}


def fake_get(url, what, **_):
    if 'openalex.org/works/doi:10.1371' in url:
        return WORK
    if 'openalex.org' in url:
        raise RuntimeError('OpenAlex menolak permintaan (404).')
    if 'crossref.org/works/10.5555/gamelan' in url:
        return CROSSREF
    raise RuntimeError('Crossref menolak permintaan (404).')


class DoiTests(unittest.TestCase):
    def setUp(self):
        server.JOURNAL_CACHE.clear(); server.JOURNAL_PDF_CACHE.clear()

    def test_dois_in_a_query(self):
        q = 'https://doi.org/10.1371/journal.pone.0000308, doi:10.5555/gamelan.\n10.1371/journal.pone.0000308 (lagi)'
        self.assertEqual(server.query_dois(q), ['10.1371/journal.pone.0000308', '10.5555/gamelan'])
        self.assertEqual(server.query_dois('filsafat Jawa 2020'), [])
        self.assertEqual(len(server.query_dois(' '.join(f'10.1000/{i}' for i in range(30)))), server.DOI_MAX)

    def test_lookup_openalex_then_crossref(self):
        with mock.patch.object(server, 'ebook_get', side_effect=fake_get):
            out = server.journal_search('10.1371/journal.pone.0000308 10.5555/gamelan 10.9999/none', page=1, oa=True, lang='id')
        self.assertEqual((out['total'], out['dois'], out['missing']), (2, 3, ['10.9999/none']))
        first, second = out['results']
        self.assertEqual((first['id'], first['source'], first['title'], first['oa']), ('W123', 'openalex', 'Sharing Research Data', True))
        self.assertEqual((second['id'], second['source'], second['authors'], second['year'], second['journal']), ('', 'crossref', ['Sri Hastanto'], 2019, 'Jurnal Seni'))
        self.assertEqual(second['doi'], 'https://doi.org/10.5555/gamelan'); self.assertIn('Tentang laras.', second['abstract'])
        with mock.patch.object(server, 'ebook_get', side_effect=fake_get):
            self.assertEqual(server.journal_search('10.1371/journal.pone.0000308', page=2)['results'], [], 'one page only')

    def test_pdf_by_doi_only(self):
        with mock.patch.object(server, 'journal_candidates', return_value=['https://repo.example/a.pdf']) as cands, \
                mock.patch.object(server, 'probe_pdf', return_value=(True, 1234, '', 'https://repo.example/a.pdf')):
            found = server.journal_pdf('', '', 'https://doi.org/10.5555/gamelan')
        self.assertEqual(found, dict(pdf='https://repo.example/a.pdf', size=1234))
        self.assertEqual(cands.call_args[0][2], '10.5555/gamelan')
        with self.assertRaises(ValueError):
            server.journal_pdf('', '', 'bukan doi')

    def test_route_accepts_a_list_of_dois(self):
        dois = '\n'.join(f'10.1371/journal.pone.{i:07d}' for i in range(12))
        self.assertGreater(len(dois), 200)
        self.assertLessEqual(len(' '.join(dois.split())), server.DOI_MAX * 80)


if __name__ == '__main__':
    unittest.main()
