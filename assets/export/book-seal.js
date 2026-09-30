'use strict';
// Sealed books: the whole flipbook in ONE html file. Page images and book
// data are encrypted with ChaCha20 (RFC 8439) and embedded as base64; the
// reader decrypts them in the browser, pages in the background so the cover
// shows at once. Same format as book_seal.py (server, APK/EXE builds).
// The key travels inside the file: this keeps the pages away from casual
// copying, it cannot stop someone who reverse-engineers the reader.
// ES2018 for old Android WebViews.
(function (root) {
  const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];

  function words(bytes) {
    const copy = new Uint8Array(bytes.length); copy.set(bytes);
    return new Uint32Array(copy.buffer);
  }
  // XOR data with the ChaCha20 keystream (encrypt = decrypt).
  function chacha20(key, nonce, data, counter) {
    const k = words(key), n = words(nonce), out = new Uint8Array(data.length);
    const block = new Uint32Array(16), bytes = new Uint8Array(block.buffer);
    let c = (counter || 0) >>> 0;
    for (let offset = 0; offset < data.length; offset += 64, c = (c + 1) >>> 0) {
      let x0 = SIGMA[0], x1 = SIGMA[1], x2 = SIGMA[2], x3 = SIGMA[3];
      let x4 = k[0], x5 = k[1], x6 = k[2], x7 = k[3], x8 = k[4], x9 = k[5], x10 = k[6], x11 = k[7];
      let x12 = c, x13 = n[0], x14 = n[1], x15 = n[2];
      for (let i = 0; i < 10; i++) {
        x0 = x0 + x4 | 0; x12 ^= x0; x12 = x12 << 16 | x12 >>> 16; x8 = x8 + x12 | 0; x4 ^= x8; x4 = x4 << 12 | x4 >>> 20;
        x0 = x0 + x4 | 0; x12 ^= x0; x12 = x12 << 8 | x12 >>> 24; x8 = x8 + x12 | 0; x4 ^= x8; x4 = x4 << 7 | x4 >>> 25;
        x1 = x1 + x5 | 0; x13 ^= x1; x13 = x13 << 16 | x13 >>> 16; x9 = x9 + x13 | 0; x5 ^= x9; x5 = x5 << 12 | x5 >>> 20;
        x1 = x1 + x5 | 0; x13 ^= x1; x13 = x13 << 8 | x13 >>> 24; x9 = x9 + x13 | 0; x5 ^= x9; x5 = x5 << 7 | x5 >>> 25;
        x2 = x2 + x6 | 0; x14 ^= x2; x14 = x14 << 16 | x14 >>> 16; x10 = x10 + x14 | 0; x6 ^= x10; x6 = x6 << 12 | x6 >>> 20;
        x2 = x2 + x6 | 0; x14 ^= x2; x14 = x14 << 8 | x14 >>> 24; x10 = x10 + x14 | 0; x6 ^= x10; x6 = x6 << 7 | x6 >>> 25;
        x3 = x3 + x7 | 0; x15 ^= x3; x15 = x15 << 16 | x15 >>> 16; x11 = x11 + x15 | 0; x7 ^= x11; x7 = x7 << 12 | x7 >>> 20;
        x3 = x3 + x7 | 0; x15 ^= x3; x15 = x15 << 8 | x15 >>> 24; x11 = x11 + x15 | 0; x7 ^= x11; x7 = x7 << 7 | x7 >>> 25;
        x0 = x0 + x5 | 0; x15 ^= x0; x15 = x15 << 16 | x15 >>> 16; x10 = x10 + x15 | 0; x5 ^= x10; x5 = x5 << 12 | x5 >>> 20;
        x0 = x0 + x5 | 0; x15 ^= x0; x15 = x15 << 8 | x15 >>> 24; x10 = x10 + x15 | 0; x5 ^= x10; x5 = x5 << 7 | x5 >>> 25;
        x1 = x1 + x6 | 0; x12 ^= x1; x12 = x12 << 16 | x12 >>> 16; x11 = x11 + x12 | 0; x6 ^= x11; x6 = x6 << 12 | x6 >>> 20;
        x1 = x1 + x6 | 0; x12 ^= x1; x12 = x12 << 8 | x12 >>> 24; x11 = x11 + x12 | 0; x6 ^= x11; x6 = x6 << 7 | x6 >>> 25;
        x2 = x2 + x7 | 0; x13 ^= x2; x13 = x13 << 16 | x13 >>> 16; x8 = x8 + x13 | 0; x7 ^= x8; x7 = x7 << 12 | x7 >>> 20;
        x2 = x2 + x7 | 0; x13 ^= x2; x13 = x13 << 8 | x13 >>> 24; x8 = x8 + x13 | 0; x7 ^= x8; x7 = x7 << 7 | x7 >>> 25;
        x3 = x3 + x4 | 0; x14 ^= x3; x14 = x14 << 16 | x14 >>> 16; x9 = x9 + x14 | 0; x4 ^= x9; x4 = x4 << 12 | x4 >>> 20;
        x3 = x3 + x4 | 0; x14 ^= x3; x14 = x14 << 8 | x14 >>> 24; x9 = x9 + x14 | 0; x4 ^= x9; x4 = x4 << 7 | x4 >>> 25;
      }
      block[0] = x0 + SIGMA[0]; block[1] = x1 + SIGMA[1]; block[2] = x2 + SIGMA[2]; block[3] = x3 + SIGMA[3];
      block[4] = x4 + k[0]; block[5] = x5 + k[1]; block[6] = x6 + k[2]; block[7] = x7 + k[3];
      block[8] = x8 + k[4]; block[9] = x9 + k[5]; block[10] = x10 + k[6]; block[11] = x11 + k[7];
      block[12] = x12 + c; block[13] = x13 + n[0]; block[14] = x14 + n[1]; block[15] = x15 + n[2];
      const end = Math.min(64, data.length - offset);
      for (let i = 0; i < end; i++) out[offset + i] = data[offset + i] ^ bytes[i];
    }
    return out;
  }
  // Each page has its own nonce: the first word plus page number + 1 (-1 = book data).
  function pageNonce(nonce, index) {
    const copy = new Uint8Array(12); copy.set(nonce);
    const view = new DataView(copy.buffer);
    view.setUint32(0, (view.getUint32(0, true) + index + 1) >>> 0, true);
    return copy;
  }
  function fromBase64(text) {
    const raw = atob(text), out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function toBase64(bytes) {
    let raw = '';
    for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(raw);
  }
  const utf8 = text => new TextEncoder().encode(text);

  // Editor side: book data + page JPEG bytes → payload JSON.
  function seal(data, pages, onProgress) {
    const key = new Uint8Array(32), nonce = new Uint8Array(12);
    root.crypto.getRandomValues(key); root.crypto.getRandomValues(nonce);
    const p = [];
    pages.forEach((page, i) => {
      p.push(toBase64(chacha20(key, pageNonce(nonce, i), page)));
      if (onProgress) onProgress((i + 1) / pages.length);
    });
    return JSON.stringify({v: 1, k: toBase64(key), n: toBase64(nonce),
      d: toBase64(chacha20(key, pageNonce(nonce, -1), utf8(JSON.stringify(data)))), p: p});
  }
  // Same, yielding between pages so a progress bar can move.
  async function sealAsync(data, pages, onProgress) {
    const key = new Uint8Array(32), nonce = new Uint8Array(12);
    root.crypto.getRandomValues(key); root.crypto.getRandomValues(nonce);
    const p = [];
    for (let i = 0; i < pages.length; i++) {
      p.push(toBase64(chacha20(key, pageNonce(nonce, i), pages[i])));
      if (onProgress) onProgress((i + 1) / pages.length);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return JSON.stringify({v: 1, k: toBase64(key), n: toBase64(nonce),
      d: toBase64(chacha20(key, pageNonce(nonce, -1), utf8(JSON.stringify(data)))), p: p});
  }
  // The one-file book, from the reader's index.html template.
  function singleHtml(template, styles, scripts, payload, title) {
    let html = template.replace(/<link rel="stylesheet" href="[^"]+">\s*/g, '').replace(/<script defer src="[^"]+"><\/script>/g, '');
    html = html.replace(/\x3c!-- Shown only when viewer.css is missing[\s\S]*?<\/div>\s*/, '');
    html = html.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/,
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; media-src data: blob:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; font-src data:">');
    const safeTitle = String(title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/<title>[\s\S]*?<\/title>/, () => '<title>' + safeTitle + '</title>');
    html = html.replace('</head>', () => '<style>\n' + styles.join('\n').replace(/<\/style/g, '<\\/style') + '\n</style>\n</head>');
    // Written as '<\/script' / '\x3c!--' because this file is itself inlined
    // into the book: in a script element a closing script tag ends it early
    // and an HTML comment opener can make the parser skip the closing tag.
    scripts.forEach(code => { if (code.indexOf('<\/script') >= 0 || code.indexOf('\x3c!--') >= 0) throw Error('Reader script cannot be inlined.'); });
    const body = '<script type="application/json" id="book-payload">' + payload + '<\/script>\n'
      + scripts.map(code => '<script>\n' + code + '\n<\/script>\n').join('');
    return html.replace('</body>', () => body + '</body>');
  }
  // Reader side: decrypt the book data now and the pages in the background.
  // FLIPBOOK_PAGE_URL(index, callback) calls back with a blob: URL.
  function open() {
    const el = document.getElementById('book-payload');
    if (!el) return false;
    const p = JSON.parse(el.textContent);
    el.textContent = '';
    const key = fromBase64(p.k), nonce = fromBase64(p.n);
    root.FLIPBOOK_DATA = JSON.parse(new TextDecoder().decode(chacha20(key, pageNonce(nonce, -1), fromBase64(p.d))));
    const urls = [], waiting = {};
    function decrypt(i) {
      if (!urls[i]) {
        const bytes = chacha20(key, pageNonce(nonce, i), fromBase64(p.p[i]));
        p.p[i] = null;
        urls[i] = URL.createObjectURL(new Blob([bytes], {type: 'image/jpeg'}));
        (waiting[i] || []).forEach(callback => callback(urls[i]));
        delete waiting[i];
      }
      return urls[i];
    }
    root.FLIPBOOK_PAGE_URL = function (index, callback) {
      if (urls[index]) callback(urls[index]);
      else if (index < 4) callback(decrypt(index));   // the first spread at once
      else (waiting[index] = waiting[index] || []).push(callback);
    };
    let next = 0;
    (function work() {
      const started = Date.now();
      while (next < p.p.length && Date.now() - started < 30) decrypt(next++);
      if (next < p.p.length) setTimeout(work, 0);
    })();
    return true;
  }
  root.BookSeal = {chacha20, pageNonce, fromBase64, toBase64, seal, sealAsync, singleHtml, open};
})(typeof self !== 'undefined' ? self : global);
