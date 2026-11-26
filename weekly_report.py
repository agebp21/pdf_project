"""Laporan mingguan otomatis untuk admin (default Senin dan Sabtu, 08.00 WIB) — Python stdlib only.

Satu PDF (digambar dengan canvas admin_report/invoice) dikirim lewat email (SMTP dari .env,
variabel yang sama dengan server.py: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM,
MAIL_FROM_NAME) ke daftar penerima di .data/weekly-report.json. Isinya:

  1. Ringkasan dan temuan utama          4. Progress pengembangan produk (DEPLOY.md + catatan admin)
  2. Pengunjung dan traffic              5. Follow-up member gratis agar upgrade
  3. Analisis pasar (data internal)

Angka diambil dari fungsi yang sama dengan panel admin (admin_server.overview / visitor_stats),
tanpa akun tim. Modul ini tidak meng-import admin_server (yang berjalan sebagai __main__);
admin_server memberi `ctx`: root, data_dir, db_path(), read_only(path), has_table(db, name),
team_ids(), overview(now), visitor_stats(days, start, end), log(text).

Analisis pasar eksternal (pesaing, tren industri) tidak bisa otomatis; admin mengisinya di
kolom catatan pada tab "Laporan Mingguan" dan catatan itu ikut dicetak.
Semua teks untuk pembaca memakai Bahasa Indonesia baku (aturan AGENTS.md).
"""
import json
import os
import re
import smtplib
import ssl
import threading
import time
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path

import admin_report
from admin_report import fmt_int, day_label
from invoice import ACCENT, INK, LINE, MUTED, PAGE_W, money

M = admin_report.M
LOGO = Path(__file__).resolve().parent / 'assets' / 'img' / 'logo.png'     # logo di header PDF; tanpa file ini header polos
LOGO_CID = 'mfbp-logo'      # logo yang sama dilampirkan inline di email (cid:), tanpa gambar dari internet
WEEKDAYS = ('Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu')
DEFAULT_RECIPIENTS = ('sarvamayahybrid@gmail.com', 'wiyanjenarmahesa@gmail.com')
TESTER = 'duitku-tester@myflipbookpro.com'          # akun uji pembayaran: bukan member sungguhan
EMAIL = re.compile(r'[^@\s,;<>"\']{1,64}@[^@\s,;<>"\']{1,200}\.[^@\s,;<>"\']{2,}')
LOCK = threading.RLock()
MAX_RUNS = 20
RETRY_SECONDS, MAX_ATTEMPTS = 1800, 3

SEGMENTS = {
    'checkout': 'Pemesanan tertunda',
    'mantan': 'Mantan pelanggan',
    'aktif': 'Pengguna aktif',
    'mencoba': 'Baru mencoba',
    'baru': 'Baru daftar',
    'dorman': 'Tidak aktif',
}
TEMPLATES = {
    'checkout': ('Halo {nama}, kami melihat Anda sempat memulai pemesanan paket MyFlipbook tetapi belum menyelesaikannya. '
                 'Bila ada kendala pembayaran atau pertanyaan tentang paket, balas email ini dan kami bantu. '
                 'Rincian paket ada di myflipbookpro.com/harga.'),
    'mantan': ('Halo {nama}, terima kasih sudah pernah berlangganan MyFlipbook. Bila Anda ingin kembali memakai ringkasan AI, '
               'terjemahan, ekspor HTML, dan My Library, paket dapat diaktifkan lagi kapan saja di myflipbookpro.com/harga. '
               'Kami juga senang menerima masukan Anda.'),
    'aktif': ('Halo {nama}, kami melihat Anda rutin memakai MyFlipbook. Paket Medium menambahkan ringkasan dan terjemahan AI, '
              'ekspor HTML, serta My Library; paket Pro menambahkan aplikasi APK dan EXE serta ruang My Library lebih besar. '
              'Pilihan lengkap ada di myflipbookpro.com/harga.'),
    'mencoba': ('Halo {nama}, terima kasih sudah mencoba MyFlipbook. Dokumen PDF Anda dapat dijadikan flipbook dan diberi animasi '
                'dalam satu aplikasi. Bila ada fitur yang ingin Anda ketahui, balas email ini; kami dengan senang hati membantu.'),
    'baru': ('Halo {nama}, selamat datang di MyFlipbook. Unggah satu PDF lalu pilih "Jadikan Flipbook" untuk melihat hasilnya. '
             'Bila Anda butuh bantuan memulai, balas email ini.'),
}
SOCIAL = ('facebook', 'instagram', 't.co', 'twitter', 'x.com', 'tiktok', 'youtube', 'whatsapp', 'wa.me', 'linkedin',
          'telegram', 't.me', 'pinterest', 'reddit', 'threads')
SEARCH = ('google', 'bing', 'duckduckgo', 'yahoo', 'yandex', 'baidu', 'ecosia', 'brave')
FEATURES = (('office', 'Konversi dokumen'), ('ai', 'Pertanyaan AI'), ('translate', 'Terjemahan buku (karakter)'))
MONTHS = dict(januari=1, februari=2, maret=3, april=4, mei=5, juni=6, juli=7, agustus=8, september=9,
              oktober=10, november=11, desember=12)
ENTRY = re.compile(r'^-\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+[\u2014\-]+\s+(.+)$')


