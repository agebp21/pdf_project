"""One new account per network (hosted): a second sign-up from the same IP is
refused (email and Google), signing in to an existing account never is, the IP
comes from nginx's X-Real-IP (a visitor-written X-Forwarded-For can't dodge
it), SIGNUP_IP_ALLOW frees an IP, and IPs are stored only hashed."""
import http.client
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

HOST = 'test.myflipbook.local'


class SignupPerIp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.env = mock.patch.dict(os.environ, {'MYFLIPBOOK_DB': str(Path(self.tmp.name) / 'a.sqlite3')})
        self.env.start()
        self.config = mock.patch.dict(server.CONFIG, {'public_hosts': {HOST}, 'secure': False, 'verify_email': False, 'paywall': True})
        self.config.start()
        server.ACCOUNTS = server.LIBRARY = server.VISITS = None
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.config.stop(); self.env.stop()
        server.ACCOUNTS = server.LIBRARY = server.VISITS = None
        self.tmp.cleanup()

    def post(self, path, body, ip=None, forwarded=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=10)
        headers = {'Content-Type': 'application/json', 'Host': HOST}
        if ip:
            headers['X-Real-IP'] = ip
        if forwarded:
            headers['X-Forwarded-For'] = forwarded
        conn.request('POST', path, json.dumps(body), headers)
        r = conn.getresponse(); data = json.loads(r.read() or b'{}'); conn.close()
        return r.status, data

    def register(self, email, **kw):
        return self.post('/api/auth/register', {'email': email, 'password': 'secret-pass-1'}, **kw)

    def test_one_account_per_ip(self):
        self.assertEqual(self.register('a@example.com', ip='1.1.1.1')[0], 201)
        status, body = self.register('b@example.com', ip='1.1.1.1')
        self.assertEqual(status, 403); self.assertIn('jaringan ini', body['error'])
        self.assertEqual(self.register('c@example.com', ip='2.2.2.2')[0], 201, 'another network is fine')
        self.assertEqual(self.post('/api/auth/login', {'email': 'a@example.com', 'password': 'secret-pass-1'}, ip='1.1.1.1')[0], 200,
                         'signing in is never blocked')
        # A forged first X-Forwarded-For entry does not dodge it (nginx appends the real IP last).
        self.assertEqual(self.register('d@example.com', forwarded='9.9.9.9, 1.1.1.1')[0], 403)
        with mock.patch.dict(os.environ, {'SIGNUP_IP_ALLOW': '1.1.1.1'}):
            self.assertEqual(self.register('e@example.com', ip='1.1.1.1')[0], 201, 'an allowed (office) IP')
        db = sqlite3.connect(Path(self.tmp.name) / 'a.sqlite3')
        dump = '\n'.join(db.iterdump()); db.close()
        self.assertNotIn('1.1.1.1', dump); self.assertNotIn('2.2.2.2', dump)

    def test_google(self):
        claims = {'sub': 'g-1', 'email': 'g1@example.com', 'name': 'G'}
        with mock.patch.object(server, 'google_claims', lambda credential: dict(claims)):
            self.assertEqual(self.post('/api/auth/google', {'credential': 'x'}, ip='3.3.3.3')[0], 200)
            self.assertEqual(self.post('/api/auth/google', {'credential': 'x'}, ip='3.3.3.3')[0], 200, 'the same Google account signs in again')
            claims.update(sub='g-2', email='g2@example.com')
            status, body = self.post('/api/auth/google', {'credential': 'x'}, ip='3.3.3.3')
            self.assertEqual(status, 403, body)


if __name__ == '__main__':
    unittest.main()
