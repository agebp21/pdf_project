"""AI through Google's Gemini API: a model named gemini-… goes there (GEMINI_API_KEY), any other
model still through Sumopod; the summary, the translation and Ask pick their model from .env."""
import json
import os
from pathlib import Path
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import messages_en
import server


def reply(data):
    response = mock.MagicMock()
    response.read.return_value = json.dumps(data).encode()
    response.__enter__.return_value = response
    return response


GEMINI_OK = {'candidates': [{'content': {'parts': [{'text': 'Berpikir…', 'thought': True}, {'text': 'Intisari '}, {'text': 'buku.'}]},
                             'finishReason': 'STOP'}]}


class Routing(unittest.TestCase):
    def test_gemini_request_and_reply(self):
        with mock.patch.dict(os.environ, {'GEMINI_API_KEY': 'g-key'}), mock.patch('urllib.request.urlopen', return_value=reply(GEMINI_OK)) as call:
            out = server.ai_chat('Sistem.', 'Teks buku.', 'gemini-2.5-flash', max_tokens=4000, temperature=0.2)
        self.assertEqual(out, 'Intisari buku.', 'thinking parts are left out')
        request = call.call_args[0][0]
        self.assertEqual(request.full_url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
        self.assertEqual(request.get_header('X-goog-api-key'), 'g-key')
        body = json.loads(request.data)
        self.assertEqual(body['systemInstruction']['parts'][0]['text'], 'Sistem.')
        self.assertEqual(body['contents'], [{'role': 'user', 'parts': [{'text': 'Teks buku.'}]}])
        self.assertEqual(body['generationConfig'], {'temperature': 0.2, 'maxOutputTokens': 8000, 'thinkingConfig': {'thinkingLevel': 'low'}})

    def test_thinking_level_refused_then_asked_without(self):
        import io, urllib.error
        refused = urllib.error.HTTPError('u', 400, 'Bad', {}, io.BytesIO(b'{"error": {"message": "Thinking level LOW is not supported for this model."}}'))
        with mock.patch.dict(os.environ, {'GEMINI_API_KEY': 'g'}), mock.patch('urllib.request.urlopen', side_effect=[refused, reply(GEMINI_OK)]) as call:
            self.assertEqual(server.ai_chat('S', 'U', 'gemini-2.5-flash'), 'Intisari buku.')
        self.assertNotIn('thinkingConfig', json.loads(call.call_args[0][0].data)['generationConfig'])
        with mock.patch.dict(os.environ, {'GEMINI_API_KEY': 'g', 'GEMINI_THINKING': ''}), mock.patch('urllib.request.urlopen', return_value=reply(GEMINI_OK)) as call:
            server.ai_chat('S', 'U', 'gemini-3.8-flash')
        self.assertNotIn('thinkingConfig', json.loads(call.call_args[0][0].data)['generationConfig'], 'empty = the model decides')

    def test_overloaded_model_uses_configured_fallback(self):
        import io, urllib.error
        import tempfile
        overloaded = urllib.error.HTTPError('u', 503, 'Busy', {}, io.BytesIO(b'{"error":{"status":"UNAVAILABLE"}}'))
        tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True); self.addCleanup(tmp.cleanup)
        with mock.patch.dict(os.environ, {'GEMINI_API_KEY': 'g', 'GEMINI_FALLBACK_MODEL': 'gemini-3.1-flash-lite',
                                          'MYFLIPBOOK_DB': str(Path(tmp.name) / 'a.sqlite3')}), mock.patch('builtins.print'), \
             mock.patch('urllib.request.urlopen', side_effect=[overloaded, reply(GEMINI_OK)]) as call:
            self.assertEqual(server.gemini_chat('S', 'U', 'gemini-3.5-flash-lite'), 'Intisari buku.')
        self.assertIn('/gemini-3.5-flash-lite:', call.call_args_list[0].args[0].full_url)
        self.assertIn('/gemini-3.1-flash-lite:', call.call_args_list[1].args[0].full_url)

    def test_other_models_stay_on_sumopod(self):
        sumopod = {'choices': [{'message': {'content': 'Halo'}}]}
        for model in ('claude-sonnet-5', 'gemini/gemini-3.8-flash'):          # Sumopod's own Gemini keeps going through Sumopod
            with self.subTest(model=model), mock.patch.dict(os.environ, {'SUMOPOD_API_KEY': 's-key', 'SUMOPOD_BASE_URL': 'https://ai.example/v1'}), \
                    mock.patch('urllib.request.urlopen', return_value=reply(sumopod)) as call:
                self.assertEqual(server.ai_chat('S', 'U', model), 'Halo')
            self.assertEqual(call.call_args[0][0].full_url, 'https://ai.example/v1/chat/completions')
            self.assertEqual(json.loads(call.call_args[0][0].data)['model'], model)

    def test_without_key_and_when_blocked(self):
        with mock.patch.dict(os.environ, {'GEMINI_API_KEY': ''}):
            with self.assertRaisesRegex(RuntimeError, 'GEMINI_API_KEY'):
                server.ai_chat('S', 'U', 'gemini-2.5-flash')
        blocked = {'promptFeedback': {'blockReason': 'SAFETY'}}
        with mock.patch.dict(os.environ, {'GEMINI_API_KEY': 'g'}), mock.patch('urllib.request.urlopen', return_value=reply(blocked)):
            with self.assertRaises(RuntimeError) as caught:
                server.ai_chat('S', 'U', 'gemini-2.5-flash')
        self.assertEqual(str(caught.exception), 'AI tidak memproses dokumen ini (SAFETY). Coba bagian lain atau ulangi.')
        self.assertEqual(messages_en.english(str(caught.exception)), 'The AI did not process this document (SAFETY). Try another part or again.')

    def test_features_pick_their_model(self):
        env = {'GEMINI_API_KEY': 'g', 'SUMOPOD_API_KEY': 's', 'SUMMARY_MODEL': 'gemini-2.5-flash', 'TRANSLATE_MODEL': 'gemini-2.5-flash',
               'ASK_MODEL': 'claude-sonnet-5'}
        summary = 'Intisari\nBuku ini membahas ' + 'gamelan Jawa ' * 20 + '.\nPoin penting\n- Satu (hlm. 1)'
        with mock.patch.dict(os.environ, env), mock.patch.object(server, 'gemini_chat', return_value=summary) as gemini:
            server.summarize_book('Buku', '[Halaman 1]\nGamelan Jawa.')
            self.assertEqual(gemini.call_args[0][2], 'gemini-2.5-flash')
            gemini.return_value = '{"0": "Hello"}'
            self.assertEqual(server.translate_pages({0: 'Halo'}, 'en-US'), {'0': 'Hello'})
            self.assertEqual(gemini.call_args[0][2], 'gemini-2.5-flash')
        sumopod = {'choices': [{'message': {'content': 'Jawab (hlm. 1).'}}]}
        with mock.patch.dict(os.environ, env), mock.patch('urllib.request.urlopen', return_value=reply(sumopod)) as call:
            server.ask_document('Buku', '[Halaman 1]\nIsi.', 'Apa?')
        self.assertEqual(json.loads(call.call_args[0][0].data)['model'], 'claude-sonnet-5', 'Ask keeps its own model')



