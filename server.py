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
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, HTTPServer, SimpleHTTPRequestHandler, ThreadingHTTPServer
import urllib.error
import urllib.request
from urllib.parse import parse_qs, quote, unquote, urlsplit

import accounts
import book_seal
import invoice

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / '.build'
DATA = ROOT / '.data'
ANDROID_SIGNING = DATA / 'android-signing.json'
TOKEN = secrets.token_urlsafe(32)
JOBS = {}
BUILD_LOCK = threading.Lock()
POSITIONS = {'top-left', 'top-right', 'bottom-left', 'bottom-right'}
SESSION_COOKIE = 'mf_session'
PAGES = {'index.html', 'converter.html', 'workflow.html', 'flipbook.html', 'animation.html', 'notebook.html',
         'login.html', 'account.html', 'coming-soon.html'}
# Unreleased features: on a normal run (paywall on) these pages show the
# coming-soon page; --no-paywall keeps them usable internally.
SOON_PAGES = {'notebook.html': 'Notebook PDF', 'animation.html': 'Flipbook Animation'}
# public_hosts: domains served in hosting mode (login + entitlements enforced).
# secure: Secure cookies (HTTPS). base_url: absolute URL for payment callbacks.
# paywall: exports/builds need a paid plan. Off when imported (tests),
# on when server.py runs unless --no-paywall.
CONFIG = dict(public_hosts=set(), secure=False, base_url='', paywall=False)
# Export-only templates: without them no offline package can be built, so
# the paywall holds even if someone edits the page's JavaScript.
EXPORT_TEMPLATES = {'assets/export/index.html', 'assets/export/viewer.js', 'assets/export/viewer.css'}
ACCOUNTS = None
ACCOUNTS_LOCK = threading.Lock()


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


