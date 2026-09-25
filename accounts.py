"""MyFlipbook accounts, sessions, plans and billing — Python stdlib only.

Storage: one SQLite file (default .data/myflipbook.sqlite3, ignored by Git).
Passwords: PBKDF2-HMAC-SHA256, per-user salt. Sessions: random token in an
HttpOnly cookie; only its SHA-256 is stored, so a leaked DB can't log in.

Payments go through a provider object:
  * TripayProvider — Tripay closed payment (QRIS / VA / e-wallet), hosted
    checkout page + HMAC-signed callback (set TRIPAY_API_KEY,
    TRIPAY_PRIVATE_KEY, TRIPAY_MERCHANT_CODE; TRIPAY_PRODUCTION=1 for live).
  * LemonSqueezyProvider — USD subscriptions for buyers abroad (merchant of
    record handles foreign tax). Hosted checkout per plan variant; renewals
    arrive as signed webhooks (set LEMONSQUEEZY_* env vars).
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
from urllib.parse import urlencode

PBKDF2_ITERATIONS = 600_000
SESSION_SECONDS = 30 * 24 * 3600
CYCLE_SECONDS = {'monthly': 30 * 24 * 3600, 'yearly': 365 * 24 * 3600}
# Amounts: IDR in rupiah, USD in cents (as the gateways expect them).
CURRENCIES = ('IDR', 'USD')
EMAIL_RE = re.compile(r'^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$')

# Entitlements the server enforces (see server.entitlement_error):
#   office -> Word/Excel/PowerPoint to PDF via LibreOffice (login on a public host)
#   export -> flipbook export (offline HTML package, also the animation editor)
#   apk    -> Android build, exe -> Windows build
# Browser tools and flipbook preview / project save stay free.
PLANS = {
    'free': dict(name='Free', monthly=0, yearly=0, usd_monthly=0, usd_yearly=0, entitlements=['office'],
                 features=dict(id=['Semua tool PDF di browser', 'PDF to Flipbook: baca & preview',
                                   'Word/Excel/PPT ke PDF'],
                               en=['Every in-browser PDF tool', 'PDF to Flipbook: read & preview',
                                   'Word/Excel/PPT to PDF'])),
    'pro': dict(name='Pro', monthly=99_000, yearly=990_000, usd_monthly=999, usd_yearly=9_900,
                entitlements=['office', 'export', 'apk'],
                features=dict(id=['Semua fitur Free', 'Ekspor flipbook: HTML offline', 'Build aplikasi Android (APK)'],
                              en=['Everything in Free', 'Flipbook export: offline HTML', 'Build Android apps (APK)'])),
    'business': dict(name='Business', monthly=149_000, yearly=1_490_000, usd_monthly=1_999, usd_yearly=19_900,
                     entitlements=['office', 'export', 'apk', 'exe'],
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

    def create(self, order, user, base_url, method=None):
        return dict(redirect_url=f'/account.html?order={order["id"]}', reference=None)


class DisabledProvider:
    """Public host without a payment gateway configured: no checkout."""
    name = 'none'

    def create(self, order, user, base_url, method=None):
        raise AccountError(503, 'Pembayaran belum diaktifkan di server ini.')


class TripayProvider:
    """Tripay closed payment: https://tripay.co.id/developer"""
    name = 'tripay'
    # Shown if the channel list can't be fetched; Tripay still rejects
    # channels that aren't active for the merchant.
    FALLBACK_METHODS = [('QRIS', 'QRIS', 'QRIS'), ('BRIVA', 'BRI Virtual Account', 'Virtual Account'),
                        ('BNIVA', 'BNI Virtual Account', 'Virtual Account'),
                        ('MANDIRIVA', 'Mandiri Virtual Account', 'Virtual Account'),
                        ('BCAVA', 'BCA Virtual Account', 'Virtual Account')]

    def __init__(self, api_key, private_key, merchant_code, production=False, opener=None):
        self.api_key, self.private_key, self.merchant_code = api_key, private_key, merchant_code
        self.base = 'https://tripay.co.id/api' if production else 'https://tripay.co.id/api-sandbox'
        self.opener = opener or urllib.request.urlopen
        self._methods, self._methods_at = None, 0
        self._lock = threading.Lock()

    def _call(self, path, form=None):
        headers = {'Authorization': 'Bearer ' + self.api_key, 'Accept': 'application/json'}
        data = None
        if form is not None:
            data = urlencode(form).encode()
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
        request = urllib.request.Request(self.base + path, data=data, headers=headers,
                                         method='POST' if form is not None else 'GET')
        try:
            with self.opener(request, timeout=20) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            try:
                return json.loads(error.read())
            except ValueError:
                raise AccountError(502, 'Gateway pembayaran menolak permintaan.') from error
        except (urllib.error.URLError, ValueError, OSError) as cause:
            raise AccountError(502, 'Gateway pembayaran tidak bisa dihubungi. Coba lagi sebentar.') from cause

    def methods(self):
        """Active payment channels, cached for 10 minutes."""
        with self._lock:
            if self._methods and time.time() - self._methods_at < 600:
                return self._methods
            try:
                data = self._call('/merchant/payment-channel')
                channels = [dict(code=c['code'], name=c['name'], group=c.get('group', ''), icon=c.get('icon_url', ''))
                            for c in data.get('data') or [] if c.get('active', True)]
            except (AccountError, KeyError, TypeError):
                channels = []
            if channels:
                self._methods, self._methods_at = channels, time.time()
                return channels
            return [dict(code=c, name=n, group=g, icon='') for c, n, g in self.FALLBACK_METHODS]

    def create(self, order, user, base_url, method=None):
        if method not in {m['code'] for m in self.methods()}:
            raise AccountError(400, 'Pilih metode pembayaran.')
        signature = hmac.new(self.private_key.encode(), (self.merchant_code + order['id'] + str(order['amount'])).encode(),
                             hashlib.sha256).hexdigest()
        form = {
            'method': method, 'merchant_ref': order['id'], 'amount': order['amount'],
            'customer_name': (user['name'] or user['email'].split('@')[0])[:100], 'customer_email': user['email'],
            'order_items[0][sku]': f'{order["plan"]}-{order["cycle"]}',
            'order_items[0][name]': f'MyFlipbook {PLANS[order["plan"]]["name"]} ({order["cycle"]})',
            'order_items[0][price]': order['amount'], 'order_items[0][quantity]': 1,
            'callback_url': f'{base_url}/api/billing/tripay/callback',
            'return_url': f'{base_url}/account.html?order={order["id"]}',
            'expired_time': int(time.time()) + 24 * 3600, 'signature': signature,
        }
        data = self._call('/transaction/create', form)
        result = data.get('data') or {}
        if not data.get('success') or not result.get('checkout_url'):
            raise AccountError(502, 'Tripay: ' + str(data.get('message') or 'transaksi ditolak.'))
        return dict(redirect_url=result['checkout_url'], reference=result.get('reference'))

    def verify_callback(self, raw, headers):
        """Return (merchant_ref, status, reference) for a genuine callback."""
        if headers.get('X-Callback-Event') != 'payment_status':
            raise AccountError(400, 'Event callback tidak dikenal.')
        expected = hmac.new(self.private_key.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, headers.get('X-Callback-Signature', '')):
            raise AccountError(403, 'Signature callback tidak valid.')
        try:
            payload = json.loads(raw)
        except ValueError:
            raise AccountError(400, 'JSON tidak valid.')
        status = {'PAID': 'paid', 'EXPIRED': 'expired', 'FAILED': 'failed', 'REFUND': 'refund'}.get(
            payload.get('status'), 'pending')
        return str(payload.get('merchant_ref', '')), status, str(payload.get('reference', ''))


