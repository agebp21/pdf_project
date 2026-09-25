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
import uuid
import zipfile
from http.cookies import CookieError, SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

import accounts

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / '.build'
TOKEN = secrets.token_urlsafe(32)
JOBS = {}
BUILD_LOCK = threading.Lock()
POSITIONS = {'top-left', 'top-right', 'bottom-left', 'bottom-right'}
SESSION_COOKIE = 'mf_session'
PAGES = {'index.html', 'converter.html', 'flipbook.html', 'animation.html', 'notebook.html',
         'login.html', 'account.html'}
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


def hosted():
    return bool(CONFIG['public_hosts'])


def get_accounts():
    """Create the account store on first use (tests may preset ACCOUNTS)."""
    global ACCOUNTS
    with ACCOUNTS_LOCK:
        if ACCOUNTS is None:
            key = os.environ.get('MIDTRANS_SERVER_KEY', '').strip()
            tripay = [os.environ.get(n, '').strip() for n in ('TRIPAY_API_KEY', 'TRIPAY_PRIVATE_KEY', 'TRIPAY_MERCHANT_CODE')]
            if all(tripay):
                provider = accounts.TripayProvider(*tripay, production=os.environ.get('TRIPAY_PRODUCTION') == '1')
            elif key:
                provider = accounts.MidtransProvider(key, os.environ.get('MIDTRANS_PRODUCTION') == '1')
            elif hosted() and os.environ.get('MYFLIPBOOK_MOCK_PAYMENTS') != '1':
                provider = accounts.DisabledProvider()  # public site without a gateway: no fake payments
            else:
                provider = accounts.MockProvider()
            db = os.environ.get('MYFLIPBOOK_DB') or str(ROOT / '.data' / 'myflipbook.sqlite3')
            ACCOUNTS = accounts.Accounts(db, provider)
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
    return dict(version=1, title=data['title'][:200], pageCount=count, ratio=ratio, overlays=overlays)


def unpack_book(archive, destination):
    """Only read canonical image names; regenerate all executable content."""
    with zipfile.ZipFile(archive) as package:
        names = package.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Entry ZIP duplikat.')
        if package.getinfo('book.json').file_size > 1024 * 1024:
            raise ValueError('Metadata buku terlalu besar.')
        data = validate_manifest(json.loads(package.read('book.json')))
        if data['pageCount'] > len(names):
            raise ValueError('Gambar halaman tidak lengkap.')
        destination.mkdir(parents=True, exist_ok=True)
        (destination / 'pages').mkdir(exist_ok=True)
        for index in range(1, data['pageCount'] + 1):
            name = f'pages/{index}.jpg'
            with package.open(name) as source, (destination / name).open('wb') as target:
                signature = source.read(3)
                if signature != b'\xff\xd8\xff':
                    raise ValueError(f'Gambar halaman {index} bukan JPEG.')
                target.write(signature)
                shutil.copyfileobj(source, target)
    for name in ('index.html', 'viewer.css', 'book-effects.css', 'layout.js', 'viewer.js'):
        shutil.copy2(ROOT / 'assets/export' / name, destination / name)
    for name in ('page-flip.browser.js', 'PAGEFLIP-LICENSE.txt'):
        shutil.copy2(ROOT / 'assets/vendor' / name, destination / name)
    encoded = json.dumps(data, ensure_ascii=True).replace('<', '\\u003c')
    (destination / 'book-data.js').write_text('window.FLIPBOOK_DATA = ' + encoded + ';\n', encoding='utf-8')
    (destination / 'book.json').write_text(json.dumps(data), encoding='utf-8')
    return data


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


