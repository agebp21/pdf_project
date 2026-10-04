"""PAYMENTS_PAUSED=1 (.env): plans say payments are off and checkout is
refused, even when a gateway is set up; without it, checkout works as before."""
import http.client
import http.cookies
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class PaymentsPaused(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.env = mock.patch.dict(os.environ, {'MYFLIPBOOK_DB': str(Path(self.tmp.name) / 'a.sqlite3'), 'MYFLIPBOOK_MOCK_PAYMENTS': '1'})
        self.env.start()
        server.ACCOUNTS = server.LIBRARY = server.VISITS = None
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.cookie = ''

    def tearDown(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.env.stop()
        server.ACCOUNTS = server.LIBRARY = server.VISITS = None
        self.tmp.cleanup()

    def call(self, method, path, body=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=10)
        headers = {'Content-Type': 'application/json', 'Origin': f'http://127.0.0.1:{self.httpd.server_port}'}
        if self.cookie:
            headers['Cookie'] = self.cookie
        conn.request(method, path, json.dumps(body) if body is not None else None, headers)
        r = conn.getresponse(); data = r.read(); cookie = r.getheader('Set-Cookie'); conn.close()
        if cookie:
            self.cookie = cookie.split(';')[0]
        return r.status, json.loads(data or b'{}')

    def test_pause(self):
        status, _ = self.call('POST', '/api/auth/register', {'email': 'p@example.com', 'password': 'secret-pass-1'})
        self.assertIn(status, (200, 201))
        with mock.patch.dict(os.environ, {'PAYMENTS_PAUSED': '1'}):
            _, plans = self.call('GET', '/api/billing/plans')
            self.assertEqual(plans['paymentsEnabled'], {'IDR': False, 'USD': False}); self.assertTrue(plans['paymentsPaused'])
            status, body = self.call('POST', '/api/billing/checkout', {'plan': 'pro', 'cycle': 'monthly'})
            self.assertEqual(status, 503); self.assertIn('sementara dinonaktifkan', body['error'])
        _, plans = self.call('GET', '/api/billing/plans')
        self.assertFalse(plans['paymentsPaused']); self.assertTrue(plans['paymentsEnabled']['IDR'], 'mock gateway on when not paused')
        status, body = self.call('POST', '/api/billing/checkout', {'plan': 'pro', 'cycle': 'monthly'})
        self.assertEqual(status, 200, body)


if __name__ == '__main__':
    unittest.main()
