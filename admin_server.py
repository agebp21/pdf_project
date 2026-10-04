"""MyFlipbook admin panel: a separate backend, apart from the member site.

  python admin_server.py                      # http://127.0.0.1:8091 (behind nginx: admin.<domain>)
  python admin_server.py --hash-password      # prints ADMIN_PASSWORD_HASH=... for .env
  python admin_server.py --grant EMAIL PLAN DAYS|lifetime   # give a member a plan without payment

Its own login (ADMIN_USERNAME + ADMIN_PASSWORD_HASH in .env), not a member
account; its own port, so the member site never serves it. It only reads the
databases (SQLite read-only): members, payments, what members keep in My
Library (titles, sizes, exports — never the books' contents) and the visitor
statistics written by server.py (visits.py).
"""
import argparse
import getpass
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import accounts
import visits

ROOT = Path(__file__).resolve().parent
COOKIE = 'mf_admin'
SESSION_SECONDS = 12 * 3600
MAX_FAILURES, FAILURE_WINDOW = 5, 15 * 60
CONFIG = dict(secure=False, proxy=False)
SESSIONS = {}                 # token -> expires_at (memory only: a restart logs the admin out)
FAILURES = {}                 # ip -> [failure times]
LOCK = threading.Lock()


def load_env(path):
    """KEY=VALUE lines from .env (same file as server.py), without overriding the environment."""
    try:
        lines = Path(path).read_text(encoding='utf-8').splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def db_path():
    return Path(os.environ.get('MYFLIPBOOK_DB') or ROOT / '.data' / 'myflipbook.sqlite3')


def read_only(path):
    """A read-only connection (None when the database does not exist yet)."""
    path = Path(path)
    if not path.is_file():
        return None
    db = sqlite3.connect(f'file:{path.as_posix()}?mode=ro', uri=True, timeout=10)
    db.row_factory = sqlite3.Row
    return db


def admin_configured():
    return bool(os.environ.get('ADMIN_USERNAME', '').strip() and os.environ.get('ADMIN_PASSWORD_HASH', '').strip())


def check_login(username, password):
    user = os.environ.get('ADMIN_USERNAME', '').strip()
    stored = os.environ.get('ADMIN_PASSWORD_HASH', '').strip()
    if not user or not stored or not isinstance(username, str) or not isinstance(password, str):
        return False
    same_user = hmac.compare_digest(username.strip().lower().encode(), user.lower().encode())
    return accounts.verify_password(password, stored) and same_user


def throttled(ip, now=None):
    now = now or time.time()
    with LOCK:
        recent = [t for t in FAILURES.get(ip, []) if now - t < FAILURE_WINDOW]
        FAILURES[ip] = recent
        return len(recent) >= MAX_FAILURES


def failed(ip):
    with LOCK:
        FAILURES.setdefault(ip, []).append(time.time())


# ---------- the numbers --------------------------------------------------
def paid_active(row, now):
    # Same rule as accounts.public_user: a paid plan needs an end date in the future.
    return row['plan'] != 'free' and bool(row['plan_expires_at']) and row['plan_expires_at'] > now


def overview(now=None):
    now = int(now or time.time())
    out = dict(members=0, verified=0, google=0, paid=0, new7=0, new30=0, plans={}, revenue={}, orders={},
               books=0, bookBytes=0, exports=0, uploaders=0, visits=None)
    db = read_only(db_path())
    if db:
        with db:
            users = db.execute('SELECT plan, plan_expires_at, verified, google_sub, created_at FROM users').fetchall()
            out['members'] = len(users)
            for u in users:
                out['verified'] += 1 if u['verified'] else 0
                out['google'] += 1 if u['google_sub'] else 0
                out['new7'] += 1 if u['created_at'] > now - 7 * 86400 else 0
                out['new30'] += 1 if u['created_at'] > now - 30 * 86400 else 0
                active = paid_active(u, now)
                out['paid'] += 1 if active else 0
                plan = u['plan'] if active else 'free'
                out['plans'][plan] = out['plans'].get(plan, 0) + 1
            for r in db.execute("SELECT currency, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM orders WHERE status='paid' GROUP BY currency"):
                out['revenue'][r['currency']] = dict(orders=r['n'], total=r['total'])
            for r in db.execute('SELECT status, COUNT(*) AS n FROM orders GROUP BY status'):
                out['orders'][r['status']] = r['n']
            if has_table(db, 'library_books'):
                r = db.execute('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes, COUNT(DISTINCT user_id) AS users FROM library_books').fetchone()
                out.update(books=r['n'], bookBytes=r['bytes'], uploaders=r['users'])
                out['exports'] = db.execute('SELECT COUNT(*) FROM library_exports').fetchone()[0]
        db.close()
    v = read_only(db_path().parent / 'visits.sqlite3')
    if v:
        with v:
            out['visits'] = visits.stats(v, 30, now) if has_table(v, 'visits') else None
        v.close()
    return out


