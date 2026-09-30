"""Member archive ("Arsipku"): every signed-in member's flipbooks, kept on
the server — the editable project (source PDF + book settings), a cover
thumbnail and the latest export of each kind (HTML / APK / EXE).

Files are encrypted at rest with a server master key (stdlib only):
SHAKE-256 keystream per 1 MB chunk (key, random 16-byte nonce, chunk index)
and an HMAC-SHA256 tag over nonce + ciphertext (encrypt-then-MAC), so a
copied disk or backup is unreadable and a tampered file is refused.
The master key lives in MYFLIPBOOK_LIBRARY_KEY (64 hex chars) or
.data/library.key (created once). Losing it means losing the archives:
back it up with the database.

Quotas follow the member's current plan (see LIMITS). A downgrade never
deletes anything; it only stops new books once over the limit.
"""
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import shutil
import time
import zipfile
from pathlib import Path

from accounts import AccountError

MB = 1024 * 1024
# plan -> (max books or None, max bytes)
LIMITS = {'free': (3, 100 * MB), 'pro': (50, 5 * 1024 * MB), 'business': (None, 50 * 1024 * MB)}
EXPORT_KINDS = ('html', 'apk', 'exe')
MAX_PROJECT = 300 * MB
MAX_COVER = 2 * MB
MAX_EXPORT = 400 * MB
CHUNK = MB


class Sealer:
    """Encrypt-then-MAC with stdlib primitives (see module docstring)."""

    def __init__(self, master):
        if len(master) != 32:
            raise ValueError('Library key must be 32 bytes.')
        self.enc = hashlib.sha256(b'myflipbook-library-enc' + master).digest()
        self.mac = hashlib.sha256(b'myflipbook-library-mac' + master).digest()

    def _xor(self, nonce, data):
        out = bytearray(len(data))
        for index, start in enumerate(range(0, len(data), CHUNK)):
            chunk = data[start:start + CHUNK]
            stream = hashlib.shake_256(self.enc + nonce + index.to_bytes(8, 'little')).digest(len(chunk))
            out[start:start + len(chunk)] = (int.from_bytes(chunk, 'little') ^ int.from_bytes(stream, 'little')).to_bytes(len(chunk), 'little')
        return bytes(out)

    def seal(self, data):
        nonce = secrets.token_bytes(16)
        body = self._xor(nonce, data)
        return nonce + body + hmac.new(self.mac, nonce + body, hashlib.sha256).digest()

    def open(self, blob):
        if len(blob) < 48:
            raise AccountError(500, 'File arsip rusak.')
        nonce, body, tag = blob[:16], blob[16:-32], blob[-32:]
        if not hmac.compare_digest(tag, hmac.new(self.mac, nonce + body, hashlib.sha256).digest()):
            raise AccountError(500, 'File arsip rusak atau diubah.')
        return self._xor(nonce, body)


def master_key(folder):
    """MYFLIPBOOK_LIBRARY_KEY, else .data/library.key (made once, never overwritten)."""
    configured = os.environ.get('MYFLIPBOOK_LIBRARY_KEY', '').strip()
    if configured:
        if not re.fullmatch(r'[0-9a-fA-F]{64}', configured):
            raise ValueError('MYFLIPBOOK_LIBRARY_KEY must be 64 hex characters.')
        return bytes.fromhex(configured)
    path = Path(folder) / 'library.key'
    if path.is_file():
        return bytes.fromhex(path.read_text(encoding='ascii').strip())
    path.parent.mkdir(parents=True, exist_ok=True)
    key = secrets.token_bytes(32)
    path.write_text(key.hex(), encoding='ascii')
    return key


def clean_title(value):
    text = re.sub(r'\s+', ' ', ''.join(ch for ch in str(value or '') if ch.isprintable())).strip()
    return text[:200] or 'Tanpa judul'


