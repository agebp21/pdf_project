"""Referrals: a member's link (?ref=CODE, kept in cookie mf_ref) ties brand-new
accounts to them; every 10 of those friends who pay for Pro or Business give
the member 30 days (of their running paid plan, else Pro), once each."""
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


class ReferralTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.store = accounts.Accounts(str(Path(self.tmp.name) / 'a.sqlite3'))
        self.n = 0

    def tearDown(self):
        self.tmp.cleanup()

    def member(self, email=None):
        self.n += 1
        return self.store.user_for(self.store.register(email or f'u{self.n}@example.com', 'secret-pass-1'))['id']

    def pay(self, user_id, plan='pro', status='paid'):
        order_id = f'o{user_id}-{time.time_ns()}'
        with self.store.connect() as db:
            db.execute("INSERT INTO orders(id, user_id, plan, cycle, amount, status, provider, created_at) VALUES(?,?,?,?,?,?,?,?)",
                       (order_id, user_id, plan, 'monthly', 99000, 'pending', 'mock', int(time.time())))
        if status == 'paid':
            self.store.mark_paid(order_id)

    def friend(self, code):
        uid = self.member()
        self.assertTrue(self.store.attach_referrer(uid, code))
        return uid

    def plan(self, uid):
        with self.store.connect() as db:
            r = db.execute('SELECT plan, plan_expires_at FROM users WHERE id=?', (uid,)).fetchone()
        return r['plan'], r['plan_expires_at']

    def test_code_and_attach_rules(self):
        owner = self.member('owner@example.com')
        code = self.store.referral_code(owner)
        self.assertRegex(code, r'^[A-Z2-9]{7}$')
        self.assertEqual(self.store.referral_code(owner), code, 'same code every time')
        self.assertFalse(self.store.attach_referrer(owner, code), 'not yourself')
        f = self.member()
        self.assertTrue(self.store.attach_referrer(f, code.lower()))
        self.assertFalse(self.store.attach_referrer(f, code), 'only once')
        old = self.member()
        self.assertFalse(self.store.attach_referrer(old, code, now=time.time() + 3600), 'not an older account')
        self.assertFalse(self.store.attach_referrer(self.member(), 'NOPE123'))

    def test_every_member_has_a_code(self):
        a = self.member()
        b, _ = self.store.register_unverified('new@example.com', 'secret-pass-1')
        c = self.store.user_for(self.store.google_login('g-1', 'g@example.com'))['id']
        with self.store.connect() as db:
            db.execute("INSERT INTO users(email, name, password_hash, created_at) VALUES('old@example.com', '', 'x', 1)")
            codes = dict(db.execute('SELECT id, ref_code FROM users').fetchall())
        self.assertTrue(all(codes[i] for i in (a, b, c)), 'email, unverified and Google sign-ups')
        self.assertEqual(len({codes[i] for i in (a, b, c)}), 3)
        accounts.Accounts(str(Path(self.tmp.name) / 'a.sqlite3'))      # restart: older accounts get one
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM users WHERE ref_code IS NULL').fetchone()[0], 0)

    def test_every_ten_paying_friends(self):
        owner = self.member('owner@example.com')
        code = self.store.referral_code(owner)
        friends = [self.friend(code) for _ in range(12)]
        for f in friends[:9]:
            self.pay(f)
        self.pay(friends[9], status='pending')                  # not paid: does not count
        self.pay(friends[0])                                     # paying twice counts once
        self.assertEqual(self.store.referral_stats(owner)['subscribed'], 9)
        self.assertEqual(self.plan(owner)[0], 'free')
        self.pay(friends[10], plan='business')                   # Business counts too
        plan, until = self.plan(owner)
        self.assertEqual(plan, 'pro'); self.assertAlmostEqual(until, time.time() + 30 * 86400, delta=60)
        stats = self.store.referral_stats(owner)
        self.assertEqual((stats['subscribed'], stats['rewards'], stats['toNext'], stats['signups']), (10, 1, 10, 12))
        # A member on Business gets 30 more days of Business at the next ten.
        with self.store.connect() as db:
            db.execute("UPDATE users SET plan='business', plan_expires_at=? WHERE id=?", (int(time.time()) + 86400, owner))
        more = [self.friend(code) for _ in range(10)]
        for f in more:
            self.pay(f)
        plan, until = self.plan(owner)
        self.assertEqual(plan, 'business'); self.assertAlmostEqual(until, time.time() + 31 * 86400, delta=60)
        self.assertEqual(self.store.referral_stats(owner)['rewards'], 2)


class ReferralHttp(unittest.TestCase):
    def test_link_cookie_signup(self):
        import server
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp, \
                mock.patch.dict(os.environ, {'MYFLIPBOOK_DB': str(Path(tmp) / 'a.sqlite3')}):
            server.ACCOUNTS = server.LIBRARY = server.VISITS = None
            httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
            threading.Thread(target=httpd.serve_forever, daemon=True).start()
            port = httpd.server_port

            def call(method, path, body=None, cookie=''):
                conn = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
                headers = {'Content-Type': 'application/json', 'Cookie': cookie}
                conn.request(method, path, json.dumps(body) if body is not None else None, headers)
                r = conn.getresponse(); data = json.loads(r.read() or b'{}'); set_cookie = r.getheader('Set-Cookie'); conn.close()
                return r.status, data, (set_cookie or '').split(';')[0]
            try:
                _, _, owner = call('POST', '/api/auth/register', {'email': 'owner@example.com', 'password': 'secret-pass-1'})
                status, ref, _ = call('GET', '/api/auth/referral', cookie=owner)
                self.assertEqual(status, 200); self.assertTrue(ref['link'].endswith('/?ref=' + ref['code']))
                self.assertEqual(call('GET', '/api/auth/referral')[0], 401)
                call('POST', '/api/auth/register', {'email': 'friend@example.com', 'password': 'secret-pass-1'}, cookie='mf_ref=' + ref['code'])
                self.assertEqual(call('GET', '/api/auth/referral', cookie=owner)[1]['signups'], 1)
            finally:
                httpd.shutdown(); httpd.server_close(); server.ACCOUNTS = server.LIBRARY = server.VISITS = None


if __name__ == '__main__':
    unittest.main()
