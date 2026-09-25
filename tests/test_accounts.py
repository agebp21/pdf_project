import hashlib
import hmac
from urllib.parse import parse_qs
import http.cookiejar
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import accounts
import server


class Client:
    def __init__(self, base, host=None):
        self.base, self.host = base, host
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=dict(headers or {}))
        if data is not None:
            request.add_header('Content-Type', 'application/json')
        if self.host:
            request.add_header('Host', self.host)
            # Behind the proxy the browser talks to https://host; the cookie
            # jar keys cookies by the URL, so pass the session cookie by hand.
            cookie = '; '.join(f'{c.name}={c.value}' for c in self.jar)
            if cookie:
                request.add_header('Cookie', cookie)
        try:
            with self.opener.open(request) as response:
                raw, status, cookie = response.read(), response.status, response.headers.get('Set-Cookie')
        except urllib.error.HTTPError as error:
            with error:
                raw, status, cookie = error.read(), error.code, error.headers.get('Set-Cookie')
        if self.host and cookie:
            name, _, rest = cookie.partition('=')
            value = rest.split(';')[0]
            self.jar.clear()
            if value:
                self.jar.set_cookie(http.cookiejar.Cookie(0, name, value, None, False, '', False, False, '/', True,
                                                          False, None, False, None, None, {}))
        return status, (json.loads(raw) if raw[:1] in (b'{', b'[') else raw), cookie


class AccountsBase(unittest.TestCase):
    provider = None

    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.previous = (server.ACCOUNTS, dict(server.CONFIG))
        server.ACCOUNTS = accounts.Accounts(Path(cls.temporary.name) / 'accounts.db', cls.provider,
                                            getattr(cls, 'usd_provider', None))
        cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:' + str(cls.httpd.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()
        server.ACCOUNTS, config = cls.previous
        server.CONFIG.clear()
        server.CONFIG.update(config)
        cls.temporary.cleanup()