class LemonSqueezyProvider:
    """Lemon Squeezy (merchant of record): https://docs.lemonsqueezy.com/api"""
    name = 'lemonsqueezy'
    BASE = 'https://api.lemonsqueezy.com/v1'

    def __init__(self, api_key, store_id, signing_secret, variants, opener=None):
        # variants: {('pro', 'monthly'): '12345', ...} — subscription variants
        # created in the Lemon Squeezy dashboard with the USD prices in PLANS.
        self.api_key, self.store_id, self.signing_secret = api_key, str(store_id), signing_secret
        self.variants = {key: str(value) for key, value in variants.items() if value}
        self.opener = opener or urllib.request.urlopen

    def create(self, order, user, base_url, method=None):
        variant = self.variants.get((order['plan'], order['cycle']))
        if not variant:
            raise AccountError(503, 'Paket ini belum disiapkan untuk pembayaran dolar.')
        body = {'data': {
            'type': 'checkouts',
            'attributes': {
                'checkout_data': {'email': user['email'], 'name': user['name'] or user['email'].split('@')[0],
                                  'custom': {'order_id': order['id'], 'user_id': str(user['id'])}},
                'product_options': {'redirect_url': f'{base_url}/account.html?order={order["id"]}'},
            },
            'relationships': {'store': {'data': {'type': 'stores', 'id': self.store_id}},
                              'variant': {'data': {'type': 'variants', 'id': variant}}},
        }}
        request = urllib.request.Request(self.BASE + '/checkouts', data=json.dumps(body).encode(), method='POST', headers={
            'Accept': 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json',
            'Authorization': 'Bearer ' + self.api_key})
        try:
            with self.opener(request, timeout=20) as response:
                data = json.loads(response.read())
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read())['errors'][0]['detail']
            except (ValueError, KeyError, IndexError, TypeError):
                detail = f'HTTP {error.code}'
            raise AccountError(502, 'Lemon Squeezy: ' + str(detail)) from error
        except (urllib.error.URLError, ValueError, OSError) as cause:
            raise AccountError(502, 'Gateway pembayaran tidak bisa dihubungi. Coba lagi sebentar.') from cause
        try:
            return dict(redirect_url=data['data']['attributes']['url'], reference=str(data['data']['id']))
        except (KeyError, TypeError):
            raise AccountError(502, 'Lemon Squeezy tidak mengembalikan halaman checkout.')

    def verify_webhook(self, raw, headers):
        """Return (event_name, payload) for a genuine webhook (HMAC-SHA256 hex of the raw body)."""
        expected = hmac.new(self.signing_secret.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, headers.get('X-Signature', '')):
            raise AccountError(403, 'Signature webhook tidak valid.')
        try:
            payload = json.loads(raw)
        except ValueError:
            raise AccountError(400, 'JSON tidak valid.')
        event = headers.get('X-Event-Name') or (payload.get('meta') or {}).get('event_name', '')
        return event, payload


