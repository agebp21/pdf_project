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
import http.client
from html import escape, unescape
import io
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
import wave
import zipfile
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, HTTPServer, SimpleHTTPRequestHandler, ThreadingHTTPServer
import urllib.error
import urllib.request
from urllib.parse import parse_qs, quote, unquote, urlencode, urljoin, urlsplit

try:
    # Verify HTTPS like the browser does (the operating system's certificate
    # store, which also fetches missing intermediate certificates): many
    # journal sites send an incomplete chain that plain Python rejects.
    import truststore
    truststore.inject_into_ssl()
except ImportError:          # optional: pip install truststore
    pass

import accounts
import text_pdf
import doab_index
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
SHARE_THEME = (ROOT / 'assets/export/share-theme.css').read_bytes()
SHARE_TOOLBAR = (ROOT / 'assets/export/share-toolbar.js').read_bytes()
SHARE_VIEW_REV = hashlib.sha256(SHARE_THEME + SHARE_TOOLBAR).hexdigest()[:12]
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
PAGES = {'index.html', 'editor.html', 'converter.html', 'workflow.html', 'library.html', 'journals.html', 'flipbook.html', 'animation.html', 'notebook.html',
         'login.html', 'account.html', 'coming-soon.html', 'privacy.html', 'terms.html',
         'hero-3d.html', 'authors.html'}          # 3D hero preview (noindex) until it moves onto the homepage
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
                            for plan in accounts.PAID for cycle in ('monthly', 'yearly')}
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


def payments_paused(user=None):
    """PAYMENTS_PAUSED=1 in .env: no new checkouts (e.g. while the gateway is being
    set up), even with gateway keys filled in. Notifications for orders already
    made still come in.
    PAYMENTS_ALLOW_EMAILS=a@b.c,…: these signed-in accounts may still check out while
    paused (e.g. the payment provider's reviewer testing the sandbox); nobody else."""
    if os.environ.get('PAYMENTS_PAUSED', '').strip().lower() not in ('1', 'true', 'yes', 'on'):
        return False
    allowed = {e.strip().lower() for e in os.environ.get('PAYMENTS_ALLOW_EMAILS', '').split(',') if e.strip()}
    return not (user and str(user.get('email', '')).lower() in allowed)


# Usage quotas per rolling window (hosted): None = no limit. Change with .env,
# e.g. QUOTA_BASIC_AI=5, QUOTA_MEDIUM_TRANSLATE=400000, QUOTA_WINDOW_HOURS=5.
QUOTAS = {
    'basic': {'office': 10, 'ai': 5, 'translate': 40_000},
    'medium': {'office': None, 'ai': 50, 'translate': 400_000},
    'pro': {'office': None, 'ai': 150, 'translate': None},
}
QUOTA_LABELS = {'office': 'konversi', 'ai': 'AI', 'translate': 'terjemahan buku'}
SUMMARY_ROUTES = ('/api/summary', '/api/highlight-summary')     # what counts against the monthly summary words


def summary_words_limit(user):
    """The member's summary words per month (accounts.SUMMARY_WORDS; .env SUMMARY_WORDS_MEDIUM /
    SUMMARY_WORDS_PRO may change them)."""
    if user['plan'] not in accounts.PAID:
        return 0
    tier = user['plan']
    value = os.environ.get(f'SUMMARY_WORDS_{tier.upper()}', '').strip()
    if value:
        return None if value.lower() in ('0', 'none', 'unlimited') else int(value)
    return accounts.SUMMARY_WORDS.get(tier)


def month_label(ts):
    t = time.gmtime(ts + accounts.WIB)
    return f'{t.tm_mday} {MONTHS_ID[t.tm_mon - 1]} {t.tm_year}'


MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']


def quota_window():
    try:
        return max(1, int(float(os.environ.get('QUOTA_WINDOW_HOURS', '5')) * 3600))
    except ValueError:
        return 5 * 3600


def quota_limit(user, kind):
    # Free members (during their trial — afterwards these features need a plan) get
    # the small allowance: that is what makes piles of new accounts not worth it.
    tier = user['plan'] if user['plan'] in accounts.PAID else accounts.FREE_PLAN
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
    text = summary['text'].strip()[:SUMMARY_MAX_CHARS]
    if not text:
        return None
    lang = summary.get('lang') if summary.get('lang') in TRANSLATE_LANGUAGES else 'id-ID'
    return dict(lang=lang, text=text)


SUMMARY_CHUNK = 60_000            # characters per part of a long book
BOOK_PARTS = 24                   # at most this many parts (bigger parts for huge books)


PART_WORDS = {'singkat': '80-120', 'sedang': '150-250', 'detail': '250-400'}   # words per chapter summary
PART_MIN_CHARS = 4_000          # a smaller chapter joins the one before it
PART_MAX_CHARS = 200_000        # of one part sent to the model
SUMMARY_MAX_CHARS = 150_000     # the whole summary (overview + every chapter)


