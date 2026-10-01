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


if __name__ == '__main__':
    unittest.main()
