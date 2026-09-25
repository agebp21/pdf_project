"""MyFlipbook accounts, sessions, plans and billing — Python stdlib only.

Storage: one SQLite file (default .data/myflipbook.sqlite3, ignored by Git).
Passwords: PBKDF2-HMAC-SHA256, per-user salt. Sessions: random token in an
HttpOnly cookie; only its SHA-256 is stored, so a leaked DB can't log in.

Payments go through a provider object:
  * MidtransProvider — Midtrans Snap redirect + signed HTTP notification
    (set MIDTRANS_SERVER_KEY; MIDTRANS_PRODUCTION=1 for live).
  * MockProvider — local development only: an order can be marked paid from
    the account page. Never enabled on a public host unless explicitly asked.

PLANS below are draft prices (IDR) — the owner hasn't finalised them.
Change them here; everything else (UI, checkout, entitlements) follows.
"""
import base64
import contextlib
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

PBKDF2_ITERATIONS = 600_000
SESSION_SECONDS = 30 * 24 * 3600
CYCLE_SECONDS = {'monthly': 30 * 24 * 3600, 'yearly': 365 * 24 * 3600}
EMAIL_RE = re.compile(r'^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$')

# Entitlements are what the server enforces on a public host:
#   office -> Word/Excel/PowerPoint to PDF via LibreOffice
#   apk    -> Android build, exe -> Windows build
# Browser-only tools (converter, flipbook, HTML export) stay free.
PLANS = {
    'free': dict(name='Free', monthly=0, yearly=0, entitlements=['office'],
                 features=dict(id=['Semua tool PDF di browser', 'PDF to Flipbook + ekspor HTML offline',
                                   'Word/Excel/PPT ke PDF'],
                               en=['Every in-browser PDF tool', 'PDF to Flipbook + offline HTML export',
                                   'Word/Excel/PPT to PDF'])),
    'pro': dict(name='Pro', monthly=59_000, yearly=590_000, entitlements=['office', 'apk'],
                features=dict(id=['Semua fitur Free', 'Build aplikasi Android (APK)', 'Prioritas fitur baru'],
                              en=['Everything in Free', 'Build Android apps (APK)', 'Early access to new features'])),
    'business': dict(name='Business', monthly=149_000, yearly=1_490_000, entitlements=['office', 'apk', 'exe'],
                     features=dict(id=['Semua fitur Pro', 'Build aplikasi Windows (EXE)', 'Cocok untuk tim & instansi'],
                                   en=['Everything in Pro', 'Build Windows apps (EXE)', 'Made for teams & institutions'])),
}


class AccountError(Exception):
    """Client-facing error: status code + Indonesian message."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def hash_password(password, salt=None, iterations=PBKDF2_ITERATIONS):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
    return 'pbkdf2_sha256${}${}${}'.format(iterations, base64.b64encode(salt).decode(), base64.b64encode(digest).decode())


def verify_password(password, stored):
    try:
        scheme, iterations, salt, digest = stored.split('$')
        if scheme != 'pbkdf2_sha256':
            return False
        expected = base64.b64decode(digest)
        actual = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), base64.b64decode(salt), int(iterations))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


class MockProvider:
    name = 'mock'

    def create(self, order, user, base_url):
        return dict(redirect_url=f'/account.html?order={order["id"]}', reference=None)


class DisabledProvider:
    """Public host without a payment gateway configured: no checkout."""
    name = 'none'

    def create(self, order, user, base_url):
        raise AccountError(503, 'Pembayaran belum diaktifkan di server ini.')


class MidtransProvider:
    """Midtrans Snap: https://docs.midtrans.com/reference/backend-integration"""
    name = 'midtrans'

    def __init__(self, server_key, production=False, opener=None):
        self.server_key = server_key
        self.base = 'https://app.midtrans.com' if production else 'https://app.sandbox.midtrans.com'
        self.opener = opener or urllib.request.urlopen

    def create(self, order, user, base_url):
        body = dict(
            transaction_details=dict(order_id=order['id'], gross_amount=order['amount']),
            item_details=[dict(id=f'{order["plan"]}-{order["cycle"]}', price=order['amount'], quantity=1,
                               name=f'MyFlipbook {PLANS[order["plan"]]["name"]} ({order["cycle"]})'[:50])],
            customer_details=dict(email=user['email'], first_name=(user['name'] or user['email'])[:50]),
            callbacks=dict(finish=f'{base_url}/account.html?order={order["id"]}'),
        )
        auth = base64.b64encode((self.server_key + ':').encode()).decode()
        request = urllib.request.Request(self.base + '/snap/v1/transactions', data=json.dumps(body).encode(),
                                         method='POST', headers={'Authorization': 'Basic ' + auth,
                                                                 'Content-Type': 'application/json',
                                                                 'Accept': 'application/json'})
        try:
            with self.opener(request, timeout=20) as response:
                data = json.loads(response.read())
        except (urllib.error.URLError, ValueError, OSError) as cause:
            raise AccountError(502, 'Gateway pembayaran tidak bisa dihubungi. Coba lagi sebentar.') from cause
        if not data.get('redirect_url'):
            raise AccountError(502, 'Gateway pembayaran menolak transaksi.')
        return dict(redirect_url=data['redirect_url'], reference=data.get('token'))

    def verify(self, payload):
        """Return (order_id, status, gross_amount) for a genuine notification."""
        fields = [str(payload.get(k, '')) for k in ('order_id', 'status_code', 'gross_amount')]
        expected = hashlib.sha512((''.join(fields) + self.server_key).encode()).hexdigest()
        if not hmac.compare_digest(expected, str(payload.get('signature_key', ''))):
            raise AccountError(403, 'Signature notifikasi tidak valid.')
        state, fraud = payload.get('transaction_status'), payload.get('fraud_status')
        if state == 'settlement' or (state == 'capture' and fraud in (None, 'accept')):
            status = 'paid'
        elif state in ('deny', 'cancel', 'failure'):
            status = 'failed'
        elif state == 'expire':
            status = 'expired'
        else:
            status = 'pending'
        return fields[0], status, fields[2]