# ---------------------------------------------------------------- pengaturan dan catatan jalan

def file_path(data_dir):
    return Path(data_dir) / 'weekly-report.json'


def _read(data_dir):
    try:
        raw = json.loads(file_path(data_dir).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    return raw if isinstance(raw, dict) else {}


def _write(data_dir, raw):
    path = file_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(raw, ensure_ascii=False, indent=1), encoding='utf-8')
    os.replace(tmp, path)


def defaults():
    return dict(enabled=True, recipients=list(DEFAULT_RECIPIENTS), days=[0, 5], hour=8,
                notes=dict(market='', product=''))


def _clean(body, base):
    """Pengaturan baru dari `body` di atas `base`; ValueError (teks Indonesia) bila tidak valid."""
    if not isinstance(body, dict):
        raise ValueError('Permintaan tidak valid.')
    out = json.loads(json.dumps(base))
    if 'enabled' in body:
        out['enabled'] = bool(body['enabled'])
    if 'recipients' in body:
        raw = body['recipients']
        if isinstance(raw, str):
            items = re.split(r'[\s,;]+', raw)
        elif isinstance(raw, (list, tuple)):
            items = list(raw)
        else:
            raise ValueError('Daftar penerima tidak valid.')
        seen = []
        for item in items:
            item = str(item).strip().lower()
            if not item:
                continue
            if not EMAIL.fullmatch(item):
                raise ValueError('Alamat email tidak valid: ' + item[:60])
            if item not in seen:
                seen.append(item)
        if not 1 <= len(seen) <= 10:
            raise ValueError('Isi 1 sampai 10 alamat email penerima.')
        out['recipients'] = seen
    if 'days' in body:
        try:
            days = sorted({int(d) for d in body['days']})
        except (TypeError, ValueError):
            raise ValueError('Hari pengiriman tidak valid.') from None
        if not days or days[0] < 0 or days[-1] > 6:
            raise ValueError('Pilih minimal satu hari pengiriman.')
        out['days'] = days
    if 'hour' in body:
        try:
            hour = int(body['hour'])
        except (TypeError, ValueError):
            raise ValueError('Jam pengiriman tidak valid.') from None
        if not 0 <= hour <= 23:
            raise ValueError('Jam pengiriman harus antara 0 dan 23.')
        out['hour'] = hour
    if 'notes' in body:
        notes = body['notes']
        if not isinstance(notes, dict):
            raise ValueError('Catatan tidak valid.')
        for key in ('market', 'product'):
            if key in notes:
                text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(notes[key] or '')).strip()
                if len(text) > 2000:
                    raise ValueError('Catatan terlalu panjang (maksimal 2.000 karakter).')
                out['notes'][key] = text
    return out


def config(data_dir):
    with LOCK:
        try:
            return _clean(_read(data_dir).get('config') or {}, defaults())
        except ValueError:
            return defaults()


def save_config(data_dir, body):
    with LOCK:
        cfg = _clean(body, config(data_dir))
        raw = _read(data_dir)
        raw['config'] = cfg
        _write(data_dir, raw)
        return cfg


def parse_recipients(raw):
    """Daftar email dari teks/daftar, divalidasi (untuk kirim tes ke alamat tertentu)."""
    return _clean({'recipients': raw}, defaults())['recipients']


def _state(data_dir):
    state = _read(data_dir).get('state')
    return state if isinstance(state, dict) else {}


def _save_state(data_dir, state):
    raw = _read(data_dir)
    raw['state'] = state
    _write(data_dir, raw)


def smtp_ready():
    return all(os.environ.get(k, '').strip() for k in ('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'))


def next_run(cfg, now=None):
    """Waktu kirim terjadwal berikutnya (detik Unix) atau None bila dimatikan."""
    now = int(now or time.time())
    if not cfg.get('enabled'):
        return None
    for add in range(9):
        t = time.localtime(now + add * 86400)
        if t.tm_wday in cfg['days']:
            slot = int(time.mktime((t.tm_year, t.tm_mon, t.tm_mday, cfg['hour'], 0, 0, 0, 0, -1)))
            if slot > now:
                return slot
    return None


def status(data_dir, now=None):
    cfg = config(data_dir)
    state = _state(data_dir)
    return dict(config=cfg, smtpReady=smtp_ready(), nextRun=next_run(cfg, now),
                runs=list(reversed(state.get('runs') or []))[:10])


# ---------------------------------------------------------------- pengumpulan data

def _midnight(ts):
    return int(time.mktime(time.strptime(time.strftime('%Y-%m-%d', time.localtime(ts)), '%Y-%m-%d')))


def _paid_active(user, now):
    return user['plan'] not in ('free', 'basic') and bool(user['plan_expires_at']) and user['plan_expires_at'] > now


def delta(cur, prev):
    cur, prev = cur or 0, prev or 0
    if not prev:
        return 'dari 0' if cur else '0%'
    return f'{round((cur - prev) * 100 / prev):+d}%'


def trend(cur, prev):
    """Untuk kalimat: 'naik 25%', 'turun 10%', 'tetap'."""
    cur, prev = cur or 0, prev or 0
    if not prev:
        return 'naik dari nol' if cur else 'tetap nol'
    change = round((cur - prev) * 100 / prev)
    return f'naik {change}%' if change > 0 else f'turun {-change}%' if change < 0 else 'tetap'


