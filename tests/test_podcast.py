"""Podcast script: manifest validation, the AI reply parsed into host lines
(retrying an empty reply), the /api/podcast/script route (token, too little
text, no key) — with a fake AI, so no network or cost."""
import io
import json
import os
from pathlib import Path
import sys
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def reply(content):
    body = json.dumps({'choices': [{'message': {'content': content}}]}).encode()
    response = mock.MagicMock()
    response.read.return_value = body
    response.__enter__.return_value = response
    return response


class PodcastTests(unittest.TestCase):
    def test_manifest_validation(self):
        base = dict(version=1, title='Buku', pageCount=2, ratio=0.7, overlays={})
        self.assertNotIn('podcast', server.validate_manifest(base), 'books without a podcast stay as before')
        ok = server.validate_manifest(dict(base, podcast=dict(lines=[dict(s='A', t=' Halo '), dict(s='B', t='Hai')], hosts=['Rina', 'Bima'], lang='ms-MY')))
        self.assertEqual(ok['podcast'], dict(lines=[dict(s='A', t='Halo'), dict(s='B', t='Hai')], hosts=['Rina', 'Bima'], lang='ms-MY'))
        odd = server.validate_manifest(dict(base, podcast=dict(lines=[dict(s='A', t='x')], hosts='nope', lang='fr')))['podcast']
        self.assertEqual((odd['hosts'], odd['lang']), (['Rina', 'Bima'], 'id-ID'))
        for bad in ('x', dict(lines='x'), dict(lines=[dict(s='C', t='x')]), dict(lines=[dict(s='A', t='  ')]), dict(lines=[dict(s='A', t='x')] * 401)):
            with self.assertRaises(ValueError):
                server.validate_manifest(dict(base, podcast=bad))

    def test_script_parsed_and_empty_reply_retried(self):
        script = 'RINA: Halo semua!\nBIMA: Halo Rina.\nlanjutan.\n**RINA:** Mari mulai.\nBIMA: Siap.\nCatatan panggung'
        env = {'SUMOPOD_API_KEY': 'sk-test', 'SUMOPOD_BASE_URL': 'https://ai.example/v1', 'PODCAST_MODEL': 'claude-sonnet-5'}
        with mock.patch.dict(os.environ, env), mock.patch('urllib.request.urlopen', side_effect=[reply(''), reply(script)]) as call:
            result = server.podcast_script('Buku', 'teks', 'id-ID')
        self.assertEqual(call.call_count, 2, 'an empty reply is tried again')
        request = call.call_args[0][0]
        self.assertEqual(request.full_url, 'https://ai.example/v1/chat/completions')
        self.assertEqual(request.headers['Authorization'], 'Bearer sk-test')
        sent = json.loads(request.data)
        self.assertEqual(sent['model'], 'claude-sonnet-5')
        self.assertIn('RINA (perempuan)', sent['messages'][0]['content'])
        self.assertIn('selamat datang di podcast Buku', sent['messages'][0]['content'], 'the podcast is named after the book')
        self.assertNotIn('MyFlipbook"', sent['messages'][0]['content'].split('Jangan')[0])
        self.assertIn('Judul: Buku', sent['messages'][1]['content'])
        self.assertEqual(result['lines'], [dict(s='A', t='Halo semua!'), dict(s='B', t='Halo Rina. lanjutan.'),
                                           dict(s='A', t='Mari mulai.'), dict(s='B', t='Siap. Catatan panggung')])
        self.assertEqual((result['hosts'], result['lang']), (['Rina', 'Bima'], 'id-ID'))
        with mock.patch.dict(os.environ, {'SUMOPOD_API_KEY': ''}):
            with self.assertRaisesRegex(RuntimeError, 'SUMOPOD_API_KEY'):
                server.podcast_script('Buku', 'teks')
        with mock.patch.dict(os.environ, env), mock.patch('urllib.request.urlopen', side_effect=[reply('maaf'), reply('')]):
            with self.assertRaisesRegex(RuntimeError, 'tidak menghasilkan'):
                server.podcast_script('Buku', 'teks')

    def test_route(self):
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        base = f'http://127.0.0.1:{httpd.server_port}/api/podcast/script'
        def post(body, token=server.TOKEN):
            request = urllib.request.Request(base, data=json.dumps(body).encode(), method='POST',
                                             headers={'Content-Type': 'application/json', 'X-Build-Token': token})
            try:
                with urllib.request.urlopen(request) as response:
                    return response.status, json.loads(response.read())
            except urllib.error.HTTPError as error:
                with error:
                    return error.code, json.loads(error.read())
        try:
            words = ' '.join(['kata'] * 60)
            fake = dict(lines=[dict(s='A', t='Halo')] * 4, hosts=['Rina', 'Bima'], lang='ms-MY', model='m')
            with mock.patch.object(server, 'podcast_script', return_value=fake) as make:
                self.assertEqual(post({'text': {'0': [words]}}, token='wrong')[0], 403, 'needs the page session token')
                status, body = post({'title': 'Buku', 'text': {'1': ['kedua'], '0': [words]}, 'lang': 'ms-MY'})
                self.assertEqual((status, body['lines'][0]), (200, dict(s='A', t='Halo')))
                title, text, lang, hosts = make.call_args[0]
                self.assertEqual((title, lang, hosts), ('Buku', 'ms-MY', ['Rina', 'Bima']))
                self.assertLess(text.index('[Halaman 1]'), text.index('[Halaman 2]'), 'pages in order')
                self.assertEqual(post({'text': {'0': ['sedikit teks']}})[0], 400, 'too little text (a scan)')
                self.assertEqual(post({'text': 'x'})[0], 400)
            with mock.patch.object(server, 'podcast_script', side_effect=RuntimeError('Podcast AI belum diatur')):
                status, body = post({'text': {'0': [words]}})
                self.assertEqual(status, 502); self.assertIn('belum diatur', body['error'])
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join()


