"""PDF invoices/receipts for paid orders — Python stdlib only.

A tiny single-page PDF writer (standard Helvetica fonts, WinAnsi text,
Flate-compressed content). Seller details come from MYFLIPBOOK_INVOICE_SELLER
(lines separated by "|", e.g. "MyFlipbook by Sarvamaya|Jl. ... Jakarta|
billing@myflipbook.id|NPWP 00.000.000.0-000.000").
"""
import datetime
import zlib

PAGE_W, PAGE_H = 595, 842  # A4 in points
INK, MUTED, ACCENT, LINE = (0.11, 0.10, 0.09), (0.47, 0.44, 0.42), (0.10, 0.24, 0.20), (0.90, 0.87, 0.82)
PROVIDERS = {'tripay': 'Tripay', 'midtrans': 'Midtrans', 'lemonsqueezy': 'Lemon Squeezy', 'mock': 'Local simulation'}
CYCLES = {'monthly': 'Monthly subscription (30 days)', 'yearly': 'Yearly subscription (365 days)'}


def _text(value):
    """PDF literal string in WinAnsi (cp1252); unknown characters become '?'."""
    raw = str(value).encode('cp1252', errors='replace')
    return '(' + raw.replace(b'\\', b'\\\\').replace(b'(', b'\\(').replace(b')', b'\\)').decode('latin-1') + ')'


def money(amount, currency):
    if currency == 'USD':
        return f'US$ {amount / 100:,.2f}'
    return 'Rp ' + f'{int(amount):,}'.replace(',', '.')


def _date(timestamp):
    return datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc).strftime('%d %B %Y')


class _Canvas:
    def __init__(self):
        self.ops = []

    @staticmethod
    def width(value, size, bold):
        """Approximate Helvetica advance widths (AFM units / 1000) by character class."""
        total = 0.0
        for ch in str(value):
            if ch.isdigit() or ch in '$?':
                total += 0.556
            elif ch in ' .,:|Iijlft':
                total += 0.278
            elif ch in 'mwMW':
                total += 0.889
            elif ch == '-':
                total += 0.333
            elif ch.isupper():
                total += 0.722 if bold else 0.667
            else:
                total += 0.556 if bold else 0.5
        return total * size

    def text(self, x, y, value, size=10, bold=False, color=INK, right=False):
        if right:
            x -= self.width(value, size, bold)
        self.ops.append(f'BT /{"F2" if bold else "F1"} {size} Tf {color[0]} {color[1]} {color[2]} rg '
                        f'1 0 0 1 {x:.1f} {y:.1f} Tm {_text(value)} Tj ET')

    def rect(self, x, y, w, h, color):
        self.ops.append(f'{color[0]} {color[1]} {color[2]} rg {x} {y} {w} {h} re f')

    def line(self, x1, y, x2, color=LINE, width=0.8):
        self.ops.append(f'{color[0]} {color[1]} {color[2]} RG {width} w {x1} {y} m {x2} {y} l S')


def build(order, user, seller_lines, issued_at=None):
    """Return PDF bytes for a paid order row (dict-like) and its user."""
    provider = order['provider']
    receipt = provider == 'lemonsqueezy'  # merchant of record issues the tax invoice
    test = provider == 'mock'
    title = 'RECEIPT' if receipt else 'INVOICE'
    number = 'INV-' + str(order['id'])
    currency = order['currency'] if 'currency' in order.keys() else 'IDR'
    paid_at = order['paid_at'] or order['created_at']
    c = _Canvas()
    m = 50
    # Header band
    c.rect(0, PAGE_H - 120, PAGE_W, 120, ACCENT)
    c.text(m, PAGE_H - 62, 'MyFlipbook', 24, True, (1, 0.97, 0.92))
    c.text(m, PAGE_H - 84, 'Every PDF task, turned into a living book.', 10, False, (0.89, 0.95, 0.76))
    c.text(PAGE_W - m, PAGE_H - 62, title, 22, True, (1, 0.97, 0.92), right=True)
    c.text(PAGE_W - m, PAGE_H - 84, number, 10, False, (0.89, 0.95, 0.76), right=True)
    y = PAGE_H - 160
    # Seller / buyer / meta
    c.text(m, y, 'FROM', 8, True, MUTED)
    c.text(300, y, 'BILLED TO', 8, True, MUTED)
    for i, line in enumerate(seller_lines[:5]):
        c.text(m, y - 16 - i * 14, line, 10, i == 0)
    c.text(300, y - 16, user['name'] or user['email'].split('@')[0], 10, True)
    c.text(300, y - 30, user['email'], 10)
    y -= 110
    meta = [('Issue date', _date(issued_at or paid_at)), ('Payment date', _date(paid_at)),
            ('Status', 'PAID' + (' (TEST)' if test else '')), ('Payment via', PROVIDERS.get(provider, provider))]
    if order['reference']:
        meta.append(('Reference', str(order['reference'])[:48]))
    for i, (label, value) in enumerate(meta):
        c.text(m, y - i * 16, label, 9, False, MUTED)
        c.text(160, y - i * 16, value, 10, label == 'Status')
    y -= len(meta) * 16 + 30
    # Line items
    c.rect(m, y - 6, PAGE_W - 2 * m, 24, (0.96, 0.95, 0.92))
    c.text(m + 10, y + 2, 'DESCRIPTION', 8, True, MUTED)
    c.text(PAGE_W - m - 10, y + 2, 'AMOUNT', 8, True, MUTED, right=True)
    y -= 30
    plan = str(order['plan']).capitalize()
    c.text(m + 10, y, f'MyFlipbook {plan} plan', 11, True)
    c.text(m + 10, y - 15, CYCLES.get(order['cycle'], order['cycle']), 9, False, MUTED)
    c.text(PAGE_W - m - 10, y, money(order['amount'], currency), 11, True, right=True)
    y -= 34
    c.line(m, y, PAGE_W - m)
    y -= 24
    c.text(PAGE_W - 230, y, 'Total paid', 11, True)
    c.text(PAGE_W - m - 10, y, money(order['amount'], currency), 14, True, ACCENT, right=True)
    y -= 50
    notes = []
    if receipt:
        notes.append('Payment processed by Lemon Squeezy as merchant of record. Their tax invoice was sent to')
        notes.append('your email; this receipt confirms your MyFlipbook subscription.')
    if test:
        notes.append('TEST DOCUMENT: simulated payment in a local environment. Not a proof of payment.')
    notes.append('Thank you for using MyFlipbook.')
    for i, note in enumerate(notes):
        c.text(m, y - i * 14, note, 9, False, MUTED)
    c.line(m, 70, PAGE_W - m)
    c.text(m, 54, f'{number}  |  Generated {_date(issued_at or paid_at)}', 8, False, MUTED)
    if test:
        c.text(PAGE_W - m, 54, 'TEST', 8, True, (0.8, 0.2, 0.1), right=True)
    return _write('\n'.join(c.ops).encode('latin-1'), f'{title} {number}')


def _write(content, title):
    stream = zlib.compress(content)
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] '
        f'/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>'.encode(),
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
        f'<< /Length {len(stream)} /Filter /FlateDecode >>\nstream\n'.encode() + stream + b'\nendstream',
        f'<< /Title {_text(title)} /Producer (MyFlipbook) >>'.encode('latin-1'),
    ]
    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f'{number} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
    out += b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets)
    out += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return bytes(out)
