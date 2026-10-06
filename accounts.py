"""MyFlipbook accounts, sessions, plans and billing — Python stdlib only.

Storage: one SQLite file (default .data/myflipbook.sqlite3, ignored by Git).
Passwords: PBKDF2-HMAC-SHA256, per-user salt. Sessions: random token in an
HttpOnly cookie; only its SHA-256 is stored, so a leaked DB can't log in.

Payments go through a provider object:
  * DuitkuProvider — Duitku POP invoice (QRIS / VA / e-wallet), hosted
    payment page + HMAC-signed callback (set DUITKU_MERCHANT_CODE,
    DUITKU_API_KEY; DUITKU_PRODUCTION=1 for live). Default rupiah gateway
    when configured; MYFLIPBOOK_IDR_PROVIDER=duitku forces it.
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
import urllib.parse
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
#   ai     -> AI Summarizer: summary, translation, podcast (all plans, login required)
#   export -> flipbook export (offline HTML package, also the animation editor)
#   apk    -> Android build, exe -> Windows build
# Browser tools and flipbook preview / project save stay free.
# Free trial: new Free members get everything for TRIAL_DAYS days; afterwards
# only the flipbook reader stays (share links keep the first SHARE_FREE
# publishes, then need Pro).
TRIAL_DAYS = 7
SHARE_FREE = 3
PLANS = {
    'free': dict(name='Free', monthly=0, yearly=0, usd_monthly=0, usd_yearly=0, entitlements=['office', 'ai'],
                 features=dict(id=['Semua tool PDF di browser', 'PDF to Flipbook: baca & preview',
                                   'Word/Excel/PPT ke PDF', 'AI Summarizer: ringkasan, terjemahan, podcast',
                                   '3 share link flipbook gratis'],
                               en=['Every in-browser PDF tool', 'PDF to Flipbook: read & preview',
                                   'Word/Excel/PPT to PDF', 'AI Summarizer: summary, translation, podcast',
                                   '3 free flipbook share links'])),
    'pro': dict(name='Pro', monthly=99_000, yearly=990_000, usd_monthly=999, usd_yearly=9_900,
                entitlements=['office', 'ai', 'export', 'apk'],
                features=dict(id=['Semua fitur Free', 'Ekspor flipbook: HTML offline', 'Share link tanpa batas', 'Build aplikasi Android (APK)'],
                              en=['Everything in Free', 'Flipbook export: offline HTML', 'Unlimited share links', 'Build Android apps (APK)'])),
    'business': dict(name='Business', monthly=149_000, yearly=1_490_000, usd_monthly=1_999, usd_yearly=19_900,
                     entitlements=['office', 'ai', 'export', 'apk', 'exe'],
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


class DuitkuProvider:
    """Duitku POP invoice: https://docs.duitku.com/pop/en

    Checkout is a hosted payment page (redirect to paymentUrl); the method
    dropdown is optional — without paymentMethod Duitku shows every active
    channel. Server-to-server callback is form-urlencoded, signed with
    HMAC-SHA256(merchantCode + amount + merchantOrderId, apiKey).
    """
    name = 'duitku'
    # Must match the Callback URL set in the Duitku merchant dashboard.
    CALLBACK_PATH = '/api/payment/duitku/callback'
    EXPIRY_MINUTES = 1440  # 24h, like the Tripay orders (verify in sandbox)
    # Shown if the payment-method list can't be fetched; Duitku still shows
    # its own channel menu when no paymentMethod is sent.
    FALLBACK_METHODS = [('SP', 'QRIS', 'QRIS'), ('VC', 'Credit Card', 'Credit Card'),
                        ('BC', 'BCA Virtual Account', 'Virtual Account'),
                        ('BR', 'BRI Virtual Account', 'Virtual Account'),
                        ('M2', 'Mandiri Virtual Account', 'Virtual Account'),
                        ('B1', 'CIMB Virtual Account', 'Virtual Account'),
                        ('DA', 'DANA', 'E-Wallet'), ('OV', 'OVO', 'E-Wallet'),
                        ('IR', 'Indomaret', 'Retail')]

    def __init__(self, merchant_code, api_key, production=False, opener=None):
        self.merchant_code, self.api_key = merchant_code, api_key
        self.base = 'https://api-prod.duitku.com' if production else 'https://api-sandbox.duitku.com'
        self.opener = opener or urllib.request.urlopen
        self._methods, self._methods_at = None, 0
        self._lock = threading.Lock()

    def _headers(self):
        timestamp = str(int(time.time() * 1000))
        signature = hmac.new(self.api_key.encode(), (self.merchant_code + timestamp).encode(),
                             hashlib.sha256).hexdigest()
        return {'Content-Type': 'application/json', 'Accept': 'application/json',
                'x-duitku-timestamp': timestamp, 'x-duitku-signature': signature,
                'x-duitku-merchantcode': self.merchant_code}

    def _call(self, path, payload):
        request = urllib.request.Request(self.base + path, data=json.dumps(payload).encode(),
                                         method='POST', headers=self._headers())
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
                moment = time.strftime('%Y-%m-%d %H:%M:%S')
                amount = str(PLANS['pro']['monthly'])
                signature = hashlib.sha256((self.merchant_code + amount + moment + self.api_key).encode()).hexdigest()
                data = self._call('/api/merchant/paymentmethod/getpaymentmethod',
                                  {'merchantCode': self.merchant_code, 'amount': amount,
                                   'datetime': moment, 'signature': signature})
                channels = [dict(code=c.get('paymentMethod') or c.get('code'),
                                 name=c.get('paymentName') or c.get('name'),
                                 group=c.get('paymentType') or c.get('group', ''),
                                 icon=c.get('paymentImage') or c.get('icon_url', '') or c.get('icon', ''))
                            for c in data.get('paymentFee') or data.get('data') or [] if c.get('paymentMethod') or c.get('code')]
            except (AccountError, KeyError, TypeError, AttributeError):
                channels = []
            if channels:
                self._methods, self._methods_at = channels, time.time()
                return channels
            return [dict(code=c, name=n, group=g, icon='') for c, n, g in self.FALLBACK_METHODS]

    def create(self, order, user, base_url, method=None):
        if method and method not in {m['code'] for m in self.methods()}:
            raise AccountError(400, 'Pilih metode pembayaran.')
        item = f'MyFlipbook {PLANS[order["plan"]]["name"]} ({order["cycle"]})'
        body = {
            'paymentAmount': order['amount'], 'merchantOrderId': order['id'], 'productDetails': item,
            'email': user['email'], 'customerVaName': (user['name'] or user['email'].split('@')[0])[:20],
            'itemDetails': [{'name': item[:50], 'price': order['amount'], 'quantity': 1}],
            'callbackUrl': f'{base_url}{self.CALLBACK_PATH}',
            'returnUrl': f'{base_url}/account.html?order={order["id"]}',
            'expiryPeriod': self.EXPIRY_MINUTES,
        }
        if method:
            body['paymentMethod'] = method
        data = self._call('/api/merchant/createInvoice', body)
        if data.get('statusCode') != '00' or not data.get('paymentUrl'):
            raise AccountError(502, 'Duitku: ' + str(data.get('statusMessage') or 'transaksi ditolak.'))
        return dict(redirect_url=data['paymentUrl'], reference=data.get('reference'))

    def verify_callback(self, raw, headers):
        """Return (merchantOrderId, status, reference) for a genuine callback."""
        try:
            form = {k: v[0] for k, v in urllib.parse.parse_qs(raw.decode('utf-8'), keep_blank_values=True).items()}
        except (ValueError, UnicodeDecodeError):
            form = {}
        merchant_order, amount = str(form.get('merchantOrderId') or ''), str(form.get('amount') or '')
        expected = hmac.new(self.api_key.encode(), (self.merchant_code + amount + merchant_order).encode(),
                            hashlib.sha256).hexdigest()
        if not merchant_order or not hmac.compare_digest(expected, str(form.get('signature') or '')):
            raise AccountError(403, 'Signature callback tidak valid.')
        status = {'00': 'paid', '01': 'failed'}.get(str(form.get('resultCode') or ''), 'pending')
        return merchant_order, status, str(form.get('reference') or '')

    def status(self, order_id):
        """Ask Duitku directly: (status, amount), or None when still pending.

        Lets a payment settle even where Duitku can't reach the callback URL
        (a local server) or a callback was lost."""
        signature = hashlib.md5((self.merchant_code + order_id + self.api_key).encode()).hexdigest()
        data = self._call('/api/merchant/transactionStatus',
                          {'merchantCode': self.merchant_code, 'merchantOrderId': order_id, 'signature': signature})
        code = str(data.get('statusCode') or data.get('resultCode') or '')
        if code == '00':
            return 'paid', data.get('amount')
        if code == '01':
            return None
        if code == '02':
            return 'failed', None
        return None


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
        self.api = 'https://api.midtrans.com' if production else 'https://api.sandbox.midtrans.com'
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

    @staticmethod
    def _status(payload):
        state, fraud = payload.get('transaction_status'), payload.get('fraud_status')
        if state == 'settlement' or (state == 'capture' and fraud in (None, 'accept')):
            return 'paid'
        if state in ('deny', 'cancel', 'failure'):
            return 'failed'
        if state == 'expire':
            return 'expired'
        return 'pending'

    def status(self, order_id):
        """Ask Midtrans directly (server key, HTTPS): (status, gross_amount),
        or None when Midtrans has no transaction for this order yet. Lets a
        payment settle even where Midtrans can't reach the notification URL
        (a local server) or a notification was lost."""
        auth = base64.b64encode((self.server_key + ':').encode()).decode()
        request = urllib.request.Request(f'{self.api}/v2/{urllib.parse.quote(order_id)}/status',
                                         headers={'Authorization': 'Basic ' + auth, 'Accept': 'application/json'})
        try:
            with self.opener(request, timeout=15) as response:
                data = json.loads(response.read())
        except urllib.error.HTTPError as cause:
            if cause.code == 404:
                return None
            raise AccountError(502, 'Status pembayaran tidak bisa dicek.') from cause
        except (urllib.error.URLError, ValueError, OSError) as cause:
            raise AccountError(502, 'Status pembayaran tidak bisa dicek.') from cause
        if str(data.get('status_code')) == '404' or str(data.get('order_id', order_id)) != order_id:
            return None
        return self._status(data), data.get('gross_amount')

    def verify(self, payload):
        """Return (order_id, status, gross_amount) for a genuine notification."""
        fields = [str(payload.get(k, '')) for k in ('order_id', 'status_code', 'gross_amount')]
        expected = hashlib.sha512((''.join(fields) + self.server_key).encode()).hexdigest()
        if not hmac.compare_digest(expected, str(payload.get('signature_key', ''))):
            raise AccountError(403, 'Signature notifikasi tidak valid.')
        return fields[0], self._status(payload), fields[2]

# Referrals: every REFERRAL_TARGET friends who sign up through a member's link
# and pay for Pro or Business give that member REFERRAL_DAYS more days.
REFERRAL_TARGET = 10
REFERRAL_DAYS = 30
REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'      # no 0/O, 1/I
REFERRAL_NEW_SECONDS = 15 * 60                         # only a brand-new account takes a referrer


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
            # Email verification and Google sign-in. Accounts made before this
            # (default 1) count as verified; new sign-ups are stored unverified.
            columns = {row['name'] for row in db.execute('PRAGMA table_info(users)')}
            if 'verified' not in columns:
                db.execute('ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 1')
            if 'google_sub' not in columns:
                db.execute('ALTER TABLE users ADD COLUMN google_sub TEXT')
            if 'ref_code' not in columns:
                db.execute('ALTER TABLE users ADD COLUMN ref_code TEXT')
            if 'referred_by' not in columns:
                db.execute('ALTER TABLE users ADD COLUMN referred_by INTEGER')
            db.executescript('''
                CREATE UNIQUE INDEX IF NOT EXISTS users_ref_code ON users(ref_code) WHERE ref_code IS NOT NULL;
                CREATE INDEX IF NOT EXISTS users_referred_by ON users(referred_by);
                CREATE TABLE IF NOT EXISTS referral_rewards(
                    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    friends INTEGER NOT NULL, days INTEGER NOT NULL, granted_at INTEGER NOT NULL);
            ''')
            db.executescript('''
                CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users(google_sub) WHERE google_sub IS NOT NULL;
                CREATE TABLE IF NOT EXISTS email_tokens(
                    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
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
        created = row['created_at'] if 'created_at' in row.keys() else int(time.time())
        trial_left = min(TRIAL_DAYS, max(0, TRIAL_DAYS - (int(time.time()) - created) // 86400))
        trial_expired = plan == 'free' and trial_left <= 0
        return dict(id=row['id'], email=row['email'], name=row['name'], plan=plan,
                    verified=bool(row['verified']) if 'verified' in row.keys() else True,
                    google=bool(row['google_sub']) if 'google_sub' in row.keys() else False,
                    planName=PLANS[plan]['name'], planExpiresAt=expires if plan != 'free' else None,
                    entitlements=PLANS[plan]['entitlements'],
                    trialDaysLeft=trial_left if plan == 'free' else None, trialExpired=trial_expired)

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

    def register_unverified(self, email, password, name=''):
        """A sign-up that must confirm its email first: (user_id, email token).
        Signing up again before confirming replaces the password and sends a new link."""
        email = (email or '').strip().lower()
        name = (name or '').strip()[:80]
        if not EMAIL_RE.match(email):
            raise AccountError(400, 'Format email tidak valid.')
        if not isinstance(password, str) or not 8 <= len(password) <= 256:
            raise AccountError(400, 'Password minimal 8 karakter.')
        with self.connect() as db:
            row = db.execute('SELECT id, verified FROM users WHERE email=?', (email,)).fetchone()
            if row and row['verified']:
                raise AccountError(409, 'Email sudah terdaftar. Silakan masuk.')
            if row:
                db.execute('UPDATE users SET password_hash=?, name=? WHERE id=?', (hash_password(password), name, row['id']))
                user_id = row['id']
            else:
                user_id = db.execute('INSERT INTO users(email, name, password_hash, created_at, verified) VALUES(?,?,?,?,0)',
                                     (email, name, hash_password(password), int(time.time()))).lastrowid
        return user_id, self.email_token(user_id)

    def email_token(self, user_id, hours=48):
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with self.connect() as db:
            db.execute('DELETE FROM email_tokens WHERE user_id=? OR expires_at<?', (user_id, now))
            db.execute('INSERT INTO email_tokens VALUES(?,?,?,?)', (token_hash(token), user_id, now, now + hours * 3600))
        return token

    def verify_email(self, token):
        """The link in the email: marks the account verified and signs it in."""
        if not token or len(token) > 200:
            raise AccountError(400, 'Link verifikasi tidak valid.')
        now = int(time.time())
        with self.connect() as db:
            row = db.execute('SELECT user_id FROM email_tokens WHERE token_hash=? AND expires_at>?', (token_hash(token), now)).fetchone()
            if not row:
                raise AccountError(400, 'Link verifikasi tidak valid atau sudah kedaluwarsa. Minta kirim ulang dari halaman masuk.')
            db.execute('UPDATE users SET verified=1 WHERE id=?', (row['user_id'],))
            db.execute('DELETE FROM email_tokens WHERE user_id=?', (row['user_id'],))
        return self.start_session(row['user_id'])

    def resend_verification(self, email, client='?'):
        """(user_id, token, name) for an unverified email, else None (never says which)."""
        email = (email or '').strip().lower()
        key = ('resend', client, email)
        if self._throttled(key):
            raise AccountError(429, 'Terlalu sering. Coba lagi 15 menit lagi.')
        self._record_failure(key)          # counts every resend toward the limit
        with self.connect() as db:
            row = db.execute('SELECT id, name, verified FROM users WHERE email=?', (email,)).fetchone()
        if not row or row['verified']:
            return None
        return row['id'], self.email_token(row['id']), row['name']

    def google_login(self, sub, email, name=''):
        """Sign in with a Google account whose ID token the server checked:
        the same Google account, else the account with that (Google-verified)
        email — linked and verified — else a new verified account."""
        email = (email or '').strip().lower()
        if not sub or not EMAIL_RE.match(email):
            raise AccountError(400, 'Akun Google tidak valid.')
        with self.connect() as db:
            row = db.execute('SELECT id FROM users WHERE google_sub=?', (sub,)).fetchone()
            if not row:
                row = db.execute('SELECT id FROM users WHERE email=?', (email,)).fetchone()
                if row:
                    db.execute('UPDATE users SET google_sub=?, verified=1 WHERE id=?', (sub, row['id']))
            if row:
                user_id = row['id']
            else:
                user_id = db.execute('INSERT INTO users(email, name, password_hash, created_at, verified, google_sub) VALUES(?,?,?,?,1,?)',
                                     (email, (name or '').strip()[:80], hash_password(secrets.token_urlsafe(32)), int(time.time()), sub)).lastrowid
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
        if 'verified' in row.keys() and not row['verified']:
            raise AccountError(403, 'Email belum diverifikasi. Buka link di email dari MyFlipbook, atau kirim ulang emailnya.')
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

    def refresh_pending(self, user_id):
        """Settle a user's recent pending orders by asking the gateway directly
        (only gateways that support it, i.e. Midtrans). Quiet on errors: the
        signed notification remains the main path."""
        if not hasattr(self.provider, 'status'):
            return
        since = int(time.time()) - 2 * 86400
        with self.connect() as db:
            rows = db.execute("SELECT id FROM orders WHERE user_id=? AND status='pending' AND provider=? AND created_at>? "
                              'ORDER BY created_at DESC LIMIT 3', (user_id, self.provider.name, since)).fetchall()
        for row in rows:
            try:
                result = self.provider.status(row['id'])
            except AccountError:
                continue
            if not result:
                continue
            status, amount = result
            if status == 'paid':
                try:
                    self.mark_paid(row['id'], amount)
                except AccountError:
                    self.set_status(row['id'], 'failed')   # e.g. amount mismatch: never activate
            elif status in ('failed', 'expired'):
                self.set_status(row['id'], status)

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
            if order['plan'] in ('pro', 'business') and user['referred_by']:
                self._reward_referrer(db, user['referred_by'], now)
        return True

    # ---- referrals ---------------------------------------------------------
    def referral_code(self, user_id):
        """The member's own code (made the first time it is asked for)."""
        with self.connect() as db:
            row = db.execute('SELECT ref_code FROM users WHERE id=?', (user_id,)).fetchone()
            if not row:
                raise AccountError(404, 'Akun tidak ditemukan.')
            if row['ref_code']:
                return row['ref_code']
            for _ in range(20):
                code = ''.join(secrets.choice(REF_ALPHABET) for _ in range(7))
                try:
                    db.execute('UPDATE users SET ref_code=? WHERE id=? AND ref_code IS NULL', (code, user_id))
                    return db.execute('SELECT ref_code FROM users WHERE id=?', (user_id,)).fetchone()['ref_code']
                except sqlite3.IntegrityError:
                    continue
        raise AccountError(500, 'Kode referral tidak bisa dibuat.')

    def attach_referrer(self, user_id, code, now=None):
        """A brand-new account that came through a referral link remembers who
        invited it (never itself, never later). True when attached."""
        code = (code or '').strip().upper()
        if not re.fullmatch(r'[A-Z0-9]{4,12}', code):
            return False
        now = int(now or time.time())
        with self.connect() as db:
            owner = db.execute('SELECT id FROM users WHERE ref_code=?', (code,)).fetchone()
            user = db.execute('SELECT id, referred_by, created_at FROM users WHERE id=?', (user_id,)).fetchone()
            if (not owner or not user or owner['id'] == user['id'] or user['referred_by']
                    or now - user['created_at'] > REFERRAL_NEW_SECONDS):
                return False
            db.execute('UPDATE users SET referred_by=? WHERE id=?', (owner['id'], user['id']))
        return True

    @staticmethod
    def _qualified(db, user_id):
        return db.execute("""SELECT COUNT(DISTINCT u.id) FROM users u JOIN orders o ON o.user_id = u.id
                             WHERE u.referred_by=? AND o.status='paid' AND o.plan IN ('pro', 'business')""", (user_id,)).fetchone()[0]

    def _reward_referrer(self, db, referrer_id, now):
        """Every REFERRAL_TARGET paying friends: REFERRAL_DAYS more days — of the
        member's running paid plan, else Pro. Each reward is given once."""
        qualified = self._qualified(db, referrer_id)
        given = db.execute('SELECT COUNT(*) FROM referral_rewards WHERE user_id=?', (referrer_id,)).fetchone()[0]
        while qualified // REFERRAL_TARGET > given:
            ref = db.execute('SELECT plan, plan_expires_at FROM users WHERE id=?', (referrer_id,)).fetchone()
            if not ref:
                return
            if ref['plan'] != 'free' and (ref['plan_expires_at'] or 0) > now:
                plan, until = ref['plan'], min(self.LIFETIME, ref['plan_expires_at'] + REFERRAL_DAYS * 86400)
            else:
                plan, until = 'pro', now + REFERRAL_DAYS * 86400
            db.execute('UPDATE users SET plan=?, plan_expires_at=? WHERE id=?', (plan, until, referrer_id))
            given += 1
            db.execute('INSERT INTO referral_rewards(user_id, friends, days, granted_at) VALUES(?,?,?,?)',
                       (referrer_id, given * REFERRAL_TARGET, REFERRAL_DAYS, now))

    def referral_stats(self, user_id):
        code = self.referral_code(user_id)
        with self.connect() as db:
            signups = db.execute('SELECT COUNT(*) FROM users WHERE referred_by=?', (user_id,)).fetchone()[0]
            qualified = self._qualified(db, user_id)
            rewards = db.execute('SELECT COUNT(*) AS n, COALESCE(SUM(days), 0) AS days FROM referral_rewards WHERE user_id=?', (user_id,)).fetchone()
        return dict(code=code, signups=signups, subscribed=qualified, rewards=rewards['n'], rewardDays=rewards['days'],
                    target=REFERRAL_TARGET, days=REFERRAL_DAYS, toNext=REFERRAL_TARGET - qualified % REFERRAL_TARGET)

    # Far in the future: a plan granted for good ("lifetime").
    LIFETIME = 4102444800          # 2100-01-01

    def grant_plan(self, email, plan, days=None, now=None):
        """Give a member a plan without payment (admin): `days` more days (added
        after the current period when the same plan is still running), or for
        good when days is None. Returns the member as public_user."""
        if plan not in PLANS:
            raise AccountError(400, 'Paket tidak dikenal: ' + str(plan))
        now = int(now or time.time())
        with self.connect() as db:
            user = db.execute('SELECT * FROM users WHERE email=?', ((email or '').strip().lower(),)).fetchone()
            if not user:
                raise AccountError(404, 'Member tidak ditemukan: ' + str(email))
            if plan == 'free':
                expires = None
            elif days is None:
                expires = self.LIFETIME
            else:
                running = user['plan'] == plan and (user['plan_expires_at'] or 0) > now
                expires = min(self.LIFETIME, (user['plan_expires_at'] if running else now) + int(days) * 86400)
            db.execute('UPDATE users SET plan=?, plan_expires_at=? WHERE id=?', (plan, expires, user['id']))
            return self.public_user(db.execute('SELECT * FROM users WHERE id=?', (user['id'],)).fetchone())

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
