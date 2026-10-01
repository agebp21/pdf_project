"""POST /api/highlight-summary: one highlighted passage -> a short summary
(AI mocked): prompt in the passage's language, list lines kept, "Ringkasan:"
prefix and markdown stripped, limits, errors, and the build-token gate."""
import json
from pathlib import Path
import sys
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class SummarizeHighlightTests(unittest.TestCase):
    def test_summary(self):
        with mock.patch.object(server, 'ai_chat', return_value='Ringkasan: **Langkah kecil** punya makna besar.') as chat:
            self.assertEqual(server.summarize_highlight('  Satu   langkah \n\n • seribu  makna '), 'Langkah kecil punya makna besar.')
        system, user = chat.call_args[0][:2]
        self.assertIn('BAHASA YANG SAMA', system)
        self.assertEqual(user, 'Satu langkah\n• seribu makna', 'spaces tidied, list lines kept')
        self.assertEqual(chat.call_args.kwargs['max_tokens'], 2000, 'room for thinking models')
        with mock.patch.object(server, 'ai_chat', return_value='x' * 2000) as chat:
            self.assertEqual(len(server.summarize_highlight('y' * 9000)), 800)
        self.assertEqual(len(chat.call_args[0][1]), server.HIGHLIGHT_MAX_CHARS)
        with self.assertRaises(ValueError):
            server.summarize_highlight(' \n ')
        with mock.patch.object(server, 'ai_chat', return_value='  '), self.assertRaises(RuntimeError):
            server.summarize_highlight('teks')


class HighlightSummaryRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True); cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.httpd.server_port}/api/highlight-summary'
        cls.open = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.httpd.server_close(); cls.thread.join()

    def post(self, body, token=None):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        request = urllib.request.Request(self.url, data=data, method='POST',
                                         headers={'Content-Type': 'application/json', 'X-Build-Token': server.TOKEN if token is None else token})
        try:
            with self.open.open(request) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            with e:
                return e.code, json.loads(e.read())

    def test_route(self):
        with mock.patch.object(server, 'ai_chat', return_value='Inti teksnya.'):
            self.assertEqual(self.post({'text': 'Satu langkah seribu makna'}), (200, {'summary': 'Inti teksnya.'}))
            self.assertEqual(self.post({'text': 'x'}, token='wrong')[0], 403, 'needs the page build token')
        self.assertEqual(self.post({'text': 5})[0], 400)
        self.assertEqual(self.post(b'{not json')[0], 400)
        self.assertEqual(self.post({'text': 'x' * 70000})[0], 400, 'too long')
        with mock.patch.object(server, 'ai_chat', side_effect=RuntimeError('Layanan AI tidak bisa dihubungi.')):
            self.assertEqual(self.post({'text': 'teks'}), (502, {'error': 'Layanan AI tidak bisa dihubungi.'}))


if __name__ == '__main__':
    unittest.main()