class FriendlyErrors(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.tmp.cleanup)

    def refusal(self, code, body):
        import io, urllib.error
        return urllib.error.HTTPError('u', code, 'x', {}, io.BytesIO(body.encode()))

    def test_member_sees_plain_words_not_the_provider(self):
        credits = '{"error": {"code": 402, "message": "Your prepayment credits are depleted.", "status": "RESOURCE_EXHAUSTED"}}'
        token = '{"error": {"message": "Invalid proxy server token passed. Received API Key = sk-...CiyQ"}}'
        cases = [('gemini-3.8-flash', 402, credits, server.AI_UNAVAILABLE), ('gemini-3.8-flash', 429, 'slow down', server.AI_QUOTA),
                 ('gemini-3.8-flash', 503, 'overloaded', server.AI_BUSY), ('gemini/gemini-3.8-flash', 401, token, server.AI_UNAVAILABLE)]
        for model, code, body, words in cases:
            with self.subTest(model=model, code=code), mock.patch.dict(os.environ, {'GEMINI_API_KEY': 'g', 'SUMOPOD_API_KEY': 's', 'GEMINI_RETRY_SECONDS': '0',
                                                                                  'MYFLIPBOOK_DB': str(Path(self.tmp.name) / 'a.sqlite3')}),                     mock.patch('urllib.request.urlopen', side_effect=self.refusal(code, body)), mock.patch('builtins.print') as log:
                with self.assertRaises(RuntimeError) as caught:
                    server.ai_chat('S', 'U', model)
            self.assertEqual(str(caught.exception), words)
            self.assertNotIn('sk-', str(caught.exception)); self.assertNotIn('prepayment', str(caught.exception))
            self.assertIn(str(code), log.call_args[0][0], 'the details go to the server log')
        self.assertEqual(messages_en.english(server.AI_UNAVAILABLE), 'The AI service is unavailable for now. Please try again later.')
        for words in (server.AI_QUOTA, server.AI_BUSY, server.AI_UNAVAILABLE):
            self.assertNotRegex(words, r'(?i)gemini|billing|google|api', 'members never hear of our provider')
        self.assertEqual(messages_en.english(server.AI_QUOTA), 'MyFlipbook AI is in heavy use right now. Please wait a moment and try again.')


