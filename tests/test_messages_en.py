"""Server messages in English on English pages: every Indonesian message
written in the code has an English version (a new one without it fails
here), dynamic ones match their patterns, and JSON errors are translated
only when the page sends mf_lang=en."""
import json
from pathlib import Path
import re
import sys
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import messages_en
import server

ROOT = Path(__file__).resolve().parents[1]
MESSAGE = re.compile(r"""(?:AccountError\(\d+,\s*|RuntimeError\(|ValueError\(|'error':\s*)('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")""")
INDONESIAN = re.compile(r'\b(tidak|belum|gagal|silakan|halaman|terlalu|ditemukan|dihubungi|permintaan|kosong|sudah|harus|dulu)\b', re.I)


class MessagesTests(unittest.TestCase):
    def test_every_fixed_message_has_english(self):
        missing = []
        for name in ('server.py', 'accounts.py', 'library.py'):
            for match in MESSAGE.finditer((ROOT / name).read_text(encoding='utf-8')):
                text = match.group(1)[1:-1]
                if INDONESIAN.search(text) and '{' not in text and not text.endswith(': ') and messages_en.english(text) == text:
                    missing.append(f'{name}: {text}')
        self.assertEqual(missing, [], 'add these to messages_en.EXACT')

    def test_patterns(self):
        cases = {
            'Layanan AI menolak permintaan (402). Key blocked': 'The AI service refused the request (402). Key blocked',
            'Gambar halaman 3 bukan JPEG.': 'Page image 3 is not a JPEG.',
            'OAPEN tidak bisa dihubungi. Internet Archive tidak bisa dihubungi.': 'OAPEN could not be reached. Internet Archive could not be reached.',
            'Internet Archive menolak permintaan (503).': 'Internet Archive refused the request (503).',
            'Link tidak bisa dibuka (HTTP 404).': 'The link could not be opened (HTTP 404).',
            'Link tidak bisa dibuka: timed out': 'The link could not be opened: timed out',
            'Email gagal dikirim: auth failed': 'The email could not be sent: auth failed',
            'Arsip penuh: paket Free menyimpan 3 buku. Hapus buku lama di My Library atau upgrade paket.':
                'Library full: the Free plan keeps 3 books. Delete old books in My Library or upgrade your plan.',
            'Ruang arsip paket Pro penuh (500 MB). Hapus buku lama di My Library atau upgrade paket.':
                'The Pro plan library space is full (500 MB). Delete old books in My Library or upgrade your plan.',
            'Unknown text stays.': 'Unknown text stays.',
        }
        for given, wanted in cases.items():
            self.assertEqual(messages_en.english(given), wanted)
        self.assertEqual(messages_en.english(None), None)


class LanguageRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True); cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.httpd.server_port}'
        cls.open = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.httpd.server_close(); cls.thread.join()

    def error(self, cookie=None):
        request = urllib.request.Request(self.base + '/api/ebooks?q=a', headers={'Cookie': cookie} if cookie else {})
        try:
            self.open.open(request)
        except urllib.error.HTTPError as e:
            with e:
                return json.loads(e.read())['error']

    def test_language_cookie(self):
        self.assertEqual(self.error(), 'Tulis kata kunci 2-200 karakter.', 'no cookie: as written')
        self.assertEqual(self.error('mf_lang=id'), 'Tulis kata kunci 2-200 karakter.')
        self.assertEqual(self.error('g_state={"i_l":0}; mf_lang=en'), 'Type keywords of 2-200 characters.')


if __name__ == '__main__':
    unittest.main()