def has_table(db, name):
    return bool(db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())


def member_row(r, now):
    return dict(id=r['id'], email=r['email'], name=r['name'], plan=r['plan'], planExpiresAt=r['plan_expires_at'],
                paid=paid_active(r, now), verified=bool(r['verified']), google=bool(r['google_sub']), createdAt=r['created_at'],
                books=r['books'] if 'books' in r.keys() else 0, bytes=r['bytes'] if 'bytes' in r.keys() else 0)


def members(q='', page=1, per=50, now=None):
    now = int(now or time.time())
    db = read_only(db_path())
    if not db:
        return dict(total=0, items=[], page=1, per=per)
    with db:
        lib = has_table(db, 'library_books')
        where, args = '', []
        if q:
            where = 'WHERE u.email LIKE ? OR u.name LIKE ?'
            args = [f'%{q}%', f'%{q}%']
        total = db.execute(f'SELECT COUNT(*) FROM users u {where}', args).fetchone()[0]
        books = ('(SELECT COUNT(*) FROM library_books b WHERE b.user_id=u.id) AS books, '
                 '(SELECT COALESCE(SUM(size), 0) FROM library_books b WHERE b.user_id=u.id) AS bytes') if lib else '0 AS books, 0 AS bytes'
        rows = db.execute(f'SELECT u.*, {books} FROM users u {where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?',
                          args + [per, (page - 1) * per]).fetchall()
    db.close()
    return dict(total=total, page=page, per=per, items=[member_row(r, now) for r in rows])


def member(user_id, now=None):
    now = int(now or time.time())
    db = read_only(db_path())
    if not db:
        return None
    with db:
        r = db.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
        if not r:
            return None
        out = member_row(r, now)
        out['orders'] = [dict(id=o['id'], plan=o['plan'], cycle=o['cycle'], amount=o['amount'], currency=o['currency'],
                              status=o['status'], provider=o['provider'], createdAt=o['created_at'], paidAt=o['paid_at'])
                         for o in db.execute('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100', (user_id,))]
        out['books'] = uploads_rows(db, 'WHERE b.user_id=?', [user_id], 500) if has_table(db, 'library_books') else []
        out['sessions'] = db.execute('SELECT COUNT(*) FROM sessions WHERE user_id=? AND expires_at>?', (user_id, now)).fetchone()[0]
    db.close()
    v = read_only(db_path().parent / 'visits.sqlite3')
    if v:
        with v:
            if has_table(v, 'visits'):
                row = v.execute('SELECT COUNT(*) AS n, MAX(ts) AS last FROM visits WHERE user_id=?', (user_id,)).fetchone()
                out['visits'], out['lastVisit'] = row['n'], row['last']
        v.close()
    return out


def uploads_rows(db, where, args, limit):
    rows = db.execute(f'''SELECT b.*, u.email FROM library_books b JOIN users u ON u.id=b.user_id {where}
                          ORDER BY b.updated_at DESC LIMIT ?''', args + [limit]).fetchall()
    ids = [r['id'] for r in rows]
    exports = {}
    if ids:
        marks = ','.join('?' * len(ids))
        for e in db.execute(f'SELECT book_id, kind, filename, size, created_at FROM library_exports WHERE book_id IN ({marks}) ORDER BY created_at DESC', ids):
            exports.setdefault(e['book_id'], []).append(dict(kind=e['kind'], filename=e['filename'], size=e['size'], createdAt=e['created_at']))
    return [dict(id=r['id'], title=r['title'], owner=r['email'], userId=r['user_id'], pages=r['page_count'], size=r['size'],
                 createdAt=r['created_at'], updatedAt=r['updated_at'], exports=exports.get(r['id'], [])) for r in rows]


