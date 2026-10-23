"""Installable web app: every page links the manifest, and the manifest is complete."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import seo  # noqa: E402


class PwaTests(unittest.TestCase):
    def test_every_page_links_the_manifest(self):
        for page in ('index.html', 'flipbook.html', 'login.html', 'account.html', 'notebook.html'):
            head = seo.app_head(page).decode()
            self.assertIn('rel="manifest" href="/assets/manifest.json"', head, page)
            self.assertIn('apple-mobile-web-app-capable', head, page)
        self.assertIn('rel="manifest"', seo.head('Harga', 'Paket', '/harga'))

    def test_manifest_opens_without_browser_bars(self):
        manifest = json.loads((ROOT / 'assets/manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['display'], 'standalone')
        self.assertEqual(manifest['start_url'].split('?')[0], '/')
        sizes = {icon['sizes'] for icon in manifest['icons']}
        self.assertTrue({'192x192', '512x512'} <= sizes)
        self.assertTrue(any(icon.get('purpose') == 'maskable' for icon in manifest['icons']))
        for icon in manifest['icons']:
            self.assertTrue((ROOT / icon['src'].lstrip('/')).is_file(), icon['src'])


if __name__ == '__main__':
    unittest.main()
