"""DOAB index (doab_index.py): OAI-PMH records parsed (chapters and deleted records left
out), the harvest pages through resumption tokens, resumes, starts over on an expired
token and later fetches only what changed; the local FTS search; DOAB as an ebook
source whose PDFs open in the reader's browser."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import doab_index
import server

HEAD = ('<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/" xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/">')


def record(handle, title, stamp='2025-01-01T00:00:00Z', deleted=False, extra=''):
    if deleted:
        return f'<record><header status="deleted"><identifier>oai:directory.doabooks.org:{handle}</identifier><datestamp>{stamp}</datestamp></header></record>'
    return (f'<record><header><identifier>oai:directory.doabooks.org:{handle}</identifier><datestamp>{stamp}</datestamp></header>'
            f'<metadata><oai_dc:dc><dc:title>{title}</dc:title>{extra}</oai_dc:dc></metadata></record>')


def page(records, token=None, total=None):
    rt = f'<resumptionToken completeListSize="{total or 0}">{token or ""}</resumptionToken>' if token is not None else ''
    return ET.fromstring(f'{HEAD}<ListRecords>{"".join(records)}{rt}</ListRecords></OAI-PMH>')


def error(code):
    return ET.fromstring(f'{HEAD}<error code="{code}">x</error></OAI-PMH>')


SEJARAH = ('<dc:creator>Sari, Dewi</dc:creator><dc:creator>Budi</dc:creator><dc:subject>thema EDItEUR::N History::NHF Asian history</dc:subject>'
           '<dc:subject>batik</dc:subject><dc:subject>PK1-9601</dc:subject><dc:date>2025-01-22T01:42:32Z</dc:date><dc:date>2021</dc:date>'
           '<dc:identifier>ONIX_1</dc:identifier><dc:identifier>https://directory.doabooks.org/handle/20.500.12854/7</dc:identifier>'
           '<dc:identifier>https://library.oapen.org/bitstream/20.500.12657/1/buku.pdf</dc:identifier>'
           '<dc:identifier>https://penerbit.example.ac.id/buku/7</dc:identifier><dc:language>ind</dc:language>'
           '<dc:publisher>UGM Press</dc:publisher><dc:alternateIdentifier>10.1234/ugm.7</dc:alternateIdentifier>')


class DoabTests(unittest.TestCase):
    def setUp(self):
        self.path = Path(tempfile.mkdtemp()) / 'doab.sqlite3'

    def test_record_parsing(self):
        root = page([record('20.500.12854/7', 'Sejarah Batik Nusantara', extra=SEJARAH), record('20.500.12854/8', 'Chapter 3 Batik'),
                     record('20.500.12854/9', '', deleted=True)])
        parsed = [doab_index.parse_record(r) for r in root.find('oai:ListRecords', doab_index.NS).findall('oai:record', doab_index.NS)]
        handle, book = parsed[0]
        self.assertEqual(handle, '20.500.12854/7')
        self.assertEqual((book['authors'], book['year'], book['lang'], book['publisher'], book['doi']),
                         ('Sari, Dewi; Budi', '2021', 'id', 'UGM Press', '10.1234/ugm.7'))
        self.assertEqual(book['subjects'], 'Asian history; batik', 'thema names shortened; LC class codes dropped')
        self.assertEqual(book['pdf'], 'https://library.oapen.org/bitstream/20.500.12657/1/buku.pdf')
        self.assertEqual(book['link'], 'https://penerbit.example.ac.id/buku/7')
        self.assertIsNone(parsed[1][1], 'chapters are not books'); self.assertIsNone(parsed[2][1], 'deleted record')

    def test_harvest_pages_resume_and_updates(self):
        calls = []
        pages = [page([record('20.500.12854/7', 'Sejarah Batik Nusantara', '2025-01-02T00:00:00Z', extra=SEJARAH)], token='t1', total=2),
                 page([record('20.500.12854/8', 'Climate Policy in Asia', '2025-03-01T00:00:00Z')], token='')]
        def fetcher(params):
            calls.append(dict(params))
            return pages.pop(0)
        self.assertEqual(doab_index.harvest(path=self.path, log=lambda *_: None, pause=0, fetcher=fetcher), 2)
        self.assertEqual(calls[1], {'verb': 'ListRecords', 'resumptionToken': 't1'})
        rows, total = doab_index.search('batik', path=self.path)
        self.assertEqual((total, rows[0]['title']), (1, 'Sejarah Batik Nusantara'))
        self.assertEqual(doab_index.search('clim', path=self.path)[1], 1, 'the last word matches as a prefix')
        self.assertEqual(doab_index.search('sejarah', lang='en', path=self.path)[1], 0)
        self.assertEqual(doab_index.search('" OR 1', path=self.path)[1], 0, 'no FTS syntax from users')
        # Next run: only what changed since the newest datestamp; a deletion leaves the index.
        later = []
        def update(params):
            later.append(dict(params))
            return page([record('20.500.12854/7', '', '2025-04-01T00:00:00Z', deleted=True)])
        doab_index.harvest(path=self.path, log=lambda *_: None, pause=0, fetcher=update)
        self.assertEqual(later[0], {'verb': 'ListRecords', 'metadataPrefix': 'oai_dc', 'from': '2025-03-01T00:00:00Z'})
        self.assertEqual(doab_index.search('batik', path=self.path)[1], 0)
        # Nothing new: fine.
        doab_index.harvest(path=self.path, log=lambda *_: None, pause=0, fetcher=lambda params: error('noRecordsMatch'))

    def test_interrupted_harvest_resumes_and_expired_token_restarts(self):
        def broken(params):
            if 'resumptionToken' in params:
                raise RuntimeError('network')
            return page([record('20.500.12854/1', 'Pertama')], token='t9', total=3)
        with self.assertRaises(RuntimeError):
            doab_index.harvest(path=self.path, log=lambda *_: None, pause=0, fetcher=broken)
        db = doab_index.connect(self.path)
        self.assertEqual(doab_index.meta(db, 'token'), 't9', 'the next run resumes from here')
        db.close()
        seen = []
        def expired(params):
            seen.append(dict(params))
            return error('badResumptionToken') if 'resumptionToken' in params else page([record('20.500.12854/2', 'Kedua')], token='')
        doab_index.harvest(path=self.path, log=lambda *_: None, pause=0, fetcher=expired)
        self.assertEqual([('resumptionToken' in p) for p in seen], [True, False])
        self.assertEqual(doab_index.search('kedua', path=self.path)[1], 1)

    def test_no_index_yet(self):
        self.assertEqual(doab_index.search('batik', path=self.path), ([], 0))

    def test_ebook_source(self):
        doab_index.harvest(path=self.path, log=lambda *_: None, pause=0,
                           fetcher=lambda params: page([record('20.500.12854/7', 'Sejarah Batik Nusantara', extra=SEJARAH)]))
        with mock.patch.dict('os.environ', {'DOAB_DB': str(self.path)}):
            books, more = server.doab_books('batik', 1, None)
            self.assertEqual(server.doab_books('', 1, None), ([], False), 'no browsing shelf')
        book, = books
        self.assertEqual((book['source'], book['id'], book['browserPdf'], book['readOnline'], book['doi']),
                         ('doab', '20.500.12854/7', 'https://library.oapen.org/bitstream/20.500.12657/1/buku.pdf',
                          'https://penerbit.example.ac.id/buku/7', 'https://doi.org/10.1234/ugm.7'))
        self.assertEqual(book['link'], 'https://directory.doabooks.org/handle/20.500.12854/7')
        self.assertFalse(more)
        self.assertIn('doab', server.EBOOK_DEFAULT)
        with self.assertRaises(LookupError):
            server.ebook_pdf('doab', '20.500.12854/7')


if __name__ == '__main__':
    unittest.main()
