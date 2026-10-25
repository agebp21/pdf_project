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
import hashlib
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
import admin_report
import geo
import visits

ROOT = Path(__file__).resolve().parent
COOKIE = 'mf_admin'
SESSION_SECONDS = 12 * 3600
MAX_FAILURES, FAILURE_WINDOW = 5, 15 * 60
CONFIG = dict(secure=False, proxy=False)
SESSIONS = {}                 # token -> expires_at (memory only: a restart logs the admin out)
SESSION_USERS = {}            # token -> authenticated admin username
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


def set_env_value(path, key, value):
    """Update one .env key atomically while preserving other settings."""
    path = Path(path)
    try:
        lines = path.read_text(encoding='utf-8').splitlines(keepends=True)
    except FileNotFoundError:
        lines = []
    replacement = f'{key}={value}\n'
    found = False
    out = []
    for line in lines:
        raw = line.rstrip('\r\n')
        if raw.strip() and not raw.lstrip().startswith('#') and '=' in raw:
            name = raw.split('=', 1)[0].strip()
            if name == key:
                if not found:
                    out.append(replacement)
                    found = True
                continue
        out.append(line)
    if not found:
        if out and not out[-1].endswith(('\n', '\r')):
            out.append('\n')
        out.append(replacement)
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(''.join(out), encoding='utf-8', newline='')
    os.replace(tmp, path)


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
    if not isinstance(username, str) or not isinstance(password, str):
        return False
    for name_key, hash_key in admin_credentials():
        user = os.environ.get(name_key, '').strip()
        stored = os.environ.get(hash_key, '').strip()
        if user and stored and hmac.compare_digest(username.strip().lower().encode(), user.lower().encode()):
            return accounts.verify_password(password, stored)
    return False


def admin_credentials():
    return (('ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH'),
            ('ADMIN_SECONDARY_USERNAME', 'ADMIN_SECONDARY_PASSWORD_HASH'))


def admin_password_key(username):
    for name_key, hash_key in admin_credentials():
        if username.lower() == os.environ.get(name_key, '').strip().lower():
            return hash_key
    raise ValueError('Unknown admin')




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
    return row['plan'] not in ('free', 'basic') and bool(row['plan_expires_at']) and row['plan_expires_at'] > now


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
                plan = u['plan'] if active else 'basic'
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
            skip, keep = label_keys()
            out['visits'] = visits.stats(v, 30, now, team_ids(), skip, keep) if has_table(v, 'visits') else None
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
        # this month's summary words against the plan's allowance (accounts.SUMMARY_WORDS)
        start, end = accounts.month_bounds(now)
        used = db.execute("SELECT COALESCE(SUM(amount), 0) FROM usage WHERE user_id=? AND kind='summary_words' AND at>=?",
                          (user_id, start)).fetchone()[0] if has_table(db, 'usage') else 0
        tier = r['plan'] if r['plan'] in accounts.PAID and paid_active(r, now) else 'medium'
        out['summaryWords'] = dict(used=used, limit=accounts.SUMMARY_WORDS.get(tier), resetAt=end)
        if 'referred_by' in r.keys():
            by = db.execute('SELECT email FROM users WHERE id=?', (r['referred_by'],)).fetchone() if r['referred_by'] else None
            subscribed = db.execute("""SELECT COUNT(DISTINCT u.id) FROM users u JOIN orders o ON o.user_id=u.id
                                       WHERE u.referred_by=? AND o.status='paid' AND o.plan IN ('medium','pro')""", (user_id,)).fetchone()[0]
            rewards = db.execute('SELECT COUNT(*) FROM referral_rewards WHERE user_id=?', (user_id,)).fetchone()[0] if has_table(db, 'referral_rewards') else 0
            out['referral'] = dict(code=r['ref_code'], referredBy=by['email'] if by else None,
                                   signups=db.execute('SELECT COUNT(*) FROM users WHERE referred_by=?', (user_id,)).fetchone()[0],
                                   subscribed=subscribed, rewards=rewards)
    db.close()
    v = read_only(db_path().parent / 'visits.sqlite3')
    if v:
        with v:
            if has_table(v, 'visits'):
                row = v.execute('SELECT COUNT(*) AS n, MAX(ts) AS last FROM visits WHERE user_id=?', (user_id,)).fetchone()
                out['visits'], out['lastVisit'] = row['n'], row['last']
                if {'country', 'region', 'city', 'isp'} <= {r[1] for r in v.execute('PRAGMA table_info(visits)')}:
                    out['places'] = [dict(r) for r in v.execute(
                        """SELECT country, region, city, isp, device, MAX(ts) AS last, COUNT(*) AS views FROM visits
                           WHERE user_id=? AND country != '' GROUP BY country, region, city, isp, device ORDER BY last DESC LIMIT 10""", (user_id,))]
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


