import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import zipfile
import threading
import urllib.request
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class BuildTests(unittest.TestCase):
    def manifest(self):
        return dict(version=1, title='Book </script>', pageCount=1, ratio=.75,
                    overlays={'0': dict(label='A < B', value=12, position='top-left')})

    def archive(self, metadata, image=b'\xff\xd8\xff\xe0fixture'):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as package:
            package.writestr('book.json', json.dumps(metadata))
            package.writestr('pages/1.jpg', image)
            package.writestr('../escape.txt', 'no')
            package.writestr('viewer.js', 'malicious-client-code')
        output.seek(0)
        return output

    def test_untrusted_scripts_and_paths_are_not_extracted(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / 'book'
            data = server.unpack_book(self.archive(self.manifest()), destination)
            self.assertEqual(data['pageCount'], 1)
            self.assertFalse((Path(temporary) / 'escape.txt').exists())
            self.assertNotIn('malicious-client-code', (destination / 'viewer.js').read_text())
            self.assertNotIn('</script>', (destination / 'book-data.js').read_text())

    def test_bad_values(self):
        for value in [float('nan'), -1, '12']:
            data = self.manifest()
            data['overlays']['0']['value'] = value
            with self.assertRaises(ValueError):
                server.validate_manifest(data)

    def test_missing_page(self):
        data = self.manifest()
        data['pageCount'] = 2
        with tempfile.TemporaryDirectory() as temporary, self.assertRaises(KeyError):
            server.unpack_book(self.archive(data), Path(temporary))

    def test_invalid_image(self):
        with tempfile.TemporaryDirectory() as temporary, self.assertRaises(ValueError):
            server.unpack_book(self.archive(self.manifest(), b'<html>'), Path(temporary))

    def test_no_arbitrary_page_limit(self):
        data = self.manifest()
        data['pageCount'] = 1001
        self.assertEqual(server.validate_manifest(data)['pageCount'], 1001)


class LocalApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:' + str(cls.httpd.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def denied(self, path, code, headers=None, data=None):
        request = urllib.request.Request(self.base + path, headers=headers or {}, data=data)
        with self.assertRaises(urllib.error.HTTPError) as result:
            urllib.request.urlopen(request)
        self.assertEqual(result.exception.code, code)
        result.exception.close()

    def test_hidden_files(self):
        for path in ['/.git/config', '/assets/%2e%2e/.git/config', '/.build/server.log', '/server.py']:
            self.denied(path, 404)

    def test_origin_and_token(self):
        self.denied('/api/capabilities', 403, {'Origin': 'https://untrusted.example'})
        self.denied('/api/build/apk', 403, {'Content-Type': 'application/zip'}, b'bad')

    def test_static_and_capabilities(self):
        with urllib.request.urlopen(self.base + '/flipbook.html') as response:
            self.assertIn(b'export-html', response.read())
        with urllib.request.urlopen(self.base + '/api/capabilities') as response:
            body = json.load(response)
            self.assertTrue(body['token'])
            self.assertIn('office', body)


class ConvertApiTests(unittest.TestCase):
    PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:' + str(cls.httpd.server_port)
        with urllib.request.urlopen(cls.base + '/api/capabilities') as response:
            cls.token = json.load(response)['token']

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def post(self, body, headers):
        request = urllib.request.Request(self.base + '/api/convert/pptx-to-pdf', data=body, headers=headers)
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.headers, error.read()

    def headers(self, **extra):
        base = {'Content-Type': self.PPTX_MIME, 'X-Build-Token': self.token,
                'X-Filename': 'deck.pptx'}
        base.update(extra)
        return base

    def test_token_required(self):
        status, _, _ = self.post(b'PKxy', {'Content-Type': self.PPTX_MIME})
        self.assertEqual(status, 403)

    def test_bad_content_type(self):
        status, _, _ = self.post(b'PKxy', {'Content-Type': 'application/zip', 'X-Build-Token': self.token})
        self.assertEqual(status, 400)

    def test_bad_magic(self):
        status, _, body = self.post(b'not-a-presentation', self.headers())
        self.assertEqual(status, 400)

    def test_missing_libreoffice(self):
        with mock.patch.object(server.shutil, 'which', return_value=None):
            status, _, body = self.post(b'PK\x03\x04fake-pptx', self.headers())
        self.assertEqual(status, 503)
        self.assertIn(b'LibreOffice', body)

    def test_success_with_stubbed_soffice(self):
        def fake_run(args, **kwargs):
            outdir = Path(args[args.index('--outdir') + 1])
            source = Path(args[-1])
            (outdir / (source.stem + '.pdf')).write_bytes(b'%PDF-1.4 fake')
            stub = mock.Mock()
            stub.returncode = 0
            return stub

        with mock.patch.object(server.shutil, 'which', return_value='/usr/bin/soffice'), \
                mock.patch.object(server.subprocess, 'run', side_effect=fake_run):
            status, headers, body = self.post(b'PK\x03\x04fake-pptx', self.headers())
        self.assertEqual(status, 200)
        self.assertEqual(headers.get_content_type(), 'application/pdf')
        self.assertIn('deck.pdf', headers.get('Content-Disposition', ''))
        self.assertTrue(body.startswith(b'%PDF'))


if __name__ == '__main__':
    unittest.main()