def uploads(q='', limit=200):
    db = read_only(db_path())
    if not db:
        return dict(items=[])
    with db:
        if not has_table(db, 'library_books'):
            return dict(items=[])
        where, args = ('WHERE b.title LIKE ? OR u.email LIKE ?', [f'%{q}%', f'%{q}%']) if q else ('', [])
        items = uploads_rows(db, where, args, limit)
    db.close()
    return dict(items=items)


def visitor_stats(days=30):
    v = read_only(db_path().parent / 'visits.sqlite3')
    if not v:
        return None
    with v:
        out = visits.stats(v, days) if has_table(v, 'visits') else None
    v.close()
    return out


def server_status():
    """Which settings are filled in (never their values) and the disk."""
    keys = ['GOOGLE_CLIENT_ID', 'GOOGLE_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SUMOPOD_API_KEY', 'MIDTRANS_SERVER_KEY',
            'TRIPAY_API_KEY', 'LEMONSQUEEZY_API_KEY', 'YOUTUBE_API_KEY']
    try:
        import shutil
        disk = shutil.disk_usage(db_path().parent if db_path().parent.exists() else ROOT)
        disk = dict(total=disk.total, free=disk.free)
    except OSError:
        disk = None
    folder = db_path().parent
    size = lambda p: p.stat().st_size if p.is_file() else 0
    library = sum(f.stat().st_size for f in (folder / 'library').rglob('*') if f.is_file()) if (folder / 'library').exists() else 0
    return dict(settings={k: bool(os.environ.get(k, '').strip()) for k in keys}, disk=disk,
                database=size(folder / db_path().name), visitsDb=size(folder / 'visits.sqlite3'), library=library)