class TranslateTests(unittest.TestCase):
    def test_manifest(self):
        base = dict(version=1, title='Buku', pageCount=3, ratio=0.7, overlays={})
        self.assertNotIn('translations', server.validate_manifest(base))
        ok = server.validate_manifest(dict(base, translations={'id-ID': {'0': 'Halo', '2': '  '}}))
        self.assertEqual(ok['translations'], {'id-ID': {'0': 'Halo'}})
        for bad in ('x', {'fr': {'0': 'a'}}, {'id-ID': {'5': 'a'}}, {'id-ID': {'0': 3}}, {'id-ID': 'x'}):
            with self.assertRaises(ValueError):
                server.validate_manifest(dict(base, translations=bad))

    def test_translate_pages_parses_json_and_retries(self):
        env = {'SUMOPOD_API_KEY': 'sk-test', 'SUMOPOD_BASE_URL': 'https://ai.example/v1', 'PODCAST_MODEL': 'claude-sonnet-5'}
        answer = 'Here you go:\n```json\n{"0": "Halo dunia.", "1": "Paragraf.\\nKedua.", "7": "bukan diminta"}\n```'
        with mock.patch.dict(os.environ, env), mock.patch('urllib.request.urlopen', side_effect=[reply('maaf, tidak bisa'), reply(answer)]) as call:
            out = server.translate_pages({0: 'Hello world.', 1: 'Paragraph.\nSecond.'}, 'id-ID', 'Book')
        self.assertEqual(out, {'0': 'Halo dunia.', '1': 'Paragraf.\nKedua.'}, 'only the pages asked for')
        self.assertEqual(call.call_count, 2)
        sent = json.loads(call.call_args[0][0].data)
        self.assertIn('Bahasa Indonesia', sent['messages'][0]['content'])
        self.assertIn('"0": "Hello world."', sent['messages'][1]['content'])
        with mock.patch.dict(os.environ, dict(env, TRANSLATE_MODEL='gemini/x')), mock.patch('urllib.request.urlopen', side_effect=[reply('{"0": "Hola"}')]) as call:
            server.translate_pages({0: 'Hi'}, 'en-US')
        self.assertEqual(json.loads(call.call_args[0][0].data)['model'], 'gemini/x', 'TRANSLATE_MODEL wins')

    def test_route(self):
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        url = f'http://127.0.0.1:{httpd.server_port}/api/translate'
        def post(body, token=server.TOKEN):
            request = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST',
                                             headers={'Content-Type': 'application/json', 'X-Build-Token': token})
            try:
                with urllib.request.urlopen(request) as response:
                    return response.status, json.loads(response.read())
            except urllib.error.HTTPError as error:
                with error:
                    return error.code, json.loads(error.read())
        try:
            with mock.patch.object(server, 'translate_pages', return_value={'0': 'Halo'}) as make:
                self.assertEqual(post({'pages': {'0': 'Hi'}, 'target': 'id-ID'}, token='x')[0], 403)
                self.assertEqual(post({'pages': {'0': 'Hi', '1': '  '}, 'target': 'id-ID', 'title': 'B'}), (200, {'pages': {'0': 'Halo'}, 'target': 'id-ID'}))
                self.assertEqual(make.call_args[0], ({'0': 'Hi'}, 'id-ID', 'B'), 'empty pages not sent')
                self.assertEqual(post({'pages': {'0': 'Hi'}, 'target': 'fr'})[0], 400)
                self.assertEqual(post({'pages': {str(i): 'x' for i in range(41)}, 'target': 'id-ID'})[0], 400, 'max 40 pages')
                self.assertEqual(post({'pages': {'0': 'x' * 30001}, 'target': 'id-ID'})[0], 400, 'max characters')
                self.assertEqual(post({'pages': {'0': '   '}, 'target': 'id-ID'})[0], 400)
            with mock.patch.object(server, 'translate_pages', side_effect=RuntimeError('AI belum diatur')):
                self.assertEqual(post({'pages': {'0': 'Hi'}, 'target': 'en-US'})[0], 502)
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join()

if __name__ == '__main__':
    unittest.main()
