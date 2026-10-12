"""AI Summarizer is a Pro feature: Free members have it only during the 7-day trial;
Pro and Business keep it; the price list shows it under Pro, not Free."""
from pathlib import Path
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import accounts


class AiIsPro(unittest.TestCase):
    def row(self, plan='free', days_old=0, expires=None):
        return {'id': 'u1', 'email': 'a@example.com', 'name': 'A', 'plan': plan, 'plan_expires_at': expires,
                'created_at': int(time.time()) - days_old * 86400, 'verified': 1, 'google_sub': None}

    def test_trial_then_pro(self):
        store = accounts.Accounts.__new__(accounts.Accounts)       # public_user needs no database
        self.assertIn('ai', store.public_user(self.row(days_old=1))['entitlements'], 'the trial includes AI')
        late = store.public_user(self.row(days_old=accounts.TRIAL_DAYS + 1))
        self.assertTrue(late['trialExpired']); self.assertNotIn('ai', late['entitlements'])
        pro = store.public_user(self.row('pro', days_old=60, expires=time.time() + 86400))
        self.assertIn('ai', pro['entitlements'])
        self.assertNotIn('ai', accounts.PLANS['free']['entitlements'])

    def test_price_list(self):
        free = ' '.join(accounts.PLANS['free']['features']['id'])
        pro = ' '.join(accounts.PLANS['pro']['features']['id'])
        self.assertNotIn('AI Summarizer', free); self.assertIn('AI Summarizer', pro)


if __name__ == '__main__':
    unittest.main()
