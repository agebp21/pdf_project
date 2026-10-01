"""Privacy policy / Terms pages are served (both languages inside), and the
7-day build clean-up the privacy policy promises: old finished build folders
go, recent / running ones and other folders stay."""
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class BuildCleanupTests(unittest.TestCase):
    def test_prune_builds(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(server, 'BUILD', Path(tmp)), mock.patch.dict(server.JOBS, clear=True):
            root = Path(tmp)
            now = time.time()
            def job(name, age_days):
                folder = root / name
                (folder).mkdir()
                (folder / 'input.zip').write_bytes(b'x')
                os.utime(folder, (now - age_days * 86400, now - age_days * 86400))
                return folder
            old, fresh, running = job('a' * 32, 8), job('b' * 32, 2), job('c' * 32, 30)
            other = job('native-workspace', 30)              # not a job folder
            server.JOBS['a' * 32] = {'status': 'done'}
            server.JOBS['c' * 32] = {'status': 'running'}
            self.assertEqual(server.prune_builds(now), 1)
            self.assertFalse(old.exists()); self.assertNotIn('a' * 32, server.JOBS)
            self.assertTrue(fresh.exists(), 'younger than 7 days stays')
            self.assertTrue(running.exists(), 'a running build is never removed')
            self.assertTrue(other.exists(), 'only job folders are touched')


class LegalPagesTests(unittest.TestCase):
    def test_pages_served(self):
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            for page, words in (('privacy.html', ('Kebijakan Privasi', 'Privacy Policy', 'drive.file', 'Limited Use', '7 hari', 'UU No. 27 Tahun 2022')),
                                ('terms.html', ('Syarat & Ketentuan', 'Terms of Service', 'tidak diperpanjang otomatis', 'renew automatically'))):
                with opener.open(f'http://127.0.0.1:{httpd.server_port}/{page}') as response:
                    html = response.read().decode('utf-8')
                    self.assertEqual(response.headers['Cache-Control'], 'no-cache')
                for word in words:
                    self.assertIn(word, html, page)
            for page in ('index.html', 'login.html'):
                html = Path(server.ROOT / page).read_text(encoding='utf-8')
                self.assertIn('href="privacy.html"', html, page); self.assertIn('href="terms.html"', html, page)
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