def team_ids():
    """Member ids of the team (STATS_EXCLUDE_EMAILS): left out of the statistics."""
    emails = [e.strip().lower() for e in os.environ.get('STATS_EXCLUDE_EMAILS', '').split(',') if e.strip()]
    if not emails:
        return []
    db = read_only(db_path())
    if not db:
        return []
    with db:
        ids = [r[0] for r in db.execute('SELECT id FROM users WHERE email IN (%s)' % ','.join('?' * len(emails)), emails)]
    db.close()
    return ids


def day_of(ts):
    return time.strftime('%Y-%m-%d', time.localtime(ts))


def growth(days, now=None):
    """Per day: new members, feature use (conversions, AI, translated characters)
    and books kept in My Library — without the team."""
    now = int(now or time.time())
    since_ts = int(time.mktime(time.strptime(day_of(now - (days - 1) * 86400), '%Y-%m-%d')))
    team = set(team_ids())
    rows = {}
    db = read_only(db_path())
    if db:
        with db:
            for r in db.execute('SELECT id, created_at FROM users WHERE created_at >= ?', (since_ts,)):
                if r['id'] not in team:
                    rows.setdefault(day_of(r['created_at']), {}).setdefault('members', 0)
                    rows[day_of(r['created_at'])]['members'] += 1
            if has_table(db, 'usage'):
                for r in db.execute('SELECT user_id, kind, amount, at FROM usage WHERE at >= ?', (since_ts,)):
                    if r['user_id'] not in team:
                        day = rows.setdefault(day_of(r['at']), {})
                        day[r['kind']] = day.get(r['kind'], 0) + r['amount']
            if has_table(db, 'library_books'):
                for r in db.execute('SELECT user_id, created_at FROM library_books WHERE created_at >= ?', (since_ts,)):
                    if r['user_id'] not in team:
                        day = rows.setdefault(day_of(r['created_at']), {})
                        day['books'] = day.get('books', 0) + 1
        db.close()
    return rows


def labels_path():
    return db_path().parent / 'admin-labels.sqlite3'


def log_admin(text):
    try:
        with open(db_path().parent / 'admin.log', 'a', encoding='utf-8') as log:
            log.write(time.strftime('%Y-%m-%d %H:%M:%S') + ' ' + text + '\n')
    except OSError:
        pass


def get_labels():
    """The admin's own corrections in the visitor list: {visitor || day: 'team' | 'bot' | 'human'}."""
    path = labels_path()
    if not path.exists():
        return {}
    db = sqlite3.connect(path, timeout=10)
    try:
        return dict(db.execute('SELECT key, kind FROM labels'))
    except sqlite3.Error:
        return {}
    finally:
        db.close()


def set_label(key, kind):
    if not re.fullmatch(r'[0-9a-f]{16}\d{4}-\d{2}-\d{2}', str(key or '')) or kind not in ('team', 'bot', 'human', ''):
        raise ValueError('Label tidak valid.')
    db = sqlite3.connect(labels_path(), timeout=10)
    try:
        with db:
            db.execute('CREATE TABLE IF NOT EXISTS labels(key TEXT PRIMARY KEY, kind TEXT NOT NULL, at INTEGER NOT NULL)')
            if kind:
                db.execute('INSERT OR REPLACE INTO labels VALUES(?,?,?)', (key, kind, int(time.time())))
            else:
                db.execute('DELETE FROM labels WHERE key=?', (key,))
    finally:
        db.close()
    log_admin(f'label {key} {kind or "cleared"}')


def label_keys():
    labels = get_labels()
    return [k for k, v in labels.items() if v in ('team', 'bot')], [k for k, v in labels.items() if v == 'human']


def visitor_list(days=30):
    v = read_only(db_path().parent / 'visits.sqlite3')
    items = []
    if v:
        with v:
            if has_table(v, 'visits'):
                items = visits.visitors(v, days, None, team_ids(), get_labels())
        v.close()
    ids = {u for g in items for u in g['users']}
    db = read_only(db_path()) if ids else None
    emails = {}
    if db:
        with db:
            emails = {r['id']: r['email'] for r in db.execute('SELECT id, email FROM users WHERE id IN (%s)' % ','.join('?' * len(ids)), list(ids))}
        db.close()
    for g in items:
        g['members'] = [emails.get(u, f'#{u}') for u in g.pop('users')]
    counts = {}
    for g in items:
        counts[g['status']] = counts.get(g['status'], 0) + 1
    return {'days': days, 'items': items, 'counts': counts}


