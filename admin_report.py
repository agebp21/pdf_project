"""PDF report of the admin numbers for an audit ("Laporan" in the admin panel) — Python stdlib only.

Several A4 pages drawn with invoice.py's tiny canvas (Helvetica, WinAnsi): summary
(members, plans, payments, My Library, visitors), the paid orders of the period
(emails masked), a day-by-day table, top pages / referrers / devices / places,
and the server status (which settings are filled in, never their values).
The numbers are the ones the admin panel shows (admin_server.overview,
visitor_stats, server_status); the team's own accounts are left out of the
visitor and growth figures there, as on screen.
"""
import time
import zlib

import invoice
from invoice import INK, MUTED, ACCENT, LINE, PAGE_W, PAGE_H, money

M = 46                      # page margin
BOTTOM = 70                 # lowest y for content (footer below)
HEAD = (0.96, 0.95, 0.92)


def mask_email(email):
    """a***@gmail.com — enough to recognise an order, not to collect addresses."""
    name, _, domain = str(email or '').partition('@')
    return (name[:1] + '***@' + domain) if domain else '—'


def fmt_int(n):
    return f'{int(n or 0):,}'.replace(',', '.')


def fmt_bytes(n):
    n = float(n or 0)
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if n < 1024 or unit == 'TB':
            return (f'{n:.0f} {unit}' if unit == 'B' else f'{n:.1f} {unit}').replace('.', ',')
        n /= 1024


def day_label(ts):
    return time.strftime('%d-%m-%Y', time.localtime(ts))


class Report:
    """Pages of drawing operations; text flows down and starts a new page when full."""

    def __init__(self, title, subtitle):
        self.title, self.subtitle = title, subtitle
        self.pages = []
        self.new_page()

    def new_page(self):
        self.c = invoice._Canvas()
        self.pages.append(self.c)
        first = len(self.pages) == 1
        if first:
            self.c.rect(0, PAGE_H - 108, PAGE_W, 108, ACCENT)
            self.c.text(M, PAGE_H - 56, self.title, 20, True, (1, 0.97, 0.92))
            self.c.text(M, PAGE_H - 78, self.subtitle, 10, False, (0.89, 0.95, 0.76))
            self.y = PAGE_H - 140
        else:
            self.c.text(M, PAGE_H - 40, self.title, 9, True, MUTED)
            self.c.text(PAGE_W - M, PAGE_H - 40, self.subtitle, 9, False, MUTED, right=True)
            self.c.line(M, PAGE_H - 48, PAGE_W - M)
            self.y = PAGE_H - 74

    def room(self, height):
        if self.y - height < BOTTOM:
            self.new_page()

    def heading(self, text):
        self.room(40)
        self.y -= 6
        self.c.text(M, self.y, text, 13, True, ACCENT)
        self.y -= 8
        self.c.line(M, self.y, PAGE_W - M, ACCENT, 1.2)
        self.y -= 18

    def note(self, text, size=9):
        """Muted text, wrapped to the page width."""
        line, lines = '', []
        for word in str(text).split():
            trial = (line + ' ' + word).strip()
            if line and invoice._Canvas.width(trial, size, False) > PAGE_W - 2 * M:
                lines.append(line)
                line = word
            else:
                line = trial
        lines.append(line)
        for part in lines:
            self.room(size + 5)
            self.c.text(M, self.y, part, size, False, MUTED)
            self.y -= size + 5

    def pairs(self, rows, columns=2):
        """Label / value pairs in columns (the summary figures)."""
        col_w = (PAGE_W - 2 * M) / columns
        for i in range(0, len(rows), columns):
            self.room(34)
            for j, (label, value) in enumerate(rows[i:i + columns]):
                x = M + j * col_w
                self.c.text(x, self.y, label, 8, True, MUTED)
                self.c.text(x, self.y - 15, str(value), 13, True, INK)
            self.y -= 36

    def table(self, head, rows, widths, right=()):
        """A table with a shaded header row repeated on every page it spans."""
        xs, x = [], M
        for w in widths:
            xs.append(x)
            x += w

        def header():
            self.c.rect(M, self.y - 6, sum(widths), 20, HEAD)
            for i, h in enumerate(head):
                if i in right:
                    self.c.text(xs[i] + widths[i] - 6, self.y, h, 8, True, MUTED, right=True)
                else:
                    self.c.text(xs[i] + 6, self.y, h, 8, True, MUTED)
            self.y -= 20

        self.room(48)
        header()
        if not rows:
            self.c.text(M + 6, self.y, '(tidak ada data pada periode ini)', 9, False, MUTED)
            self.y -= 20
            return
        for row in rows:
            if self.y - 16 < BOTTOM:
                self.new_page()
                header()
            for i, cell in enumerate(row):
                text = str(cell)
                limit = max(4, int(widths[i] / 5.2))
                text = text if len(text) <= limit else text[:limit - 1] + '…'
                if i in right:
                    self.c.text(xs[i] + widths[i] - 6, self.y, text, 9, False, INK, right=True)
                else:
                    self.c.text(xs[i] + 6, self.y, text, 9, False, INK)
            self.y -= 15
            self.c.line(M, self.y + 4, M + sum(widths), LINE, 0.5)
        self.y -= 10

    def pdf(self, generated):
        total = len(self.pages)
        for n, page in enumerate(self.pages, 1):
            page.line(M, 54, PAGE_W - M)
            page.text(M, 40, f'MyFlipbook Pro · laporan admin · dibuat {generated}', 8, False, MUTED)
            page.text(PAGE_W - M, 40, f'Halaman {n} dari {total}', 8, False, MUTED, right=True)
        return write_pages(['\n'.join(p.ops).encode('latin-1') for p in self.pages], self.title)


