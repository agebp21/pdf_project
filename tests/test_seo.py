"""Search pages (seo.py): Indonesian landing pages per tool, robots.txt,
sitemap.xml and the meta tags added to the app pages when served."""
import http.client
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import seo
import server


class SeoPages(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.env = mock.patch.dict(os.environ, {'MYFLIPBOOK_DB': str(Path(self.tmp.name) / 'a.sqlite3')})
        self.env.start()
        server.ACCOUNTS = server.LIBRARY = server.VISITS = None
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.env.stop()
        server.ACCOUNTS = server.LIBRARY = server.VISITS = None
        self.tmp.cleanup()

    def get(self, path, method='GET', body=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=10)
        conn.request(method, path, json.dumps(body) if body else None,
                     {'User-Agent': 'Mozilla/5.0 Chrome/150', 'Content-Type': 'application/json'})
        r = conn.getresponse(); data = r.read(); conn.close()
        return r.status, r.getheader('Content-Type'), data.decode('utf-8', 'replace')

    def test_landing_pages(self):
        tools = set(re.findall(r"id:'([a-z0-9-]+)'", (ROOT / 'converter.html').read_text(encoding='utf-8')))
        for slug, p in seo.LANDING.items():
            status, ctype, html = self.get('/' + slug)
            self.assertEqual(status, 200, slug); self.assertIn('text/html', ctype)
            self.assertIn('<html lang="id">', html)
            self.assertIn(f'<link rel="canonical" href="https://myflipbookpro.com/{slug}">', html)
            self.assertEqual(html.count('<h1>'), 1)
            self.assertLessEqual(len(p['description']), 260, slug)
            for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
                json.loads(block)
            target = p['link'].split('?')[0]
            self.assertIn(target, server.PAGES, slug)
            if '?tool=' in p['link']:
                self.assertIn(p['link'].split('=')[1], tools, slug)
            for other in p['related']:
                self.assertIn(other, seo.LANDING, slug)
        self.assertEqual(self.get('/kompres-pdf/x')[0], 404)
        self.assertEqual(self.get('/tidak-ada')[0], 404)

    def test_robots_and_sitemap(self):
        status, ctype, robots = self.get('/robots.txt')
        self.assertEqual(status, 200); self.assertIn('Disallow: /api/', robots)
        self.assertIn('Sitemap: https://myflipbookpro.com/sitemap.xml', robots)
        status, ctype, xml = self.get('/sitemap.xml')
        self.assertIn('xml', ctype)
        for slug in seo.LANDING:
            self.assertIn(f'<loc>https://myflipbookpro.com/{slug}</loc>', xml)
        self.assertNotIn('login.html', xml)

    def test_app_pages_get_tags(self):
        _, _, home = self.get('/')
        self.assertIn('<meta name="description"', home); self.assertIn('rel="canonical" href="https://myflipbookpro.com/"', home)
        self.assertIn('href="/kompres-pdf"', home, 'crawlable links to the landing pages')
        self.assertEqual(home.count('</head>'), 1)
        self.assertIn('<title data-i18n="meta.title">MyFlipbook — Buat Flipbook dari PDF', home)
        with mock.patch.dict(os.environ, {'GOOGLE_SITE_VERIFICATION': 'abc123'}):
            self.assertIn('<meta name="google-site-verification" content="abc123">', self.get('/')[2])
        _, _, login = self.get('/login.html')
        self.assertIn('<meta name="robots" content="noindex">', login)

    def test_security_headers(self):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=10)
        conn.request('GET', '/kompres-pdf'); r = conn.getresponse(); r.read(); conn.close()
        self.assertEqual(r.getheader('X-Frame-Options'), 'SAMEORIGIN')
        self.assertEqual(r.getheader('Referrer-Policy'), 'strict-origin-when-cross-origin')
        self.assertEqual(r.getheader('X-Content-Type-Options'), 'nosniff')

    def test_landing_visits_counted(self):
        self.assertEqual(self.get('/api/visit', 'POST', {'path': '/kompres-pdf'})[0], 204)
        db = sqlite3.connect(Path(self.tmp.name) / 'visits.sqlite3')
        self.assertEqual(db.execute('SELECT path FROM visits').fetchall(), [('/kompres-pdf',)]); db.close()


if __name__ == '__main__':
    unittest.main()