class Busy(unittest.TestCase):
    """Many members at once: Gemini's limit (429) or overload (503) is absorbed by the other model
    and by waiting as Gemini asks, before a member is told to wait; each one is noted for the
    admin panel (Server → Batas AI)."""
    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.tmp.cleanup)
        self.env = {'GEMINI_API_KEY': 'g', 'GEMINI_FALLBACK_MODEL': 'gemini-3.1-flash-lite', 'MYFLIPBOOK_DB': str(Path(self.tmp.name) / 'a.sqlite3')}

    def busy(self, code=429, delay='7s', quota='GenerateContentInputTokensPerModelPerMinute-PaidTier'):
        import io, urllib.error
        body = {'error': {'code': code, 'status': 'RESOURCE_EXHAUSTED', 'details': [
            {'@type': 'type.googleapis.com/google.rpc.QuotaFailure', 'violations': [{'quotaId': quota}]},
            {'@type': 'type.googleapis.com/google.rpc.RetryInfo', 'retryDelay': delay}]}}
        return urllib.error.HTTPError('u', code, 'x', {}, io.BytesIO(json.dumps(body).encode()))

    def events(self):
        path = Path(self.tmp.name) / 'ai-limits.jsonl'
        return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()] if path.exists() else []

    def test_limit_goes_to_the_other_model(self):
        with mock.patch.dict(os.environ, self.env), mock.patch('builtins.print'), \
             mock.patch('urllib.request.urlopen', side_effect=[self.busy(), reply(GEMINI_OK)]) as call, mock.patch('time.sleep') as sleep:
            self.assertEqual(server.gemini_chat('S', 'U', 'gemini-3.5-flash-lite'), 'Intisari buku.')
        self.assertIn('/gemini-3.1-flash-lite:', call.call_args_list[1].args[0].full_url)
        sleep.assert_not_called()
        [e] = self.events()
        self.assertEqual((e['code'], e['model'], e['quota'], e['failed']), (429, 'gemini-3.5-flash-lite', ['GenerateContentInputTokensPerModelPerMinute-PaidTier'], False))

    def test_both_busy_waits_as_asked_then_answers(self):
        with mock.patch.dict(os.environ, self.env), mock.patch('builtins.print'), \
             mock.patch('urllib.request.urlopen', side_effect=[self.busy(), self.busy(503, '3s'), reply(GEMINI_OK)]) as call, mock.patch('time.sleep') as sleep:
            self.assertEqual(server.gemini_chat('S', 'U', 'gemini-3.5-flash-lite'), 'Intisari buku.')
        sleep.assert_called_once_with(3.0)
        self.assertIn('/gemini-3.5-flash-lite:', call.call_args_list[2].args[0].full_url, 'tried again from the first model')
        self.assertEqual([e['failed'] for e in self.events()], [False, False])

    def test_too_long_a_wait_tells_the_member(self):
        # a daily limit asks for hours: no point waiting, the member hears it at once
        with mock.patch.dict(os.environ, self.env), mock.patch('builtins.print'), \
             mock.patch('urllib.request.urlopen', side_effect=[self.busy(delay='3600s'), self.busy(delay='3600s')]), mock.patch('time.sleep') as sleep:
            with self.assertRaises(RuntimeError) as caught:
                server.gemini_chat('S', 'U', 'gemini-3.5-flash-lite')
        self.assertEqual(str(caught.exception), server.AI_QUOTA)
        sleep.assert_not_called()
        self.assertEqual([e['failed'] for e in self.events()], [False, False, True])

    def test_other_refusals_are_not_retried(self):
        import io, urllib.error
        refused = urllib.error.HTTPError('u', 402, 'x', {}, io.BytesIO(b'{"error":{}}'))
        with mock.patch.dict(os.environ, self.env), mock.patch('builtins.print'), \
             mock.patch('urllib.request.urlopen', side_effect=[refused]) as call:
            with self.assertRaises(RuntimeError):
                server.gemini_chat('S', 'U', 'gemini-3.5-flash-lite')
        self.assertEqual(call.call_count, 1); self.assertEqual(self.events(), [])

    def test_admin_counts_the_last_day_and_week(self):
        import admin_server
        now = 1_800_000_000
        rows = [dict(at=now - 60, code=429, model='m', quota=['PerMinute'], failed=False),
                dict(at=now - 50, code=429, model='m', quota=[], failed=True),
                dict(at=now - 3 * 86400, code=503, model='m', quota=[], failed=False),
                dict(at=now - 9 * 86400, code=429, model='m', quota=['Old'], failed=True)]
        (Path(self.tmp.name) / 'ai-limits.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in rows) + 'broken\n', encoding='utf-8')
        with mock.patch.dict(os.environ, self.env):
            a = admin_server.ai_limits(now)
        self.assertEqual(a['day'], {'hits': 1, 'failed': 1}); self.assertEqual(a['week'], {'hits': 2, 'failed': 1})
        self.assertEqual(a['quotas'], {'PerMinute': 1, '-': 1}); self.assertEqual(a['last'], now - 50)


if __name__ == '__main__':
    unittest.main()
