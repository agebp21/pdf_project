"""Free, offline text-to-speech with Piper (CPU only), mixed Indonesian/English.

Text is split into Indonesian and English stretches by how common each word is
in either language (wordfreq); words used in both ("video", "data") or names
follow their neighbours. Each stretch is read by its own Piper voice and the
audio is joined into one WAV.

Voices live in .data/piper/ (not in git):
  id_ID-news_tts-medium.onnx(.json)   Indonesian
  en_US-lessac-medium.onnx(.json)     English
"""
import io
from pathlib import Path
import re
import threading
import wave

VOICE_DIR = Path(__file__).resolve().parent / '.data' / 'piper'
VOICES = {'id': 'id_ID-news_tts-medium', 'en': 'en_US-lessac-medium'}
CLEAR = 1.0            # zipf difference that makes a word clearly one language
GAP_SECONDS = 0.06     # small pause where the language switches

WORD = re.compile(r"[A-Za-z][A-Za-z'’-]*")


def word_language(word):
    """'en', 'id', or None when the word is shared / unknown (names, loanwords)."""
    from wordfreq import zipf_frequency
    w = word.lower().strip("'’-")
    if len(w) < 2:
        return None
    en, idn = zipf_frequency(w, 'en'), zipf_frequency(w, 'id')
    if en - idn >= CLEAR:
        return 'en'
    if idn - en >= CLEAR:
        return 'id'
    return None


def segments(text, default='id'):
    """[(lang, text)] in reading order; consecutive same-language parts joined."""
    out = []
    for sentence in re.split(r'(?<=[.!?…])\s+', text.strip()):
        if not sentence:
            continue
        tokens = re.findall(r"\S+\s*", sentence)
        langs = []
        for token in tokens:
            match = WORD.search(token)
            langs.append(word_language(match.group(0)) if match else None)
        known = [lang for lang in langs if lang]
        base = max(('id', 'en'), key=known.count) if known else default
        # Shared words take the previous clear word's language in the sentence,
        # else the next one's, else the sentence's main language.
        resolved = []
        for i, lang in enumerate(langs):
            if lang is None:
                prev = next((resolved[j] for j in range(i - 1, -1, -1) if langs[j]), None)
                after = next((langs[j] for j in range(i + 1, len(langs)) if langs[j]), None)
                lang = prev or after or base
                if prev and after and prev != after:
                    lang = base
            resolved.append(lang)
        for token, lang in zip(tokens, resolved):
            if out and out[-1][0] == lang:
                out[-1][1] += token
            else:
                out.append([lang, token])
        if out:
            out[-1][1] = out[-1][1].rstrip() + ' '
    return [(lang, part.strip()) for lang, part in out if part.strip()]


class Speaker:
    """Loads each Piper voice once; thread-safe synthesis to WAV bytes."""

    def __init__(self, voice_dir=VOICE_DIR):
        self.voice_dir = Path(voice_dir)
        self.voices = {}
        self.lock = threading.Lock()

    def available(self):
        return all((self.voice_dir / f'{name}.onnx').exists() for name in VOICES.values())

    def voice(self, lang):
        if lang not in self.voices:
            from piper import PiperVoice
            self.voices[lang] = PiperVoice.load(str(self.voice_dir / f'{VOICES[lang]}.onnx'))
        return self.voices[lang]

    def wav(self, text, default='id', length_scale=1.0):
        from piper import SynthesisConfig
        config = SynthesisConfig(length_scale=length_scale)
        frames, rate = [], None
        with self.lock:
            for lang, part in segments(text, default):
                voice = self.voice(lang)
                rate = rate or voice.config.sample_rate
                if frames:
                    frames.append(b'\x00\x00' * int(rate * GAP_SECONDS))
                for chunk in voice.synthesize(part, syn_config=config):
                    frames.append(chunk.audio_int16_bytes)
        out = io.BytesIO()
        with wave.open(out, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate or 22050)
            w.writeframes(b''.join(frames))
        return out.getvalue()


if __name__ == '__main__':
    import sys
    import time
    text = ' '.join(sys.argv[2:]) or ('Hero video dimulai setelah proses Activation Ceremony selesai. '
                                      'Video ditutup dengan Grand Reveal JKT2A sebagai representasi tema: '
                                      'Beyond Connected: Reliable Infrastructure for the AI Era. '
                                      'Terima kasih sudah membaca bersama MyFlipbook.')
    for lang, part in segments(text):
        print(f'[{lang}] {part}')
    start = time.time()
    Path(sys.argv[1] if len(sys.argv) > 1 else 'tts-sample.wav').write_bytes(Speaker().wav(text))
    print('done in', round(time.time() - start, 2), 's')