class LocalAccountTests(AccountsBase):
    def test_register_login_me_logout(self):
        client = Client(self.base)
        status, body, cookie = client.call('POST', '/api/auth/register',
                                           {'email': 'Sari@Example.com', 'password': 'rahasia-123', 'name': 'Sari'})
        self.assertEqual(status, 201)
        self.assertEqual(body['user']['email'], 'sari@example.com')
        self.assertEqual(body['user']['plan'], 'free')
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Lax', cookie)
        self.assertNotIn('Secure', cookie, 'local HTTP must not set Secure cookies')
        self.assertEqual(client.call('GET', '/api/auth/me')[1]['user']['name'], 'Sari')
        self.assertEqual(client.call('POST', '/api/auth/logout', {})[0], 200)
        self.assertIsNone(client.call('GET', '/api/auth/me')[1]['user'])
        status, body, _ = client.call('POST', '/api/auth/login', {'email': 'sari@example.com', 'password': 'rahasia-123'})
        self.assertEqual(status, 200)
        self.assertEqual(client.call('GET', '/api/auth/me')[1]['user']['email'], 'sari@example.com')

    def test_validation_and_duplicates(self):
        client = Client(self.base)
        self.assertEqual(client.call('POST', '/api/auth/register', {'email': 'bad', 'password': 'rahasia-123'})[0], 400)
        self.assertEqual(client.call('POST', '/api/auth/register', {'email': 'a@b.co', 'password': 'short'})[0], 400)
        self.assertEqual(client.call('POST', '/api/auth/register', {'email': 'dup@b.co', 'password': 'rahasia-123'})[0], 201)
        self.assertEqual(client.call('POST', '/api/auth/register', {'email': 'DUP@b.co', 'password': 'rahasia-123'})[0], 409)

    def test_wrong_password_and_throttle(self):
        client = Client(self.base)
        client.call('POST', '/api/auth/register', {'email': 'throttle@b.co', 'password': 'rahasia-123'})
        for _ in range(5):
            self.assertEqual(client.call('POST', '/api/auth/login', {'email': 'throttle@b.co', 'password': 'wrong-pass'})[0], 401)
        self.assertEqual(client.call('POST', '/api/auth/login', {'email': 'throttle@b.co', 'password': 'rahasia-123'})[0], 429)
        self.assertEqual(client.call('POST', '/api/auth/login', {'email': 'nobody@b.co', 'password': 'whatever1'})[0], 401)

    def test_password_is_hashed(self):
        client = Client(self.base)
        client.call('POST', '/api/auth/register', {'email': 'hash@b.co', 'password': 'rahasia-123'})
        with server.ACCOUNTS.connect() as db:
            stored = db.execute("SELECT password_hash FROM users WHERE email='hash@b.co'").fetchone()[0]
            tokens = [row[0] for row in db.execute('SELECT token_hash FROM sessions')]
        self.assertTrue(stored.startswith('pbkdf2_sha256$'))
        self.assertNotIn('rahasia-123', stored)
        session = next(c.value for c in client.jar)
        self.assertNotIn(session, tokens, 'only the token hash is stored')
        self.assertIn(hashlib.sha256(session.encode()).hexdigest(), tokens)

    def test_mock_checkout_extends_plan_once(self):
        client = Client(self.base)
        client.call('POST', '/api/auth/register', {'email': 'buyer@b.co', 'password': 'rahasia-123'})
        self.assertEqual(client.call('GET', '/api/billing/plans')[1]['provider'], 'mock')
        self.assertEqual(client.call('POST', '/api/billing/checkout', {'plan': 'free', 'cycle': 'monthly'})[0], 400)
        status, order, _ = client.call('POST', '/api/billing/checkout', {'plan': 'pro', 'cycle': 'yearly'})
        self.assertEqual(status, 200)
        self.assertEqual(order['amount'], accounts.PLANS['pro']['yearly'])
        self.assertEqual(client.call('POST', '/api/billing/mock/pay', {'orderId': order['orderId']})[0], 200)
        user = client.call('GET', '/api/auth/me')[1]['user']
        self.assertEqual(user['plan'], 'pro')
        self.assertIn('apk', user['entitlements'])
        first_expiry = user['planExpiresAt']
        client.call('POST', '/api/billing/mock/pay', {'orderId': order['orderId']})
        self.assertEqual(client.call('GET', '/api/auth/me')[1]['user']['planExpiresAt'], first_expiry, 'paying twice extends once')
        orders = client.call('GET', '/api/billing/orders')[1]['orders']
        self.assertEqual(orders[0]['status'], 'paid')
        # Someone else can't pay (or see) this order.
        other = Client(self.base)
        other.call('POST', '/api/auth/register', {'email': 'other@b.co', 'password': 'rahasia-123'})
        self.assertEqual(other.call('POST', '/api/billing/mock/pay', {'orderId': order['orderId']})[0], 404)
        self.assertEqual(other.call('GET', '/api/billing/orders')[1]['orders'], [])

    def test_invoice_pdf_for_own_paid_orders(self):
        client = Client(self.base)
        client.call('POST', '/api/auth/register', {'email': 'inv@b.co', 'password': 'rahasia-123', 'name': 'Budi'})
        order = client.call('POST', '/api/billing/checkout', {'plan': 'pro', 'cycle': 'yearly'})[1]
        path = f"/api/billing/orders/{order['orderId']}/invoice.pdf"
        self.assertEqual(client.call('GET', path)[0], 404, 'no invoice before payment')
        client.call('POST', '/api/billing/mock/pay', {'orderId': order['orderId']})
        request = urllib.request.Request(self.base + path)
        request.add_header('Cookie', '; '.join(f'{c.name}={c.value}' for c in client.jar))
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.headers.get_content_type(), 'application/pdf')
            self.assertIn(f"MyFlipbook-INV-{order['orderId']}.pdf", response.headers['Content-Disposition'])
            pdf = response.read()
        self.assertTrue(pdf.startswith(b'%PDF-1.4') and pdf.rstrip().endswith(b'%%EOF'))
        try:
            import pymupdf
        except ImportError:
            pymupdf = None
        if pymupdf:
            text = pymupdf.open(stream=pdf, filetype='pdf')[0].get_text()
            for expected in ('INVOICE', 'INV-' + order['orderId'], 'Rp 990.000', 'Budi', 'inv@b.co', 'TEST'):
                self.assertIn(expected, text)
        other = Client(self.base)
        other.call('POST', '/api/auth/register', {'email': 'inv2@b.co', 'password': 'rahasia-123'})
        self.assertEqual(other.call('GET', path)[0], 404, "someone else's invoice is not reachable")
        self.assertEqual(Client(self.base).call('GET', path)[0], 401)
        self.assertEqual(client.call('GET', '/api/billing/orders/../../x/invoice.pdf')[0], 404)

    def test_requires_login_and_json(self):
        client = Client(self.base)
        self.assertEqual(client.call('POST', '/api/billing/checkout', {'plan': 'pro', 'cycle': 'monthly'})[0], 401)
        self.assertEqual(client.call('GET', '/api/billing/orders')[0], 401)
        request = urllib.request.Request(self.base + '/api/auth/login', data=b'email=x', method='POST',
                                         headers={'Content-Type': 'application/x-www-form-urlencoded'})
        with self.assertRaises(urllib.error.HTTPError) as result:
            urllib.request.urlopen(request)
        result.exception.close()
        self.assertEqual(result.exception.code, 415)

    def test_cross_origin_post_rejected(self):
        client = Client(self.base)
        status = client.call('POST', '/api/auth/register', {'email': 'x@evil.co', 'password': 'rahasia-123'},
                             headers={'Origin': 'https://evil.example'})[0]
        self.assertEqual(status, 403)

    def test_pages_served(self):
        for page in ('login.html', 'account.html'):
            with urllib.request.urlopen(self.base + '/' + page) as response:
                self.assertEqual(response.status, 200)

    def test_local_mode_needs_no_login_for_capabilities(self):
        body = Client(self.base).call('GET', '/api/capabilities')[1]
        self.assertTrue(body['token'])
        self.assertFalse(body['loginRequired'])


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def read(self):
        return json.dumps(self.body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class MidtransTests(AccountsBase):
    captured = []
    provider = accounts.MidtransProvider(
        'SB-server-key', opener=lambda request, timeout: MidtransTests.captured.append(request) or
        FakeResponse({'token': 'snap-token', 'redirect_url': 'https://app.sandbox.midtrans.com/snap/v4/redirection/x'}))

    def notify(self, client, order_id, amount, status='settlement', key='SB-server-key'):
        gross = f'{amount}.00'
        signature = hashlib.sha512((order_id + '200' + gross + key).encode()).hexdigest()
        return client.call('POST', '/api/billing/midtrans/notify', {
            'order_id': order_id, 'status_code': '200', 'gross_amount': gross, 'signature_key': signature,
            'transaction_status': status, 'fraud_status': 'accept'})

    def test_snap_checkout_and_signed_notification(self):
        client = Client(self.base)
        client.call('POST', '/api/auth/register', {'email': 'mid@b.co', 'password': 'rahasia-123', 'name': 'Mid'})
        status, order, _ = client.call('POST', '/api/billing/checkout', {'plan': 'business', 'cycle': 'monthly'})
        self.assertEqual(status, 200)
        self.assertTrue(order['redirectUrl'].startswith('https://app.sandbox.midtrans.com/'))
        request = self.captured[-1]
        self.assertTrue(request.full_url.endswith('/snap/v1/transactions'))
        payload = json.loads(request.data)
        self.assertEqual(payload['transaction_details'], {'order_id': order['orderId'], 'gross_amount': 149000})
        self.assertTrue(request.get_header('Authorization').startswith('Basic '))
        # Mock payment is not available with a real gateway.
        self.assertEqual(client.call('POST', '/api/billing/mock/pay', {'orderId': order['orderId']})[0], 404)
        # Forged signature / wrong amount are rejected; plan unchanged.
        self.assertEqual(self.notify(Client(self.base), order['orderId'], 149000, key='guess')[0], 403)
        self.assertEqual(self.notify(Client(self.base), order['orderId'], 1000)[0], 400)
        self.assertEqual(client.call('GET', '/api/auth/me')[1]['user']['plan'], 'free')
        # A genuine settlement upgrades the account.
        status, body, _ = self.notify(Client(self.base), order['orderId'], 149000)
        self.assertEqual((status, body['status']), (200, 'paid'))
        user = client.call('GET', '/api/auth/me')[1]['user']
        self.assertEqual(user['plan'], 'business')
        self.assertIn('exe', user['entitlements'])
        # A later "expire" for the same order must not undo the payment.
        self.notify(Client(self.base), order['orderId'], 149000, status='expire')
        self.assertEqual(client.call('GET', '/api/billing/orders')[1]['orders'][0]['status'], 'paid')


class TripayTests(AccountsBase):
    requests = []

    @staticmethod
    def opener(request, timeout):
        TripayTests.requests.append(request)
        if request.full_url.endswith('/merchant/payment-channel'):
            return FakeResponse({'success': True, 'data': [
                {'code': 'QRIS', 'name': 'QRIS', 'group': 'E-Wallet', 'active': True},
                {'code': 'BRIVA', 'name': 'BRI Virtual Account', 'group': 'Virtual Account', 'active': True},
                {'code': 'OVO', 'name': 'OVO', 'group': 'E-Wallet', 'active': False}]})
        return FakeResponse({'success': True, 'data': {'reference': 'T0001TEST', 'status': 'UNPAID',
                                                       'checkout_url': 'https://tripay.co.id/checkout/T0001TEST'}})

    provider = accounts.TripayProvider('DEV-api', 'priv-key', 'T0001', opener=opener.__func__)

    def callback(self, body, key='priv-key', event='payment_status'):
        raw = json.dumps(body).encode()
        signature = hmac.new(key.encode(), raw, hashlib.sha256).hexdigest()
        request = urllib.request.Request(self.base + '/api/billing/tripay/callback', data=raw, method='POST', headers={
            'Content-Type': 'application/json', 'X-Callback-Signature': signature, 'X-Callback-Event': event})
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.loads(error.read())

    def test_tripay_checkout_and_callback(self):
        client = Client(self.base)
        client.call('POST', '/api/auth/register', {'email': 'tri@b.co', 'password': 'rahasia-123', 'name': 'Tri'})
        methods = client.call('GET', '/api/billing/methods')[1]['methods']
        self.assertEqual([m['code'] for m in methods], ['QRIS', 'BRIVA'], 'inactive channels hidden')
        self.assertEqual(client.call('POST', '/api/billing/checkout', {'plan': 'pro', 'cycle': 'monthly'})[0], 400,
                         'a payment method is required')
        status, order, _ = client.call('POST', '/api/billing/checkout', {'plan': 'pro', 'cycle': 'monthly', 'method': 'QRIS'})
        self.assertEqual(status, 200)
        self.assertEqual(order['redirectUrl'], 'https://tripay.co.id/checkout/T0001TEST')
        create = self.requests[-1]
        self.assertTrue(create.full_url.startswith('https://tripay.co.id/api-sandbox/transaction/create'))
        self.assertEqual(create.get_header('Authorization'), 'Bearer DEV-api')
        form = {k: v[0] for k, v in parse_qs(create.data.decode()).items()}
        price = str(accounts.PLANS['pro']['monthly'])
        expected = hmac.new(b'priv-key', ('T0001' + order['orderId'] + price).encode(), hashlib.sha256).hexdigest()
        self.assertEqual(form['signature'], expected)
        self.assertEqual((form['method'], form['amount'], form['order_items[0][quantity]']), ('QRIS', price, '1'))
        self.assertTrue(form['callback_url'].endswith('/api/billing/tripay/callback'))
        body = {'reference': 'T0001TEST', 'merchant_ref': order['orderId'], 'status': 'PAID', 'total_amount': int(price)}
        # Forged signature, wrong event, and a mismatched reference change nothing.
        self.assertEqual(self.callback(body, key='guess')[0], 403)
        self.assertEqual(self.callback(body, event='other')[0], 400)
        self.assertEqual(self.callback(dict(body, reference='T0001OTHER'))[0], 400)
        self.assertEqual(client.call('GET', '/api/auth/me')[1]['user']['plan'], 'free')
        status, reply = self.callback(body)
        self.assertEqual((status, reply['success']), (200, True))
        self.assertEqual(client.call('GET', '/api/auth/me')[1]['user']['plan'], 'pro')
        self.callback(dict(body, status='EXPIRED'))
        self.assertEqual(client.call('GET', '/api/billing/orders')[1]['orders'][0]['status'], 'paid')


class PaywallTests(AccountsBase):
    def setUp(self):
        server.CONFIG['paywall'] = True

    def tearDown(self):
        server.CONFIG['paywall'] = False

    def get(self, client, path):
        return client.call('GET', path)[0]

    def test_export_needs_pro_preview_stays_free(self):
        guest, free, pro = Client(self.base), Client(self.base), Client(self.base)
        free.call('POST', '/api/auth/register', {'email': 'free-pw@b.co', 'password': 'rahasia-123'})
        pro.call('POST', '/api/auth/register', {'email': 'pro-pw@b.co', 'password': 'rahasia-123'})
        order = pro.call('POST', '/api/billing/checkout', {'plan': 'pro', 'cycle': 'monthly'})[1]
        self.assertEqual(order['amount'], 99000)
        pro.call('POST', '/api/billing/mock/pay', {'orderId': order['orderId']})
        for template in ('viewer.js', 'viewer.css', 'index.html'):
            path = '/assets/export/' + template
            self.assertEqual(self.get(guest, path), 401)
            self.assertEqual(self.get(free, path), 402)
            self.assertEqual(self.get(pro, path), 200)
        # Preview assets shared with flipbook.html stay public.
        for public in ('/assets/export/layout.js', '/assets/export/book-effects.css', '/flipbook.html'):
            self.assertEqual(self.get(guest, public), 200)
        caps = free.call('GET', '/api/capabilities')[1]
        self.assertTrue(caps['paywall'])
        self.assertNotIn('export', caps['entitlements'])
        self.assertIn('export', pro.call('GET', '/api/capabilities')[1]['entitlements'])
        # Builds: free blocked, Pro may build APK but not EXE (Business).
        headers = {'X-Build-Token': server.TOKEN}
        self.assertEqual(free.call('POST', '/api/build/apk', {}, headers=headers)[0], 402)
        self.assertEqual(pro.call('POST', '/api/build/apk', {}, headers=headers)[0], 400, 'passes the gate')
        status, body, _ = pro.call('POST', '/api/build/exe', {}, headers=headers)
        self.assertEqual(status, 402)
        self.assertIn('Business', body['error'])
        # Office conversion stays free locally.
        self.assertEqual(guest.call('POST', '/api/convert/word-to-pdf', {}, headers=headers)[0], 400)

    def test_unreleased_pages_show_coming_soon(self):
        for page, name in (('notebook.html', 'Notebook PDF'), ('animation.html', 'Flipbook Animation')):
            status, body, _ = Client(self.base).call('GET', '/' + page)
            self.assertEqual(status, 200)
            self.assertIn(f'data-feature="{name}"', body.decode())
            self.assertNotIn('ae-app', body.decode())
        server.CONFIG['paywall'] = False
        self.assertIn(b'ae-app', Client(self.base).call('GET', '/animation.html')[1], '--no-paywall keeps the editor')


class LemonSqueezyTests(AccountsBase):
    requests = []

    @staticmethod
    def opener(request, timeout):
        LemonSqueezyTests.requests.append(request)
        return FakeResponse({'data': {'type': 'checkouts', 'id': 'chk_1',
                                      'attributes': {'url': 'https://myflipbook.lemonsqueezy.com/checkout/custom/chk_1'}}})

    usd_provider = accounts.LemonSqueezyProvider(
        'ls-api', '4242', 'whsec', {('pro', 'monthly'): '111', ('pro', 'yearly'): '112'}, opener=opener.__func__)

    def webhook(self, event, body, secret='whsec'):
        raw = json.dumps(body).encode()
        signature = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        request = urllib.request.Request(self.base + '/api/billing/lemonsqueezy/webhook', data=raw, method='POST', headers={
            'Content-Type': 'application/json', 'X-Signature': signature, 'X-Event-Name': event})
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.loads(error.read())

    def expiry(self, client):
        return client.call('GET', '/api/auth/me')[1]['user']['planExpiresAt']

    def test_usd_subscription_initial_and_renewal(self):
        client = Client(self.base)
        client.call('POST', '/api/auth/register', {'email': 'usd@b.co', 'password': 'rahasia-123', 'name': 'Jane'})
        plans = client.call('GET', '/api/billing/plans')[1]
        self.assertEqual(plans['providers'], {'IDR': 'mock', 'USD': 'lemonsqueezy'})
        self.assertEqual(plans['plans'][1]['usd'], {'monthly': 999, 'yearly': 9900})
        self.assertEqual(client.call('POST', '/api/billing/checkout',
                                     {'plan': 'business', 'cycle': 'monthly', 'currency': 'USD'})[0], 503,
                         'variant not configured')
        self.assertEqual(client.call('POST', '/api/billing/checkout',
                                     {'plan': 'pro', 'cycle': 'monthly', 'currency': 'EUR'})[0], 400)
        status, order, _ = client.call('POST', '/api/billing/checkout', {'plan': 'pro', 'cycle': 'monthly', 'currency': 'USD'})
        self.assertEqual(status, 200)
        self.assertEqual((order['amount'], order['currency']), (999, 'USD'))
        self.assertTrue(order['redirectUrl'].startswith('https://myflipbook.lemonsqueezy.com/checkout/'))
        request = self.requests[-1]
        self.assertEqual(request.full_url, 'https://api.lemonsqueezy.com/v1/checkouts')
        self.assertEqual(request.get_header('Authorization'), 'Bearer ls-api')
        self.assertEqual(request.get_header('Content-type'), 'application/vnd.api+json')
        body = json.loads(request.data)['data']
        self.assertEqual(body['relationships']['variant']['data'], {'type': 'variants', 'id': '111'})
        self.assertEqual(body['relationships']['store']['data'], {'type': 'stores', 'id': '4242'})
        self.assertEqual(body['attributes']['checkout_data']['custom']['order_id'], order['orderId'])
        # Simulated payment can't mark a real-gateway order paid.
        self.assertEqual(client.call('POST', '/api/billing/mock/pay', {'orderId': order['orderId']})[0], 404)
        created = {'meta': {'event_name': 'subscription_created', 'custom_data': {'order_id': order['orderId']}},
                   'data': {'type': 'subscriptions', 'id': '9001', 'attributes': {'status': 'active'}}}
        self.assertEqual(self.webhook('subscription_created', created, secret='guess')[0], 403)
        self.assertIsNone(self.expiry(client))
        self.assertEqual(self.webhook('subscription_created', created), (200, {'status': 'paid'}))
        first = self.expiry(client)
        self.assertEqual(client.call('GET', '/api/auth/me')[1]['user']['plan'], 'pro')
        self.webhook('subscription_created', created)  # retried delivery
        self.assertEqual(self.expiry(client), first)
        initial = {'meta': {'event_name': 'subscription_payment_success'},
                   'data': {'type': 'subscription-invoices', 'id': '7001',
                            'attributes': {'subscription_id': 9001, 'billing_reason': 'initial', 'status': 'paid',
                                           'total': 999, 'currency': 'USD'}}}
        self.assertEqual(self.webhook('subscription_payment_success', initial), (200, {'status': 'ignored'}))
        self.assertEqual(self.expiry(client), first, 'initial invoice is not counted twice')
        renewal = json.loads(json.dumps(initial))
        renewal['data']['id'] = '7002'
        renewal['data']['attributes']['billing_reason'] = 'renewal'
        self.assertEqual(self.webhook('subscription_payment_success', renewal), (200, {'status': 'paid'}))
        self.webhook('subscription_payment_success', renewal)  # retried delivery
        self.assertEqual(self.expiry(client), first + accounts.CYCLE_SECONDS['monthly'], 'renewal extends once')
        orders = client.call('GET', '/api/billing/orders')[1]['orders']
        self.assertEqual(sorted((o['id'][:3], o['currency'], o['status']) for o in orders),
                         [('LS-', 'USD', 'paid'), ('MF-', 'USD', 'paid')])
        unknown = json.loads(json.dumps(renewal))
        unknown['data']['id'] = '7003'
        unknown['data']['attributes']['subscription_id'] = 12345
        self.assertEqual(self.webhook('subscription_payment_success', unknown)[0], 404)

    def test_usd_simulation_with_local_mock(self):
        store = server.ACCOUNTS
        previous = store.usd_provider
        store.usd_provider = accounts.MockProvider()
        try:
            client = Client(self.base)
            client.call('POST', '/api/auth/register', {'email': 'usdmock@b.co', 'password': 'rahasia-123'})
            order = client.call('POST', '/api/billing/checkout',
                                {'plan': 'business', 'cycle': 'yearly', 'currency': 'USD'})[1]
            self.assertEqual((order['amount'], order['currency']), (19900, 'USD'))
            self.assertEqual(client.call('POST', '/api/billing/mock/pay', {'orderId': order['orderId']})[0], 200)
            self.assertEqual(client.call('GET', '/api/auth/me')[1]['user']['plan'], 'business')
        finally:
            store.usd_provider = previous


class HostedModeTests(AccountsBase):
    def setUp(self):
        # Mirrors `server.py --public-host ...` (paywall on by default).
        server.CONFIG.update(public_hosts={'myflipbook.test'}, secure=True, base_url='', paywall=True)

    def tearDown(self):
        server.CONFIG.update(public_hosts=set(), secure=False, paywall=False)

    def test_public_host_login_gates_server_features(self):
        guest = Client(self.base, host='myflipbook.test')
        caps = guest.call('GET', '/api/capabilities')[1]
        self.assertTrue(caps['loginRequired'])
        self.assertIsNone(caps['token'], 'no build/convert token without login')
        status, body, _ = guest.call('POST', '/api/convert/word-to-pdf', {}, headers={'X-Build-Token': server.TOKEN})
        self.assertEqual(status, 401)
        member = Client(self.base, host='myflipbook.test')
        status, _, cookie = member.call('POST', '/api/auth/register', {'email': 'host@b.co', 'password': 'rahasia-123'},
                                        headers={'Origin': 'https://myflipbook.test'})
        self.assertEqual(status, 201)
        self.assertIn('Secure', cookie)
        caps = member.call('GET', '/api/capabilities')[1]
        self.assertEqual(caps['token'], server.TOKEN)
        # Free plan: Office conversion allowed (reaches the converter), APK needs Pro.
        status = member.call('POST', '/api/convert/word-to-pdf', {}, headers={'X-Build-Token': server.TOKEN})[0]
        self.assertEqual(status, 400, 'passes the gate; rejected only for the bogus body')
        status, body, _ = member.call('POST', '/api/build/apk', {}, headers={'X-Build-Token': server.TOKEN})
        self.assertEqual(status, 402)

    def test_foreign_host_and_origin_rejected(self):
        self.assertEqual(Client(self.base, host='evil.test').call('GET', '/api/auth/me')[0], 403)
        status = Client(self.base, host='myflipbook.test').call(
            'POST', '/api/auth/login', {'email': 'a@b.co', 'password': 'x'}, headers={'Origin': 'https://evil.test'})[0]
        self.assertEqual(status, 403)

    def test_disabled_gateway_blocks_checkout(self):
        store = server.ACCOUNTS
        previous = store.provider
        store.provider = accounts.DisabledProvider()
        try:
            client = Client(self.base, host='myflipbook.test')
            client.call('POST', '/api/auth/register', {'email': 'nogw@b.co', 'password': 'rahasia-123'})
            self.assertFalse(client.call('GET', '/api/billing/plans')[1]['paymentsEnabled']['IDR'])
            self.assertEqual(client.call('POST', '/api/billing/checkout', {'plan': 'pro', 'cycle': 'monthly'})[0], 503)
        finally:
            store.provider = previous


if __name__ == '__main__':
    unittest.main()
