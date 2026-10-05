"""AI gate without a payment gateway: paid members pass, free stays out."""
import http.cookiejar
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import accounts
import server


class Client:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=dict(headers or {}))
        if data is not None:
            request.add_header('Content-Type', 'application/json')
        try:
            with self.opener.open(request) as response:
                raw, status = response.read(), response.status
        except urllib.error.HTTPError as error:
            with error:
                raw, status = error.read(), error.code
        return status, (json.loads(raw) if raw[:1] in (b'{', b'[') else raw)


class AiPaidTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.previous = (server.ACCOUNTS, dict(server.CONFIG))
        store = accounts.Accounts(Path(cls.temporary.name) / 'a.db',
                                  accounts.DisabledProvider(), accounts.DisabledProvider())
        server.ACCOUNTS = store
        server.CONFIG['paywall'] = True
        cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:' + str(cls.httpd.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()
        server.ACCOUNTS, config = cls.previous
        server.CONFIG.clear()
        server.CONFIG.update(config)
        cls.temporary.cleanup()

    def test_paid_passes_free_stays_out(self):
        free, pro = Client(self.base), Client(self.base)
        free.call('POST', '/api/auth/register', {'email': 'free-gw@b.co', 'password': 'rahasia-123'})
        pro.call('POST', '/api/auth/register', {'email': 'pro-gw@b.co', 'password': 'rahasia-123'})
        server.ACCOUNTS.grant_plan('pro-gw@b.co', 'pro', 30)
        headers = {'X-Build-Token': server.TOKEN}
        routes = ('/api/summary', '/api/podcast/script', '/api/highlight-summary', '/api/translate')
        for route in routes:
            with self.subTest(route=route):
                status, body = free.call('POST', route, {}, headers=headers)[:2]
                self.assertEqual(status, 503, 'free waits for payments')
                self.assertIn('pembayaran', body['error'])
                status, _ = pro.call('POST', route, {}, headers=headers)[:2]
                # Past the gate: bad bodies fail validation (400) or AI setup (502),
                # never the payments gate (503).
                self.assertNotEqual(status, 503, 'paid members keep their AI')


if __name__ == '__main__':
    unittest.main()
