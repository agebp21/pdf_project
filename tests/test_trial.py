"""Free trial: 7 days of everything, then the flipbook reader only.
Office/AI/library saves refuse with an upgrade message; reading
(library list/download, share links) keeps working; Pro is unaffected."""
import http.cookiejar
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import accounts
import messages_en
import server


class Member:
    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, method, path, body=None, content_type='application/json', headers=None):
        data = body if isinstance(body, (bytes, bytearray)) or body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=dict(headers or {}))
        if data is not None:
            request.add_header('Content-Type', content_type)
        try:
            with self.opener.open(request) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            with error:
                return error.code, error.headers, error.read()

    def json(self, *args, **kwargs):
        status, _, raw = self.call(*args, **kwargs)
        return status, json.loads(raw or b'{}')


class TrialTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.previous = (server.ACCOUNTS, server.LIBRARY, server.SHARE, server.CONFIG['paywall'], set(server.CONFIG['public_hosts']))
        server.ACCOUNTS = accounts.Accounts(Path(cls.temporary.name) / 'accounts.db')
        server.LIBRARY = None
        server.SHARE = None
        server.CONFIG['paywall'] = True
        server.CONFIG['public_hosts'] = {'myflipbook.test'}
        cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:' + str(cls.httpd.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()
        server.ACCOUNTS, server.LIBRARY, server.SHARE = cls.previous[:3]
        server.CONFIG['paywall'] = cls.previous[3]
        server.CONFIG['public_hosts'] = cls.previous[4]
        cls.temporary.cleanup()

    def member(self, email, plan=None, age_days=0):
        member = Member(self.base)
        self.assertEqual(member.json('POST', '/api/auth/register', {'email': email, 'password': 'rahasia-123'})[0], 201)
        if plan:
            server.ACCOUNTS.grant_plan(email, plan, None)
        if age_days:
            with server.ACCOUNTS.connect() as db:
                db.execute('UPDATE users SET created_at=? WHERE email=?', (int(time.time()) - age_days * 86400, email))
        return member

    def test_trial_flags(self):
        fresh = self.member('new@t.co')
        user = fresh.json('GET', '/api/auth/me')[1]['user']
        self.assertEqual(user['trialExpired'], False)
        self.assertGreaterEqual(user['trialDaysLeft'], 6)
        old = self.member('old@t.co', age_days=9)
        user = old.json('GET', '/api/auth/me')[1]['user']
        self.assertEqual(user['trialExpired'], True)
        self.assertEqual(user['trialDaysLeft'], 0)
        pro = self.member('pro@t.co', plan='pro', age_days=400)
        user = pro.json('GET', '/api/auth/me')[1]['user']
        self.assertEqual(user['trialExpired'], False)
        self.assertIsNone(user['trialDaysLeft'])

    def test_server_gates(self):
        headers = {'X-Build-Token': server.TOKEN}
        fresh = self.member('fresh@t.co')
        self.assertEqual(fresh.call('POST', '/api/summary', {}, headers=headers)[0], 400, 'trial: reaches validation')
        old = self.member('stale@t.co', age_days=9)
        for route in ('/api/convert/word-to-pdf', '/api/summary', '/api/translate-free'):
            with self.subTest(route=route):
                status, body = old.json('POST', route, {}, headers=headers)
                self.assertEqual(status, 402)
                self.assertIn('7 hari', body['error'])
        # Library: saving stops, reading your own books keeps working.
        self.assertEqual(old.call('POST', '/api/library/save', b'x', 'application/zip')[0], 402)
        self.assertEqual(old.json('GET', '/api/library')[0], 200)
        # A dated Pro account keeps every server feature.
        pro = self.member('pro2@t.co', plan='pro', age_days=400)
        self.assertEqual(pro.call('POST', '/api/summary', {}, headers=headers)[0], 400)

    def test_english(self):
        self.assertEqual(messages_en.english('Masa coba gratis 7 harimu sudah habis. Upgrade ke Pro untuk memakai fitur ini.'),
                         'Your 7-day free trial has ended. Upgrade to Pro to use this feature.')
        self.assertEqual(messages_en.english('Jatah 3 share gratis habis. Upgrade ke Pro untuk share tanpa batas.'),
                         'Your 3 free shares are used up. Upgrade to Pro for unlimited sharing.')


if __name__ == '__main__':
    unittest.main()
