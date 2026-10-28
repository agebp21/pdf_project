"""AI Summarizer belongs to Medium and Pro; Basic cannot use it during trial."""
from pathlib import Path
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import accounts


class AiIsPro(unittest.TestCase):
    def row(self, plan='basic', days_old=0, expires=None):
        return {'id': 'u1', 'email': 'a@example.com', 'name': 'A', 'plan': plan, 'plan_expires_at': expires,
                'created_at': int(time.time()) - days_old * 86400, 'verified': 1, 'google_sub': None}

    def test_trial_then_pro(self):
        store = accounts.Accounts.__new__(accounts.Accounts)       # public_user needs no database
        self.assertNotIn('ai', store.public_user(self.row(days_old=1))['entitlements'])
        late = store.public_user(self.row(days_old=accounts.TRIAL_DAYS + 1))
        self.assertTrue(late['trialExpired']); self.assertNotIn('ai', late['entitlements'])
        medium = store.public_user(self.row('medium', days_old=60, expires=time.time() + 86400))
        self.assertIn('ai', medium['entitlements'])
        # the podcast was taken out (2026-10-20): no plan and no trial has it
        self.assertNotIn('podcast', store.public_user(self.row(days_old=1))['entitlements'])
        self.assertFalse(any('podcast' in p['entitlements'] for p in accounts.PLANS.values()))
        self.assertNotIn('ai', accounts.PLANS['basic']['entitlements'])
        self.assertTrue({'apk', 'exe'} <= set(accounts.PLANS['pro']['entitlements']))
        self.assertFalse({'apk', 'exe'} & set(accounts.PLANS['medium']['entitlements']))

    def test_price_list(self):
        basic = ' '.join(accounts.PLANS['basic']['features']['id'])
        medium = ' '.join(accounts.PLANS['medium']['features']['id'])
        self.assertNotIn('AI Summarizer', basic); self.assertIn('AI Summarizer', medium)
        self.assertFalse(any('podcast' in ' '.join(p['features']['id'] + p['features']['en']).lower() for p in accounts.PLANS.values()))

    def test_library_storage_on_the_price_list_matches_the_limits(self):
        import library, share
        for plan, (books, size) in library.LIMITS.items():
            text = ' '.join(accounts.PLANS[plan]['features']['id'])
            # The price list (plans v2) names the books, not the storage or the share-link count.
            if books == 0:                                   # Basic keeps nothing: no promise of a library
                self.assertNotIn('My Library', text, plan)
            else:
                self.assertIn(f'My Library: {books} buku', text, plan)
            self.assertIn(plan, share.SHARE_LIMITS)


if __name__ == '__main__':
    unittest.main()
