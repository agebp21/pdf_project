"""MyFlipbook server: static app, accounts/billing, Office conversion, native builds.

Loopback-only by default. Pass --host 0.0.0.0 to serve trusted LAN PCs;
Host/Origin/token checks still apply against this machine's own addresses.

Hosting: pass --public-host your.domain (behind an HTTPS reverse proxy).
Then login is required for server-side features and plan entitlements are
enforced (see accounts.py). Local mode keeps working without an account.
"""
import argparse
import csv
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unicodedata
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, HTTPServer, SimpleHTTPRequestHandler, ThreadingHTTPServer
import urllib.error
import urllib.request
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit

try:
    # Verify HTTPS like the browser does (the operating system's certificate
    # store, which also fetches missing intermediate certificates): many
    # journal sites send an incomplete chain that plain Python rejects.
    import truststore
    truststore.inject_into_ssl()
except ImportError:          # optional: pip install truststore
    pass

import accounts
import library
import share
import messages_en
import free_translate
import geo
import seo
import book_seal
import invoice
import visits

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / '.build'
DATA = ROOT / '.data'
ANDROID_SIGNING = DATA / 'android-signing.json'
TOKEN = secrets.token_urlsafe(32)
JOBS = {}
BUILD_LOCK = threading.Lock()
# Remote builds: a server without Flutter (the VPS) queues APK/EXE jobs for a
# build PC running build_worker.py (BUILD_WORKER_KEY in both .env files).
WORKER = dict(seen=0.0)
WORKER_LOCK = threading.Lock()
WORKER_ONLINE_SECONDS = 90          # the worker asks every ~10 s; quiet longer than this = offline
WORKER_STALE_SECONDS = 45 * 60      # a claimed job with no news for this long has failed
MAX_QUEUED_BUILDS = 20
MAX_BUILD_RESULT = 600 * 1024 * 1024
# Remote free translation: without Argos here, whole-book translation batches
# go to the same PC (build_worker.py translates them with its Argos).
TRANSLATIONS = {}
TRANSLATE_COND = threading.Condition()
REMOTE_TRANSLATE_SECONDS = 150      # one batch, PC included
TRANSLATE_CLAIM_WAIT = 25           # the PC's long poll
POSITIONS = {'top-left', 'top-right', 'bottom-left', 'bottom-right'}
SESSION_COOKIE = 'mf_session'
PAGES = {'index.html', 'converter.html', 'workflow.html', 'library.html', 'journals.html', 'flipbook.html', 'animation.html', 'notebook.html',
         'login.html', 'account.html', 'coming-soon.html', 'privacy.html', 'terms.html'}
# Unreleased features: on a normal run (paywall on) these pages show the
# coming-soon page; --no-paywall keeps them usable internally.
SOON_PAGES = {'animation.html': 'Flipbook Animation'}
# public_hosts: domains served in hosting mode (login + entitlements enforced).
# secure: Secure cookies (HTTPS). base_url: absolute URL for payment callbacks.
# paywall: exports/builds need a paid plan. Off when imported (tests),
# on when server.py runs unless --no-paywall.
CONFIG = dict(public_hosts=set(), secure=False, base_url='', paywall=False, verify_email=False)
# Export-only templates: without them no offline package can be built, so
# the paywall holds even if someone edits the page's JavaScript.
EXPORT_TEMPLATES = {'assets/export/index.html', 'assets/export/viewer.js', 'assets/export/viewer.css'}
ACCOUNTS = None
ACCOUNTS_LOCK = threading.Lock()
LIBRARY = None
VISITS = None
RECENT_VISITS = {}
VISIT_LOCK = threading.Lock()


def load_env(path):
    """KEY=VALUE lines from a local .env (never committed) into the
    environment; variables already set by the system win."""
    try:
        lines = Path(path).read_text(encoding='utf-8-sig').splitlines()
    except OSError:
        return []
    loaded = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        name, value = line.split('=', 1)
        name, value = name.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name) and value and name not in os.environ:
            os.environ[name] = value
            loaded.append(name)
    return loaded


def hosted():
    return bool(CONFIG['public_hosts'])


def payments_live():
    """True bila minimal satu gateway pembayaran aktif (asli atau Mock dev).

    Fitur AI membakar kredit API per panggil, jadi dimatikan selama server
    tidak bisa menagih (kedua provider Disabled) — otomatis nyala lagi
    begitu key payment diisi, tanpa ubah kode.
    """
    try:
        store = get_accounts()
    except Exception:
        return False
    for currency in accounts.CURRENCIES:
        try:
            if store.provider_for(currency).name != 'none':
                return True
        except Exception:
            continue
    return False


def get_accounts():
    """Create the account store on first use (tests may preset ACCOUNTS)."""
    global ACCOUNTS
    with ACCOUNTS_LOCK:
        if ACCOUNTS is None:
            key = os.environ.get('MIDTRANS_SERVER_KEY', '').strip()
            tripay = [os.environ.get(n, '').strip() for n in ('TRIPAY_API_KEY', 'TRIPAY_PRIVATE_KEY', 'TRIPAY_MERCHANT_CODE')]
            duitku = [os.environ.get(n, '').strip() for n in ('DUITKU_MERCHANT_CODE', 'DUITKU_API_KEY')]
            prefer = os.environ.get('MYFLIPBOOK_IDR_PROVIDER', '').strip().lower()
            midtrans = lambda: accounts.MidtransProvider(key, os.environ.get('MIDTRANS_PRODUCTION') == '1')
            tripay_provider = lambda: accounts.TripayProvider(*tripay, production=os.environ.get('TRIPAY_PRODUCTION') == '1')
            duitku_provider = lambda: accounts.DuitkuProvider(*duitku, production=os.environ.get('DUITKU_PRODUCTION') == '1')
            if prefer == 'duitku' and all(duitku):
                provider = duitku_provider()
            elif prefer == 'tripay' and all(tripay):
                provider = tripay_provider()
            elif prefer == 'midtrans' and key:
                provider = midtrans()
            elif all(duitku):
                provider = duitku_provider()   # Duitku is the rupiah gateway by default
            elif key:
                provider = midtrans()   # Midtrans is the rupiah gateway by default
            elif all(tripay):
                provider = tripay_provider()
            elif hosted() and os.environ.get('MYFLIPBOOK_MOCK_PAYMENTS') != '1':
                provider = accounts.DisabledProvider()  # public site without a gateway: no fake payments
            else:
                provider = accounts.MockProvider()
            ls = [os.environ.get(n, '').strip() for n in
                  ('LEMONSQUEEZY_API_KEY', 'LEMONSQUEEZY_STORE_ID', 'LEMONSQUEEZY_SIGNING_SECRET')]
            if all(ls):
                variants = {(plan, cycle): os.environ.get(f'LEMONSQUEEZY_VARIANT_{plan.upper()}_{cycle.upper()}', '').strip()
                            for plan in ('pro', 'business') for cycle in ('monthly', 'yearly')}
                usd_provider = accounts.LemonSqueezyProvider(*ls, variants)
            elif hosted() and os.environ.get('MYFLIPBOOK_MOCK_PAYMENTS') != '1':
                usd_provider = accounts.DisabledProvider()
            else:
                usd_provider = accounts.MockProvider()
            db = os.environ.get('MYFLIPBOOK_DB') or str(ROOT / '.data' / 'myflipbook.sqlite3')
            ACCOUNTS = accounts.Accounts(db, provider, usd_provider)
        return ACCOUNTS


def get_library():
    """The member archive, next to the account database (same SQLite file)."""
    global LIBRARY
    store = get_accounts()
    with ACCOUNTS_LOCK:
        if LIBRARY is None or LIBRARY.store is not store:
            LIBRARY = library.Library(store, store.path.parent)
        return LIBRARY


SHARE = None


def get_share():
    """Public share links, next to the account database (same SQLite file)."""
    global SHARE
    store = get_accounts()
    with ACCOUNTS_LOCK:
        if SHARE is None or SHARE.store is not store:
            SHARE = share.Share(store, store.path.parent)
        return SHARE


# Floating download button injected into a served share page (no script,
# only HTML+CSS, so the sealed book's CSP still holds).
SHARE_BAR = ('<div id="mf-share-dl" style="position:fixed;right:14px;bottom:14px;z-index:2147483647;'
             'font-family:system-ui,sans-serif">'
             '<a href="?dl=1" download style="display:inline-block;background:#1A3C34;color:#fff;font-weight:800;'
             'font-size:14px;padding:12px 18px;border-radius:999px;text-decoration:none;'
             'box-shadow:0 8px 20px rgba(0,0,0,.35)">&#11015; Download</a></div>')


def share_filename(title):
    safe = re.sub(r'[^A-Za-z0-9._ -]+', '_', (title or '').strip())[:80] or 'flipbook'
    return safe + '.html'


def payments_paused():
    """PAYMENTS_PAUSED=1 in .env: no new checkouts (e.g. while the gateway is being
    set up), even with gateway keys filled in. Notifications for orders already
    made still come in."""
    return os.environ.get('PAYMENTS_PAUSED', '').strip().lower() in ('1', 'true', 'yes', 'on')


# Usage quotas per rolling window (hosted): None = no limit. Change with .env,
# e.g. QUOTA_FREE_AI=5, QUOTA_PRO_TRANSLATE=400000, QUOTA_WINDOW_HOURS=5.
QUOTAS = {
    'free': {'office': 10, 'ai': 5, 'translate': 40_000},
    'pro': {'office': None, 'ai': 50, 'translate': 400_000},
    'business': {'office': None, 'ai': 150, 'translate': None},
}
QUOTA_LABELS = {'office': 'konversi', 'ai': 'AI', 'translate': 'terjemahan buku'}


def quota_window():
    try:
        return max(1, int(float(os.environ.get('QUOTA_WINDOW_HOURS', '5')) * 3600))
    except ValueError:
        return 5 * 3600


def quota_limit(user, kind):
    # Free members (during their trial — afterwards these features need a plan) get
    # the small allowance: that is what makes piles of new accounts not worth it.
    tier = user['plan'] if user['plan'] in ('pro', 'business') else 'free'
    value = os.environ.get(f'QUOTA_{tier.upper()}_{kind.upper()}', '').strip()
    if value:
        return None if value.lower() in ('0', 'none', 'unlimited') else int(value)
    return QUOTAS[tier][kind]


SIGNUP_IP_MESSAGE = 'Dari jaringan ini sudah ada akun MyFlipbook. Masuk dengan akun yang sudah ada, atau hubungi kami bila jaringan ini dipakai bersama.'


def worker_key():
    return os.environ.get('BUILD_WORKER_KEY', '').strip()


def remote_builds():
    """APK/EXE builds go to the build PC: a worker key is set and there is no Flutter here."""
    return bool(worker_key()) and not shutil.which('flutter')


def local_free_translate():
    """Argos here (FREE_TRANSLATE_LOCAL=0 forces the build PC, e.g. for tests)."""
    return os.environ.get('FREE_TRANSLATE_LOCAL', '').strip() != '0' and free_translate.available()


def remote_translate(pages, target):
    """One batch translated by the build PC; RuntimeError when it is off or slow."""
    if not worker_online():
        raise RuntimeError('PC penerjemah sedang offline. Coba lagi nanti.')
    task = dict(id=uuid.uuid4().hex, pages=pages, target=target, claimed=False, done=threading.Event(), result=None, error=None)
    with TRANSLATE_COND:
        TRANSLATIONS[task['id']] = task
        TRANSLATE_COND.notify_all()
    try:
        if not task['done'].wait(REMOTE_TRANSLATE_SECONDS):
            raise RuntimeError('PC penerjemah tidak menjawab. Coba lagi.')
        if task['error']:
            raise RuntimeError('Terjemahan gagal di PC penerjemah: ' + task['error'])
        return task['result']
    finally:
        with TRANSLATE_COND:
            TRANSLATIONS.pop(task['id'], None)


def worker_online():
    return time.time() - WORKER['seen'] < WORKER_ONLINE_SECONDS


def get_visits():
    """Page-view statistics for the admin panel, next to the account database."""
    global VISITS
    folder = get_accounts().path.parent
    with ACCOUNTS_LOCK:
        if VISITS is None or VISITS.path.parent != folder:
            VISITS = visits.Visits(folder / 'visits.sqlite3')
        return VISITS


def validate_manifest(data):
    if not isinstance(data, dict) or data.get('version') != 1:
        raise ValueError('Versi buku tidak valid.')
    count, ratio = data.get('pageCount'), data.get('ratio')
    if type(count) is not int or count < 1 or not isinstance(data.get('title'), str):
        raise ValueError('Judul atau jumlah halaman tidak valid.')
    if type(ratio) not in (int, float) or not math.isfinite(ratio) or ratio <= 0:
        raise ValueError('Rasio halaman tidak valid.')
    if not isinstance(data.get('overlays'), dict):
        raise ValueError('Animasi tidak valid.')
    overlays = {}
    for key, item in data['overlays'].items():
        if not re.fullmatch(r'0|[1-9][0-9]*', key) or int(key) >= count or not isinstance(item, dict):
            raise ValueError('Halaman animasi tidak valid.')
        value = item.get('value')
        if (type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 999999
                or item.get('position') not in POSITIONS or not isinstance(item.get('label'), str)):
            raise ValueError('Nilai animasi tidak valid.')
        overlays[key] = dict(label=item['label'][:40], value=value, position=item['position'])
    return dict(version=1, title=data['title'][:200], pageCount=count, ratio=ratio, overlays=overlays,
                links=validate_links(data.get('links', {}), count), words=(words := validate_words(data.get('words', {}), count)),
                text=validate_text(data.get('text', {}), words),
                **({'podcast': podcast} if (podcast := validate_podcast(data.get('podcast'))) else {}),
                **({'translations': tr} if (tr := validate_translations(data.get('translations'), count)) else {}),
                **({'summary': sm} if (sm := validate_summary(data.get('summary'))) else {}),
                **({'lang': data['lang']} if data.get('lang') in BOOK_LANGS else {}),
                **({'versions': vs} if data.get('lang') in BOOK_LANGS and (vs := validate_versions(data.get('versions'), count, data['lang'])) else {}),
                **({'versionText': vt} if data.get('lang') in BOOK_LANGS and (vt := validate_version_text(
                    data.get('versionText'), validate_versions(data.get('versions'), count, data['lang'])) ) else {}),
                **({'versionWords': vw} if data.get('lang') in BOOK_LANGS and (vw := validate_version_words(
                    data.get('versionWords'), validate_versions(data.get('versions'), count, data['lang'])) ) else {}))


BOOK_LANGS = ('id-ID', 'en-US', 'ms-MY')


def validate_versions(versions, count, lang):
    """Translated editions ("ID | EN"): {lang: [page indices with a translated
    picture]}. Their pictures follow the original pages in a package."""
    if versions is None:
        return None
    if not isinstance(versions, dict):
        raise ValueError('Data edisi terjemahan tidak valid.')
    out = {}
    for code, pages in versions.items():
        if code not in BOOK_LANGS or code == lang or not isinstance(pages, list):
            raise ValueError('Bahasa edisi terjemahan tidak valid.')
        clean = sorted(set(pages))
        if any(type(i) is not int or not 0 <= i < count for i in clean):
            raise ValueError('Halaman edisi terjemahan tidak valid.')
        if clean:
            out[code] = clean
    return out or None


def validate_version_text(texts, versions):
    """What each translated page says (audio book): {lang: {page: [[x, y, w, h, text]]}}."""
    if not isinstance(texts, dict) or not versions:
        return None
    unit = lambda v: type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1
    out = {}
    for lang, pages in texts.items():
        if lang not in versions or not isinstance(pages, dict):
            continue
        clean = {}
        for key, blocks in pages.items():
            if not re.fullmatch(r'0|[1-9][0-9]*', str(key)) or int(key) not in versions[lang] or not isinstance(blocks, list):
                continue
            good = [b[:4] + [b[4][:4000]] for b in blocks
                    if isinstance(b, list) and len(b) == 5 and all(unit(v) for v in b[:4]) and isinstance(b[4], str) and b[4].strip()][:300]
            if good:
                clean[str(key)] = good
        if clean:
            out[lang] = clean
    return out or None


def validate_version_words(all_words, versions):
    """Where the words of each translated page are (highlighter):
    {lang: {page: {w: [[y, h, x0, w0, ...]], t: [line text]}}}; bad entries dropped."""
    if not isinstance(all_words, dict) or not versions:
        return None
    out = {}
    for lang, pages in all_words.items():
        if lang not in versions or not isinstance(pages, dict):
            continue
        clean = {}
        for key, page in pages.items():
            if (not re.fullmatch(r'0|[1-9][0-9]*', str(key)) or int(key) not in versions[lang] or not isinstance(page, dict)
                    or not isinstance(page.get('w'), list) or not isinstance(page.get('t'), list)):
                continue
            w = page['w'][:400]
            t = page['t'][:len(w)]
            if not w or not all(isinstance(line, list) and 4 <= len(line) <= 602 and len(line) % 2 == 0
                                and all(type(v) is int and 0 <= v <= 10000 for v in line) for line in w) \
                    or not all(isinstance(line, str) for line in t):
                continue
            clean[str(key)] = {'w': w, 't': [line[:4000] for line in t]}
        if clean:
            out[lang] = clean
    return out or None


