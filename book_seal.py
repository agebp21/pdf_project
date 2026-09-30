"""Seal a flipbook into one encrypted HTML file (server side, for APK/EXE).

Same format as assets/export/book-seal.js (which does it in the browser for
HTML exports): the page images and book data are encrypted with ChaCha20
(RFC 8439), base64-encoded and embedded in a single self-opening HTML file
together with the reader. The key travels inside the file, so this keeps
the pages away from casual copying (no loose images, nothing readable in
the file); it cannot stop someone who reverse-engineers the reader.
"""
import base64
import json
import os
import re
import struct

MASK = 0xffffffff


def _quarter(s, a, b, c, d):
    s[a] = (s[a] + s[b]) & MASK; s[d] ^= s[a]; s[d] = ((s[d] << 16) | (s[d] >> 16)) & MASK
    s[c] = (s[c] + s[d]) & MASK; s[b] ^= s[c]; s[b] = ((s[b] << 12) | (s[b] >> 20)) & MASK
    s[a] = (s[a] + s[b]) & MASK; s[d] ^= s[a]; s[d] = ((s[d] << 8) | (s[d] >> 24)) & MASK
    s[c] = (s[c] + s[d]) & MASK; s[b] ^= s[c]; s[b] = ((s[b] << 7) | (s[b] >> 25)) & MASK


def _block(key_words, counter, nonce_words):
    state = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574, *key_words, counter & MASK, *nonce_words]
    s = state[:]
    for _ in range(10):
        _quarter(s, 0, 4, 8, 12); _quarter(s, 1, 5, 9, 13); _quarter(s, 2, 6, 10, 14); _quarter(s, 3, 7, 11, 15)
        _quarter(s, 0, 5, 10, 15); _quarter(s, 1, 6, 11, 12); _quarter(s, 2, 7, 8, 13); _quarter(s, 3, 4, 9, 14)
    return struct.pack('<16I', *[(s[i] + state[i]) & MASK for i in range(16)])


def chacha20(key, nonce, data, counter=0):
    """ChaCha20 (RFC 8439): 32-byte key, 12-byte nonce. Encrypts = decrypts."""
    if len(key) != 32 or len(nonce) != 12:
        raise ValueError('ChaCha20 needs a 32-byte key and a 12-byte nonce.')
    key_words = struct.unpack('<8I', key)
    nonce_words = struct.unpack('<3I', nonce)
    blocks = (len(data) + 63) // 64
    stream = b''.join(_block(key_words, counter + i, nonce_words) for i in range(blocks))[:len(data)]
    return (int.from_bytes(data, 'little') ^ int.from_bytes(stream, 'little')).to_bytes(len(data), 'little')


def page_nonce(nonce, index):
    """Every page gets its own nonce: the base nonce with the page number
    added to its first word (index -1 is the book data)."""
    first = (struct.unpack('<I', nonce[:4])[0] + index + 1) & MASK
    return struct.pack('<I', first) + nonce[4:]


def seal_payload(data, pages, key=None, nonce=None):
    """data: book dict; pages: list of JPEG bytes. Returns the JSON payload
    string embedded in the HTML (key, nonce, encrypted data and pages)."""
    key = key or os.urandom(32)
    nonce = nonce or os.urandom(12)
    b64 = lambda raw: base64.b64encode(raw).decode('ascii')
    payload = {
        'v': 1, 'k': b64(key), 'n': b64(nonce),
        'd': b64(chacha20(key, page_nonce(nonce, -1), json.dumps(data, ensure_ascii=False).encode('utf-8'))),
        'p': [b64(chacha20(key, page_nonce(nonce, i), page)) for i, page in enumerate(pages)],
    }
    return json.dumps(payload, separators=(',', ':'))


def single_html(template, styles, scripts, payload, title):
    """Build the one-file book from the reader's index.html template: its
    stylesheets and scripts inlined, the encrypted payload embedded."""
    html = re.sub(r'<link rel="stylesheet" href="[^"]+">\s*', '', template)
    html = re.sub(r'<script defer src="[^"]+"></script>', '', html)
    # The notice for a book opened from inside a ZIP no longer applies.
    html = re.sub(r'<!-- Shown only when viewer.css is missing.*?</div>\s*', '', html, flags=re.S)
    html = re.sub(r'<meta http-equiv="Content-Security-Policy" content="[^"]*">',
                  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; '
                  'media-src data: blob:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; font-src data:">', html)
    safe_title = title.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    html = re.sub(r'<title>.*?</title>', lambda _: f'<title>{safe_title}</title>', html, flags=re.S)
    css = '\n'.join(styles).replace('</style', '<\\/style')
    html = html.replace('</head>', f'<style>\n{css}\n</style>\n</head>', 1)
    for code in scripts:
        # In a <script>, '</script' ends it early and '<!--' can make the
        # parser skip the closing tag.
        if '</script' in code or '<!--' in code:
            raise ValueError('Reader script cannot be inlined.')
    body = (f'<script type="application/json" id="book-payload">{payload}</script>\n'
            + ''.join(f'<script>\n{code}\n</script>\n' for code in scripts))
    return html.replace('</body>', body + '</body>', 1)