def pdf_safe(text):
    """Font PDF memakai WinAnsi (cp1252): panah dan simbol lain diganti, karakter yang tidak ada dibuang (bukan '?')."""
    text = str(text or '').replace('\u2192', '>').replace('\u2190', '<').replace('\u2265', '>=').replace('\u2264', '<=')
    return ''.join(ch for ch in text if ch.encode('cp1252', errors='ignore'))


def pct(part, whole):
    return f'{(part or 0) * 100 / whole:.1f}'.replace('.', ',') + '%' if whole else '0%'


def _window(ctx, db, team, start, end):
    """Anggota baru, corong konversi, pendapatan, dan pemakaian fitur dalam [start, end]."""
    out = dict(signups=0, verified=0, activated=0, paidMembers=0, orders=0, revenue={}, pending=0, usage={})
    ids, verified = [], 0
    for r in db.execute('SELECT id, email, verified FROM users WHERE created_at >= ? AND created_at <= ?', (start, end)):
        if r['id'] in team or str(r['email']).lower() == TESTER:
            continue
        ids.append(r['id'])
        verified += 1 if r['verified'] else 0
    used = set()
    if ctx.has_table(db, 'usage'):
        used |= {r[0] for r in db.execute('SELECT DISTINCT user_id FROM usage')}
        for r in db.execute('SELECT user_id, kind, SUM(amount) AS n FROM usage WHERE at >= ? AND at <= ? GROUP BY user_id, kind', (start, end)):
            if r['user_id'] in team:
                continue
            slot = out['usage'].setdefault(r['kind'], dict(total=0, users=0))
            slot['total'] += r['n'] or 0
            slot['users'] += 1
    if ctx.has_table(db, 'library_books'):
        used |= {r[0] for r in db.execute('SELECT DISTINCT user_id FROM library_books')}
    paid_users = set()
    for r in db.execute("SELECT o.user_id, o.currency, o.amount, o.status, u.email FROM orders o LEFT JOIN users u ON u.id = o.user_id "
                        "WHERE COALESCE(o.paid_at, o.created_at) >= ? AND COALESCE(o.paid_at, o.created_at) <= ?", (start, end)):
        if r['user_id'] in team or str(r['email'] or '').lower() == TESTER:
            continue
        if r['status'] == 'paid':
            out['orders'] += 1
            paid_users.add(r['user_id'])
            cur = r['currency'] or 'IDR'
            out['revenue'][cur] = out['revenue'].get(cur, 0) + (r['amount'] or 0)
        elif r['status'] == 'pending':
            out['pending'] += 1
    out.update(signups=len(ids), verified=verified, activated=len(set(ids) & used), paidMembers=len(paid_users))
    return out


def release_notes(root, now, days=7, limit=8):
    """Rilis terbaru dari 'Log terbaru' di DEPLOY.md (ada di VPS karena paket rilis berisi berkas Git)."""
    out = dict(items=[], latest=None)
    try:
        lines = (Path(root) / 'DEPLOY.md').read_text(encoding='utf-8').splitlines()
    except OSError:
        return out
    start = next((i for i, line in enumerate(lines) if line.strip().lower().startswith('## log terbaru')), None)
    if start is None:
        return out
    entries = []
    for line in lines[start + 1:]:
        if line.startswith('## '):
            break
        m = ENTRY.match(line.strip())
        month = MONTHS.get(m.group(2).lower()) if m else None
        if not month:
            continue
        try:
            ts = int(time.mktime((int(m.group(3)), month, int(m.group(1)), 12, 0, 0, 0, 0, -1)))
        except (ValueError, OverflowError):
            continue
        text = m.group(4)
        code = re.search(r'kode `([0-9a-f]{7,40})`', text) or re.search(r'live `([0-9a-f]{7,40})`', text)
        text = re.sub(r'^live[^:]{0,90}:\s*', '', text.replace('`', ''), count=1)
        text = re.split(r'(?<=[A-Za-z0-9\)])\.\s', text, maxsplit=1)[0].rstrip('.')
        if len(text) > 230:
            text = text[:229].rstrip() + '…'
        entries.append(dict(ts=ts, code=code.group(1) if code else '', summary=pdf_safe(text)))
    if entries:
        out['latest'] = entries[0]
    since = _midnight(now - (days - 1) * 86400)
    out['items'] = [e for e in entries if e['ts'] >= since][:limit]
    return out


