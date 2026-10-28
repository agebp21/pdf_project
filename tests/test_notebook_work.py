"""AI Summarizer workspace: a journal draft section by section, slides, and Ask reading the
member's own work (notes, summary, journal) along with the highlighted pages."""
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
SOURCE = '[Halaman 3]\nGamelan adalah ansambel musik tradisional Jawa.'


def reply(content):
    body = json.dumps({'choices': [{'message': {'content': content}}]}).encode()
    response = mock.MagicMock()
    response.read.return_value = body
    response.__enter__.return_value = response
    return response


def sent(call):
    messages = json.loads(call.call_args[0][0].data)['messages']
    return messages[0]['content'], messages[1]['content']


class JournalTests(unittest.TestCase):
    def test_section_prompt_and_reply(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('Gamelan **dikaji** di sini (hlm. 3).')) as call:
            out = server.write_journal('Gamelan', SOURCE, 'pendahuluan', 'id-ID', 'Catatan saya:\n  gamelan   dan ritual')
        self.assertEqual(out, 'Gamelan dikaji di sini (hlm. 3).')
        system, user = sent(call)
        self.assertIn('"Pendahuluan"', system); self.assertIn('jangan mengarang', system); self.assertIn('(hlm. 12)', system)
        self.assertIn('[Halaman 3]', user); self.assertIn('gamelan dan ritual', user, 'notes tidied and sent')

    def test_title_is_one_line_without_page_tags(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('"Gamelan Jawa\ndalam Ritual"')) as call:
            out = server.write_journal('Gamelan', SOURCE, 'judul')
        self.assertEqual(out, 'Gamelan Jawa dalam Ritual')
        self.assertNotIn('Sebut halaman', sent(call)[0])

    def test_english_page_word(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('Text (p. 3).')) as call:
            server.write_journal('Gamelan', SOURCE, 'hasil', 'en-US')
        self.assertIn('(p. 12)', sent(call)[0]); self.assertIn('English', sent(call)[0])

    def test_unknown_section(self):
        with self.assertRaises(ValueError):
            server.write_journal('G', SOURCE, 'lampiran')


class SlideTests(unittest.TestCase):
    def test_parse_wrapped_json(self):
        raw = 'Berikut slide:\n```json\n{"slides":[{"title":" Apa  itu gamelan ","points":["Ansambel Jawa", "", 5],"notes":"Lihat (hlm. 3)."},' \
              '"bad",{"title":"","points":[]},{"title":"Penutup","points":["Simpulan"]}]}\n```'
        self.assertEqual(server.parse_slides(raw), [
            {'title': 'Apa itu gamelan', 'points': ['Ansambel Jawa', '5'], 'notes': 'Lihat (hlm. 3).'},
            {'title': 'Penutup', 'points': ['Simpulan'], 'notes': ''}])
        self.assertEqual(server.parse_slides('not json {'), [])

    def test_make_slides_count_and_retry(self):
        good = json.dumps({'slides': [{'title': f'S{i}', 'points': ['a', 'b', 'c']} for i in range(5)]})
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', side_effect=[reply('maaf'), reply(good)]) as call:
            out = server.make_slides('Gamelan', SOURCE, 'id-ID', 99, 'catatan')
        self.assertEqual(len(out), 5)
        system, user = sent(call)
        self.assertIn(f'tepat {server.SLIDES_MAX} slide', system, 'count capped')
        self.assertIn('CATATAN PEMBACA:\ncatatan', user)

    def test_make_slides_gives_up(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('{}')):
            with self.assertRaises(RuntimeError):
                server.make_slides('Gamelan', SOURCE)