def book_parts(text, chapters=None):
    """A long book in parts, in order: [{title, first, last, text}]. With the PDF's chapters
    ([(title, page index)]) each chapter is a part (front matter before the first one too,
    tiny chapters joined to the one before, at most BOOK_PARTS); without, even slices."""
    pages = [p for p in re.split(r'(?=\[(?:Sumber \d+: [^\]]+ — )?Halaman \d+\]\n)', text) if p.strip()]
    number = lambda p: int(re.match(r'\[Halaman (\d+)\]', p).group(1)) if re.match(r'\[Halaman (\d+)\]', p) else None
    marks = lambda t: re.findall(r'\[Halaman (\d+)\]', t)
    part = lambda title, t: dict(title=title, first=(marks(t) or [None])[0], last=(marks(t) or [None])[-1], text=t[:PART_MAX_CHARS])
    starts = sorted({(c[1] + 1, c[0]) for c in (chapters or [])}, key=lambda c: c[0])      # page numbers from 1
    starts = [c for i, c in enumerate(starts) if not i or c[0] != starts[i - 1][0]]
    if len(starts) >= 2 and pages:
        parts, current = [], dict(title=None, pages=[])
        for page in pages:
            n = number(page)
            while starts and n is not None and n >= starts[0][0]:
                if current['pages']:
                    parts.append(current)
                current = dict(title=starts.pop(0)[1], pages=[])
            current['pages'].append(page)
        parts.append(current)
        merged = []
        for p in parts:
            size = sum(len(x) for x in p['pages'])
            if merged and (size < PART_MIN_CHARS or (p['title'] is None and merged[-1]['title'] is None)):
                merged[-1]['pages'] += p['pages']
            elif not merged and p['title'] is None and size < PART_MIN_CHARS * 2 and len(parts) > 1:
                parts[1]['pages'][0:0] = p['pages']       # a short front matter joins the first chapter
            else:
                merged.append(p)
        while len(merged) > BOOK_PARTS:                    # too many: join the smallest pair of neighbours
            sizes = [sum(len(x) for x in a['pages']) + sum(len(x) for x in b['pages']) for a, b in zip(merged, merged[1:])]
            i = sizes.index(min(sizes))
            merged[i]['pages'] += merged[i + 1]['pages']; merged[i]['title'] = merged[i]['title'] or merged[i + 1]['title']
            del merged[i + 1]
        return [part(p['title'], ''.join(p['pages'])) for p in merged]
    size = max(SUMMARY_CHUNK, -(-len(text) // BOOK_PARTS))
    return [part(None, text[i:i + size]) for i in range(0, len(text), size)]


def book_notes(title, text, language, model, length='sedang', chapters=None, page='hlm.'):
    """A long book read part by part (parts run in parallel): (the notes as one text with
    [Bagian n/N] headers for the overview, [the parts with their summary])."""
    parts = book_parts(text, chapters)
    system = (f'Ringkas bagian buku ini dalam {language}, setia pada isi (jangan menambah fakta, angka, atau pendapat): pokok bahasan, '
              'argumen atau peristiwa penting, tokoh, nama, dan istilah, sesuai urutan dalam teks. '
              f'Tulis 1-3 paragraf yang runtut, sekitar {PART_WORDS.get(length, PART_WORDS["sedang"])} kata, langsung ke isinya '
              '(tanpa judul dan tanpa pembuka seperti "Bagian ini membahas"). '
              f'Sebut halaman sumber dari penanda [Halaman N] dalam kurung di akhir kalimat penting, mis. ({page} 12). Tanpa markdown.')
    def note(n):
        p = parts[n]
        p['note'] = ai_chat(system, f'Judul buku: {title}' + (f'\nBab: {p["title"]}' if p['title'] else '') + f'\n\n{p["text"]}',
                            model, max_tokens=3000).replace('**', '').replace('##', '').strip()
        p['note'] = re.sub(r'\s*\((?:hlm|hal|p|pp)\.?\s*\d*\s*$', '.', p['note']).replace('..', '.')    # a page tag cut off at the end
        span = f' (hlm. {p["first"]}–{p["last"]})' if p['first'] else ''
        return f'[Bagian {n + 1}/{len(parts)}]{span}' + (f' {p["title"]}' if p['title'] else '') + f'\n{p["note"]}'
    with ThreadPoolExecutor(max_workers=4) as pool:
        notes = list(pool.map(note, range(len(parts))))
    return 'Catatan per bagian, dari awal sampai akhir buku:\n\n' + '\n\n'.join(notes), parts


SUMMARY_LENGTHS = {      # length -> (overview sentences, key points)
    'singkat': ('1-2', '3-5'), 'sedang': ('2-4', '5-8'), 'detail': ('4-6', '10-15')}
PAGE_WORD = {'en-US': 'p.'}   # page reference in the summary's language ("hlm." otherwise)


def summarize_book(title, text, lang='id-ID', length='sedang', focus='', chapters=None):
    """A faithful summary: an overview paragraph and key points (how many: `length`),
    each point with its source page; `focus` puts one topic first. Long books are read in
    parts (their own chapters when `chapters` is given), combined into the overview, and
    each part's summary follows it ("Ringkasan per bab")."""
    model = os.environ.get('SUMMARY_MODEL', '').strip() or os.environ.get('PODCAST_MODEL', 'claude-sonnet-5').strip()
    language = TRANSLATE_LANGUAGES.get(lang, TRANSLATE_LANGUAGES['id-ID'])
    heads = {'en-US': ('Overview', 'Key points', 'Key terms'), 'ms-MY': ('Intisari', 'Perkara penting', 'Istilah penting')}.get(
        lang, ('Intisari', 'Poin penting', 'Istilah penting'))
    sentences, points = SUMMARY_LENGTHS.get(length, SUMMARY_LENGTHS['sedang'])
    page = PAGE_WORD.get(lang, 'hlm.')
    focus = ' '.join(str(focus or '').split())[:200]
    parts = []
    if len(text) > SUMMARY_CHUNK * 1.2:
        source, parts = book_notes(title, text, language, model, length, chapters, page)
    else:
        source = text
    system = (f'Kamu editor buku. Tulis ringkasan buku dalam {language}, setia pada isi (jangan menambah fakta, angka, atau pendapat). Format persis:\n'
              f'Baris pertama: judul bagian "{heads[0]}", lalu {sentences} kalimat inti buku.\n'
              f'Lalu baris "{heads[1]}" diikuti {points} butir, tiap butir satu baris diawali "- ".\n'
              + (f'Lalu baris "{heads[2]}" diikuti 3-8 butir "- istilah: arti singkat" dari teks.\n' if length == 'detail' else '')
              + ('Jika teks memuat penanda [Halaman N] atau (hlm. N), akhiri tiap butir dengan halaman sumbernya dalam kurung, '
                 f'mis. ({page} 12) atau ({page} 12-14); jangan menebak halaman.\n' if 'Halaman ' in source or re.search(r'\(hlm\. \d', source) else '')
              + (f'Utamakan hal yang berkaitan dengan: {focus}. Jika teks tidak membahasnya, katakan singkat di intisari.\n' if focus else '')
              + 'Tanpa markdown lain (tanpa #, **, atau tabel).')
    for _ in range(2):
        reply = ai_chat(system, f'Judul buku: {title}\n\n{source}', model, max_tokens=4000)
        reply = reply.replace('**', '').replace('##', '').strip()
        if len(reply.split()) >= 30:
            if parts:                              # every part's summary, under its own heading
                by_chapter = any(p['title'] for p in parts)
                head = {'en-US': ('Chapter by chapter', 'Part'), 'ms-MY': ('Ringkasan setiap bab', 'Bahagian')}.get(
                    lang, ('Ringkasan per bab', 'Bagian'))
                head = (head[0] if by_chapter else {'en-US': 'Part by part', 'ms-MY': 'Ringkasan setiap bahagian'}.get(lang, 'Ringkasan per bagian'), head[1])
                lines = [f'### {head[0]}']
                for n, p in enumerate(parts, 1):
                    span = f' ({page} {p["first"]}–{p["last"]})' if p['first'] and p['first'] != p['last'] else (f' ({page} {p["first"]})' if p['first'] else '')
                    lines.append(f'### {p["title"] or f"{head[1]} {n}"}{span}\n{p.get("note", "")}')
                reply += '\n\n' + '\n\n'.join(lines)
            return dict(lang=lang, text=reply[:SUMMARY_MAX_CHARS], model=model, parts=len(parts))
    raise RuntimeError('AI tidak menghasilkan ringkasan. Coba lagi.')


ASK_MAX_CHARS = 80_000      # of the document sent with one question
ASK_HISTORY = 6             # earlier turns kept
WORK_MAX_CHARS = 20_000     # of the member's own work sent along (notes, summary, journal, slides)


def ask_pages(text, question):
    """The pages of a long document that best fit the question (word overlap, rarer words
    weigh more), with their neighbours, in page order, up to ASK_MAX_CHARS."""
    if len(text) <= ASK_MAX_CHARS:
        return text
    pages = [p for p in re.split(r'(?=\[(?:Sumber \d+: [^\]]+ — )?Halaman \d+\]\n)', text) if p.strip()]
    words = lambda t: set(re.findall(r'\w{3,}', t.lower()))
    sets = [words(p) for p in pages]
    wanted = words(question)
    count = {w: sum(w in s for s in sets) for w in wanted}
    score = [sum(math.log(1 + len(pages) / count[w]) for w in wanted & s if count[w]) for s in sets]
    keep, size = set(), 0
    for i in sorted(range(len(pages)), key=lambda i: (-score[i], i)):
        for j in (i, i - 1, i + 1):
            if 0 <= j < len(pages) and j not in keep and size + len(pages[j]) <= ASK_MAX_CHARS:
                keep.add(j); size += len(pages[j])
        if size >= ASK_MAX_CHARS * 0.95:
            break
    return '\n\n'.join(pages[i] for i in sorted(keep))


def clean_work(work):
    """The member's own work sent with a request (notes, summary, journal draft) as plain
    text, at most WORK_MAX_CHARS."""
    if not isinstance(work, str):
        return ''
    lines = [' '.join(line.split()) for line in work.splitlines()]
    return '\n'.join(line for line in lines if line)[:WORK_MAX_CHARS]


def ask_document(title, text, question, history=(), work='', include_thoughts=False):
    """An answer to a reader's question, from the document (and the reader's own notes on it,
    `work`) only, with source+page references. One or several sources: `text` carries bare
    `[Halaman N]` tags for one source, `[Sumber I: Name — Halaman N]` tags for several (see
    `Handler.sources_text`) — the citation instruction below matches whichever it finds.
    `include_thoughts=True` returns `(answer, thoughts)` instead of just the answer string."""
    question = ' '.join(str(question or '').split())[:1000]
    if len(question) < 2:
        raise ValueError('Tulis pertanyaan Anda dulu.')
    model = (os.environ.get('ASK_MODEL', '').strip() or os.environ.get('SUMMARY_MODEL', '').strip()
             or os.environ.get('PODCAST_MODEL', 'claude-sonnet-5').strip())
    turns = ''.join(f'{"Pembaca" if t.get("role") == "user" else "Asisten"}: {str(t.get("text") or "")[:2000]}\n'
                    for t in list(history)[-ASK_HISTORY:] if isinstance(t, dict))
    work = clean_work(work)
    multi = bool(re.search(r'\[Sumber \d+:', text))
    cite = ('Sebut sumber dan halamannya dari penanda [Sumber I: Nama — Halaman N] dalam kurung, persis format '
            '(Sumber I, hlm. N) — untuk jawaban berbahasa Inggris (Source I, p. N). Gunakan hanya kombinasi sumber+halaman '
            'yang ada dalam SUMBER. Setiap poin penting harus punya rujukan sumber dan halaman.' if multi else
            'Sebut halaman sumber dari penanda [Halaman N] dalam kurung, mis. (hlm. 12) — untuk jawaban berbahasa Inggris '
            '(p. 12). Gunakan hanya nomor halaman yang ada dalam SUMBER. Setiap poin penting harus punya rujukan halaman.')
    system = ('Kamu asisten baca yang menjawab pertanyaan pembaca tentang dokumen di bawah. Jawab HANYA dari isi dokumen; '
              'jangan menambah fakta, angka, atau pendapat dari luar. Ikuti maksud pertanyaan TERAKHIR, bukan mengulang '
              'jawaban sebelumnya. Percakapan sebelumnya hanya konteks. Jika pembaca meminta mengubah jawaban terakhir '
              'menjadi bentuk lain (misalnya paragraf, jurnal, tinjauan pustaka, tabel, atau bahasa lain), buat hasil baru '
              'dengan struktur dan gaya yang diminta; jangan sekadar menyalin daftar poin yang lama. Untuk permintaan '
              'jurnal, tulis prosa dengan bagian yang relevan dan penghubung antar gagasan. Jangan mengarang daftar pustaka '
              'atau referensi akademik yang tidak ada dalam sumber. Hanya jika permintaan TERAKHIR secara eksplisit '
              'meminta referensi eksternal yang belum menjadi sumber, jelaskan singkat bahwa sumber tambahan perlu '
              'dimasukkan; jangan tambahkan catatan ini pada jawaban lain. Jika dokumen tidak membahas '
              'jawabannya, katakan terus terang. Jawab dalam bahasa yang sama dengan pertanyaan; panjang jawaban '
              f'mengikuti bentuk yang diminta. {cite} Tanpa markdown dekoratif (** atau tabel).'
              + (' Pembaca juga punya hasil kerja sendiri (catatan, ringkasan, draf jurnal, slide) di bagian "HASIL KERJA PEMBACA": '
                 'pakai untuk pertanyaan tentang pekerjaannya (mis. memeriksa, melengkapi, atau membandingkan dengan dokumen), '
                 'tetapi bedakan dengan jelas mana yang dari dokumen dan mana yang dari catatan pembaca.' if work else ''))
    user = (f'Judul dokumen: {title}\n\n{ask_pages(text, question + " " + turns[-500:])}\n\n'
            + (f'HASIL KERJA PEMBACA:\n{work}\n\n' if work else '')
            + (f'Percakapan sebelumnya:\n{turns}\n' if turns else '') + f'PERMINTAAN TERAKHIR (jawab ini): {question}')
    reply = ai_chat(system, user, model, max_tokens=3500, include_thoughts=include_thoughts)
    thoughts = ''
    if include_thoughts:
        reply, thoughts = reply
    reply = reply.replace('**', '').replace('##', '').strip()
    if not reply:
        raise RuntimeError('AI tidak menjawab. Coba lagi.')
    reply = reply[:12000]
    return (reply, thoughts[:4000]) if include_thoughts else reply


CITE_PAIR = re.compile(r'\(?\s*(?:Sumber|Source)\s*(\d+)\s*[,:]?\s*(?:hlm\.?|hal\.?|p\.?)\s*(\d+)\s*\)?', re.I)
CITE_PAGE = re.compile(r'\(?\s*\b(?:hlm\.?|hal\.?|p\.?)\s*(\d+)\s*\)?', re.I)


def ask_citations(index, names, answer, question, limit=6):
    """The answer with each source+page citation replaced by a numbered `[n]` marker, and the
    ordered, deduplicated list those markers point to: `[{n, source, page, excerpt}]`, the
    excerpt a literal line from that source's page (never synthesized). `index` maps
    `(source_number, page_number) -> raw lines`, `names` maps `source_number -> its label`
    (see `Handler.sources_text`)."""
    if not isinstance(index, dict) or not index:
        return answer, []
    multi = any(source != 1 for source, _ in index)
    wanted = set(re.findall(r'\w{4,}', (question + ' ' + answer).lower()))
    seen, citations = {}, []

    def excerpt(source, page):
        lines = index.get((source, page))
        if not lines:
            return None
        passages = [' '.join(str(line).split()) for line in lines if str(line).strip()]
        if not passages:
            return None
        line = max(passages, key=lambda p: (len(wanted & set(re.findall(r'\w{4,}', p.lower()))), min(len(p), 500)))
        return line[:320] + ('…' if len(line) > 320 else '')

    def mark(source, page, original):
        key = (source, page)
        if key not in index:
            return original
        if key not in seen:
            if len(citations) >= limit:
                return original
            text = excerpt(source, page)
            if text is None:
                return original
            seen[key] = len(citations) + 1
            citations.append({'n': seen[key], 'source': names.get(source, f'Sumber {source}'), 'page': page, 'excerpt': text})
        return f'[{seen[key]}]'

    if multi:
        rewritten = CITE_PAIR.sub(lambda m: mark(int(m[1]), int(m[2]), m[0]), answer)
    else:
        rewritten = CITE_PAGE.sub(lambda m: mark(1, int(m[1]), m[0]), answer)
    return rewritten, citations


# A journal article draft, section by section (AI Summarizer > Jurnal): what each section holds.
JOURNAL_SECTIONS = {
    'judul': ('Judul', 'satu judul artikel ilmiah yang padat dan informatif, maksimal 20 kata, tanpa titik di akhir'),
    'abstrak': ('Abstrak', 'satu paragraf 150-250 kata: latar belakang, tujuan, metode atau sumber, temuan utama, dan simpulan'),
    'kata_kunci': ('Kata kunci', '3-6 kata kunci dipisahkan titik koma, dalam satu baris'),
    'pendahuluan': ('Pendahuluan', '3-5 paragraf: latar belakang, masalah, celah yang dibahas, dan tujuan tulisan'),
    'metode': ('Metode', '2-4 paragraf: pendekatan, sumber data atau bahan yang dikaji, dan cara analisis, sejauh ada di sumber'),
    'hasil': ('Hasil', '3-5 paragraf (boleh butir "- ") berisi temuan utama dari sumber'),
    'pembahasan': ('Pembahasan', '3-5 paragraf yang menafsirkan temuan, mengaitkan antarbagian sumber, dan menyebut keterbatasan'),
    'kesimpulan': ('Kesimpulan', '1-2 paragraf simpulan dan saran'),
}
SLIDES_MIN, SLIDES_MAX = 3, 20


def writing_model():
    return os.environ.get('SUMMARY_MODEL', '').strip() or os.environ.get('PODCAST_MODEL', 'claude-sonnet-5').strip()


def write_journal(title, text, section, lang='id-ID', work=''):
    """One section of a journal article draft from the highlighted source (and the member's
    notes), faithful to them, with page references."""
    if section not in JOURNAL_SECTIONS:
        raise ValueError('Bagian jurnal tidak dikenal.')
    name, what = JOURNAL_SECTIONS[section]
    language = TRANSLATE_LANGUAGES.get(lang, TRANSLATE_LANGUAGES['id-ID'])
    work = clean_work(work)
    page = PAGE_WORD.get(lang, 'hlm.')
    system = (f'Kamu membantu menulis draf artikel jurnal ilmiah dalam {language} yang baku. Tulis HANYA bagian "{name}": {what}. '
              'Gunakan hanya isi SUMBER (bagian dokumen yang distabilo pembaca) dan CATATAN PEMBACA; jangan mengarang data, angka, '
              'kutipan, nama, atau rujukan lain. Jika sumber tidak cukup untuk bagian ini, tulis seadanya dan tandai bagian yang perlu '
              'dilengkapi penulis dengan [lengkapi: ...]. '
              + ('' if section in ('judul', 'kata_kunci') else
                 f'Sebut halaman sumber dari penanda [Halaman N] dalam kurung di akhir kalimat yang memakainya, mis. ({page} 12). ')
              + 'Langsung tulis isinya, tanpa judul bagian, tanpa pembuka, tanpa markdown (tanpa #, **, atau tabel).')
    user = (f'Judul dokumen sumber: {title}\n\nSUMBER:\n{ask_pages(text, name + " " + work[:500])}'
            + (f'\n\nCATATAN PEMBACA (draf dan catatannya sejauh ini):\n{work}' if work else ''))
    reply = ai_chat(system, user, writing_model(), max_tokens=3000).replace('**', '').replace('##', '').strip()
    if not reply:
        raise RuntimeError('AI tidak menghasilkan tulisan. Coba lagi.')
    if section in ('judul', 'kata_kunci'):
        reply = ' '.join(reply.split()).strip('"')
    return reply[:12000]


def parse_slides(reply):
    """The slides in an AI reply: [{title, points: [...], notes}], however it was wrapped."""
    start, end = reply.find('{'), reply.rfind('}')
    try:
        data = json.loads(reply[start:end + 1]) if start >= 0 < end else None
    except json.JSONDecodeError:
        data = None
    rows = data.get('slides') if isinstance(data, dict) else None
    out = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        head = ' '.join(str(row.get('title') or '').split())[:160]
        points = [' '.join(str(x).split())[:300] for x in (row.get('points') or []) if isinstance(x, (str, int, float)) and str(x).strip()][:8]
        notes = ' '.join(str(row.get('notes') or '').split())[:1500]
        if head or points:
            out.append({'title': head, 'points': points, 'notes': notes})
    return out[:SLIDES_MAX]


def make_slides(title, text, lang='id-ID', count=8, work=''):
    """A presentation from the highlighted source (and the member's notes): `count` content
    slides, each a title, 3-5 short points and speaker notes."""
    count = max(SLIDES_MIN, min(SLIDES_MAX, int(count or 8)))
    language = TRANSLATE_LANGUAGES.get(lang, TRANSLATE_LANGUAGES['id-ID'])
    work = clean_work(work)
    page = PAGE_WORD.get(lang, 'hlm.')
    system = (f'Kamu menyusun slide presentasi dalam {language} dari SUMBER (bagian dokumen yang distabilo) dan CATATAN PEMBACA. '
              f'Buat tepat {count} slide isi (tanpa slide judul pembuka; slide terakhir berisi kesimpulan). Tiap slide: judul pendek '
              '(maks. 8 kata), 3-5 poin singkat (maks. 14 kata per poin, bukan kalimat panjang), dan catatan pembicara 2-4 kalimat '
              f'yang menyebut halaman sumber, mis. ({page} 12). Setia pada isi sumber: jangan mengarang data, angka, atau kutipan. '
              'Balas HANYA JSON valid tanpa teks lain, persis bentuk ini: '
              '{"slides":[{"title":"...","points":["...","..."],"notes":"..."}]}')
    user = (f'Judul dokumen: {title}\n\nSUMBER:\n{ask_pages(text, title + " " + work[:500])}'
            + (f'\n\nCATATAN PEMBACA:\n{work}' if work else ''))
    model = writing_model()
    for _ in range(2):
        slides = parse_slides(ai_chat(system, user, model, max_tokens=6000))
        if len(slides) >= min(3, count):
            return slides
    raise RuntimeError('AI tidak menghasilkan slide. Coba lagi.')


QUIZ_MIN, QUIZ_MAX = 3, 15


def parse_quiz(reply):
    """The quiz in an AI reply: [{q, choices: [...4], answer: int, explanation}]."""
    start, end = reply.find('{'), reply.rfind('}')
    try:
        data = json.loads(reply[start:end + 1]) if start >= 0 < end else None
    except json.JSONDecodeError:
        data = None
    rows = data.get('questions') if isinstance(data, dict) else None
    out = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        q = ' '.join(str(row.get('q') or '').split())[:300]
        choices = [' '.join(str(x).split())[:200] for x in (row.get('choices') or []) if isinstance(x, (str, int, float)) and str(x).strip()][:4]
        answer = row.get('answer')
        explanation = ' '.join(str(row.get('explanation') or '').split())[:500]
        if q and len(choices) == 4 and isinstance(answer, int) and 0 <= answer < 4:
            out.append({'q': q, 'choices': choices, 'answer': answer, 'explanation': explanation})
    return out[:QUIZ_MAX]


def make_quiz(title, text, lang='id-ID', count=8, work=''):
    """A multiple-choice quiz from the highlighted source (and the member's notes): `count`
    questions, each with exactly 4 choices, one correct answer, and a short explanation."""
    count = max(QUIZ_MIN, min(QUIZ_MAX, int(count or 8)))
    language = TRANSLATE_LANGUAGES.get(lang, TRANSLATE_LANGUAGES['id-ID'])
    work = clean_work(work)
    system = (f'Kamu menyusun kuis pilihan ganda dalam {language} dari SUMBER (bagian dokumen yang distabilo) dan CATATAN PEMBACA. '
              f'Buat tepat {count} soal. Tiap soal: pertanyaan jelas, persis 4 pilihan jawaban (hanya satu yang benar), indeks jawaban '
              'benar (0-3), dan penjelasan singkat 1-2 kalimat kenapa jawaban itu benar. Setia pada isi sumber: jangan mengarang fakta '
              'atau angka. Balas HANYA JSON valid tanpa teks lain, persis bentuk ini: '
              '{"questions":[{"q":"...","choices":["...","...","...","..."],"answer":0,"explanation":"..."}]}')
    user = (f'Judul dokumen: {title}\n\nSUMBER:\n{ask_pages(text, title + " " + work[:500])}'
            + (f'\n\nCATATAN PEMBACA:\n{work}' if work else ''))
    model = writing_model()
    for _ in range(2):
        quiz = parse_quiz(ai_chat(system, user, model, max_tokens=6000))
        if len(quiz) >= min(3, count):
            return quiz
    raise RuntimeError('AI tidak menghasilkan kuis. Coba lagi.')


FLASHCARD_MIN, FLASHCARD_MAX = 5, 30


def parse_flashcards(reply):
    """The flashcards in an AI reply: [{term, definition}]."""
    start, end = reply.find('{'), reply.rfind('}')
    try:
        data = json.loads(reply[start:end + 1]) if start >= 0 < end else None
    except json.JSONDecodeError:
        data = None
    rows = data.get('cards') if isinstance(data, dict) else None
    out = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        term = ' '.join(str(row.get('term') or '').split())[:150]
        definition = ' '.join(str(row.get('definition') or '').split())[:400]
        if term and definition:
            out.append({'term': term, 'definition': definition})
    return out[:FLASHCARD_MAX]


def make_flashcards(title, text, lang='id-ID', count=12, work=''):
    """Term/definition flashcards from the highlighted source (and the member's notes)."""
    count = max(FLASHCARD_MIN, min(FLASHCARD_MAX, int(count or 12)))
    language = TRANSLATE_LANGUAGES.get(lang, TRANSLATE_LANGUAGES['id-ID'])
    work = clean_work(work)
    system = (f'Kamu menyusun kartu hafalan (flashcard) dalam {language} dari SUMBER (bagian dokumen yang distabilo) dan CATATAN PEMBACA. '
              f'Buat tepat {count} kartu: istilah atau konsep penting di satu sisi, definisi atau penjelasan singkat (1-2 kalimat) di sisi '
              'lain. Satu istilah tidak berulang. Setia pada isi sumber: jangan mengarang definisi. Balas HANYA JSON valid tanpa teks lain, '
              'persis bentuk ini: {"cards":[{"term":"...","definition":"..."}]}')
    user = (f'Judul dokumen: {title}\n\nSUMBER:\n{ask_pages(text, title + " " + work[:500])}'
            + (f'\n\nCATATAN PEMBACA:\n{work}' if work else ''))
    model = writing_model()
    for _ in range(2):
        cards = parse_flashcards(ai_chat(system, user, model, max_tokens=6000))
        if len(cards) >= min(5, count):
            return cards
    raise RuntimeError('AI tidak menghasilkan kartu hafalan. Coba lagi.')


TABLE_MAX_ROWS, TABLE_MAX_COLS = 60, 10


def parse_table(reply):
    """The table in an AI reply: {headers: [...], rows: [[...], ...]}, every row padded/cut to
    the header's width."""
    start, end = reply.find('{'), reply.rfind('}')
    try:
        data = json.loads(reply[start:end + 1]) if start >= 0 < end else None
    except json.JSONDecodeError:
        data = None
    table = data.get('table') if isinstance(data, dict) else None
    headers = [' '.join(str(h).split())[:80] for h in (table.get('headers') or [])][:TABLE_MAX_COLS] if isinstance(table, dict) else []
    if not headers:
        return {'headers': [], 'rows': []}
    width = len(headers)
    rows = []
    for row in (table.get('rows') or [])[:TABLE_MAX_ROWS] if isinstance(table, dict) else []:
        if not isinstance(row, list):
            continue
        cells = [' '.join(str(c).split())[:200] for c in row[:width]]
        cells += [''] * (width - len(cells))
        rows.append(cells)
    return {'headers': headers, 'rows': rows}


MINDMAP_MAX_CHILDREN, MINDMAP_MAX_DEPTH = 6, 3


def parse_mindmap(reply, depth=0):
    """One mind-map node from an AI reply (or sub-reply): {label, children: [...]}, recursive,
    capped at MINDMAP_MAX_DEPTH levels and MINDMAP_MAX_CHILDREN per node."""
    if depth == 0:
        start, end = reply.find('{'), reply.rfind('}')
        try:
            node = json.loads(reply[start:end + 1]) if start >= 0 < end else None
        except json.JSONDecodeError:
            node = None
    else:
        node = reply
    if not isinstance(node, dict):
        return None
    label = ' '.join(str(node.get('label') or '').split())[:120]
    if not label:
        return None
    children = []
    if depth < MINDMAP_MAX_DEPTH - 1:
        for child in (node.get('children') or [])[:MINDMAP_MAX_CHILDREN]:
            parsed = parse_mindmap(child, depth + 1)
            if parsed:
                children.append(parsed)
    return {'label': label, 'children': children}


def make_mindmap(title, text, lang='id-ID', work=''):
    """A mind-map outline (a root idea and branching sub-ideas) from the highlighted source
    (and the member's notes), up to MINDMAP_MAX_DEPTH levels deep."""
    language = TRANSLATE_LANGUAGES.get(lang, TRANSLATE_LANGUAGES['id-ID'])
    work = clean_work(work)
    system = (f'Kamu menyusun peta pikiran (mind map) dalam {language} dari SUMBER (bagian dokumen yang distabilo) dan CATATAN PEMBACA. '
              f'Buat struktur pohon: satu gagasan utama (root), sampai {MINDMAP_MAX_CHILDREN} cabang utama, tiap cabang boleh punya sampai '
              f'{MINDMAP_MAX_CHILDREN} anak cabang (maksimal {MINDMAP_MAX_DEPTH} tingkat termasuk root). Tiap label singkat (maks. 6 kata). '
              'Setia pada isi sumber: jangan mengarang gagasan yang tidak ada. Balas HANYA JSON valid tanpa teks lain, persis bentuk ini '
              '(children boleh kosong []): {"label":"...","children":[{"label":"...","children":[{"label":"...","children":[]}]}]}')
    user = f'Judul dokumen: {title}\n\nSUMBER:\n{ask_pages(text, title + " " + work[:500])}' + (f'\n\nCATATAN PEMBACA:\n{work}' if work else '')
    model = writing_model()
    for _ in range(2):
        tree = parse_mindmap(ai_chat(system, user, model, max_tokens=4000))
        if tree and tree['children']:
            return tree
    raise RuntimeError('AI tidak menghasilkan peta pikiran. Coba lagi.')


INFOGRAPHIC_MAX_STATS, INFOGRAPHIC_MAX_POINTS = 6, 6


def parse_infographic(reply):
    """The infographic content in an AI reply: {headline, stats: [{value, label}], points: [...]}."""
    start, end = reply.find('{'), reply.rfind('}')
    try:
        data = json.loads(reply[start:end + 1]) if start >= 0 < end else None
    except json.JSONDecodeError:
        data = None
    if not isinstance(data, dict):
        return {'headline': '', 'stats': [], 'points': []}
    headline = ' '.join(str(data.get('headline') or '').split())[:120]
    stats = []
    for row in (data.get('stats') or [])[:INFOGRAPHIC_MAX_STATS]:
        if not isinstance(row, dict):
            continue
        value = ' '.join(str(row.get('value') or '').split())[:40]
        label = ' '.join(str(row.get('label') or '').split())[:80]
        if value and label:
            stats.append({'value': value, 'label': label})
    points = [' '.join(str(p).split())[:160] for p in (data.get('points') or []) if isinstance(p, (str, int, float)) and str(p).strip()][:INFOGRAPHIC_MAX_POINTS]
    return {'headline': headline, 'stats': stats, 'points': points}


def make_infographic(title, text, lang='id-ID', work=''):
    """A one-page infographic's content from the highlighted source (and the member's notes):
    a headline, a handful of standout numbers, and a few key points."""
    language = TRANSLATE_LANGUAGES.get(lang, TRANSLATE_LANGUAGES['id-ID'])
    work = clean_work(work)
    system = (f'Kamu menyusun isi infografis satu halaman dalam {language} dari SUMBER (bagian dokumen yang distabilo) dan CATATAN PEMBACA. '
              f'Buat: satu headline singkat (maks. 10 kata), sampai {INFOGRAPHIC_MAX_STATS} angka atau statistik mencolok dari sumber (tiap '
              'satu nilai pendek, mis. "72%", dan label singkat penjelas), dan sampai '
              f'{INFOGRAPHIC_MAX_POINTS} poin kunci singkat (maks. 14 kata tiap poin). Setia pada isi sumber: jangan mengarang angka. Jika '
              'sumber tidak punya angka mencolok, kosongkan stats dan fokus ke poin kunci. Balas HANYA JSON valid tanpa teks lain, persis '
              'bentuk ini: {"headline":"...","stats":[{"value":"...","label":"..."}],"points":["...","..."]}')
    user = f'Judul dokumen: {title}\n\nSUMBER:\n{ask_pages(text, title + " " + work[:500])}' + (f'\n\nCATATAN PEMBACA:\n{work}' if work else '')
    model = writing_model()
    for _ in range(2):
        info = parse_infographic(ai_chat(system, user, model, max_tokens=3000))
        if info['headline'] and (info['stats'] or info['points']):
            return info
    raise RuntimeError('AI tidak menghasilkan infografis. Coba lagi.')


def make_table(title, text, lang='id-ID', work=''):
    """A data table extracted from the highlighted source (and the member's notes) — whatever
    tabular data (figures, comparisons, a list of items with attributes) the source actually
    has; never invented rows."""
    language = TRANSLATE_LANGUAGES.get(lang, TRANSLATE_LANGUAGES['id-ID'])
    work = clean_work(work)
    system = (f'Kamu mengekstrak data tabel dalam {language} dari SUMBER (bagian dokumen yang distabilo) dan CATATAN PEMBACA. Cari data '
              'yang berbentuk tabel, daftar perbandingan, atau angka berkelompok di sumber, lalu susun sebagai tabel (maks '
              f'{TABLE_MAX_COLS} kolom, {TABLE_MAX_ROWS} baris). Jangan mengarang angka atau baris yang tidak ada di sumber; jika sumber '
              'tidak punya data tabular yang jelas, buat tabel ringkasan poin-poin kunci sebagai gantinya (kolom "Poin" dan "Keterangan"). '
              'Balas HANYA JSON valid tanpa teks lain, persis bentuk ini: {"table":{"headers":["...","..."],"rows":[["...","..."]]}}')
    user = f'Judul dokumen: {title}\n\nSUMBER:\n{ask_pages(text, title + " " + work[:500])}' + (f'\n\nCATATAN PEMBACA:\n{work}' if work else '')
    model = writing_model()
    for _ in range(2):
        table = parse_table(ai_chat(system, user, model, max_tokens=6000))
        if table['headers'] and table['rows']:
            return table
    raise RuntimeError('AI tidak menemukan data tabel. Coba lagi.')


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


AI_UNAVAILABLE = 'Layanan AI sedang tidak tersedia untuk sementara. Coba lagi nanti.'
AI_BUSY = 'Layanan AI sedang sibuk. Coba lagi beberapa saat lagi.'


def ai_refused(provider, code, detail):
    """A provider's refusal as words for the member (its details, which may name keys or
    billing, go to the server log only)."""
    print(f'[ai] {provider} refused ({code}): {" ".join(str(detail).split())[:400]}', flush=True)
    if code == 429 or code >= 500:
        return RuntimeError(AI_BUSY)
    if code == 400:
        return RuntimeError('AI tidak bisa memproses permintaan ini. Coba bagian dokumen yang lebih pendek.')
    return RuntimeError(AI_UNAVAILABLE)            # 401/402/403: key, credits or billing — ours to fix


def gemini_chat(system, user, model, max_tokens=8000, temperature=0.3, include_thoughts=False):
    """One reply from Google's Gemini API (GEMINI_API_KEY in .env, paid tier: prompts are not
    used to train models). Thinking is kept low (GEMINI_THINKING, default "low"; empty = the
    model's own): thought tokens are billed as output and a summary needs little of it. They
    still share the output budget, so the budget is doubled (capped). A model that refuses
    the thinking level is asked again without it. `include_thoughts=True` also asks for the
    thought summary and returns `(answer, thoughts)` instead of just the answer string."""
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if not key:
        raise RuntimeError('AI belum diatur di server (GEMINI_API_KEY di .env).')
    base = os.environ.get('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta').strip().rstrip('/')
    thinking = os.environ.get('GEMINI_THINKING', 'low').strip().lower()

    def ask(level):
        config = {'temperature': temperature, 'maxOutputTokens': min(65536, max_tokens * 2)}
        if level:
            config['thinkingConfig'] = {'thinkingLevel': level}
            if include_thoughts:
                config['thinkingConfig']['includeThoughts'] = True
        body = json.dumps({'systemInstruction': {'parts': [{'text': system}]},
                           'contents': [{'role': 'user', 'parts': [{'text': user}]}], 'generationConfig': config}).encode('utf-8')
        request = urllib.request.Request(f'{base}/models/{quote(model, safe="-._")}:generateContent', data=body, method='POST',
                                         headers={'x-goog-api-key': key, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=300) as response:
            return json.loads(response.read().decode('utf-8'))
    try:
        try:
            data = ask(thinking)
        except urllib.error.HTTPError as cause:
            detail = cause.read().decode('utf-8', 'replace')
            if not (thinking and cause.code == 400 and 'thinking' in detail.lower()):
                raise ai_refused('gemini', cause.code, detail) from cause
            data = ask('')                                  # this model sets its own thinking
    except urllib.error.HTTPError as cause:
        raise ai_refused('gemini', cause.code, cause.read().decode('utf-8', 'replace')) from cause
    except (urllib.error.URLError, TimeoutError, OSError) as cause:
        raise RuntimeError('Layanan AI tidak bisa dihubungi. Cek koneksi internet server.') from cause
    candidates = data.get('candidates') or []
    if not candidates:
        reason = (data.get('promptFeedback') or {}).get('blockReason') or 'tanpa jawaban'
        raise RuntimeError(f'AI tidak memproses dokumen ini ({reason}). Coba bagian lain atau ulangi.')
    parts = ((candidates[0].get('content') or {}).get('parts')) or []
    answer = ''.join(p.get('text', '') for p in parts if isinstance(p, dict) and not p.get('thought'))
    if not include_thoughts:
        return answer
    return answer, ''.join(p.get('text', '') for p in parts if isinstance(p, dict) and p.get('thought'))


def ai_chat(system, user, model, max_tokens=8000, temperature=0.3, include_thoughts=False):
    """One chat completion; returns the reply text (or `(reply, thoughts)` when
    `include_thoughts` is set — only Gemini returns real thoughts; other models get an empty
    one). A model named gemini-… goes straight to Google's Gemini API; any other through
    Sumopod (Sumopod's own Gemini is gemini/…)."""
    if re.match(r'gemini-[\w.-]+$', str(model).strip().lower()):
        return gemini_chat(system, user, model, max_tokens, temperature, include_thoughts)
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
        raise ai_refused('sumopod', cause.code, cause.read().decode('utf-8', 'replace')) from cause
    except (urllib.error.URLError, TimeoutError, OSError) as cause:
        raise RuntimeError('Layanan AI tidak bisa dihubungi. Cek koneksi internet server.') from cause
    reply = ((data.get('choices') or [{}])[0].get('message') or {}).get('content') or ''
    return (reply, '') if include_thoughts else reply


def research(query, lang='id-ID'):
    """Web sources for a research query ("Fast Research" in the AI Summarizer's Sources panel),
    via Gemini's built-in Google Search grounding tool — no separate search API/key, just the
    existing GEMINI_API_KEY. Returns an ordered, deduplicated [{title, url}] (top 8)."""
    query = ' '.join(str(query or '').split())[:300]
    if len(query) < 2:
        raise ValueError('Tulis topik pencarian dulu.')
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if not key:
        raise RuntimeError('AI belum diatur di server (GEMINI_API_KEY di .env).')
    base = os.environ.get('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta').strip().rstrip('/')
    model = os.environ.get('RESEARCH_MODEL', '').strip() or os.environ.get('SUMMARY_MODEL', '').strip() or 'gemini-2.5-flash'
    language = TRANSLATE_LANGUAGES.get(lang, TRANSLATE_LANGUAGES['id-ID'])
    body = json.dumps({'systemInstruction': {'parts': [{'text': f'Cari sumber web yang relevan dan jawab singkat dalam {language}.'}]},
                       'contents': [{'role': 'user', 'parts': [{'text': query}]}],
                       'tools': [{'google_search': {}}],
                       'generationConfig': {'temperature': 0.2, 'maxOutputTokens': 2000}}).encode('utf-8')
    request = urllib.request.Request(f'{base}/models/{quote(model, safe="-._")}:generateContent', data=body, method='POST',
                                     headers={'x-goog-api-key': key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as cause:
        raise ai_refused('gemini', cause.code, cause.read().decode('utf-8', 'replace')) from cause
    except (urllib.error.URLError, TimeoutError, OSError) as cause:
        raise RuntimeError('Layanan AI tidak bisa dihubungi. Cek koneksi internet server.') from cause
    candidates = data.get('candidates') or []
    chunks = ((candidates[0].get('groundingMetadata') or {}).get('groundingChunks')) if candidates else None
    seen, results = set(), []
    for chunk in chunks or []:
        web = chunk.get('web') if isinstance(chunk, dict) else None
        url = web.get('uri') if isinstance(web, dict) else None
        if not url or url in seen:
            continue
        seen.add(url)
        results.append({'title': str(web.get('title') or url)[:200], 'url': url})
        if len(results) >= 8:
            break
    if not results:
        raise RuntimeError('Pencarian tidak menemukan sumber web. Coba topik lain.')
    return results


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
        source = f'Judul: {title}\n\n' + book_notes(title, text, PODCAST_LANGUAGES.get(lang, 'Bahasa Indonesia'), notes_model)[0]
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


_piper_speaker = None
_piper_lock = threading.Lock()


def piper_speaker():
    """The process-wide Piper voice loader (tts.py), loaded once."""
    global _piper_speaker
    with _piper_lock:
        if _piper_speaker is None:
            import tts
            _piper_speaker = tts.Speaker()
    return _piper_speaker


def synthesize_podcast(lines, lang='id-ID'):
    """One WAV for a two-host podcast script (`podcast_script()`'s `lines`, `[{s:'A'|'B', t}]`):
    each line read by Piper (tts.py's mixed Indonesian/English `Speaker`); host B a touch slower
    so the two voices stay apart even where only one Piper voice exists for the language."""
    speaker = piper_speaker()
    if not speaker.available():
        raise RuntimeError('Suara TTS belum terpasang di server (.data/piper).')
    default = 'id' if lang == 'id-ID' else 'en'
    gap = b'\x00\x00' * int(22050 * 0.35)
    frames, rate = [], None
    for line in lines:
        wav_bytes = speaker.wav(line['t'], default=default, length_scale=1.0 if line['s'] == 'A' else 1.08)
        with wave.open(io.BytesIO(wav_bytes), 'rb') as w:
            rate = rate or w.getframerate()
            frames.append(w.readframes(w.getnframes()))
        frames.append(gap)
    out = io.BytesIO()
    with wave.open(out, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate or 22050)
        w.writeframes(b''.join(frames))
    return out.getvalue()


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
        read(export / 'index.html'), [read(export / 'viewer.css'), read(export / 'book-effects.css'),
                                     read(export / 'share-theme.css')],
        [read(export / 'book-seal.js'), 'BookSeal.open();', read(ROOT / 'assets/vendor/page-flip.browser.js'),
         read(export / 'layout.js'), read(export / 'viewer.js'), read(export / 'share-toolbar.js')],
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


def find_ffmpeg():
    """Locate ffmpeg for Video Overview (slide images + narration -> one MP4)."""
    override = os.environ.get('MYFLIPBOOK_FFMPEG')
    if override and Path(override).is_file():
        return override
    found = shutil.which('ffmpeg')
    if found:
        return found
    if os.name == 'nt' and os.environ.get('LOCALAPPDATA'):
        for candidate in Path(os.environ['LOCALAPPDATA'], 'Microsoft/WinGet/Packages').glob('Gyan.FFmpeg_*/ffmpeg-*/bin/ffmpeg.exe'):
            if candidate.is_file():
                return str(candidate)
    return None


def render_slide_png(html, width, height, timeout=30):
    """One slide's HTML, rasterized to PNG by headless Edge/Chrome — the same engine and
    one-shot loopback pattern html_to_pdf() uses, with --screenshot instead of --print-to-pdf."""
    browser = find_chromium()
    if not browser:
        raise RuntimeError('Microsoft Edge / Google Chrome tidak ditemukan di komputer ini.')
    body = html.encode('utf-8')

    class Page(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.split('?')[0] != '/':
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    httpd = HTTPServer(('127.0.0.1', 0), Page)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    workdir = Path(tempfile.mkdtemp(prefix='slide-png-'))
    output = workdir / 'slide.png'
    args = [browser, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
            '--disable-extensions', '--disable-sync', '--disable-background-networking', '--mute-audio',
            f'--user-data-dir={workdir / "profile"}', f'--window-size={width},{height}', '--force-device-scale-factor=1',
            '--hide-scrollbars', '--virtual-time-budget=4000', f'--screenshot={output}', f'http://127.0.0.1:{port}/']
    process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            raise RuntimeError('Render slide terlalu lama.')
        if not output.is_file():
            raise RuntimeError('Browser gagal merender slide.')
        return output.read_bytes()
    finally:
        if process.poll() is None:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(process.pid)], capture_output=True,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            else:
                process.kill()
        httpd.shutdown(); httpd.server_close()
        shutil.rmtree(workdir, ignore_errors=True)


def slide_html(slide, index, total):
    """One slide's content as a self-contained 1280x720 HTML card (Video Overview)."""
    points = ''.join(f'<li>{escape(str(p))}</li>' for p in (slide.get('points') or []))
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;width:1280px;height:720px;box-sizing:border-box;background:linear-gradient(165deg,#1A3C34,#13302A);
color:#FFF7EA;font-family:Georgia,serif;padding:70px 90px;display:flex;flex-direction:column;justify-content:center}}
h1{{font-size:44px;line-height:1.3;margin:0 0 34px;color:#fff}}
ul{{font-size:25px;line-height:1.65;padding-left:30px;margin:0}}
.tag{{position:absolute;bottom:28px;right:40px;font-size:15px;color:#D6D3D1;font-family:sans-serif}}
</style></head><body><h1>{escape(str(slide.get('title') or ''))}</h1><ul>{points}</ul><div class="tag">{index + 1} / {total}</div></body></html>"""


def video_overview_job(job_id, title, text, lang, work):
    """A narrated slideshow: make_slides() for content, each slide rendered to PNG and read
    aloud with Piper (its speaker notes as the narration), ffmpeg muxes image+audio per slide
    and concatenates the clips into one MP4. Tracks progress in JOBS like an APK/EXE build —
    polled and downloaded through the same /api/jobs/<id> and /api/jobs/<id>/download."""
    job, folder = JOBS[job_id], BUILD / job_id
    try:
        job.update(status='running', message='Menyusun slide…', progress=0.05)
        slides = make_slides(title, text, lang, 8, work)
        ffmpeg = find_ffmpeg()
        if not ffmpeg:
            raise RuntimeError('ffmpeg tidak ditemukan di komputer ini.')
        speaker = piper_speaker()
        if not speaker.available():
            raise RuntimeError('Suara TTS belum terpasang di server (.data/piper).')
        default = 'id' if lang == 'id-ID' else 'en'
        total = len(slides)
        clips = []
        for i, slide in enumerate(slides):
            job.update(message=f'Merender slide {i + 1}/{total}…', progress=0.1 + 0.6 * (i / total))
            png_path = folder / f'slide-{i:02d}.png'
            png_path.write_bytes(render_slide_png(slide_html(slide, i, total), 1280, 720))
            narration = slide.get('notes') or slide.get('title') or ' '
            wav_path = folder / f'slide-{i:02d}.wav'
            wav_path.write_bytes(speaker.wav(narration, default=default))
            clip_path = folder / f'clip-{i:02d}.mp4'
            code = subprocess.run([ffmpeg, '-y', '-loop', '1', '-i', str(png_path), '-i', str(wav_path), '-r', '24',
                                   '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', str(clip_path)],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).returncode
            if code or not clip_path.is_file():
                raise RuntimeError(f'ffmpeg gagal membuat klip slide {i + 1}.')
            clips.append(clip_path)
        job.update(message='Menggabungkan video…', progress=0.85)
        concat_file = folder / 'concat.txt'
        concat_file.write_text(''.join(f"file '{c.name}'\n" for c in clips), encoding='utf-8')
        output = folder / 'video-overview.mp4'
        code = subprocess.run([ffmpeg, '-y', '-f', 'concat', '-safe', '0', '-i', str(concat_file), '-c', 'copy', str(output)],
                              cwd=folder, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).returncode
        if code or not output.is_file():
            raise RuntimeError('ffmpeg gagal menggabungkan video.')
        for leftover in list(folder.glob('slide-*.png')) + list(folder.glob('slide-*.wav')) + list(folder.glob('clip-*.mp4')) + [concat_file]:
            leftover.unlink(missing_ok=True)
        job.update(status='done', message='Video Overview selesai.', progress=1, artifact=output.name,
                   download_name=(re.sub(r'[\\/:*?"<>|]+', '-', title)[:80] or 'Video') + ' - Video Overview.mp4',
                   download=f'/api/jobs/{job_id}/download')
    except Exception as cause:
        job.update(status='failed', message=str(cause))
    finally:
        BUILD_LOCK.release()


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


def openalex_search(query, page=1, oa=True, year_from=None, year_to=None, lang=None, indonesia=False, sort='relevance'):
    """OpenAlex articles for a query: dict(total, page, results=[...])."""
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
    params = {'filter': ','.join(filters), 'per-page': 20, 'page': page, 'select': OPENALEX_FIELDS}
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
    results = [openalex_article(work) for work in data.get('results') or []]
    out = dict(total=(data.get('meta') or {}).get('count') or 0, page=page, results=results)
    if len(JOURNAL_CACHE) > 300:
        JOURNAL_CACHE.clear()
    JOURNAL_CACHE[key] = (time.time(), out)
    return out


OPENALEX_FIELDS = ('id,display_name,publication_year,doi,cited_by_count,language,authorships,primary_location,'
                   'best_oa_location,open_access,abstract_inverted_index,biblio,type')


def openalex_article(work):
    """One OpenAlex work as a search result."""
    primary = work.get('primary_location') or {}
    source = primary.get('source') or {}
    best = work.get('best_oa_location') or {}
    doi = work.get('doi') or ''
    pdf = best.get('pdf_url') or ''
    names = list(dict.fromkeys(n for n in ((x.get('author') or {}).get('display_name') for x in work.get('authorships') or []) if n))   # OpenAlex repeats some
    return dict(
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
        source='openalex',
        **biblio_of(work.get('biblio') or {}, work.get('type')),
    )


def biblio_of(b, kind=None):
    """Volume, issue, pages and kind of an article (for citations), '' when unknown."""
    first, last = str(b.get('first_page') or ''), str(b.get('last_page') or '')
    return dict(volume=str(b.get('volume') or ''), issue=str(b.get('issue') or ''),
                pages=first + ('-' + last if last and last != first else ''), kind=kind or 'article')


# ---------- Author profiles, like Publish or Perish (Harzing): OpenAlex's author records and
# works (CC0), the metrics computed here the way PoP defines them. No Google Scholar scraping.
AUTHOR_ID = re.compile(r'A\d{1,12}')
AUTHOR_WORKS_MAX = 1000          # 5 pages of 200, most cited first


def openalex_get(path, params):
    """OpenAlex JSON for an API path, with the site's key / mailto; cached a day."""
    params = dict(params)
    if os.environ.get('OPENALEX_API_KEY'):
        params['api_key'] = os.environ['OPENALEX_API_KEY'].strip()
    if os.environ.get('OPENALEX_MAILTO'):
        params['mailto'] = os.environ['OPENALEX_MAILTO'].strip()
    url = f'https://api.openalex.org/{path}?' + urlencode(params)
    hit = JOURNAL_CACHE.get(url)
    if hit and time.time() - hit[0] < JOURNAL_CACHE_SECONDS:
        return hit[1]
    data = ebook_get(url, 'OpenAlex')
    if len(JOURNAL_CACHE) > 300:
        JOURNAL_CACHE.clear()
    JOURNAL_CACHE[url] = (time.time(), data)
    return data


def author_card(a):
    inst = (a.get('last_known_institutions') or [{}])
    inst = inst[0] if inst else {}
    stats = a.get('summary_stats') or {}
    return dict(id=str(a.get('id', '')).rsplit('/', 1)[-1], name=a.get('display_name') or '', works=a.get('works_count') or 0,
                cited=a.get('cited_by_count') or 0, h=stats.get('h_index') or 0, i10=stats.get('i10_index') or 0,
                institution=inst.get('display_name') or '', country=inst.get('country_code') or '',
                orcid=str(a.get('orcid') or '').replace('https://orcid.org/', ''))


def author_search(name):
    """Authors whose name fits, most cited first: [author_card]."""
    name = ' '.join(str(name or '').split())[:120]
    if len(name) < 3:
        raise ValueError('Tulis nama penulis minimal 3 huruf.')
    data = openalex_get('authors', {'search': name, 'per-page': 15,
                                    'select': 'id,display_name,works_count,cited_by_count,summary_stats,last_known_institutions,orcid'})
    return [author_card(a) for a in data.get('results') or []]


def h_of(values):
    """h-index of a list of numbers: the largest h with h values of at least h."""
    ranked = sorted(values, reverse=True)
    return sum(1 for i, v in enumerate(ranked, 1) if v >= i)


def citation_metrics(works, year_now=None):
    """Publish or Perish's metrics for a list of works ({cited, year, authors count}):
    papers, citations, years, cites/year, cites/paper, cites/author, papers/author, authors/paper,
    h-index, g-index, i10-index, hI,norm, hI,annual, AWCR, AW-index."""
    year_now = year_now or time.gmtime().tm_year
    cites = [max(0, int(w.get('cited') or 0)) for w in works]
    authors = [max(1, int(w.get('nAuthors') or 1)) for w in works]
    years = [int(w['year']) for w in works if w.get('year')]
    span = max(1, year_now - min(years) + 1) if years else 1
    ranked, total, g = sorted(cites, reverse=True), 0, 0
    for i, c in enumerate(ranked, 1):
        total += c
        if total >= i * i:
            g = i
    hi_norm = h_of([c / a for c, a in zip(cites, authors)])
    awcr = sum(c / max(1, year_now - int(w['year']) + 1) for c, w in zip(cites, works) if w.get('year'))
    n, citations = len(works), sum(cites)
    r = lambda v: round(v, 2)
    return dict(papers=n, citations=citations, years=span, citesPerYear=r(citations / span), citesPerPaper=r(citations / n) if n else 0,
                citesPerAuthor=r(sum(c / a for c, a in zip(cites, authors))), papersPerAuthor=r(sum(1 / a for a in authors)),
                authorsPerPaper=r(sum(authors) / n) if n else 0, h=h_of(cites), g=g, i10=sum(1 for c in cites if c >= 10),
                hINorm=hi_norm, hIAnnual=r(hi_norm / span), awcr=r(awcr), awIndex=r(math.sqrt(awcr)), firstYear=min(years) if years else None)


def author_profile(author_id):
    """{author, metrics, byYear, works, complete} for one OpenAlex author (works most cited first)."""
    if not AUTHOR_ID.fullmatch(author_id or ''):
        raise ValueError('Penulis tidak dikenal.')
    a = openalex_get(f'authors/{author_id}', {'select': 'id,display_name,works_count,cited_by_count,summary_stats,last_known_institutions,orcid,counts_by_year,display_name_alternatives'})
    works, total = [], None
    for page in range(1, AUTHOR_WORKS_MAX // 200 + 1):
        data = openalex_get('works', {'filter': f'author.id:{author_id}', 'sort': 'cited_by_count:desc', 'per-page': 200, 'page': page, 'select': OPENALEX_FIELDS})
        total = (data.get('meta') or {}).get('count') or 0
        for w in data.get('results') or []:
            item = openalex_article(w)
            item['nAuthors'] = len(item['authors']) + item['moreAuthors'] or 1
            item.pop('abstract', None)
            works.append(item)
        if len(works) >= total or not data.get('results'):
            break
    by_year = sorted(({'year': c['year'], 'works': c.get('works_count') or 0, 'cited': c.get('cited_by_count') or 0}
                      for c in a.get('counts_by_year') or [] if c.get('year')), key=lambda c: c['year'])
    return dict(author=dict(author_card(a), alternatives=(a.get('display_name_alternatives') or [])[:6]),
                metrics=citation_metrics(works), byYear=by_year, works=works, complete=len(works) >= (total or 0), total=total or len(works))


# ---------- A DOI typed in: that article (several DOIs, one per line or comma: each of them).
DOI_MAX = 20


def query_dois(query):
    """The DOIs in a search (bare, doi:…, or doi.org links), in order, at most DOI_MAX."""
    found = re.findall(r'10\.\d{4,9}/[^\s"<>,;]+', re.sub(r'https?://(dx\.)?doi\.org/', ' ', str(query or ''), flags=re.I))
    return list(dict.fromkeys(d.rstrip('.)]') for d in found))[:DOI_MAX]


def doi_article(doi):
    """The article behind one DOI: OpenAlex's entry, or Crossref's details when OpenAlex doesn't
    have it (its PDF is then looked up by the DOI); None when neither knows it."""
    hit = JOURNAL_CACHE.get('doi:' + doi.lower())
    if hit and time.time() - hit[0] < JOURNAL_CACHE_SECONDS:
        return hit[1]
    params = {'select': OPENALEX_FIELDS}
    if os.environ.get('OPENALEX_MAILTO'):
        params['mailto'] = os.environ['OPENALEX_MAILTO'].strip()
    article = None
    try:
        article = openalex_article(ebook_get(f'https://api.openalex.org/works/doi:{quote(doi, safe="/")}?' + urlencode(params), 'OpenAlex'))
    except RuntimeError:
        try:
            work = (ebook_get(f'https://api.crossref.org/works/{quote(doi, safe="/")}?mailto={quote(CONTACT_EMAIL)}', 'Crossref') or {}).get('message') or {}
        except RuntimeError:
            work = {}
        if work.get('title'):
            names = [' '.join(filter(None, [a.get('given'), a.get('family')])) or a.get('name') or '' for a in work.get('author') or []]
            names = [n for n in names if n]
            year = ((work.get('issued') or {}).get('date-parts') or [[None]])[0][0]
            article = dict(id='', title=' '.join(str(work['title'][0]).split()), authors=names[:8], moreAuthors=max(0, len(names) - 8),
                           journal=(work.get('container-title') or [''])[0], publisher=work.get('publisher') or '', year=year,
                           cited=work.get('is-referenced-by-count') or 0, language=work.get('language') or '',
                           doi='https://doi.org/' + doi, link='https://doi.org/' + doi, pdf='', oa=False,
                           license=((work.get('license') or [{}])[0]).get('URL') or '', abstract=abstract_cut(re.sub(r'<[^>]+>', ' ', work.get('abstract') or '')),
                           source='crossref', volume=str(work.get('volume') or ''), issue=str(work.get('issue') or ''),
                           pages=str(work.get('page') or ''), kind='article')
    if article:
        if len(JOURNAL_CACHE) > 300:
            JOURNAL_CACHE.clear()
        JOURNAL_CACHE['doi:' + doi.lower()] = (time.time(), article)
    return article


def doi_search(dois):
    """dict(total, page, results, dois, missing) for the DOIs typed in (looked up side by side)."""
    with ThreadPoolExecutor(max_workers=4) as pool:
        found = list(pool.map(doi_article, dois))
    return dict(total=sum(1 for a in found if a), page=1, results=[a for a in found if a], dois=len(dois),
                missing=[d for d, a in zip(dois, found) if not a])


# ---------- Semantic Scholar (api.semanticscholar.org), beside OpenAlex. The key
# allows 1 request per second across every endpoint: one search call per query,
# one shared slot at least S2_GAP apart, a day's cache. It also refuses now and then (429)
# well inside the limit: one retry, and a longer pause only after several refusals in a row.
# Its licence asks for attribution; abstracts/TLDRs may be CC BY-NC, so only
# metadata, the citation count and the open-access PDF link are shown.
S2_FIELDS = 'title,year,authors,venue,citationCount,isOpenAccess,openAccessPdf,externalIds,url,journal'
S2_GAP, S2_WAIT, S2_PAUSE, S2_REFUSALS = 1.1, 2.0, 60, 3
S2_CACHE, S2_CACHE_SECONDS = {}, 86400
S2_LOCK = threading.Lock()
S2_STATE = {'last': 0.0, 'pause_until': 0.0, 'refused': 0}
S2_ID = re.compile(r'S2[0-9a-f]{40}')
DOI_RE = re.compile(r'10\.\d{4,9}/[^\s"<>]{1,200}')


def s2_slot(wait=S2_WAIT):
    """True when this call may go to Semantic Scholar now (waits at most `wait` seconds)."""
    deadline = time.time() + wait
    while True:
        with S2_LOCK:
            now = time.time()
            if now < S2_STATE['pause_until']:
                return False
            gap = S2_GAP - (now - S2_STATE['last'])
            if gap <= 0:
                S2_STATE['last'] = now
                return True
        if now + gap > deadline:
            return False
        time.sleep(min(gap, 0.25))


def s2_licence(text):
    """"CCBYSA" -> "cc-by-sa" (OpenAlex's spelling, shown the same way)."""
    text = str(text or '').upper()
    if not text.startswith('CC'):
        return text.lower()
    return 'cc-' + '-'.join(re.findall(r'BY|NC|ND|SA|0', text[2:])).lower() if len(text) > 2 else 'cc'


def s2_search(query, page=1, oa=True, year_from=None, year_to=None):
    """Semantic Scholar articles: dict(total, results=[...]); none without SEMANTIC_SCHOLAR_API_KEY."""
    key = os.environ.get('SEMANTIC_SCHOLAR_API_KEY', '').strip()
    if not key:
        return dict(total=0, results=[])
    params = {'query': query, 'offset': (page - 1) * 20, 'limit': 20, 'fields': S2_FIELDS}
    if oa:
        params['openAccessPdf'] = ''
    if year_from or year_to:
        params['year'] = f'{year_from or ""}-{year_to or ""}'
    cache_key = json.dumps(params, sort_keys=True)
    hit = S2_CACHE.get(cache_key)
    if hit and time.time() - hit[0] < S2_CACHE_SECONDS:
        return hit[1]
    request = urllib.request.Request('https://api.semanticscholar.org/graph/v1/paper/search?' + urlencode(params),
                                     headers={'x-api-key': key, 'User-Agent': 'MyFlipbook/1.0 (journal search)', 'Accept': 'application/json'})
    data = None
    for attempt in range(2):
        if not s2_slot():
            raise RuntimeError('Semantic Scholar sedang sibuk.')
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                data = json.loads(response.read().decode('utf-8'))
            with S2_LOCK:
                S2_STATE['refused'] = 0
            break
        except urllib.error.HTTPError as cause:
            if cause.code != 429:
                raise RuntimeError(f'Semantic Scholar menolak permintaan ({cause.code}).') from cause
            with S2_LOCK:
                S2_STATE['refused'] += 1
                if S2_STATE['refused'] >= S2_REFUSALS:
                    S2_STATE['pause_until'] = time.time() + S2_PAUSE
            if attempt:
                raise RuntimeError('Semantic Scholar sedang sibuk.') from cause
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as cause:
            raise RuntimeError('Semantic Scholar tidak bisa dihubungi.') from cause
    results = []
    for paper in data.get('data') or []:
        paper_id = str(paper.get('paperId') or '')
        if not re.fullmatch(r'[0-9a-f]{40}', paper_id) or not paper.get('title'):
            continue
        doi = str((paper.get('externalIds') or {}).get('DOI') or '')
        doi = 'https://doi.org/' + doi if DOI_RE.fullmatch(doi) else ''
        pdf = (paper.get('openAccessPdf') or {})
        pdf_url = str(pdf.get('url') or '')
        names = [a.get('name') for a in paper.get('authors') or [] if a.get('name')]
        results.append(dict(
            id='S2' + paper_id, title=' '.join(str(paper['title']).split()), authors=names[:8], moreAuthors=max(0, len(names) - 8),
            journal=str(paper.get('venue') or (paper.get('journal') or {}).get('name') or ''), publisher='',
            year=paper.get('year'), cited=int(paper.get('citationCount') or 0), language='', doi=doi,
            link=doi or str(paper.get('url') or ''), pdf=pdf_url if pdf_url.startswith(('http://', 'https://')) else '',
            oa=bool(paper.get('isOpenAccess') or pdf_url), license=s2_licence(pdf.get('license')), abstract='', source='s2'))
    out = dict(total=int(data.get('total') or 0), results=results)
    if len(S2_CACHE) > 500:
        S2_CACHE.clear()
    S2_CACHE[cache_key] = (time.time(), out)
    return out


def article_key(article):
    return (article.get('doi') or '').lower() or re.sub(r'[^a-z0-9]+', '', article['title'].lower())[:80]


def journal_search(query, page=1, oa=True, year_from=None, year_to=None, lang=None, indonesia=False, sort='relevance'):
    """Articles for a query: dict(total, page, results=[...]) from OpenAlex, with Semantic Scholar's
    alongside when it can honour the filters (it has no language, country or sort filter)."""
    dois = query_dois(query)
    if dois:                   # a DOI typed in: those articles, whatever the filters (one page)
        return doi_search(dois) if page == 1 else dict(total=0, page=page, results=[])
    use_s2 = bool(os.environ.get('SEMANTIC_SCHOLAR_API_KEY', '').strip()) and sort == 'relevance' and not lang and not indonesia
    if not use_s2:
        return openalex_search(query, page, oa, year_from, year_to, lang, indonesia, sort)
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(openalex_search, query, page, oa, year_from, year_to, lang, indonesia, sort),
                pool.submit(s2_search, query, page, oa, year_from, year_to)]
        outs, errors = [], []
        for job in jobs:
            try:
                outs.append(job.result())
            except RuntimeError as cause:
                outs.append(None)
                errors.append(cause)
    first, second = outs
    if first is None and second is None:
        raise errors[0]
    if first is None:
        return dict(total=second['total'], page=page, results=second['results'])
    if second is None or not second['results']:
        return first
    # The same article once: OpenAlex's entry, with Semantic Scholar's PDF link when it has none.
    found = {article_key(a): a for a in first['results']}
    extra = []
    for a in second['results']:
        same = found.get(article_key(a))
        if same:
            if not same['pdf'] and a['pdf']:
                same['pdf'] = a['pdf']
                same['oa'] = True
        else:
            found[article_key(a)] = a
            extra.append(a)
    results = []
    for i in range(max(len(first['results']), len(extra))):          # alternate the two sources
        results += first['results'][i:i + 1] + extra[i:i + 1]
    return dict(total=max(first['total'], second['total']), page=page, results=results)


# ---------- The PDF behind a journal search result (for "Make a flipbook").
# OpenAlex often has only the article page (Indonesian OJS journals, DOAJ, PMC),
# and a page link would turn the publisher's web page into the flipbook. So the
# candidates are probed until one really is a PDF: the search hint, every
# OpenAlex location, Unpaywall, Europe PMC, then PDF links found on the pages
# (citation_pdf_url, OJS article/view -> article/download).
CONTACT_EMAIL = 'cs@myflipbookpro.com'      # Unpaywall asks callers for a contact address
WORK_ID = re.compile(r'W\d{1,12}')
JOURNAL_PDF_CACHE = {}
PDF_META = re.compile(r'<meta[^>]+name=["\']citation_pdf_url["\'][^>]*content=["\']([^"\']+)', re.I)
PDF_META_REV = re.compile(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]*name=["\']citation_pdf_url', re.I)
OJS_VIEW = re.compile(r'(/article/)view(/\d+/\d+)')
OJS_LINK = re.compile(r'href=["\']([^"\']*/article/(?:view|download)/\d+/\d+[^"\']*)["\']', re.I)


def probe_pdf(url):
    """(is_pdf, size, html, final_url) of a link; only public hosts, small reads."""
    class Checked(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            nxt = urlsplit(newurl)
            if nxt.scheme not in ('http', 'https'):
                raise ValueError('bad redirect')
            check_public_host(nxt.hostname or '')
            return super().redirect_request(req, fp, code, msg, headers, newurl)
    parts = urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname or len(url) > 2000:
        return False, 0, '', url
    try:
        check_public_host(parts.hostname)
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (MyFlipbook; journal PDF lookup)',
                                                       'Accept': 'application/pdf,text/html;q=0.8,*/*;q=0.5'})
        with urllib.request.build_opener(Checked).open(request, timeout=15) as response:
            head = response.read(5)
            final = response.geturl()
            size = int(response.headers.get('Content-Length') or 0)
            if head.startswith(b'%PDF-'):
                return True, size, '', final
            if response.headers.get_content_type() in ('text/html', 'application/xhtml+xml'):
                return False, 0, (head + response.read(400_000)).decode('utf-8', 'replace'), final
    except (ValueError, urllib.error.URLError, OSError, http.client.HTTPException):
        pass
    return False, 0, '', url


def pdf_links_in(html, base):
    """PDF candidates named on an article page."""
    found = [m for m in PDF_META.findall(html) + PDF_META_REV.findall(html)]
    found += [OJS_VIEW.sub(r'\1download\2', u) for u in found if OJS_VIEW.search(u)]
    if OJS_VIEW.search(base):
        found.append(OJS_VIEW.sub(r'\1download\2', base))
    found += [OJS_VIEW.sub(r'\1download\2', u) for u in OJS_LINK.findall(html)][:4]
    out = []
    for u in found:
        u = urljoin(base, unescape(u.strip()))
        if u.startswith(('http://', 'https://')) and u not in out:
            out.append(u)
    return out[:6]


def journal_candidates(work_id, hint='', doi=''):
    pdfs, pages = ([hint] if hint else []), []
    # A Semantic Scholar result is looked up in OpenAlex by its DOI (no S2 call: its rate limit is tight).
    lookup = work_id if WORK_ID.fullmatch(work_id) else ('doi:' + doi if doi else '')    # S2 / DOI-only: OpenAlex by the DOI
    try:
        params = {'select': 'doi,ids,best_oa_location,locations'}
        if os.environ.get('OPENALEX_MAILTO'):
            params['mailto'] = os.environ['OPENALEX_MAILTO'].strip()
        work = ebook_get(f'https://api.openalex.org/works/{quote(lookup, safe=":/")}?' + urlencode(params), 'OpenAlex') if lookup else {}
    except RuntimeError:
        work = {}
    for loc in [work.get('best_oa_location') or {}] + list(work.get('locations') or []):
        if loc.get('pdf_url'):
            pdfs.append(loc['pdf_url'])
        if loc.get('landing_page_url') and loc.get('is_oa', True):
            pages.append(loc['landing_page_url'])
    doi = str(work.get('doi') or '').replace('https://doi.org/', '') or doi
    if doi:
        try:
            oa = ebook_get(f'https://api.unpaywall.org/v2/{quote(doi)}?email={quote(CONTACT_EMAIL)}', 'Unpaywall')
            for loc in oa.get('oa_locations') or []:
                if loc.get('url_for_pdf'):
                    pdfs.append(loc['url_for_pdf'])
                if loc.get('url_for_landing_page'):
                    pages.append(loc['url_for_landing_page'])
        except RuntimeError:
            pass
        pages.append('https://doi.org/' + doi)
    pmcid = str((work.get('ids') or {}).get('pmcid') or '').rsplit('/', 1)[-1]
    pmcid = 'PMC' + pmcid if pmcid.isdigit() else pmcid             # OpenAlex gives some without the prefix
    if re.fullmatch(r'PMC\d+', pmcid):
        pdfs.append(f'https://europepmc.org/articles/{pmcid}?pdf=render')
    pdfs = [OJS_VIEW.sub(r'\1download\2', u) for u in pdfs]
    seen, ordered = set(), []
    for u in pdfs + pages:
        if u and u not in seen:
            seen.add(u)
            ordered.append(u)
    return ordered


JOURNAL_FILE_HITS = {}          # ip -> recent download times (guests can use this; keep it modest)
JOURNAL_FILE_PER_HOUR = 40


def journal_file_allowed(ip, now=None):
    now = now or time.time()
    hits = [t for t in JOURNAL_FILE_HITS.get(ip, []) if now - t < 3600]
    if len(hits) >= JOURNAL_FILE_PER_HOUR:
        JOURNAL_FILE_HITS[ip] = hits
        return False
    JOURNAL_FILE_HITS[ip] = hits + [now]
    if len(JOURNAL_FILE_HITS) > 5000:
        JOURNAL_FILE_HITS.clear()
    return True


def journal_file(work_id, hint='', doi=''):
    """(bytes, filename) of an open-access article's PDF, found by journal_pdf; only real PDFs."""
    found = journal_pdf(work_id, hint, doi)
    if not found['pdf']:
        raise LookupError('PDF artikel ini tidak tersedia untuk umum. Buka artikelnya di situs penerbit.')
    data, name, ctype = fetch_source(found['pdf'], public_only=True)
    if not data.startswith(b'%PDF-'):
        raise LookupError('PDF artikel ini tidak tersedia untuk umum. Buka artikelnya di situs penerbit.')
    return data, name if name.lower().endswith('.pdf') else (work_id or re.sub(r'[^\w.-]+', '_', doi)[-80:] or 'artikel') + '.pdf'


def ebook_file(source, identifier):
    """(bytes, filename) of a search result's book or magazine PDF (only real PDFs)."""
    if source == 'gutenberg':
        return gutenberg_pdf(identifier)
    found = ebook_pdf(source, identifier)
    if not found['pdf']:
        raise LookupError('Buku ini tidak punya berkas PDF.')
    data, name, ctype = fetch_source(found['pdf'], public_only=True)
    if not data.startswith(b'%PDF-'):
        raise LookupError('Buku ini tidak punya berkas PDF.')
    return data, name if name.lower().endswith('.pdf') else re.sub(r'[^\w.-]+', '_', identifier)[-80:] + '.pdf'


def journal_pdf(work_id, hint='', doi=''):
    """{pdf, size} of an article's real PDF ('' when none is public). work_id: OpenAlex (W…) or
    Semantic Scholar (S2…); doi helps find the latter's PDF."""
    hint = hint if hint.startswith(('http://', 'https://')) and len(hint) < 2000 else ''
    doi = re.sub(r'^https?://(dx\.)?doi\.org/', '', str(doi or ''), flags=re.I)
    doi = doi if DOI_RE.fullmatch(doi) else ''
    if not (WORK_ID.fullmatch(work_id or '') or S2_ID.fullmatch(work_id or '') or (not work_id and doi)):
        raise ValueError('Artikel tidak dikenal.')
    work_id = work_id or 'doi:' + doi.lower()          # known only by its DOI (Crossref)
    hit = JOURNAL_PDF_CACHE.get(work_id)
    if hit and time.time() - hit[0] < JOURNAL_CACHE_SECONDS:
        return hit[1]
    found, tried, deadline = dict(pdf='', size=0), set(), time.time() + 40
    queue = journal_candidates(work_id, hint, doi)
    # Not fetched here, a listed open-access PDF may still open in the reader's own browser
    # (publishers that refuse servers serve browsers): the first one is handed back as `open`.
    listed = [u for u in queue if re.search(r'\.pdf(\?|$)|[/=?&]pdf([/=?&]|$)|/pdf/', u, flags=re.I)]
    while queue and time.time() < deadline and len(tried) < 12:
        url = queue.pop(0)
        if url in tried:
            continue
        tried.add(url)
        ok, size, html, final = probe_pdf(url)
        if ok:
            found = dict(pdf=final, size=size)
            break
        if html:
            queue[0:0] = [u for u in pdf_links_in(html, final) if u not in tried]
    if not found['pdf'] and listed:
        found['open'] = listed[0]
    if len(JOURNAL_PDF_CACHE) > 500:
        JOURNAL_PDF_CACHE.clear()
    JOURNAL_PDF_CACHE[work_id] = (time.time(), found)
    return found


# ---------- Ebook search: free, legal full books with a PDF.
# OAPEN Library — peer-reviewed open-access books, licence checked by OAPEN.
# Internet Archive — texts its uploader released under a licence (CC / public
# domain), lending-only items excluded; the licence is the uploader's claim.
EBOOK_PER_SOURCE = 10
MAGAZINE_PER_PAGE = 30        # one source fills the whole shelf (and series group up)
EBOOK_LANGS = {'id': ('Indonesian', 'ind'), 'en': ('English', 'eng'), 'ms': ('Malay', 'may')}
IA_LANGS = {'ind': 'id', 'indonesian': 'id', 'eng': 'en', 'english': 'en', 'may': 'ms', 'msa': 'ms', 'malay': 'ms', 'jav': 'jv', 'javanese': 'jv', 'sun': 'su', 'sundanese': 'su'}


def ebook_terms(query):
    """Plain search words: no field/boolean syntax reaches the source's query parser."""
    return ' '.join(re.sub(r"[^\w\s'-]", ' ', query, flags=re.UNICODE).split())[:200]


def abstract_cut(text, limit=700):
    text = ' '.join(str(text or '').split())
    return text if len(text) <= limit else text[:limit].rsplit(' ', 1)[0] + '…'


def ebook_get(url, what, timeout=25, text=False):
    """The source's JSON answer (text=True: the body as text)."""
    request = urllib.request.Request(url, headers={'User-Agent': 'MyFlipbook/1.0 (ebook search)',
                                                   'Accept': '*/*' if text else 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(8 << 20).decode('utf-8', 'replace')
            return body if text else json.loads(body)
    except urllib.error.HTTPError as cause:
        raise RuntimeError(f'{what} menolak permintaan ({cause.code}).') from cause
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as cause:
        raise RuntimeError(f'{what} tidak bisa dihubungi.') from cause


OAPEN_HANDLE = re.compile(r'20\.500\.12657/\d{1,9}')
ARCHIVE_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,120}')


def oapen_books(terms, page, lang, sort='relevance', category=''):
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


def archive_title_query(terms):
    """Every word in the title (a plural counts: effect/effects), the exact phrase ranked first.
    Matching any word anywhere (the old query) found unrelated texts that merely mention one word."""
    words = terms.split()
    each = []
    for w in words:
        forms = {w, w + 's'} if w.isalpha() and len(w) >= 3 and not w.lower().endswith('s') else {w}
        each.append('(' + ' OR '.join(sorted(forms)) + ')')
    phrase = terms.replace('"', ' ')
    return f'title:("{phrase}")^5 OR title:({" AND ".join(each)})'


def archive_rank(books, terms):
    """Within a page: titles holding the whole phrase first, then the source's order."""
    words = [w.lower() for w in terms.split()]
    flat = lambda t: ' '.join(re.sub(r'[^\w\s]', ' ', t.lower()).split())
    def score(i_book):
        i, book = i_book
        title = flat(book['title'])
        return (0 if flat(terms) in title else 1 if all(w in title for w in words) else 2, i)
    return [b for _, b in sorted(enumerate(books), key=score)]


# Magazine shelves (the Magazine tab's category chips): words matched in the subject or title.
MAGAZINE_CATEGORIES = {
    'teknologi': ('Teknologi & Komputer', 'computer OR computers OR computing OR technology OR software OR programming'),
    'fotografi': ('Fotografi', 'photography OR photographic OR camera OR photo'),
    'sains': ('Sains', 'science OR scientific OR physics OR astronomy OR chemistry'),
    'desain': ('Desain & Seni', 'design OR art OR graphic OR typography OR illustration OR architecture'),
    'elektronik': ('Radio & Elektronik', 'radio OR electronics OR electronic OR amateur'),
    'otomotif': ('Otomotif', 'automobile OR automotive OR car OR cars OR motor OR motorcycle'),
    'musik': ('Musik', 'music OR musical OR guitar OR jazz'),
    'sejarah': ('Sejarah', 'history OR historical OR heritage'),
    'gayahidup': ('Gaya Hidup', 'lifestyle OR fashion OR cooking OR home OR garden OR travel'),
    'hobi': ('Game & Hobi', 'games OR gaming OR hobby OR hobbies OR model OR crafts'),
}
EBOOK_SORTS = ('relevance', 'popular', 'newest', 'oldest')
ARCHIVE_SORTS = {'popular': 'downloads desc', 'newest': 'date desc', 'oldest': 'date asc'}
SERIES_TAIL = re.compile(
    r'(\s*[\[(].*$)|([\s_-]+(v|vol|volume|no|nr|n|issue|#)[\s._]*\d.*$)|([\s_,-]+(19|20)\d\d([\s_.-].*)?$)|'
    r'([\s_,-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b.*$)|([\s_-]+\d+$)', re.I)


def series_name(title):
    """The magazine a title is an issue of: "The Popular Magazine v078 n04 [1925]" -> "The Popular Magazine"."""
    name = str(title or '')
    for _ in range(3):
        cut = SERIES_TAIL.sub('', name).strip(' _-,.:')
        if cut == name or len(cut) < 3:
            break
        name = cut
    return ' '.join(name.replace('_', ' ').split()) or str(title or '')


def archive_books(terms, page, lang, sort='relevance', category='', magazines=False):
    # Books leave the magazine shelf to the Magazine tab; that tab searches only it.
    shelf = 'collection:magazine_rack' if magazines else 'NOT collection:magazine_rack'
    base = (f'mediatype:texts AND {shelf} AND licenseurl:* AND NOT access-restricted-item:true '
            'AND format:("Text PDF" OR PDF OR "Additional Text PDF")')
    if lang in EBOOK_LANGS:
        base += f' AND language:({EBOOK_LANGS[lang][1]} OR {EBOOK_LANGS[lang][0]})'
    if category in MAGAZINE_CATEGORIES:
        words = MAGAZINE_CATEGORIES[category][1]
        base += f' AND (subject:({words}) OR title:({words}))'
    fields = [('fl[]', f) for f in ('identifier', 'title', 'creator', 'year', 'date', 'language', 'licenseurl', 'description',
                                    'publisher', 'downloads')]
    order = ARCHIVE_SORTS.get(sort) or ('downloads desc' if not terms else None)     # browsing: the most read first
    rows = MAGAZINE_PER_PAGE if magazines else EBOOK_PER_SOURCE
    ask = lambda q: ebook_get('https://archive.org/advancedsearch.php?' + urlencode(
        [('q', f'({q}) AND {base}'), ('rows', rows), ('page', page), ('output', 'json')] + fields
        + ([('sort[]', order)] if order else [])), 'Internet Archive').get('response') or {}
    if not terms:
        data = ask('*:*')
    else:
        data = ask(archive_title_query(terms))
        if not data.get('numFound'):
            # Nothing by title: the description, still with every word.
            data = ask('description:(' + ' AND '.join(terms.split()) + ')')
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
            link=f'https://archive.org/details/{identifier}', cover=f'https://archive.org/services/img/{identifier}', pages='',
            downloads=int(doc.get('downloads') or 0), series=series_name(doc.get('title')) if magazines else ''))
    books = [b for b in books if not adult(' '.join([b['title'], b['publisher'], b['abstract']]))]
    return (archive_rank(books, terms) if terms and sort == 'relevance' else books), page * rows < (data.get('numFound') or 0)


def archive_magazines(terms, page, lang, sort='relevance', category=''):
    return archive_books(terms, page, lang, sort=sort, category=category, magazines=True)


# ---------- More free, legal books (v2)
OL_LANGS = {'id': 'ind', 'en': 'eng', 'ms': 'may'}


def openlibrary_books(terms, page, lang, sort='relevance', category=''):
    """Open Library: books readable for free ("public" ebook access); the PDF is the Internet Archive scan."""
    if not terms:
        return [], False
    params = {'q': terms + (f' language:{OL_LANGS[lang]}' if lang in OL_LANGS else ''), 'ebook_access': 'public',
              'fields': 'key,title,subtitle,author_name,first_publish_year,language,cover_i,ia,publisher,number_of_pages_median,first_sentence',
              'limit': EBOOK_PER_SOURCE, 'page': page}
    if sort in ('newest', 'oldest'):
        params['sort'] = 'new' if sort == 'newest' else 'old'
    elif sort == 'popular':
        params['sort'] = 'rating'
    data = ebook_get('https://openlibrary.org/search.json?' + urlencode(params), 'Open Library')
    books = []
    for d in data.get('docs') or []:
        ia = next((x for x in d.get('ia') or [] if ARCHIVE_ID.fullmatch(str(x))), '')
        if not ia or not d.get('title'):
            continue
        title = d['title'] + (': ' + d['subtitle'] if d.get('subtitle') else '')
        langs = d.get('language') or []
        language = next((IA_LANGS[x] for x in langs if x in IA_LANGS), (langs or [''])[0])
        books.append(dict(
            source='openlibrary', id=ia, title=' '.join(title.split()), authors=(d.get('author_name') or [])[:6],
            year=str(d.get('first_publish_year') or ''), language=language, publisher=', '.join((d.get('publisher') or [])[:2])[:120],
            license='Akses terbuka (Open Library / Internet Archive)', licenseByUploader=False,
            abstract=abstract_cut(' '.join(d.get('first_sentence') or [])), link='https://openlibrary.org' + str(d.get('key') or ''),
            cover=f'https://covers.openlibrary.org/b/id/{d["cover_i"]}-M.jpg' if d.get('cover_i') else f'https://archive.org/services/img/{ia}',
            pages=str(d.get('number_of_pages_median') or ''), downloads=0, series=''))
    books = [b for b in books if not adult(b['title'])]
    return books, page * EBOOK_PER_SOURCE < (data.get('numFound') or 0)


GUTENBERG_PER_PAGE = 25      # Project Gutenberg's own catalogue feed (OPDS) pages by 25
GUTENBERG_OPDS = 'https://www.gutenberg.org/ebooks/search.opds/?'
GUTENBERG_ENTRY = re.compile(r'<entry>.*?<id>https://www\.gutenberg\.org/ebooks/(\d{1,7})\.opds</id>.*?<title>([^<]*)</title>'
                             r'(?:\s*<content[^>]*>([^<]*)</content>)?', re.S)


def gutenberg_books(terms, page, lang, sort='relevance', category=''):
    """Project Gutenberg (public domain classics), from its own catalogue feed (Gutendex, the JSON
    mirror, stalls on searches). No PDF there: the flipbook gets one made from the plain text
    (text_pdf). Browsing without words lists the most downloaded."""
    query = ' '.join(filter(None, [terms, f'l.{lang}' if lang in ('id', 'en', 'ms') else '']))
    params = {'start_index': (page - 1) * GUTENBERG_PER_PAGE + 1}
    if query:
        params['query'] = query
    if sort == 'popular' or not terms:
        params['sort_order'] = 'downloads'
    elif sort == 'newest':
        params['sort_order'] = 'release_date'
    feed = ebook_get(GUTENBERG_OPDS + urlencode(params), 'Project Gutenberg', timeout=10, text=True)
    books = []
    for book_id, title, author in GUTENBERG_ENTRY.findall(feed):
        title, author = ' '.join(unescape(title).split()), ' '.join(unescape(author or '').split())
        if re.fullmatch(r'[\d,.]+ downloads', author):          # no author listed: the feed shows the count
            author = ''
        books.append(dict(
            source='gutenberg', id=book_id, title=title, authors=[author] if author else [],
            year='', language=lang if lang in ('id', 'en', 'ms') else '', publisher='Project Gutenberg',
            license='Domain publik (Project Gutenberg)', licenseByUploader=False, abstract='',
            link=f'https://www.gutenberg.org/ebooks/{book_id}',
            cover=f'https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.cover.medium.jpg', pages='', downloads=0, series=''))
    books = [b for b in books if not adult(b['title'])]
    return books, len(books) >= GUTENBERG_PER_PAGE - 2


def google_books(terms, page, lang, sort='relevance', category=''):
    """Google Books: free e-books (metadata, covers, read online). Their PDF downloads only open in the
    reader's own browser (Google refuses servers), so the result says so."""
    key = os.environ.get('GOOGLE_BOOKS_API_KEY', '').strip()
    if not key or not terms:
        return [], False
    params = {'q': terms, 'filter': 'free-ebooks', 'printType': 'books', 'maxResults': EBOOK_PER_SOURCE,
              'startIndex': (page - 1) * EBOOK_PER_SOURCE, 'key': key}
    if lang in ('id', 'en', 'ms'):
        params['langRestrict'] = lang
    if sort == 'newest':
        params['orderBy'] = 'newest'
    data = ebook_get('https://www.googleapis.com/books/v1/volumes?' + urlencode(params), 'Google Books')
    books = []
    for it in data.get('items') or []:
        v, a = it.get('volumeInfo') or {}, it.get('accessInfo') or {}
        if not v.get('title') or not re.fullmatch(r'[\w-]{6,24}', str(it.get('id') or '')):
            continue
        cover = ((v.get('imageLinks') or {}).get('thumbnail') or '').replace('http://', 'https://')
        pdf = (a.get('pdf') or {}).get('downloadLink') if (a.get('pdf') or {}).get('isAvailable') else ''
        books.append(dict(
            source='google', id=it['id'], title=' '.join((v['title'] + (': ' + v['subtitle'] if v.get('subtitle') else '')).split()),
            authors=(v.get('authors') or [])[:6], year=str(v.get('publishedDate') or '')[:4], language=v.get('language') or '',
            publisher=str(v.get('publisher') or '')[:120], license='Gratis (Google Books)', licenseByUploader=False,
            abstract=abstract_cut(re.sub(r'<[^>]+>', ' ', v.get('description') or '')), link=v.get('infoLink') or '',
            cover=cover, pages=str(v.get('pageCount') or ''), downloads=0, series='',
            readOnline=(a.get('webReaderLink') or '').replace('http://', 'https://'),
            browserPdf=(pdf or '').replace('http://', 'https://')))
    books = [b for b in books if not adult(b['title'])]
    return books, (page * EBOOK_PER_SOURCE) < int(data.get('totalItems') or 0)


GUTENBERG_PDF_CACHE = {}


def gutenberg_pdf(book_id):
    """(bytes, filename) of a Gutenberg book turned into a PDF from its plain text."""
    if not re.fullmatch(r'\d{1,7}', book_id or ''):
        raise ValueError('Buku tidak dikenal.')
    if book_id in GUTENBERG_PDF_CACHE:
        return GUTENBERG_PDF_CACHE[book_id]
    try:
        data, _, _ = fetch_source(f'https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.txt', public_only=True)
    except (ValueError, RuntimeError, OSError) as cause:
        raise LookupError('Buku ini tidak punya teks yang bisa dijadikan flipbook.') from cause
    text = data.decode('utf-8', 'replace')
    head = text[:6000]                                # "Title: …" / "Author: …" lines before the book starts
    field = lambda name: ' '.join((re.search(rf'^{name}:\s*(.+)$', head, re.M | re.I) or [None, ''])[1].split())
    title = field('Title') or 'Buku'
    pdf = text_pdf.build(text, title, field('Author'), f'Project Gutenberg #{book_id} - domain publik')
    name = re.sub(r'[^\w.-]+', '_', title)[:80] + '.pdf'
    if len(GUTENBERG_PDF_CACHE) > 20:
        GUTENBERG_PDF_CACHE.clear()
    GUTENBERG_PDF_CACHE[book_id] = (pdf, name)
    return pdf, name


def ebook_pdf(source, identifier):
    """{pdf, size} of one search result's book, looked up when it's opened."""
    if source == 'openlibrary':
        source = 'archive'                       # Open Library's readable books are Internet Archive scans
    if source == 'gutenberg' and re.fullmatch(r'\d{1,7}', identifier or ''):
        return dict(pdf='/api/ebooks/file?' + urlencode({'src': 'gutenberg', 'id': identifier}), size=0)
    if source == 'doab':
        raise LookupError('Buku DOAB dibuka di browser Anda: klik Buka PDF atau Baca di penerbit, lalu seret file-nya ke Flipbook.')
    if source == 'google':
        raise LookupError('Google Books hanya bisa diunduh lewat browser. Klik 📄 PDF, lalu seret file-nya ke Flipbook.')
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


# Safe search for books and magazines: campuses and schools use the site, and Internet
# Archive uploads include adult magazines. Adult searches get no results; adult-looking
# results are dropped (title, subject, publisher, description).
ADULT_WORDS = re.compile(
    r'\b(playboy|penthouse|hustler|xxx|porn\w*|porno|erotic\w*|erotik\w*|nude|nudes|nudity|naked|sex|sexy|seksi|bokep|'
    r'telanjang|bugil|mesum|hentai|nsfw|onlyfans|fetish|lingerie|stripper|adult\s+(?:magazine|content|only)|dewasa\s*18)\b', re.I)


class AdultSearch(ValueError):
    pass


def adult(text):
    return bool(ADULT_WORDS.search(str(text or '')))


# Words that ask for an order, not a title: "majalah populer fotografi", "buku terbaru".
# Indonesian words only: English ones are often part of a title ("Popular Science", "Latest Fashions").
SORT_WORDS = [(re.compile(r'\b(paling\s+)?(populer|terpopuler|terlaris|favorit)\b', re.I), 'popular'),
              (re.compile(r'\b(terbaru|terkini)\b', re.I), 'newest'),
              (re.compile(r'\b(terlama|terlawas|lawas)\b', re.I), 'oldest')]
FILLER_WORDS = re.compile(r'\b(majalah|magazine|magazines|buku|ebook|e-book|books?)\b', re.I)
def doab_books(terms, page, lang, sort='relevance', category=''):
    """DOAB: open-access academic books (OAPEN's among them), from the local index that
    doab_index.py harvests over OAI-PMH. Their PDFs open in the reader's browser (OAPEN's
    anti-bot check refuses servers), so results carry links, not a server-made flipbook."""
    if not terms:
        return [], False
    rows, total = doab_index.search(terms, page, lang if lang in ('id', 'en', 'ms') else None, sort, EBOOK_PER_SOURCE)
    books = []
    for r in rows:
        books.append(dict(
            source='doab', id=r['handle'], title=r['title'], authors=[a for a in r['authors'].split('; ') if a][:6], year=r['year'],
            language=r['lang'], publisher=r['publisher'], license='Akses terbuka (DOAB)', licenseByUploader=False,
            abstract=r['subjects'].replace('; ', ' · ')[:300], link=f'https://directory.doabooks.org/handle/{r["handle"]}',
            cover='', pages='', downloads=0, series='', readOnline=r['link'], browserPdf=r['pdf'],
            doi=('https://doi.org/' + r['doi']) if r['doi'] else ''))
    books = [b for b in books if not adult(b['title'])]
    return books, page * EBOOK_PER_SOURCE < total


EBOOK_SOURCES = {'archive': archive_books, 'openlibrary': openlibrary_books, 'gutenberg': gutenberg_books, 'doab': doab_books,
                 'google': google_books, 'oapen': oapen_books}
EBOOK_DEFAULT = ('gutenberg', 'openlibrary', 'doab', 'archive', 'google')     # Gutenberg first: the same book wins as clean text; DOAB replaces OAPEN's REST (refuses servers)


def read_intent(query, sort):
    """(words left, sort): order words become the sort; "majalah"/"buku" alone add nothing."""
    words = query
    for pattern, order in SORT_WORDS:
        if pattern.search(words):
            words = pattern.sub(' ', words)
            sort = order if sort == 'relevance' else sort
    left = FILLER_WORDS.sub(' ', words)
    return ' '.join((left if left.split() else words if not FILLER_WORDS.fullmatch(words.strip()) else '').split()), sort


def title_key(book):
    return re.sub(r'[^a-z0-9]+', '', book['title'].lower())[:60] + '|' + (re.sub(r'[^a-z]+', '', (book['authors'] or [''])[0].lower())[:12])


def ebook_search(query, page=1, lang=None, source='all', sort='relevance', category=''):
    """Books (or magazines) with a PDF: dict(page, more, results=[...], errors=[...]). Sources
    run side by side; one source failing still returns the other's books. An empty query
    browses (the most read first)."""
    if adult(query):
        raise AdultSearch('Konten dewasa tidak tersedia di MyFlipbook Pro. Coba kata kunci lain.')
    sort = sort if sort in EBOOK_SORTS else 'relevance'
    category = category if category in MAGAZINE_CATEGORIES else ''
    cleaned = ebook_terms(query)
    terms, sort = read_intent(cleaned, sort)
    if (terms and len(terms) < 2) or (str(query or '').strip() and not cleaned):     # only symbols: not a browse
        raise ValueError('Tulis kata kunci 2-200 karakter.')
    key = json.dumps(['ebook', terms.lower(), page, lang, source, sort, category])
    hit = JOURNAL_CACHE.get(key)
    if hit and time.time() - hit[0] < JOURNAL_CACHE_SECONDS:
        return hit[1]
    if source == 'magazine':
        wanted = [archive_magazines]
    elif source in EBOOK_SOURCES:
        wanted = [EBOOK_SOURCES[source]]
    else:
        wanted = [EBOOK_SOURCES[name] for name in EBOOK_DEFAULT]
    if not terms:
        # Browsing: Gutenberg's most read (curated, public domain) for books; Archive's open book
        # collections mix in pirated uploads when sorted by downloads, so only its magazine shelf browses.
        wanted = [fn for fn in wanted if fn in (archive_magazines, gutenberg_books)] or [gutenberg_books]
    lists, more, errors = [], False, []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for job in [pool.submit(fn, terms, page, lang, sort, category) for fn in wanted]:
            try:
                books, has_more = job.result()
                lists.append(books)
                more = more or has_more
            except RuntimeError as cause:
                errors.append(str(cause))
    if not lists:
        raise RuntimeError(' '.join(errors))
    results, seen = [], set()
    for i in range(max(map(len, lists))):          # alternate sources; the same book once
        for books in lists:
            if i < len(books) and title_key(books[i]) not in seen:
                seen.add(title_key(books[i]))
                results.append(books[i])
    if sort == 'popular':
        results.sort(key=lambda b: -b.get('downloads', 0))
    out = dict(page=page, more=more, results=results, errors=errors, maxBytes=FETCH_MAX_BYTES, sort=sort, browse=not terms,
               categories={k: v[0] for k, v in MAGAZINE_CATEGORIES.items()} if source == 'magazine' else {})
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
            f'{link}\n\nLink berlaku 48 jam. Abaikan email ini bila Anda tidak mendaftar.\n\n— MyFlipbook')
    html = (f'<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#1c1917">'
            f'<p>{hello}</p><p>Terima kasih sudah mendaftar di <b>MyFlipbook</b>. Klik tombol ini untuk memverifikasi email dan masuk:</p>'
            f'<p style="text-align:center;margin:28px 0"><a href="{link}" style="background:#1a3c34;color:#fff;padding:12px 22px;'
            f'border-radius:999px;text-decoration:none;font-weight:bold">Verifikasi email</a></p>'
            f'<p style="font-size:12px;color:#78716c">Atau buka link ini: {link}<br>Link berlaku 48 jam. Abaikan email ini bila Anda tidak mendaftar.</p>'
            f'<p>— MyFlipbook</p></div>')
    return send_mail(to, 'Verifikasi email MyFlipbook', text, html)


def reset_mail(to, name, link):
    hello = f'Halo {name},' if name else 'Halo,'
    text = (f'{hello}\n\nAda permintaan untuk mengganti password akun MyFlipbook Anda. Klik link ini untuk membuat password baru:\n\n'
            f'{link}\n\nLink berlaku 1 jam dan hanya bisa dipakai sekali. Abaikan email ini bila Anda tidak memintanya; password Anda tetap sama.\n\n— MyFlipbook')
    html = (f'<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#1c1917">'
            f'<p>{hello}</p><p>Ada permintaan untuk mengganti password akun <b>MyFlipbook</b> Anda. Klik tombol ini untuk membuat password baru:</p>'
            f'<p style="text-align:center;margin:28px 0"><a href="{link}" style="background:#1a3c34;color:#fff;padding:12px 22px;'
            f'border-radius:999px;text-decoration:none;font-weight:bold">Buat password baru</a></p>'
            f'<p style="font-size:12px;color:#78716c">Atau buka link ini: {link}<br>Link berlaku 1 jam dan hanya bisa dipakai sekali. '
            f'Abaikan email ini bila Anda tidak memintanya; password Anda tetap sama.</p><p>— MyFlipbook</p></div>')
    return send_mail(to, 'Reset password MyFlipbook', text, html)


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
                                             'Upgrade ke Medium atau Pro untuk jatah lebih besar.')
        store.spend(user['id'], kind, amount, now)

    def summary_words(self, user):
        """{used, limit, resetAt} of the member's summary words this month."""
        start, end = accounts.month_bounds()
        used, _ = get_accounts().usage_in(user['id'], 'summary_words', start - 1)
        return dict(used=used, limit=summary_words_limit(user), resetAt=end)

    def summary_allowance(self):
        """Raise 429 when the member's summary words for this month are used up (hosted only)."""
        if not hosted():
            return
        user = self.current_user()
        if not user:
            return
        words = self.summary_words(user)
        if words['limit'] is not None and words['used'] >= words['limit']:
            # the numbers are our own guide: the member hears that it is used up, when it refills, and where to go
            upgrade = user['plan'] != 'pro'
            raise accounts.AccountError(429, f'Kuota ringkasan bulan ini sudah habis — terisi lagi {month_label(words["resetAt"])}.'
                                             + (' Upgrade ke Pro untuk kuota yang lebih besar.' if upgrade else ''), upgrade=upgrade)

    def count_summary(self, text):
        """Count the words of a summary just made against the member's month."""
        user = self.current_user()
        if user and text:
            get_accounts().spend(user['id'], 'summary_words', len(str(text).split()))

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

    def team_browser(self):
        """A browser the admin marked "do not count" (cookie mf_team=1, set from the admin panel)."""
        return any(part.strip() == 'mf_team=1' for part in self.headers.get('Cookie', '').split(';'))

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
                                        place=geo.lookup(key[0]), kind='team' if self.team_browser() else '')
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
            self.send_json(200, {'books': store.books(user), 'usage': store.usage(user), 'folders': store.folders(user)})
            return
        if path == '/api/library/draft':                     # the PDF editor's autosave
            data, name, saved_at = store.draft(user)
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Cache-Control', 'private, no-store')
            self.send_header('X-Draft-Name', quote(name))
            self.send_header('X-Saved-At', str(saved_at))
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
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
        if path == '/api/library/draft':
            if user.get('trialExpired'):
                self.send_json(402, {'error': 'Masa coba gratis 7 hari Anda sudah habis. Upgrade ke Medium atau Pro untuk memakai fitur ini.'})
                return
            saved_at = store.save_draft(user, self.read_raw(library.MAX_DRAFT), unquote(self.headers.get('X-Draft-Name', '')),
                                        self.headers.get('X-Saved-At', ''))
            self.send_json(200, {'savedAt': saved_at})
            return
        if path == '/api/library/draft/delete':
            store.delete_draft(user)
            self.send_json(200, {'ok': True})
            return
        # Folders: POST /api/library/folders {name}; /api/library/folders/<id>/rename {name}; …/<id>/delete;
        # a book moves with POST /api/library/<book>/move {folder: id or null}.
        if path == '/api/library/folders':
            body = self.read_json(self.read_raw(64 * 1024))
            self.send_json(200, {'id': store.make_folder(user, body.get('name'), body.get('parent')), 'folders': store.folders(user)})
            return
        match = re.fullmatch(r'/api/library/folders/([0-9a-f]{32})/(rename|delete|move)', path)
        if match:
            if match[2] == 'rename':
                store.rename_folder(user, match[1], self.read_json(self.read_raw(64 * 1024)).get('name'))
            elif match[2] == 'move':
                store.move_folder(user, match[1], self.read_json(self.read_raw(64 * 1024)).get('parent'))
            else:
                store.delete_folder(user, match[1])
            self.send_json(200, {'folders': store.folders(user)})
            return
        match = re.fullmatch(r'/api/library/([0-9a-f]{32})/move', path)
        if match:
            store.move_book(user, match[1], self.read_json(self.read_raw(64 * 1024)).get('folder'))
            self.send_json(200, {'ok': True})
            return
        if path == '/api/library/save':
            if store.usage(user)['maxBooks'] == 0:     # Basic has no My Library (plans v2): before taking the upload
                self.send_json(402, {'error': 'My Library butuh paket Medium atau Pro. Paket Basic tetap bisa membaca semua flipbook.'})
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
            # Basic shares its first SHARE_FREE links (trial or not, plans v2); more need Medium or Pro.
            if 'export' not in user['entitlements'] and store.usage(user)['links'] >= accounts.SHARE_FREE:
                self.send_json(402, {'error': 'Jatah 3 share gratis habis. Upgrade ke Medium atau Pro untuk share lebih banyak.'})
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
            paused = payments_paused(self.current_user())
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
        if path == '/api/auth/forgot':
            found = store.reset_request(data.get('email'), self.client_ip())
            if found:
                user_id, token, name = found
                try:
                    # the token rides in the fragment: it never reaches a server, nor another site as a referrer
                    reset_mail(str(data.get('email')).strip().lower(), name, self.base_url() + '/login.html#reset=' + token)
                except RuntimeError as cause:
                    raise accounts.AccountError(502, str(cause))
            self.send_json(200, {'ok': True})     # the same answer whether or not the email is registered
            return
        if path == '/api/auth/reset':
            token = store.reset_password(data.get('token'), data.get('password'))
            self.send_json(200, {'user': store.user_for(token)}, cookie=self.session_cookie(token))
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
            if payments_paused(user):
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
        if not 2 <= len(q) <= (DOI_MAX * 80 if query_dois(q) else 200):      # a list of DOIs may run longer
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
        """GET /api/ebooks?q=&page=&lang=&src=all|archive|openlibrary|gutenberg|google|oapen|magazine&sort=&cat=
        -> books with a PDF. An empty q browses (the most read first)."""
        query = parse_qs(urlsplit(self.path).query)
        one = lambda name, default='': (query.get(name) or [default])[0].strip()
        q = ' '.join(one('q').split())
        if len(q) > 200 or len(q) == 1:
            self.send_json(400, {'error': 'Tulis kata kunci 2-200 karakter.'})
            return
        try:
            page = max(1, min(50, int(one('page', '1') or 1)))
        except ValueError:
            page = 1
        source = one('src', 'all')
        try:
            self.send_json(200, ebook_search(q, page, lang=one('lang') or None,
                                             source=source if source in EBOOK_SOURCES or source == 'magazine' else 'all',
                                             sort=one('sort', 'relevance'), category=one('cat')))
        except ValueError as cause:              # the query itself (adult, too short): the reader's to fix
            self.send_json(400, {'error': str(cause)})
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

    def sources_text(self, data):
        """One or several sources as one combined text, for summary/ask/write. Legacy shape
        (`{title, text: {page: [lines]}}`, one document) wraps as a single source and keeps
        `book_text`'s exact bare `[Halaman N]` tags. The new shape (`sources: [{name,
        text: {page: [lines]}}, ...]`, AI Summarizer's multi-source Sources panel) tags each
        page `[Sumber I: Name — Halaman N]` so the model can cite which source a fact came
        from. Returns `(text, index, names)`: `index` maps `(source_number, page_number) ->
        raw lines` and `names` maps `source_number -> its label`, both for `ask_citations`."""
        raw = data.get('sources')
        if not isinstance(raw, list) or not raw:
            raw = [{'name': data.get('title'), 'text': data.get('text')}]
        blocks, index, names = [], {}, {}
        total_words = 0
        for i, src in enumerate(raw[:20], 1):
            if not isinstance(src, dict):
                continue
            name = re.sub(r'[\[\]]', '', ' '.join(str(src.get('name') or f'Sumber {i}').split()))[:150] or f'Sumber {i}'
            names[i] = name
            pages = src.get('text')
            if not isinstance(pages, dict):
                continue
            ordered = sorted((int(k), v) for k, v in pages.items() if re.fullmatch(r'0|[1-9][0-9]*', str(k)) and isinstance(v, list))
            for k, lines in ordered:
                clean_lines = [str(line) for line in lines if isinstance(line, str)]
                block = '\n'.join(clean_lines)
                total_words += len(block.split())
                tag = f'[Halaman {k + 1}]' if len(raw) == 1 else f'[Sumber {i}: {name} — Halaman {k + 1}]'
                blocks.append(f'{tag}\n{block}')
                index[(i, k + 1)] = clean_lines
        if total_words < 40:
            raise ValueError('Buku ini hampir tidak punya teks (hasil scan?). Jalankan OCR dulu.')
        return '\n\n'.join(blocks), index, names

    def summary_route(self):
        """POST {title, text: {page: [lines]}, lang} -> {lang, text} (one document), or
        {sources: [{name, text: {page: [lines]}}], lang} -> {lang, text} (several, AI
        Summarizer's Sources panel — the summary then cites which source each point is from)."""
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 16 * 1024 * 1024:
                raise ValueError('Teks buku kosong atau terlalu besar.')
            data = json.loads(self.rfile.read(size).decode('utf-8'))
            text, _, _ = self.sources_text(data)
            lang = data.get('lang') if data.get('lang') in TRANSLATE_LANGUAGES else 'id-ID'
            title = str(data.get('title') or 'Buku')[:200]
            length = data.get('length') if data.get('length') in SUMMARY_LENGTHS else 'sedang'
            focus = data.get('focus') if isinstance(data.get('focus'), str) else ''
            # the PDF's chapters (its outline): [{title, page (index from 0)}]
            chapters = [(' '.join(str(c['title']).split())[:200], c['page']) for c in (data.get('chapters') or [])[:120]
                        if isinstance(c, dict) and isinstance(c.get('title'), str) and c['title'].strip()
                        and type(c.get('page')) is int and 0 <= c['page'] < 100_000] if isinstance(data.get('chapters'), list) else []
        except (ValueError, UnicodeDecodeError) as cause:
            self.send_json(400, {'error': 'Permintaan tidak valid.' if isinstance(cause, (json.JSONDecodeError, UnicodeDecodeError)) else str(cause)})
            return
        try:
            result = summarize_book(title, text, lang, length, focus, chapters)
        except RuntimeError as cause:
            self.send_json(502, {'error': str(cause)})
            return
        self.count_summary(result.get('text'))
        self.send_json(200, result)

    def ask_route(self):
        """POST {title, text: {page: [lines]}, question, history: [{role, text}]} -> {answer}
        (one document), or {sources: [{name, text: {page: [lines]}}], question, history} ->
        {answer, citations, thoughts} (several, AI Summarizer's Sources panel). `citations` is
        the ordered, numbered list the answer's `[n]` markers point to; `thoughts` is Gemini's
        thought summary (empty for other models or when thinking is off)."""
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 16 * 1024 * 1024:
                raise ValueError('Teks dokumen kosong atau terlalu besar.')
            data = json.loads(self.rfile.read(size).decode('utf-8'))
            text, index, names = self.sources_text(data)
            history = data.get('history') if isinstance(data.get('history'), list) else []
            answer, thoughts = ask_document(str(data.get('title') or 'Dokumen')[:200], text, data.get('question'),
                                            history, data.get('work'), include_thoughts=True)
        except (ValueError, UnicodeDecodeError) as cause:
            self.send_json(400, {'error': 'Permintaan tidak valid.' if isinstance(cause, (json.JSONDecodeError, UnicodeDecodeError)) else str(cause)})
            return
        except RuntimeError as cause:
            self.send_json(502, {'error': str(cause)})
            return
        answer, citations = ask_citations(index, names, answer, data.get('question') or '')
        self.send_json(200, {'answer': answer, 'citations': citations, 'thoughts': thoughts})

    def write_route(self):
        """POST {kind: 'journal'|'slides'|'quiz'|'flashcards'|'table', title, text: {page: [lines]},
        lang, work, section | count} -> {text} (journal) / {slides:[...]} / {questions:[...]} /
        {cards:[...]} / {table:{...}}."""
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 16 * 1024 * 1024:
                raise ValueError('Teks dokumen kosong atau terlalu besar.')
            data = json.loads(self.rfile.read(size).decode('utf-8'))
            if not isinstance(data, dict) or data.get('kind') not in ('journal', 'slides', 'quiz', 'flashcards', 'table', 'mindmap', 'infographic'):
                raise ValueError('Permintaan tidak valid.')
            text, _, _ = self.sources_text(data)
            title = str(data.get('title') or 'Dokumen')[:200]
            lang = data.get('lang') if data.get('lang') in TRANSLATE_LANGUAGES else 'id-ID'
            count = data.get('count') if type(data.get('count')) is int else 8
            kind = data['kind']
            if kind == 'journal':
                result = {'text': write_journal(title, text, data.get('section'), lang, data.get('work'))}
            elif kind == 'slides':
                result = {'slides': make_slides(title, text, lang, count, data.get('work'))}
            elif kind == 'quiz':
                result = {'questions': make_quiz(title, text, lang, count, data.get('work'))}
            elif kind == 'flashcards':
                result = {'cards': make_flashcards(title, text, lang, count, data.get('work'))}
            elif kind == 'mindmap':
                result = {'mindmap': make_mindmap(title, text, lang, data.get('work'))}
            elif kind == 'infographic':
                result = {'infographic': make_infographic(title, text, lang, data.get('work'))}
            else:
                result = {'table': make_table(title, text, lang, data.get('work'))}
        except (ValueError, UnicodeDecodeError) as cause:
            self.send_json(400, {'error': 'Permintaan tidak valid.' if isinstance(cause, (json.JSONDecodeError, UnicodeDecodeError)) else str(cause)})
            return
        except RuntimeError as cause:
            self.send_json(502, {'error': str(cause)})
            return
        self.send_json(200, result)

    def research_route(self):
        """POST {query, lang} -> {sources: [{title, url}]} ("Fast Research" in the Sources
        panel: the member picks which of these to actually add as sources)."""
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 2000:
                raise ValueError('Permintaan tidak valid.')
            data = json.loads(self.rfile.read(size).decode('utf-8'))
            lang = data.get('lang') if isinstance(data, dict) and data.get('lang') in TRANSLATE_LANGUAGES else 'id-ID'
            results = research(data.get('query') if isinstance(data, dict) else None, lang)
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as cause:
            self.send_json(400, {'error': 'Permintaan tidak valid.' if isinstance(cause, (json.JSONDecodeError, UnicodeDecodeError)) else str(cause)})
            return
        except RuntimeError as cause:
            self.send_json(502, {'error': str(cause)})
            return
        self.send_json(200, {'sources': results})

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
        self.count_summary(summary)
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
        """POST {title, text: {page: [lines]}, lang, hosts} -> two-host podcast script (one
        document), or {sources: [{name, text: {page: [lines]}}], lang, hosts} (several, the AI
        Summarizer's Sources panel — the podcast then covers every active source)."""
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 8 * 1024 * 1024:
                raise ValueError('Teks buku kosong atau terlalu besar.')
            data = json.loads(self.rfile.read(size).decode('utf-8'))
            text, _, _ = self.sources_text(data)
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

    def podcast_audio_route(self):
        """POST {lines: [{s:'A'|'B', t}], lang} -> audio/wav: the script (already made via
        /api/podcast/script) read aloud with Piper TTS. Kept separate from script generation so
        the member sees the transcript immediately and the audio never drifts from it."""
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 2 * 1024 * 1024:
                raise ValueError('Naskah kosong atau terlalu besar.')
            data = json.loads(self.rfile.read(size).decode('utf-8'))
            lang = data.get('lang') if isinstance(data, dict) and data.get('lang') in PODCAST_LANGUAGES else 'id-ID'
            lines = data.get('lines') if isinstance(data, dict) else None
            clean = []
            for row in (lines or [])[:400]:
                if isinstance(row, dict) and row.get('s') in ('A', 'B') and isinstance(row.get('t'), str) and row['t'].strip():
                    clean.append({'s': row['s'], 't': row['t'].strip()[:2000]})
            if not clean:
                raise ValueError('Naskah tidak valid.')
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as cause:
            self.send_json(400, {'error': str(cause) if isinstance(cause, ValueError) and not isinstance(cause, json.JSONDecodeError) else 'Permintaan tidak valid.'})
            return
        try:
            audio = synthesize_podcast(clean, lang)
        except RuntimeError as cause:
            self.send_json(502, {'error': str(cause)})
            return
        self.send_response(200)
        self.send_header('Content-Type', 'audio/wav')
        self.send_header('Content-Length', str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)

    def video_overview_route(self):
        """POST {title, text/sources, lang, work} -> {id}: starts a background job (slides ->
        per-slide PNG + Piper narration -> ffmpeg -> one MP4), reusing the existing
        /api/jobs/<id> (poll) and /api/jobs/<id>/download (fetch) that APK/EXE builds use —
        same BUILD_LOCK (one native/video job at a time on this server)."""
        if not BUILD_LOCK.acquire(blocking=False):
            self.send_json(409, {'error': 'Masih ada proses build berjalan. Tunggu hingga selesai.'})
            return
        started = False
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 16 * 1024 * 1024:
                raise ValueError('Teks dokumen kosong atau terlalu besar.')
            data = json.loads(self.rfile.read(size).decode('utf-8'))
            text, _, _ = self.sources_text(data)
            title = str(data.get('title') or 'Dokumen')[:200]
            lang = data.get('lang') if data.get('lang') in TRANSLATE_LANGUAGES else 'id-ID'
            work = clean_work(data.get('work'))
            prune_builds()
            job_id = uuid.uuid4().hex
            (BUILD / job_id).mkdir(parents=True)
            JOBS[job_id] = dict(id=job_id, status='queued', message='Video Overview menunggu…', progress=0)
            threading.Thread(target=video_overview_job, args=(job_id, title, text, lang, work), daemon=True).start()
            started = True
            self.send_json(202, {'id': job_id})
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as cause:
            self.send_json(400, {'error': str(cause) if isinstance(cause, ValueError) and not isinstance(cause, json.JSONDecodeError) else 'Permintaan tidak valid.'})
        finally:
            if not started:
                BUILD_LOCK.release()

    def entitlement_error(self, feature):
        """None when allowed, else (status, message).

        Office conversion is gated on a public host only; exports and
        native builds whenever the paywall is on.
        """
        if not (hosted() if feature == 'office' else CONFIG['paywall']):
            return None
        user = self.current_user()
        if feature == 'translate':                       # members only; no plan, no trial needed
            return None if user else (401, 'Silakan masuk dulu untuk memakai fitur ini.')
        if not user:
            return 401, 'Silakan masuk dulu untuk memakai fitur ini.'
        # Ringkasan AI hanya untuk paket berbayar, termasuk saat Basic masih trial.
        if self.path in SUMMARY_ROUTES and user['plan'] not in accounts.PAID:
            return 402, 'Ringkasan AI hanya tersedia untuk paket Medium atau Pro.'
        if feature == 'ai' and user['plan'] not in accounts.PAID:
            return 402, 'AI Summarizer hanya tersedia untuk paket Medium atau Pro.'
        # Plans v2: after the 7-day trial Basic keeps Office to PDF within its allowance.
        if user.get('trialExpired') and feature in ('ai', 'podcast'):
            return 402, 'Masa coba gratis 7 hari Anda sudah habis. Upgrade ke Medium atau Pro untuk memakai fitur ini.'
        # Book translation runs on the free translator (no AI credit): only the allowance limits it.
        if feature in ('ai', 'podcast') and not payments_live() and user['plan'] not in accounts.PAID and self.path != '/api/translate-free':
            # No gateway yet: paid members (their plan already covers AI credit)
            # keep working; free waits until payments are set up.
            return 503, 'Fitur AI belum aktif di server ini (pembayaran belum disiapkan).'
        if feature not in user['entitlements']:
            plan = 'Pro' if feature in ('apk', 'exe', 'podcast') else 'Medium atau Pro'
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
        if path in ('/api/authors', '/api/authors/profile'):
            query = parse_qs(urlsplit(self.path).query)
            try:
                self.send_json(200, {'authors': author_search((query.get('q') or [''])[0])} if path == '/api/authors'
                               else author_profile((query.get('id') or [''])[0]))
            except ValueError as cause:
                self.send_json(400, {'error': str(cause)})
            except RuntimeError as cause:
                self.send_json(502, {'error': str(cause)})
            return
        if path == '/api/journals/pdf':
            query = parse_qs(urlsplit(self.path).query)
            try:
                found = journal_pdf((query.get('id') or [''])[0], (query.get('pdf') or [''])[0], (query.get('doi') or [''])[0])
            except ValueError as cause:
                self.send_json(400, {'error': str(cause)})
            else:
                self.send_json(200 if found['pdf'] else 404, dict(found, maxBytes=FETCH_MAX_BYTES) if found['pdf'] else
                               {'error': 'PDF artikel ini tidak tersedia untuk umum. Buka artikelnya di situs penerbit.', 'open': found.get('open', '')})
            return
        if path == '/api/ebooks/file':
            query = parse_qs(urlsplit(self.path).query)
            if not journal_file_allowed(self.client_address[0]):
                self.send_json(429, {'error': 'Terlalu banyak artikel dalam satu jam. Coba lagi nanti.'})
                return
            try:
                data, name = ebook_file((query.get('src') or [''])[0], (query.get('id') or [''])[0])
            except (ValueError, LookupError) as cause:
                self.send_json(404 if isinstance(cause, LookupError) else 400, {'error': str(cause)})
                return
            except RuntimeError as cause:
                self.send_json(502, {'error': str(cause)})
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('X-Filename', quote(name))
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if path == '/api/journals/file':
            query = parse_qs(urlsplit(self.path).query)
            if not journal_file_allowed(self.client_address[0]):
                self.send_json(429, {'error': 'Terlalu banyak artikel dalam satu jam. Coba lagi nanti.'})
                return
            try:
                data, name = journal_file((query.get('id') or [''])[0], (query.get('pdf') or [''])[0], (query.get('doi') or [''])[0])
            except (ValueError, LookupError) as cause:
                self.send_json(404 if isinstance(cause, LookupError) else 400, {'error': str(cause)})
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('X-Filename', quote(name))
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if path == '/api/ebooks/pdf':
            query = parse_qs(urlsplit(self.path).query)
            try:
                found = ebook_pdf((query.get('src') or [''])[0], (query.get('id') or [''])[0])
            except LookupError as cause:
                self.send_json(404, {'error': str(cause)})
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
            etag = f'"{match[1]}-{SHARE_VIEW_REV}"'
            if self.headers.get('If-None-Match') == etag:
                self.send_response(304)
                self.send_header('Cache-Control', 'public, no-cache, must-revalidate')
                self.send_header('ETag', etag)
                self.end_headers()
                return
            # Shared books are self-contained snapshots. Apply the current reader theme
            # when serving older links without changing their sealed pages or download.
            # Only the hosted reader may call the authenticated translation API.
            # The downloadable sealed HTML keeps its offline CSP unchanged.
            online = data.replace(b"font-src data:", b"font-src data:; connect-src 'self'", 1)
            online = online.replace(b"connect-src 'none'", b"connect-src 'self'", 1)
            themed = online.replace(b'</head>', b'<style id="mf-share-theme">' + SHARE_THEME + b'</style></head>', 1)
            head, sep, tail = themed.rpartition(b'</body>')
            toolbar = b'<script id="mf-share-toolbar">' + SHARE_TOOLBAR + b'</script>'
            page = (head + SHARE_BAR.encode() + toolbar + sep + tail) if sep else (themed + SHARE_BAR.encode() + toolbar)
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            # The book data is stable, but the server may refresh its reader styling.
            self.send_header('Cache-Control', 'public, no-cache, must-revalidate')
            self.send_header('ETag', etag)
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
        if relative == 'favicon.ico':                     # browsers ask for it at the root
            relative = 'assets/img/favicon.ico'; self.path = '/assets/img/favicon.ico'
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
        # The whole-book translator is offline (no AI): every signed-in member, Free too (owner, 2026-10-19).
        feature = ('office' if self.path in OFFICE_ROUTES or self.path == '/api/fetch-source' else 'translate' if self.path == '/api/translate-free'
                   else 'podcast' if self.path in ('/api/podcast/script', '/api/podcast/audio', '/api/video-overview')
                   else 'ai' if self.path in ('/api/translate', '/api/summary', '/api/highlight-summary', '/api/ask', '/api/write', '/api/research')
                   else match[1] if match else None)
        denied = feature and self.entitlement_error(feature)
        if denied:
            self.send_json(denied[0], {'error': denied[1]})
            return
        if not secrets.compare_digest(self.headers.get('X-Build-Token', ''), TOKEN):
            self.send_json(403, {'error': 'Sesi build tidak valid. Refresh halaman.'})
            return
        if feature in ('office', 'ai', 'podcast') and self.path != '/api/translate-free':      # book translation counts its text
            try:
                if self.path in SUMMARY_ROUTES:
                    self.summary_allowance()                                # the month's summary words first
                self.quota('ai' if feature == 'podcast' else feature)      # the podcast spends the AI allowance too
            except accounts.AccountError as cause:
                self.send_json(cause.status, {'error': str(cause), **({'upgrade': '/harga'} if cause.upgrade else {})})
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
        if self.path == '/api/podcast/audio':
            self.podcast_audio_route()
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
        if self.path == '/api/ask':
            self.ask_route()
            return
        if self.path == '/api/write':
            self.write_route()
            return
        if self.path == '/api/research':
            self.research_route()
            return
        if self.path == '/api/video-overview':
            self.video_overview_route()
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
