"""Loopback-only PDF Tools server and serialized native build service."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import threading
import uuid
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / '.build'
TOKEN = secrets.token_urlsafe(32)
JOBS = {}
BUILD_LOCK = threading.Lock()
POSITIONS = {'top-left', 'top-right', 'bottom-left', 'bottom-right'}


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


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def trusted(self):
        hosts = {f'localhost:{self.server.server_port}', f'127.0.0.1:{self.server.server_port}'}
        host, origin = self.headers.get('Host', ''), self.headers.get('Origin')
        return host in hosts and (not origin or origin == 'http://' + host)

    def send_json(self, status, body):
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def do_GET(self):
        if not self.trusted():
            self.send_json(403, {'error': 'Akses hanya dari localhost proyek.'})
            return
        path = unquote(urlsplit(self.path).path)
        if path == '/api/capabilities':
            flutter = bool(shutil.which('flutter'))
            self.send_json(200, dict(apk=flutter, exe=flutter and os.name == 'nt', token=TOKEN))
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
        allowed = relative in {'index.html', 'converter.html', 'flipbook.html', 'animation.html', 'notebook.html'} or (relative.startswith('assets/') and file.is_relative_to(ROOT / 'assets'))
        if not allowed or not file.is_relative_to(ROOT) or not file.is_file():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        self.send_error(405)

    def do_POST(self):
        if not self.trusted() or not secrets.compare_digest(self.headers.get('X-Build-Token', ''), TOKEN):
            self.send_json(403, {'error': 'Sesi build tidak valid. Refresh halaman.'})
            return
        match = re.fullmatch(r'/api/build/(apk|exe)', self.path)
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
    args = parser.parse_args()
    httpd = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'PDF Tools: http://127.0.0.1:{args.port}/', flush=True)
    httpd.serve_forever()
