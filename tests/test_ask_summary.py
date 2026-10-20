"""AI Summarizer: summary length / focus / page references, and Ask the document
(answers from the document's own pages, the best-fitting pages of a long one)."""
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

ENV = {'SUMOPOD_API_KEY': 'sk-test', 'SUMOPOD_BASE_URL': 'https://ai.example/v1', 'PODCAST_MODEL': 'claude-sonnet-5'}
GOOD = 'Intisari\nBuku ini membahas ' + 'filsafat Jawa dan laku hidup ' * 6 + '.\nPoin penting\n- Satu (hlm. 1)\n- Dua (hlm. 2)'


def reply(content):
    body = json.dumps({'choices': [{'message': {'content': content}}]}).encode()
    response = mock.MagicMock()
    response.read.return_value = body
    response.__enter__.return_value = response
    return response


def sent(call):
    messages = json.loads(call.call_args[0][0].data)['messages']
    return messages[0]['content'], messages[1]['content']


class SummaryOptionTests(unittest.TestCase):
    TEXT = '[Halaman 1]\nPembuka buku.\n\n[Halaman 2]\nIsi buku.'

    def test_default_length_and_page_references(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply(GOOD)) as call:
            server.summarize_book('Buku', self.TEXT, 'id-ID')
        system, _ = sent(call)
        self.assertIn('2-4 kalimat', system); self.assertIn('5-8 butir', system)
        self.assertIn('(hlm. 12)', system, 'pages asked for when the text has page marks')
        self.assertNotIn('Istilah penting', system); self.assertNotIn('Utamakan', system)

    def test_detail_with_focus(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply(GOOD)) as call:
            server.summarize_book('Buku', self.TEXT, 'en-US', 'detail', '  research   method ')
        system, _ = sent(call)
        self.assertIn('10-15 butir', system); self.assertIn('"Key terms"', system)
        self.assertIn('Utamakan hal yang berkaitan dengan: research method.', system)
        self.assertIn('(p. 12)', system, 'English summaries cite "p."')

    def test_short_and_no_pages_without_marks(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply(GOOD)) as call:
            server.summarize_book('Buku', 'teks tanpa penanda halaman', 'id-ID', 'singkat')
        system, _ = sent(call)
        self.assertIn('3-5 butir', system); self.assertNotIn('halaman sumbernya', system, 'no guessing pages')

    def test_long_book_parts_carry_their_pages(self):
        page = 'kata ' * 2000
        text = '\n\n'.join(f'[Halaman {i}]\n{page}' for i in range(1, 30))
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', side_effect=lambda *a, **k: reply(GOOD)) as call:
            server.summarize_book('Tebal', text, 'id-ID')
        _, final = sent(call)
        self.assertRegex(final, r'\[Bagian 1/\d+\] \(hlm\. 1–\d+\)')


class ChapterTests(unittest.TestCase):
    PAGES = ''.join(f'[Halaman {i}]\n' + 'kata ' * 400 + '\n\n' for i in range(1, 101))

    def test_parts_follow_the_chapters(self):
        parts = server.book_parts(self.PAGES, [('Pendahuluan', 0), ('Bab 1 Estetika', 4), ('Bab 2 Seni', 30), ('Bab 3 Keindahan', 60), ('Catatan', 99)])
        self.assertEqual([(p['title'], p['first'], p['last']) for p in parts],
                         [('Pendahuluan', '1', '4'), ('Bab 1 Estetika', '5', '30'), ('Bab 2 Seni', '31', '60'), ('Bab 3 Keindahan', '61', '100')],
                         'a one-page last chapter joins the one before')
        self.assertEqual(len(server.book_parts(self.PAGES)), 4, 'no chapters: even slices')
        many = [(f'Bab {i}', i) for i in range(100)]
        self.assertLessEqual(len(server.book_parts(self.PAGES, many)), server.BOOK_PARTS)

    def test_summary_lists_every_chapter(self):
        replies = iter(['Isi bab satu yang panjang (hlm. 5).', 'Isi bab dua (hlm. 40).', GOOD])
        chapters = [('Bab 1 Estetika', 0), ('Bab 2 Seni', 50)]
        with mock.patch.dict(os.environ, ENV), mock.patch.object(server, 'ai_chat', side_effect=lambda *a, **k: next(replies)) as chat:
            out = server.summarize_book('Buku', self.PAGES, 'id-ID', 'detail', '', chapters)
        self.assertEqual(chat.call_count, 3, 'two chapters, then the overview')
        self.assertIn('Bab: Bab 2 Seni', chat.call_args_list[1][0][1])
        self.assertIn('250-400 kata', chat.call_args_list[0][0][0], 'detail: longer chapter summaries')
        self.assertTrue(out['text'].startswith('Intisari')); self.assertEqual(out['parts'], 2)
        self.assertIn('### Ringkasan per bab', out['text'])
        self.assertIn('### Bab 1 Estetika (hlm. 1–50)\nIsi bab satu yang panjang (hlm. 5).', out['text'])
        self.assertIn('### Bab 2 Seni (hlm. 51–100)\nIsi bab dua (hlm. 40).', out['text'])

    def test_route_takes_the_chapters(self):
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        body = {'title': 'B', 'text': {'0': [' '.join(['kata'] * 60)]},
                'chapters': [{'title': ' Bab  1 ', 'page': 0}, {'title': 'x', 'page': -1}, {'title': '', 'page': 3}, 'bad', {'title': 'Bab 2', 'page': 9}]}
        request = urllib.request.Request(f'http://127.0.0.1:{httpd.server_port}/api/summary', data=json.dumps(body).encode(), method='POST',
                                         headers={'Content-Type': 'application/json', 'X-Build-Token': server.TOKEN})
        try:
            with mock.patch.object(server, 'summarize_book', return_value=dict(lang='id-ID', text='Intisari', model='m')) as make:
                with urllib.request.urlopen(request) as r:
                    self.assertEqual(r.status, 200)
            self.assertEqual(make.call_args[0][5], [('Bab 1', 0), ('Bab 2', 9)], 'bad entries dropped, titles tidied')
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join()


