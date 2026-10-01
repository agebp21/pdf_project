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
  * labels and themes split at ": " are translated piece by piece.
"""
import re
import sys
import threading

LANGS = {'id-ID': 'id', 'en-US': 'en'}
PAIRS = (('id', 'en'), ('en', 'id'))
TERM = re.compile(r"\b(?:[A-Z][\w'-]*(?:\s+(?:[A-Z][\w'-]*|&|of|and|for|the))*\s+[A-Z][\w'-]*|[A-Za-z]*\d[\w-]*|[A-Z]{2,}[\w-]*)\b")
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

    def mask(match):
        keep.append(match.group(0))
        return f'Z{len(keep) - 1}Q'

    masked = TERM.sub(mask, text)
    if keep:
        out = engine.translate(masked, src, dst)
        if all(re.search(rf'Z\s*{i}\s*Q', out, flags=re.I) for i in range(len(keep))):
            for i, term in enumerate(keep):
                out = re.sub(rf'Z\s*{i}\s*Q', lambda _m, term=term: term, out, flags=re.I)
            return out
    return engine.translate(text, src, dst)            # a term got lost: without masks


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