def followup(ctx, now, limit=15):
    """Member gratis yang layak dihubungi agar upgrade, diurutkan dengan skor sederhana."""
    out = dict(total=0, verified=0, pool=0, segments={}, items=[], notVerified=0, inactive=0)
    db = ctx.read_only(ctx.db_path())
    if not db:
        return out
    team = set(ctx.team_ids())
    since = now - 30 * 86400
    state = _state(ctx.data_dir)
    listed = state.get('listed') if isinstance(state.get('listed'), dict) else {}
    with db:
        users = [dict(r) for r in db.execute('SELECT id, email, name, plan, plan_expires_at, verified, created_at FROM users')]
        free = [u for u in users if u['id'] not in team and str(u['email']).lower() != TESTER and not _paid_active(u, now)]
        ids = {u['id'] for u in free}
        usage, books, unpaid, ever_paid = {}, {}, {}, {}
        if ctx.has_table(db, 'usage'):
            for r in db.execute('SELECT user_id, kind, SUM(amount) AS n, MAX(at) AS last FROM usage WHERE at >= ? GROUP BY user_id, kind', (since,)):
                if r['user_id'] in ids:
                    usage.setdefault(r['user_id'], {})[r['kind']] = (r['n'] or 0, r['last'] or 0)
        if ctx.has_table(db, 'library_books'):
            for r in db.execute('SELECT user_id, COUNT(*) AS n, MAX(created_at) AS last FROM library_books GROUP BY user_id'):
                if r['user_id'] in ids:
                    books[r['user_id']] = (r['n'], r['last'] or 0)
        for r in db.execute('SELECT user_id, status, created_at, paid_at FROM orders'):
            uid = r['user_id']
            if uid not in ids:
                continue
            if r['status'] == 'paid':
                ever_paid[uid] = max(ever_paid.get(uid, 0), r['paid_at'] or r['created_at'])
            elif r['status'] in ('pending', 'failed', 'expired') and r['created_at'] >= since:
                unpaid[uid] = max(unpaid.get(uid, 0), r['created_at'])
    db.close()
    out['total'] = len(free)
    out['verified'] = sum(1 for u in free if u['verified'])
    pool = []
    for u in free:
        uid = u['id']
        use = usage.get(uid, {})
        conv, ai, trans = (use.get(k, (0, 0))[0] for k in ('office', 'ai', 'translate'))
        book_n, book_last = books.get(uid, (0, 0))
        last = max([v[1] for v in use.values()] + [book_last, 0])
        age = (now - u['created_at']) // 86400
        active = bool(conv or ai or trans or book_n)
        reasons, score = [], 0
        if uid in unpaid:
            score += 5
            reasons.append('memulai pemesanan tetapi belum membayar')
        if uid in ever_paid:
            score += 5
            reasons.append('pernah berlangganan')
        if ai:
            score += 3
            reasons.append(f'{fmt_int(ai)} pertanyaan AI')
        if conv:
            score += 3 if conv >= 5 else 1
            reasons.append(f'{fmt_int(conv)} konversi')
        if trans:
            reasons.append('memakai terjemahan')
        if book_n:
            score += 2
            reasons.append(f'{fmt_int(book_n)} buku di My Library')
        if last:
            score += 2 if now - last <= 7 * 86400 else 1 if now - last <= 14 * 86400 else 0
        score += 1 if u['verified'] else 0
        score += 1 if age >= 7 else 0
        if uid in unpaid:
            seg = 'checkout'
        elif uid in ever_paid:
            seg = 'mantan'
        elif active and (conv >= 3 or ai or book_n):
            seg = 'aktif'
        elif active:
            seg = 'mencoba'
        elif age <= 14:
            seg = 'baru'
        else:
            seg = 'dorman'
        if seg == 'dorman':
            out['inactive'] += 1
            continue
        if not u['verified'] and seg not in ('checkout', 'mantan'):
            out['notVerified'] += 1
            continue
        out['segments'][seg] = out['segments'].get(seg, 0) + 1
        pool.append(dict(id=uid, email=u['email'], name=(u['name'] or '').strip(), segment=seg, label=SEGMENTS[seg], score=score,
                         reasons=', '.join(reasons), last=last, created=u['created_at'],
                         repeat=str(uid) in listed and now - listed[str(uid)] < 14 * 86400))
    pool.sort(key=lambda m: (-m['score'], -m['last'], m['id']))
    out['pool'] = len(pool)
    out['items'] = pool[:limit]
    return out


def collect(ctx, now=None, days=7):
    """Semua angka laporan: periode ini (`days` hari berakhir hari ini) dan periode sebelumnya."""
    now = int(now or time.time())
    start = _midnight(now - (days - 1) * 86400)
    prev_end = start - 1
    prev_start = _midnight(prev_end - (days - 1) * 86400)
    data = dict(now=now, days=days, start=start, prevStart=prev_start, prevEnd=prev_end,
                stats=ctx.visitor_stats(days), prev=ctx.visitor_stats(days, prev_start, prev_end),
                overview=ctx.overview(now), cur={}, before={})
    team = set(ctx.team_ids())
    db = ctx.read_only(ctx.db_path())
    if db:
        with db:
            data['cur'] = _window(ctx, db, team, start, now)
            data['before'] = _window(ctx, db, team, prev_start, prev_end)
        db.close()
    else:
        data['cur'] = data['before'] = _window_empty()
    data['release'] = release_notes(ctx.root, now, days)
    data['followup'] = followup(ctx, now)
    data['notes'] = config(ctx.data_dir)['notes']
    data['insights'] = insights(data)
    return data


def _window_empty():
    return dict(signups=0, verified=0, activated=0, paidMembers=0, orders=0, revenue={}, pending=0, usage={})


def _channel(host):
    host = str(host or '').lower()
    if any(name in host for name in SEARCH):
        return 'Mesin pencari'
    if any(host == name or host.endswith('.' + name) or name in host for name in SOCIAL):
        return 'Media sosial'
    return 'Situs lain'


