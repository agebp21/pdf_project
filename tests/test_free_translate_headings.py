"""The free translator and Title Case headings: a heading's capitalised words are the heading,
not a name — it goes to the model as a sentence (codes kept) and comes back in Title Case;
names inside running text stay masked as before."""
from pathlib import Path
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import free_translate


class Engine:
    def __init__(self):
        self.seen = []

    def translate(self, text, src, dst):
        self.seen.append(text)
        return {'Dua jalan membongkar pusat': 'two ways to dismantle the center',
                'Konsep Z0Q untuk Z1Q': 'Z0Q concept for Z1Q'}.get(text, text.replace('tampil', 'performed'))


class HeadingTests(unittest.TestCase):
    def run_piece(self, text):
        engine = Engine()
        with mock.patch.object(free_translate, '_mostly', return_value=False):
            return free_translate._piece(engine, text, 'id', 'en'), engine.seen

    def test_title_case_heading_is_translated(self):
        out, seen = self.run_piece('Dua Jalan Membongkar Pusat')
        self.assertEqual(seen, ['Dua jalan membongkar pusat'], 'fed as a sentence, nothing masked')
        self.assertEqual(out, 'Two Ways to Dismantle the Center')

    def test_codes_in_a_heading_are_kept(self):
        out, seen = self.run_piece('Konsep PDF untuk JKT2A')
        self.assertEqual(seen, ['Konsep Z0Q untuk Z1Q'])
        self.assertEqual(out, 'PDF Concept for JKT2A')

    def test_names_in_running_text_stay(self):
        out, seen = self.run_piece('Roland Barthes tampil di Mega Mendung kemarin sore bersama teman')
        self.assertIn('Z0Q', seen[0]); self.assertIn('Z1Q', seen[0])
        self.assertIn('Roland Barthes', out); self.assertIn('Mega Mendung', out)

    def test_heading_detection(self):
        self.assertTrue(free_translate._heading('Makna yang Selalu Ditunda'))
        self.assertFalse(free_translate._heading('Roland Barthes tampil di Mega Mendung kemarin sore bersama teman'))
        self.assertFalse(free_translate._heading('Pusat'), 'one word: not enough to tell')


if __name__ == '__main__':
    unittest.main()
