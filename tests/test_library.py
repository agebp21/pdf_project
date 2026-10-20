"""Member archive (My Library): per-member storage of projects, covers and
exports; encrypted at rest; plan quotas; owners only."""
import http.cookiejar
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest import mock
import urllib.error
import urllib.parse
import urllib.request
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import accounts
import library
import server


def project(title='Laporan Tahunan', pages=12, pdf=b'%PDF-1.7 fixture ' + b'x' * 2000):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as package:
        package.writestr('project.json', json.dumps({'version': 1, 'title': title, 'pageCount': pages, 'ratio': .7, 'overlays': {}}))
        package.writestr('source.pdf', pdf)
    return output.getvalue()


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


class LibraryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.previous = (server.ACCOUNTS, server.LIBRARY)
        server.ACCOUNTS = accounts.Accounts(Path(cls.temporary.name) / 'accounts.db')
        server.LIBRARY = None
        cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:' + str(cls.httpd.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()
        server.ACCOUNTS, server.LIBRARY = cls.previous
        cls.temporary.cleanup()

    def member(self, email):
        member = Member(self.base)
        self.assertEqual(member.json('POST', '/api/auth/register', {'email': email, 'password': 'rahasia-123', 'name': 'M'})[0], 201)
        return member

    def save(self, member, data, book_id=None):
        headers = {'X-Book-Id': book_id} if book_id else None
        return member.json('POST', '/api/library/save', data, 'application/zip', headers)

    def test_editor_draft(self):
        # The PDF editor's autosave: one draft per member, sealed on disk, owners only.
        self.assertEqual(Member(self.base).call('GET', '/api/library/draft')[0], 401)
        eka = self.member('eka@b.co')
        self.assertEqual(eka.call('GET', '/api/library/draft')[0], 404, 'none yet')
        draft = bytes([0x1f, 0x8b]) + b' gzip draft ' + b'%PDF-1.7 skripsi ' * 50
        status, body = eka.json('POST', '/api/library/draft', draft, 'application/octet-stream',
                                {'X-Draft-Name': urllib.parse.quote('Skripsi Eka.pdf'), 'X-Saved-At': '1760000000123'})
        self.assertEqual((status, body['savedAt']), (200, 1760000000123))
        status, headers, raw = eka.call('GET', '/api/library/draft')
        self.assertEqual((status, raw), (200, draft))
        self.assertEqual((urllib.parse.unquote(headers['X-Draft-Name']), headers['X-Saved-At']), ('Skripsi Eka.pdf', '1760000000123'))
        path = Path(self.temporary.name) / 'library' / str(server.ACCOUNTS.me_by_email('eka@b.co')['id']) / 'editor-draft.bin'             if hasattr(server.ACCOUNTS, 'me_by_email') else next((Path(self.temporary.name) / 'library').rglob('editor-draft.bin'))
        self.assertNotIn(b'skripsi', path.read_bytes(), 'sealed on disk')
        # A newer save replaces it; other members do not see it; delete removes it.
        eka.call('POST', '/api/library/draft', b'v2', 'application/octet-stream', {'X-Saved-At': '1760000000999'})
        self.assertEqual(eka.call('GET', '/api/library/draft')[2], b'v2')
        self.assertEqual(self.member('fajar@b.co').call('GET', '/api/library/draft')[0], 404)
        self.assertEqual(eka.call('POST', '/api/library/draft/delete', b'{}')[0], 200)
        self.assertEqual(eka.call('GET', '/api/library/draft')[0], 404)
        with mock.patch.object(library, 'MAX_DRAFT', 10):
            self.assertEqual(eka.call('POST', '/api/library/draft', b'x' * 11, 'application/octet-stream')[0], 413)

    def test_archive_flow_encryption_quota_and_ownership(self):
        self.assertEqual(Member(self.base).json('GET', '/api/library')[0], 401, 'members only')
        ana = self.member('ana@b.co')
        # Free reads every book but keeps nothing in My Library (owner, 2026-10-19).
        status, body = self.save(ana, project())
        self.assertEqual(status, 402); self.assertIn('My Library butuh paket Medium atau Pro', body['error'])
        server.ACCOUNTS.grant_plan('ana@b.co', 'medium', 30)
        with mock.patch.dict(library.LIMITS, {'medium': (3, 100 * library.MB)}):          # a small archive to fill
            self._archive_flow(ana)

    def _archive_flow(self, ana):
        status, body = self.save(ana, project())
        self.assertEqual(status, 200)
        book = body['id']
        # Update the same book (new title) instead of adding one.
        self.assertEqual(self.save(ana, project('Laporan Final'), book)[1]['id'], book)
        # Cover and an HTML export; a second HTML export replaces the first.
        self.assertEqual(ana.call('POST', f'/api/library/{book}/cover', b'\xff\xd8\xff\xe0cover', 'image/jpeg')[0], 200)
        ana.call('POST', f'/api/library/{book}/export', b'<html>v1</html>', 'application/octet-stream', {'X-Kind': 'html', 'X-Filename': 'Laporan.html'})
        ana.call('POST', f'/api/library/{book}/export', b'<html>v2</html>', 'application/octet-stream', {'X-Kind': 'html', 'X-Filename': 'Laporan%20Final.html'})
        status, listing = ana.json('GET', '/api/library')
        self.assertEqual(status, 200)
        [entry] = listing['books']
        self.assertEqual((entry['title'], entry['pageCount'], entry['hasCover']), ('Laporan Final', 12, True))
        self.assertEqual([(e['kind'], e['filename']) for e in entry['exports']], [('html', 'Laporan Final.html')])
        self.assertEqual(listing['usage']['books'], 1)
        # Downloads come back exactly.
        status, headers, raw = ana.call('GET', f'/api/library/{book}/project')
        self.assertEqual(raw, project('Laporan Final'))
        self.assertIn('Laporan Final.smflipbook', urllib.parse.unquote(headers['Content-Disposition']))
        self.assertEqual(ana.call('GET', f'/api/library/{book}/cover')[2], b'\xff\xd8\xff\xe0cover')
        export_id = entry['exports'][0]['id']
        self.assertEqual(ana.call('GET', f'/api/library/{book}/exports/{export_id}')[2], b'<html>v2</html>')
        # On disk everything is encrypted.
        files = list((Path(self.temporary.name) / 'library').rglob('*.bin'))
        self.assertEqual(len(files), 3, 'project, cover, one html export')
        for file in files:
            data = file.read_bytes()
            self.assertNotIn(b'%PDF', data); self.assertNotIn(b'<html>', data); self.assertNotIn(b'Laporan', data)
        # Another member sees nothing and can touch nothing.
        budi = self.member('budi@b.co')
        server.ACCOUNTS.grant_plan('budi@b.co', 'medium', 30)
        self.assertEqual(budi.json('GET', '/api/library')[1]['books'], [])
        self.assertEqual(budi.call('GET', f'/api/library/{book}/project')[0], 404)
        self.assertEqual(budi.call('POST', f'/api/library/{book}/delete', b'{}')[0], 404)
        self.assertEqual(self.save(budi, project('Punya Budi'), book)[1]['id'] != book, True, "can't overwrite someone else's book")
        # A plan of 3 books.
        for n in range(2):
            self.assertEqual(self.save(ana, project(f'Buku {n}'))[0], 200)
        status, body = self.save(ana, project('Buku ke-4'))
        self.assertEqual(status, 402); self.assertIn('3 buku', body['error'])
        # Bad uploads are refused.
        self.assertEqual(self.save(ana, b'not a zip')[0], 400)
        self.assertEqual(ana.call('POST', f'/api/library/{book}/cover', b'<svg/>', 'image/jpeg')[0], 400)
        self.assertEqual(ana.call('POST', f'/api/library/{book}/export', b'x', 'application/octet-stream', {'X-Kind': 'zip'})[0], 400)
        # Delete removes the book and its files.
        self.assertEqual(ana.call('POST', f'/api/library/{book}/delete', b'{}')[0], 200)
        self.assertEqual(len(ana.json('GET', '/api/library')[1]['books']), 2)
        self.assertFalse(any(book in str(f) for f in (Path(self.temporary.name) / 'library').rglob('*')))


    def test_folders(self):
        # Folders: make, rename, move books in and out, delete (books stay); a member's own only.
        rani = self.member('rani@b.co'); server.ACCOUNTS.grant_plan('rani@b.co', 'medium', 30)
        book = self.save(rani, project('Bab 1'))[1]['id']
        status, body = rani.json('POST', '/api/library/folders', {'name': '  Referensi   Skripsi '})
        self.assertEqual(status, 200)
        folder = body['id']
        self.assertEqual([(f['name'], f['books']) for f in body['folders']], [('Referensi Skripsi', 0)])
        self.assertEqual(rani.json('POST', '/api/library/folders', {'name': '   '})[0], 400, 'a name is needed')
        self.assertEqual(rani.json('POST', f'/api/library/{book}/move', {'folder': folder})[0], 200)
        listing = rani.json('GET', '/api/library')[1]
        self.assertEqual(listing['books'][0]['folder'], folder); self.assertEqual(listing['folders'][0]['books'], 1)
        self.assertEqual(rani.json('POST', f'/api/library/folders/{folder}/rename', {'name': 'Pustaka'})[1]['folders'][0]['name'], 'Pustaka')
        # Someone else's folder or book: not found.
        budi = self.member('budi2@b.co'); server.ACCOUNTS.grant_plan('budi2@b.co', 'medium', 30)
        other = self.save(budi, project('Punya Budi'))[1]['id']
        self.assertEqual(budi.json('POST', f'/api/library/{other}/move', {'folder': folder})[0], 404, "not into someone else's folder")
        self.assertEqual(budi.json('POST', f'/api/library/folders/{folder}/rename', {'name': 'x'})[0], 404)
        self.assertEqual(rani.json('POST', f'/api/library/{other}/move', {'folder': None})[0], 404, "not someone else's book")
        # Out of the folder, back in, then the folder goes: the book stays, at the top.
        self.assertEqual(rani.json('POST', f'/api/library/{book}/move', {'folder': None})[0], 200)
        self.assertIsNone(rani.json('GET', '/api/library')[1]['books'][0]['folder'])
        rani.json('POST', f'/api/library/{book}/move', {'folder': folder})
        self.assertEqual(rani.json('POST', f'/api/library/folders/{folder}/delete', {})[1]['folders'], [])
        listing = rani.json('GET', '/api/library')[1]
        self.assertEqual(len(listing['books']), 1); self.assertIsNone(listing['books'][0]['folder'])

    def test_tampered_file_refused_and_key_kept(self):
        folder = Path(self.temporary.name)
        key = library.master_key(folder)
        self.assertEqual(library.master_key(folder), key, 'the key file is created once')
        sealer = library.Sealer(key)
        blob = bytearray(sealer.seal(b'isi rahasia'))
        self.assertEqual(sealer.open(bytes(blob)), b'isi rahasia')
        blob[20] ^= 1
        with self.assertRaises(accounts.AccountError):
            sealer.open(bytes(blob))
        with self.assertRaises(accounts.AccountError):
            library.Sealer(bytes(32)).open(sealer.seal(b'x'))


if __name__ == '__main__':
    unittest.main()