def get_accounts():
    """Create the account store on first use (tests may preset ACCOUNTS)."""
    global ACCOUNTS
    with ACCOUNTS_LOCK:
        if ACCOUNTS is None:
            key = os.environ.get('MIDTRANS_SERVER_KEY', '').strip()
            tripay = [os.environ.get(n, '').strip() for n in ('TRIPAY_API_KEY', 'TRIPAY_PRIVATE_KEY', 'TRIPAY_MERCHANT_CODE')]
            prefer = os.environ.get('MYFLIPBOOK_IDR_PROVIDER', '').strip().lower()
            midtrans = lambda: accounts.MidtransProvider(key, os.environ.get('MIDTRANS_PRODUCTION') == '1')
            tripay_provider = lambda: accounts.TripayProvider(*tripay, production=os.environ.get('TRIPAY_PRODUCTION') == '1')
            if all(tripay) and (prefer == 'tripay' or not key):
                provider = tripay_provider()
            elif key:
                provider = midtrans()   # Midtrans is the rupiah gateway by default
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
                links=validate_links(data.get('links', {}), count), words=validate_words(data.get('words', {}), count))


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
        if data['pageCount'] > len(names):
            raise ValueError('Gambar halaman tidak lengkap.')
        pages = []
        for index in range(1, data['pageCount'] + 1):
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
        job.update(status='done', message='Build selesai.', progress=1, artifact=output.name,
                   download_name=label + ('.apk' if target == 'apk' else ' - Windows.zip'),
                   download=f'/api/jobs/{job_id}/download')
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

    def send_json(self, status, body, cookie=None):
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
        try:
            morsel = SimpleCookie(self.headers.get('Cookie', '')).get(SESSION_COOKIE)
        except CookieError:
            return None
        return morsel.value if morsel else None

    def current_user(self):
        return get_accounts().user_for(self.session_token())

    def session_cookie(self, token):
        max_age = accounts.SESSION_SECONDS if token else 0
        secure = '; Secure' if CONFIG['secure'] else ''
        return f'{SESSION_COOKIE}={token or ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}'

    def client_ip(self):
        forwarded = self.headers.get('X-Forwarded-For', '') if hosted() else ''
        return forwarded.split(',')[0].strip() or self.client_address[0]

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

    def account_get(self, path):
        store = get_accounts()
        if path == '/api/auth/me':
            self.send_json(200, {'user': self.current_user(), 'loginRequired': hosted()})
        elif path == '/api/billing/methods':
            self.send_json(200, {'methods': store.payment_methods()})
        elif path == '/api/billing/plans':
            providers = {c: store.provider_for(c).name for c in accounts.CURRENCIES}
            self.send_json(200, {'plans': store.plans(), 'provider': store.provider.name, 'providers': providers,
                                 'paymentsEnabled': {c: name != 'none' for c, name in providers.items()}})
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
            token = store.register(data.get('email'), data.get('password'), data.get('name'))
            self.send_json(201, {'user': store.user_for(token)}, cookie=self.session_cookie(token))
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
            self.send_json(200, store.checkout(user, data.get('plan'), data.get('cycle'), self.base_url(),
                                               data.get('method'), str(data.get('currency') or 'IDR')))
        elif path == '/api/billing/mock/pay':
            store.mock_pay(user, str(data.get('orderId', '')))
            self.send_json(200, {'user': self.current_user()})
        else:
            self.send_json(404, {'error': 'Tidak ditemukan.'})

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
        if feature not in user['entitlements']:
            plan = 'Business' if feature == 'exe' else 'Pro atau Business'
            return 402, f'Fitur ini butuh paket {plan}. Upgrade di halaman Harga/Akun.'
        return None

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        if unquote(urlsplit(self.path).path).lstrip('/') in EXPORT_TEMPLATES:
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if not self.trusted():
            self.send_json(403, {'error': 'Akses hanya dari localhost proyek.'})
            return
        path = unquote(urlsplit(self.path).path)
        if path.startswith(('/api/auth/', '/api/billing/')):
            try:
                self.account_get(path)
            except accounts.AccountError as cause:
                self.send_json(cause.status, {'error': str(cause)})
            return
        if path == '/api/capabilities':
            flutter = bool(shutil.which('flutter'))
            office = bool(find_soffice())
            html = bool(find_chromium())
            # Hosting: the build/convert token is only handed to signed-in users.
            user = self.current_user() if hosted() or CONFIG['paywall'] else None
            token = TOKEN if not hosted() or user else None
            self.send_json(200, dict(apk=flutter, exe=flutter and os.name == 'nt', office=office, html=html, token=token,
                                     loginRequired=hosted(), paywall=CONFIG['paywall'],
                                     entitlements=user['entitlements'] if user else None))
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
        if self.path.startswith(('/api/auth/', '/api/billing/')):
            try:
                self.account_post(self.path)
            except accounts.AccountError as cause:
                self.send_json(cause.status, {'error': str(cause), 'success': False})
            return
        match = re.fullmatch(r'/api/build/(apk|exe)', self.path)
        feature = 'office' if self.path in OFFICE_ROUTES or self.path == '/api/fetch-source' else match[1] if match else None
        denied = feature and self.entitlement_error(feature)
        if denied:
            self.send_json(denied[0], {'error': denied[1]})
            return
        if not secrets.compare_digest(self.headers.get('X-Build-Token', ''), TOKEN):
            self.send_json(403, {'error': 'Sesi build tidak valid. Refresh halaman.'})
            return
        if self.path == '/api/convert/html-to-pdf':
            self.convert_html()
            return
        if self.path == '/api/fetch-source':
            self.fetch_source_route()
            return
        if self.path in OFFICE_ROUTES:
            self.convert_office()
            return
        if not match or self.headers.get_content_type() != 'application/zip':
            self.send_json(400, {'error': 'Permintaan build tidak valid.'})
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
    parser.add_argument('--insecure-cookies', action='store_true',
                        help='Mode hosting tanpa HTTPS (hanya untuk uji coba).')
    args = parser.parse_args()
    CONFIG['public_hosts'] = {h.strip().lower() for h in args.public_host if h.strip()}
    CONFIG['secure'] = hosted() and not args.insecure_cookies
    CONFIG['paywall'] = not args.no_paywall
    CONFIG['base_url'] = os.environ.get('MYFLIPBOOK_BASE_URL', '')
    store = get_accounts()
    if hosted():
        print('Mode hosting: ' + ', '.join(sorted(CONFIG['public_hosts'])) +
              f' | Rupiah: {store.provider.name if store.provider.name != "none" else "NONAKTIF (isi MIDTRANS_SERVER_KEY di .env)"}'
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