def insights(d):
    """Temuan utama dalam kalimat Indonesia baku, dari angka yang ada (tanpa tebakan)."""
    s, p, c = d['stats'], d['prev'], d['cur']
    over = d['overview']
    out = []
    v, pv = s.get('visitors', 0), p.get('visitors', 0)
    out.append(f'Pengunjung unik {fmt_int(v)}, {trend(v, pv)} dibanding 7 hari sebelumnya ({fmt_int(pv)}); '
               f'tampilan halaman {fmt_int(s.get("views", 0))}.')
    refs = s.get('referrers') or []
    if refs:
        out.append(f'Sumber rujukan terbesar: {refs[0]["name"]} ({fmt_int(refs[0]["views"])} kunjungan).')
    else:
        out.append('Belum ada kunjungan dengan sumber rujukan; trafik umumnya datang langsung atau tidak terlacak.')
    devices = {x['name']: x['views'] for x in s.get('devices') or []}
    if sum(devices.values()):
        out.append(f'Perangkat seluler menyumbang {pct(devices.get("mobile", 0), sum(devices.values()))} dari tampilan halaman.')
    if v:
        out.append(f'Dari {fmt_int(v)} pengunjung, {fmt_int(c["signups"])} mendaftar sebagai member ({pct(c["signups"], v)}).')
    members, paid = over.get('members', 0), over.get('paid', 0)
    free = d['followup']['total']
    out.append(f'Member berbayar aktif {fmt_int(paid)} dari {fmt_int(members)} member ({pct(paid, members)}); '
               f'{fmt_int(free)} member masih gratis.')
    rev = (c['revenue'] or {}).get('IDR', 0)
    prev_rev = (d['before']['revenue'] or {}).get('IDR', 0)
    out.append(f'Pendapatan periode ini {money(rev, "IDR")} dari {fmt_int(c["orders"])} order lunas, '
               f'{trend(rev, prev_rev)} dibanding periode sebelumnya ({money(prev_rev, "IDR")}).')
    if c['pending']:
        out.append(f'{fmt_int(c["pending"])} order masih tertunda dan belum dibayar; layak ditindaklanjuti.')
    return out


# ---------------------------------------------------------------- PDF

def _bold(r, text, size=9):
    r.room(size + 8)
    r.c.text(M, r.y, text, size, True, INK)
    r.y -= size + 5


def _bar_chart(r, labels, values, height=62):
    r.room(height + 40)
    c, n = r.c, max(1, len(values))
    base = r.y - height
    slot = (PAGE_W - 2 * M) / n
    top = max(list(values) + [1])
    for i, value in enumerate(values):
        bw = slot * 0.56
        x = M + i * slot + (slot - bw) / 2
        h = max(1.0, height * value / top) if value else 1.0
        c.rect(round(x, 1), base, round(bw, 1), round(h, 1), ACCENT)
        text = fmt_int(value)
        c.text(x + bw / 2 - c.width(text, 7, True) / 2, base + h + 3, text, 7, True, INK)
        label = labels[i]
        c.text(x + bw / 2 - c.width(label, 7, False) / 2, base - 11, label, 7, False, MUTED)
    r.y = base - 28


