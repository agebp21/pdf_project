"""Admin panel (admin_server.py, a separate backend): its own login, read-only
numbers about members, payments, uploads (metadata only) and visitors; and
the member site counting page views (visits.py) without storing IPs."""
import http.client
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import accounts
import admin_server
import visits


class AdminTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db = Path(self.tmp.name) / 'myflipbook.sqlite3'
        store = accounts.Accounts(str(self.db))
        self.alice = store.user_for(store.register('alice@example.com', 'secret-pass-1', 'Alice'))
        self.bob = store.user_for(store.register('bob@example.com', 'secret-pass-2', 'Bob'))
        now = int(time.time())
        with store.connect() as db:
            db.execute("UPDATE users SET plan='pro', plan_expires_at=? WHERE id=?", (now + 86400 * 20, self.alice['id']))
            db.execute("INSERT INTO orders(id, user_id, plan, cycle, amount, status, provider, created_at, paid_at, currency) "
                       "VALUES('o1', ?, 'pro', 'monthly', 49000, 'paid', 'mock', ?, ?, 'IDR')", (self.alice['id'], now, now))
            db.executescript('''CREATE TABLE library_books(id TEXT PRIMARY KEY, user_id INTEGER, title TEXT, page_count INTEGER, size INTEGER,
                                  has_cover INTEGER, created_at INTEGER, updated_at INTEGER);
                                CREATE TABLE library_exports(id TEXT PRIMARY KEY, book_id TEXT, user_id INTEGER, kind TEXT, filename TEXT,
                                  size INTEGER, created_at INTEGER);''')
            db.execute("INSERT INTO library_books VALUES('b1', ?, 'Majalah Rumah', 212, 5000000, 1, ?, ?)", (self.alice['id'], now, now))
            db.execute("INSERT INTO library_exports VALUES('e1', 'b1', ?, 'html', 'Majalah Rumah.html', 9000000, ?)", (self.alice['id'], now))
        v = visits.Visits(Path(self.tmp.name) / 'visits.sqlite3')
        chrome = 'Mozilla/5.0 (Windows NT 10.0) Chrome/150'
        self.assertTrue(v.record('/index.html', '1.2.3.4', chrome, 'https://www.google.com/search', None, own_hosts={'myflipbookpro.com'}))
        v.record('/flipbook.html', '1.2.3.4', chrome, 'https://myflipbookpro.com/index.html', self.alice['id'], own_hosts={'myflipbookpro.com'})
        v.record('/index.html', '5.6.7.8', 'Mozilla/5.0 (iPhone) Mobile Safari', '')
        self.assertFalse(v.record('/index.html', '9.9.9.9', 'Googlebot/2.1', ''), 'bots are not counted')
        self.env = mock.patch.dict(os.environ, {'MYFLIPBOOK_DB': str(self.db), 'ADMIN_USERNAME': 'boss',
                                                'ADMIN_PASSWORD_HASH': accounts.hash_password('very-long-admin-pass'),
                                                'SUMOPOD_API_KEY': 'sk-should-never-show'})
        self.env.start()
        admin_server.SESSIONS.clear(); admin_server.FAILURES.clear()
        self.httpd = admin_server.ThreadingHTTPServer(('127.0.0.1', 0), admin_server.AdminHandler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.cookie = ''

    def tearDown(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.env.stop(); self.tmp.cleanup()

    def call(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=10)
        h = {'Cookie': self.cookie} if self.cookie else {}
        if body is not None:
            h.update({'Content-Type': 'application/json', 'X-Admin': '1'})
        h.update(headers or {})
        conn.request(method, path, json.dumps(body) if body is not None else None, h)
        r = conn.getresponse()
        data = r.read()
        cookie = r.getheader('Set-Cookie')
        conn.close()
        try:
            data = json.loads(data)
        except ValueError:
            data = data.decode('utf-8', 'replace')
        return r.status, data, cookie

    def login(self):
        status, _, cookie = self.call('POST', '/api/login', {'username': 'Boss', 'password': 'very-long-admin-pass'})
        self.assertEqual(status, 200)
        self.assertIn('HttpOnly', cookie); self.assertIn('SameSite=Strict', cookie)
        self.cookie = cookie.split(';')[0]

    def test_login_is_required_and_separate(self):
        self.assertEqual(self.call('GET', '/')[0], 200)
        self.assertEqual(self.call('GET', '/api/session')[1], {'signedIn': False, 'configured': True})
        for path in ('/api/overview', '/api/members', '/api/uploads', '/api/visits', '/api/server', '/api/members/1'):
            self.assertEqual(self.call('GET', path)[0], 401, path)
        # A member's password is no admin password.
        self.assertEqual(self.call('POST', '/api/login', {'username': 'alice@example.com', 'password': 'secret-pass-1'})[0], 401)
        # No X-Admin header (a form from another site): refused.
        self.assertEqual(self.call('POST', '/api/login', None, {'Content-Type': 'application/json'})[0], 403)
        for _ in range(5):
            self.call('POST', '/api/login', {'username': 'boss', 'password': 'wrong'})
        self.assertEqual(self.call('POST', '/api/login', {'username': 'boss', 'password': 'very-long-admin-pass'})[0], 429, 'throttled')

    def test_numbers(self):
        self.login()
        status, d, _ = self.call('GET', '/api/overview')
        self.assertEqual(status, 200)
        self.assertEqual((d['members'], d['paid'], d['books'], d['exports']), (2, 1, 1, 1))
        self.assertEqual(d['revenue'], {'IDR': {'orders': 1, 'total': 49000}})
        self.assertEqual((d['visits']['views'], d['visits']['visitors'], d['visits']['members']), (3, 2, 1))
        _, m, _ = self.call('GET', '/api/members?q=ali')
        self.assertEqual([x['email'] for x in m['items']], ['alice@example.com'])
        self.assertEqual((m['items'][0]['books'], m['items'][0]['paid']), (1, True))
        _, one, _ = self.call('GET', f"/api/members/{self.alice['id']}")
        self.assertEqual(one['books'][0]['title'], 'Majalah Rumah'); self.assertEqual(one['orders'][0]['status'], 'paid')
        self.assertEqual(one['visits'], 1)
        self.assertNotIn('password', json.dumps(one).lower())
        _, up, _ = self.call('GET', '/api/uploads?q=majalah')
        self.assertEqual(up['items'][0]['owner'], 'alice@example.com'); self.assertEqual(up['items'][0]['exports'][0]['kind'], 'html')
        _, v, _ = self.call('GET', '/api/visits?days=7')
        self.assertEqual(len(v['daily']), 7)
        self.assertEqual(v['referrers'], [{'name': 'www.google.com', 'views': 1}], 'own site is not a referrer')
        self.assertEqual({x['name'] for x in v['devices']}, {'desktop', 'mobile'})
        _, srv, _ = self.call('GET', '/api/server')
        self.assertTrue(srv['settings']['SUMOPOD_API_KEY'])
        self.assertNotIn('sk-should-never-show', json.dumps(srv))
        # Read-only: the admin panel never changes the member database.
        ro = admin_server.read_only(self.db)
        try:
            with self.assertRaises(sqlite3.OperationalError):
                ro.execute("UPDATE users SET plan='free'")
        finally:
            ro.close()
        self.assertEqual(self.call('POST', '/api/logout', {})[0], 200)
        self.assertEqual(self.call('GET', '/api/overview')[0], 401)

    def test_no_ip_stored(self):
        db = sqlite3.connect(Path(self.tmp.name) / 'visits.sqlite3')
        dump = '\n'.join(db.iterdump()); db.close()
        self.assertNotIn('1.2.3.4', dump); self.assertNotIn('Chrome/150', dump)


class GrantPlan(unittest.TestCase):
    def test_grant(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            store = accounts.Accounts(str(Path(tmp) / 'a.sqlite3'))
            store.register('m@example.com', 'secret-pass-1')
            now = int(time.time())
            u = store.grant_plan('M@example.com', 'business', None, now)
            self.assertEqual((u['plan'], u['planExpiresAt']), ('business', accounts.Accounts.LIFETIME))
            u = store.grant_plan('m@example.com', 'pro', 30, now)
            self.assertEqual(u['plan'], 'pro'); self.assertEqual(u['planExpiresAt'], now + 30 * 86400)
            u = store.grant_plan('m@example.com', 'pro', 10, now)
            self.assertEqual(u['planExpiresAt'], now + 40 * 86400, 'added after the running period')
            self.assertEqual(store.grant_plan('m@example.com', 'free', None, now)['plan'], 'free')
            with self.assertRaises(accounts.AccountError):
                store.grant_plan('nobody@example.com', 'pro', 30)
            with self.assertRaises(accounts.AccountError):
                store.grant_plan('m@example.com', 'gold', 30)


class SiteCountsVisits(unittest.TestCase):
    def test_page_view_counted(self):
        import server
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp, mock.patch.dict(os.environ, {'MYFLIPBOOK_DB': str(Path(tmp) / 'a.sqlite3')}):
            server.ACCOUNTS = server.LIBRARY = server.VISITS = None
            httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
            threading.Thread(target=httpd.serve_forever, daemon=True).start()
            try:
                for agent in ('Mozilla/5.0 Chrome/150', 'bingbot/2.0'):
                    conn = http.client.HTTPConnection('127.0.0.1', httpd.server_port, timeout=10)
                    conn.request('GET', '/privacy.html', headers={'User-Agent': agent}); conn.getresponse().read(); conn.close()
                db = sqlite3.connect(Path(tmp) / 'visits.sqlite3')
                rows = db.execute('SELECT path, device FROM visits').fetchall(); db.close()
                self.assertEqual(rows, [('/privacy.html', 'desktop')])
            finally:
                httpd.shutdown(); httpd.server_close(); server.ACCOUNTS = server.LIBRARY = server.VISITS = None


if __name__ == '__main__':
    unittest.main()