class QuizTests(unittest.TestCase):
    def test_parse_drops_malformed_questions(self):
        raw = json.dumps({'questions': [
            {'q': ' Apa itu gamelan? ', 'choices': ['Ansambel', 'Tarian', 'Makanan', 'Kain'], 'answer': 0, 'explanation': 'Lihat (hlm. 3).'},
            {'q': 'Cuma 3 pilihan', 'choices': ['A', 'B', 'C'], 'answer': 0},                          # dropped: not 4 choices
            {'q': 'Jawaban di luar jangkauan', 'choices': ['A', 'B', 'C', 'D'], 'answer': 5},           # dropped: answer out of range
            'bad']})
        self.assertEqual(server.parse_quiz(raw), [{'q': 'Apa itu gamelan?', 'choices': ['Ansambel', 'Tarian', 'Makanan', 'Kain'],
                                                     'answer': 0, 'explanation': 'Lihat (hlm. 3).'}])
        self.assertEqual(server.parse_quiz('not json {'), [])

    def test_make_quiz_count_and_retry(self):
        good = json.dumps({'questions': [{'q': f'Q{i}', 'choices': ['a', 'b', 'c', 'd'], 'answer': 1} for i in range(5)]})
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', side_effect=[reply('maaf'), reply(good)]) as call:
            out = server.make_quiz('Gamelan', SOURCE, 'id-ID', 99, 'catatan')
        self.assertEqual(len(out), 5)
        system, user = sent(call)
        self.assertIn(f'tepat {server.QUIZ_MAX} soal', system, 'count capped')
        self.assertIn('CATATAN PEMBACA:\ncatatan', user)

    def test_make_quiz_gives_up(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('{}')):
            with self.assertRaises(RuntimeError):
                server.make_quiz('Gamelan', SOURCE)


class FlashcardTests(unittest.TestCase):
    def test_parse_drops_incomplete_cards(self):
        raw = json.dumps({'cards': [{'term': ' Gamelan ', 'definition': 'Ansambel musik Jawa.'}, {'term': 'Tanpa definisi', 'definition': ''}, 'bad']})
        self.assertEqual(server.parse_flashcards(raw), [{'term': 'Gamelan', 'definition': 'Ansambel musik Jawa.'}])

    def test_make_flashcards_count_and_retry(self):
        good = json.dumps({'cards': [{'term': f'T{i}', 'definition': f'D{i}'} for i in range(6)]})
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', side_effect=[reply('maaf'), reply(good)]) as call:
            out = server.make_flashcards('Gamelan', SOURCE, 'id-ID', 99)
        self.assertEqual(len(out), 6)
        self.assertIn(f'tepat {server.FLASHCARD_MAX} kartu', sent(call)[0])

    def test_make_flashcards_gives_up(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('{}')):
            with self.assertRaises(RuntimeError):
                server.make_flashcards('Gamelan', SOURCE)


class TableTests(unittest.TestCase):
    def test_parse_pads_and_truncates_rows(self):
        raw = json.dumps({'table': {'headers': ['Tahun', 'Jumlah'], 'rows': [['2023', '10', 'extra'], ['2024']]}})
        self.assertEqual(server.parse_table(raw), {'headers': ['Tahun', 'Jumlah'], 'rows': [['2023', '10'], ['2024', '']]})
        self.assertEqual(server.parse_table('not json {'), {'headers': [], 'rows': []})

    def test_make_table_retries_until_non_empty(self):
        good = json.dumps({'table': {'headers': ['A', 'B'], 'rows': [['1', '2']]}})
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', side_effect=[reply('{}'), reply(good)]) as call:
            out = server.make_table('Gamelan', SOURCE)
        self.assertEqual(out, {'headers': ['A', 'B'], 'rows': [['1', '2']]})
        self.assertIn('Jangan mengarang angka', sent(call)[0])

    def test_make_table_gives_up(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('{}')):
            with self.assertRaises(RuntimeError):
                server.make_table('Gamelan', SOURCE)