def version_images(data):
    """[(lang, page)] in the order translated pictures follow the originals."""
    return [(lang, page) for lang in sorted(data.get('versions') or {}) for page in data['versions'][lang]]


def validate_words(words, count):
    """Word positions for reader highlights: per page, lines of integers
    [y, h, x0, w0, x1, w1, ...] in 1/10000 of the page box."""
    if not isinstance(words, dict):
        raise ValueError('Data teks halaman tidak valid.')
    out = {}
    for key, lines in words.items():
        if not re.fullmatch(r'0|[1-9][0-9]*', key) or int(key) >= count or not isinstance(lines, list):
            raise ValueError('Halaman teks tidak valid.')
        cleaned = []
        for line in lines[:400]:
            if (not isinstance(line, list) or len(line) < 4 or len(line) % 2 or len(line) > 602
                    or not all(type(v) is int and 0 <= v <= 10000 for v in line)):
                raise ValueError('Posisi teks tidak valid.')
            cleaned.append(line)
        out[key] = cleaned
    return out


def validate_text(text, words):
    """Text of the word lines (words joined by single spaces), same pages
    and at most as many lines as the word positions."""
    if not isinstance(text, dict):
        raise ValueError('Data teks halaman tidak valid.')
    out = {}
    for key, lines in text.items():
        if key not in words or not isinstance(lines, list) or len(lines) > len(words[key]) \
                or not all(isinstance(line, str) for line in lines):
            raise ValueError('Isi teks halaman tidak valid.')
        out[key] = [line[:4000] for line in lines]
    return out


def validate_podcast(podcast):
    """Podcast script: {lines: [{s: 'A'|'B', t}], hosts: [a, b], lang}; None when absent."""
    if podcast is None:
        return None
    if not isinstance(podcast, dict) or not isinstance(podcast.get('lines'), list) or len(podcast['lines']) > 400:
        raise ValueError('Data podcast tidak valid.')
    lines = []
    for line in podcast['lines']:
        if not isinstance(line, dict) or line.get('s') not in ('A', 'B') or not isinstance(line.get('t'), str) or not line['t'].strip():
            raise ValueError('Baris podcast tidak valid.')
        lines.append(dict(s=line['s'], t=line['t'].strip()[:2000]))
    if not lines:
        return None
    hosts = podcast.get('hosts')
    if not (isinstance(hosts, list) and len(hosts) == 2 and all(isinstance(h, str) and h.strip() for h in hosts)):
        hosts = ['Rina', 'Bima']
    lang = podcast.get('lang') if podcast.get('lang') in ('id-ID', 'ms-MY', 'en-US') else 'id-ID'
    return dict(lines=lines, hosts=[h.strip()[:30] for h in hosts], lang=lang)


TRANSLATE_LANGUAGES = {'id-ID': 'Bahasa Indonesia', 'en-US': 'English', 'ms-MY': 'Bahasa Melayu (Malaysia)'}
TRANSLATE_MAX_CHARS = 30_000      # per request (the editor sends a book in pieces)


def validate_translations(translations, count):
    """{lang: {page: text}} for id-ID / en-US / ms-MY; None when absent."""
    if translations is None:
        return None
    if not isinstance(translations, dict):
        raise ValueError('Data terjemahan tidak valid.')
    out = {}
    for lang, pages in translations.items():
        if lang not in TRANSLATE_LANGUAGES or not isinstance(pages, dict):
            raise ValueError('Bahasa terjemahan tidak valid.')
        clean = {}
        for key, text in pages.items():
            if not re.fullmatch(r'0|[1-9][0-9]*', str(key)) or int(key) >= count or not isinstance(text, str):
                raise ValueError('Halaman terjemahan tidak valid.')
            if text.strip():
                clean[str(key)] = text[:20000]
        if clean:
            out[lang] = clean
    return out or None


def validate_summary(summary):
    """{lang, text}; None when absent or empty."""
    if summary is None:
        return None
    if not isinstance(summary, dict) or not isinstance(summary.get('text'), str):
        raise ValueError('Data ringkasan tidak valid.')
    text = summary['text'].strip()[:20000]
    if not text:
        return None
    lang = summary.get('lang') if summary.get('lang') in TRANSLATE_LANGUAGES else 'id-ID'
    return dict(lang=lang, text=text)


SUMMARY_CHUNK = 60_000            # characters per part of a long book
BOOK_PARTS = 24                   # at most this many parts (bigger parts for huge books)