def run_command(args, cwd, log):
    env = dict(os.environ, CI='true')
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
        job.update(status='running', message='Menyiapkan aplikasi buku…')
        workspace = BUILD / 'native-workspace'
        shutil.copytree(ROOT / 'native/reader', workspace, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('build', '.dart_tool', '.gradle', '.idea', 'ephemeral', '.plugin_symlinks', 'local.properties', 'assets'))
        book_dir = (workspace / 'assets/book').resolve()
        if not book_dir.is_relative_to(BUILD.resolve()) or book_dir.name != 'book':
            raise RuntimeError('Lokasi aset build tidak valid.')
        if book_dir.exists():
            shutil.rmtree(book_dir)
        data = unpack_book(folder / 'input.zip', book_dir)
        app_id = 'id.sarvamaya.book.b' + hashlib.sha256(data['title'].encode()).hexdigest()[:16]
        gradle = workspace / 'android/app/build.gradle.kts'
        gradle.write_text(re.sub(r'applicationId = "[^"]+"', f'applicationId = "{app_id}"', gradle.read_text(encoding='utf-8')), encoding='utf-8')
        flutter = shutil.which('flutter')
        if not flutter:
            raise RuntimeError('Flutter belum terpasang.')
        job['message'] = 'Menyiapkan dependensi Flutter…'
        plugin_junctions(workspace)
        code = run_command([flutter, 'pub', 'get'], workspace, log)
        if code and 'symlink support' in log.read_text(errors='replace'):
            plugin_junctions(workspace)
            code = run_command([flutter, 'pub', 'get'], workspace, log)
        if code:
            raise RuntimeError('Dependensi Flutter gagal disiapkan. Unduh log build untuk rinciannya.')
        job['message'] = 'Membangun APK Android…' if target == 'apk' else 'Membangun aplikasi Windows…'
        if run_command([flutter, 'build', 'apk' if target == 'apk' else 'windows', '--release'], workspace, log):
            raise RuntimeError('Build gagal. Unduh log build untuk rinciannya.')
        if target == 'apk':
            output = folder / 'flipbook.apk'
            shutil.copy2(workspace / 'build/app/outputs/flutter-apk/app-release.apk', output)
        else:
            release = workspace / 'build/windows/x64/runner/Release'
            if not (release / 'sarvamaya_book.exe').is_file():
                raise RuntimeError('EXE hasil build tidak ditemukan.')
            output = folder / 'flipbook-windows.zip'
            with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as package:
                for file in release.rglob('*'):
                    if file.is_file():
                        package.write(file, file.relative_to(release).as_posix())
                package.writestr('BUKA-APLIKASI.txt', 'Ekstrak seluruh ZIP, lalu jalankan sarvamaya_book.exe. Folder data dan DLL harus tetap bersama EXE. Memerlukan Microsoft Edge WebView2 Runtime. Buku tersedia offline.\n')
        job.update(status='done', message='Build selesai.', artifact=output.name, download=f'/api/jobs/{job_id}/download')
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
            self.send_json(200, {'plans': store.plans(), 'provider': store.provider.name,
                                 'paymentsEnabled': store.provider.name != 'none'})
        elif path == '/api/billing/orders':
            user = self.current_user()
            if not user:
                raise accounts.AccountError(401, 'Silakan masuk dulu.')
            self.send_json(200, {'orders': store.orders(user['id'])})
        else:
            self.send_json(404, {'error': 'Tidak ditemukan.'})

    def account_post(self, path):
        store = get_accounts()
        raw = self.read_body()
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
                                               data.get('method')))
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
            # Hosting: the build/convert token is only handed to signed-in users.
            user = self.current_user() if hosted() or CONFIG['paywall'] else None
            token = TOKEN if not hosted() or user else None
            self.send_json(200, dict(apk=flutter, exe=flutter and os.name == 'nt', office=office, token=token,
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
                self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
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
        if relative in EXPORT_TEMPLATES:
            denied = self.entitlement_error('export')
            if denied:
                self.send_json(denied[0], {'error': denied[1]})
                return
        super().do_GET()

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
        feature = 'office' if self.path in OFFICE_ROUTES else match[1] if match else None
        denied = feature and self.entitlement_error(feature)
        if denied:
            self.send_json(denied[0], {'error': denied[1]})
            return
        if not secrets.compare_digest(self.headers.get('X-Build-Token', ''), TOKEN):
            self.send_json(403, {'error': 'Sesi build tidak valid. Refresh halaman.'})
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
            JOBS[job_id] = dict(id=job_id, status='queued', message='Build menunggu…')
            threading.Thread(target=build_job, args=(job_id, match[1]), daemon=True).start()
            started = True
            self.send_json(202, {'id': job_id})
        except Exception as cause:
            if not started:
                BUILD_LOCK.release()
            self.send_json(400, {'error': str(cause)})


if __name__ == '__main__':
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
              f' | pembayaran: {store.provider.name if store.provider.name != "none" else "NONAKTIF (isi TRIPAY_* atau MIDTRANS_SERVER_KEY)"}',
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