def build_pdf(d):
    """Bytes PDF laporan dari hasil collect()."""
    now, days = d['now'], d['days']
    s, p, c, b = d['stats'], d['prev'], d['cur'], d['before']
    over = d['overview']
    period = f'{day_label(d["start"])} s.d. {day_label(now)} ({days} hari)'
    r = admin_report.Report('Laporan Mingguan MyFlipbook Pro', f'Periode {period}, dibanding {days} hari sebelumnya', logo=LOGO)

    r.heading('1. Ringkasan dan temuan utama')
    plans = over.get('plans', {})
    rev, prev_rev = (c['revenue'] or {}).get('IDR', 0), (b['revenue'] or {}).get('IDR', 0)
    r.pairs([('PENGUNJUNG UNIK', f'{fmt_int(s.get("visitors"))} ({delta(s.get("visitors"), p.get("visitors"))})'),
             ('TAMPILAN HALAMAN', f'{fmt_int(s.get("views"))} ({delta(s.get("views"), p.get("views"))})'),
             ('MEMBER BARU', f'{fmt_int(c["signups"])} ({delta(c["signups"], b["signups"])})'),
             ('ORDER LUNAS', f'{fmt_int(c["orders"])} ({delta(c["orders"], b["orders"])})'),
             ('PENDAPATAN (IDR)', money(rev, 'IDR')),
             ('MEMBER BERBAYAR AKTIF', f'{fmt_int(over.get("paid"))} dari {fmt_int(over.get("members"))}')], columns=3)
    for line in d['insights']:
        r.note('- ' + line, 9)

    r.heading('2. Pengunjung dan traffic')
    daily = s.get('daily', [])
    if daily:
        _bar_chart(r, [x['day'][8:10] + '/' + x['day'][5:7] for x in daily], [x.get('visitors', 0) for x in daily])
        r.note('Grafik: pengunjung unik per hari (tanpa akun tim dan mesin otomatis).', 8)
    r.table(['TANGGAL', 'PENGUNJUNG', 'TAMPILAN', 'MEMBER BARU', 'KONVERSI', 'AI', 'BUKU'],
            [('-'.join(reversed(x['day'].split('-'))), fmt_int(x.get('visitors')), fmt_int(x.get('views')), fmt_int(x.get('members')),
              fmt_int(x.get('office')), fmt_int(x.get('ai')), fmt_int(x.get('books'))) for x in reversed(daily)],
            [80, 72, 72, 72, 72, 66, 69], right=(1, 2, 3, 4, 5, 6))
    top = lambda key, n=8: [(pdf_safe(x['name']) or '(langsung)', fmt_int(x['views'])) for x in (s.get(key) or [])[:n]]
    r.table(['HALAMAN TERATAS', 'TAMPILAN'], top('pages', 10), [400, 103], right=(1,))
    channels = {}
    for x in s.get('referrers') or []:
        channels[_channel(x['name'])] = channels.get(_channel(x['name']), 0) + x['views']
    r.table(['SUMBER RUJUKAN', 'KUNJUNGAN'], top('referrers', 10), [400, 103], right=(1,))
    if channels:
        r.note('Menurut jenis sumber: ' + ', '.join(f'{k} {fmt_int(v)}' for k, v in sorted(channels.items(), key=lambda kv: -kv[1])) + '.', 9)
    r.table(['PERANGKAT', 'TAMPILAN'], top('devices', 5), [400, 103], right=(1,))
    if s.get('countries'):
        r.table(['NEGARA', 'PENGUNJUNG'], top('countries'), [400, 103], right=(1,))
    if s.get('cities'):
        r.table(['KOTA', 'PENGUNJUNG'], top('cities'), [400, 103], right=(1,))

    r.heading('3. Analisis pasar (data internal)')
    funnel = [('Pengunjung unik', s.get('visitors', 0), p.get('visitors', 0), None),
              ('Mendaftar sebagai member', c['signups'], b['signups'], s.get('visitors', 0)),
              ('Email terverifikasi', c['verified'], b['verified'], c['signups']),
              ('Sudah memakai fitur', c['activated'], b['activated'], c['verified'] or c['signups']),
              ('Pemilik order lunas', c['paidMembers'], b['paidMembers'], c['activated'] or c['signups'])]
    r.table(['TAHAP', 'PERIODE INI', 'PERIODE LALU', 'RASIO'],
            [(name, fmt_int(now_v), fmt_int(before_v), '-' if base is None else pct(now_v, base)) for name, now_v, before_v, base in funnel],
            [190, 100, 100, 113], right=(1, 2, 3))
    r.note('Rasio dihitung dari tahap sebelumnya. Tahap member dihitung dari akun yang mendaftar pada periode ini; '
           '"pemilik order lunas" dapat mencakup member lama yang membayar pada periode ini.', 8)
    rows = []
    for key, label in FEATURES:
        now_u, before_u = c['usage'].get(key, {}), b['usage'].get(key, {})
        rows.append((label, fmt_int(now_u.get('total')), fmt_int(now_u.get('users')), fmt_int(before_u.get('total'))))
    books_now, books_before = sum(x.get('books', 0) for x in daily), sum(x.get('books', 0) for x in p.get('daily', []))
    rows.append(('Buku disimpan ke My Library', fmt_int(books_now), '-', fmt_int(books_before)))
    r.table(['FITUR', 'PEMAKAIAN', 'PENGGUNA UNIK', 'PERIODE LALU'], rows, [190, 100, 110, 103], right=(1, 2, 3))
    r.pairs([('MEMBER BASIC / MEDIUM / PRO', f'{fmt_int(plans.get("basic"))} / {fmt_int(plans.get("medium"))} / {fmt_int(plans.get("pro"))}'),
             ('PENDAPATAN PERIODE LALU', money(prev_rev, 'IDR')),
             ('ORDER TERTUNDA', fmt_int(c['pending']))], columns=3)
    usd = (c['revenue'] or {}).get('USD')
    if usd:
        r.note(f'Pendapatan dalam USD pada periode ini: {money(usd, "USD")}.', 8)
    countries = {x['name'].lower(): x['views'] for x in s.get('countries') or []}
    local = countries.get('indonesia', countries.get('id', 0))
    if s.get('visitors'):
        r.note(f'Pengunjung dari Indonesia: {pct(local, s["visitors"])} dari pengunjung unik; sisanya dari luar negeri atau tidak terdeteksi.', 9)
    _bold(r, 'Catatan pasar dan pesaing (diisi admin)')
    r.note(pdf_safe(d['notes'].get('market')) or 'Belum ada catatan. Isi di Admin, tab Laporan Mingguan. Data pesaing dan tren industri tidak diambil otomatis.', 9)

    r.heading('4. Progress pengembangan produk')
    rel = d['release']
    if rel['items']:
        for item in rel['items']:
            r.note(f'{day_label(item["ts"])}' + (f' (kode {item["code"]})' if item['code'] else '') + ': ' + item['summary'], 9)
    else:
        last = rel.get('latest')
        r.note('Tidak ada rilis baru pada periode ini.' + (f' Rilis terakhir tercatat {day_label(last["ts"])}: {last["summary"]}' if last else ''), 9)
    _bold(r, 'Sedang dikerjakan dan rencana (diisi admin)')
    r.note(pdf_safe(d['notes'].get('product')) or 'Belum ada catatan. Isi di Admin, tab Laporan Mingguan.', 9)

    f = d['followup']
    r.heading('5. Follow-up member gratis agar upgrade')
    r.pairs([('MEMBER GRATIS', fmt_int(f['total'])), ('LAYAK DIHUBUNGI', fmt_int(f['pool'])),
             ('BELUM VERIFIKASI EMAIL', fmt_int(f['notVerified'])), ('TIDAK AKTIF', fmt_int(f['inactive'])),
             ('TERVERIFIKASI', fmt_int(f['verified']))], columns=3)
    if f['segments']:
        r.note('Segmen: ' + ', '.join(f'{SEGMENTS[k]} {fmt_int(v)}' for k, v in sorted(f['segments'].items(), key=lambda kv: -kv[1])) + '.', 9)
    r.note('Skor sederhana: pemesanan tertunda (+5), pernah berlangganan (+5), memakai AI (+3), konversi (+1 sampai +3), '
           'My Library (+2), aktif dalam 7 hari (+2), email terverifikasi (+1), sudah mendaftar 7 hari atau lebih (+1).', 8)
    if f['items']:
        _bold(r, f'{len(f["items"])} member teratas untuk dihubungi')
        for m in f['items']:
            r.room(34)
            r.c.text(M, r.y, m['email'], 9, True, INK)
            r.c.text(PAGE_W - M, r.y, f'{m["label"]} - skor {m["score"]}', 8, True, ACCENT, right=True)
            r.y -= 12
            detail = ' | '.join(x for x in [pdf_safe(m['name']), 'daftar ' + day_label(m['created']),
                                            'aktif terakhir ' + (day_label(m['last']) if m['last'] else 'belum ada'),
                                            m['reasons'], 'sudah tampil di laporan sebelumnya' if m['repeat'] else ''] if x)
            r.note(detail, 8)
            r.c.line(M, r.y + 2, PAGE_W - M, LINE, 0.5)
            r.y -= 6
        _bold(r, 'Contoh pesan (ganti {nama}; kirim manual dari email resmi)')
        for seg in [k for k in TEMPLATES if k in {m['segment'] for m in f['items']}]:
            r.note(f'{SEGMENTS[seg]}: ' + TEMPLATES[seg], 8)
    else:
        r.note('Belum ada member gratis yang memenuhi syarat follow-up pada periode ini.', 9)
    r.note('Halaman ini memuat data pribadi member (email). Jangan diteruskan di luar tim.', 8)
    return r.pdf(time.strftime('%d-%m-%Y %H:%M', time.localtime(now)))


