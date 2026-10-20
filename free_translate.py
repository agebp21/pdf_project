"""Free, offline translation for whole books (the "ID | EN" editions), with
Argos Translate (OpenNMT models on the CPU, no AI credit). The AI translator
(/api/translate) stays for page-by-page and highlight features.

Setup once:  pip install argostranslate  then  python free_translate.py --install
(downloads the Indonesian <-> English models, about 100 MB).

Guards around the plain model:
  * text already in the target language is left alone ("Overall Storyline");
  * names / terms are kept: 2+ capitalised words, codes with digits or capitals
    (Activation Ceremony, Mega Mendung, JKT2A) — masked before translating and
    restored after; if the model drops a mask, the piece is redone unmasked;
  * except in a heading written in Title Case ("Dua Jalan Membongkar Pusat"): its
    capitalised words are the heading, not a name, so only codes are kept; it is
    translated as a sentence (better than Title Case input) and comes back in Title Case;
  * labels and themes split at ": " are translated piece by piece.
"""
import re
import sys
import threading

LANGS = {'id-ID': 'id', 'en-US': 'en'}
PAIRS = (('id', 'en'), ('en', 'id'))
TERM = re.compile(r"\b(?:[A-Z][\w'-]*(?:\s+(?:[A-Z][\w'-]*|&|of|and|for|the))*\s+[A-Z][\w'-]*|[A-Za-z]*\d[\w-]*|[A-Z]{2,}[\w-]*)\b")
CODE = re.compile(r"\b(?:[A-Za-z]*\d[\w-]*|[A-Z]{2,}[\w-]*)\b")       # in a heading only codes are kept
SMALL = {'a', 'an', 'the', 'of', 'and', 'or', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'is', 'that',
         'dan', 'atau', 'di', 'ke', 'dari', 'yang', 'untuk', 'dengan', 'pada', 'dalam', 'sebagai', 'oleh'}


def _heading(text):
    """A Title Case line: most of its words (3+ letters, two at least) start with a capital."""
    words = re.findall(r"[A-Za-z][\w'-]{2,}", text)
    return len(words) >= 2 and len(text) <= 120 and sum(w[0].isupper() for w in words) / len(words) >= 0.7


def _title(text):
    words = text.split(' ')
    return ' '.join(w if re.search(r'\d', w) or w.isupper() else w[:1].upper() + w[1:] if i == 0 or w.lower() not in SMALL else w.lower()
                    for i, w in enumerate(words))       # codes (v4, JKT2A) stay as written
_lock = threading.Lock()
_engine = None


def _translate_module():
    global _engine
    if _engine is None:
        import argostranslate.translate as engine   # slow first import (~2 s), then kept
        _engine = engine
    return _engine


def available():
    """True when Argos and both Indonesian <-> English models are installed."""
    try:
        import argostranslate.package as packages
        have = {(p.from_code, p.to_code) for p in packages.get_installed_packages()}
    except Exception:
        return False
    return all(pair in have for pair in PAIRS)


def install():
    import argostranslate.package as packages
    packages.update_package_index()
    for pkg in packages.get_available_packages():
        if (pkg.from_code, pkg.to_code) in PAIRS:
            packages.install_from_path(pkg.download())
            print('installed', pkg.from_code, '->', pkg.to_code)


def _mostly(text, lang):
    from wordfreq import zipf_frequency as z
    words = [w.lower() for w in re.findall(r'[A-Za-z]{3,}', text)]
    if not words:
        return True
    other = 'en' if lang == 'id' else 'id'
    return sum(1 for w in words if z(w, lang) - z(w, other) >= 1.0) / len(words) >= 0.6


def _piece(engine, text, src, dst):
    if not re.search(r'[A-Za-z]{2}', text) or (_mostly(text, dst) and not _mostly(text, src)):
        return text
    keep = []
    heading = _heading(text)

    def mask(match):
        keep.append(match.group(0))
        return f'Z{len(keep) - 1}Q'

    finish = _title if heading else (lambda out: out)
    # A heading goes in as a sentence (the model reads Title Case words as names), comes back in Title Case.
    def plain(t):
        if not heading:
            return t
        low = ''.join(part if re.fullmatch(r'Z\d+Q', part) else part.lower() for part in re.split(r'(Z\d+Q)', t))   # masks stay as they are
        return t[:1] + low[1:] if t[:1].isalpha() else low
    masked = plain((CODE if heading else TERM).sub(mask, text))
    if keep:
        out = engine.translate(masked, src, dst)
        if all(re.search(rf'Z\s*{i}\s*Q', out, flags=re.I) for i in range(len(keep))):
            for i, term in enumerate(keep):
                out = re.sub(rf'Z\s*{i}\s*Q', lambda _m, term=term: term, out, flags=re.I)
            return finish(out)
    return finish(engine.translate(plain(text), src, dst))    # a term got lost: without masks


def translate_text(text, target):
    """One text into the target language ('id-ID' / 'en-US')."""
    dst = LANGS.get(target)
    if not dst:
        raise ValueError('Bahasa tujuan tidak didukung penerjemah gratis.')
    src = 'id' if dst == 'en' else 'en'
    engine = _translate_module()
    with _lock:                                        # the models are not thread-safe
        parts = re.split(r'(:\s+)', text)
        return ''.join(part if re.fullmatch(r':\s+', part) or not part.strip() else _piece(engine, part, src, dst) for part in parts).strip()


def translate_texts(texts, target):
    """{key: text} -> {key: translation} (empty texts left out)."""
    return {key: translate_text(text, target) for key, text in texts.items() if text.strip()}


if __name__ == '__main__':
    if '--install' in sys.argv:
        install()
    print('available:', available())
