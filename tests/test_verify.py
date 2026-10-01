"""Email verification and Google sign-in: sign-up waits for the email link,
unverified accounts can't log in, resend, the link signs in; Google ID
tokens are checked with Google (aud, issuer, expiry, verified email), link
to an existing email account or create a verified one."""
import http.cookiejar
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import accounts
import server


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Client:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar), NoRedirect)

    def call(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, method=method, headers={'Content-Type': 'application/json'} if data else {})
        try:
            with self.opener.open(request) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            with error:
                return error.code, error.headers, error.read()

    def json(self, method, path, body=None):
        status, headers, raw = self.call(method, path, body)
        return status, json.loads(raw or b'{}')


class VerifyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.previous = (server.ACCOUNTS, server.DATA, dict(server.CONFIG))
        server.ACCOUNTS = accounts.Accounts(Path(cls.temporary.name) / 'accounts.db')
        server.DATA = Path(cls.temporary.name)
        server.CONFIG['verify_email'] = True
        cls.env = mock.patch.dict(os.environ, {'SMTP_HOST': '', 'GOOGLE_CLIENT_ID': 'client-123.apps.googleusercontent.com', 'MAIL_FROM_NAME': 'MyFlipbook'})
        cls.env.start()
        cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True); cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.httpd.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.httpd.server_close(); cls.thread.join()
        cls.env.stop()
        server.ACCOUNTS, server.DATA, config = cls.previous
        server.CONFIG.clear(); server.CONFIG.update(config)
        cls.temporary.cleanup()

    def outbox(self, email):
        import email as mail_lib
        from email import policy
        files = sorted((server.DATA / 'outbox').glob(f'*{email}*.eml'), key=lambda f: f.stat().st_mtime_ns)
        if not files:
            return ''
        message = mail_lib.message_from_bytes(files[-1].read_bytes(), policy=policy.default)
        headers = ''.join(f'{k}: {v}\n' for k, v in message.items())
        return headers + message.get_body(preferencelist=('plain',)).get_content()

    def test_signup_needs_the_email_link(self):
        guest = Client(self.base)
        status, body = guest.json('POST', '/api/auth/register', {'email': 'Sari@Example.com', 'password': 'rahasia-123', 'name': 'Sari'})
        self.assertEqual((status, body['verify'], body['email'], body['outbox']), (201, True, 'sari@example.com', True))
        self.assertIsNone(guest.json('GET', '/api/auth/me')[1]['user'], 'not signed in before verifying')
        mail = self.outbox('sari@example.com')
        self.assertIn('From: MyFlipbook <', mail, 'sender shows as MyFlipbook')
        self.assertIn('Subject: Verifikasi email MyFlipbook', mail)
        link = re.search(r'(/api/auth/verify\?token=[\w-]+)', mail).group(1)
        # Can't log in yet; can ask for the email again.
        status, body = Client(self.base).json('POST', '/api/auth/login', {'email': 'sari@example.com', 'password': 'rahasia-123'})
        self.assertEqual(status, 403); self.assertIn('belum diverifikasi', body['error'])
        self.assertEqual(guest.json('POST', '/api/auth/resend', {'email': 'sari@example.com'}), (200, {'ok': True}))
        newer = re.search(r'(/api/auth/verify\?token=[\w-]+)', self.outbox('sari@example.com')).group(1)
        self.assertNotEqual(newer, link, 'a fresh link')
        self.assertEqual(guest.call('GET', link)[1]['Location'], '/login.html?verify=failed', 'the older link no longer works')
        status, headers, _ = guest.call('GET', newer)
        self.assertEqual((status, headers['Location']), (302, '/account.html?verified=1'))
        me = guest.json('GET', '/api/auth/me')[1]['user']
        self.assertEqual((me['email'], me['verified']), ('sari@example.com', True))
        self.assertEqual(Client(self.base).json('POST', '/api/auth/login', {'email': 'sari@example.com', 'password': 'rahasia-123'})[0], 200)
        self.assertEqual(guest.call('GET', newer)[1]['Location'], '/login.html?verify=failed', 'a link works once')
        # Resend never tells who is registered.
        self.assertEqual(guest.json('POST', '/api/auth/resend', {'email': 'nobody@example.com'}), (200, {'ok': True}))
        # Signing up again with a verified email is refused.
        self.assertEqual(guest.json('POST', '/api/auth/register', {'email': 'sari@example.com', 'password': 'rahasia-123'})[0], 409)

    def test_existing_accounts_stay_verified(self):
        path = Path(self.temporary.name) / 'old.db'
        import sqlite3
        db = sqlite3.connect(path)
        db.execute('CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT "", '
                   'password_hash TEXT NOT NULL, plan TEXT NOT NULL DEFAULT "free", plan_expires_at INTEGER, created_at INTEGER NOT NULL)')
        db.execute('INSERT INTO users(email, password_hash, created_at) VALUES(?,?,?)', ('lama@example.com', accounts.hash_password('rahasia-123'), 1))
        db.commit(); db.close()
        store = accounts.Accounts(path)
        self.assertTrue(store.user_for(store.login('lama@example.com', 'rahasia-123'))['verified'])

    def google(self, claims):
        response = mock.MagicMock()
        response.read.return_value = json.dumps(claims).encode()
        response.__enter__.return_value = response
        return mock.patch('urllib.request.urlopen', return_value=response)

    def test_google_sign_in(self):
        good = {'aud': 'client-123.apps.googleusercontent.com', 'iss': 'https://accounts.google.com', 'exp': str(int(time.time()) + 600),
                'email_verified': 'true', 'sub': 'g-1', 'email': 'Budi@Gmail.com', 'name': 'Budi'}
        client = Client(self.base)
        with self.google(good) as call:
            status, body = client.json('POST', '/api/auth/google', {'credential': 'x' * 40})
        self.assertIn('tokeninfo?id_token=', call.call_args[0][0].full_url)
        self.assertEqual((status, body['user']['email'], body['user']['verified'], body['user']['google']), (200, 'budi@gmail.com', True, True))
        self.assertEqual(client.json('GET', '/api/auth/me')[1]['user']['name'], 'Budi')
        # The same Google account again: the same user.
        with self.google(dict(good, email='budi@gmail.com')):
            self.assertEqual(Client(self.base).json('POST', '/api/auth/google', {'credential': 'x' * 40})[1]['user']['id'], body['user']['id'])
        # An unverified email sign-up with that address gets linked and verified by Google.
        Client(self.base).json('POST', '/api/auth/register', {'email': 'dewi@example.com', 'password': 'rahasia-123'})
        with self.google(dict(good, sub='g-2', email='dewi@example.com')):
            status, body = Client(self.base).json('POST', '/api/auth/google', {'credential': 'x' * 40})
        self.assertEqual((status, body['user']['email'], body['user']['verified']), (200, 'dewi@example.com', True))
        self.assertEqual(Client(self.base).json('POST', '/api/auth/login', {'email': 'dewi@example.com', 'password': 'rahasia-123'})[0], 200)
        # Tokens for another app, expired, or with an unverified email are refused.
        for bad in (dict(good, aud='other'), dict(good, exp='1'), dict(good, email_verified='false'), dict(good, iss='evil.com')):
            with self.google(bad):
                self.assertEqual(Client(self.base).json('POST', '/api/auth/google', {'credential': 'x' * 40})[0], 401)
        self.assertEqual(Client(self.base).json('POST', '/api/auth/google', {'credential': 'short'})[0], 400)
        with mock.patch.dict(os.environ, {'GOOGLE_CLIENT_ID': ''}):
            self.assertEqual(Client(self.base).json('POST', '/api/auth/google', {'credential': 'x' * 40})[0], 503)
        self.assertEqual(Client(self.base).json('GET', '/api/auth/me')[1]['googleClientId'], 'client-123.apps.googleusercontent.com')

    def test_google_cookie_does_not_sign_out(self):
        """Google's button sets g_state={"i_l":0} on our site; the session must still be read."""
        with self.google({'aud': 'client-123.apps.googleusercontent.com', 'iss': 'accounts.google.com', 'exp': str(int(time.time()) + 600),
                          'email_verified': True, 'sub': 'g-9', 'email': 'rina@gmail.com', 'name': 'Rina'}):
            client = Client(self.base)
            client.json('POST', '/api/auth/google', {'credential': 'x' * 40})
        session = next(c.value for c in client.jar if c.name == 'mf_session')
        for header in (f'g_state={{"i_l":0,"i_ll":1790849000000}}; mf_session={session}',
                       f'mf_session={session}; g_state={{"i_l":0}}; other="a b"'):
            request = urllib.request.Request(self.base + '/api/auth/me', headers={'Cookie': header})
            with urllib.request.urlopen(request) as response:
                self.assertEqual(json.loads(response.read())['user']['email'], 'rina@gmail.com', header)
        for header in ('mf_session=short', 'mf_session=' + 'a' * 40 + '<', 'g_state={"i_l":0}'):
            request = urllib.request.Request(self.base + '/api/auth/me', headers={'Cookie': header})
            with urllib.request.urlopen(request) as response:
                self.assertIsNone(json.loads(response.read())['user'], header)


if __name__ == '__main__':
    unittest.main()