# ---------------------------------------------------------------- email

def compose(d):
    """(subjek, teks, html) untuk email laporan; tanpa daftar email member."""
    now = d['now']
    wd = WEEKDAYS[time.localtime(now).tm_wday]
    subject = f'Laporan Mingguan MyFlipbook Pro - {wd}, {day_label(now)}'
    f = d['followup']
    lines = list(d['insights'])
    lines.append(f'Follow-up: {fmt_int(f["pool"])} member gratis layak dihubungi agar upgrade '
                 f'(rincian dan contoh pesan ada di lampiran PDF).')
    rel = d['release']
    lines.append(f'Rilis produk pada periode ini: {len(rel["items"])}.' if rel['items'] else 'Tidak ada rilis produk baru pada periode ini.')
    text = (f'Halo Tim,\n\nBerikut ringkasan laporan mingguan MyFlipbook Pro periode {day_label(d["start"])} s.d. {day_label(now)}:\n\n'
            + '\n'.join('- ' + x for x in lines)
            + '\n\nLaporan lengkap (pengunjung, traffic, analisis pasar, progress produk, dan follow-up member gratis) ada pada lampiran PDF. '
              'Lampiran memuat data pribadi member; jangan diteruskan di luar tim.\n\nSalam,\nMyFlipbook Pro')
    esc = lambda x: x.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    html = ('<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1c1917">'
            f'<p>Halo Tim,</p><p>Berikut ringkasan laporan mingguan <b>MyFlipbook Pro</b> periode {day_label(d["start"])} s.d. {day_label(now)}:</p>'
            '<ul>' + ''.join(f'<li>{esc(x)}</li>' for x in lines) + '</ul>'
            '<p>Laporan lengkap ada pada lampiran PDF. Lampiran memuat data pribadi member; jangan diteruskan di luar tim.</p>'
            + ('<p style="margin:24px 0 0"><img src="cid:' + LOGO_CID + '" alt="MyFlipbook Pro" width="180" '
                'style="display:block;width:180px;height:auto;border:0"></p>'
                if LOGO.is_file() else '<p style="color:#78716c">MyFlipbook Pro</p>')
             + '</div>')
    return subject, text, html