# ---------- HTTP -----------------------------------------------------------
class AdminHandler(BaseHTTPRequestHandler):
    server_version = 'MyFlipbookAdmin'

    def log_message(self, fmt, *args):
        pass

    def client_ip(self):
        forwarded = self.headers.get('X-Forwarded-For', '') if CONFIG['proxy'] else ''
        return forwarded.split(',')[0].strip() or self.client_address[0]

    def secure(self):
        return CONFIG['secure'] or (CONFIG['proxy'] and self.headers.get('X-Forwarded-Proto', '') == 'https')

    def token(self):
        for part in self.headers.get('Cookie', '').split(';'):
            name, _, value = part.strip().partition('=')
            if name == COOKIE:
                return value
        return ''

    def signed_in(self):
        token = self.token()
        with LOCK:
            expires = SESSIONS.get(token)
            if expires and expires > time.time():
                return True
            SESSIONS.pop(token, None)
        return False

    def common_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
                                                    "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'")

    def send_json(self, status, payload, cookie=None):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        if cookie is not None:
            self.send_header('Set-Cookie', cookie)
        self.common_headers()
        self.end_headers()
        self.wfile.write(body)

    def cookie(self, token, max_age):
        return f'{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}' + ('; Secure' if self.secure() else '')

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path in ('/', '/index.html'):
            page = (ROOT / 'admin' / 'index.html').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(page)))
            self.common_headers()
            self.end_headers()
            self.wfile.write(page)
            return
        if url.path == '/api/session':
            self.send_json(200, dict(signedIn=self.signed_in(), configured=admin_configured()))
            return
        if not url.path.startswith('/api/'):
            self.send_json(404, {'error': 'Tidak ditemukan.'})
            return
        if not self.signed_in():
            self.send_json(401, {'error': 'Masuk sebagai admin dulu.'})
            return
        q = parse_qs(url.query)
        arg = lambda name, default='': (q.get(name) or [default])[0]
        try:
            if url.path == '/api/overview':
                self.send_json(200, overview())
            elif url.path == '/api/members':
                page = max(1, min(10000, int(arg('page', '1') or 1)))
                self.send_json(200, members(arg('q').strip()[:100], page))
            elif re.fullmatch(r'/api/members/\d{1,12}', url.path):
                found = member(int(url.path.rsplit('/', 1)[1]))
                self.send_json(200 if found else 404, found or {'error': 'Member tidak ditemukan.'})
            elif url.path == '/api/uploads':
                self.send_json(200, uploads(arg('q').strip()[:100]))
            elif url.path == '/api/visits':
                days = max(1, min(365, int(arg('days', '30') or 30)))
                self.send_json(200, visitor_stats(days) or {'days': days, 'daily': [], 'pages': [], 'referrers': [], 'devices': []})
            elif url.path == '/api/server':
                self.send_json(200, server_status())
            else:
                self.send_json(404, {'error': 'Tidak ditemukan.'})
        except (ValueError, sqlite3.Error) as cause:
            self.send_json(500, {'error': 'Data tidak bisa dibaca: ' + str(cause)})

    def do_POST(self):
        url = urlsplit(self.path)
        # JSON only, from this page (a form on another site cannot set the header).
        if self.headers.get('X-Admin') != '1' or self.headers.get_content_type() != 'application/json':
            self.send_json(403, {'error': 'Permintaan ditolak.'})
            return
        if url.path == '/api/login':
            ip = self.client_ip()
            if throttled(ip):
                self.send_json(429, {'error': 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.'})
                return
            if not admin_configured():
                self.send_json(503, {'error': 'Login admin belum diatur: isi ADMIN_USERNAME dan ADMIN_PASSWORD_HASH di .env '
                                              '(python admin_server.py --hash-password).'})
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                body = json.loads(self.rfile.read(size) if 0 < size <= 4096 else b'{}')
            except (ValueError, json.JSONDecodeError):
                body = {}
            if not isinstance(body, dict) or not check_login(body.get('username'), body.get('password')):
                failed(ip)
                time.sleep(0.5)
                self.send_json(401, {'error': 'Username atau password admin salah.'})
                return
            token = secrets.token_urlsafe(32)
            with LOCK:
                now = time.time()
                for t in [t for t, e in SESSIONS.items() if e < now]:
                    SESSIONS.pop(t, None)
                SESSIONS[token] = now + SESSION_SECONDS
            self.send_json(200, {'ok': True}, cookie=self.cookie(token, SESSION_SECONDS))
            return
        if url.path == '/api/logout':
            with LOCK:
                SESSIONS.pop(self.token(), None)
            self.send_json(200, {'ok': True}, cookie=self.cookie('', 0))
            return
        self.send_json(404, {'error': 'Tidak ditemukan.'})


def main():
    parser = argparse.ArgumentParser(description='MyFlipbook admin panel (separate backend).')
    parser.add_argument('--host', default='127.0.0.1', help='127.0.0.1 (default): reach it through nginx or an SSH tunnel.')
    parser.add_argument('--port', type=int, default=8091)
    parser.add_argument('--proxy', action='store_true', help='Behind nginx: trust X-Forwarded-For / X-Forwarded-Proto.')
    parser.add_argument('--secure', action='store_true', help='Always mark the cookie Secure (HTTPS).')
    parser.add_argument('--hash-password', action='store_true', help='Print ADMIN_PASSWORD_HASH=... for a new password.')
    parser.add_argument('--grant', nargs=3, metavar=('EMAIL', 'PLAN', 'DAYS'),
                        help='Give a member a plan (free/pro/business) for DAYS more days, or "lifetime", without payment.')
    args = parser.parse_args()
    if args.grant:
        load_env(ROOT / '.env')
        email, plan, days = args.grant
        if days.lower() not in ('lifetime', 'bypass') and not days.isdigit():
            sys.exit('DAYS must be a number of days or "lifetime".')
        try:
            user = accounts.Accounts(str(db_path())).grant_plan(email, plan.lower(), None if not days.isdigit() else int(days))
        except accounts.AccountError as cause:
            sys.exit(str(cause))
        until = 'tanpa batas' if user['planExpiresAt'] == accounts.Accounts.LIFETIME else (
            time.strftime('%Y-%m-%d', time.localtime(user['planExpiresAt'])) if user['planExpiresAt'] else '-')
        line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} grant {user['email']} -> {user['planName']} ({until})"
        with open(db_path().parent / 'admin.log', 'a', encoding='utf-8') as log:
            log.write(line + '\n')
        print(line)
        return
    if args.hash_password:
        first = getpass.getpass('New admin password (at least 12 characters): ')
        if len(first) < 12 or getpass.getpass('Again: ') != first:
            sys.exit('Passwords differ or too short.')
        print('ADMIN_PASSWORD_HASH=' + accounts.hash_password(first))
        return
    load_env(ROOT / '.env')
    CONFIG['proxy'], CONFIG['secure'] = args.proxy, args.secure
    httpd = ThreadingHTTPServer((args.host, args.port), AdminHandler)
    print(f'MyFlipbook admin: http://{args.host}:{args.port}  (database: {db_path()})'
          + ('' if admin_configured() else '  — login not set: ADMIN_USERNAME + ADMIN_PASSWORD_HASH in .env'))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