def book_notes(title, text, language, model):
    """A long book as faithful notes, part by part from the first page to the
    last (parts run in parallel). Returns one text with [Bagian n/N] headers."""
    size = max(SUMMARY_CHUNK, -(-len(text) // BOOK_PARTS))
    pieces = [text[i:i + size] for i in range(0, len(text), size)]
    system = (f'Buat catatan ringkas yang setia dari bagian buku ini dalam {language}: alur atau pokok bahasan, tokoh dan nama, '
              'peristiwa atau argumen penting, istilah, sesuai urutan dalam teks. Maksimal 300 kata. Hanya isi dari teks, tanpa pendapat.')
    def note(n):
        return f'[Bagian {n + 1}/{len(pieces)}]\n' + ai_chat(system, f'Judul buku: {title}\n\n{pieces[n]}', model, max_tokens=3000).strip()
    with ThreadPoolExecutor(max_workers=4) as pool:
        notes = list(pool.map(note, range(len(pieces))))
    return 'Catatan per bagian, dari awal sampai akhir buku:\n\n' + '\n\n'.join(notes)


def summarize_book(title, text, lang='id-ID'):
    """A faithful summary: an overview paragraph and 5-8 key points (long books
    are first summarised in parts, then combined)."""
    model = os.environ.get('SUMMARY_MODEL', '').strip() or os.environ.get('PODCAST_MODEL', 'claude-sonnet-5').strip()
    language = TRANSLATE_LANGUAGES.get(lang, TRANSLATE_LANGUAGES['id-ID'])
    heads = {'en-US': ('Overview', 'Key points'), 'ms-MY': ('Intisari', 'Perkara penting')}.get(lang, ('Intisari', 'Poin penting'))
    source = book_notes(title, text, language, model) if len(text) > SUMMARY_CHUNK * 1.2 else text
    system = (f'Kamu editor buku. Tulis ringkasan buku dalam {language}, setia pada isi (jangan menambah fakta, angka, atau pendapat). Format persis:\n'
              f'Baris pertama: judul bagian "{heads[0]}", lalu 2-4 kalimat inti buku.\n'
              f'Lalu baris "{heads[1]}" diikuti 5-8 butir, tiap butir satu baris diawali "- ".\n'
              'Tanpa markdown lain (tanpa #, **, atau tabel).')
    for _ in range(2):
        reply = ai_chat(system, f'Judul buku: {title}\n\n{source}', model, max_tokens=4000)
        reply = reply.replace('**', '').replace('##', '').strip()
        if len(reply.split()) >= 30:
            return dict(lang=lang, text=reply[:20000], model=model)
    raise RuntimeError('AI tidak menghasilkan ringkasan. Coba lagi.')


HIGHLIGHT_MAX_CHARS = 6000


HIGHLIGHT_SUMMARY_MAX = 3000


def highlight_summary_words(text):
    """Target length: about half of the highlighted words, 40-300."""
    return max(40, min(300, round(len(text.split()) * 0.5)))


def summarize_highlight(text):
    """A faithful summary of one highlighted passage (for its note on the page
    edge), in the passage's own language; longer passages get longer notes."""
    lines = [' '.join(line.split()) for line in str(text or '').splitlines()]
    text = '\n'.join(line for line in lines if line)
    if len(text) < 2:
        raise ValueError('Teks yang distabilo kosong.')
    text = text[:HIGHLIGHT_MAX_CHARS]
    words = highlight_summary_words(text)
    model = os.environ.get('SUMMARY_MODEL', '').strip() or os.environ.get('PODCAST_MODEL', 'claude-sonnet-5').strip()
    system = ('Ringkas teks yang distabilo pembaca menjadi catatan di tepi halaman, dalam BAHASA YANG SAMA dengan teksnya. '
              f'Panjang sekitar {words} kata (jangan lebih pendek dari itu bila isinya cukup). Pertahankan SEMUA poin utama, nama, angka, istilah penting, dan alur gagasannya; '
              'buang pengulangan dan kalimat basa-basi. Setia pada isi: jangan menambah fakta, angka, atau pendapat. '
              'Tulis sebagai PARAGRAF kalimat utuh yang runtut, JANGAN memakai butir/bullet/penomoran, '
              'walaupun teks aslinya berupa daftar (gabungkan poin-poinnya menjadi kalimat). '
              'Tanpa pembuka (jangan tulis "Ringkasan:"), tanpa markdown (tanpa **, #).')
    # Thinking models (Gemini) spend a good part of max_tokens reasoning before they answer.
    reply = ai_chat(system, text, model, max_tokens=4000, temperature=0.2)
    reply = re.sub(r'^\s*(ringkasan|summary|intisari)\s*:\s*', '', reply.replace('**', '').replace('##', ''), flags=re.I).strip()
    # Sentences, not a list: any bullet / numbered lines left are joined into one paragraph.
    parts = [re.sub(r'^\s*(?:[-*•●▪]|\d{1,2}[.)])\s+', '', line).strip() for line in reply.splitlines()]
    parts = [p for p in parts if p]
    reply = ' '.join(p if re.search(r'[.!?…:;]$', p) or i == len(parts) - 1 else p + '.' for i, p in enumerate(parts))
    if not reply:
        raise RuntimeError('AI tidak menghasilkan ringkasan. Coba lagi.')
    if len(reply) > HIGHLIGHT_SUMMARY_MAX:
        # Over the note's room: stop at the last full sentence or line.
        cut = reply[:HIGHLIGHT_SUMMARY_MAX]
        end = max(cut.rfind('. '), cut.rfind('\n'))
        reply = (cut[:end + 1] if end > HIGHLIGHT_SUMMARY_MAX // 2 else cut).strip()
    return reply


def ai_chat(system, user, model, max_tokens=8000, temperature=0.3):
    """One chat completion through Sumopod; returns the reply text."""
    key = os.environ.get('SUMOPOD_API_KEY', '').strip()
    base = os.environ.get('SUMOPOD_BASE_URL', 'https://ai.sumopod.com/v1').strip().rstrip('/')
    if not key:
        raise RuntimeError('AI belum diatur di server (SUMOPOD_API_KEY di .env).')
    body = json.dumps({'model': model, 'max_tokens': max_tokens, 'temperature': temperature, 'messages': [
        {'role': 'system', 'content': system}, {'role': 'user', 'content': user}]}).encode('utf-8')
    request = urllib.request.Request(base + '/chat/completions', data=body, method='POST',
                                     headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            data = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as cause:
        detail = cause.read().decode('utf-8', 'replace')[:300]
        raise RuntimeError(f'Layanan AI menolak permintaan ({cause.code}). {detail}') from cause
    except (urllib.error.URLError, TimeoutError, OSError) as cause:
        raise RuntimeError('Layanan AI tidak bisa dihubungi. Cek koneksi internet server.') from cause
    return ((data.get('choices') or [{}])[0].get('message') or {}).get('content') or ''


def translate_pages(pages, target, title='Buku'):
    """{page: text} -> {page: translation} in the target language (one AI call)."""
    model = os.environ.get('TRANSLATE_MODEL', '').strip() or os.environ.get('PODCAST_MODEL', 'claude-sonnet-5').strip()
    system = (f'Kamu penerjemah buku profesional. Terjemahkan setiap halaman ke {TRANSLATE_LANGUAGES[target]} '
              'secara setia dan enak dibaca. Pertahankan nama orang, nama tempat, merek, istilah teknis yang lazim, angka, '
              'dan pemisah paragraf (baris baru). Jangan menambah, meringkas, atau menjelaskan. '
              'Bila sebuah halaman sudah dalam bahasa tujuan, kembalikan apa adanya. '
              'Jawab HANYA dengan satu objek JSON: kunci = nomor halaman (string, sama dengan masukan), nilai = terjemahannya.')
    user = f'Judul buku: {title}\n\nHalaman (JSON):\n' + json.dumps({str(k): v for k, v in pages.items()}, ensure_ascii=False)
    wanted = {str(k) for k in pages}
    for _ in range(2):
        reply = ai_chat(system, user, model, max_tokens=16000)
        start, end = reply.find('{'), reply.rfind('}')
        try:
            data = json.loads(reply[start:end + 1]) if 0 <= start < end else None
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict):
            out = {str(k): str(v).strip() for k, v in data.items() if str(k) in wanted and isinstance(v, str) and v.strip()}
            if out:
                return out
    raise RuntimeError('AI tidak mengembalikan terjemahan yang valid. Coba lagi.')


# ---------- Podcast script (AI through Sumopod, an OpenAI-compatible gateway).
# .env: SUMOPOD_API_KEY, SUMOPOD_BASE_URL, PODCAST_MODEL. The key stays here.
PODCAST_LANGUAGES = {
    'id-ID': 'Bahasa Indonesia santai tapi sopan (boleh "kita", "nih", "ya")',
    'ms-MY': 'Bahasa Melayu Malaysia yang santai tapi sopan',
    'en-US': 'casual but polite English',
}
PODCAST_MAX_SOURCE = 120_000      # longer books are first turned into notes of all their parts


def podcast_prompt(lang, hosts, title='Buku', notes=False):
    a, b = hosts
    length = ('Panjang sekitar 1000-1200 kata (kira-kira 8 menit bicara).' if notes
              else 'Panjang sekitar 650-750 kata (kira-kira 5 menit bicara).')
    whole = ('\n- Dokumen berupa catatan per bagian dari SELURUH buku. Bahas isinya dari awal sampai akhir secara seimbang '
             '(awal, tengah, dan akhir cerita atau pembahasan), jangan hanya bagian awal.' if notes else '')
    title = ' '.join(str(title).split())[:200] or 'Buku'
    return f"""Kamu penulis naskah podcast untuk buku berjudul "{title}".
Nama podcast ini sama dengan judul bukunya: "{title}".
Tulis naskah obrolan dua penyiar yang membahas dokumen yang diberikan:
- {a.upper()} (perempuan): pemandu, rapi, suka merangkum.
- {b.upper()} (laki-laki): penasaran, suka bertanya dan memberi contoh sehari-hari.
Aturan:
- Bahasa: {PODCAST_LANGUAGES.get(lang, PODCAST_LANGUAGES['id-ID'])}, seperti dua teman ngobrol, bukan membaca slide.
- {length}{whole}
- Kalimat pertama {a.upper()} menyambut pendengar dengan menyebut judul buku persis, misalnya: "Halo, selamat datang di podcast {title}!". Jangan menyebut nama acara lain, "Ngobrol Buku", atau "MyFlipbook".
- Lalu isi (poin-poin penting dengan urutan yang enak diikuti), dan penutup singkat dengan satu kalimat inti; kedua penyiar berpamitan dan menyebut judul buku sekali lagi.
- HANYA gunakan fakta dari dokumen. Jangan mengarang angka, nama, tanggal, atau klaim yang tidak ada, dan jangan menambah tafsiran di luar dokumen.
- Tulis angka, rentang, dan simbol sebagai kata agar enak dibacakan mesin suara (mis. "5-8 detik" -> "lima sampai delapan detik", "&" -> "dan").
- Format keluaran: setiap giliran satu baris, diawali "{a.upper()}:" atau "{b.upper()}:". Tanpa judul, tanpa catatan panggung, tanpa markdown."""


def podcast_script(title, text, lang='id-ID', hosts=('Rina', 'Bima')):
    """Ask the AI for a two-host script; returns dict(lines, hosts, lang, model)."""
    model = os.environ.get('PODCAST_MODEL', 'claude-sonnet-5').strip()
    # A long book is read as notes of all its parts (the notes may use the cheaper summary model).
    long = len(text) > PODCAST_MAX_SOURCE
    if long:
        notes_model = os.environ.get('SUMMARY_MODEL', '').strip() or model
        source = f'Judul: {title}\n\n' + book_notes(title, text, PODCAST_LANGUAGES.get(lang, 'Bahasa Indonesia'), notes_model)
    else:
        source = f'Judul: {title}\n\n{text}'
    last = 'Naskah kosong.'
    for _ in range(2):          # some models now and then answer with nothing but reasoning
        content = ai_chat(podcast_prompt(lang, hosts, title, notes=long), 'Dokumen:\n\n' + source, model, temperature=0.8)
        lines = []
        names = [h.upper() for h in hosts]
        for raw in content.splitlines():
            raw = raw.replace('**', '').replace('__', '')     # markdown bold around a name
            match = re.match(r'\s*([A-Za-z]+)\s*:\s*(.+)', raw)
            if match and match[1].upper() in names:
                lines.append(dict(s='A' if match[1].upper() == names[0] else 'B', t=match[2].strip()))
            elif lines and raw.strip():
                lines[-1]['t'] += ' ' + raw.strip()
        if len(lines) >= 4:
            return dict(lines=lines[:400], hosts=list(hosts), lang=lang, model=model)
        last = 'AI tidak menghasilkan naskah. Coba lagi.'
    raise RuntimeError(last)


def validate_links(links, count):
    """Page links: fractions of the page box plus a target page or a web/mail URL."""
    if not isinstance(links, dict):
        raise ValueError('Tautan tidak valid.')
    unit = lambda v: type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1
    out = {}
    for key, items in links.items():
        if not re.fullmatch(r'0|[1-9][0-9]*', key) or int(key) >= count or not isinstance(items, list):
            raise ValueError('Halaman tautan tidak valid.')
        cleaned = []
        for link in items[:200]:
            if not isinstance(link, dict) or not all(unit(link.get(k)) for k in ('x', 'y', 'w', 'h')):
                raise ValueError('Posisi tautan tidak valid.')
            item = {k: link[k] for k in ('x', 'y', 'w', 'h')}
            page, url = link.get('page'), link.get('url')
            if type(page) is int and 0 <= page < count:
                item['page'] = page
            elif isinstance(url, str) and re.match(r'(?i)(https?://|mailto:)', url) and len(url) <= 500:
                item['url'] = url
            else:
                raise ValueError('Tujuan tautan tidak valid.')
            cleaned.append(item)
        out[key] = cleaned
    return out


def unpack_book(archive, destination):
    """Only read canonical image names; regenerate all executable content.

    The app gets ONE sealed index.html (reader inlined, pages and data
    encrypted, see book_seal.py) instead of loose page images."""
    with zipfile.ZipFile(archive) as package:
        names = package.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Entry ZIP duplikat.')
        if package.getinfo('book.json').file_size > 16 * 1024 * 1024:   # word positions can be large
            raise ValueError('Metadata buku terlalu besar.')
        data = validate_manifest(json.loads(package.read('book.json')))
        total = data['pageCount'] + len(version_images(data))    # originals, then translated editions
        if total > len(names):
            raise ValueError('Gambar halaman tidak lengkap.')
        pages = []
        for index in range(1, total + 1):
            page = package.read(f'pages/{index}.jpg')
            if not page.startswith(b'\xff\xd8\xff'):
                raise ValueError(f'Gambar halaman {index} bukan JPEG.')
            pages.append(page)
    export = ROOT / 'assets/export'
    read = lambda path: path.read_text(encoding='utf-8')
    html = book_seal.single_html(
        read(export / 'index.html'), [read(export / 'viewer.css'), read(export / 'book-effects.css')],
        [read(export / 'book-seal.js'), 'BookSeal.open();', read(ROOT / 'assets/vendor/page-flip.browser.js'),
         read(export / 'layout.js'), read(export / 'viewer.js')],
        book_seal.seal_payload(data, pages), data['title'])
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'index.html').write_text(html, encoding='utf-8')
    return data


WINDOWS_HOW_TO = '''HOW TO OPEN THIS BOOK (Windows)

1. Right-click the ZIP and choose "Extract All".
2. Double-click {exe}.

The book is one file. The first time it opens it unpacks itself (a few
seconds); after that it opens straight away. You can copy {exe} anywhere.

If Windows shows "Windows protected your PC", click "More info" and then "Run anyway".

Requires Microsoft Edge WebView2 Runtime. Most Windows 10/11 PCs already have it;
otherwise get it free from https://developer.microsoft.com/microsoft-edge/webview2/
No internet connection is needed to read the book.
'''

LAUNCHER_MAGIC = b'MFBOOK01'
LAUNCHER_TRAILER = 120


def find_csc():
    """The C# compiler that ships with .NET Framework 4 on every Windows 10/11."""
    windir = os.environ.get('WINDIR', r'C:\Windows')
    for framework in ('Framework64', 'Framework'):
        candidate = Path(windir) / 'Microsoft.NET' / framework / 'v4.0.30319' / 'csc.exe'
        if candidate.is_file():
            return str(candidate)
    return None


def build_launcher(output, log):
    """Compile native/launcher/Launcher.cs into a small Windows program."""
    csc = find_csc()
    if not csc:
        raise RuntimeError('Kompiler .NET (csc.exe) tidak ditemukan.')
    icon = ROOT / 'native/reader/windows/runner/resources/app_icon.ico'
    args = [csc, '-nologo', '-target:winexe', '-optimize+', f'-out:{output}', '-r:System.IO.Compression.dll',
            '-r:System.Windows.Forms.dll', str(ROOT / 'native/launcher/Launcher.cs')]
    if icon.is_file():
        args.insert(4, f'-win32icon:{icon}')
    if run_command(args, ROOT, log) or not Path(output).is_file():
        raise RuntimeError('Pembuka EXE gagal dikompilasi. Unduh log build untuk rinciannya.')
    return Path(output)


def pack_launcher(launcher, release, reader_exe, output):
    """ONE book .exe: the launcher with the whole reader folder appended as
    a ZIP, plus a trailer telling the launcher where it is (Launcher.cs)."""
    payload = Path(output).with_suffix('.payload.zip')
    with zipfile.ZipFile(payload, 'w', zipfile.ZIP_DEFLATED) as package:
        for file in sorted(release.rglob('*')):
            if file.is_file():
                package.write(file, file.relative_to(release).as_posix())
    digest = hashlib.sha256()
    with payload.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    name = reader_exe.encode('utf-8')
    if len(name) > 64:
        raise ValueError('Nama EXE pembaca terlalu panjang.')
    with Path(output).open('wb') as target:
        target.write(Path(launcher).read_bytes())
        offset = target.tell()
        with payload.open('rb') as source:
            shutil.copyfileobj(source, target)
        length = target.tell() - offset
        target.write(LAUNCHER_MAGIC + offset.to_bytes(8, 'little') + length.to_bytes(8, 'little')
                     + digest.hexdigest()[:32].encode('ascii') + name.ljust(64, b'\0'))
    payload.unlink()
    return Path(output)


def android_app_id(title):
    """Readable, stable Android package per book: id.myflipbook.<slug>_<hash>.
    Same title = same package, so a rebuilt book installs as an update."""
    ascii_title = unicodedata.normalize('NFKD', title).encode('ascii', 'ignore').decode().lower()
    slug = re.sub(r'[^a-z0-9]+', '_', ascii_title).strip('_')[:24].strip('_')
    if not slug or not slug[0].isalpha():
        slug = ('book_' + slug).strip('_')
    return f'id.myflipbook.{slug}_{hashlib.sha256(title.encode()).hexdigest()[:6]}'


def exe_name(title):
    """Book title as a Windows file name (without .exe)."""
    name = re.sub(r'[<>:"/\\|?*]', '', app_name(title)).strip(' .')
    if not name or re.fullmatch(r'(?i)(con|prn|aux|nul|com\d|lpt\d)', name):
        return 'MyFlipbook'
    return name


def find_keytool():
    homes = [os.environ.get('JAVA_HOME'), r'C:\Program Files\Android\Android Studio\jbr',
             '/Applications/Android Studio.app/Contents/jbr/Contents/Home']
    for home in filter(None, homes):
        tool = Path(home) / 'bin' / ('keytool.exe' if os.name == 'nt' else 'keytool')
        if tool.is_file():
            return str(tool)
    return shutil.which('keytool')


def android_signing():
    """MyFlipbook's own release key: made once, kept in .data/ (never in Git),
    the same for every build so reinstalling a book updates it. Returns the
    Gradle environment, or None (debug key) when keytool is unavailable."""
    info = None
    if ANDROID_SIGNING.is_file():
        info = json.loads(ANDROID_SIGNING.read_text(encoding='utf-8'))
        if not Path(info['store']).is_file():
            info = None
    if not info:
        keytool = find_keytool()
        if not keytool:
            return None
        DATA.mkdir(exist_ok=True)
        store = DATA / 'android-release.jks'
        if store.exists():  # never overwrite a key: apps signed with it could no longer be updated
            store = DATA / f'android-release-{int(time.time())}.jks'
        info = {'store': str(store), 'password': secrets.token_urlsafe(24), 'alias': 'myflipbook'}
        env = dict(os.environ, MYFLIPBOOK_KEY_PASSWORD=info['password'])
        subprocess.run([keytool, '-genkeypair', '-keystore', str(store), '-storetype', 'PKCS12',
                        '-storepass:env', 'MYFLIPBOOK_KEY_PASSWORD', '-keypass:env', 'MYFLIPBOOK_KEY_PASSWORD',
                        '-alias', info['alias'], '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
                        '-dname', 'CN=MyFlipbook, O=MyFlipbook, C=ID'],
                       env=env, check=True, capture_output=True, timeout=120,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        ANDROID_SIGNING.write_text(json.dumps(info), encoding='utf-8')
    return {'MYFLIPBOOK_KEYSTORE': info['store'], 'MYFLIPBOOK_KEY_PASSWORD': info['password'],
            'MYFLIPBOOK_KEY_ALIAS': info['alias']}


def app_name(title):
    """Book title as a safe app name: printable, no leading @/? (Android
    resource syntax), max 50 chars, never empty."""
    name = re.sub(r'\s+', ' ', ''.join(ch for ch in title if ch.isprintable())).strip().lstrip('@?').strip()
    return name[:50].strip() or 'MyFlipbook'


def xml_attr(text):
    return (text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .replace('"', '&quot;').replace("'", "\\'"))  # aapt needs \' for apostrophes


def wide_literal(text):
    """C++ L"..." body: ASCII kept, everything else as universal character names."""
    out = []
    for ch in text:
        if ch in '\\"':
            out.append('\\' + ch)
        elif 32 <= ord(ch) < 127:
            out.append(ch)
        else:
            out.append(f'\\U{ord(ch):08X}')
    return ''.join(out)


def brand_native(workspace, title):
    """Show the book title as the Android launcher label, Windows window title
    and Windows file details."""
    name = app_name(title)
    manifest = workspace / 'android/app/src/main/AndroidManifest.xml'
    manifest.write_text(re.sub(r'android:label="[^"]*"', lambda _: f'android:label="{xml_attr(name)}"',
                               manifest.read_text(encoding='utf-8'), count=1), encoding='utf-8')
    runner = workspace / 'windows/runner/main.cpp'
    runner.write_text(runner.read_text(encoding='utf-8').replace('window.Create(L"sarvamaya_book"',
                                                                 f'window.Create(L"{wide_literal(name)}"'), encoding='utf-8')
    resource = workspace / 'windows/runner/Runner.rc'
    if resource.is_file():
        quoted = name.replace('"', '""')
        text = resource.read_text(encoding='utf-8')
        for key, value in (('CompanyName', 'MyFlipbook'), ('FileDescription', quoted), ('InternalName', quoted),
                           ('ProductName', quoted), ('OriginalFilename', exe_name(title).replace('"', '""') + '.exe'),
                           ('LegalCopyright', 'Made with MyFlipbook')):
            text = re.sub(r'(VALUE "' + key + r'", )"[^"]*(?:""[^"]*)*"', lambda m: m[1] + '"' + value.replace('\\', '\\\\') + '"', text, count=1)
        resource.write_text(text, encoding='utf-8')
    return name


def plugin_junctions(workspace):
    """Windows directory junctions avoid requiring a global Developer Mode change."""
    manifest = workspace / '.flutter-plugins-dependencies'
    if os.name != 'nt' or not manifest.exists():
        return
    plugins = json.loads(manifest.read_text())['plugins'].get('windows', [])
    for plugin in plugins:
        name = plugin['name']
        if not re.fullmatch(r'[a-z0-9_]+', name):
            raise ValueError('Nama plugin tidak valid.')
        target = Path(plugin['path']).resolve()
        link = workspace / 'windows/flutter/ephemeral/.plugin_symlinks' / name
        if link.exists():
            continue
        link.parent.mkdir(parents=True, exist_ok=True)
        env = dict(os.environ, PDF_LINK_PATH=str(link), PDF_LINK_TARGET=str(target))
        subprocess.run(['powershell', '-NoProfile', '-Command',
                        'New-Item -ItemType Junction -Path $env:PDF_LINK_PATH -Target $env:PDF_LINK_TARGET -ErrorAction Stop | Out-Null'],
                       env=env, check=True, creationflags=subprocess.CREATE_NO_WINDOW)


def run_command(args, cwd, log, extra_env=None):
    env = dict(os.environ, CI='true', **(extra_env or {}))
    with log.open('ab') as output:
        result = subprocess.run(args, cwd=cwd, stdout=output, stderr=subprocess.STDOUT,
                                env=env, timeout=3600, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    return result.returncode


OFFICE_MIMES = {
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-excel': '.xls',
    'text/csv': '.csv',
}
OFFICE_ROUTES = {
    '/api/convert/pptx-to-pdf': {'.pptx', '.ppt'},
    '/api/convert/word-to-pdf': {'.docx', '.doc'},
    '/api/convert/excel-to-pdf': {'.xlsx', '.xls', '.csv'},
}
OFFICE_ROUTES['/api/convert/html-to-pdf'] = {'.html', '.htm'}
HTML_MAX_BYTES = 20 * 1024 * 1024
HTML_PAGE_SIZES = {'a4': 'A4', 'letter': 'letter', 'a3': 'A3', 'legal': 'legal'}


def find_chromium():
    """Locate Edge/Chrome/Chromium for HTML to PDF (print engine)."""
    override = os.environ.get('MYFLIPBOOK_CHROME')
    if override and Path(override).is_file():
        return override
    for name in ('msedge', 'chrome', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'):
        found = shutil.which(name)
        if found:
            return found
    if os.name == 'nt':
        for base in (os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)'),
                     os.environ.get('ProgramFiles', r'C:\Program Files'),
                     os.environ.get('LOCALAPPDATA', '')):
            for relative in ('Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe'):
                candidate = Path(base) / relative
                if base and candidate.is_file():
                    return str(candidate)
    return None


def prepare_html(raw, page_size='a4', margin_mm=12):
    """Add default print settings (paper, margin, background colours) in
    front of the document's own CSS, so its own @page rules still win."""
    size = HTML_PAGE_SIZES.get(page_size, 'A4')
    margin = max(0, min(40, float(margin_mm)))
    style = (f'<style>@page{{size:{size};margin:{margin:g}mm}}'
             'html{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>').encode()
    match = re.search(rb'<head\b[^>]*>', raw[:65536], re.I)
    if match:
        return raw[:match.end()] + style + raw[match.end():]
    return b'<meta charset="utf-8">' + style + raw if not re.search(rb'<meta[^>]+charset', raw[:4096], re.I) else style + raw


def html_to_pdf(raw, page_size='a4', margin_mm=12, allow_network=True, timeout=90):
    """Print an HTML document to PDF with headless Edge/Chrome.

    The page is served from a one-shot loopback server with a strict CSP, so
    it can never read files on this computer. allow_network=False (public
    hosting): no scripts and every other address goes to a dead proxy, so an
    uploaded page cannot reach the internet or the server's network.
    """
    browser = find_chromium()
    if not browser:
        raise RuntimeError('Microsoft Edge / Google Chrome tidak ditemukan di komputer ini.')
    if not raw.strip():
        raise ValueError('File HTML kosong.')
    body = prepare_html(raw, page_size, margin_mm)
    remote = 'http: https: ' if allow_network else ''
    csp = (f"default-src 'none'; style-src 'unsafe-inline' data: {remote}; img-src data: blob: {remote}; "
           f"font-src data: {remote}; media-src data: {remote}; "
           + ("script-src 'unsafe-inline'" if allow_network else "script-src 'none'"))

    class Page(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.split('?')[0] != '/':
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Security-Policy', csp)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = HTTPServer(('127.0.0.1', 0), Page)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    workdir = Path(tempfile.mkdtemp(prefix='html-pdf-'))
    output = workdir / 'out.pdf'
    args = [browser, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
            '--disable-extensions', '--disable-sync', '--disable-background-networking', '--mute-audio',
            f'--user-data-dir={workdir / "profile"}', '--no-pdf-header-footer', '--virtual-time-budget=8000',
            f'--print-to-pdf={output}']
    if not allow_network:
        # Scripts are off through the CSP (script-src 'none'); the
        # --blink-settings switch would also stop the print engine itself.
        args += ['--proxy-server=http://127.0.0.1:9',
                 f'--proxy-bypass-list=<-loopback>;127.0.0.1:{port}']
    args.append(f'http://127.0.0.1:{port}/')
    process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            raise RuntimeError('Halaman HTML terlalu lama dicetak (lebih dari 90 detik).')
        data = output.read_bytes() if output.is_file() else b''
        if not data.startswith(b'%PDF-'):
            raise RuntimeError('Browser gagal mencetak HTML ini ke PDF.')
        return data
    finally:
        if process.poll() is None:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(process.pid)], capture_output=True,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            else:
                process.kill()
        server.shutdown()
        server.server_close()
        shutil.rmtree(workdir, ignore_errors=True)


def print_url_to_pdf(url, timeout=90):
    """Print a web page (already checked by fetch_source) with headless
    Edge/Chrome, like Print -> Save as PDF."""
    browser = find_chromium()
    if not browser:
        raise RuntimeError('Microsoft Edge / Google Chrome tidak ditemukan di komputer ini.')
    workdir = Path(tempfile.mkdtemp(prefix='url-pdf-'))
    output = workdir / 'out.pdf'
    args = [browser, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
            '--disable-extensions', '--disable-sync', '--mute-audio', f'--user-data-dir={workdir / "profile"}',
            '--no-pdf-header-footer', '--virtual-time-budget=10000', f'--print-to-pdf={output}', url]
    process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            raise RuntimeError('Halaman web terlalu lama dimuat (lebih dari 90 detik).')
        data = output.read_bytes() if output.is_file() else b''
        if not data.startswith(b'%PDF-'):
            raise RuntimeError('Halaman web ini gagal dicetak ke PDF.')
        return data
    finally:
        if process.poll() is None:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(process.pid)], capture_output=True,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            else:
                process.kill()
        shutil.rmtree(workdir, ignore_errors=True)


FETCH_MAX_BYTES = 60 * 1024 * 1024
FETCH_TYPES = {'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
               'image/gif': '.gif', 'text/csv': '.csv'}
FETCH_TYPES.update(OFFICE_MIMES)


def google_drive_url(url):
    """Direct download link for a Google Drive / Docs / Sheets / Slides share
    link (Docs formats export as PDF), or None for other links."""
    parts = urlsplit(url)
    host = (parts.hostname or '').lower()
    match = re.search(r'/d/([A-Za-z0-9_-]{10,})', parts.path)
    file_id = match[1] if match else (parse_qs(parts.query).get('id') or [None])[0]
    if not file_id or not re.fullmatch(r'[A-Za-z0-9_-]{10,}', file_id):
        return None
    if host == 'docs.google.com':
        if parts.path.startswith('/document/'):
            return f'https://docs.google.com/document/d/{file_id}/export?format=pdf'
        if parts.path.startswith('/spreadsheets/'):
            return f'https://docs.google.com/spreadsheets/d/{file_id}/export?format=pdf'
        if parts.path.startswith('/presentation/'):
            return f'https://docs.google.com/presentation/d/{file_id}/export/pdf'
        return None
    if host in ('drive.google.com', 'drive.usercontent.google.com'):
        return f'https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t'
    return None


def check_public_host(host):
    """Hosting mode: only addresses on the public internet (no loopback,
    private network, link-local or metadata addresses)."""
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(host, None)}
    except OSError:
        raise ValueError('Alamat link tidak ditemukan.')
    for address in addresses:
        if not ipaddress.ip_address(address.split('%')[0]).is_global:
            raise ValueError('Link ke alamat jaringan internal tidak diizinkan.')


def page_name(url):
    parts = urlsplit(url)
    stem = Path(unquote(parts.path)).stem or parts.hostname or 'page'
    return re.sub(r'[^A-Za-z0-9._ -]+', '-', stem).strip(' .-')[:80] or 'page'


# ---------- Journal search (like SINTA: a list of articles with links), from
# OpenAlex — an open index of scholarly works, Indonesian journals with a DOI
# included. Free without a key for light use; OPENALEX_API_KEY / OPENALEX_MAILTO
# in .env for more. Results are cached for a while (each search has a cost).
JOURNAL_CACHE = {}
JOURNAL_CACHE_SECONDS = 1800
JOURNAL_SORTS = {'relevance': None, 'cited': 'cited_by_count:desc', 'newest': 'publication_date:desc'}


def abstract_text(inverted, limit=700):
    """OpenAlex keeps abstracts as {word: [positions]}; back to text."""
    if not isinstance(inverted, dict):
        return ''
    words = sorted((pos, word) for word, positions in inverted.items() for pos in positions)
    text = ' '.join(word for _, word in words)
    return text if len(text) <= limit else text[:limit].rsplit(' ', 1)[0] + '…'


def journal_search(query, page=1, oa=True, year_from=None, year_to=None, lang=None, indonesia=False, sort='relevance'):
    """Articles for a query: dict(total, page, results=[...])."""
    filters = ['type:article|review']
    if oa:
        filters.append('is_oa:true')
    if year_from or year_to:
        filters.append(f'publication_year:{year_from or ""}-{year_to or ""}')
    if lang in ('id', 'en', 'ms'):
        filters.append(f'language:{lang}')
    if indonesia:
        filters.append('institutions.country_code:id')
    # Title and abstract only (full texts drift to loosely related papers), and
    # exact words: a stemmed "immersive" also finds "immersed"/"immersion" (physics, chemistry).
    filters.append('title_and_abstract.search.exact:' + query.replace(',', ' '))
    params = {'filter': ','.join(filters), 'per-page': 20, 'page': page,
              'select': 'id,display_name,publication_year,doi,cited_by_count,language,authorships,primary_location,'
                        'best_oa_location,open_access,abstract_inverted_index'}
    if JOURNAL_SORTS.get(sort):
        params['sort'] = JOURNAL_SORTS[sort]
    if os.environ.get('OPENALEX_API_KEY'):
        params['api_key'] = os.environ['OPENALEX_API_KEY'].strip()
    if os.environ.get('OPENALEX_MAILTO'):
        params['mailto'] = os.environ['OPENALEX_MAILTO'].strip()
    key = json.dumps(params, sort_keys=True)
    hit = JOURNAL_CACHE.get(key)
    if hit and time.time() - hit[0] < JOURNAL_CACHE_SECONDS:
        return hit[1]
    url = 'https://api.openalex.org/works?' + urlencode(params)
    request = urllib.request.Request(url, headers={'User-Agent': 'MyFlipbook/1.0 (journal search)'})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            data = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as cause:
        if cause.code == 429:
            raise RuntimeError('Batas pencarian harian tercapai. Coba lagi besok, atau pasang OPENALEX_API_KEY di server.') from cause
        raise RuntimeError(f'Layanan pencarian menolak permintaan ({cause.code}).') from cause
    except (urllib.error.URLError, TimeoutError, OSError) as cause:
        raise RuntimeError('Layanan pencarian tidak bisa dihubungi. Cek koneksi internet server.') from cause
    results = []
    for work in data.get('results') or []:
        primary = work.get('primary_location') or {}
        source = primary.get('source') or {}
        best = work.get('best_oa_location') or {}
        doi = work.get('doi') or ''
        pdf = best.get('pdf_url') or ''
        names = list(dict.fromkeys(n for n in ((x.get('author') or {}).get('display_name') for x in work.get('authorships') or []) if n))   # OpenAlex repeats some
        results.append(dict(
            id=str(work.get('id', '')).rsplit('/', 1)[-1],
            title=' '.join(str(work.get('display_name') or 'Tanpa judul').split()),
            authors=names[:8],
            moreAuthors=max(0, len(names) - 8),
            journal=source.get('display_name') or '',
            publisher=source.get('host_organization_name') or '',
            year=work.get('publication_year'),
            cited=work.get('cited_by_count') or 0,
            language=work.get('language') or '',
            doi=doi,
            link=best.get('landing_page_url') or primary.get('landing_page_url') or doi,
            pdf=pdf if pdf.startswith(('http://', 'https://')) else '',
            oa=bool((work.get('open_access') or {}).get('is_oa')),
            license=best.get('license') or '',
            abstract=abstract_text(work.get('abstract_inverted_index')),
        ))
    out = dict(total=(data.get('meta') or {}).get('count') or 0, page=page, results=results)
    if len(JOURNAL_CACHE) > 300:
        JOURNAL_CACHE.clear()
    JOURNAL_CACHE[key] = (time.time(), out)
    return out


# ---------- Ebook search: free, legal full books with a PDF.
# OAPEN Library — peer-reviewed open-access books, licence checked by OAPEN.
# Internet Archive — texts its uploader released under a licence (CC / public
# domain), lending-only items excluded; the licence is the uploader's claim.
EBOOK_PER_SOURCE = 10
EBOOK_LANGS = {'id': ('Indonesian', 'ind'), 'en': ('English', 'eng'), 'ms': ('Malay', 'may')}
IA_LANGS = {'ind': 'id', 'indonesian': 'id', 'eng': 'en', 'english': 'en', 'may': 'ms', 'msa': 'ms', 'malay': 'ms', 'jav': 'jv', 'javanese': 'jv', 'sun': 'su', 'sundanese': 'su'}


def ebook_terms(query):
    """Plain search words: no field/boolean syntax reaches the source's query parser."""
    return ' '.join(re.sub(r"[^\w\s'-]", ' ', query, flags=re.UNICODE).split())[:200]


def abstract_cut(text, limit=700):
    text = ' '.join(str(text or '').split())
    return text if len(text) <= limit else text[:limit].rsplit(' ', 1)[0] + '…'


def ebook_get(url, what):
    request = urllib.request.Request(url, headers={'User-Agent': 'MyFlipbook/1.0 (ebook search)', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as cause:
        raise RuntimeError(f'{what} menolak permintaan ({cause.code}).') from cause
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as cause:
        raise RuntimeError(f'{what} tidak bisa dihubungi.') from cause


OAPEN_HANDLE = re.compile(r'20\.500\.12657/\d{1,9}')
ARCHIVE_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,120}')


def oapen_books(terms, page, lang):
    # Metadata only: listing each book's files makes OAPEN ~10x slower, so the
    # PDF link is looked up when the reader asks for it (ebook_pdf).
    params = {'query': f'{terms} AND dc.type:book', 'expand': 'metadata', 'limit': EBOOK_PER_SOURCE,
              'offset': (page - 1) * EBOOK_PER_SOURCE}
    items = ebook_get('https://library.oapen.org/rest/search?' + urlencode(params), 'OAPEN')
    items = items if isinstance(items, list) else []
    books = []
    for item in items:
        meta = {}
        for field in item.get('metadata') or []:
            meta.setdefault(field.get('key'), []).append(str(field.get('value') or '').strip())
        one = lambda key: (meta.get(key) or [''])[0]
        handle = str(item.get('handle') or '')
        if not one('dc.title') or not OAPEN_HANDLE.fullmatch(handle):
            continue
        language = one('dc.language')
        code = next((k for k, v in EBOOK_LANGS.items() if v[0] == language), language)
        if lang in EBOOK_LANGS and code != lang:       # OAPEN's search ignores a language field
            continue
        title = one('dc.title') + (': ' + one('dc.title.alternative') if one('dc.title.alternative') else '')
        books.append(dict(
            source='oapen', id=handle, title=' '.join(title.split()),
            authors=(meta.get('dc.contributor.author') or meta.get('dc.contributor.editor') or [])[:6],
            year=one('dc.date.issued')[:4], language=code, publisher=one('publisher.name'),
            license=one('dc.rights.uri') or one('dc.rights') or 'Open access', licenseByUploader=False,
            abstract=abstract_cut(one('dc.description.abstract').strip(' "')),
            link=f'https://library.oapen.org/handle/{handle}', cover='', pages=one('oapen.pages')))
    return books, len(items) >= EBOOK_PER_SOURCE


def archive_books(terms, page, lang):
    query = (f'({terms}) AND mediatype:texts AND licenseurl:* AND NOT access-restricted-item:true '
             'AND format:("Text PDF" OR PDF OR "Additional Text PDF")')
    if lang in EBOOK_LANGS:
        query += f' AND language:({EBOOK_LANGS[lang][1]} OR {EBOOK_LANGS[lang][0]})'
    params = [('q', query), ('rows', EBOOK_PER_SOURCE), ('page', page), ('output', 'json')]
    params += [('fl[]', f) for f in ('identifier', 'title', 'creator', 'year', 'date', 'language', 'licenseurl', 'description', 'publisher')]
    data = ebook_get('https://archive.org/advancedsearch.php?' + urlencode(params), 'Internet Archive').get('response') or {}
    listed = lambda v: v if isinstance(v, list) else [v] if v else []
    books = []
    for doc in data.get('docs') or []:
        identifier = str(doc.get('identifier') or '')
        if not ARCHIVE_ID.fullmatch(identifier):
            continue
        languages = [str(x) for x in listed(doc.get('language'))]
        language = next((IA_LANGS[x.lower()] for x in languages if x.lower() in IA_LANGS), (languages or [''])[0])
        description = re.sub(r'<[^>]+>', ' ', ' '.join(map(str, listed(doc.get('description')))))
        books.append(dict(
            source='archive', id=identifier, title=' '.join(str(doc.get('title') or 'Tanpa judul').split()),
            authors=[str(a) for a in listed(doc.get('creator'))][:6],
            year=str(doc.get('year') or doc.get('date') or '')[:4], language=language,
            publisher=', '.join(map(str, listed(doc.get('publisher'))))[:120], license=str(doc.get('licenseurl') or ''),
            licenseByUploader=True, abstract=abstract_cut(description),
            link=f'https://archive.org/details/{identifier}', cover=f'https://archive.org/services/img/{identifier}', pages=''))
    return books, page * EBOOK_PER_SOURCE < (data.get('numFound') or 0)


def ebook_pdf(source, identifier):
    """{pdf, size} of one search result's book, looked up when it's opened."""
    if source == 'oapen' and OAPEN_HANDLE.fullmatch(identifier or ''):
        item = ebook_get(f'https://library.oapen.org/rest/handle/{identifier}?expand=bitstreams', 'OAPEN')
        streams = item.get('bitstreams') or [] if isinstance(item, dict) else []
        pdf = next((s for s in streams if s.get('mimeType') == 'application/pdf' and s.get('bundleName') == 'ORIGINAL'), None)
        if pdf and str(pdf.get('retrieveLink', '')).startswith('/rest/bitstreams/'):
            return dict(pdf='https://library.oapen.org' + pdf['retrieveLink'], size=int(pdf.get('sizeBytes') or 0))
    elif source == 'archive' and ARCHIVE_ID.fullmatch(identifier or ''):
        files = ebook_get(f'https://archive.org/metadata/{identifier}/files', 'Internet Archive').get('result') or []
        rank = {'Text PDF': 0, 'Additional Text PDF': 1, 'Image Container PDF': 2}
        pdfs = sorted((f for f in files if str(f.get('name', '')).lower().endswith('.pdf')),
                      key=lambda f: (rank.get(f.get('format'), 3), f.get('source') != 'original'))
        if pdfs:
            return dict(pdf=f"https://archive.org/download/{identifier}/{quote(pdfs[0]['name'])}", size=int(pdfs[0].get('size') or 0))
    else:
        raise ValueError('Buku tidak dikenal.')
    return dict(pdf='', size=0)


def ebook_search(query, page=1, lang=None, source='all'):
    """Books with a PDF: dict(page, more, results=[...], errors=[...]). Sources
    run side by side; one source failing still returns the other's books."""
    terms = ebook_terms(query)
    if len(terms) < 2:
        raise RuntimeError('Tulis kata kunci 2-200 karakter.')
    key = json.dumps(['ebook', terms.lower(), page, lang, source])
    hit = JOURNAL_CACHE.get(key)
    if hit and time.time() - hit[0] < JOURNAL_CACHE_SECONDS:
        return hit[1]
    wanted = [fn for name, fn in (('oapen', oapen_books), ('archive', archive_books)) if source in ('all', name)]
    lists, more, errors = [], False, []
    with ThreadPoolExecutor(max_workers=2) as pool:
        for job in [pool.submit(fn, terms, page, lang) for fn in wanted]:
            try:
                books, has_more = job.result()
                lists.append(books)
                more = more or has_more
            except RuntimeError as cause:
                errors.append(str(cause))
    if not lists:
        raise RuntimeError(' '.join(errors))
    results = []
    for i in range(max(map(len, lists))):          # alternate sources
        results.extend(books[i] for books in lists if i < len(books))
    out = dict(page=page, more=more, results=results, errors=errors, maxBytes=FETCH_MAX_BYTES)
    if not errors:
        if len(JOURNAL_CACHE) > 300:
            JOURNAL_CACHE.clear()
        JOURNAL_CACHE[key] = (time.time(), out)
    return out


# ---------- Email (verification links). SMTP from .env, e.g. Gmail:
# SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_USER=…@gmail.com SMTP_PASS=<app password>
# MAIL_FROM=…@gmail.com MAIL_FROM_NAME=MyFlipbook. Without SMTP the message is
# written to .data/outbox/ (and the console) so a local run still works.
def send_mail(to, subject, text, html=None):
    """'sent' through SMTP, or 'outbox' when SMTP isn't configured."""
    import smtplib
    from email.message import EmailMessage
    from email.utils import formataddr
    sender = os.environ.get('MAIL_FROM', '').strip() or os.environ.get('SMTP_USER', '').strip() or 'no-reply@myflipbook.local'
    message = EmailMessage()
    message['From'] = formataddr((os.environ.get('MAIL_FROM_NAME', 'MyFlipbook').strip() or 'MyFlipbook', sender))
    message['To'] = to
    message['Subject'] = subject
    message.set_content(text)
    if html:
        message.add_alternative(html, subtype='html')
    host = os.environ.get('SMTP_HOST', '').strip()
    if not host:
        outbox = DATA / 'outbox'
        outbox.mkdir(parents=True, exist_ok=True)
        (outbox / f'{int(time.time())}-{re.sub(r"[^A-Za-z0-9@._-]", "_", to)}.eml').write_bytes(bytes(message))
        print(f'[mail] SMTP belum diatur; email untuk {to} disimpan di .data/outbox/\n{text}', flush=True)
        return 'outbox'
    port = int(os.environ.get('SMTP_PORT', '587') or 587)
    user, password = os.environ.get('SMTP_USER', '').strip(), os.environ.get('SMTP_PASS', '').strip()
    try:
        if port == 465:
            server = smtplib.SMTP_SSL(host, port, timeout=30)
        else:
            server = smtplib.SMTP(host, port, timeout=30)
            server.starttls()
        with server:
            if user:
                server.login(user, password)
            server.send_message(message)
    except (smtplib.SMTPException, OSError) as cause:
        raise RuntimeError(f'Email gagal dikirim: {cause}') from cause
    return 'sent'


def verification_mail(to, name, link):
    hello = f'Halo {name},' if name else 'Halo,'
    text = (f'{hello}\n\nTerima kasih sudah mendaftar di MyFlipbook. Klik link ini untuk memverifikasi email dan masuk:\n\n'
            f'{link}\n\nLink berlaku 48 jam. Abaikan email ini bila kamu tidak mendaftar.\n\n— MyFlipbook')
    html = (f'<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#1c1917">'
            f'<p>{hello}</p><p>Terima kasih sudah mendaftar di <b>MyFlipbook</b>. Klik tombol ini untuk memverifikasi email dan masuk:</p>'
            f'<p style="text-align:center;margin:28px 0"><a href="{link}" style="background:#1a3c34;color:#fff;padding:12px 22px;'
            f'border-radius:999px;text-decoration:none;font-weight:bold">Verifikasi email</a></p>'
            f'<p style="font-size:12px;color:#78716c">Atau buka link ini: {link}<br>Link berlaku 48 jam. Abaikan email ini bila kamu tidak mendaftar.</p>'
            f'<p>— MyFlipbook</p></div>')
    return send_mail(to, 'Verifikasi email MyFlipbook', text, html)


# ---------- Sign in with Google: the browser gets an ID token from Google
# Identity Services; the server checks it with Google before trusting it.
def drive_picker_config():
    """Google Picker settings for "Add source → Google Drive", or None.
    GOOGLE_CLIENT_ID (same OAuth client as sign-in) + GOOGLE_API_KEY (browser key,
    Picker API, restricted by referrer). The app id is the Cloud project number —
    the client id's numeric prefix — unless GOOGLE_APP_ID says otherwise."""
    client_id = os.environ.get('GOOGLE_CLIENT_ID', '').strip()
    api_key = os.environ.get('GOOGLE_API_KEY', '').strip()
    if not client_id or not api_key:
        return None
    app_id = os.environ.get('GOOGLE_APP_ID', '').strip() or client_id.split('-', 1)[0]
    return dict(clientId=client_id, apiKey=api_key, appId=app_id if app_id.isdigit() else '')


def google_claims(credential):
    """Verified claims of a Google ID token for our client id."""
    client_id = os.environ.get('GOOGLE_CLIENT_ID', '').strip()
    if not client_id:
        raise accounts.AccountError(503, 'Login Google belum diatur di server (GOOGLE_CLIENT_ID).')
    if not isinstance(credential, str) or not 20 < len(credential) < 5000:
        raise accounts.AccountError(400, 'Token Google tidak valid.')
    url = 'https://oauth2.googleapis.com/tokeninfo?' + urlencode({'id_token': credential})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'MyFlipbook/1.0'}), timeout=15) as response:
            claims = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError:
        raise accounts.AccountError(401, 'Login Google ditolak. Coba lagi.')
    except (urllib.error.URLError, TimeoutError, OSError):
        raise accounts.AccountError(502, 'Google tidak bisa dihubungi. Cek koneksi internet server.')
    if (claims.get('aud') != client_id or claims.get('iss') not in ('accounts.google.com', 'https://accounts.google.com')
            or int(claims.get('exp') or 0) < time.time() or str(claims.get('email_verified')).lower() != 'true'):
        raise accounts.AccountError(401, 'Login Google ditolak (token bukan untuk aplikasi ini atau email belum diverifikasi Google).')
    return claims