def send_report(data_dir, recipients, subject, text, html, pdf, filename):
    """'sent' lewat SMTP, atau 'outbox' (berkas .eml di .data/outbox) bila SMTP belum diatur."""
    sender = os.environ.get('MAIL_FROM', '').strip() or os.environ.get('SMTP_USER', '').strip() or 'no-reply@myflipbook.local'
    message = EmailMessage()
    message['From'] = formataddr((os.environ.get('MAIL_FROM_NAME', 'MyFlipbook').strip() or 'MyFlipbook', sender))
    message['To'] = ', '.join(recipients)
    message['Subject'] = subject
    message.set_content(text)
    message.add_alternative(html, subtype='html')
    if f'cid:{LOGO_CID}' in html and LOGO.is_file():
        message.get_payload()[1].add_related(LOGO.read_bytes(), 'image', 'png', cid=f'<{LOGO_CID}>', disposition='inline', filename='logo.png')
    message.add_attachment(pdf, maintype='application', subtype='pdf', filename=filename)
    host = os.environ.get('SMTP_HOST', '').strip()
    if not host:
        outbox = Path(data_dir) / 'outbox'
        outbox.mkdir(parents=True, exist_ok=True)
        (outbox / f'{int(time.time())}-laporan-mingguan.eml').write_bytes(bytes(message))
        return 'outbox'
    port = int(os.environ.get('SMTP_PORT', '587') or 587)
    user, password = os.environ.get('SMTP_USER', '').strip(), os.environ.get('SMTP_PASS', '').strip()
    context = ssl.create_default_context()
    try:
        server = smtplib.SMTP_SSL(host, port, timeout=45, context=context) if port == 465 else smtplib.SMTP(host, port, timeout=45)
        with server:
            if port != 465:
                server.starttls(context=context)
            if user:
                server.login(user, password)
            server.send_message(message)
    except (smtplib.SMTPException, OSError) as cause:
        raise RuntimeError(f'Email gagal dikirim: {cause}') from cause
    return 'sent'


# ---------------------------------------------------------------- jalan dan jadwal

def _log(data_dir, state, entry):
    runs = list(state.get('runs') or [])
    runs.append(entry)
    state['runs'] = runs[-MAX_RUNS:]
    _save_state(data_dir, state)


def run(ctx, now=None, recipients=None, slot='', manual=False):
    """Susun PDF dan kirim. recipients=None memakai daftar di pengaturan; hasil dicatat di weekly-report.json."""
    now = int(now or time.time())
    to = list(recipients or config(ctx.data_dir)['recipients'])
    entry = dict(at=now, slot=slot, manual=bool(manual), to=len(to), status='gagal', error='', bytes=0)
    try:
        data = collect(ctx, now)
        pdf = build_pdf(data)
        subject, text, html = compose(data)
        entry['status'] = send_report(ctx.data_dir, to, subject, text, html, pdf,
                                      f'laporan-mingguan-myflipbook-{time.strftime("%Y%m%d", time.localtime(now))}.pdf')
        entry['bytes'] = len(pdf)
        listed = {str(m['id']): now for m in data['followup']['items']}
    except Exception as cause:     # penjadwal tidak boleh mati karena satu laporan gagal; galat dicatat
        entry['error'] = str(cause)[:200]
        listed = {}
    with LOCK:
        state = _state(ctx.data_dir)
        if slot:
            if entry['status'] == 'sent':
                state.update(lastSlot=slot, failSlot='', failCount=0)
            else:
                state['failCount'] = state.get('failCount', 0) + 1 if state.get('failSlot') == slot else 1
                state.update(failSlot=slot, failAt=now)
        if entry['status'] == 'sent' and not recipients:
            old = state.get('listed') if isinstance(state.get('listed'), dict) else {}
            merged = {k: v for k, v in old.items() if now - v < 30 * 86400}
            merged.update(listed)
            state['listed'] = merged
        _log(ctx.data_dir, state, entry)
    ctx.log(f'weekly report {entry["status"]} to {entry["to"]} recipients' + (' (manual)' if manual else '') + (': ' + entry['error'] if entry['error'] else ''))
    return entry


def tick(ctx, now=None):
    """Dipanggil tiap menit: kirim bila hari ini hari laporan, jamnya sudah tiba, dan belum terkirim hari ini."""
    now = int(now or time.time())
    cfg = config(ctx.data_dir)
    if not cfg['enabled'] or not cfg['recipients']:
        return None
    t = time.localtime(now)
    if t.tm_wday not in cfg['days'] or t.tm_hour < cfg['hour']:
        return None
    slot = time.strftime('%Y-%m-%d', t)
    with LOCK:
        state = _state(ctx.data_dir)
        if state.get('lastSlot') == slot:
            return None
        if state.get('failSlot') == slot and (state.get('failCount', 0) >= MAX_ATTEMPTS or now - state.get('failAt', 0) < RETRY_SECONDS):
            return None
        if not smtp_ready():
            state.update(failSlot=slot, failAt=now, failCount=MAX_ATTEMPTS)
            _log(ctx.data_dir, state, dict(at=now, slot=slot, manual=False, to=len(cfg['recipients']), status='gagal', bytes=0,
                                           error='SMTP belum diatur di .env (SMTP_HOST, SMTP_USER, SMTP_PASS).'))
            return None
    return run(ctx, now=now, slot=slot)


def start(ctx, interval=60):
    """Mulai utas penjadwal (daemon); mengembalikan Event untuk menghentikannya."""
    stop = threading.Event()

    def loop():
        stop.wait(20)
        while not stop.is_set():
            try:
                tick(ctx)
            except Exception as cause:
                ctx.log(f'weekly report loop error: {cause}')
            stop.wait(interval)
    threading.Thread(target=loop, name='weekly-report', daemon=True).start()
    return stop
