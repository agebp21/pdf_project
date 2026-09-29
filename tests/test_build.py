import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import zipfile
import threading
import time
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

    def test_native_app_named_after_book(self):
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            (workspace / 'android/app/src/main').mkdir(parents=True)
            (workspace / 'windows/runner').mkdir(parents=True)
            (workspace / 'android/app/src/main/AndroidManifest.xml').write_text(
                '<manifest><application android:label="sarvamaya_book" android:icon="x"/></manifest>', encoding='utf-8')
            (workspace / 'windows/runner/main.cpp').write_text('if (!window.Create(L"sarvamaya_book", origin, size))', encoding='utf-8')
            title = '@Laporan "2026" — Désa & Co\'s'
            name = server.brand_native(workspace, title)
            self.assertEqual(name, title[1:], 'leading @ (Android resource syntax) is dropped')
            manifest = (workspace / 'android/app/src/main/AndroidManifest.xml').read_text(encoding='utf-8')
            self.assertIn(r'android:label="Laporan &quot;2026&quot; ' + '— Désa' + r' &amp; Co\'s"', manifest)
            runner = (workspace / 'windows/runner/main.cpp').read_text(encoding='utf-8')
            self.assertIn(r'''L"Laporan \"2026\" \U00002014 D\U000000E9sa & Co's"''', runner)
        self.assertEqual(server.app_name('   '), 'MyFlipbook')

    def test_highlight_word_positions_validated_for_native_books(self):
        base = dict(version=1, title='Buku', pageCount=2, ratio=0.7, overlays={})
        ok = server.validate_manifest(dict(base, words={'1': [[100, 200, 300, 40, 400, 60]]}))
        self.assertEqual(ok['words'], {'1': [[100, 200, 300, 40, 400, 60]]})
        self.assertEqual(server.validate_manifest(base)['words'], {}, 'older books without words still build')
        for bad in ({'2': [[1, 2, 3, 4]]}, {'0': [[1, 2, 3]]}, {'0': [[1, 2, 3, 20000]]}, {'0': [[1, 2, 3, 4.5]]},
                    {'0': [[1, 2, 3, True]]}, {'0': 'x'}, []):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                server.validate_manifest(dict(base, words=bad))

    def test_windows_file_details_named_after_book(self):
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            for folder in ('android/app/src/main', 'windows/runner'):
                (workspace / folder).mkdir(parents=True)
            (workspace / 'android/app/src/main/AndroidManifest.xml').write_text('<application android:label="x"/>', encoding='utf-8')
            (workspace / 'windows/runner/main.cpp').write_text('window.Create(L"sarvamaya_book"', encoding='utf-8')
            rc = workspace / 'windows/runner/Runner.rc'
            rc.write_text('VALUE "CompanyName", "id.sarvamaya" "\\0"\n'
                          'VALUE "ProductName", "sarvamaya_book" "\\0"\n'
                          'VALUE "OriginalFilename", "sarvamaya_book.exe" "\\0"\n'
                          'VALUE "FileVersion", VERSION_AS_STRING "\\0"\n', encoding='utf-8')
            server.brand_native(workspace, 'Buku "Uji": Désa')
            text = rc.read_text(encoding='utf-8')
            self.assertIn('VALUE "CompanyName", "MyFlipbook"', text)
            self.assertIn('VALUE "ProductName", "Buku ""Uji"": Désa"', text)
            self.assertIn('VALUE "OriginalFilename", "Buku Uji Désa.exe"', text)
            self.assertIn('VALUE "FileVersion", VERSION_AS_STRING', text)

    def test_android_package_and_exe_names(self):
        app_id = server.android_app_id('Uji Export')
        self.assertRegex(app_id, r'^id\.myflipbook\.uji_export_[0-9a-f]{6}$')
        self.assertEqual(app_id, server.android_app_id('Uji Export'), 'stable: a rebuild updates the installed app')
        self.assertNotEqual(app_id, server.android_app_id('Uji Export 2'))
        for title in ('2026 Report', '行事', '   ', 'Désa & Co'):
            self.assertRegex(server.android_app_id(title), r'^id\.myflipbook\.[a-z][a-z0-9_]*$', title)
        self.assertEqual(server.exe_name('a/b:c*?'), 'abc')
        self.assertEqual(server.exe_name('CON'), 'MyFlipbook')
        self.assertEqual(server.exe_name('Laporan 2026'), 'Laporan 2026')

    @unittest.skipUnless(server.find_keytool(), 'keytool not installed')
    def test_android_release_key_made_once(self):
        with tempfile.TemporaryDirectory() as temporary, \
                mock.patch.object(server, 'DATA', Path(temporary)), \
                mock.patch.object(server, 'ANDROID_SIGNING', Path(temporary) / 'android-signing.json'):
            first = server.android_signing()
            self.assertTrue(Path(first['MYFLIPBOOK_KEYSTORE']).is_file())
            self.assertEqual(server.android_signing(), first, 'same key for every build')
            (Path(temporary) / 'android-signing.json').unlink()
            second = server.android_signing()
            self.assertNotEqual(second['MYFLIPBOOK_KEYSTORE'], first['MYFLIPBOOK_KEYSTORE'], 'an existing key file is never overwritten')
            self.assertTrue(Path(first['MYFLIPBOOK_KEYSTORE']).is_file())

    def test_page_links_validated_for_native_books(self):
        data = self.manifest()
        data['pageCount'] = 3
        data['links'] = {'0': [{'x': 0.1, 'y': 0.2, 'w': 0.5, 'h': 0.03, 'page': 2},
                               {'x': 0.1, 'y': 0.3, 'w': 0.5, 'h': 0.03, 'url': 'https://sarvamaya.com'}]}
        self.assertEqual(server.validate_manifest(data)['links'], data['links'])
        self.assertEqual(server.validate_manifest(self.manifest())['links'], {}, 'books without links still build')
        for bad in ({'page': 3}, {'url': 'javascript:alert(1)'}, {'page': 1, 'x': 2}, {'page': True}):
            data['links'] = {'0': [dict({'x': 0.1, 'y': 0.2, 'w': 0.5, 'h': 0.03}, **bad)]}
            with self.assertRaises(ValueError):
                server.validate_manifest(data)
        data['links'] = {'3': []}
        with self.assertRaises(ValueError):
            server.validate_manifest(data)

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

    def post(self, body, headers, route='/api/convert/pptx-to-pdf'):
        request = urllib.request.Request(self.base + route, data=body, headers=headers)
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            with error:
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
        with mock.patch.object(server, 'find_soffice', return_value=None):
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

        with mock.patch.object(server, 'find_soffice', return_value='/usr/bin/soffice'), \
                mock.patch.object(server.subprocess, 'run', side_effect=fake_run):
            status, headers, body = self.post(b'PK\x03\x04fake-pptx', self.headers())
        self.assertEqual(status, 200)
        self.assertEqual(headers.get_content_type(), 'application/pdf')
        self.assertIn('deck.pdf', headers.get('Content-Disposition', ''))
        self.assertTrue(body.startswith(b'%PDF'))

    def test_word_excel_routes(self):
        for ext in ['.docx', '.doc', '.xlsx', '.xls', '.csv']:
            with self.subTest(ext=ext):
                mime = next(k for k, v in server.OFFICE_MIMES.items() if v == ext)
                route = '/api/convert/' + ('word' if ext in {'.doc', '.docx'} else 'excel') + '-to-pdf'
                payload = b'uploaded-whole-file'
                def convert(source, filename):
                    self.assertEqual(source.read_bytes(), payload)
                    self.assertEqual(filename, 'sample' + ext)
                    return b'%PDF-1.4 result', 'sample.pdf'
                with mock.patch.object(server, 'office_to_pdf', side_effect=convert):
                    status, headers, body = self.post(payload, self.headers(**{'Content-Type':mime, 'X-Filename':'sample'+ext}), route)
                self.assertEqual(status, 200)
                self.assertEqual(body, b'%PDF-1.4 result')

    def test_cross_tool_and_mismatched_extensions_rejected(self):
        status, _, _ = self.post(b'PKbad', self.headers(), '/api/convert/word-to-pdf')
        self.assertEqual(status, 400)
        status, _, _ = self.post(b'PKbad', self.headers(**{'X-Filename':'script.exe'}))
        self.assertEqual(status, 400)

    def test_long_office_names_preserve_extension(self):
        self.assertTrue(server.safe_office_name('x' * 150 + '.docx').endswith('.docx'))