def check_project(data):
    """A .smflipbook: a ZIP with project.json and source.pdf. Returns the
    project settings (title, page count) without trusting anything else."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as package:
            names = set(package.namelist())
            if not {'project.json', 'source.pdf'} <= names:
                raise AccountError(400, 'Proyek tidak lengkap.')
            info = package.getinfo('project.json')
            if info.file_size > 32 * MB:
                raise AccountError(400, 'Data proyek terlalu besar.')
            project = json.loads(package.read('project.json'))
            with package.open('source.pdf') as pdf:
                if pdf.read(5) != b'%PDF-':
                    raise AccountError(400, 'PDF proyek tidak valid.')
    except (zipfile.BadZipFile, ValueError, KeyError):
        raise AccountError(400, 'File proyek tidak valid.')
    if not isinstance(project, dict):
        raise AccountError(400, 'File proyek tidak valid.')
    count = project.get('pageCount')
    return clean_title(project.get('title')), count if type(count) is int and 0 < count < 100000 else 0


class Library:
    def __init__(self, store, folder):
        self.store = store                     # accounts.Accounts (same SQLite database)
        self.folder = Path(folder) / 'library'
        self.sealer = Sealer(master_key(folder))
        with store.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS library_books(
                    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title TEXT NOT NULL, page_count INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0,
                    has_cover INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
                CREATE INDEX IF NOT EXISTS library_user ON library_books(user_id, updated_at);
                CREATE TABLE IF NOT EXISTS library_exports(
                    id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL, kind TEXT NOT NULL, filename TEXT NOT NULL, size INTEGER NOT NULL,
                    created_at INTEGER NOT NULL);
                CREATE INDEX IF NOT EXISTS library_export_book ON library_exports(book_id);
            ''')

    # ---- storage ---------------------------------------------------------
    def _dir(self, user_id, book_id):
        if not re.fullmatch(r'[0-9a-f]{32}', book_id or ''):
            raise AccountError(404, 'Buku tidak ditemukan.')
        return self.folder / str(int(user_id)) / book_id

    def _write(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix('.tmp')
        temp.write_bytes(self.sealer.seal(data))
        os.replace(temp, path)

    def _read(self, path):
        if not path.is_file():
            raise AccountError(404, 'File arsip tidak ditemukan.')
        return self.sealer.open(path.read_bytes())

    def _size(self, user_id, book_id):
        folder = self._dir(user_id, book_id)
        return sum(f.stat().st_size for f in folder.rglob('*.bin')) if folder.exists() else 0

    # ---- quota -----------------------------------------------------------
    def usage(self, user):
        with self.store.connect() as db:
            row = db.execute('SELECT COUNT(*) AS books, COALESCE(SUM(size), 0) AS bytes FROM library_books WHERE user_id=?',
                             (user['id'],)).fetchone()
        books, max_bytes = LIMITS.get(user['plan'], LIMITS['free'])
        return dict(books=row['books'], bytes=row['bytes'], maxBooks=books, maxBytes=max_bytes, plan=user['plan'])

    def _check_room(self, user, new_book, extra_bytes):
        use = self.usage(user)
        if new_book and use['maxBooks'] is not None and use['books'] >= use['maxBooks']:
            raise AccountError(402, f"Arsip penuh: paket {user['planName']} menyimpan {use['maxBooks']} buku. "
                                    'Hapus buku lama di Arsipku atau upgrade paket.')
        if use['bytes'] + max(0, extra_bytes) > use['maxBytes']:
            raise AccountError(402, f"Ruang arsip paket {user['planName']} penuh ({use['maxBytes'] // MB} MB). "
                                    'Hapus buku lama di Arsipku atau upgrade paket.')

    def _own(self, db, user, book_id):
        book = db.execute('SELECT * FROM library_books WHERE id=? AND user_id=?', (book_id, user['id'])).fetchone()
        if not book:
            raise AccountError(404, 'Buku tidak ditemukan di arsipmu.')
        return book

    def _resize(self, user, book_id):
        size = self._size(user['id'], book_id)
        with self.store.connect() as db:
            db.execute('UPDATE library_books SET size=?, updated_at=? WHERE id=?', (size, int(time.time()), book_id))

    # ---- API -------------------------------------------------------------
    def books(self, user):
        with self.store.connect() as db:
            rows = db.execute('SELECT * FROM library_books WHERE user_id=? ORDER BY updated_at DESC', (user['id'],)).fetchall()
            exports = db.execute('SELECT * FROM library_exports WHERE user_id=? ORDER BY created_at DESC', (user['id'],)).fetchall()
        by_book = {}
        for e in exports:
            by_book.setdefault(e['book_id'], []).append(dict(id=e['id'], kind=e['kind'], filename=e['filename'],
                                                             size=e['size'], createdAt=e['created_at']))
        return [dict(id=r['id'], title=r['title'], pageCount=r['page_count'], size=r['size'], hasCover=bool(r['has_cover']),
                     createdAt=r['created_at'], updatedAt=r['updated_at'], exports=by_book.get(r['id'], []))
                for r in rows]

    def save_project(self, user, data, book_id=None):
        """Create (no id / unknown id) or update the member's book; returns its id."""
        if len(data) > MAX_PROJECT:
            raise AccountError(413, 'Proyek terlalu besar untuk arsip (maksimal 300 MB).')
        title, pages = check_project(data)
        now = int(time.time())
        with self.store.connect() as db:
            existing = db.execute('SELECT * FROM library_books WHERE id=? AND user_id=?', (book_id or '', user['id'])).fetchone()
        project_old = (self._dir(user['id'], existing['id']) / 'project.bin') if existing else None
        replaced = project_old.stat().st_size if project_old and project_old.is_file() else 0
        self._check_room(user, not existing, len(data) + 48 - replaced)
        book_id = existing['id'] if existing else secrets.token_hex(16)
        self._write(self._dir(user['id'], book_id) / 'project.bin', data)
        with self.store.connect() as db:
            if existing:
                db.execute('UPDATE library_books SET title=?, page_count=?, updated_at=? WHERE id=?', (title, pages, now, book_id))
            else:
                db.execute('INSERT INTO library_books(id, user_id, title, page_count, created_at, updated_at) VALUES(?,?,?,?,?,?)',
                           (book_id, user['id'], title, pages, now, now))
        self._resize(user, book_id)
        return book_id

    def save_cover(self, user, book_id, data):
        if not data.startswith(b'\xff\xd8\xff') or len(data) > MAX_COVER:
            raise AccountError(400, 'Sampul harus JPEG (maksimal 2 MB).')
        with self.store.connect() as db:
            self._own(db, user, book_id)
        self._write(self._dir(user['id'], book_id) / 'cover.bin', data)
        with self.store.connect() as db:
            db.execute('UPDATE library_books SET has_cover=1 WHERE id=?', (book_id,))
        self._resize(user, book_id)

    def cover(self, user, book_id):
        with self.store.connect() as db:
            self._own(db, user, book_id)
        return self._read(self._dir(user['id'], book_id) / 'cover.bin')

    def project(self, user, book_id):
        with self.store.connect() as db:
            book = self._own(db, user, book_id)
        return self._read(self._dir(user['id'], book_id) / 'project.bin'), book['title']

    def save_export(self, user, book_id, kind, filename, data=None, source=None):
        """Keep the latest export of each kind (html / apk / exe) for the book.
        data: bytes, or source: a file path (server builds)."""
        if kind not in EXPORT_KINDS:
            raise AccountError(400, 'Jenis ekspor tidak dikenal.')
        if data is None:
            data = Path(source).read_bytes()
        if not data or len(data) > MAX_EXPORT:
            raise AccountError(413, 'File ekspor terlalu besar untuk arsip.')
        filename = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', '-', str(filename or '')).strip(' .')[:150] or f'book.{kind}'
        with self.store.connect() as db:
            self._own(db, user, book_id)
            old = db.execute('SELECT id FROM library_exports WHERE book_id=? AND kind=?', (book_id, kind)).fetchall()
        folder = self._dir(user['id'], book_id) / 'exports'
        replaced = sum((folder / f'{row["id"]}.bin').stat().st_size for row in old if (folder / f'{row["id"]}.bin').is_file())
        self._check_room(user, False, len(data) + 48 - replaced)
        export_id = secrets.token_hex(16)
        self._write(folder / f'{export_id}.bin', data)
        with self.store.connect() as db:
            db.execute('DELETE FROM library_exports WHERE book_id=? AND kind=?', (book_id, kind))
            db.execute('INSERT INTO library_exports(id, book_id, user_id, kind, filename, size, created_at) VALUES(?,?,?,?,?,?,?)',
                       (export_id, book_id, user['id'], kind, filename, len(data), int(time.time())))
        for row in old:
            (folder / f'{row["id"]}.bin').unlink(missing_ok=True)
        self._resize(user, book_id)
        return export_id

    def export(self, user, book_id, export_id):
        with self.store.connect() as db:
            self._own(db, user, book_id)
            row = db.execute('SELECT * FROM library_exports WHERE id=? AND book_id=?', (export_id, book_id)).fetchone()
        if not row or not re.fullmatch(r'[0-9a-f]{32}', export_id):
            raise AccountError(404, 'Ekspor tidak ditemukan.')
        return self._read(self._dir(user['id'], book_id) / 'exports' / f'{export_id}.bin'), row['filename']

    def delete(self, user, book_id):
        with self.store.connect() as db:
            self._own(db, user, book_id)
            db.execute('DELETE FROM library_exports WHERE book_id=?', (book_id,))
            db.execute('DELETE FROM library_books WHERE id=?', (book_id,))
        shutil.rmtree(self._dir(user['id'], book_id), ignore_errors=True)