def visitor_stats(days=30):
    v = read_only(db_path().parent / 'visits.sqlite3')
    out = None
    if v:
        with v:
            skip, keep = label_keys()
            out = visits.stats(v, days, None, team_ids(), skip, keep) if has_table(v, 'visits') else None
        v.close()
    out = out or {'days': days, 'daily': [], 'pages': [], 'referrers': [], 'devices': [], 'countries': [], 'regions': [], 'cities': [],
                  'isps': [], 'recent': [], 'views': 0, 'visitors': 0, 'average': 0, 'members': 0, 'today': {}}
    more = growth(days)
    for d in out['daily']:
        extra = more.get(d['day'], {})
        d.update(members=extra.get('members', 0), office=extra.get('office', 0), ai=extra.get('ai', 0),
                 translate=extra.get('translate', 0), books=extra.get('books', 0))
    if not out['daily']:
        out['daily'] = [dict(day=day, views=0, visitors=0, **{k: more[day].get(k, 0) for k in ('members', 'office', 'ai', 'translate', 'books')})
                        for day in sorted(more)]
    out['newMembers'] = sum(d.get('members', 0) for d in out['daily'])
    out['geoReady'] = all((geo.folder() / f).exists() for f in geo.FILES.values())
    ids = {r['user_id'] for r in out.get('recent', []) if r.get('user_id')}
    db = read_only(db_path()) if ids else None
    if db:
        with db:
            emails = {r['id']: r['email'] for r in db.execute('SELECT id, email FROM users WHERE id IN (%s)' % ','.join('?' * len(ids)), list(ids))}
        db.close()
        for r in out['recent']:
            r['member'] = emails.get(r.get('user_id'))
    out['teamExcluded'] = len(team_ids())
    return out


def report_csv(days=30):
    rows = ['tanggal,pengunjung,tampilan_halaman,member_baru,konversi,ai,huruf_diterjemahkan,buku_disimpan']
    for d in visitor_stats(days)['daily']:
        rows.append(','.join(str(x) for x in (d['day'], d['visitors'], d['views'], d.get('members', 0), d.get('office', 0),
                                              d.get('ai', 0), d.get('translate', 0), d.get('books', 0))))
    return '\n'.join(rows) + '\n'


def report_pdf(days=30, now=None):
    """The audit report (admin_report.build) with the same numbers as the panel, plus the period's orders."""
    now = int(now or time.time())
    since = int(time.mktime(time.strptime(day_of(now - (days - 1) * 86400), '%Y-%m-%d')))
    orders = []
    db = read_only(db_path())
    if db:
        with db:
            orders = [dict(r) for r in db.execute(
                'SELECT o.id, u.email, o.plan, o.cycle, o.amount, o.currency, o.status, o.provider, o.created_at, o.paid_at '
                'FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE COALESCE(o.paid_at, o.created_at) >= ? '
                'ORDER BY COALESCE(o.paid_at, o.created_at) DESC LIMIT 500', (since,))]
        db.close()
    return admin_report.build(days, overview(now), visitor_stats(days), orders, server_status(), now)


def server_status():
    """Which settings are filled in (never their values) and the disk."""
    keys = ['GOOGLE_CLIENT_ID', 'GOOGLE_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SUMOPOD_API_KEY', 'DUITKU_MERCHANT_CODE', 'DUITKU_API_KEY', 'MIDTRANS_SERVER_KEY',
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


# ---------- monitoring API keys ---------------------------------------------
# Read-only keys for another program (an AI agent watching traffic, an audit
# script) to read the numbers without the admin login (owner, 2026-10-23).
# A key sends "Authorization: Bearer mfa_..." and may only GET MONITOR_PATHS:
# no member list, member detail, uploads or visitor list (emails), and the
# recent visits lose their member ids. Only a SHA-256 of each key is kept,
# in .data/admin-api-keys.json; the key itself is shown once when made.
MONITOR_PATHS = {'/api/overview', '/api/visits', '/api/server', '/api/report.csv'}
KEY_PREFIX = 'mfa_'
KEY_RATE = 60                                       # requests per key per minute
KEY_HITS = {}                                       # key hash -> recent request times


def keys_path():
    return db_path().parent / 'admin-api-keys.json'


def load_keys():
    try:
        return json.loads(keys_path().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def save_keys(keys):
    path = keys_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(keys, indent=1), encoding='utf-8')
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, path)


def key_hash(key):
    return hashlib.sha256(key.encode('utf-8')).hexdigest()


