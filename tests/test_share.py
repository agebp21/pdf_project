"""Public share links: Pro/Business upload the sealed HTML export, anyone
with /s/<id> reads the book in a browser, ?dl=1 downloads it for keeping."""
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
import server
import share


def sealed(title='Buku Coba'):
    return ('<!DOCTYPE html><html><head><title>' + title + '</title></head><body>'
            '<script type="application/json" id="book-payload">{"v":1}</script></body></html>').encode()


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


class ShareTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.previous = (server.ACCOUNTS, server.LIBRARY, server.SHARE, server.CONFIG['paywall'])
        server.ACCOUNTS = accounts.Accounts(Path(cls.temporary.name) / 'accounts.db')
        server.LIBRARY = None
        server.SHARE = None
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
        server.ACCOUNTS, server.LIBRARY, server.SHARE = cls.previous[:3]
        server.CONFIG['paywall'] = cls.previous[3]
        cls.temporary.cleanup()

    def member(self, email, plan=None):
        member = Member(self.base)
        self.assertEqual(member.json('POST', '/api/auth/register', {'email': email, 'password': 'rahasia-123'})[0], 201)
        if plan:
            server.ACCOUNTS.grant_plan(email, plan, None)
        return member

    def upload(self, member, data, title='Buku Coba'):
        return member.json('POST', '/api/share', data, 'text/html',
                           {'X-Build-Token': server.TOKEN, 'X-Title': urllib.parse.quote(title)})

    def backdate(self, email, days):
        with server.ACCOUNTS.connect() as db:
            db.execute('UPDATE users SET created_at=? WHERE email=?',
                       (int(time.time()) - days * 86400, email))

    def test_gates(self):
        guest = Member(self.base)
        self.assertEqual(guest.json('POST', '/api/share', sealed(), 'text/html',
                                   {'X-Build-Token': server.TOKEN})[0], 401, 'login first')
        free = self.member('free@s.co')
        status, body = self.upload(free, sealed())
        self.assertEqual(status, 200, 'free taster: first shares go through')
        self.assertEqual(body['freeLeft'], 2)
        pro = self.member('pro@s.co', 'pro')
        status, _, raw = pro.call('POST', '/api/share', sealed(), 'text/html', {'X-Title': 'x'})
        self.assertEqual(status, 403, 'build token still required')

    def test_free_three_then_pro(self):
        free = self.member('tiga@s.co')
        for n in range(3):
            status, body = self.upload(free, sealed(), f'Buku {n}')
            self.assertEqual(status, 200, f'share {n + 1} of 3')
        self.assertEqual(body['freeLeft'], 0)
        status, body = self.upload(free, sealed(), 'Buku 4')
        self.assertEqual(status, 402, 'fourth share needs Pro')
        self.assertIn('3 share', body['error'])
        # Old free accounts (trial over) cannot publish at all.
        old = self.member('lawas@s.co')
        self.backdate('lawas@s.co', 9)
        status, body = self.upload(old, sealed())
        self.assertEqual(status, 402)
        self.assertIn('7 hari', body['error'])

    def test_publish_read_download_delete(self):
        pro = self.member('pub@s.co', 'pro')
        status, body = self.upload(pro, sealed('Kisah Kami'), 'Kisah Kami')
        self.assertEqual(status, 200)
        link = body['url']
        self.assertRegex(link, r'^/s/[0-9a-f]{32}$')
        self.assertEqual(body['title'], 'Kisah Kami')
        # Public read: the book plays (payload present) with a download button.
        status, headers, raw = pro.call('GET', link)
        self.assertEqual(status, 200)
        self.assertIn('text/html', headers['Content-Type'])
        self.assertIn(b'book-payload', raw)
        self.assertIn(b'?dl=1', raw, 'download button injected')
        self.assertIn('immutable', headers['Cache-Control'])
        # ?dl=1 downloads the same book for keeping.
        status, headers, raw = pro.call('GET', link + '?dl=1')
        self.assertEqual(status, 200)
        self.assertIn('attachment', headers['Content-Disposition'])
        self.assertIn('Kisah Kami.html', urllib.parse.unquote(headers['Content-Disposition']))
        self.assertIn(b'book-payload', raw)
        self.assertNotIn(b'?dl=1', raw, 'downloaded file is the clean book')
        # No login needed to read; strangers cannot delete.
        self.assertEqual(Member(self.base).call('GET', link)[0], 200)
        other = self.member('other@s.co', 'pro')
        self.assertEqual(other.json('POST', f"/api/share/{body['id']}/delete", {})[0], 404)
        self.assertEqual(pro.json('POST', f"/api/share/{body['id']}/delete", {})[0], 200)
        self.assertEqual(pro.call('GET', link)[0], 404, 'gone after delete')

    def test_rejects_non_books(self):
        pro = self.member('pick@s.co', 'pro')
        self.assertEqual(self.upload(pro, b'<html><body>hello</body></html>')[0], 400, 'no payload marker')
        self.assertEqual(self.upload(pro, b'{"v":1,"book-payload":true}')[0], 400, 'not an html page')
        self.assertEqual(self.upload(pro, b'')[0], 413, 'empty upload refused')

    def test_quota(self):
        pro = self.member('quota@s.co', 'pro')
        for _ in range(share.SHARE_LIMITS['pro'][0]):
            self.assertEqual(self.upload(pro, sealed())[0], 200)
        self.assertEqual(self.upload(pro, sealed())[0], 402, '20 links is enough for pro')
        status, body = pro.json('GET', '/api/share')
        self.assertEqual(status, 200)
        self.assertEqual(len(body['links']), share.SHARE_LIMITS['pro'][0])
        self.assertEqual(body['usage']['plan'], 'pro')

    def test_english_errors(self):
        pro = self.member('en@s.co', 'pro')
        status, headers, raw = pro.call('GET', '/s/' + '0' * 32)
        self.assertEqual(status, 404)
        req = urllib.request.Request(self.base + '/s/' + '0' * 32, headers={'Cookie': 'mf_lang=en'})
        try:
            urllib.request.build_opener().open(req)
        except urllib.error.HTTPError as error:
            with error:
                self.assertEqual(json.loads(error.read())['error'], 'Share link not found.')


if __name__ == '__main__':
    unittest.main()
