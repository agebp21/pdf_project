"""Google Drive picker settings in /api/capabilities: only when both the OAuth
client id and the browser API key are set; the app id (Cloud project number)
comes from the client id unless GOOGLE_APP_ID is set."""
import json
import os
from pathlib import Path
import sys
import threading
import unittest
import urllib.request
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class DriveConfigTests(unittest.TestCase):
    def test_config(self):
        cases = [
            ({'GOOGLE_CLIENT_ID': '', 'GOOGLE_API_KEY': 'k'}, None),
            ({'GOOGLE_CLIENT_ID': '123-abc.apps.googleusercontent.com', 'GOOGLE_API_KEY': ''}, None),
            ({'GOOGLE_CLIENT_ID': '123-abc.apps.googleusercontent.com', 'GOOGLE_API_KEY': ' k ', 'GOOGLE_APP_ID': ''},
             {'clientId': '123-abc.apps.googleusercontent.com', 'apiKey': 'k', 'appId': '123'}),
            ({'GOOGLE_CLIENT_ID': '123-abc.apps.googleusercontent.com', 'GOOGLE_API_KEY': 'k', 'GOOGLE_APP_ID': '999'},
             {'clientId': '123-abc.apps.googleusercontent.com', 'apiKey': 'k', 'appId': '999'}),
            ({'GOOGLE_CLIENT_ID': 'weird.apps.googleusercontent.com', 'GOOGLE_API_KEY': 'k', 'GOOGLE_APP_ID': ''},
             {'clientId': 'weird.apps.googleusercontent.com', 'apiKey': 'k', 'appId': ''}),
        ]
        for env, expected in cases:
            with mock.patch.dict(os.environ, env):
                self.assertEqual(server.drive_picker_config(), expected, env)

    def test_capabilities_route(self):
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with mock.patch.dict(os.environ, {'GOOGLE_CLIENT_ID': '42-x.apps.googleusercontent.com', 'GOOGLE_API_KEY': 'k', 'GOOGLE_APP_ID': ''}):
                with opener.open(f'http://127.0.0.1:{httpd.server_port}/api/capabilities') as r:
                    self.assertEqual(json.loads(r.read())['drive'], {'clientId': '42-x.apps.googleusercontent.com', 'apiKey': 'k', 'appId': '42'})
            with mock.patch.dict(os.environ, {'GOOGLE_API_KEY': ''}):
                with opener.open(f'http://127.0.0.1:{httpd.server_port}/api/capabilities') as r:
                    self.assertIsNone(json.loads(r.read())['drive'])
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