def new_key(name):
    """A new monitoring key for `name` (letters, digits, - and _). Returns the key; only its hash is stored."""
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', name or ''):
        raise ValueError('Name: 1-40 letters, digits, - or _.')
    with LOCK:
        keys = load_keys()
        if any(k['name'] == name for k in keys.values()):
            raise ValueError(f'A key named {name} already exists (revoke it first).')
        key = KEY_PREFIX + secrets.token_urlsafe(32)
        keys[key_hash(key)] = dict(name=name, created=int(time.time()), lastUsed=None, uses=0)
        save_keys(keys)
    log_admin(f'api key made: {name}')
    return key


def revoke_key(name):
    with LOCK:
        keys = load_keys()
        gone = [h for h, k in keys.items() if k['name'] == name]
        for h in gone:
            del keys[h]
        save_keys(keys)
    if gone:
        log_admin(f'api key revoked: {name}')
    return bool(gone)


def key_user(key):
    """The key's record when `key` is a live monitoring key (and under its rate), else None / 'busy'."""
    if not key.startswith(KEY_PREFIX) or len(key) > 100:
        return None
    digest = key_hash(key)
    with LOCK:
        keys = load_keys()
        found = next((k for h, k in keys.items() if hmac.compare_digest(h, digest)), None)
        if not found:
            return None
        now = time.time()
        hits = [t for t in KEY_HITS.get(digest, []) if t > now - 60]
        if len(hits) >= KEY_RATE:
            KEY_HITS[digest] = hits
            return 'busy'
        KEY_HITS[digest] = hits + [now]
        found['lastUsed'] = int(now); found['uses'] = found.get('uses', 0) + 1
        save_keys(keys)
    return found


