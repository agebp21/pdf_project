"""Admin AI allowances are shared with member usage and enforcement limits."""
import os
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import accounts
import admin_server
import ai_quota_settings
import server
from test_accounts import Client


class AiQuotaAdminTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            'MYFLIPBOOK_AI_QUOTAS_FILE': str(Path(self.temp.name) / 'ai-quotas.json'),
            'MYFLIPBOOK_DB': str(Path(self.temp.name) / 'accounts.sqlite3'),
            'QUOTA_MEDIUM_AI': '40', 'QUOTA_MEDIUM_AI_MONTH': '240'})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def limits(self):
        return {'medium_month': 350, 'medium_window': 55, 'pro_month': 800, 'pro_window': 170}

    def test_saved_limits_override_env_and_restore(self):
        self.assertEqual(accounts.ai_limit('medium', 'month'), 240)
        ai_quota_settings.save(self.limits())
        self.assertEqual(accounts.ai_limit('medium', 'month'), 350)
        self.assertEqual(server.ai_month_limit({'plan':'medium'}), 350)
        self.assertEqual(server.quota_limit({'plan':'medium'}, 'ai'), 55)
        self.assertEqual(accounts.ai_limit('basic', 'month'), None)
        with self.assertRaises(ValueError):
            ai_quota_settings.save(dict(self.limits(), pro_month=-1))
        self.assertEqual(accounts.ai_limit('pro', 'month'), 800)
        ai_quota_settings.save(dict(self.limits(), pro_month=0))
        self.assertIsNone(accounts.ai_limit('pro', 'month'))

    def test_admin_routes_and_member_report(self):
        old = admin_server.CONFIG.copy()
        admin_server.CONFIG['local_no_login'] = True
        admin_server.CONFIG['proxy'] = False
        host = admin_server.ThreadingHTTPServer(('127.0.0.1', 0), admin_server.AdminHandler)
        worker = threading.Thread(target=host.serve_forever, daemon=True)
        worker.start()
        try:
            client = Client('http://127.0.0.1:' + str(host.server_port))
            headers = {'X-Admin':'1'}
            self.assertEqual(client.call('POST', '/api/ai-quotas', {'limits':self.limits()})[0], 403)
            self.assertEqual(client.call('POST', '/api/ai-quotas', {'limits':self.limits()}, headers)[0], 200)
            self.assertEqual(client.call('GET', '/api/ai-quotas')[1]['limits']['pro_month'], 800)
            store = accounts.Accounts(Path(self.temp.name) / 'accounts.sqlite3')
            store.register('quota@example.com', 'rahasia-123', 'Quota')
            store.grant_plan('quota@example.com', 'medium', 30)
            listing = client.call('GET', '/api/members')[1]['items']
            member = next(row for row in listing if row['email'] == 'quota@example.com')
            self.assertEqual(member['aiUsage']['month']['limit'], 350)
            self.assertEqual(member['aiUsage']['window']['limit'], 55)
            self.assertEqual(client.call('POST', '/api/ai-quotas/reset', {}, headers)[0], 200)
            self.assertEqual(client.call('GET', '/api/ai-quotas')[1]['limits']['medium_month'], 240)
            admin_server.CONFIG['local_no_login'] = False
            self.assertEqual(client.call('POST', '/api/ai-quotas', {'limits':self.limits()}, headers)[0], 401)
        finally:
            host.shutdown(); host.server_close(); worker.join(timeout=2)
            admin_server.CONFIG.clear(); admin_server.CONFIG.update(old)

    def test_unlimited_window_still_obeys_monthly_limit(self):
        ai_quota_settings.save(dict(self.limits(), medium_month=5, medium_window=0))
        fake_store = SimpleNamespace(usage_in=lambda *_: (5, None), use_ai_credits=lambda *_: False)
        handler = SimpleNamespace(current_user=lambda: {'id': 1, 'plan': 'medium'})
        with patch.object(server, 'hosted', return_value=True), patch.object(server, 'get_accounts', return_value=fake_store):
            with self.assertRaises(accounts.AccountError) as caught:
                server.Handler.quota(handler, 'ai')
        self.assertEqual(caught.exception.status, 429)

    def test_unlimited_ai_still_records_usage(self):
        ai_quota_settings.save(dict(self.limits(), medium_month=0, medium_window=0))
        spent = []
        fake_store = SimpleNamespace(usage_in=lambda *_: (0, None), spend=lambda *args: spent.append(args))
        handler = SimpleNamespace(current_user=lambda: {'id': 1, 'plan': 'medium'})
        with patch.object(server, 'hosted', return_value=True), patch.object(server, 'get_accounts', return_value=fake_store):
            server.Handler.quota(handler, 'ai')
        self.assertEqual(spent[0][:3], (1, 'ai', 1))


if __name__ == '__main__':
    unittest.main()