def fetch_source(url, public_only=False):
    """Download a document from a link for the flipbook: a PDF, Office file
    or image as it is, a Google Drive/Docs share link through its download
    link, and an ordinary web page printed to PDF.
    Returns (bytes, filename, content_type)."""
    url = (url or '').strip()
    parts = urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname or len(url) > 2000:
        raise ValueError('Tempel link yang diawali http:// atau https://.')
    drive = google_drive_url(url)
    target = drive or url

    class Checked(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            nxt = urlsplit(newurl)
            if nxt.scheme not in ('http', 'https'):
                raise ValueError('Link mengarah ke alamat yang tidak didukung.')
            if public_only:
                check_public_host(nxt.hostname or '')
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    if public_only:
        check_public_host(urlsplit(target).hostname)
    opener = urllib.request.build_opener(Checked)
    request = urllib.request.Request(target, headers={'User-Agent': 'Mozilla/5.0 (MyFlipbook)'})
    private = 'File Google Drive ini belum dibagikan publik. Ubah aksesnya menjadi "Siapa saja yang memiliki link".'
    try:
        with opener.open(request, timeout=30) as response:
            ctype = response.headers.get_content_type()
            data = response.read(FETCH_MAX_BYTES + 1)
            disposition = response.headers.get('Content-Disposition', '')
            final = response.geturl()
    except urllib.error.HTTPError as cause:
        if drive and cause.code in (401, 403, 404):
            raise ValueError(private)
        raise ValueError(f'Link tidak bisa dibuka (HTTP {cause.code}).')
    except (urllib.error.URLError, OSError) as cause:
        raise ValueError('Link tidak bisa dibuka: ' + str(getattr(cause, 'reason', cause)))
    if len(data) > FETCH_MAX_BYTES:
        raise ValueError('File dari link terlalu besar (maksimal 60 MB).')
    if data.startswith(b'%PDF-'):
        ctype = 'application/pdf'
    if ctype in ('text/html', 'application/xhtml+xml'):
        if drive:
            raise ValueError(private)
        # An ordinary web page: print it the way a browser would.
        return print_url_to_pdf(url), page_name(url) + '.pdf', 'application/pdf'
    name = ''
    match = re.search(r"filename\*=UTF-8''([^;]+)", disposition, re.I) or re.search(r'filename="?([^";]+)"?', disposition, re.I)
    if match:
        name = unquote(match[1])
    if not name:
        name = unquote(Path(urlsplit(final).path).name) or page_name(url)
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', '_', name).strip(' .')[:120] or 'document'
    ext = FETCH_TYPES.get(ctype)
    if ext and not name.lower().endswith(ext):
        name = Path(name).stem + ext
    return data, name, ctype


OFFICE_INSTALL_HINT = ('LibreOffice (soffice) tidak ditemukan di komputer ini. '
                       'Pasang dari https://libreoffice.org/download, lalu restart server.')


def find_soffice():
    """Locate LibreOffice, including default Windows install folders.

    The Windows installer does not add soffice to PATH, so check the
    well-known locations as a fallback.
    """
    found = shutil.which('soffice') or shutil.which('soffice.bin')
    if found:
        return found
    if os.name == 'nt':
        for base in (os.environ.get('ProgramFiles', r'C:\Program Files'),
                     os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')):
            candidate = Path(base) / 'LibreOffice/program/soffice.exe'
            if candidate.is_file():
                return str(candidate)
    return None


def safe_office_name(raw, default='document.pptx'):
    name = re.sub(r'[^A-Za-z0-9._-]', '_', unquote(raw or ''))
    extension = Path(name).suffix.lower()
    if extension not in OFFICE_MIMES.values():
        return default
    return (Path(name).stem[:90].strip('.') or 'document') + extension


def office_to_pdf(source, filename):
    """Convert an Office document at source path via local LibreOffice.

    Returns (pdf_bytes, download_name). Raises ValueError for bad input and
    RuntimeError when LibreOffice is missing or conversion fails.
    """
    name = safe_office_name(filename)
    ext = Path(name).suffix.lower()
    with source.open('rb') as stream:
        magic = stream.read(4)
    if ext in {'.pptx', '.docx', '.xlsx'} and magic[:2] != b'PK':
        raise ValueError('File Office tidak valid (arsip ZIP tidak terbaca).')
    if ext in {'.ppt', '.doc', '.xls'} and magic != b'\xd0\xcf\x11\xe0':
        raise ValueError('File Office lama tidak valid.')
    soffice = find_soffice()
    if not soffice:
        raise RuntimeError(OFFICE_INSTALL_HINT)
    with tempfile.TemporaryDirectory(prefix='office-convert-') as temporary:
        output = Path(temporary) / (Path(name).stem + '.pdf')
        # Each conversion has its own profile, independent of open desktop sessions.
        profile = (Path(temporary) / 'profile').as_uri()
        command = [soffice, '-env:UserInstallation=' + profile, '--headless']
        if ext == '.csv':
            # Sniff a sample only; LibreOffice imports the entire file.
            with source.open('r', encoding='utf-8-sig', errors='replace') as stream:
                sample = stream.read(65536)
            try:
                delimiter = csv.Sniffer().sniff(sample, delimiters=',;\t|').delimiter
            except csv.Error:
                delimiter = ','
            # https://help.libreoffice.org/latest/en-GB/text/shared/guide/csv_params.html
            # UTF-8; do not evaluate CSV fields as formulas.
            command += [f'--infilter=Text - txt - csv (StarCalc):{ord(delimiter)},34,76,1,,0,false,true,false,false,false,0,false']
        command += ['--convert-to', 'pdf', '--outdir', temporary, str(source)]
        try:
            completed = subprocess.run(
                command,
                capture_output=True, timeout=240,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except subprocess.TimeoutExpired:
            raise RuntimeError('Konversi kehabisan waktu (file terlalu besar/rumit?).')
        if completed.returncode or not output.is_file():
            raise RuntimeError('LibreOffice gagal mengonversi file ini.')
        result = output.read_bytes()
        if not result.startswith(b'%PDF-'):
            raise RuntimeError('LibreOffice tidak menghasilkan PDF yang valid.')
        return result, output.name


BUILD_KEEP_SECONDS = 7 * 24 * 3600


def prune_builds(now=None):
    """Delete finished build folders (uploaded book + APK/EXE) older than 7 days,
    as the privacy policy says. Running builds are never touched."""
    now = now or time.time()
    removed = 0
    for folder in BUILD.glob('*'):
        if not (folder.is_dir() and re.fullmatch(r'[0-9a-f]{32}', folder.name)):
            continue
        if (JOBS.get(folder.name) or {}).get('status') in ('queued', 'running'):
            continue
        try:
            old = now - folder.stat().st_mtime > BUILD_KEEP_SECONDS
        except OSError:
            continue
        if old:
            shutil.rmtree(folder, ignore_errors=True)
            JOBS.pop(folder.name, None)
            removed += 1
    return removed


def build_job(job_id, target):
    job, folder = JOBS[job_id], BUILD / job_id
    log = folder / 'build.log'
    try:
        job.update(status='running', message='Menyiapkan aplikasi buku…', progress=0.05)
        workspace = BUILD / 'native-workspace'
        shutil.copytree(ROOT / 'native/reader', workspace, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('build', '.dart_tool', '.gradle', '.idea', 'ephemeral', '.plugin_symlinks', 'local.properties', 'assets'))
        book_dir = (workspace / 'assets/book').resolve()
        if not book_dir.is_relative_to(BUILD.resolve()) or book_dir.name != 'book':
            raise RuntimeError('Lokasi aset build tidak valid.')
        if book_dir.exists():
            shutil.rmtree(book_dir)
        data = unpack_book(folder / 'input.zip', book_dir)
        app_id = android_app_id(data['title'])
        gradle = workspace / 'android/app/build.gradle.kts'
        gradle.write_text(re.sub(r'applicationId = "[^"]+"', f'applicationId = "{app_id}"', gradle.read_text(encoding='utf-8')), encoding='utf-8')
        brand_native(workspace, data['title'])
        flutter = shutil.which('flutter')
        if not flutter:
            raise RuntimeError('Flutter belum terpasang.')
        job.update(message='Menyiapkan dependensi Flutter…', progress=0.1)
        plugin_junctions(workspace)
        code = run_command([flutter, 'pub', 'get'], workspace, log)
        if code and 'symlink support' in log.read_text(errors='replace'):
            plugin_junctions(workspace)
            code = run_command([flutter, 'pub', 'get'], workspace, log)
        if code:
            raise RuntimeError('Dependensi Flutter gagal disiapkan. Unduh log build untuk rinciannya.')
        job.update(message='Membangun APK Android…' if target == 'apk' else 'Membangun aplikasi Windows…', progress=0.2 if target == 'apk' else 0.3)
        signing = None
        if target == 'apk':
            job.update(message='Menyiapkan tanda tangan aplikasi…', progress=0.25)
            try:
                signing = android_signing()
            except (OSError, subprocess.SubprocessError, ValueError, KeyError) as cause:
                with log.open('a', encoding='utf-8') as stream:
                    stream.write(f'\nRelease key unavailable, using the debug key: {cause}\n')
            job.update(message='Membangun APK Android…', progress=0.3)
        # Newer build number every time, so installing a rebuilt book updates it.
        build = [flutter, 'build', 'apk' if target == 'apk' else 'windows', '--release', f'--build-number={int(time.time() // 60)}']
        if run_command(build, workspace, log, signing):
            raise RuntimeError('Build gagal. Unduh log build untuk rinciannya.')
        if target == 'apk':
            output = folder / 'flipbook.apk'
            shutil.copy2(workspace / 'build/app/outputs/flutter-apk/app-release.apk', output)
        else:
            release = workspace / 'build/windows/x64/runner/Release'
            if not (release / 'sarvamaya_book.exe').is_file():
                raise RuntimeError('EXE hasil build tidak ditemukan.')
            output = folder / 'flipbook-windows.zip'
            exe = exe_name(data['title']) + '.exe'
            # One file for the reader: everything else is packed inside it.
            job.update(message='Mengemas aplikasi Windows jadi satu file…', progress=0.95)
            launcher = build_launcher(folder / 'launcher.exe', log)
            single = pack_launcher(launcher, release, 'sarvamaya_book.exe', folder / 'book.exe')
            with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as package:
                package.write(single, exe)
                package.writestr('HOW-TO-OPEN.txt', WINDOWS_HOW_TO.format(exe=exe))
            single.unlink(); launcher.unlink()
        # Download named after the book (the browser takes the server's name).
        label = exe_name(data['title'])
        download_name = label + ('.apk' if target == 'apk' else ' - Windows.zip')
        if job.get('library_user') and job.get('library_book'):
            # Keep the result in the member's archive too (quota permitting).
            try:
                get_library().save_export(job['library_user'], job['library_book'], target, download_name, source=output)
                job['library'] = 'saved'
            except accounts.AccountError as cause:
                job['library'] = str(cause)
        job.update(status='done', message='Build selesai.', progress=1, artifact=output.name,
                   download_name=download_name, download=f'/api/jobs/{job_id}/download')
    except Exception as cause:
        with log.open('a', encoding='utf-8') as stream:
            stream.write('\n' + str(cause) + '\n')
        job.update(status='failed', message=str(cause), log=f'/api/jobs/{job_id}/log')
    finally:
        BUILD_LOCK.release()


def local_addresses():
    """Hostnames/IPs milik mesin ini untuk validasi header Host."""
    names = {'localhost', '127.0.0.1', '::1'}
    try:
        names.add(socket.gethostname())
        for family, _, _, _, sockaddr in socket.getaddrinfo(socket.gethostname(), None):
            names.add(sockaddr[0])
    except OSError:
        pass
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(('8.8.8.8', 80))
        names.add(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    return names


def lan_ip():
    """IP LAN utama untuk ditampilkan; None bila tidak ada jaringan."""
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(('8.8.8.8', 80))
        ip = probe.getsockname()[0]
        probe.close()
        return None if ip.startswith('127.') else ip
    except OSError:
        return None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def trusted(self):
        host, origin = self.headers.get('Host', ''), self.headers.get('Origin')
        if host.lower() in CONFIG['public_hosts']:
            # Behind the HTTPS proxy: same-site Origin only.
            return not origin or origin in ('https://' + host, 'http://' + host)
        name, separator, host_port = host.rpartition(':')
        if not separator or host_port != str(self.server.server_port):
            return False
        if name.startswith('[') and name.endswith(']'):
            name = name[1:-1]
        if name not in local_addresses():
            return False
        return not origin or origin == 'http://' + host

    def page_language(self):
        """'en' or 'id': the language the site is shown in (cookie mf_lang
        from assets/i18n.js); 'id' when there is none (other clients, tests)."""
        for part in self.headers.get('Cookie', '').split(';'):
            name, _, value = part.strip().partition('=')
            if name == 'mf_lang':
                return 'en' if value.strip() == 'en' else 'id'
        return 'id'

    def send_json(self, status, body, cookie=None):
        if isinstance(body, dict) and self.page_language() == 'en' and ('error' in body or 'errors' in body):
            # Messages are written in Indonesian; an English page gets English.
            body = dict(body)
            if isinstance(body.get('error'), str):
                body['error'] = messages_en.english(body['error'])
            if isinstance(body.get('errors'), list):
                body['errors'] = [messages_en.english(e) for e in body['errors']]
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(encoded)))
        if cookie is not None:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(encoded)

    # ---- accounts helpers --------------------------------------------------
    def session_token(self):
        # Read our cookie by hand: SimpleCookie drops the WHOLE header when any
        # other cookie isn't to its taste — e.g. Google sign-in's g_state={"i_l":0}
        # — which silently logged everyone out after signing in with Google.
        for part in self.headers.get('Cookie', '').split(';'):
            name, _, value = part.strip().partition('=')
            if name == SESSION_COOKIE and re.fullmatch(r'[A-Za-z0-9_-]{20,200}', value):
                return value
        return None

    def current_user(self):
        return get_accounts().user_for(self.session_token())

    def session_cookie(self, token):
        max_age = accounts.SESSION_SECONDS if token else 0
        secure = '; Secure' if CONFIG['secure'] else ''
        return f'{SESSION_COOKIE}={token or ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}'

    # ---------- Remote builds (build PC running build_worker.py) ----------
    def queue_remote_build(self, target):
        with WORKER_LOCK:
            waiting = sum(1 for j in JOBS.values() if j.get('remote') and j['status'] in ('queued', 'running'))
        if waiting >= MAX_QUEUED_BUILDS:
            self.send_json(429, {'error': 'Antrean build sedang penuh. Coba lagi beberapa menit lagi.'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0:
                raise ValueError('Paket buku kosong.')
            prune_builds()
            job_id = uuid.uuid4().hex
            folder = BUILD / job_id
            folder.mkdir(parents=True)
            self.connection.settimeout(120)
            with (folder / 'input.zip').open('wb') as output:
                remaining = size
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError('Upload tidak lengkap.')
                    output.write(chunk)
                    remaining -= len(chunk)
        except Exception as cause:
            self.send_json(400, {'error': str(cause)})
            return
        message = ('Menunggu giliran di PC build…' if worker_online()
                   else 'PC build sedang offline — build otomatis mulai begitu PC build menyala.')
        job = dict(id=job_id, status='queued', message=message, progress=0, remote=True, target=target, updated=time.time())
        archived = self.headers.get('X-Library-Book', '')
        member = self.current_user() if archived else None
        if member and re.fullmatch(r'[0-9a-f]{32}', archived):
            job.update(library_user=member, library_book=archived)
        with WORKER_LOCK:
            JOBS[job_id] = job
        self.send_json(202, {'id': job_id})

    def worker_route(self, method):
        """The build PC: claim a queued job, fetch its book, report progress, send the result."""
        key = worker_key()
        if not key or not secrets.compare_digest(self.headers.get('X-Worker-Key', ''), key):
            self.send_json(403, {'error': 'Kunci worker tidak valid.'})
            return
        WORKER['seen'] = time.time()
        path = urlsplit(self.path).path
        if method == 'POST' and path == '/api/worker/claim':
            now = time.time()
            with WORKER_LOCK:
                for job in JOBS.values():
                    if job.get('remote') and job['status'] == 'running' and now - job.get('updated', now) > WORKER_STALE_SECONDS:
                        job.update(status='failed', message='PC build berhenti di tengah jalan. Coba build lagi.')
                waiting = sorted((j for j in JOBS.values() if j.get('remote') and j['status'] == 'queued'), key=lambda j: j['updated'])
                job = waiting[0] if waiting else None
                if job:
                    job.update(status='running', message='PC build mulai…', progress=0.02, updated=now)
            self.send_json(200, {'id': job['id'], 'target': job['target']} if job else {'id': None})
            return
        if method == 'POST' and path == '/api/worker/translate/claim':
            # Long poll: the PC waits here until a batch comes (or the wait ends).
            with TRANSLATE_COND:
                TRANSLATE_COND.wait_for(lambda: any(not t['claimed'] for t in TRANSLATIONS.values()), timeout=TRANSLATE_CLAIM_WAIT)
                task = next((t for t in TRANSLATIONS.values() if not t['claimed']), None)
                if task:
                    task['claimed'] = True
            WORKER['seen'] = time.time()
            self.send_json(200, {'id': task['id'], 'pages': task['pages'], 'target': task['target']} if task else {'id': None})
            return
        match = re.fullmatch(r'/api/worker/translate/([a-f0-9]{32})/result', path)
        if method == 'POST' and match:
            try:
                size = int(self.headers.get('Content-Length', '0'))
                data = json.loads(self.rfile.read(size) if 0 < size <= 8 * 1024 * 1024 else b'{}')
            except (ValueError, json.JSONDecodeError):
                data = {}
            task = TRANSLATIONS.get(match[1])
            if not task:
                self.send_json(404, {'error': 'Terjemahan sudah tidak ditunggu.'})
                return
            pages = data.get('pages') if isinstance(data, dict) else None
            if isinstance(pages, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in pages.items()):
                task['result'] = {k: v for k, v in pages.items() if k in task['pages']}
            else:
                task['error'] = str((data or {}).get('error') or 'jawaban tidak valid')[:300] if isinstance(data, dict) else 'jawaban tidak valid'
            task['done'].set()
            self.send_json(200, {'ok': True})
            return
        match = re.fullmatch(r'/api/worker/jobs/([a-f0-9]{32})/(input|progress|result|fail)', path)
        job = JOBS.get(match[1]) if match else None
        if not job or not job.get('remote'):
            self.send_json(404, {'error': 'Build tidak ditemukan.'})
            return
        folder, action = BUILD / job['id'], match[2]
        if method == 'GET' and action == 'input':
            file = folder / 'input.zip'
            self.send_response(200)
            self.send_header('Content-Type', 'application/zip')
            self.send_header('Content-Length', str(file.stat().st_size))
            self.end_headers()
            with file.open('rb') as source:
                shutil.copyfileobj(source, self.wfile)
            return
        if method != 'POST' or job['status'] != 'running':
            self.send_json(409, {'error': 'Build ini tidak sedang berjalan.'})
            return
        if action in ('progress', 'fail'):
            try:
                size = int(self.headers.get('Content-Length', '0'))
                data = json.loads(self.rfile.read(size) if 0 < size <= 512 * 1024 else b'{}')
            except (ValueError, json.JSONDecodeError):
                data = {}
            data = data if isinstance(data, dict) else {}
            if action == 'progress':
                progress = data.get('progress')
                job.update(message=str(data.get('message') or job['message'])[:200], updated=time.time(),
                           progress=min(0.99, max(0.0, float(progress))) if isinstance(progress, (int, float)) else job['progress'])
            else:
                (folder / 'build.log').write_text(str(data.get('log') or '')[-200000:], encoding='utf-8')
                job.update(status='failed', message=str(data.get('message') or 'Build gagal.')[:300], log=f'/api/jobs/{job["id"]}/log', updated=time.time())
            self.send_json(200, {'ok': True})
            return
        # result: the built file
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= MAX_BUILD_RESULT:
                raise ValueError('Ukuran hasil build tidak valid.')
            output = folder / ('flipbook.apk' if job['target'] == 'apk' else 'flipbook-windows.zip')
            self.connection.settimeout(300)
            with output.open('wb') as stream:
                remaining = size
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError('Upload hasil build tidak lengkap.')
                    stream.write(chunk)
                    remaining -= len(chunk)
        except (ValueError, OSError) as cause:
            self.send_json(400, {'error': str(cause)})
            return
        download_name = unquote(self.headers.get('X-Download-Name', '')).strip()[:200] or output.name
        download_name = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', '_', download_name)
        if job.get('library_user') and job.get('library_book'):
            try:
                get_library().save_export(job['library_user'], job['library_book'], job['target'], download_name, source=output)
                job['library'] = 'saved'
            except accounts.AccountError as cause:
                job['library'] = str(cause)
        job.update(status='done', message='Build selesai.', progress=1, artifact=output.name, download_name=download_name,
                   download=f'/api/jobs/{job["id"]}/download', updated=time.time())
        self.send_json(200, {'ok': True})

    def quota(self, kind, amount=1):
        """Spend `amount` of the member's quota for `kind`, or raise 429 saying when it
        fills up again. Hosted only (a local copy has no limits)."""
        if not hosted():
            return
        user = self.current_user()
        if not user:
            return
        limit = quota_limit(user, kind)
        if limit is None:
            return
        store, window, now = get_accounts(), quota_window(), int(time.time())
        used, first = store.usage_in(user['id'], kind, now - window)
        if used + amount > limit:
            back = time.strftime('%H:%M', time.localtime((first or now) + window))
            raise accounts.AccountError(429, f'Jatah {QUOTA_LABELS[kind]} habis untuk sementara — terisi lagi pukul {back}. '
                                             'Upgrade ke Pro atau Business untuk jatah lebih besar.')
        store.spend(user['id'], kind, amount, now)

    def usage_report(self, user):
        window, now = quota_window(), int(time.time())
        out = {}
        for kind in QUOTA_LABELS:
            limit = quota_limit(user, kind)
            used, first = get_accounts().usage_in(user['id'], kind, now - window)
            out[kind] = dict(used=used, limit=limit, resetAt=(first + window) if first else None)
        return dict(windowHours=window / 3600, quotas=out, limited=hosted())

    def ref_cookie(self):
        """The referral code a visitor arrived with (cookie mf_ref, set by assets/auth.js)."""
        for part in self.headers.get('Cookie', '').split(';'):
            name, _, value = part.strip().partition('=')
            if name == 'mf_ref':
                return value.strip()[:12]
        return ''

    def count_visit(self):
        """POST /api/visit {path, ref}: one page view, sent by the page itself once it
        has loaded in a real browser (assets/auth.js) — tools and most bots never
        run it. The team (STATS_EXCLUDE_EMAILS) is not counted; a reload of the
        same page within a minute counts once."""
        try:
            size = int(self.headers.get('Content-Length', '0'))
            data = json.loads(self.rfile.read(size) if 0 < size <= 4096 else b'{}')
            page = str(data.get('path') or '/').split('?')[0].lstrip('/') or 'index.html'
            if (page in PAGES and page not in SOON_PAGES) or page in seo.LANDING:
                user = self.current_user() if self.session_token() else None
                team = {e.strip().lower() for e in os.environ.get('STATS_EXCLUDE_EMAILS', '').split(',') if e.strip()}
                key = (self.client_ip(), self.headers.get('User-Agent', ''), page)
                now = time.time()
                with VISIT_LOCK:
                    fresh = now - RECENT_VISITS.get(key, 0) > 60
                    RECENT_VISITS[key] = now
                    if len(RECENT_VISITS) > 5000:
                        for k in [k for k, t in RECENT_VISITS.items() if now - t > 120]:
                            RECENT_VISITS.pop(k, None)
                if fresh and not (user and user['email'].lower() in team):
                    get_visits().record('/' + page, key[0], key[1], str(data.get('ref') or '')[:500],
                                        user['id'] if user else None, own_hosts=CONFIG['public_hosts'] | {'localhost', '127.0.0.1'},
                                        place=geo.lookup(key[0]))
        except Exception:
            pass
        self.send_response(204)
        self.end_headers()

    def client_ip(self):
        # Behind nginx: X-Real-IP is set by nginx itself ($remote_addr); the
        # first X-Forwarded-For entry can be written by the visitor, so it is
        # only a fallback.
        if hosted():
            real = self.headers.get('X-Real-IP', '').strip()
            if real:
                return real
            forwarded = [p.strip() for p in self.headers.get('X-Forwarded-For', '').split(',') if p.strip()]
            if forwarded:
                return forwarded[-1]
        return self.client_address[0]

    def signup_guard(self, email=None, google_sub=None):
        """Few new accounts per network (SIGNUP_PER_IP accounts per SIGNUP_IP_DAYS days,
        default 3 a day — the usage quotas do the real work): a new account from an IP that already made one is
        refused; signing in to an existing account is never blocked. Hosted only;
        SIGNUP_IP_ALLOW lists IPs left free (an office). Returns the IP to record."""
        ip = self.client_ip()
        if not hosted() or get_accounts().account_exists(email, google_sub):
            return None
        allowed = {a.strip() for a in os.environ.get('SIGNUP_IP_ALLOW', '').split(',') if a.strip()}
        try:
            limit = int(os.environ.get('SIGNUP_PER_IP', '3')); days = int(os.environ.get('SIGNUP_IP_DAYS', '1'))
        except ValueError:
            limit, days = 3, 1
        try:
            local = ipaddress.ip_address(ip).is_loopback          # this machine itself (tools, tests); nginx always sends the real IP
        except ValueError:
            local = False
        if ip not in allowed and not local and limit > 0 and get_accounts().signups_from(ip, days) >= limit:
            raise accounts.AccountError(403, SIGNUP_IP_MESSAGE)
        return ip

    def read_body(self, limit=64 * 1024):
        if self.headers.get_content_type() != 'application/json':
            raise accounts.AccountError(415, 'Permintaan harus JSON.')
        try:
            size = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            size = -1
        if not 0 <= size <= limit:
            raise accounts.AccountError(413, 'Permintaan terlalu besar.')
        return self.rfile.read(size)

    def read_json(self, raw):
        try:
            data = json.loads(raw or b'{}')
        except ValueError:
            raise accounts.AccountError(400, 'JSON tidak valid.')
        if not isinstance(data, dict):
            raise accounts.AccountError(400, 'JSON tidak valid.')
        return data

    def base_url(self):
        if CONFIG['base_url']:
            return CONFIG['base_url'].rstrip('/')
        scheme = 'https' if CONFIG['secure'] else 'http'
        return f'{scheme}://{self.headers.get("Host", "")}'

    # ---- member archive (My Library) -------------------------------------------
    def member(self):
        user = self.current_user()
        if not user:
            raise accounts.AccountError(401, 'Silakan masuk dulu untuk memakai My Library.')
        return user

    def read_raw(self, limit):
        try:
            size = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            size = -1
        if not 0 < size <= limit:
            raise accounts.AccountError(413, 'Ukuran file tidak valid atau terlalu besar.')
        self.connection.settimeout(300)
        data, remaining = bytearray(), size
        while remaining:
            chunk = self.rfile.read(min(1024 * 1024, remaining))
            if not chunk:
                raise accounts.AccountError(400, 'Upload tidak lengkap.')
            data += chunk
            remaining -= len(chunk)
        return bytes(data)

    def send_file_bytes(self, data, content_type, filename=None):
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'private, no-store')
        if filename:
            ascii_name = re.sub(r'[^A-Za-z0-9._ -]+', '_', filename)
            self.send_header('Content-Disposition', f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(filename)}')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def library_get(self, path):
        user, store = self.member(), get_library()
        if path == '/api/library':
            self.send_json(200, {'books': store.books(user), 'usage': store.usage(user)})
            return
        match = re.fullmatch(r'/api/library/([0-9a-f]{32})/(cover|project)', path)
        if match:
            book_id, what = match.groups()
            if what == 'cover':
                self.send_file_bytes(store.cover(user, book_id), 'image/jpeg')
            else:
                data, title = store.project(user, book_id)
                self.send_file_bytes(data, 'application/octet-stream', exe_name(title) + '.smflipbook')
            return
        match = re.fullmatch(r'/api/library/([0-9a-f]{32})/exports/([0-9a-f]{32})', path)
        if match:
            data, filename = store.export(user, *match.groups())
            self.send_file_bytes(data, 'application/octet-stream', filename)
            return
        self.send_json(404, {'error': 'Tidak ditemukan.'})

    def library_post(self, path):
        user, store = self.member(), get_library()
        if path == '/api/library/save':
            if user.get('trialExpired'):
                self.send_json(402, {'error': 'Masa coba gratis 7 harimu sudah habis. Upgrade ke Pro untuk memakai fitur ini.'})
                return
            data = self.read_raw(library.MAX_PROJECT)
            book_id = store.save_project(user, data, self.headers.get('X-Book-Id') or None)
            self.send_json(200, {'id': book_id, 'usage': store.usage(user)})
            return
        match = re.fullmatch(r'/api/library/([0-9a-f]{32})/(cover|export|delete)', path)
        if not match:
            self.send_json(404, {'error': 'Tidak ditemukan.'})
            return
        book_id, action = match.groups()
        if action in ('cover', 'export') and user.get('trialExpired'):
            self.send_json(402, {'error': 'Masa coba gratis 7 harimu sudah habis. Upgrade ke Pro untuk memakai fitur ini.'})
            return
        if action == 'cover':
            store.save_cover(user, book_id, self.read_raw(library.MAX_COVER))
        elif action == 'export':
            store.save_export(user, book_id, self.headers.get('X-Kind', ''), unquote(self.headers.get('X-Filename', '')),
                              self.read_raw(library.MAX_EXPORT))
        else:
            store.delete(user, book_id)
        self.send_json(200, {'ok': True, 'usage': store.usage(user)})

    def share_member(self):
        user = self.current_user()
        if not user:
            raise accounts.AccountError(401, 'Silakan masuk dulu untuk membagikan buku.')
        return user

    def share_get(self, path):
        user, store = self.share_member(), get_share()
        if path == '/api/share':
            self.send_json(200, {'links': store.mine(user), 'usage': store.usage(user)})
            return
        self.send_json(404, {'error': 'Tidak ditemukan.'})

    def share_post(self, path):
        user, store = self.share_member(), get_share()
        if path == '/api/share':
            # Publishing needs Pro — except a Free taster: the first
            # SHARE_FREE links go through, then it is time to upgrade.
            # (Trial-expired members only read books; they cannot publish.)
            if user.get('trialExpired'):
                self.send_json(402, {'error': 'Masa coba gratis 7 harimu sudah habis. Upgrade ke Pro untuk memakai fitur ini.'})
                return
            if 'export' not in user['entitlements'] and store.usage(user)['links'] >= accounts.SHARE_FREE:
                self.send_json(402, {'error': 'Jatah 3 share gratis habis. Upgrade ke Pro untuk share tanpa batas.'})
                return
            if not secrets.compare_digest(self.headers.get('X-Build-Token', ''), TOKEN):
                self.send_json(403, {'error': 'Sesi build tidak valid. Refresh halaman.'})
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                size = -1
            if not 0 < size <= share.MAX_SHARE_FILE:
                self.send_json(413, {'error': 'Ukuran file tidak valid atau terlalu besar.'})
                return
            title = unquote(self.headers.get('X-Title', ''))
            try:
                link_id, clean = store.create(user, title, size)
            except accounts.AccountError as cause:
                self.send_json(cause.status, {'error': str(cause)})
                return
            try:
                self.connection.settimeout(300)
                with store.tmp_path(link_id).open('wb') as output:
                    remaining = size
                    while remaining:
                        chunk = self.rfile.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise accounts.AccountError(400, 'Upload tidak lengkap.')
                        output.write(chunk)
                        remaining -= len(chunk)
                store.finalize(link_id, size)
            except accounts.AccountError as cause:
                store.discard(link_id)
                self.send_json(cause.status, {'error': str(cause)})
                return
            left = max(0, accounts.SHARE_FREE - store.usage(user)['links']) if 'export' not in user['entitlements'] else None
            self.send_json(200, {'id': link_id, 'url': '/s/' + link_id, 'title': clean,
                                 'usage': store.usage(user), 'freeLeft': left})
            return
        match = re.fullmatch(r'/api/share/([0-9a-f]{32})/delete', path)
        if not match:
            self.send_json(404, {'error': 'Tidak ditemukan.'})
            return
        store.remove(user, match[1])
        self.send_json(200, {'ok': True, 'usage': store.usage(user)})

    def account_get(self, path):
        store = get_accounts()
        if path == '/api/auth/me':
            self.send_json(200, {'user': self.current_user(), 'loginRequired': hosted(),
                                 'googleClientId': os.environ.get('GOOGLE_CLIENT_ID', '').strip() or None})
        elif path == '/api/auth/usage':
            user = self.current_user()
            if not user:
                raise accounts.AccountError(401, 'Silakan masuk dulu.')
            self.send_json(200, self.usage_report(user))
        elif path == '/api/auth/referral':
            user = self.current_user()
            if not user:
                raise accounts.AccountError(401, 'Silakan masuk dulu.')
            stats = store.referral_stats(user['id'])
            self.send_json(200, dict(stats, link=self.base_url() + '/?ref=' + stats['code']))
        elif path == '/api/auth/verify':
            # The link in the verification email: sign in and go to the account page.
            token = (parse_qs(urlsplit(self.path).query).get('token') or [''])[0]
            try:
                session = store.verify_email(token)
            except accounts.AccountError:
                self.send_response(302)
                self.send_header('Location', '/login.html?verify=failed')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                return
            self.send_response(302)
            self.send_header('Location', '/account.html?verified=1')
            self.send_header('Set-Cookie', self.session_cookie(session))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
        elif path == '/api/billing/methods':
            self.send_json(200, {'methods': store.payment_methods()})
        elif path == '/api/billing/plans':
            providers = {c: store.provider_for(c).name for c in accounts.CURRENCIES}
            paused = payments_paused()
            self.send_json(200, {'plans': store.plans(), 'provider': store.provider.name, 'providers': providers,
                                 'paymentsEnabled': {c: name != 'none' and not paused for c, name in providers.items()},
                                 'paymentsPaused': paused})
        elif re.fullmatch(r'/api/billing/orders/[A-Za-z0-9-]{1,64}/invoice\.pdf', path):
            user = self.current_user()
            if not user:
                raise accounts.AccountError(401, 'Silakan masuk dulu.')
            order, owner = store.paid_order(user, path.split('/')[4])
            seller = [line.strip() for line in os.environ.get('MYFLIPBOOK_INVOICE_SELLER', 'MyFlipbook|by Sarvamaya').split('|')
                      if line.strip()]
            pdf = invoice.build(order, owner, seller)
            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('Content-Disposition', f'attachment; filename="MyFlipbook-INV-{order["id"]}.pdf"')
            self.send_header('Cache-Control', 'private, no-store')
            self.send_header('Content-Length', str(len(pdf)))
            self.end_headers()
            self.wfile.write(pdf)
        elif path == '/api/billing/orders':
            user = self.current_user()
            if not user:
                raise accounts.AccountError(401, 'Silakan masuk dulu.')
            store.refresh_pending(user['id'])   # Midtrans: settle without waiting for the notification
            self.send_json(200, {'orders': store.orders(user['id'])})
        else:
            self.send_json(404, {'error': 'Tidak ditemukan.'})

    def account_post(self, path):
        store = get_accounts()
        if path in ('/api/payment/duitku/callback', '/api/billing/duitku/callback'):
            # Duitku posts form-urlencoded (not JSON), signed with our API key.
            # Answer plain SUCCESS: anything else makes Duitku resend (5 tries).
            store.provider_callback(self.read_raw(64 * 1024), self.headers)
            body = b'SUCCESS'
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        # Gateway webhooks can be larger than our own JSON requests.
        raw = self.read_body(256 * 1024 if path == '/api/billing/lemonsqueezy/webhook' else 64 * 1024)
        if path == '/api/billing/lemonsqueezy/webhook':
            status = store.lemonsqueezy_webhook(raw, self.headers)
            self.send_json(200, {'status': status})
            return
        if path == '/api/billing/tripay/callback':
            # Signature covers the raw body, so verify before parsing.
            status = store.provider_callback(raw, self.headers)
            self.send_json(200, {'success': True, 'status': status})
            return
        data = self.read_json(raw)
        if path == '/api/billing/midtrans/notify':
            status = store.provider_notification(data)
            self.send_json(200, {'status': status})
            return
        if path == '/api/auth/register':
            if CONFIG['verify_email']:
                # Not signed in yet: the account opens from the link in the email.
                ip = self.signup_guard(data.get('email'))
                user_id, token = store.register_unverified(data.get('email'), data.get('password'), data.get('name'))
                store.attach_referrer(user_id, self.ref_cookie())
                if ip:
                    store.record_signup(ip, user_id)
                email = str(data.get('email')).strip().lower()
                try:
                    sent = verification_mail(email, str(data.get('name') or '').strip(), self.base_url() + '/api/auth/verify?token=' + token)
                except RuntimeError as cause:
                    raise accounts.AccountError(502, str(cause))
                self.send_json(201, {'verify': True, 'email': email, 'outbox': sent == 'outbox'})
                return
            ip = self.signup_guard(data.get('email'))
            token = store.register(data.get('email'), data.get('password'), data.get('name'))
            user = store.user_for(token)
            store.attach_referrer(user['id'], self.ref_cookie())
            if ip:
                store.record_signup(ip, user['id'])
            self.send_json(201, {'user': store.user_for(token)}, cookie=self.session_cookie(token))
            return
        if path == '/api/auth/resend':
            found = store.resend_verification(data.get('email'), self.client_ip())
            if found:
                user_id, token, name = found
                try:
                    verification_mail(str(data.get('email')).strip().lower(), name, self.base_url() + '/api/auth/verify?token=' + token)
                except RuntimeError as cause:
                    raise accounts.AccountError(502, str(cause))
            self.send_json(200, {'ok': True})     # the same answer whether or not the email is registered
            return
        if path == '/api/auth/google':
            claims = google_claims(data.get('credential'))
            ip = self.signup_guard(claims.get('email'), claims.get('sub'))
            token = store.google_login(claims.get('sub'), claims.get('email'), claims.get('name', ''))
            store.attach_referrer(store.user_for(token)['id'], self.ref_cookie())      # only a brand-new account takes it
            if ip:
                store.record_signup(ip, store.user_for(token)['id'])
            self.send_json(200, {'user': store.user_for(token)}, cookie=self.session_cookie(token))
            return
        if path == '/api/auth/login':
            token = store.login(data.get('email'), data.get('password'), self.client_ip())
            self.send_json(200, {'user': store.user_for(token)}, cookie=self.session_cookie(token))
            return
        if path == '/api/auth/logout':
            store.logout(self.session_token())
            self.send_json(200, {'ok': True}, cookie=self.session_cookie(None))
            return
        user = self.current_user()
        if not user:
            raise accounts.AccountError(401, 'Silakan masuk dulu.')
        if path == '/api/billing/checkout':
            if payments_paused():
                raise accounts.AccountError(503, 'Pembayaran online sementara dinonaktifkan. Coba lagi nanti.')
            self.send_json(200, store.checkout(user, data.get('plan'), data.get('cycle'), self.base_url(),
                                               data.get('method'), str(data.get('currency') or 'IDR')))
        elif path == '/api/billing/mock/pay':
            store.mock_pay(user, str(data.get('orderId', '')))
            self.send_json(200, {'user': self.current_user()})
        else:
            self.send_json(404, {'error': 'Tidak ditemukan.'})

    def journals_route(self):
        """GET /api/journals?q=&page=&oa=1&from=&to=&lang=&id=1&sort= -> articles with links."""
        query = parse_qs(urlsplit(self.path).query)
        one = lambda name, default='': (query.get(name) or [default])[0].strip()
        q = ' '.join(one('q').split())
        if not 2 <= len(q) <= 200:
            self.send_json(400, {'error': 'Tulis kata kunci 2-200 karakter.'})
            return
        year = lambda v: int(v) if re.fullmatch(r'(19|20)\d\d', v) else None
        try:
            page = max(1, min(50, int(one('page', '1') or 1)))
        except ValueError:
            page = 1
        sort = one('sort', 'relevance')
        try:
            self.send_json(200, journal_search(q, page, oa=one('oa', '1') != '0', year_from=year(one('from')), year_to=year(one('to')),
                                               lang=one('lang') or None, indonesia=one('id') == '1',
                                               sort=sort if sort in JOURNAL_SORTS else 'relevance'))
        except RuntimeError as cause:
            self.send_json(502, {'error': str(cause)})

    def ebooks_route(self):
        """GET /api/ebooks?q=&page=&lang=&src=all|oapen|archive -> books with a PDF."""
        query = parse_qs(urlsplit(self.path).query)
        one = lambda name, default='': (query.get(name) or [default])[0].strip()
        q = ' '.join(one('q').split())
        if not 2 <= len(q) <= 200:
            self.send_json(400, {'error': 'Tulis kata kunci 2-200 karakter.'})
            return
        try:
            page = max(1, min(50, int(one('page', '1') or 1)))
        except ValueError:
            page = 1
        source = one('src', 'all')
        try:
            self.send_json(200, ebook_search(q, page, lang=one('lang') or None,
                                             source=source if source in ('all', 'oapen', 'archive') else 'all'))
        except RuntimeError as cause:
            self.send_json(502, {'error': str(cause)})

    def book_text(self, data):
        """The {page: [lines]} of a request as one text, pages in order."""
        pages = data.get('text')
        if not isinstance(pages, dict):
            raise ValueError('Teks buku tidak valid.')
        ordered = sorted((int(k), v) for k, v in pages.items() if re.fullmatch(r'0|[1-9][0-9]*', str(k)) and isinstance(v, list))
        text = '\n\n'.join(f'[Halaman {k + 1}]\n' + '\n'.join(str(line) for line in lines if isinstance(line, str)) for k, lines in ordered)
        if len(text.split()) < 40:
            raise ValueError('Buku ini hampir tidak punya teks (hasil scan?). Jalankan OCR dulu.')
        return text

    def summary_route(self):
        """POST {title, text: {page: [lines]}, lang} -> {lang, text}."""
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 16 * 1024 * 1024:
                raise ValueError('Teks buku kosong atau terlalu besar.')
            data = json.loads(self.rfile.read(size).decode('utf-8'))
            text = self.book_text(data)
            lang = data.get('lang') if data.get('lang') in TRANSLATE_LANGUAGES else 'id-ID'
            title = str(data.get('title') or 'Buku')[:200]
        except (ValueError, UnicodeDecodeError) as cause:
            self.send_json(400, {'error': 'Permintaan tidak valid.' if isinstance(cause, (json.JSONDecodeError, UnicodeDecodeError)) else str(cause)})
            return
        try:
            self.send_json(200, summarize_book(title, text, lang))
        except RuntimeError as cause:
            self.send_json(502, {'error': str(cause)})

    def highlight_summary_route(self):
        """POST {text} (one highlighted passage) -> {summary}."""
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 64 * 1024:
                raise ValueError('Teks kosong atau terlalu panjang.')
            data = json.loads(self.rfile.read(size).decode('utf-8'))
            text = data.get('text') if isinstance(data, dict) else None
            if not isinstance(text, str):
                raise ValueError('Teks yang distabilo kosong.')
            summary = summarize_highlight(text)
        except (ValueError, UnicodeDecodeError) as cause:
            self.send_json(400, {'error': 'Permintaan tidak valid.' if isinstance(cause, (json.JSONDecodeError, UnicodeDecodeError)) else str(cause)})
            return
        except RuntimeError as cause:
            self.send_json(502, {'error': str(cause)})
            return
        self.send_json(200, {'summary': summary})

    def translate_route(self, free=False):
        """POST {pages: {page: text}, target, title} -> {pages: {page: translation}}.
        free: the offline Argos translator (whole-book editions, no AI credit)."""
        remote = free and not local_free_translate()
        if remote and not worker_key():
            self.send_json(503, {'error': 'Penerjemah gratis belum dipasang di server (pip install argostranslate, lalu python free_translate.py --install).'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 2 * 1024 * 1024:
                raise ValueError('Teks kosong atau terlalu besar.')
            data = json.loads(self.rfile.read(size).decode('utf-8'))
            target = data.get('target')
            if target not in TRANSLATE_LANGUAGES:
                raise ValueError('Bahasa tujuan tidak didukung.')
            pages = data.get('pages')
            if not isinstance(pages, dict) or not pages or len(pages) > 40:
                raise ValueError('Halaman tidak valid (maks 40 per permintaan).')
            clean = {}
            for key, text in pages.items():
                if not re.fullmatch(r'0|[1-9][0-9]*', str(key)) or not isinstance(text, str):
                    raise ValueError('Halaman tidak valid.')
                if text.strip():
                    clean[str(key)] = text
            if not clean:
                raise ValueError('Halaman ini tidak punya teks.')
            if sum(len(t) for t in clean.values()) > TRANSLATE_MAX_CHARS:
                raise ValueError('Terlalu banyak teks dalam satu permintaan.')
            title = str(data.get('title') or 'Buku')[:200]
        except (ValueError, UnicodeDecodeError) as cause:
            self.send_json(400, {'error': 'Permintaan tidak valid.' if isinstance(cause, (json.JSONDecodeError, UnicodeDecodeError)) else str(cause)})
            return
        if free:
            try:
                self.quota('translate', sum(len(t) for t in clean.values()))
            except accounts.AccountError as cause:
                self.send_json(cause.status, {'error': str(cause)})
                return
        try:
            if free:
                if target not in free_translate.LANGS:
                    raise ValueError('Bahasa tujuan tidak didukung penerjemah gratis.')
                done = remote_translate(clean, target) if remote else free_translate.translate_texts(clean, target)
                self.send_json(200, {'pages': done, 'target': target, 'engine': 'free'})
            else:
                self.send_json(200, {'pages': translate_pages(clean, target, title), 'target': target})
        except ValueError as cause:
            self.send_json(400, {'error': str(cause)})
        except RuntimeError as cause:
            self.send_json(503 if 'offline' in str(cause) else 502, {'error': str(cause)})

    def podcast_route(self):
        """POST {title, text: {page: [lines]}, lang, hosts} -> two-host podcast script."""
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 8 * 1024 * 1024:
                raise ValueError('Teks buku kosong atau terlalu besar.')
            data = json.loads(self.rfile.read(size).decode('utf-8'))
            text = self.book_text(data)
            lang = data.get('lang') if data.get('lang') in PODCAST_LANGUAGES else 'id-ID'
            hosts = data.get('hosts')
            if not (isinstance(hosts, list) and len(hosts) == 2 and all(isinstance(h, str) and re.fullmatch(r'[A-Za-z]{2,20}', h) for h in hosts)):
                hosts = ['Rina', 'Bima']
            title = str(data.get('title') or 'Buku')[:200]
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as cause:
            self.send_json(400, {'error': str(cause) if isinstance(cause, ValueError) and not isinstance(cause, json.JSONDecodeError) else 'Permintaan tidak valid.'})
            return
        try:
            self.send_json(200, podcast_script(title, text, lang, hosts))
        except RuntimeError as cause:
            self.send_json(502, {'error': str(cause)})

    def entitlement_error(self, feature):
        """None when allowed, else (status, message).

        Office conversion is gated on a public host only; exports and
        native builds whenever the paywall is on.
        """
        if not (hosted() if feature == 'office' else CONFIG['paywall']):
            return None
        user = self.current_user()
        if not user:
            return 401, 'Silakan masuk dulu untuk memakai fitur ini.'
        if user.get('trialExpired') and feature in ('office', 'ai'):
            return 402, 'Masa coba gratis 7 harimu sudah habis. Upgrade ke Pro untuk memakai fitur ini.'
        # Book translation runs on the free translator (no AI credit): only the allowance limits it.
        if feature == 'ai' and not payments_live() and user['plan'] not in ('pro', 'business') and self.path != '/api/translate-free':
            # No gateway yet: paid members (their plan already covers AI credit)
            # keep working; free waits until payments are set up.
            return 503, 'Fitur AI belum aktif di server ini (pembayaran belum disiapkan).'
        if feature not in user['entitlements']:
            plan = 'Business' if feature == 'exe' else 'Pro atau Business'
            return 402, f'Fitur ini butuh paket {plan}. Upgrade di halaman Harga/Akun.'
        return None

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        page = unquote(urlsplit(self.path).path).lstrip('/')
        if not page.startswith('s/'):
            # No other site may frame the app (clickjacking); share links stay embeddable.
            self.send_header('X-Frame-Options', 'SAMEORIGIN')
        has_cache = any(line.lower().startswith(b'cache-control:') for line in getattr(self, '_headers_buffer', []))
        if page in EXPORT_TEMPLATES:
            self.send_header('Cache-Control', 'no-store')
        elif not has_cache and (page == '' or page.endswith(('.html', '.js', '.css', '.json'))):
            # Pages and scripts: the browser checks for a newer version each time
            # (cheap 304 when unchanged), so an update never runs with stale JS.
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        if not self.trusted():
            self.send_json(403, {'error': 'Akses hanya dari localhost proyek.'})
            return
        path = unquote(urlsplit(self.path).path)
        if path.startswith('/api/worker/'):
            self.worker_route('GET')
            return
        if path.startswith(('/api/auth/', '/api/billing/')):
            try:
                self.account_get(path)
            except accounts.AccountError as cause:
                self.send_json(cause.status, {'error': str(cause)})
            return
        if path == '/api/library' or path.startswith('/api/library/'):
            try:
                self.library_get(path)
            except accounts.AccountError as cause:
                self.send_json(cause.status, {'error': str(cause)})
            return
        if path == '/api/share' or path.startswith('/api/share/'):
            try:
                self.share_get(path)
            except accounts.AccountError as cause:
                self.send_json(cause.status, {'error': str(cause)})
            return
        if path == '/api/journals':
            self.journals_route()
            return
        if path == '/api/ebooks':
            self.ebooks_route()
            return
        if path == '/api/ebooks/pdf':
            query = parse_qs(urlsplit(self.path).query)
            try:
                found = ebook_pdf((query.get('src') or [''])[0], (query.get('id') or [''])[0])
            except ValueError as cause:
                self.send_json(400, {'error': str(cause)})
            except RuntimeError as cause:
                self.send_json(502, {'error': str(cause)})
            else:
                self.send_json(200 if found['pdf'] else 404, dict(found, maxBytes=FETCH_MAX_BYTES) if found['pdf'] else {'error': 'Buku ini tidak punya berkas PDF.'})
            return
        if path == '/api/capabilities':
            flutter = bool(shutil.which('flutter'))
            office = bool(find_soffice())
            html = bool(find_chromium())
            # Hosting: the build/convert token is only handed to signed-in users.
            user = self.current_user() if hosted() or CONFIG['paywall'] else None
            token = TOKEN if not hosted() or user else None
            remote = remote_builds()
            self.send_json(200, dict(apk=flutter or remote, exe=(flutter and os.name == 'nt') or remote, office=office, html=html, token=token,
                                     buildWorker=('online' if worker_online() else 'offline') if remote else None,
                                     loginRequired=hosted(), paywall=CONFIG['paywall'],
                                     entitlements=user['entitlements'] if user else None, drive=drive_picker_config()))
            return
        match = re.fullmatch(r'/api/jobs/([a-f0-9]{32})(?:/(download|log))?', path)
        if match:
            job_id, action = match.groups()
            job = JOBS.get(job_id)
            if not job:
                self.send_json(404, {'error': 'Build tidak ditemukan.'})
            elif not action:
                self.send_json(200, job)
            else:
                filename = job.get('artifact') if action == 'download' and job['status'] == 'done' else 'build.log' if action == 'log' else None
                file = BUILD / job_id / filename if filename else None
                if not file or not file.is_file():
                    self.send_json(404, {'error': 'Hasil belum tersedia.'})
                    return
                self.send_response(200)
                self.send_header('Content-Type', 'application/octet-stream' if action == 'download' else 'text/plain; charset=utf-8')
                shown = job.get('download_name', filename) if action == 'download' else filename
                ascii_name = re.sub(r'[^A-Za-z0-9._ -]+', '_', shown)
                self.send_header('Content-Disposition', f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(shown)}')
                self.send_header('Content-Length', str(file.stat().st_size))
                self.end_headers()
                with file.open('rb') as source:
                    shutil.copyfileobj(source, self.wfile)
            return
        match = re.fullmatch(r'/s/([0-9a-f]{32})', path)
        if match:
            # Public share link: anyone with the URL reads the book, no login.
            try:
                title, data = get_share().page(match[1])
            except accounts.AccountError as cause:
                self.send_json(cause.status, {'error': str(cause)})
                return
            if (parse_qs(urlsplit(self.path).query).get('dl') or [''])[0]:
                self.send_file_bytes(data, 'text/html', share_filename(title))
                return
            head, sep, tail = data.rpartition(b'</body>')
            page = (head + SHARE_BAR.encode() + sep + tail) if sep else (data + SHARE_BAR.encode())
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            # One id = one immutable book: caches may keep it for a year.
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
            self.send_header('Content-Length', str(len(page)))
            self.end_headers()
            self.wfile.write(page)
            return
        found = seo.respond(path)
        if found:
            # Search pages: tool landing pages, robots.txt, sitemap.xml.
            self.send_response(200)
            self.send_header('Content-Type', found[1])
            self.send_header('Cache-Control', 'public, max-age=3600')
            self.send_header('Content-Length', str(len(found[0])))
            self.end_headers()
            self.wfile.write(found[0])
            return
        relative = path.lstrip('/') or 'index.html'
        file = (ROOT / relative).resolve()
        allowed = relative in PAGES or (relative.startswith('assets/') and file.is_relative_to(ROOT / 'assets'))
        if not allowed or not file.is_relative_to(ROOT) or not file.is_file():
            self.send_error(404)
            return
        if relative in SOON_PAGES and CONFIG['paywall']:
            page = (ROOT / 'coming-soon.html').read_text(encoding='utf-8').replace(
                '<html lang="en">', f'<html lang="en" data-feature="{SOON_PAGES[relative]}">', 1).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(page)))
            self.end_headers()
            self.wfile.write(page)
            return
        if relative in EXPORT_TEMPLATES:
            denied = self.entitlement_error('export')
            if denied:
                self.send_json(denied[0], {'error': denied[1]})
                return
        if relative in PAGES and seo.app_head(relative):
            # App pages get their description / canonical / social tags here.
            page = seo.add_head(relative, file.read_bytes())
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(page)))
            self.end_headers()
            self.wfile.write(page)
            return
        super().do_GET()

    def fetch_source_route(self):
        """Add file -> link: download a document (or print a web page) for the flipbook."""
        try:
            size = int(self.headers.get('Content-Length', '0'))
            payload = json.loads(self.rfile.read(size) if 0 < size <= 8192 else b'{}')
            url = payload.get('url') if isinstance(payload, dict) else None
            if not isinstance(url, str):
                raise ValueError('Tempel link dulu.')
            data, name, ctype = fetch_source(url, public_only=hosted())
        except (ValueError, json.JSONDecodeError) as cause:
            self.send_json(400, {'error': str(cause)})
            return
        except RuntimeError as cause:
            self.send_json(503 if 'tidak ditemukan' in str(cause) else 400, {'error': str(cause)})
            return
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('X-Filename', quote(name))
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def convert_html(self):
        """HTML upload -> PDF printed by headless Edge/Chrome."""
        if self.headers.get_content_type() != 'text/html':
            self.send_json(400, {'error': 'Kirim file .html / .htm.'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            size = -1
        if size <= 0 or size > HTML_MAX_BYTES:
            self.send_json(400, {'error': 'Ukuran file HTML tidak valid (maksimal 20 MB).'})
            return
        name = re.sub(r'[^A-Za-z0-9._-]', '_', unquote(self.headers.get('X-Filename', '')))
        if Path(name).suffix.lower() not in {'.html', '.htm'}:
            self.send_json(400, {'error': 'Ekstensi file harus .html atau .htm.'})
            return
        self.connection.settimeout(120)
        raw = self.rfile.read(size)
        if len(raw) != size:
            self.send_json(400, {'error': 'Upload tidak lengkap.'})
            return
        try:
            margin = float(self.headers.get('X-Margin', '12'))
        except ValueError:
            margin = 12
        try:
            pdf_bytes = html_to_pdf(raw, self.headers.get('X-Page-Size', 'a4'), margin, allow_network=not hosted())
        except RuntimeError as cause:
            missing = 'tidak ditemukan' in str(cause)
            self.send_json(503 if missing else 400, {'error': str(cause)})
            return
        except ValueError as cause:
            self.send_json(400, {'error': str(cause)})
            return
        download = (Path(name).stem[:90].strip('.') or 'page') + '.pdf'
        self.send_response(200)
        self.send_header('Content-Type', 'application/pdf')
        self.send_header('Content-Disposition', f'attachment; filename="{download}"')
        self.send_header('Content-Length', str(len(pdf_bytes)))
        self.end_headers()
        self.wfile.write(pdf_bytes)

    def convert_office(self):
        """Stream an Office upload to disk and convert via LibreOffice."""
        mime = self.headers.get_content_type()
        if mime not in OFFICE_MIMES or OFFICE_MIMES[mime] not in OFFICE_ROUTES[self.path]:
            self.send_json(400, {'error': 'Tipe file tidak sesuai dengan alat konversi.'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0:
                raise ValueError('File presentasi kosong.')
        except ValueError:
            self.send_json(400, {'error': 'Ukuran upload tidak valid.'})
            return
        raw_name = unquote(self.headers.get('X-Filename', ''))
        if Path(raw_name).suffix.lower() != OFFICE_MIMES[mime]:
            self.send_json(400, {'error': 'Ekstensi file tidak cocok dengan tipe konten.'})
            return
        name = safe_office_name(self.headers.get('X-Filename', ''))
        if not name.lower().endswith(OFFICE_MIMES[mime]):
            self.send_json(400, {'error': 'Ekstensi file tidak cocok dengan tipe konten.'})
            return
        tmpdir = tempfile.mkdtemp(prefix='office-upload-')
        try:
            source = Path(tmpdir) / name
            self.connection.settimeout(300)
            with source.open('wb') as output:
                remaining = size
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError('Upload tidak lengkap.')
                    output.write(chunk)
                    remaining -= len(chunk)
            try:
                pdf_bytes, download = office_to_pdf(source, name)
            except RuntimeError as cause:
                missing = 'tidak ditemukan' in str(cause)
                self.send_json(503 if missing else 400, {'error': str(cause)})
                return
            except ValueError as cause:
                self.send_json(400, {'error': str(cause)})
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('Content-Disposition', f'attachment; filename="{download}"')
            self.send_header('Content-Length', str(len(pdf_bytes)))
            self.end_headers()
            self.wfile.write(pdf_bytes)
        except Exception as cause:
            self.send_json(400, {'error': str(cause)})
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def do_HEAD(self):
        self.send_error(405)

    def do_POST(self):
        if not self.trusted():
            self.send_json(403, {'error': 'Akses ditolak.'})
            return
        if self.path.startswith('/api/worker/'):
            self.worker_route('POST')
            return
        if self.path == '/api/visit':
            self.count_visit()
            return
        if self.path.startswith(('/api/auth/', '/api/billing/', '/api/payment/')):
            try:
                self.account_post(self.path)
            except accounts.AccountError as cause:
                self.send_json(cause.status, {'error': str(cause), 'success': False})
            return
        if self.path.startswith('/api/library/'):
            try:
                self.library_post(self.path)
            except accounts.AccountError as cause:
                self.send_json(cause.status, {'error': str(cause)})
            return
        if self.path == '/api/share' or self.path.startswith('/api/share/'):
            try:
                self.share_post(self.path)
            except accounts.AccountError as cause:
                self.send_json(cause.status, {'error': str(cause)})
            return
        match = re.fullmatch(r'/api/build/(apk|exe)', self.path)
        feature = 'office' if self.path in OFFICE_ROUTES or self.path == '/api/fetch-source' else 'ai' if self.path in ('/api/podcast/script', '/api/translate', '/api/translate-free', '/api/summary', '/api/highlight-summary') else match[1] if match else None
        denied = feature and self.entitlement_error(feature)
        if denied:
            self.send_json(denied[0], {'error': denied[1]})
            return
        if not secrets.compare_digest(self.headers.get('X-Build-Token', ''), TOKEN):
            self.send_json(403, {'error': 'Sesi build tidak valid. Refresh halaman.'})
            return
        if feature in ('office', 'ai') and self.path != '/api/translate-free':      # book translation counts its text
            try:
                self.quota(feature)
            except accounts.AccountError as cause:
                self.send_json(cause.status, {'error': str(cause)})
                return
        if self.path == '/api/convert/html-to-pdf':
            self.convert_html()
            return
        if self.path == '/api/fetch-source':
            self.fetch_source_route()
            return
        if self.path == '/api/podcast/script':
            self.podcast_route()
            return
        if self.path == '/api/translate':
            self.translate_route()
            return
        if self.path == '/api/translate-free':
            self.translate_route(free=True)
            return
        if self.path == '/api/summary':
            self.summary_route()
            return
        if self.path == '/api/highlight-summary':
            self.highlight_summary_route()
            return
        if self.path in OFFICE_ROUTES:
            self.convert_office()
            return
        if not match or self.headers.get_content_type() != 'application/zip':
            self.send_json(400, {'error': 'Permintaan build tidak valid.'})
            return
        if remote_builds():
            self.queue_remote_build(match[1])
            return
        if not shutil.which('flutter'):
            self.send_json(503, {'error': 'Flutter tidak tersedia.'})
            return
        if not BUILD_LOCK.acquire(blocking=False):
            self.send_json(409, {'error': 'Masih ada build berjalan. Tunggu hingga selesai.'})
            return
        started = False
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0:
                raise ValueError('Paket buku kosong.')
            prune_builds()
            job_id = uuid.uuid4().hex
            folder = BUILD / job_id
            folder.mkdir(parents=True)
            self.connection.settimeout(120)
            with (folder / 'input.zip').open('wb') as output:
                remaining = size
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError('Upload tidak lengkap.')
                    output.write(chunk)
                    remaining -= len(chunk)
            JOBS[job_id] = dict(id=job_id, status='queued', message='Build menunggu…', progress=0)
            archived = self.headers.get('X-Library-Book', '')
            member = self.current_user() if archived else None
            if member and re.fullmatch(r'[0-9a-f]{32}', archived):
                JOBS[job_id].update(library_user=member, library_book=archived)
            threading.Thread(target=build_job, args=(job_id, match[1]), daemon=True).start()
            started = True
            self.send_json(202, {'id': job_id})
        except Exception as cause:
            if not started:
                BUILD_LOCK.release()
            self.send_json(400, {'error': str(cause)})


if __name__ == '__main__':
    load_env(ROOT / '.env')
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--host', default='127.0.0.1',
                        help='127.0.0.1 = PC ini saja (default); 0.0.0.0 = boleh diakses PC lain di jaringan tepercaya')
    parser.add_argument('--public-host', action='append', default=[],
                        help='Domain publik (bisa diulang), mis. myflipbook.id. Mengaktifkan mode hosting: '
                             'login wajib untuk fitur server, cookie Secure, pembayaran Midtrans.')
    parser.add_argument('--no-paywall', action='store_true',
                        help='Ekspor flipbook & build tanpa paket berbayar (pemakaian internal).')
    parser.add_argument('--no-email-verify', action='store_true',
                        help='Daftar langsung masuk tanpa verifikasi email (pemakaian internal / tes).')
    parser.add_argument('--insecure-cookies', action='store_true',
                        help='Mode hosting tanpa HTTPS (hanya untuk uji coba).')
    args = parser.parse_args()
    CONFIG['public_hosts'] = {h.strip().lower() for h in args.public_host if h.strip()}
    CONFIG['secure'] = hosted() and not args.insecure_cookies
    CONFIG['paywall'] = not args.no_paywall
    CONFIG['verify_email'] = not args.no_email_verify
    CONFIG['base_url'] = os.environ.get('MYFLIPBOOK_BASE_URL', '')
    store = get_accounts()
    if hosted():
        print('Mode hosting: ' + ', '.join(sorted(CONFIG['public_hosts'])) +
              f' | Rupiah: {store.provider.name if store.provider.name != "none" else "NONAKTIF (isi DUITKU_MERCHANT_CODE + DUITKU_API_KEY di .env)"}'
              f' | Dolar: {store.usd_provider.name if store.usd_provider.name != "none" else "NONAKTIF (isi LEMONSQUEEZY_*)"}',
              flush=True)
    # On Windows SO_REUSEADDR lets a second server silently share the port
    # (the old one keeps answering). Fail loudly instead.
    ThreadingHTTPServer.allow_reuse_address = os.name != 'nt'
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    shown = lan_ip() if args.host == '0.0.0.0' else (None if args.host.startswith('127.') else args.host)
    print(f'MyFlipbook: http://{shown or args.host}:{args.port}/', flush=True)
    if args.host == '0.0.0.0':
        print('Mode LAN: hanya untuk jaringan tepercaya (WiFi rumah/kantor).', flush=True)
    httpd.serve_forever()