class MindMapTests(unittest.TestCase):
    def test_parse_caps_depth_and_children(self):
        raw = json.dumps({'label': ' Gamelan ', 'children': [
            {'label': 'Instrumen', 'children': [{'label': 'Gong', 'children': [{'label': 'terlalu dalam, dibuang'}]}]},
            *[{'label': f'C{i}'} for i in range(7)]]})            # 8 raw children, capped to MINDMAP_MAX_CHILDREN (6)
        tree = server.parse_mindmap(raw)
        self.assertEqual(tree['label'], 'Gamelan')
        self.assertEqual(len(tree['children']), server.MINDMAP_MAX_CHILDREN)
        self.assertEqual(tree['children'][0], {'label': 'Instrumen', 'children': [{'label': 'Gong', 'children': []}]}, 'depth capped at 3, its own children dropped')
        self.assertIsNone(server.parse_mindmap('not json {'))
        self.assertIsNone(server.parse_mindmap(json.dumps({'label': ''})), 'no label: no node')
        self.assertEqual(server.parse_mindmap(json.dumps({'label': 'Root', 'children': [{'label': ''}, {'label': 'Kept'}]})),
                         {'label': 'Root', 'children': [{'label': 'Kept', 'children': []}]}, 'an invalid child is dropped, not counted')

    def test_make_mindmap_retries_until_it_has_children(self):
        good = json.dumps({'label': 'Gamelan', 'children': [{'label': 'Instrumen', 'children': []}]})
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', side_effect=[reply(json.dumps({'label': 'Gamelan', 'children': []})), reply(good)]) as call:
            out = server.make_mindmap('Gamelan', SOURCE)
        self.assertEqual(out, {'label': 'Gamelan', 'children': [{'label': 'Instrumen', 'children': []}]})
        self.assertIn(f'sampai {server.MINDMAP_MAX_CHILDREN} cabang utama', sent(call)[0])

    def test_make_mindmap_gives_up(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('not json')):
            with self.assertRaises(RuntimeError):
                server.make_mindmap('Gamelan', SOURCE)


class InfographicTests(unittest.TestCase):
    def test_parse_caps_stats_and_points(self):
        raw = json.dumps({'headline': ' Gamelan tumbuh pesat ', 'stats': [{'value': '72%', 'label': 'Penonton muda'}, *[{'value': f'{i}', 'label': f'L{i}'} for i in range(6)]],
                          'points': ['Poin satu', 123, *[f'P{i}' for i in range(6)]]})
        out = server.parse_infographic(raw)
        self.assertEqual(out['headline'], 'Gamelan tumbuh pesat')
        self.assertEqual(len(out['stats']), server.INFOGRAPHIC_MAX_STATS)
        self.assertEqual(out['stats'][0], {'value': '72%', 'label': 'Penonton muda'})
        self.assertEqual(len(out['points']), server.INFOGRAPHIC_MAX_POINTS)
        self.assertEqual(out['points'][:2], ['Poin satu', '123'])
        self.assertEqual(server.parse_infographic('not json {'), {'headline': '', 'stats': [], 'points': []})

    def test_make_infographic_retries_until_it_has_content(self):
        good = json.dumps({'headline': 'Gamelan tumbuh pesat', 'stats': [], 'points': ['Poin satu']})
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', side_effect=[reply('{}'), reply(good)]) as call:
            out = server.make_infographic('Gamelan', SOURCE)
        self.assertEqual(out, {'headline': 'Gamelan tumbuh pesat', 'stats': [], 'points': ['Poin satu']})
        self.assertIn(f'sampai {server.INFOGRAPHIC_MAX_STATS} angka', sent(call)[0])

    def test_make_infographic_gives_up(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('{}')):
            with self.assertRaises(RuntimeError):
                server.make_infographic('Gamelan', SOURCE)


class AskWorkTests(unittest.TestCase):
    def test_work_goes_along(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('Ya (hlm. 3).')) as call:
            server.ask_document('G', SOURCE, 'Apakah ringkasan saya benar?', (), 'Ringkasan saya: gamelan dari Bali.')
        system, user = sent(call)
        self.assertIn('HASIL KERJA PEMBACA', system); self.assertIn('HASIL KERJA PEMBACA:\nRingkasan saya: gamelan dari Bali.', user)

    def test_without_work_nothing_changes(self):
        with mock.patch.dict(os.environ, ENV), mock.patch('urllib.request.urlopen', return_value=reply('Ya.')) as call:
            server.ask_document('G', SOURCE, 'Apa?')
        self.assertNotIn('HASIL KERJA', sent(call)[1])

    def test_work_is_capped(self):
        self.assertEqual(len(server.clean_work('x' * 50_000)), server.WORK_MAX_CHARS)
        self.assertEqual(server.clean_work(None), '')


