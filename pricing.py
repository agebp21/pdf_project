"""Shared, admin-managed IDR prices and promotions for both server processes."""
from datetime import date
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time

ROOT = Path(__file__).resolve().parent
LOCK = threading.RLock()
KEYS = ('medium_monthly', 'medium_yearly', 'pro_monthly', 'pro_yearly', 'ai100_credit', 'ai300_credit')
PLANS = ('medium', 'pro', 'ai100', 'ai300')
CYCLES = ('monthly', 'yearly', 'credit')
CODE = re.compile(r'^[A-Z0-9][A-Z0-9_-]{2,23}$')
WIB = 7 * 3600


def file_path():
    return Path(os.environ.get('MYFLIPBOOK_PRICING_FILE') or ROOT / '.data' / 'pricing.json')


def config():
    path = file_path()
    if not path.is_file():
        return {'prices': {}, 'promos': []}
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or not isinstance(data.get('prices'), dict) or not isinstance(data.get('promos'), list):
        raise ValueError('Konfigurasi harga rusak.')
    return data


def _write(data):
    path = file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name('.pricing-' + secrets.token_hex(8) + '.tmp')
    try:
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        os.chmod(temp, 0o600)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def _today(now=None):
    return time.strftime('%Y-%m-%d', time.gmtime((time.time() if now is None else now) + WIB))


def _active(promo, now=None):
    today = _today(now)
    return (promo.get('enabled', True) and
            (not promo.get('starts') or promo['starts'] <= today) and
            (not promo.get('ends') or today <= promo['ends']))


def quote(plan, cycle, fallback, code='', now=None):
    """One discount only; a supplied code takes precedence over automatic promos."""
    data = config()
    base = data['prices'].get(f'{plan}_{cycle}', fallback)
    if not isinstance(base, int) or isinstance(base, bool) or base <= 0:
        raise ValueError('Harga paket tidak valid.')
    code = str(code or '').strip().upper()
    active = [p for p in data['promos'] if isinstance(p, dict) and _active(p, now)]
    if code and not any(p.get('code') == code for p in active):
        raise ValueError('Kode promo tidak berlaku atau sudah kedaluwarsa.')
    candidates = [p for p in active if p.get('code', '') == code and
                  (p.get('plan') in ('all', plan)) and (p.get('cycle') in ('all', cycle))]
    promo = max(candidates, key=lambda p: p['percent'], default=None)
    amount = round(base * (100 - promo['percent']) / 100) if promo else base
    if amount < 10_000:
        raise ValueError('Harga setelah promo harus minimal Rp10.000.')
    return {'amount': amount, 'original': base, 'promo': promo['name'] if promo else '',
            'percent': promo['percent'] if promo else 0}


def _eligible(promo, key):
    plan, cycle = key.rsplit('_', 1)
    return promo['plan'] in ('all', plan) and promo['cycle'] in ('all', cycle)


def _check_minimum(prices, promos):
    for promo in promos:
        for key, amount in prices.items():
            if _eligible(promo, key) and round(amount * (100 - promo['percent']) / 100) < 10_000:
                raise ValueError('Diskon ' + promo['name'] + ' membuat harga di bawah Rp10.000.')


def save_prices(values, defaults):
    if not isinstance(values, dict) or set(values) != set(KEYS):
        raise ValueError('Daftar harga tidak lengkap.')
    cleaned = {}
    for key in KEYS:
        value = values[key]
        if not isinstance(value, int) or isinstance(value, bool) or not 10_000 <= value <= 100_000_000:
            raise ValueError('Harga ' + key + ' harus Rp10.000–Rp100.000.000.')
        if value != defaults[key]:
            cleaned[key] = value
    for plan in ('medium', 'pro'):
        if values[plan + '_yearly'] > values[plan + '_monthly'] * 12:
            raise ValueError('Harga tahunan tidak boleh lebih besar dari 12 bulan.')
    with LOCK:
        data = config()
        _check_minimum(values, data['promos'])
        data['prices'] = cleaned
        _write(data)
    return cleaned


def add_promo(values, defaults):
    if not isinstance(values, dict):
        raise ValueError('Promo tidak valid.')
    name = str(values.get('name') or '').strip()
    code = str(values.get('code') or '').strip().upper()
    plan, cycle = values.get('plan'), values.get('cycle')
    percent = values.get('percent')
    starts, ends = str(values.get('starts') or ''), str(values.get('ends') or '')
    if not 1 <= len(name) <= 60 or any(ord(c) < 32 for c in name):
        raise ValueError('Nama promo harus 1–60 karakter.')
    if code and not CODE.fullmatch(code):
        raise ValueError('Kode promo harus 3–24 huruf, angka, _ atau -.')
    if plan not in ('all',) + PLANS or cycle not in ('all',) + CYCLES:
        raise ValueError('Paket atau periode promo tidak valid.')
    if (plan in ('ai100', 'ai300') and cycle not in ('all', 'credit')) or (plan in ('medium', 'pro') and cycle == 'credit'):
        raise ValueError('Periode tidak sesuai paket.')
    if not isinstance(percent, int) or isinstance(percent, bool) or not 1 <= percent <= 80:
        raise ValueError('Diskon harus 1–80%.')
    for value in (starts, ends):
        if value:
            try:
                if date.fromisoformat(value).isoformat() != value:
                    raise ValueError()
            except ValueError as cause:
                raise ValueError('Tanggal promo harus YYYY-MM-DD.') from cause
    if starts and ends and starts > ends:
        raise ValueError('Tanggal akhir mendahului tanggal mulai.')
    promo = dict(id=secrets.token_hex(8), name=name, code=code, plan=plan, cycle=cycle,
                 percent=percent, starts=starts, ends=ends, enabled=True)
    with LOCK:
        data = config()
        if code and any(p.get('code') == code for p in data['promos']):
            raise ValueError('Kode promo sudah dipakai.')
        _check_minimum({key: data['prices'].get(key, defaults[key]) for key in KEYS}, [promo])
        data['promos'].append(promo)
        _write(data)
    return promo


def remove_promo(promo_id):
    with LOCK:
        data = config()
        remaining = [p for p in data['promos'] if p.get('id') != promo_id]
        if len(remaining) == len(data['promos']):
            raise ValueError('Promo tidak ditemukan.')
        data['promos'] = remaining
        _write(data)
