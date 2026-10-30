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
        self.assertIn('PERMINTAAN TERAKHIR (jawab ini): Apa isinya?', user); self.assertIn('Pembaca: Halo', user); self.assertIn('Asisten: Hai', user)

    def test_follow_up_format_request_gets_priority_over_old_answer(self):
        history = [{'role': 'user', 'text': 'Apa saja jenis kerisnya?'},
                   {'role': 'ai', 'text': '- Keris lurus (hlm. 2).\n- Keris berluk (hlm. 3).'}]
        with mock.patch.object(server, 'ai_chat', return_value='Tinjauan pustaka\nKeris lurus dan berluk dibahas dalam sumber (hlm. 2).') as ai:
            server.ask_document('Dhapur Keris', '[Halaman 2]\nKeris lurus.\n[Halaman 3]\nKeris berluk.',
                                'dalam bentuk jurnal ya', history)
        system, user = ai.call_args.args[:2]
        self.assertIn('jangan sekadar menyalin daftar poin yang lama', system)
        self.assertIn('Jangan mengarang daftar pustaka', system)
        self.assertIn('Asisten: - Keris lurus', user)
        self.assertTrue(user.endswith('PERMINTAAN TERAKHIR (jawab ini): dalam bentuk jurnal ya'))

    def test_citations_only_use_cited_pages_and_number_them(self):
        index = {(1, 1): ['Kata pembuka umum.', 'Gamelan memakai laras pelog dan slendro.'], (1, 2): ['Isi halaman kedua.']}
        answer, citations = server.ask_citations(index, {1: 'Buku'}, 'Gamelan memakai pelog (hlm. 1), lihat juga (hlm. 9).', 'Apa laras gamelan?')
        self.assertEqual(answer, 'Gamelan memakai pelog [1], lihat juga (hlm. 9).', 'an uncited page keeps its plain text')
        self.assertEqual(citations, [{'n': 1, 'source': 'Buku', 'page': 1, 'excerpt': 'Gamelan memakai laras pelog dan slendro.'}])

    def test_citations_multi_source_pairs_and_numbers_in_order(self):
        index = {(1, 3): ['Fakta dari sumber satu.'], (2, 5): ['Fakta dari sumber dua.']}
        names = {1: 'Jurnal A', 2: 'Jurnal B'}
        answer, citations = server.ask_citations(index, names, 'Pertama (Sumber 2, hlm. 5), kedua (Sumber 1, hlm. 3).', 'apa')
        self.assertEqual(answer, 'Pertama [1], kedua [2].')
        self.assertEqual(citations, [{'n': 1, 'source': 'Jurnal B', 'page': 5, 'excerpt': 'Fakta dari sumber dua.'},
                                      {'n': 2, 'source': 'Jurnal A', 'page': 3, 'excerpt': 'Fakta dari sumber satu.'}])

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
            with mock.patch.object(server, 'ask_document', return_value=('Jawab (hlm. 1)', '')) as make:
                self.assertEqual(post({'title': 'B', 'text': {'0': [words]}, 'question': 'Apa?'}),
                                 (200, {'answer': 'Jawab [1]', 'citations': [{'n': 1, 'source': 'B', 'page': 1, 'excerpt': words}], 'thoughts': ''}))
                self.assertIn('[Halaman 1]', make.call_args[0][1])
                self.assertTrue(make.call_args.kwargs.get('include_thoughts'), 'ask_route always asks for thoughts')
                self.assertEqual(post({'text': {'0': ['sedikit']}, 'question': 'Apa?'})[0], 400)
            self.assertEqual(post({'text': {'0': [words]}, 'question': ' '})[0], 400)
            with mock.patch.object(server, 'ask_document', side_effect=RuntimeError('AI belum diatur')):
                self.assertEqual(post({'text': {'0': [words]}, 'question': 'Apa?'})[0], 502)
            with mock.patch.object(server, 'openalex_search', return_value={'results': [{'title': 'Immersive exhibition research', 'year': 2024, 'link': 'https://example.org/article', 'abstract': 'Study of immersive learning. ' * 12}]}) as search:
                first = post({'text': {'0': [words]}, 'question': 'tambah artikel tentang immersive yang blm ada di sini'})
                self.assertEqual(first[0], 200)
                self.assertEqual(first[1]['webSources'][0]['url'], 'https://example.org/article')
                self.assertTrue(first[1]['autoAdd'])
                self.assertIn('immersive learning', first[1]['webSources'][0]['abstract'])
                self.assertEqual(search.call_args.args[0], 'immersive')
                followup = post({'text': {'0': [words]}, 'question': 'makanya kamu yang nambahin',
                                 'history': [{'role': 'user', 'text': 'tambah artikel tentang immersive yang blm ada di sini'},
                                             {'role': 'ai', 'text': 'Sumber perlu ditambahkan'}]})
                self.assertEqual(followup[0], 200)
                self.assertEqual(search.call_count, 2)
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