class AskTests(unittest.TestCase):
    def test_short_document_goes_whole(self):
        self.assertEqual(server.ask_pages('[Halaman 1]\nabc', 'apa'), '[Halaman 1]\nabc')

    def test_long_document_picks_fitting_pages(self):
        filler = 'biasa ' * 3000
        pages = [f'[Halaman {i}]\n{filler}' for i in range(1, 41)]
        pages[29] = '[Halaman 30]\n' + 'gamelan pelog slendro ' * 50 + filler
        out = server.ask_pages('\n\n'.join(pages), 'Apa itu gamelan pelog?')
        self.assertLessEqual(len(out), server.ASK_MAX_CHARS)
        self.assertIn('[Halaman 30]', out); self.assertIn('[Halaman 29]', out, 'neighbours kept')
        marks = [int(m) for m in __import__('re').findall(r'\[Halaman (\d+)\]', out)]
        self.assertEqual(marks, sorted(marks), 'pages stay in order')

    def test_answer_prompt(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('Jawabannya **ini** (hlm. 2).')) as call:
            out = server.ask_document('Buku', '[Halaman 2]\nIsi.', ' Apa  isinya? ', [{'role': 'user', 'text': 'Halo'}, {'role': 'ai', 'text': 'Hai'}])
        self.assertEqual(out, 'Jawabannya ini (hlm. 2).')
        system, user = sent(call)
        self.assertIn('HANYA dari isi dokumen', system)
        self.assertIn('Pertanyaan: Apa isinya?', user); self.assertIn('Pembaca: Halo', user); self.assertIn('Asisten: Hai', user)

    def test_empty_question(self):
        with self.assertRaises(ValueError):
            server.ask_document('Buku', 'teks', '  ')

    def test_route(self):
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        url = f'http://127.0.0.1:{httpd.server_port}/api/ask'

        def post(body):
            request = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST',
                                             headers={'Content-Type': 'application/json', 'X-Build-Token': server.TOKEN})
            try:
                with urllib.request.urlopen(request) as response:
                    return response.status, json.loads(response.read())
            except urllib.error.HTTPError as error:
                with error:
                    return error.code, json.loads(error.read())
        try:
            words = ' '.join(['kata'] * 60)
            with mock.patch.object(server, 'ask_document', return_value='Jawab (hlm. 1)') as make:
                self.assertEqual(post({'title': 'B', 'text': {'0': [words]}, 'question': 'Apa?'}), (200, {'answer': 'Jawab (hlm. 1)'}))
                self.assertIn('[Halaman 1]', make.call_args[0][1])
                self.assertEqual(post({'text': {'0': ['sedikit']}, 'question': 'Apa?'})[0], 400)
            self.assertEqual(post({'text': {'0': [words]}, 'question': ' '})[0], 400)
            with mock.patch.object(server, 'ask_document', side_effect=RuntimeError('AI belum diatur')):
                self.assertEqual(post({'text': {'0': [words]}, 'question': 'Apa?'})[0], 502)
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
