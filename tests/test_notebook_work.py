"""AI Summarizer workspace: a journal draft section by section, slides, and Ask reading the
member's own work (notes, summary, journal) along with the highlighted pages."""
import json
import os
from pathlib import Path
import sys
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

ENV = {'SUMOPOD_API_KEY': 'sk-test', 'SUMOPOD_BASE_URL': 'https://ai.example/v1', 'PODCAST_MODEL': 'claude-sonnet-5'}
SOURCE = '[Halaman 3]\nGamelan adalah ansambel musik tradisional Jawa.'


def reply(content):
    body = json.dumps({'choices': [{'message': {'content': content}}]}).encode()
    response = mock.MagicMock()
    response.read.return_value = body
    response.__enter__.return_value = response
    return response


def sent(call):
    messages = json.loads(call.call_args[0][0].data)['messages']
    return messages[0]['content'], messages[1]['content']


class JournalTests(unittest.TestCase):
    def test_section_prompt_and_reply(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('Gamelan **dikaji** di sini (hlm. 3).')) as call:
            out = server.write_journal('Gamelan', SOURCE, 'pendahuluan', 'id-ID', 'Catatan saya:\n  gamelan   dan ritual')
        self.assertEqual(out, 'Gamelan dikaji di sini (hlm. 3).')
        system, user = sent(call)
        self.assertIn('"Pendahuluan"', system); self.assertIn('jangan mengarang', system); self.assertIn('(hlm. 12)', system)
        self.assertIn('[Halaman 3]', user); self.assertIn('gamelan dan ritual', user, 'notes tidied and sent')

    def test_title_is_one_line_without_page_tags(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('"Gamelan Jawa\ndalam Ritual"')) as call:
            out = server.write_journal('Gamelan', SOURCE, 'judul')
        self.assertEqual(out, 'Gamelan Jawa dalam Ritual')
        self.assertNotIn('Sebut halaman', sent(call)[0])

    def test_english_page_word(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('Text (p. 3).')) as call:
            server.write_journal('Gamelan', SOURCE, 'hasil', 'en-US')
        self.assertIn('(p. 12)', sent(call)[0]); self.assertIn('English', sent(call)[0])

    def test_unknown_section(self):
        with self.assertRaises(ValueError):
            server.write_journal('G', SOURCE, 'lampiran')


class SlideTests(unittest.TestCase):
    def test_parse_wrapped_json(self):
        raw = 'Berikut slide:\n```json\n{"slides":[{"title":" Apa  itu gamelan ","points":["Ansambel Jawa", "", 5],"notes":"Lihat (hlm. 3)."},' \
              '"bad",{"title":"","points":[]},{"title":"Penutup","points":["Simpulan"]}]}\n```'
        self.assertEqual(server.parse_slides(raw), [
            {'title': 'Apa itu gamelan', 'points': ['Ansambel Jawa', '5'], 'notes': 'Lihat (hlm. 3).'},
            {'title': 'Penutup', 'points': ['Simpulan'], 'notes': ''}])
        self.assertEqual(server.parse_slides('not json {'), [])

    def test_make_slides_count_and_retry(self):
        good = json.dumps({'slides': [{'title': f'S{i}', 'points': ['a', 'b', 'c']} for i in range(5)]})
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', side_effect=[reply('maaf'), reply(good)]) as call:
            out = server.make_slides('Gamelan', SOURCE, 'id-ID', 99, 'catatan')
        self.assertEqual(len(out), 5)
        system, user = sent(call)
        self.assertIn(f'tepat {server.SLIDES_MAX} slide', system, 'count capped')
        self.assertIn('CATATAN PEMBACA:\ncatatan', user)

    def test_make_slides_gives_up(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('{}')):
            with self.assertRaises(RuntimeError):
                server.make_slides('Gamelan', SOURCE)


class AskWorkTests(unittest.TestCase):
    def test_work_goes_along(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('Ya (hlm. 3).')) as call:
            server.ask_document('G', SOURCE, 'Apakah ringkasan saya benar?', (), 'Ringkasan saya: gamelan dari Bali.')
        system, user = sent(call)
        self.assertIn('HASIL KERJA PEMBACA', system); self.assertIn('HASIL KERJA PEMBACA:\nRingkasan saya: gamelan dari Bali.', user)

    def test_without_work_nothing_changes(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('Ya.')) as call:
            server.ask_document('G', SOURCE, 'Apa?')
        self.assertNotIn('HASIL KERJA', sent(call)[1])

    def test_work_is_capped(self):
        self.assertEqual(len(server.clean_work('x' * 50_000)), server.WORK_MAX_CHARS)
        self.assertEqual(server.clean_work(None), '')


class WriteRouteTests(unittest.TestCase):
    def setUp(self):
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True); self.thread.start()

    def tearDown(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.thread.join()

    def post(self, body):
        request = urllib.request.Request(f'http://127.0.0.1:{self.httpd.server_port}/api/write', data=json.dumps(body).encode(), method='POST',
                                         headers={'Content-Type': 'application/json', 'X-Build-Token': server.TOKEN})
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.loads(error.read())

    def test_journal_and_slides(self):
        words = {'0': [' '.join(['kata'] * 60)]}
        with mock.patch.object(server, 'write_journal', return_value='Isi (hlm. 1)') as journal:
            self.assertEqual(self.post({'kind': 'journal', 'section': 'abstrak', 'title': 'B', 'text': words, 'lang': 'en-US', 'work': 'n'}),
                             (200, {'text': 'Isi (hlm. 1)'}))
            self.assertEqual(journal.call_args[0][2:], ('abstrak', 'en-US', 'n'))
        with mock.patch.object(server, 'make_slides', return_value=[{'title': 'A', 'points': [], 'notes': ''}]) as slides:
            self.assertEqual(self.post({'kind': 'slides', 'count': 6, 'text': words})[0], 200)
            self.assertEqual(slides.call_args[0][3], 6)
        self.assertEqual(self.post({'kind': 'other', 'text': words})[0], 400)
        self.assertEqual(self.post({'kind': 'slides', 'text': {'0': ['sedikit']}})[0], 400)
        with mock.patch.object(server, 'make_slides', side_effect=RuntimeError('AI belum diatur')):
            self.assertEqual(self.post({'kind': 'slides', 'text': words})[0], 502)


if __name__ == '__main__':
    unittest.main()
