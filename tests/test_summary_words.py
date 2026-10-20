"""The monthly summary allowance (owner, 2026-10-20): Medium 35.000 / Pro 60.000 words of AI
summaries per calendar month (Jakarta time) — our own usage guide: not on the price list, the
FAQ or the account page (the admin sees it); used up -> 429 saying when it refills, with the
way to upgrade."""
import calendar
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
import accounts
import admin_server
import messages_en
import seo
import server

HOST = 'words.myflipbook.local'


class Numbers(unittest.TestCase):
    def test_the_numbers_stay_ours(self):
        self.assertEqual((accounts.SUMMARY_WORDS['medium'], accounts.SUMMARY_WORDS['pro']), (35_000, 60_000))
        page = seo.harga_html()
        page = page.decode('utf-8') if isinstance(page, bytes) else page
        listed = ' '.join(f for p in accounts.PLANS.values() for f in p['features']['id'] + p['features']['en'])
        for text in (page, listed):
            self.assertNotIn('35.000', text); self.assertNotIn('60.000', text); self.assertNotIn('kata/bulan', text)

    def test_month_bounds_in_jakarta_time(self):
        # 31 Dec 2026 20:00 UTC is already 1 Jan 2027 in Jakarta
        now = calendar.timegm((2026, 12, 31, 20, 0, 0))
        start, end = accounts.month_bounds(now)
        self.assertEqual(start, calendar.timegm((2027, 1, 1, 0, 0, 0)) - 7 * 3600)
        self.assertEqual(end, calendar.timegm((2027, 2, 1, 0, 0, 0)) - 7 * 3600)
        start, end = accounts.month_bounds(calendar.timegm((2026, 12, 10, 0, 0, 0)))
        self.assertEqual(end, calendar.timegm((2027, 1, 1, 0, 0, 0)) - 7 * 3600)

    def test_english_message(self):
        self.assertEqual(messages_en.english('Kuota ringkasan bulan ini sudah habis — terisi lagi 1 November 2026. Upgrade ke Pro untuk kuota yang lebih besar.'),
                         "This month's summary allowance is used up — it refills on November 1, 2026. Upgrade to Pro for a bigger allowance.")
        self.assertEqual(messages_en.english('Kuota ringkasan bulan ini sudah habis — terisi lagi 1 Desember 2026.'),
                         "This month's summary allowance is used up — it refills on December 1, 2026.")


class Allowance(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.env = mock.patch.dict(os.environ, {'MYFLIPBOOK_DB': str(Path(self.tmp.name) / 'a.sqlite3'), 'BUILD_WORKER_KEY': 'k'})
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
        h = {'Host': HOST, 'Cookie': self.cookie, 'X-Real-IP': '10.0.0.2'}
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

    def test_month(self):
        self.assertEqual(self.call('POST', '/api/auth/register', {'email': 'w@example.com', 'password': 'secret-pass-1'})[0], 201)
        with server.get_accounts().connect() as db:
            db.execute("UPDATE users SET plan='medium', plan_expires_at=? WHERE email='w@example.com'", (int(time.time()) + 30 * 86400,))
            uid = db.execute("SELECT id FROM users WHERE email='w@example.com'").fetchone()[0]
        store = server.get_accounts()
        used = lambda: store.usage_in(uid, 'summary_words', accounts.month_bounds()[0] - 1)[0]
        token = self.call('GET', '/api/capabilities')[1]['token']
        summarize = lambda: self.call('POST', '/api/summary', {'title': 'B', 'text': {'0': [' '.join(['kata'] * 60)]}}, {'X-Build-Token': token})
        words = ' '.join(['ringkas'] * 1200)
        with mock.patch.object(server, 'summarize_book', return_value=dict(lang='id-ID', text=words, model='m', parts=0)):
            self.assertEqual(summarize()[0], 200)
            self.assertEqual(used(), 1200, "the summary's words are counted")
            self.assertNotIn('summaryWords', self.call('GET', '/api/auth/usage')[1], 'not shown to the member')
            # the month is used up: the next summary is refused, saying when it comes back and where to upgrade
            store.spend(uid, 'summary_words', 33_800)
            status, body = summarize()
            self.assertEqual(status, 429)
            self.assertRegex(body['error'], r'^Kuota ringkasan bulan ini sudah habis — terisi lagi 1 \w+ \d{4}\. Upgrade ke Pro untuk kuota yang lebih besar\.$')
            self.assertNotIn('35', body['error']); self.assertEqual(body['upgrade'], '/harga')
            # last month's words do not count
            with store.connect() as db:
                db.execute("UPDATE usage SET at=? WHERE kind='summary_words'", (accounts.month_bounds()[0] - 3600,))
            self.assertEqual(summarize()[0], 200)
            # Pro: 60.000, and nothing higher to offer
            with store.connect() as db:
                db.execute("UPDATE users SET plan='pro' WHERE id=?", (uid,))
            store.spend(uid, 'summary_words', 60_000)
            status, body = summarize()
            self.assertEqual(status, 429); self.assertNotIn('Upgrade', body['error']); self.assertNotIn('upgrade', body)
        # the admin sees the numbers
        with mock.patch.object(admin_server, 'db_path', return_value=Path(self.tmp.name) / 'a.sqlite3'):
            m = admin_server.member(uid)
        self.assertEqual((m['summaryWords']['used'], m['summaryWords']['limit']), (61_200, 60_000))


if __name__ == '__main__':
    unittest.main()
