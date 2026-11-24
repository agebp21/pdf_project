"""Admin prices and promotions must match checkout and public price displays."""
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import accounts
import admin_server
import pricing
import seo
from test_accounts import AccountsBase, Client


DEFAULTS = {f'{plan}_{cycle}': value[cycle]
            for plan, value in accounts.PLANS.items() if plan != 'basic' for cycle in ('monthly', 'yearly')} | {
                f'{plan}_credit': value['amount'] for plan, value in accounts.AI_PACKS.items()}


class PricingHttpTests(AccountsBase):
    def setUp(self):
        self.price_folder = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'MYFLIPBOOK_PRICING_FILE': str(Path(self.price_folder.name) / 'pricing.json')})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.price_folder.cleanup()

    def buyer(self):
        client = Client(self.base)
        client.call('POST', '/api/auth/register', {'email': 'promo-' + os.urandom(4).hex() + '@example.com',
                                                    'password': 'rahasia-123'})
        return client

    def test_automatic_promo_matches_page_and_checkout(self):
        prices = dict(DEFAULTS, medium_monthly=100_000)
        pricing.save_prices(prices, DEFAULTS)
        pricing.add_promo(dict(name='Diskon umum', code='', percent=20, plan='medium', cycle='monthly'), DEFAULTS)
        client = self.buyer()
        listed = client.call('GET', '/api/billing/plans')[1]['plans']
        medium = next(row for row in listed if row['id'] == 'medium')
        self.assertEqual((medium['monthly'], medium['listMonthly']), (80_000, 100_000))
        self.assertIn('Rp80.000', seo.harga_html())
        order = client.call('POST', '/api/billing/checkout', {'plan': 'medium', 'cycle': 'monthly'})[1]
        self.assertEqual(order['amount'], 80_000)
        pricing.remove_promo(pricing.config()['promos'][0]['id'])
        pricing.save_prices(dict(DEFAULTS, medium_monthly=120_000), DEFAULTS)
        new_order = client.call('POST', '/api/billing/checkout', {'plan': 'medium', 'cycle': 'monthly'})[1]
        self.assertEqual(new_order['amount'], 120_000)
        amounts = [row['amount'] for row in client.call('GET', '/api/billing/orders')[1]['orders']]
        self.assertIn(80_000, amounts)
        self.assertIn(120_000, amounts)

    def test_code_promo_and_expiration(self):
        auto = pricing.add_promo(dict(name='Otomatis Pro', code='', percent=20,
                                     plan='pro', cycle='yearly'), DEFAULTS)
        promo = pricing.add_promo(dict(name='Hemat Pro', code='HEMAT15', percent=15,
                                      plan='pro', cycle='yearly'), DEFAULTS)
        client = self.buyer()
        self.assertEqual(client.call('GET', '/api/billing/plans?promo=SALAH')[0], 400)
        plans = client.call('GET', '/api/billing/plans?promo=HEMAT15')[1]['plans']
        pro = next(row for row in plans if row['id'] == 'pro')
        self.assertEqual(pro['yearly'], round(DEFAULTS['pro_yearly'] * .85))
        self.assertEqual(next(row for row in client.call('GET', '/api/billing/plans')[1]['plans']
                              if row['id'] == 'pro')['yearly'], round(DEFAULTS['pro_yearly'] * .80))
        self.assertEqual(next(row for row in plans if row['id'] == 'medium')['monthly'], DEFAULTS['medium_monthly'])
        self.assertEqual(client.call('POST', '/api/billing/checkout',
                                     {'plan':'pro','cycle':'yearly','promoCode':'HEMAT15'})[1]['amount'], pro['yearly'])
        self.assertEqual(client.call('POST', '/api/billing/checkout',
                                     {'plan':'pro','cycle':'yearly','promoCode':'HEMAT15','currency':'USD'})[0], 400)
        pricing.remove_promo(promo['id'])
        pricing.remove_promo(auto['id'])
        pricing.add_promo(dict(name='Selesai', code='LAMA15', percent=15, plan='pro', cycle='yearly',
                               starts='2020-01-01', ends='2020-01-02'), DEFAULTS)
        self.assertEqual(client.call('GET', '/api/billing/plans?promo=LAMA15')[0], 400)

    def test_invalid_promo_cannot_make_tiny_price(self):
        with self.assertRaises(ValueError):
            pricing.add_promo(dict(name='Terlalu besar', code='', percent=80,
                                   plan='ai100', cycle='credit'), DEFAULTS)

    def test_admin_can_update_prices_and_create_promo(self):
        old = admin_server.CONFIG.copy()
        admin_server.CONFIG['local_no_login'] = True
        admin_server.CONFIG['proxy'] = False
        host = admin_server.ThreadingHTTPServer(('127.0.0.1', 0), admin_server.AdminHandler)
        worker = threading.Thread(target=host.serve_forever, daemon=True)
        worker.start()
        try:
            admin = Client('http://127.0.0.1:' + str(host.server_port))
            headers = {'X-Admin': '1'}
            self.assertEqual(admin.call('POST', '/api/pricing/prices', {'prices': dict(DEFAULTS, pro_monthly=190_000)}, headers)[0], 200)
            self.assertEqual(admin.call('GET', '/api/pricing')[1]['prices']['pro_monthly'], 190_000)
            self.assertEqual(admin.call('POST', '/api/pricing/promos',
                                        {'name':'Promo baru','code':'BARU10','percent':10,'plan':'pro','cycle':'monthly'}, headers)[0], 200)
            self.assertEqual(self.buyer().call('GET', '/api/billing/plans?promo=BARU10')[1]['plans'][2]['monthly'], 171_000)
            self.assertEqual(admin.call('POST', '/api/pricing/prices', {'prices': DEFAULTS})[0], 403)
            admin_server.CONFIG['local_no_login'] = False
            self.assertEqual(admin.call('POST', '/api/pricing/prices', {'prices': DEFAULTS}, headers)[0], 401)
        finally:
            host.shutdown(); host.server_close(); worker.join(timeout=2)
            admin_server.CONFIG.clear(); admin_server.CONFIG.update(old)


if __name__ == '__main__':
    unittest.main()
