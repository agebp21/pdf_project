"""Forgotten password: /api/auth/forgot emails a one-hour, one-use link (the same answer for
unknown emails, limited per address), /api/auth/reset sets the new password, signs out every
other session and signs in."""
import email
import email.policy
import http.client
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

HOST = 'reset.myflipbook.local'


class Reset(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.env = mock.patch.dict(os.environ, {'MYFLIPBOOK_DB': str(Path(self.tmp.name) / 'a.sqlite3'), 'SMTP_HOST': ''})
        self.env.start()
        self.data = mock.patch.object(server, 'DATA', Path(self.tmp.name))
        self.data.start()
        self.config = mock.patch.dict(server.CONFIG, {'public_hosts': {HOST}, 'secure': False, 'verify_email': False})
        self.config.start()
        server.ACCOUNTS = server.LIBRARY = server.VISITS = None
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.cookie = ''

    def tearDown(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.config.stop(); self.data.stop(); self.env.stop()
        server.ACCOUNTS = server.LIBRARY = server.VISITS = None
        self.tmp.cleanup()

    def call(self, method, path, body=None, cookie=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=20)
        h = {'Host': HOST, 'Cookie': self.cookie if cookie is None else cookie, 'X-Real-IP': '10.0.0.3', 'Content-Type': 'application/json'}
        conn.request(method, path, json.dumps(body or {}).encode(), h)
        r = conn.getresponse(); raw = r.read(); set_cookie = r.getheader('Set-Cookie'); conn.close()
        if set_cookie and 'mf_session' in set_cookie:
            self.cookie = set_cookie.split(';')[0]
        return r.status, json.loads(raw or b'{}')

    def link(self):
        mails = sorted((Path(self.tmp.name) / 'outbox').glob('*.eml'))
        with open(mails[-1], 'rb') as f:
            body = email.message_from_binary_file(f, policy=email.policy.default).get_body(('plain',)).get_content()
        return re.search(r'https?://\S+#reset=([A-Za-z0-9_-]+)', body)[1]

    def test_reset_flow(self):
        self.assertEqual(self.call('POST', '/api/auth/register', {'email': 'r@example.com', 'password': 'old-password-1'})[0], 201)
        other = self.cookie                                      # a session on "another device"
        self.assertEqual(self.call('POST', '/api/auth/forgot', {'email': 'R@example.com '}), (200, {'ok': True}))
        token = self.link()
        self.assertEqual(self.call('POST', '/api/auth/forgot', {'email': 'nobody@example.com'}), (200, {'ok': True}), 'unknown: the same answer')
        self.assertEqual(self.call('POST', '/api/auth/reset', {'token': token, 'password': 'short'})[0], 400)
        status, body = self.call('POST', '/api/auth/reset', {'token': token, 'password': 'new-password-2'}, cookie='')
        self.assertEqual(status, 200); self.assertEqual(body['user']['email'], 'r@example.com')
        self.assertEqual(self.call('GET', '/api/auth/me', cookie=other)[1].get('user'), None, 'other sessions are signed out')
        self.assertEqual(self.call('POST', '/api/auth/reset', {'token': token, 'password': 'new-password-3'})[0], 400, 'the link works once')
        self.assertEqual(self.call('POST', '/api/auth/login', {'email': 'r@example.com', 'password': 'old-password-1'}, cookie='')[0], 401)
        self.assertEqual(self.call('POST', '/api/auth/login', {'email': 'r@example.com', 'password': 'new-password-2'}, cookie='')[0], 200)

    def test_link_expires_and_requests_are_limited(self):
        self.call('POST', '/api/auth/register', {'email': 'e@example.com', 'password': 'old-password-1'})
        self.call('POST', '/api/auth/forgot', {'email': 'e@example.com'})
        token = self.link()
        with server.get_accounts().connect() as db:
            db.execute('UPDATE reset_tokens SET expires_at=?', (int(time.time()) - 1,))
        self.assertEqual(self.call('POST', '/api/auth/reset', {'token': token, 'password': 'new-password-2'})[0], 400)
        codes = [self.call('POST', '/api/auth/forgot', {'email': 'e@example.com'})[0] for _ in range(8)]
        self.assertIn(429, codes, 'asking again and again is stopped')


if __name__ == '__main__':
    unittest.main()
