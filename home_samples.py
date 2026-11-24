"""Admin-managed PDF examples for the public homepage; files stay in .data."""
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import threading
import time

ROOT = Path(__file__).resolve().parent
SLOTS = {'interior': 'Katalog 1', 'travel': 'Buku', 'magazine': 'Katalog 2', 'journal': 'Jurnal'}
ID = re.compile(r'^[0-9a-f]{24}$')
LOCK = threading.RLock()


def storage():
    return Path(os.environ.get('HOME_SAMPLES_DIR') or ROOT / '.data' / 'home-samples')


def records():
    file = storage() / 'samples.json'
    if not file.is_file():
        return []
    value = json.loads(file.read_text(encoding='utf-8'))
    if not isinstance(value, list):
        raise ValueError('Daftar sampel rusak.')
    return [item for item in value if isinstance(item, dict) and ID.fullmatch(str(item.get('id', '')))]


def public_samples():
    return [dict(id=item['id'], slot=item['slot'], title=item['title'], pages=item['pages'],
                 cover=f"/api/home-samples/{item['id']}/page-1.webp",
                 pageBase=f"/api/home-samples/{item['id']}/page-") for item in records()]


def admin_samples():
    current = records()
    by_slot = {item['slot']: item for item in current}
    return [dict(slot=slot, defaultTitle=label, sample=by_slot.get(slot)) for slot, label in SLOTS.items()] + [
        dict(slot=item['slot'], defaultTitle=None, sample=item) for item in current if item['slot'] not in SLOTS]


def render_page(pdf, target, index):
    try:
        import pymupdf
        from PIL import Image
    except ImportError as cause:
        raise RuntimeError('Renderer PDF belum tersedia di server.') from cause
    with pymupdf.open(str(pdf)) as document:
        if document.needs_pass or not 0 <= index < len(document):
            raise ValueError('PDF terkunci atau halaman tidak tersedia.')
        page = document[index]
        scale = min(1100 / page.rect.width, 1800 / page.rect.height)
        pixels = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
        image = Image.frombytes('RGB', (pixels.width, pixels.height), pixels.samples)
        temp = target.with_name(target.name + '.' + secrets.token_hex(4) + '.tmp')
        try:
            image.save(temp, format='WEBP', quality=82)
            os.replace(temp, target)
        finally:
            temp.unlink(missing_ok=True)


def page_file(sample_id, number):
    if not ID.fullmatch(sample_id):
        return None
    item = next((record for record in records() if record['id'] == sample_id), None)
    if not item or not 1 <= number <= item['pages']:
        return None
    folder = storage() / sample_id
    target = folder / f'page-{number}.webp'
    if not target.is_file():
        with LOCK:
            if not target.is_file():
                render_page(folder / 'source.pdf', target, number - 1)
    return target


def save_records(items):
    folder = storage()
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / 'samples.json'
    temp = folder / ('samples-' + secrets.token_hex(4) + '.tmp')
    try:
        temp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding='utf-8')
        os.replace(temp, target)
    finally:
        temp.unlink(missing_ok=True)


def upload(source, size, title, slot='new'):
    title = str(title).strip()
    if not title or len(title) > 80 or any(ord(char) < 32 for char in title):
        raise ValueError('Judul sampel harus 1–80 karakter.')
    if slot != 'new' and slot not in SLOTS and not (slot.startswith('custom-') and ID.fullmatch(slot[7:]) and any(row['slot'] == slot for row in records())):
        raise ValueError('Slot sampel tidak dikenal.')
    if size <= 0:
        raise ValueError('PDF sampel kosong.')
    folder = storage()
    folder.mkdir(parents=True, exist_ok=True)
    sample_id = secrets.token_hex(12)
    temp = folder / ('.upload-' + sample_id)
    temp.mkdir()
    try:
        pdf = temp / 'source.pdf'
        with pdf.open('wb') as output:
            remaining = size
            while remaining:
                chunk = source.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise ValueError('PDF belum selesai diunggah.')
                output.write(chunk)
                remaining -= len(chunk)
        with pdf.open('rb') as check:
            signature = check.read(5)
        if signature != b'%PDF-':
            raise ValueError('Berkas harus PDF yang valid.')
        try:
            import pymupdf
            # Parse from bytes: PyMuPDF can leave invalid file paths locked on Windows.
            with pymupdf.open(stream=pdf.read_bytes(), filetype='pdf') as document:
                pages = len(document)
                if document.needs_pass or pages < 1:
                    raise ValueError('PDF kosong atau terkunci.')
        except ImportError as cause:
            raise RuntimeError('Renderer PDF belum tersedia di server.') from cause
        except pymupdf.FileDataError as cause:
            raise ValueError('PDF tidak bisa dibaca.') from cause
        render_page(pdf, temp / 'page-1.webp', 0)
        item = dict(id=sample_id, slot=slot if slot != 'new' else 'custom-' + sample_id,
                    title=title, pages=pages, updatedAt=int(time.time()))
        with LOCK:
            existing = records()
            previous = next((row for row in existing if row['slot'] == item['slot']), None)
            final = folder / sample_id
            temp.rename(final)
            try:
                save_records([row for row in existing if row['slot'] != item['slot']] + [item])
            except OSError:
                shutil.rmtree(final, ignore_errors=True)
                raise
            if previous:
                shutil.rmtree(folder / previous['id'], ignore_errors=True)
        return item
    finally:
        if temp.exists():
            shutil.rmtree(temp)


def remove(slot):
    with LOCK:
        existing = records()
        item = next((row for row in existing if row['slot'] == slot), None)
        if not item:
            raise ValueError('Sampel tidak ditemukan.')
        save_records([row for row in existing if row['slot'] != slot])
        shutil.rmtree(storage() / item['id'], ignore_errors=True)
        return item
