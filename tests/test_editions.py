"""Translated editions in builds: the manifest keeps lang + versions (cleaned),
and an APK/EXE package carries the translated pictures after the original
pages, in the same order as the editor (languages in name order)."""
import io
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

JPEG = b'\xff\xd8\xff\xe0' + b'0' * 64


def manifest(**extra):
    return dict(version=1, title='Buku', pageCount=3, ratio=0.7, overlays={}, **extra)


class EditionTests(unittest.TestCase):
    def test_manifest(self):
        data = server.validate_manifest(manifest(lang='id-ID', versions={'en-US': [2, 0, 0], 'ms-MY': [1]}))
        self.assertEqual((data['lang'], data['versions']), ('id-ID', {'en-US': [0, 2], 'ms-MY': [1]}))
        self.assertEqual(server.version_images(data), [('en-US', 0), ('en-US', 2), ('ms-MY', 1)])
        self.assertNotIn('versions', server.validate_manifest(manifest(lang='xx', versions={'en-US': [0]})), 'no language: no editions')
        self.assertNotIn('lang', server.validate_manifest(manifest()), 'older books stay as they were')
        said = server.validate_manifest(manifest(lang='id-ID', versions={'en-US': [1]}, versionText={
            'en-US': {'1': [[0.1, 0.2, 0.5, 0.1, 'Hello.'], [0, 0, 2, 1, 'bad'], [0, 0, 1, 1, ' ']], '2': [[0, 0, 1, 1, 'not in edition']]},
            'ms-MY': {'1': [[0, 0, 1, 1, 'no such edition']]}}))['versionText']
        self.assertEqual(said, {'en-US': {'1': [[0.1, 0.2, 0.5, 0.1, 'Hello.']]}})
        for bad in ({'id-ID': [0]}, {'en-US': [3]}, {'en-US': ['0']}, {'fr-FR': [0]}, ['en-US']):
            with self.assertRaises(ValueError):
                server.validate_manifest(manifest(lang='id-ID', versions=bad))

    def test_unpack_carries_the_translated_pictures(self):
        data = manifest(lang='id-ID', versions={'en-US': [0, 2]})
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as package:
            package.writestr('book.json', json.dumps(data))
            for index in range(1, 6):                      # 3 originals + 2 translated
                package.writestr(f'pages/{index}.jpg', JPEG + bytes([index]))
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / 'input.zip'
            archive.write_bytes(buffer.getvalue())
            out = server.unpack_book(archive, Path(tmp) / 'book')
            html = (Path(tmp) / 'book' / 'index.html').read_text(encoding='utf-8')
        payload = json.loads(re.search(r'<script type="application/json" id="book-payload">(.*?)</script>', html, re.S).group(1))
        self.assertEqual(len(payload['p']), 5, 'originals + translated pictures sealed')
        self.assertEqual(out['versions'], {'en-US': [0, 2]})
        # A package missing a translated picture is refused.
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as package:
            package.writestr('book.json', json.dumps(data))
            for index in range(1, 5):
                package.writestr(f'pages/{index}.jpg', JPEG)
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / 'input.zip'
            archive.write_bytes(buffer.getvalue())
            with self.assertRaises((ValueError, KeyError)):
                server.unpack_book(archive, Path(tmp) / 'book')


class FreeTranslatorTests(unittest.TestCase):
    """The free (Argos) translator's guards, with a stand-in engine."""

    def setUp(self):
        import free_translate
        self.ft = free_translate
        self.seen = []
        outer = self

        class Engine:
            @staticmethod
            def translate(text, src, dst):
                outer.seen.append(text)
                return '<' + text.upper() + '>'
        self.engine = Engine
        self.patch = unittest.mock.patch.object(free_translate, '_translate_module', return_value=Engine)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()

    def test_guards(self):
        ft = self.ft
        # Already in the target language: left alone.
        self.assertEqual(ft.translate_text('Overall Storyline', 'en-US'), 'Overall Storyline')
        # Names and codes masked, restored after.
        out = ft.translate_text('Hero video dimulai setelah Activation Ceremony di JKT2A selesai.', 'en-US')
        self.assertIn('Activation Ceremony', out); self.assertIn('JKT2A', out)
        self.assertTrue(any('Z0Q' in s for s in self.seen), 'masked before translating')
        # Pieces at ": " translated one by one; an English theme kept.
        out = ft.translate_text('Video ditutup dengan tema: Beyond Connected', 'en-US')
        self.assertTrue(out.endswith(': Beyond Connected'))
        # Unsupported language.
        with self.assertRaises(ValueError):
            ft.translate_text('teks', 'ms-MY')
        self.assertEqual(ft.translate_texts({'0': '  ', '1': 'Selamat pagi semuanya.'}, 'en-US'), {'1': '<SELAMAT PAGI SEMUANYA.>'})

    def test_lost_mask_falls_back(self):
        class Dropper:
            @staticmethod
            def translate(text, src, dst):
                return text.replace('Z0Q', '') if 'Z0Q' in text else 'plain: ' + text
        with unittest.mock.patch.object(self.ft, '_translate_module', return_value=Dropper):
            self.assertEqual(self.ft.translate_text('Hari ini di Mega Mendung kami bermain.', 'en-US'), 'plain: Hari ini di Mega Mendung kami bermain.')

    def test_route(self):
        import threading, urllib.request, urllib.error
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        try:
            def post(body, available=True):
                request = urllib.request.Request(f'http://127.0.0.1:{httpd.server_port}/api/translate-free', data=json.dumps(body).encode(), method='POST',
                                                 headers={'Content-Type': 'application/json', 'X-Build-Token': server.TOKEN})
                with unittest.mock.patch.object(self.ft, 'available', return_value=available):
                    try:
                        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request) as r:
                            return r.status, json.loads(r.read())
                    except urllib.error.HTTPError as e:
                        with e:
                            return e.code, json.loads(e.read())
            status, body = post({'pages': {'0': 'Selamat pagi semuanya.'}, 'target': 'en-US'})
            self.assertEqual((status, body['engine'], body['pages']), (200, 'free', {'0': '<SELAMAT PAGI SEMUANYA.>'}))
            self.assertEqual(post({'pages': {'0': 'x y'}, 'target': 'ms-MY'})[0], 400)
            self.assertEqual(post({'pages': {'0': 'teks'}, 'target': 'en-US'}, available=False)[0], 503)
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join()


import unittest.mock  # noqa: E402  (used by FreeTranslatorTests)

if __name__ == '__main__':
    unittest.main()