class WriteRouteTests(unittest.TestCase):
    def setUp(self):
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True); self.thread.start()

    def tearDown(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.thread.join()

    def post(self, body):
        request = urllib.request.Request(f'http://127.0.0.1:{self.httpd.server_port}/api/write', data=json.dumps(body).encode(), method='POST',
                                         headers={'Content-Type': 'application/json', 'X-Build-Token': server.TOKEN})
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.loads(error.read())

    def test_journal_and_slides(self):
        words = {'0': [' '.join(['kata'] * 60)]}
        with mock.patch.object(server, 'write_journal', return_value='Isi (hlm. 1)') as journal:
            self.assertEqual(self.post({'kind': 'journal', 'section': 'abstrak', 'title': 'B', 'text': words, 'lang': 'en-US', 'work': 'n'}),
                             (200, {'text': 'Isi (hlm. 1)'}))
            self.assertEqual(journal.call_args[0][2:], ('abstrak', 'en-US', 'n'))
        with mock.patch.object(server, 'make_slides', return_value=[{'title': 'A', 'points': [], 'notes': ''}]) as slides:
            self.assertEqual(self.post({'kind': 'slides', 'count': 6, 'text': words})[0], 200)
            self.assertEqual(slides.call_args[0][3], 6)
        self.assertEqual(self.post({'kind': 'other', 'text': words})[0], 400)
        self.assertEqual(self.post({'kind': 'slides', 'text': {'0': ['sedikit']}})[0], 400)
        with mock.patch.object(server, 'make_slides', side_effect=RuntimeError('AI belum diatur')):
            self.assertEqual(self.post({'kind': 'slides', 'text': words})[0], 502)

    def test_quiz_flashcards_table(self):
        words = {'0': [' '.join(['kata'] * 60)]}
        with mock.patch.object(server, 'make_quiz', return_value=[{'q': 'Q', 'choices': ['a', 'b', 'c', 'd'], 'answer': 0, 'explanation': ''}]) as quiz:
            self.assertEqual(self.post({'kind': 'quiz', 'count': 5, 'text': words}), (200, {'questions': [{'q': 'Q', 'choices': ['a', 'b', 'c', 'd'], 'answer': 0, 'explanation': ''}]}))
            self.assertEqual(quiz.call_args[0][3], 5)
        with mock.patch.object(server, 'make_flashcards', return_value=[{'term': 'T', 'definition': 'D'}]) as cards:
            self.assertEqual(self.post({'kind': 'flashcards', 'text': words}), (200, {'cards': [{'term': 'T', 'definition': 'D'}]}))
            self.assertEqual(cards.call_args[0][3], 8, 'defaults to 8 like slides')
        with mock.patch.object(server, 'make_table', return_value={'headers': ['A'], 'rows': [['1']]}) as table:
            self.assertEqual(self.post({'kind': 'table', 'text': words}), (200, {'table': {'headers': ['A'], 'rows': [['1']]}}))
            self.assertEqual(table.call_count, 1)
        with mock.patch.object(server, 'make_mindmap', return_value={'label': 'Root', 'children': []}) as mindmap:
            self.assertEqual(self.post({'kind': 'mindmap', 'text': words}), (200, {'mindmap': {'label': 'Root', 'children': []}}))
            self.assertEqual(mindmap.call_count, 1)
        with mock.patch.object(server, 'make_infographic', return_value={'headline': 'H', 'stats': [], 'points': []}) as info:
            self.assertEqual(self.post({'kind': 'infographic', 'text': words}), (200, {'infographic': {'headline': 'H', 'stats': [], 'points': []}}))
            self.assertEqual(info.call_count, 1)


if __name__ == '__main__':
    unittest.main()
