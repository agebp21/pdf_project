"""Duitku POP gateway: signed invoice, methods, HMAC callback, status check."""
import hashlib
import hmac
import http.cookiejar
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import accounts
import server


class Client:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            request.add_header('Content-Type', 'application/json')
        try:
            with self.opener.open(request) as response:
                raw, status = response.read(), response.status
        except urllib.error.HTTPError as error:
            with error:
                raw, status = error.read(), error.code
        return status, (json.loads(raw) if raw[:1] in (b'{', b'[') else raw)


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def read(self):
        return json.dumps(self.body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class AccountsBase(unittest.TestCase):
    provider = None

    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.previous = (server.ACCOUNTS, dict(server.CONFIG))
        server.ACCOUNTS = accounts.Accounts(Path(cls.temporary.name) / 'accounts.db', cls.provider)
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


def make_opener(status_code='01'):
    """Fake Duitku server: methods list, invoice creation, transaction status."""
    requests = []

    def opener(request, timeout):
        requests.append(request)
        url = request.full_url
        if url.endswith('/api/merchant/paymentmethod/getpaymentmethod'):
            return FakeResponse({'statusCode': '00', 'paymentFee': [
                {'paymentMethod': 'SP', 'paymentName': 'QRIS', 'paymentImage': ''},
                {'paymentMethod': 'BC', 'paymentName': 'BCA Virtual Account', 'paymentImage': ''}]})
        if url.endswith('/api/merchant/transactionStatus'):
            return FakeResponse({'statusCode': status_code, 'merchantCode': 'D0001',
                                 'merchantOrderId': 'x', 'amount': str(accounts.PLANS['pro']['monthly'])})
        return FakeResponse({'statusCode': '00', 'statusMessage': 'SUCCESS', 'merchantCode': 'D0001',
                             'reference': 'D0001TESTREF',
                             'paymentUrl': 'https://app-sandbox.duitku.com/redirect_checkout?reference=D0001TESTREF'})

    opener.requests = requests
    return opener


class DuitkuTests(AccountsBase):
    provider = accounts.DuitkuProvider('D0001', 'api-key', opener=make_opener('01'))

    def post_form(self, path, fields):
        data = urlencode(fields).encode()
        request = urllib.request.Request(self.base + path, data=data, method='POST',
                                         headers={'Content-Type': 'application/x-www-form-urlencoded'})
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            with error:
                return error.code, error.read()

    def signed(self, order_id, amount, key='api-key', result='00', reference='D0001TESTREF'):
        signature = hmac.new(key.encode(), ('D0001' + amount + order_id).encode(), hashlib.sha256).hexdigest()
        return {'merchantCode': 'D0001', 'amount': amount, 'merchantOrderId': order_id,
                'productDetail': 'MyFlipbook Pro (monthly)', 'paymentCode': 'SP', 'resultCode': result,
                'reference': reference, 'signature': signature}

    def test_create_sends_signed_invoice(self):
        client = Client(self.base)
        client.call('POST', '/api/auth/register', {'email': 'dui@b.co', 'password': 'rahasia-123', 'name': 'Dui'})
        self.assertEqual(client.call('GET', '/api/billing/plans')[1]['providers']['IDR'], 'duitku')
        status, order = client.call('POST', '/api/billing/checkout', {'plan': 'pro', 'cycle': 'monthly'})
        self.assertEqual(status, 200)
        self.assertTrue(order['redirectUrl'].startswith('https://app-sandbox.duitku.com/redirect_checkout?reference='))
        create = self.provider.opener.requests[-1]
        request = create
        self.assertTrue(request.full_url.startswith('https://api-sandbox.duitku.com/api/merchant/createInvoice'))
        self.assertEqual(request.get_header('X-duitku-merchantcode'), 'D0001')
        expected = hmac.new(b'api-key', ('D0001' + request.get_header('X-duitku-timestamp')).encode(),
                            hashlib.sha256).hexdigest()
        self.assertEqual(request.get_header('X-duitku-signature'), expected)
        body = json.loads(request.data.decode())
        price = str(accounts.PLANS['pro']['monthly'])
        self.assertEqual((body['paymentAmount'], body['merchantOrderId']), (accounts.PLANS['pro']['monthly'], order['orderId']))
        self.assertNotIn('paymentMethod', body, 'no method = Duitku shows every channel')
        self.assertTrue(body['callbackUrl'].endswith('/api/payment/duitku/callback'))
        self.assertIn(order['orderId'], body['returnUrl'])

    def test_method_passed_and_validated(self):
        client = Client(self.base)
        client.call('POST', '/api/auth/register', {'email': 'duim@b.co', 'password': 'rahasia-123'})
        methods = client.call('GET', '/api/billing/methods')[1]['methods']
        self.assertEqual([m['code'] for m in methods], ['SP', 'BC'])
        self.assertEqual(client.call('POST', '/api/billing/checkout',
                                     {'plan': 'pro', 'cycle': 'monthly', 'method': 'BOGUS'})[0], 400)
        status, order = client.call('POST', '/api/billing/checkout',
                                    {'plan': 'pro', 'cycle': 'monthly', 'method': 'SP'})
        self.assertEqual(status, 200)
        body = json.loads(self.provider.opener.requests[-1].data.decode())
        self.assertEqual(body['paymentMethod'], 'SP')

    def test_callback_marks_paid(self):
        client = Client(self.base)
        client.call('POST', '/api/auth/register', {'email': 'duic@b.co', 'password': 'rahasia-123'})
        price = str(accounts.PLANS['pro']['monthly'])
        _, order = client.call('POST', '/api/billing/checkout', {'plan': 'pro', 'cycle': 'monthly'})
        # Forged signature and a mismatched reference change nothing.
        self.assertEqual(self.post_form('/api/payment/duitku/callback',
                                        self.signed(order['orderId'], price, key='guess'))[0], 403)
        status, raw = self.post_form('/api/payment/duitku/callback',
                                     self.signed(order['orderId'], price, reference='OTHER'))
        self.assertEqual(status, 400)
        self.assertEqual(client.call('GET', '/api/auth/me')[1]['user']['plan'], 'free')
        status, raw = self.post_form('/api/payment/duitku/callback', self.signed(order['orderId'], price))
        self.assertEqual(status, 200)
        self.assertEqual(raw, b'SUCCESS')
        self.assertEqual(client.call('GET', '/api/auth/me')[1]['user']['plan'], 'pro')
        # A failed payment on a second order is recorded, not activated.
        _, order2 = client.call('POST', '/api/billing/checkout', {'plan': 'pro', 'cycle': 'monthly'})
        status, raw = self.post_form('/api/payment/duitku/callback', self.signed(order2['orderId'], price, result='01'))
        self.assertEqual((status, raw), (200, b'SUCCESS'))
        orders = {o['id']: o['status'] for o in client.call('GET', '/api/billing/orders')[1]['orders']}
        self.assertEqual((orders[order['orderId']], orders[order2['orderId']]), ('paid', 'failed'))

    def test_sandbox_and_production_hosts(self):
        sandbox = accounts.DuitkuProvider('D1', 'k')
        self.assertIn('api-sandbox.duitku.com', sandbox.base)
        live = accounts.DuitkuProvider('D1', 'k', production=True)
        self.assertIn('api-prod.duitku.com', live.base)


class DuitkuStatusTests(AccountsBase):
    """A pending order settles on the next order list, without any callback."""
    provider = accounts.DuitkuProvider('D0001', 'api-key', opener=make_opener('00'))

    def test_status_settles_pending(self):
        client = Client(self.base)
        client.call('POST', '/api/auth/register', {'email': 'duis@b.co', 'password': 'rahasia-123'})
        _, order = client.call('POST', '/api/billing/checkout', {'plan': 'pro', 'cycle': 'monthly'})
        self.assertEqual(client.call('GET', '/api/billing/orders')[1]['orders'][0]['status'], 'paid')
        self.assertEqual(client.call('GET', '/api/auth/me')[1]['user']['plan'], 'pro')


class DuitkuSelectionTests(unittest.TestCase):
    def selected(self, env):
        with tempfile.TemporaryDirectory() as temporary, \
                mock.patch.dict(os.environ, dict(env, MYFLIPBOOK_DB=str(Path(temporary) / 'a.db'))), \
                mock.patch.object(server, 'ACCOUNTS', None):
            return server.get_accounts().provider.name

    def test_duitku_is_the_default_rupiah_gateway(self):
        keys = {'DUITKU_MERCHANT_CODE': 'D1', 'DUITKU_API_KEY': 'k',
                'MIDTRANS_SERVER_KEY': 'SB-x', 'TRIPAY_API_KEY': 'a',
                'TRIPAY_PRIVATE_KEY': 'b', 'TRIPAY_MERCHANT_CODE': 'c'}
        cases = [('', 'duitku'), ('duitku', 'duitku'), ('midtrans', 'midtrans'), ('tripay', 'tripay')]
        for prefer, expected in cases:
            with self.subTest(prefer=prefer):
                self.assertEqual(self.selected(dict(keys, MYFLIPBOOK_IDR_PROVIDER=prefer)), expected)

    def test_old_fallbacks_without_duitku(self):
        self.assertEqual(self.selected({'TRIPAY_API_KEY': 'a', 'TRIPAY_PRIVATE_KEY': 'b',
                                        'TRIPAY_MERCHANT_CODE': 'c', 'MYFLIPBOOK_IDR_PROVIDER': ''}), 'tripay')
        self.assertEqual(self.selected({'MIDTRANS_SERVER_KEY': 'SB-x', 'MYFLIPBOOK_IDR_PROVIDER': ''}), 'midtrans')
        self.assertEqual(self.selected({'MIDTRANS_SERVER_KEY': 'SB-x', 'MYFLIPBOOK_IDR_PROVIDER': 'tripay'}), 'midtrans')


if __name__ == '__main__':
    unittest.main()
