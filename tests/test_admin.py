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
import admin_report
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
            db.execute("UPDATE users SET plan='medium', plan_expires_at=? WHERE id=?", (now + 86400 * 20, self.alice['id']))
            db.execute("INSERT INTO orders(id, user_id, plan, cycle, amount, status, provider, created_at, paid_at, currency) "
                       "VALUES('o1', ?, 'medium', 'monthly', 49000, 'paid', 'mock', ?, ?, 'IDR')", (self.alice['id'], now, now))
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

    def test_member_plan_filters(self):
        self.login()
        medium = self.call('GET', '/api/members?plan=medium')[1]
        self.assertEqual(medium['total'], 1)
        self.assertEqual(medium['items'][0]['email'], 'alice@example.com')
        self.assertEqual(self.call('GET', '/api/members?plan=medium&q=bob')[1]['total'], 0)
        self.assertEqual(self.call('GET', '/api/members?plan=basic')[1]['total'], 1)
        self.assertEqual(self.call('GET', '/api/members?plan=pro')[1]['total'], 0)
        with sqlite3.connect(self.db) as db:
            db.execute("UPDATE users SET plan_expires_at=1 WHERE id=?", (self.alice['id'],))
        self.assertEqual(self.call('GET', '/api/members?plan=medium')[1]['total'], 0)
        self.assertEqual(self.call('GET', '/api/members?plan=basic')[1]['total'], 2)

    def test_order_tracking(self):
        self.assertEqual(self.call('GET', '/api/orders')[0], 401)
        self.login()
        status, data, _ = self.call('GET', '/api/orders?q=alice&status=paid&audience=member')
        self.assertEqual(status, 200)
        self.assertEqual(data['total'], 1)
        self.assertEqual(data['items'][0]['email'], 'alice@example.com')
        self.assertEqual(data['items'][0]['amount'], 49000)
        self.assertFalse(data['items'][0]['tester'])
        self.assertEqual(self.call('GET', '/api/orders?status=pending')[1]['total'], 0)
        self.assertEqual(self.call('GET', '/api/orders?audience=tester')[1]['total'], 0)

    def test_monitoring_key(self):
        """A read-only key for another program (an AI agent, an audit script): numbers only, no personal data."""
        admin_server.KEY_HITS.clear()
        key = admin_server.new_key('audit-ai')
        self.assertTrue(key.startswith('mfa_') and len(key) > 40)
        stored = (Path(self.tmp.name) / 'admin-api-keys.json').read_text(encoding='utf-8')
        self.assertNotIn(key, stored, 'only the hash is kept')
        auth = {'Authorization': 'Bearer ' + key}
        status, data, _ = self.call('GET', '/api/overview', headers=auth)
        self.assertEqual(status, 200); self.assertEqual(data['members'], 2)
        status, data, _ = self.call('GET', '/api/visits?days=7', headers=auth)
        self.assertEqual(status, 200); self.assertTrue(data['recent'])
        self.assertTrue(all('user_id' not in r and 'member' not in r for r in data['recent']), 'no member ids or emails')
        self.assertNotIn('alice@example.com', json.dumps(data))
        status, data, _ = self.call('GET', '/api/server', headers=auth)
        self.assertEqual(status, 200); self.assertNotIn('sk-should-never-show', json.dumps(data))
        status, data, _ = self.call('GET', '/api/report.csv', headers=auth)
        self.assertEqual(status, 200); self.assertIn('tanggal,pengunjung', data)
        for path in ('/api/members', '/api/members/1', '/api/uploads', '/api/visitors', '/api/report.pdf'):
            self.assertEqual(self.call('GET', path, headers=auth)[0], 403, path + ': personal data stays behind the admin login')
        self.assertEqual(self.call('POST', '/api/visitors/label', {'key': 'x', 'kind': 'team'}, auth)[0], 401, 'a key cannot write')
        self.assertEqual(self.call('GET', '/api/overview', headers={'Authorization': 'Bearer mfa_wrong'})[0], 401)
        self.assertEqual(admin_server.load_keys()[admin_server.key_hash(key)]['uses'], 9, 'every request with the key is counted, refused ones too')
        for _ in range(admin_server.KEY_RATE):
            self.call('GET', '/api/server', headers=auth)
        self.assertEqual(self.call('GET', '/api/server', headers=auth)[0], 429, 'rate limited per key')
        self.assertTrue(admin_server.revoke_key('audit-ai'))
        admin_server.KEY_HITS.clear()
        self.assertEqual(self.call('GET', '/api/overview', headers=auth)[0], 401, 'a revoked key stops working')
        with self.assertRaises(ValueError):
            admin_server.new_key('bad name!')

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
        self.assertEqual(v['average'], 2.0, '2 visitors over the 1 day with data')
        self.assertEqual(sum(d['members'] for d in v['daily']), 2, 'new members per day')
        status, csv, _ = self.call('GET', '/api/report.csv?days=7')
        self.assertEqual(status, 200)
        self.assertTrue(csv.lstrip('﻿').startswith('tanggal,pengunjung,tampilan_halaman,member_baru'))
        # The team is left out: Alice (and her browser that day) disappear.
        with mock.patch.dict(os.environ, {'STATS_EXCLUDE_EMAILS': 'alice@example.com'}):
            _, t, _ = self.call('GET', '/api/visits?days=7')
        self.assertEqual((t['views'], t['visitors'], t['teamExcluded']), (1, 1, 1))
        self.assertEqual(sum(d['members'] for d in t['daily']), 1)
        self.assertEqual(v['referrers'], [{'name': 'www.google.com', 'views': 1}], 'own site is not a referrer')
        self.assertEqual({x['name'] for x in v['devices']}, {'desktop', 'mobile'})
        _, srv, _ = self.call('GET', '/api/server')
        self.assertTrue(srv['settings']['SUMOPOD_API_KEY'])
        self.assertNotIn('sk-should-never-show', json.dumps(srv))
        # Read-only: the admin panel never changes the member database.
        ro = admin_server.read_only(self.db)
        try:
            with self.assertRaises(sqlite3.OperationalError):
                ro.execute("UPDATE users SET plan='basic'")
        finally:
            ro.close()
        self.assertEqual(self.call('POST', '/api/logout', {})[0], 200)
        self.assertEqual(self.call('GET', '/api/overview')[0], 401)

    def test_pdf_report(self):
        self.assertEqual(self.call('GET', '/api/report.pdf?days=7')[0], 401, 'admin only')
        self.login()
        status, body, _ = self.call('GET', '/api/report.pdf?days=7')
        self.assertEqual(status, 200)
        self.assertTrue(body.startswith('%PDF-1.4'))
        pdf = admin_server.report_pdf(7)
        self.assertTrue(pdf.rstrip().endswith(b'%%EOF')); self.assertIn(b'/Type /Pages', pdf)
        import zlib, re
        text = b''.join(zlib.decompress(m) for m in re.findall(rb'stream\n(.*?)\nendstream', pdf, re.S)).decode('latin-1')
        for expected in ('Laporan MyFlipbook Pro', 'Ringkasan', 'Rp 49.000', 'a***@example.com', 'Status server'):
            self.assertIn(expected, text)
        self.assertNotIn('alice@example.com', text, 'emails are masked in the report')
        self.assertNotIn('sk-should-never-show', text, 'setting values never appear')
        self.assertEqual(admin_report.mask_email('budi@gmail.com'), 'b***@gmail.com')

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
            u = store.grant_plan('M@example.com', 'pro', None, now)
            self.assertEqual((u['plan'], u['planExpiresAt']), ('pro', accounts.Accounts.LIFETIME))
            u = store.grant_plan('m@example.com', 'medium', 30, now)
            self.assertEqual(u['plan'], 'medium'); self.assertEqual(u['planExpiresAt'], now + 30 * 86400)
            u = store.grant_plan('m@example.com', 'medium', 10, now)
            self.assertEqual(u['planExpiresAt'], now + 40 * 86400, 'added after the running period')
            self.assertEqual(store.grant_plan('m@example.com', 'basic', None, now)['plan'], 'basic')
            with self.assertRaises(accounts.AccountError):
                store.grant_plan('nobody@example.com', 'medium', 30)
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
                def send(method, path, agent, body=None):
                    conn = http.client.HTTPConnection('127.0.0.1', httpd.server_port, timeout=10)
                    conn.request(method, path, json.dumps(body) if body else None,
                                 {'User-Agent': agent, 'Host': f'127.0.0.1:{httpd.server_port}', 'Content-Type': 'application/json'})
                    r = conn.getresponse(); r.read(); conn.close(); return r.status
                send('GET', '/privacy.html', 'Mozilla/5.0 Chrome/150')                 # loading a page counts nothing by itself
                self.assertEqual(send('POST', '/api/visit', 'Mozilla/5.0 Chrome/150', {'path': '/privacy.html'}), 204)
                send('POST', '/api/visit', 'Mozilla/5.0 Chrome/150', {'path': '/privacy.html'})      # a reload within a minute
                send('POST', '/api/visit', 'bingbot/2.0', {'path': '/index.html'})
                send('POST', '/api/visit', 'Mozilla/5.0 Chrome/150', {'path': '/secret.php'})
                db = sqlite3.connect(Path(tmp) / 'visits.sqlite3')
                rows = db.execute('SELECT path, device FROM visits').fetchall(); db.close()
                self.assertEqual(rows, [('/privacy.html', 'desktop')])
            finally:
                httpd.shutdown(); httpd.server_close(); server.ACCOUNTS = server.LIBRARY = server.VISITS = None


if __name__ == '__main__':
    unittest.main()