class HtmlToPdfTests(unittest.TestCase):
    """HTML to PDF: print defaults injected, route validation, and (when Edge/
    Chrome is installed) a real print where local files and the server's
    network stay out of reach in hosting mode."""

    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:' + str(cls.httpd.server_port)
        with urllib.request.urlopen(cls.base + '/api/capabilities') as response:
            cls.caps = json.load(response)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def post(self, body, **headers):
        base = {'Content-Type': 'text/html', 'X-Build-Token': self.caps['token'], 'X-Filename': 'laporan.html'}
        base.update(headers)
        request = urllib.request.Request(self.base + '/api/convert/html-to-pdf', data=body,
                                         headers={k: v for k, v in base.items() if v is not None})
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            with error:
                return error.code, error.headers, error.read()

    def test_print_defaults_go_before_the_page_css(self):
        out = server.prepare_html(b'<html><HEAD lang="id"><style>@page{size:A5}</style></head><body>x</body></html>', 'letter', 20)
        self.assertLess(out.index(b'size:letter;margin:20mm'), out.index(b'size:A5'), "the page's own @page wins")
        self.assertIn(b'print-color-adjust:exact', out)
        self.assertTrue(server.prepare_html(b'<p>bare</p>').startswith(b'<meta charset="utf-8"><style>'))
        self.assertIn(b'size:A4;margin:0mm', server.prepare_html(b'<p>x</p>', 'unknown', -5))

    def test_validation(self):
        self.assertIn('html', self.caps)
        self.assertEqual(self.post(b'<p>x</p>', **{'X-Build-Token': None})[0], 403)
        self.assertEqual(self.post(b'<p>x</p>', **{'Content-Type': 'application/pdf'})[0], 400)
        self.assertEqual(self.post(b'<p>x</p>', **{'X-Filename': 'evil.exe'})[0], 400)
        with mock.patch.object(server, 'find_chromium', return_value=None):
            status, _, body = self.post(b'<p>x</p>')
        self.assertEqual(status, 503)
        self.assertIn('Edge', json.loads(body)['error'])

    def test_success_with_stubbed_browser(self):
        seen = {}

        def fake(raw, page_size, margin, allow_network):
            seen.update(raw=raw, page_size=page_size, margin=margin, allow_network=allow_network)
            return b'%PDF-1.7 fake'
        with mock.patch.object(server, 'html_to_pdf', side_effect=fake):
            status, headers, body = self.post(b'<h1>Hi</h1>', **{'X-Page-Size': 'letter', 'X-Margin': '0'})
        self.assertEqual(status, 200)
        self.assertTrue(body.startswith(b'%PDF'))
        self.assertIn('laporan.pdf', headers.get('Content-Disposition', ''))
        self.assertEqual((seen['page_size'], seen['margin'], seen['allow_network']), ('letter', 0.0, True))

    @unittest.skipUnless(server.find_chromium(), 'Edge/Chrome not installed')
    def test_real_print_keeps_files_and_network_out_of_reach(self):
        page = (b'<!doctype html><html><head><meta charset="utf-8"></head><body style="background:#123456">'
                b'<h1>Laporan</h1><iframe src="file:///C:/Windows/win.ini"></iframe>'
                b'<img src="http://169.254.169.254/x"><script>document.title="ran"</script></body></html>')
        started = time.time()
        pdf = server.html_to_pdf(page, 'a4', 10, allow_network=False)
        self.assertTrue(pdf.startswith(b'%PDF-'))
        self.assertLess(time.time() - started, 30, 'blocked addresses fail fast instead of timing out')
        self.assertNotIn(b'fonts]', pdf, 'win.ini content never reaches the PDF')
        self.assertRegex(pdf, rb'/MediaBox\s*\[\s*0 0 59[45]\.\d+ 84[12]\.\d+', 'A4 paper')


class LanHostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.httpd.server_port

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def raw_get(self, host_header, origin=None):
        import socket
        sock = socket.create_connection(('127.0.0.1', self.port), timeout=10)
        request = f'GET /api/capabilities HTTP/1.1\r\nHost: {host_header}\r\n'
        if origin is not None:
            request += f'Origin: {origin}\r\n'
        request += 'Connection: close\r\n\r\n'
        sock.sendall(request.encode())
        data = b''
        while b'\r\n' not in data:
            chunk = sock.recv(1024)
            if not chunk:
                break
            data += chunk
        sock.close()
        return int(data.split(b' ')[1])

    def test_lan_ip_host_allowed(self):
        ip = server.lan_ip()
        if not ip:
            self.skipTest('tidak ada jaringan LAN')
        self.assertEqual(self.raw_get(f'{ip}:{self.port}'), 200)

    def test_wrong_port_rejected(self):
        self.assertEqual(self.raw_get(f'127.0.0.1:{self.port + 1}'), 403)

    def test_untrusted_name_rejected(self):
        self.assertEqual(self.raw_get(f'evil.example:{self.port}'), 403)

    def test_origin_mismatch_rejected(self):
        ip = server.lan_ip() or '127.0.0.1'
        self.assertEqual(self.raw_get(f'{ip}:{self.port}', f'http://evil.example:{self.port}'), 403)

    def test_local_addresses_contains_loopback(self):
        self.assertIn('127.0.0.1', server.local_addresses())
        self.assertIn('localhost', server.local_addresses())


if __name__ == '__main__':
    unittest.main()