class Accounts:
    def __init__(self, path, provider=None):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.provider = provider or MockProvider()
        self._failures = {}
        self._failure_lock = threading.Lock()
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS users(
                    id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '',
                    password_hash TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free', plan_expires_at INTEGER,
                    created_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions(
                    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS orders(
                    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    plan TEXT NOT NULL, cycle TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
                    provider TEXT NOT NULL, reference TEXT, redirect_url TEXT,
                    created_at INTEGER NOT NULL, paid_at INTEGER);
                CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id, created_at);
            ''')

    @contextlib.contextmanager
    def connect(self):
        """One short-lived connection per operation: commit on success,
        roll back on error, always close (threads never share it)."""
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    # ---- users & sessions -------------------------------------------------
    def public_user(self, row):
        plan, expires = row['plan'], row['plan_expires_at']
        if plan != 'free' and (not expires or expires < time.time()):
            plan = 'free'
        return dict(id=row['id'], email=row['email'], name=row['name'], plan=plan,
                    planName=PLANS[plan]['name'], planExpiresAt=expires if plan != 'free' else None,
                    entitlements=PLANS[plan]['entitlements'])

    def register(self, email, password, name=''):
        email = (email or '').strip().lower()
        name = (name or '').strip()[:80]
        if not EMAIL_RE.match(email):
            raise AccountError(400, 'Format email tidak valid.')
        if not isinstance(password, str) or not 8 <= len(password) <= 256:
            raise AccountError(400, 'Password minimal 8 karakter.')
        try:
            with self.connect() as db:
                cursor = db.execute('INSERT INTO users(email, name, password_hash, created_at) VALUES(?,?,?,?)',
                                    (email, name, hash_password(password), int(time.time())))
                user_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            raise AccountError(409, 'Email sudah terdaftar. Silakan masuk.')
        return self.start_session(user_id)

    def _throttled(self, key):
        now = time.time()
        with self._failure_lock:
            recent = [t for t in self._failures.get(key, []) if now - t < 900]
            self._failures[key] = recent
            return len(recent) >= 5

    def _record_failure(self, key):
        with self._failure_lock:
            self._failures.setdefault(key, []).append(time.time())

    def login(self, email, password, client='?'):
        email = (email or '').strip().lower()
        key = (client, email)
        if self._throttled(key):
            raise AccountError(429, 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.')
        with self.connect() as db:
            row = db.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
        # Hash even for unknown emails so timing doesn't reveal who is registered.
        valid = verify_password(password or '', row['password_hash'] if row else hash_password('x', b'0' * 16, 1000))
        if not row or not valid:
            self._record_failure(key)
            raise AccountError(401, 'Email atau password salah.')
        with self._failure_lock:
            self._failures.pop(key, None)
        return self.start_session(row['id'])

    def start_session(self, user_id):
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with self.connect() as db:
            db.execute('DELETE FROM sessions WHERE expires_at < ?', (now,))
            db.execute('INSERT INTO sessions VALUES(?,?,?,?)', (token_hash(token), user_id, now, now + SESSION_SECONDS))
        return token

    def user_for(self, token):
        if not token:
            return None
        with self.connect() as db:
            row = db.execute('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id '
                             'WHERE token_hash=? AND expires_at>?', (token_hash(token), int(time.time()))).fetchone()
        return self.public_user(row) if row else None

    def logout(self, token):
        if token:
            with self.connect() as db:
                db.execute('DELETE FROM sessions WHERE token_hash=?', (token_hash(token),))

    # ---- billing ----------------------------------------------------------
    def plans(self):
        return [dict(id=key, name=p['name'], monthly=p['monthly'], yearly=p['yearly'],
                     features=p['features'], entitlements=p['entitlements'])
                for key, p in PLANS.items()]

    def orders(self, user_id):
        with self.connect() as db:
            rows = db.execute('SELECT id, plan, cycle, amount, status, provider, created_at, paid_at FROM orders '
                              'WHERE user_id=? ORDER BY created_at DESC LIMIT 50', (user_id,)).fetchall()
        return [dict(row) for row in rows]

    def checkout(self, user, plan, cycle, base_url=''):
        if plan not in PLANS or plan == 'free' or cycle not in CYCLE_SECONDS:
            raise AccountError(400, 'Paket atau periode tidak valid.')
        order = dict(id=f'MF-{int(time.time())}-{secrets.token_hex(4)}', plan=plan, cycle=cycle,
                     amount=PLANS[plan][cycle])
        with self.connect() as db:
            db.execute('INSERT INTO orders(id, user_id, plan, cycle, amount, status, provider, created_at) '
                       'VALUES(?,?,?,?,?,?,?,?)', (order['id'], user['id'], plan, cycle, order['amount'],
                                                   'pending', self.provider.name, int(time.time())))
        try:
            created = self.provider.create(order, user, base_url)
        except AccountError:
            self.set_status(order['id'], 'failed')
            raise
        with self.connect() as db:
            db.execute('UPDATE orders SET reference=?, redirect_url=? WHERE id=?',
                       (created.get('reference'), created['redirect_url'], order['id']))
        return dict(orderId=order['id'], amount=order['amount'], redirectUrl=created['redirect_url'],
                    provider=self.provider.name)

    def set_status(self, order_id, status):
        with self.connect() as db:
            db.execute("UPDATE orders SET status=? WHERE id=? AND status!='paid'", (status, order_id))

    def mark_paid(self, order_id, amount=None):
        """Idempotent: extends the plan exactly once per order."""
        now = int(time.time())
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            order = db.execute('SELECT * FROM orders WHERE id=?', (order_id,)).fetchone()
            if not order:
                raise AccountError(404, 'Order tidak ditemukan.')
            if amount is not None and int(float(amount)) != order['amount']:
                raise AccountError(400, 'Nominal pembayaran tidak cocok dengan order.')
            if order['status'] == 'paid':
                return False
            user = db.execute('SELECT * FROM users WHERE id=?', (order['user_id'],)).fetchone()
            active = user['plan'] == order['plan'] and (user['plan_expires_at'] or 0) > now
            start = user['plan_expires_at'] if active else now
            db.execute('UPDATE users SET plan=?, plan_expires_at=? WHERE id=?',
                       (order['plan'], start + CYCLE_SECONDS[order['cycle']], user['id']))
            db.execute("UPDATE orders SET status='paid', paid_at=? WHERE id=?", (now, order_id))
        return True

    def mock_pay(self, user, order_id):
        if self.provider.name != 'mock':
            raise AccountError(404, 'Simulasi pembayaran tidak aktif.')
        with self.connect() as db:
            order = db.execute('SELECT user_id FROM orders WHERE id=?', (order_id,)).fetchone()
        if not order or order['user_id'] != user['id']:
            raise AccountError(404, 'Order tidak ditemukan.')
        self.mark_paid(order_id)

    def provider_notification(self, payload):
        if not hasattr(self.provider, 'verify'):
            raise AccountError(404, 'Notifikasi gateway tidak aktif.')
        order_id, status, amount = self.provider.verify(payload)
        if status == 'paid':
            self.mark_paid(order_id, amount)
        elif status in ('failed', 'expired'):
            self.set_status(order_id, status)
        return status