def write_pages(contents, title, size=(PAGE_W, PAGE_H)):
    """A multi-page PDF (invoice._write makes one page); size: (width, height) in points."""
    n = len(contents)
    font1, font2 = 3 + 2 * n, 4 + 2 * n
    info = 5 + 2 * n
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               f'<< /Type /Pages /Kids [{" ".join(f"{3 + 2 * i} 0 R" for i in range(n))}] /Count {n} >>'.encode()]
    for i, content in enumerate(contents):
        stream = zlib.compress(content)
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {size[0]} {size[1]}] '
                       f'/Resources << /Font << /F1 {font1} 0 R /F2 {font2} 0 R >> >> /Contents {4 + 2 * i} 0 R >>'.encode())
        objects.append(f'<< /Length {len(stream)} /Filter /FlateDecode >>\nstream\n'.encode() + stream + b'\nendstream')
    objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
    objects.append(f'<< /Title {invoice._text(title)} /Producer (MyFlipbook) >>'.encode('latin-1'))
    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f'{number} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
    out += b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets)
    out += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info {info} 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return bytes(out)


def build(days, overview, stats, orders, server, now=None):
    """PDF bytes. overview / stats / server: the admin panel's dicts; orders: rows of the period
    (dicts with id, email, plan, cycle, amount, currency, status, provider, created_at, paid_at)."""
    now = int(now or time.time())
    start = now - (days - 1) * 86400
    period = f'{day_label(start)} s.d. {day_label(now)} ({days} hari)'
    r = Report('Laporan MyFlipbook Pro', 'Periode ' + period)

    r.heading('1. Ringkasan')
    plans = overview.get('plans', {})
    r.pairs([('TOTAL MEMBER', fmt_int(overview.get('members'))),
             ('MEMBER BARU (PERIODE)', fmt_int(stats.get('newMembers'))),
             ('MEMBER BERBAYAR AKTIF', fmt_int(overview.get('paid'))),
             ('BASIC / MEDIUM / PRO', f'{fmt_int(plans.get("basic"))} / {fmt_int(plans.get("medium"))} / {fmt_int(plans.get("pro"))}'),
             ('PENGUNJUNG (PERIODE)', fmt_int(stats.get('visitors'))),
             ('TAMPILAN HALAMAN (PERIODE)', fmt_int(stats.get('views'))),
             ('RATA-RATA PENGUNJUNG / HARI', str(stats.get('average', 0)).replace('.', ',')),
             ('MEMBER YANG BERKUNJUNG', fmt_int(stats.get('members')))])
    revenue = overview.get('revenue', {})
    r.pairs([('PENDAPATAN TOTAL (IDR)', money((revenue.get('IDR') or {}).get('total', 0), 'IDR')),
             ('ORDER LUNAS (IDR)', fmt_int((revenue.get('IDR') or {}).get('orders', 0))),
             ('BUKU DI MY LIBRARY', fmt_int(overview.get('books'))),
             ('UKURAN MY LIBRARY', fmt_bytes(overview.get('bookBytes')))])
    statuses = overview.get('orders', {})
    r.note('Status semua order: ' + (', '.join(f'{k} {fmt_int(v)}' for k, v in sorted(statuses.items())) or 'belum ada'))
    r.note(f'Member terverifikasi {fmt_int(overview.get("verified"))} · daftar lewat Google {fmt_int(overview.get("google"))} · '
           f'ekspor flipbook {fmt_int(overview.get("exports"))} · pengunggah My Library {fmt_int(overview.get("uploaders"))}')
    if stats.get('teamExcluded'):
        r.note(f'Angka pengunjung dan pertumbuhan tidak menghitung {stats["teamExcluded"]} akun tim.')

    r.heading('2. Pembayaran pada periode ini')
    rows = [(day_label(o['paid_at'] or o['created_at']), o['id'], mask_email(o.get('email')), str(o['plan']).capitalize(),
             'tahunan' if o['cycle'] == 'yearly' else 'bulanan', o['status'], money(o['amount'], o.get('currency') or 'IDR'))
            for o in orders]
    r.table(['TANGGAL', 'ORDER', 'MEMBER', 'PAKET', 'SIKLUS', 'STATUS', 'JUMLAH'], rows, [62, 110, 100, 52, 52, 50, 77], right=(6,))
    paid = [o for o in orders if o['status'] == 'paid' and (o.get('currency') or 'IDR') == 'IDR']
    r.note(f'Lunas pada periode: {len(paid)} order · {money(sum(o["amount"] for o in paid), "IDR")}. Email disamarkan.')

    r.heading('3. Aktivitas harian')
    daily = stats.get('daily', [])
    r.table(['TANGGAL', 'PENGUNJUNG', 'TAMPILAN', 'MEMBER BARU', 'KONVERSI', 'AI', 'BUKU'],
            [('-'.join(reversed(d['day'].split('-'))), fmt_int(d.get('visitors')), fmt_int(d.get('views')), fmt_int(d.get('members')), fmt_int(d.get('office')),
              fmt_int(d.get('ai')), fmt_int(d.get('books'))) for d in reversed(daily)],
            [80, 72, 72, 72, 72, 66, 69], right=(1, 2, 3, 4, 5, 6))

    r.heading('4. Halaman, sumber, dan perangkat')
    top = lambda key, n=10: [(x['name'] or '(langsung)', fmt_int(x['views'])) for x in (stats.get(key) or [])[:n]]
    r.table(['HALAMAN TERATAS', 'TAMPILAN'], top('pages'), [400, 103], right=(1,))
    r.table(['SUMBER RUJUKAN', 'PENGUNJUNG'], top('referrers'), [400, 103], right=(1,))
    r.table(['PERANGKAT', 'TAMPILAN'], top('devices', 5), [400, 103], right=(1,))
    if stats.get('countries'):
        r.table(['NEGARA', 'PENGUNJUNG'], top('countries'), [400, 103], right=(1,))
    if stats.get('cities'):
        r.table(['KOTA', 'PENGUNJUNG'], top('cities'), [400, 103], right=(1,))

    r.heading('5. Status server')
    disk = server.get('disk') or {}
    r.pairs([('DISK TERPAKAI', fmt_bytes((disk.get('total') or 0) - (disk.get('free') or 0)) + ' dari ' + fmt_bytes(disk.get('total'))),
             ('DISK KOSONG', fmt_bytes(disk.get('free'))),
             ('DATABASE MEMBER', fmt_bytes(server.get('database'))),
             ('BERKAS MY LIBRARY', fmt_bytes(server.get('library')))])
    settings = server.get('settings') or {}
    r.note('Pengaturan terisi (nilainya tidak ditampilkan): ' +
           (', '.join(f'{k} {"ya" if v else "tidak"}' for k, v in settings.items()) or '—'), 8)
    return r.pdf(time.strftime('%d-%m-%Y %H:%M', time.localtime(now)))
