"""Public share links for exported flipbooks ("Share link").

A signed-in Pro/Business member uploads the sealed single-file HTML export
(the same bytes `packageSingleHtml` produces); the server keeps it under
`.data/shared/<id>.html` and serves it to anyone with the link at
`/s/<id>` — the book plays right in the browser, and `?dl=1` downloads
the file for keeping. Nothing is encrypted here: a shared book is public
by design, so members must not publish private documents.

Quotas follow the member's current plan (see SHARE_LIMITS). A downgrade
never deletes published links; it only stops new ones once over the limit.
"""
import re
import secrets
import time
from pathlib import Path

from accounts import AccountError

MB = 1024 * 1024
# plan -> (max links or None, max bytes). Free can only publish when the
# paywall is off (internal use): the 'export' gate already stops free
# members on a live server, so this small quota never opens paid sharing.
SHARE_LIMITS = {'free': (5, 200 * MB), 'pro': (20, 2 * 1024 * MB), 'business': (100, 10 * 1024 * MB)}
MAX_SHARE_FILE = 200 * MB
CHUNK = MB
MARKER = b'book-payload'
ID_RE = re.compile(r'[0-9a-f]{32}')


class Share:
    def __init__(self, store, folder):
        self.store = store                       # accounts.Accounts (same SQLite database)
        self.folder = Path(folder) / 'shared'
        self.folder.mkdir(parents=True, exist_ok=True)
        with store.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS shared_links(
                    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
                CREATE INDEX IF NOT EXISTS shared_user ON shared_links(user_id, created_at);
            ''')

    # ---- storage ---------------------------------------------------------
    def _path(self, link_id):
        if not link_id or not ID_RE.fullmatch(link_id):
            raise AccountError(404, 'Tautan berbagi tidak ditemukan.')
        return self.folder / (link_id + '.html')

    def _tmp(self, link_id):
        return self._path(link_id).with_suffix('.tmp')

    def tmp_path(self, link_id):
        """Destination for the streamed upload (validated by finalize)."""
        return self._tmp(link_id)

    # ---- quota -----------------------------------------------------------
    def usage(self, user):
        with self.store.connect() as db:
            row = db.execute('SELECT COUNT(*) AS links, COALESCE(SUM(size), 0) AS bytes FROM shared_links WHERE user_id=?',
                             (user['id'],)).fetchone()
        links, max_bytes = SHARE_LIMITS.get(user['plan'], SHARE_LIMITS['free'])
        return dict(links=row['links'], bytes=row['bytes'], maxLinks=links, maxBytes=max_bytes, plan=user['plan'])

    def check_room(self, user, extra_bytes):
        use = self.usage(user)
        if use['maxLinks'] is not None and use['links'] >= use['maxLinks']:
            raise AccountError(402, 'Batas tautan berbagi paket ini sudah penuh. Hapus tautan lama atau upgrade paket.')
        if use['bytes'] + max(0, extra_bytes) > use['maxBytes']:
            raise AccountError(402, 'Ruang berbagi paket ini sudah penuh. Hapus tautan lama atau upgrade paket.')

    # ---- API ---------------------------------------------------------------
    def create(self, user, title, size):
        self.check_room(user, size)
        link_id = secrets.token_hex(16)
        clean = (title or '').strip()[:120] or 'Buku'
        with self.store.connect() as db:
            db.execute('INSERT INTO shared_links(id, user_id, title, size, created_at) VALUES(?,?,?,?,?)',
                       (link_id, user['id'], clean, size, int(time.time())))
        return link_id, clean

    def finalize(self, link_id, size):
        """Validate the uploaded bytes look like our sealed book export."""
        path = self._tmp(link_id)
        try:
            with path.open('rb') as source:
                head = source.read(2048)
                found = MARKER in head
                while not found:
                    chunk = source.read(CHUNK)
                    if not chunk:
                        break
                    found = MARKER in chunk
            head_ok = head.lstrip()[:15].lower().startswith((b'<!doctype html', b'<html'))
            if not head_ok or not found:
                raise AccountError(400, 'File share bukan buku flipbook yang valid.')
        except AccountError:
            raise
        except OSError:
            raise AccountError(400, 'Upload tidak lengkap.')
        real = path.stat().st_size
        if real != size:
            raise AccountError(400, 'Upload tidak lengkap.')
        path.replace(self._path(link_id))
        with self.store.connect() as db:
            db.execute('UPDATE shared_links SET size=? WHERE id=?', (real, link_id))

    def discard(self, link_id):
        with self.store.connect() as db:
            db.execute('DELETE FROM shared_links WHERE id=?', (link_id,))
        for path in (self._tmp(link_id),):
            try:
                path.unlink()
            except OSError:
                pass

    def page(self, link_id):
        with self.store.connect() as db:
            row = db.execute('SELECT title FROM shared_links WHERE id=?', (link_id,)).fetchone()
        if not row:
            raise AccountError(404, 'Tautan berbagi tidak ditemukan.')
        path = self._path(link_id)
        if not path.is_file():
            raise AccountError(404, 'Tautan berbagi tidak ditemukan.')
        return row['title'], path.read_bytes()

    def mine(self, user):
        with self.store.connect() as db:
            rows = db.execute('SELECT id, title, size, created_at FROM shared_links WHERE user_id=? ORDER BY created_at DESC',
                              (user['id'],)).fetchall()
        return [dict(row) for row in rows]

    def remove(self, user, link_id):
        with self.store.connect() as db:
            row = db.execute('SELECT id FROM shared_links WHERE id=? AND user_id=?', (link_id, user['id'])).fetchone()
            if not row:
                raise AccountError(404, 'Tautan berbagi tidak ditemukan.')
            db.execute('DELETE FROM shared_links WHERE id=?', (link_id,))
        try:
            self._path(link_id).unlink()
        except OSError:
            pass
