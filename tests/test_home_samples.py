"""Homepage PDF samples keep the uploaded PDF private and serve rendered pages."""
import io
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen

import home_samples


class HomeSamplesTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.override = patch.dict(os.environ, {'HOME_SAMPLES_DIR': self.folder.name})
        self.override.start()

    def tearDown(self):
        self.override.stop()
        self.folder.cleanup()

    def pdf(self, pages=3):
        import pymupdf
        document = pymupdf.open()
        for i in range(pages):
            page = document.new_page(width=360, height=500)
            page.insert_text((30, 60), f'Contoh halaman {i + 1}')
        result = document.tobytes()
        document.close()
        return result

    def test_upload_replace_add_and_remove(self):
        first = self.pdf()
        initial = home_samples.upload(io.BytesIO(first), len(first), 'Katalog furnitur', 'interior')
        self.assertEqual(home_samples.public_samples()[0]['pages'], 3)
        self.assertTrue(home_samples.page_file(initial['id'], 2).read_bytes().startswith(b'RIFF'))
        self.assertIsNone(home_samples.page_file(initial['id'], 4))
        second = self.pdf(2)
        replacement = home_samples.upload(io.BytesIO(second), len(second), 'Katalog baru', 'interior')
        self.assertNotEqual(initial['id'], replacement['id'])
        self.assertIsNone(home_samples.page_file(initial['id'], 1))
        extra = home_samples.upload(io.BytesIO(first), len(first), 'Buku tambahan')
        self.assertEqual(len(home_samples.public_samples()), 2)
        self.assertTrue(any(row['slot'] == extra['slot'] for row in home_samples.admin_samples()))
        extra = home_samples.upload(io.BytesIO(second), len(second), 'Buku tambahan baru', extra['slot'])
        self.assertEqual(extra['pages'], 2)
        home_samples.remove(extra['slot'])
        self.assertEqual(len(home_samples.public_samples()), 1)
        home_samples.remove('interior')
        self.assertEqual(home_samples.public_samples(), [])

    def test_invalid_pdf_does_not_publish(self):
        with self.assertRaises(ValueError):
            home_samples.upload(io.BytesIO(b'hello'), 5, 'Invalid')
        self.assertEqual(home_samples.public_samples(), [])
        with self.assertRaises(ValueError):
            home_samples.upload(io.BytesIO(b''), 0, 'Kosong')
        with self.assertRaises(ValueError):
            home_samples.upload(io.BytesIO(b'%PDF-not-valid'), 14, 'Rusak')

    def test_rename_builtin_and_uploaded_without_reupload(self):
        home_samples.rename('magazine', 'Katalog Menu Baru', 'New Menu Catalog')
        self.assertEqual(home_samples.labels()['magazine'], {'id': 'Katalog Menu Baru', 'en': 'New Menu Catalog'})
        self.assertEqual(next(row for row in home_samples.admin_samples() if row['slot'] == 'magazine')['title'], 'Katalog Menu Baru')
        self.assertEqual(next(row for row in home_samples.admin_samples() if row['slot'] == 'magazine')['titleEn'], 'New Menu Catalog')
        pdf = self.pdf()
        item = home_samples.upload(io.BytesIO(pdf), len(pdf), 'Contoh awal')
        home_samples.rename(item['slot'], 'Contoh setelah edit', 'Edited sample')
        self.assertEqual(home_samples.public_samples()[0]['title'], 'Contoh setelah edit')
        self.assertEqual(home_samples.public_samples()[0]['titleEn'], 'Edited sample')
        self.assertEqual(home_samples.public_samples()[0]['id'], item['id'])
        with self.assertRaises(ValueError):
            home_samples.rename('tidak-ada', 'Salah')

    def test_admin_upload_and_public_preview_routes(self):
        import admin_server
        import server
        old = admin_server.CONFIG.copy()
        admin_server.CONFIG['local_no_login'] = True
        admin_server.CONFIG['proxy'] = False
        admin = ThreadingHTTPServer(('127.0.0.1', 0), admin_server.AdminHandler)
        public = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        workers = [threading.Thread(target=host.serve_forever, daemon=True) for host in (admin, public)]
        for worker in workers:
            worker.start()
        try:
            pdf = self.pdf(2)
            request = Request(f'http://127.0.0.1:{admin.server_port}/api/home-samples/upload?slot=travel&title=Buku%20uji',
                              data=pdf, headers={'Content-Type': 'application/pdf', 'X-Admin': '1'}, method='POST')
            with urlopen(request) as response:
                self.assertEqual(response.status, 200)
            with urlopen(f'http://127.0.0.1:{public.server_port}/api/home-samples') as response:
                import json
                item = json.load(response)['items'][0]
            self.assertEqual(item['slot'], 'travel')
            with urlopen(f'http://127.0.0.1:{public.server_port}{item["pageBase"]}2.webp') as response:
                self.assertEqual(response.headers['Content-Type'], 'image/webp')
                self.assertTrue(response.read().startswith(b'RIFF'))
            from urllib.error import HTTPError
            with self.assertRaises(HTTPError) as blocked:
                urlopen(f'http://127.0.0.1:{public.server_port}/.data/home-samples/{item["id"]}/source.pdf')
            self.assertEqual(blocked.exception.code, 404)
            blocked.exception.close()
            request = Request(f'http://127.0.0.1:{admin.server_port}/api/home-samples/rename',
                              data=json.dumps({'slot':'travel','title':'Buku Pilihan','titleEn':'Selected Book'}).encode(),
                              headers={'Content-Type':'application/json','X-Admin':'1'}, method='POST')
            with urlopen(request) as response:
                self.assertEqual(response.status, 200)
            with urlopen(f'http://127.0.0.1:{public.server_port}/api/home-samples') as response:
                self.assertEqual(json.load(response)['labels']['travel'], {'id':'Buku Pilihan','en':'Selected Book'})
        finally:
            for host in (admin, public):
                host.shutdown()
                host.server_close()
            for worker in workers:
                worker.join(timeout=2)
            admin_server.CONFIG.clear()
            admin_server.CONFIG.update(old)


if __name__ == '__main__':
    unittest.main()
