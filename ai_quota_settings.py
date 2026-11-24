"""Admin-managed AI allowances shared by the public and admin services."""
import json
import os
from pathlib import Path
import secrets
import threading

ROOT = Path(__file__).resolve().parent
KEYS = ('medium_month', 'medium_window', 'pro_month', 'pro_window')
LOCK = threading.RLock()


def file_path():
    return Path(os.environ.get('MYFLIPBOOK_AI_QUOTAS_FILE') or ROOT / '.data' / 'ai-quotas.json')


def overrides():
    path = file_path()
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or set(data) - set(KEYS) or any(
            not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 100_000
            for value in data.values()):
        raise ValueError('Konfigurasi kuota AI rusak.')
    return data


def limit(plan, period):
    return overrides().get(f'{plan}_{period}')


def save(values):
    if not isinstance(values, dict) or set(values) != set(KEYS):
        raise ValueError('Daftar kuota AI tidak lengkap.')
    if any(not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 100_000
           for value in values.values()):
        raise ValueError('Kuota AI harus 0–100.000 pertanyaan (0 = tanpa batas).')
    with LOCK:
        path = file_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name('.ai-quotas-' + secrets.token_hex(8) + '.tmp')
        try:
            temp.write_text(json.dumps(values, indent=2), encoding='utf-8')
            os.chmod(temp, 0o600)
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)
    return values