def for_key(path, payload):
    """What a monitoring key may see of `payload`: recent visits without member ids or emails."""
    if path == '/api/visits' and isinstance(payload, dict):
        payload = dict(payload, recent=[{k: v for k, v in r.items() if k not in ('user_id', 'member')} for r in payload.get('recent', [])])
    if path == '/api/overview' and isinstance(payload, dict) and isinstance(payload.get('visits'), dict):
        visits_out = payload['visits']
        payload = dict(payload, visits=dict(visits_out, recent=[{k: v for k, v in r.items() if k not in ('user_id', 'member')}
                                                                for r in visits_out.get('recent', [])]))
    return payload


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
        if getattr(self, 'via_key', False):
            payload = for_key(urlsplit(self.path).path, payload)
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
        bearer = self.headers.get('Authorization', '')
        self.via_key = False
        if bearer.lower().startswith('bearer '):
            found = key_user(bearer[7:].strip())
            if found == 'busy':
                self.send_json(429, {'error': f'Too many requests: at most {KEY_RATE} a minute per key.'})
                return
            if not found:
                self.send_json(401, {'error': 'Unknown or revoked API key.'})
                return
            if url.path not in MONITOR_PATHS:
                self.send_json(403, {'error': 'This key may read only: ' + ', '.join(sorted(MONITOR_PATHS)) + '.'})
                return
            self.via_key = True
        elif not self.signed_in():
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
                self.send_json(200, visitor_stats(days))
            elif url.path == '/api/visitors':
                days = max(1, min(90, int(arg('days', '7') or 7)))
                self.send_json(200, visitor_list(days))
            elif url.path == '/api/report.csv':
                days = max(1, min(365, int(arg('days', '30') or 30)))
                body = ('\ufeff' + report_csv(days)).encode('utf-8')        # BOM: Excel reads it as UTF-8
                self.send_response(200)
                self.send_header('Content-Type', 'text/csv; charset=utf-8')
                self.send_header('Content-Disposition', f'attachment; filename="myflipbook-laporan-{days}-hari.csv"')
                self.send_header('Content-Length', str(len(body)))
                self.common_headers()
                self.end_headers()
                self.wfile.write(body)
            elif url.path == '/api/report.pdf':
                days = max(1, min(365, int(arg('days', '30') or 30)))
                body = report_pdf(days)
                self.send_response(200)
                self.send_header('Content-Type', 'application/pdf')
                self.send_header('Content-Disposition', f'attachment; filename="myflipbook-laporan-{days}-hari-{time.strftime("%Y%m%d")}.pdf"')
                self.send_header('Content-Length', str(len(body)))
                self.common_headers()
                self.end_headers()
                self.wfile.write(body)
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
                    SESSION_USERS.pop(t, None)
                SESSIONS[token] = now + SESSION_SECONDS
                SESSION_USERS[token] = body['username'].strip().lower()
            self.send_json(200, {'ok': True}, cookie=self.cookie(token, SESSION_SECONDS))
            return
        if url.path == '/api/logout':
            with LOCK:
                SESSIONS.pop(self.token(), None)
                SESSION_USERS.pop(self.token(), None)
            self.send_json(200, {'ok': True}, cookie=self.cookie('', 0))
            return
        if not self.signed_in():
            self.send_json(401, {'error': 'Masuk sebagai admin dulu.'})
            return
        if url.path == '/api/change-password':
            try:
                size = int(self.headers.get('Content-Length', '0'))
                body = json.loads(self.rfile.read(size) if 0 < size <= 8192 else b'{}')
            except (ValueError, json.JSONDecodeError):
                body = {}
            current = body.get('currentPassword') if isinstance(body, dict) else None
            new = body.get('newPassword') if isinstance(body, dict) else None
            confirm = body.get('confirmPassword') if isinstance(body, dict) else None
            if not all(isinstance(value, str) for value in (current, new, confirm)):
                self.send_json(400, {'error': 'Data password tidak lengkap.'})
                return
            username = SESSION_USERS.get(self.token(), '')
            if not username or not check_login(username, current):
                self.send_json(401, {'error': 'Password saat ini salah.'})
                return
            if len(new) < 12:
                self.send_json(400, {'error': 'Password baru minimal 12 karakter.'})
                return
            if new != confirm:
                self.send_json(400, {'error': 'Konfirmasi password baru tidak sama.'})
                return
            if new == current:
                self.send_json(400, {'error': 'Password baru harus berbeda dari password saat ini.'})
                return
            try:
                password_hash = accounts.hash_password(new)
                hash_key = admin_password_key(username)
                set_env_value(ROOT / '.env', hash_key, password_hash)
                os.environ[hash_key] = password_hash
                log_admin('admin password changed: ' + username)
            except OSError as cause:
                self.send_json(500, {'error': 'Password tidak bisa disimpan: ' + str(cause)})
                return
            current_token = self.token()
            with LOCK:
                for token in list(SESSIONS):
                    if token != current_token and SESSION_USERS.get(token) == username:
                        SESSIONS.pop(token, None)
                        SESSION_USERS.pop(token, None)
                SESSIONS[current_token] = time.time() + SESSION_SECONDS
            self.send_json(200, {'ok': True})
            return
        if url.path == '/api/visitors/label':
            try:
                size = int(self.headers.get('Content-Length', '0'))
                body = json.loads(self.rfile.read(size) if 0 < size <= 4096 else b'{}')
                set_label(body.get('key'), body.get('kind') or '')
            except (ValueError, json.JSONDecodeError, AttributeError) as cause:
                self.send_json(400, {'error': str(cause) or 'Label tidak valid.'})
                return
            self.send_json(200, {'ok': True})
            return
        self.send_json(404, {'error': 'Tidak ditemukan.'})


def main():
    parser = argparse.ArgumentParser(description='MyFlipbook admin panel (separate backend).')
    parser.add_argument('--host', default='127.0.0.1', help='127.0.0.1 (default): reach it through nginx or an SSH tunnel.')
    parser.add_argument('--port', type=int, default=8091)
    parser.add_argument('--proxy', action='store_true', help='Behind nginx: trust X-Forwarded-For / X-Forwarded-Proto.')
    parser.add_argument('--secure', action='store_true', help='Always mark the cookie Secure (HTTPS).')
    parser.add_argument('--hash-password', action='store_true', help='Print ADMIN_PASSWORD_HASH=... for a new password.')
    parser.add_argument('--new-api-key', metavar='NAME', help='Make a read-only monitoring key (printed once; only its hash is kept).')
    parser.add_argument('--revoke-api-key', metavar='NAME', help='Revoke the monitoring key with this name.')
    parser.add_argument('--list-api-keys', action='store_true', help='List the monitoring keys (names, dates, uses; never the keys).')
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
    if args.new_api_key or args.revoke_api_key or args.list_api_keys:
        load_env(ROOT / '.env')
        if args.new_api_key:
            try:
                print(new_key(args.new_api_key))
            except ValueError as cause:
                sys.exit(str(cause))
        elif args.revoke_api_key:
            print('revoked' if revoke_key(args.revoke_api_key) else 'no such key')
        else:
            for k in load_keys().values():
                when = lambda t: time.strftime('%Y-%m-%d %H:%M', time.localtime(t)) if t else '-'
                print(f"{k['name']}	made {when(k['created'])}	last used {when(k.get('lastUsed'))}	uses {k.get('uses', 0)}")
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
