"""Verify completed real native builds and download endpoints (server must run)."""
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / '.build/qa'
source = zipfile.ZipFile(QA / 'qa-final-HTML.zip')
for target, prefix in [('apk', 'assets/flutter_assets/assets/book/'),
                       ('exe', 'data/flutter_assets/assets/book/')]:
    job_id = json.loads((QA / f'{target}-job.json').read_text(encoding='utf-8-sig'))['id']
    with urllib.request.urlopen(f'http://127.0.0.1:8080/api/jobs/{job_id}') as response:
        job = json.load(response)
    assert job['status'] == 'done', job
    with urllib.request.urlopen('http://127.0.0.1:8080' + job['download']) as response:
        downloaded = response.read()
    artifact = ROOT / '.build' / job_id / job['artifact']
    assert downloaded == artifact.read_bytes(), 'Download differs from build artifact'
    package = zipfile.ZipFile(io.BytesIO(downloaded))
    assert package.testzip() is None
    assert json.loads(package.read(prefix + 'book.json')) == json.loads(source.read('book.json'))
    for name in ['index.html', 'viewer.js', 'viewer.css', 'layout.js', 'book-effects.css',
                 'page-flip.browser.js'] + [f'pages/{i}.jpg' for i in range(1, 9)]:
        assert package.read(prefix + name) == source.read(name), name
    if target == 'apk':
        assert 'AndroidManifest.xml' in package.namelist()
    else:
        assert package.read('sarvamaya_book.exe')[:2] == b'MZ'
        assert any(name.endswith('.dll') for name in package.namelist())
    print(f'PASS {target}: complete package, current viewer/assets, 8 pages, HTTP download, SHA256 {hashlib.sha256(downloaded).hexdigest()}')
