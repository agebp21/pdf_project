"""Usage allowance per rolling window (hosted): Free (trial) members get a small
allowance per kind (office conversions, AI, book translation by characters),
then 429 says when it refills; Pro/Business get bigger or no limits; the
account page reads /api/auth/usage. Limits come from .env (QUOTA_*)."""
import http.client
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

HOST = 'quota.myflipbook.local'


class Quota(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.env = mock.patch.dict(os.environ, {'MYFLIPBOOK_DB': str(Path(self.tmp.name) / 'a.sqlite3'), 'QUOTA_FREE_OFFICE': '2',
                                                'QUOTA_FREE_TRANSLATE': '50', 'FREE_TRANSLATE_LOCAL': '0', 'BUILD_WORKER_KEY': 'k'})
        self.env.start()
        self.config = mock.patch.dict(server.CONFIG, {'public_hosts': {HOST}, 'secure': False, 'verify_email': False, 'paywall': True})
        self.config.start()
        server.ACCOUNTS = server.LIBRARY = server.VISITS = None
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.cookie = ''

    def tearDown(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.config.stop(); self.env.stop()
        server.ACCOUNTS = server.LIBRARY = server.VISITS = None
        self.tmp.cleanup()

    def call(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=20)
        h = {'Host': HOST, 'Cookie': self.cookie, 'X-Real-IP': '10.0.0.1'}
        h.update(headers or {})
        data = json.dumps(body).encode() if isinstance(body, dict) else body
        if isinstance(body, dict):
            h['Content-Type'] = 'application/json'
        conn.request(method, path, data, h)
        r = conn.getresponse(); raw = r.read(); cookie = r.getheader('Set-Cookie'); conn.close()
        if cookie and 'mf_session' in cookie or (cookie and not self.cookie):
            self.cookie = cookie.split(';')[0]
        try:
            return r.status, json.loads(raw or b'{}')
        except ValueError:
            return r.status, raw

    def test_allowance(self):
        self.assertEqual(self.call('POST', '/api/auth/register', {'email': 'q@example.com', 'password': 'secret-pass-1'})[0], 201)
        token = self.call('GET', '/api/capabilities')[1]['token']
        convert = lambda: self.call('POST', '/api/convert/word-to-pdf', b'not a document',
                                    {'Content-Type': 'application/octet-stream', 'X-Build-Token': token, 'X-Filename': 'a.docx'})
        self.assertNotEqual(convert()[0], 429); self.assertNotEqual(convert()[0], 429)
        status, body = convert()
        self.assertEqual(status, 429); self.assertRegex(body['error'], r'Jatah konversi habis .* terisi lagi pukul \d\d:\d\d')
        # Book translation counts characters: 30 fit in 50, the next 30 do not.
        text = {'pages': {'0': 'x' * 30}, 'target': 'id-ID'}
        h = {'X-Build-Token': token}
        self.assertEqual(self.call('POST', '/api/translate-free', text, h)[0], 503, 'counted, then the PC is offline')
        status, body = self.call('POST', '/api/translate-free', text, h)
        self.assertEqual(status, 429); self.assertIn('terjemahan buku', body['error'])
        usage = self.call('GET', '/api/auth/usage')[1]
        self.assertTrue(usage['limited']); self.assertEqual(usage['windowHours'], 5)
        self.assertEqual((usage['quotas']['office']['used'], usage['quotas']['office']['limit']), (2, 2))
        self.assertEqual(usage['quotas']['translate']['used'], 30)
        self.assertAlmostEqual(usage['quotas']['office']['resetAt'], time.time() + 5 * 3600, delta=60)
        # Pro: no office limit.
        with server.get_accounts().connect() as db:
            db.execute("UPDATE users SET plan='pro', plan_expires_at=? WHERE email='q@example.com'", (int(time.time()) + 86400,))
        self.assertNotEqual(convert()[0], 429)
        self.assertIsNone(self.call('GET', '/api/auth/usage')[1]['quotas']['office']['limit'])


if __name__ == '__main__':
    unittest.main()