class MidtransProvider:
    """Midtrans Snap: https://docs.midtrans.com/reference/backend-integration"""
    name = 'midtrans'

    def __init__(self, server_key, production=False, opener=None):
        self.server_key = server_key
        self.base = 'https://app.midtrans.com' if production else 'https://app.sandbox.midtrans.com'
        self.opener = opener or urllib.request.urlopen

    def create(self, order, user, base_url, method=None):
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
    def __init__(self, path, provider=None, usd_provider=None):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.provider = provider or MockProvider()          # IDR (Tripay / Midtrans)
        self.usd_provider = usd_provider or MockProvider()  # USD (Lemon Squeezy)
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
                CREATE TABLE IF NOT EXISTS subscriptions(
                    provider TEXT NOT NULL, external_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    plan TEXT NOT NULL, cycle TEXT NOT NULL, order_id TEXT, created_at INTEGER NOT NULL,
                    PRIMARY KEY(provider, external_id));
            ''')
            # Databases created before USD pricing: add the currency column.
            columns = {row['name'] for row in db.execute('PRAGMA table_info(orders)')}
            if 'currency' not in columns:
                db.execute("ALTER TABLE orders ADD COLUMN currency TEXT NOT NULL DEFAULT 'IDR'")

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
    def provider_for(self, currency):
        if currency not in CURRENCIES:
            raise AccountError(400, 'Mata uang tidak didukung.')
        return self.usd_provider if currency == 'USD' else self.provider

    def plans(self):
        return [dict(id=key, name=p['name'], monthly=p['monthly'], yearly=p['yearly'],
                     usd=dict(monthly=p['usd_monthly'], yearly=p['usd_yearly']),
                     features=p['features'], entitlements=p['entitlements'])
                for key, p in PLANS.items()]

    def orders(self, user_id):
        with self.connect() as db:
            rows = db.execute('SELECT id, plan, cycle, amount, currency, status, provider, created_at, paid_at FROM orders '
                              'WHERE user_id=? ORDER BY created_at DESC LIMIT 50', (user_id,)).fetchall()
        return [dict(row) for row in rows]

    def paid_order(self, user, order_id):
        """The user's own paid order (and their row) for an invoice, else 404."""
        with self.connect() as db:
            order = db.execute('SELECT * FROM orders WHERE id=? AND user_id=?', (order_id, user['id'])).fetchone()
            owner = db.execute('SELECT * FROM users WHERE id=?', (user['id'],)).fetchone()
        if not order or order['status'] != 'paid':
            raise AccountError(404, 'Invoice hanya tersedia untuk pembayaran yang sudah lunas.')
        return order, owner

    def payment_methods(self):
        return self.provider.methods() if hasattr(self.provider, 'methods') else []

    def checkout(self, user, plan, cycle, base_url='', method=None, currency='IDR'):
        if plan not in PLANS or plan == 'free' or cycle not in CYCLE_SECONDS:
            raise AccountError(400, 'Paket atau periode tidak valid.')
        provider = self.provider_for(currency)
        amount = PLANS[plan]['usd_' + cycle] if currency == 'USD' else PLANS[plan][cycle]
        order = dict(id=f'MF-{int(time.time())}-{secrets.token_hex(4)}', plan=plan, cycle=cycle,
                     amount=amount, currency=currency)
        with self.connect() as db:
            db.execute('INSERT INTO orders(id, user_id, plan, cycle, amount, currency, status, provider, created_at) '
                       'VALUES(?,?,?,?,?,?,?,?,?)', (order['id'], user['id'], plan, cycle, amount, currency,
                                                     'pending', provider.name, int(time.time())))
        try:
            created = provider.create(order, user, base_url, method)
        except AccountError:
            # Never reached the gateway: don't leave a "failed" row in the history.
            with self.connect() as db:
                db.execute('DELETE FROM orders WHERE id=?', (order['id'],))
            raise
        with self.connect() as db:
            db.execute('UPDATE orders SET reference=?, redirect_url=? WHERE id=?',
                       (created.get('reference'), created['redirect_url'], order['id']))
        return dict(orderId=order['id'], amount=amount, currency=currency, redirectUrl=created['redirect_url'],
                    provider=provider.name)

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
        with self.connect() as db:
            order = db.execute('SELECT user_id, provider FROM orders WHERE id=?', (order_id,)).fetchone()
        if not order or order['user_id'] != user['id']:
            raise AccountError(404, 'Order tidak ditemukan.')
        # Only orders created through the local simulation can be "paid" here.
        if order['provider'] != 'mock':
            raise AccountError(404, 'Simulasi pembayaran tidak aktif.')
        self.mark_paid(order_id)

    def lemonsqueezy_webhook(self, raw, headers):
        """First payment via subscription_created (carries our order id);
        renewals via subscription_payment_success, found by subscription id.
        Each Lemon Squeezy invoice extends the plan exactly once."""
        if not hasattr(self.usd_provider, 'verify_webhook'):
            raise AccountError(404, 'Webhook gateway tidak aktif.')
        event, payload = self.usd_provider.verify_webhook(raw, headers)
        data = payload.get('data') or {}
        attributes = data.get('attributes') or {}
        custom = (payload.get('meta') or {}).get('custom_data') or {}
        now = int(time.time())
        if event == 'subscription_created':
            order_id = str(custom.get('order_id', ''))
            with self.connect() as db:
                order = db.execute("SELECT * FROM orders WHERE id=? AND provider='lemonsqueezy'", (order_id,)).fetchone()
                if not order:
                    raise AccountError(404, 'Order tidak ditemukan.')
                db.execute('INSERT OR IGNORE INTO subscriptions VALUES(?,?,?,?,?,?,?)',
                           ('lemonsqueezy', str(data.get('id')), order['user_id'], order['plan'], order['cycle'],
                            order_id, now))
            if attributes.get('status') in ('active', 'on_trial'):
                self.mark_paid(order_id)
                return 'paid'
            return 'pending'
        if event == 'subscription_payment_success' and attributes.get('billing_reason') == 'renewal':
            if attributes.get('status') != 'paid':
                return 'ignored'
            with self.connect() as db:
                sub = db.execute("SELECT * FROM subscriptions WHERE provider='lemonsqueezy' AND external_id=?",
                                 (str(attributes.get('subscription_id')),)).fetchone()
                if not sub:
                    raise AccountError(404, 'Langganan tidak dikenal.')
                renewal_id = f'LS-{data.get("id")}'
                db.execute('INSERT OR IGNORE INTO orders(id, user_id, plan, cycle, amount, currency, status, provider, '
                           'reference, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
                           (renewal_id, sub['user_id'], sub['plan'], sub['cycle'], int(attributes.get('total') or 0),
                            str(attributes.get('currency') or 'USD'), 'pending', 'lemonsqueezy',
                            str(attributes.get('subscription_id')), now))
            self.mark_paid(renewal_id)
            return 'paid'
        return 'ignored'  # initial invoice (counted at subscription_created), cancellations, refunds...

    def provider_callback(self, raw, headers):
        """Tripay-style callback: signed raw body, bound to our stored reference."""
        if not hasattr(self.provider, 'verify_callback'):
            raise AccountError(404, 'Callback gateway tidak aktif.')
        order_id, status, reference = self.provider.verify_callback(raw, headers)
        with self.connect() as db:
            order = db.execute('SELECT reference FROM orders WHERE id=?', (order_id,)).fetchone()
        if not order:
            raise AccountError(404, 'Order tidak ditemukan.')
        if order['reference'] and order['reference'] != reference:
            raise AccountError(400, 'Referensi transaksi tidak cocok.')
        if status == 'paid':
            self.mark_paid(order_id)
        elif status in ('failed', 'expired'):
            self.set_status(order_id, status)
        return status

    def provider_notification(self, payload):
        if not hasattr(self.provider, 'verify'):
            raise AccountError(404, 'Notifikasi gateway tidak aktif.')
        order_id, status, amount = self.provider.verify(payload)
        if status == 'paid':
            self.mark_paid(order_id, amount)
        elif status in ('failed', 'expired'):
            self.set_status(order_id, status)
        return status
