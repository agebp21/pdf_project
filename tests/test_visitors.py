"""Admin visitor list (visits.visitors + /api/visitors): one row per visitor per
day with a verdict — person, team, machine, unsure — and the reason; admin
labels correct it; team browsers (cookie mf_team=1) and data-centre networks
stay out of the numbers. No IP is stored for any of it."""
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
import server
import visits

CHROME = 'Mozilla/5.0 (Windows NT 10.0) Chrome/150'


class VisitorList(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.dir = Path(self.tmp.name)
        store = accounts.Accounts(str(self.dir / 'myflipbook.sqlite3'))
        self.team = store.user_for(store.register('tim@example.com', 'secret-pass-1'))
        self.member = store.user_for(store.register('member@example.com', 'secret-pass-2'))
        v = visits.Visits(self.dir / 'visits.sqlite3')
        now = self.now = int(time.time())
        office = {'country': 'Indonesia', 'region': 'Jakarta', 'city': 'Utan', 'isp': 'BIZNET NETWORKS'}
        v.record('/index.html', '1.1.1.1', CHROME, '', None, now=now - 600, place=office, kind='team')        # team browser
        v.record('/library.html', '1.1.1.1', CHROME, '', None, now=now - 300, place=office, kind='team')
        v.record('/library.html', '2.2.2.2', CHROME, '', None, now=now - 290,                               # same page, same minute
                 place={'country': 'Indonesia', 'city': 'Jakarta', 'isp': 'Telekomunikasi Indonesia'})
        v.record('/index.html', '3.3.3.3', 'Mozilla/5.0 (X11; Linux) Chrome/125', '', None, now=now - 200,
                 place={'country': 'United States', 'city': 'Council Bluffs', 'isp': 'Google LLC'})
        v.record('/journals.html', '4.4.4.4', 'Mozilla/5.0 (Linux; Android 10) Mobile Chrome/154', 'https://www.google.com/', None,
                 now=now - 100, place={'country': 'Indonesia', 'region': 'East Java', 'city': 'Kediri', 'isp': 'IAIN Kediri'})
        v.record('/flipbook.html', '5.5.5.5', CHROME, '', self.member['id'], now=now - 50, place={'country': 'Indonesia', 'city': 'Malang'})
        v.record('/account.html', '6.6.6.6', CHROME, '', self.team['id'], now=now - 40, place={'country': 'Indonesia'})  # logs in as team
        self.env = mock.patch.dict(os.environ, {'MYFLIPBOOK_DB': str(self.dir / 'myflipbook.sqlite3'), 'ADMIN_USERNAME': 'boss',
                                                'ADMIN_PASSWORD_HASH': accounts.hash_password('very-long-admin-pass'),
                                                'STATS_EXCLUDE_EMAILS': 'tim@example.com'})
        self.env.start()
        admin_server.SESSIONS.clear(); admin_server.FAILURES.clear()
        self.httpd = admin_server.ThreadingHTTPServer(('127.0.0.1', 0), admin_server.AdminHandler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.cookie = ''

    def tearDown(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.env.stop(); self.tmp.cleanup()

    def call(self, method, path, body=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=10)
        h = {'Cookie': self.cookie} if self.cookie else {}
        if body is not None:
            h.update({'Content-Type': 'application/json', 'X-Admin': '1'})
        conn.request(method, path, json.dumps(body) if body is not None else None, h)
        r = conn.getresponse(); data = r.read(); cookie = r.getheader('Set-Cookie'); conn.close()
        return r.status, json.loads(data or b'{}'), cookie

    def login(self):
        status, _, cookie = self.call('POST', '/api/login', {'username': 'boss', 'password': 'very-long-admin-pass'})
        self.assertEqual(status, 200); self.cookie = cookie.split(';')[0]

    def by_city(self, items):
        return {(v['city'] or v['country']): v for v in items}

    def test_verdicts_and_numbers(self):
        self.assertEqual(self.call('GET', '/api/visitors')[0], 401)
        self.assertEqual(self.call('POST', '/api/visitors/label', {'key': 'x', 'kind': 'team'})[0], 401)
        self.login()
        status, d, _ = self.call('GET', '/api/visitors?days=7')
        self.assertEqual(status, 200)
        v = self.by_city(d['items'])
        self.assertEqual(v['Utan']['status'], 'team'); self.assertIn('Browser tim', v['Utan']['reason'])
        self.assertEqual(v['Utan']['pages'], ['/index.html', '/library.html']); self.assertEqual(v['Utan']['views'], 2)
        self.assertEqual(v['Council Bluffs']['status'], 'bot'); self.assertIn('Google LLC', v['Council Bluffs']['reason'])
        self.assertEqual(v['Jakarta']['status'], 'unsure')
        self.assertEqual(v['Kediri']['status'], 'human'); self.assertEqual(v['Kediri']['ref'], 'www.google.com')
        self.assertEqual(v['Malang']['status'], 'human'); self.assertEqual(v['Malang']['members'], ['member@example.com'])
        self.assertEqual(v['Indonesia']['status'], 'team'); self.assertIn('akun tim', v['Indonesia']['reason'])
        self.assertEqual(d['counts'], {'team': 2, 'unsure': 1, 'bot': 1, 'human': 2})
        # Numbers: team browsers, team accounts and machines are out; the unsure one is still counted.
        _, stats, _ = self.call('GET', '/api/visits?days=7')
        self.assertEqual(stats['visitors'], 3)
        # The admin marks the unsure visitor as team: it leaves the numbers too.
        key = v['Jakarta']['key']
        self.assertEqual(self.call('POST', '/api/visitors/label', {'key': key, 'kind': 'team'})[0], 200)
        _, d, _ = self.call('GET', '/api/visitors?days=7')
        self.assertEqual(self.by_city(d['items'])['Jakarta']['status'], 'team')
        self.assertEqual(self.by_city(d['items'])['Jakarta']['reason'], 'Ditandai admin')
        self.assertEqual(self.call('GET', '/api/visits?days=7')[1]['visitors'], 2)
        # A machine marked as a person comes back into the numbers; clearing undoes it.
        bot = self.by_city(d['items'])['Council Bluffs']['key']
        self.call('POST', '/api/visitors/label', {'key': bot, 'kind': 'human'})
        self.assertEqual(self.call('GET', '/api/visits?days=7')[1]['visitors'], 3)
        self.call('POST', '/api/visitors/label', {'key': bot, 'kind': ''})
        self.assertEqual(self.call('GET', '/api/visits?days=7')[1]['visitors'], 2)
        self.assertEqual(self.call('POST', '/api/visitors/label', {'key': "x' OR 1=1", 'kind': 'team'})[0], 400)
        self.assertEqual(self.call('POST', '/api/visitors/label', {'key': key, 'kind': 'boss'})[0], 400)
        # Nothing about the IPs anywhere.
        db = sqlite3.connect(self.dir / 'visits.sqlite3'); dump = '\n'.join(db.iterdump()); db.close()
        for ip in ('1.1.1.1', '2.2.2.2', '4.4.4.4'):
            self.assertNotIn(ip, dump)


class TeamCookie(unittest.TestCase):
    def test_team_browser_and_datacenter_tagged(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp, \
                mock.patch.dict(os.environ, {'MYFLIPBOOK_DB': str(Path(tmp) / 'a.sqlite3')}), \
                mock.patch.object(server.geo, 'lookup', lambda ip: {'country': 'United States', 'isp': 'Amazon.com, Inc.'} if ip == '9.9.9.9' else None):
            server.ACCOUNTS = server.LIBRARY = server.VISITS = None
            httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
            threading.Thread(target=httpd.serve_forever, daemon=True).start()
            try:
                def visit(path, cookie='', ip=None):
                    conn = http.client.HTTPConnection('127.0.0.1', httpd.server_port, timeout=10)
                    headers = {'User-Agent': CHROME, 'Content-Type': 'application/json', 'Cookie': cookie}
                    conn.request('POST', '/api/visit', json.dumps({'path': path}), headers)
                    r = conn.getresponse(); r.read(); conn.close(); return r.status
                self.assertEqual(visit('/index.html', 'mf_lang=id; mf_team=1'), 204)
                visit('/privacy.html')
                with mock.patch.object(server.Handler, 'client_ip', lambda self: '9.9.9.9'):
                    visit('/terms.html')
                db = sqlite3.connect(Path(tmp) / 'visits.sqlite3')
                rows = db.execute('SELECT path, kind FROM visits ORDER BY ts, rowid').fetchall(); db.close()
                self.assertEqual(rows, [('/index.html', 'team'), ('/privacy.html', ''), ('/terms.html', 'bot')])
            finally:
                httpd.shutdown(); httpd.server_close(); server.ACCOUNTS = server.LIBRARY = server.VISITS = None


if __name__ == '__main__':
    unittest.main()
