// Sealed one-file books: ChaCha20 matches RFC 8439, a sealed book opens in
// the reader, and books sealed by the server (book_seal.py) open too.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document;
global.self = global;
require('../assets/export/book-seal.js');
const S = global.BookSeal;
const hex = bytes => Buffer.from(bytes).toString('hex');

// RFC 8439 §2.4.2.
const key = Uint8Array.from({ length: 32 }, (_, i) => i), nonce = Uint8Array.from(Buffer.from('000000000000004a00000000', 'hex'));
const plain = new TextEncoder().encode("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.");
const cipher = S.chacha20(key, nonce, plain, 1);
assert.equal(hex(cipher).slice(0, 32), '6e2e359a2568f98041ba0728dd0d6981');
assert.deepEqual(S.chacha20(key, nonce, cipher, 1), plain, 'encrypt = decrypt');

// Open a payload the way the reader does, with a stand-in for blob URLs.
function openInReader(payload) {
  const d = new JSDOM('<!doctype html><body><script type="application/json" id="book-payload"></script></body>', { url: 'http://localhost/' });
  d.window.document.getElementById('book-payload').textContent = payload;
  const blobs = [];
  const win = { document: d.window.document, crypto: global.crypto };
  global.document = d.window.document;
  global.URL.createObjectURL = blob => { blobs.push(blob); return 'blob:' + blobs.length; };
  const saved = { data: global.FLIPBOOK_DATA, page: global.FLIPBOOK_PAGE_URL };
  S.open.call(win);
  const out = { data: global.FLIPBOOK_DATA, page: global.FLIPBOOK_PAGE_URL, blobs, emptied: d.window.document.getElementById('book-payload').textContent === '' };
  global.FLIPBOOK_DATA = saved.data; global.FLIPBOOK_PAGE_URL = saved.page;
  return out;
}

(async () => {
  const pages = [Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]), Uint8Array.from([0xff, 0xd8, 0xff, 9, 9])];
  const data = { version: 1, title: 'Buku Rahasia', pageCount: 2 };
  const payload = S.seal(data, pages);
  assert.ok(!payload.includes('Rahasia'), 'the title is not readable in the file');
  const opened = openInReader(payload);
  assert.deepEqual(opened.data, data);
  assert.ok(opened.emptied, 'the encrypted text is dropped from the page once read');
  let url0 = null; opened.page(0, url => { url0 = url; });
  assert.ok(url0, 'the first pages are ready at once');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(opened.blobs.length, 2, 'the rest decrypt in the background');
  assert.deepEqual(new Uint8Array(await opened.blobs[1].arrayBuffer()), pages[1]);
  assert.equal(opened.blobs[0].type, 'image/jpeg');
  // Async sealing (editor) gives an equivalent book.
  const asyncOpened = openInReader(await S.sealAsync(data, pages, () => {}));
  assert.deepEqual(asyncOpened.data, data);

  // Server-sealed (Python) books open in the reader.
  const script = "import sys,json; sys.path.insert(0, r'" + path.resolve(__dirname, '..') + "'); import book_seal; "
    + "print(book_seal.seal_payload({'version':1,'title':'Dari Server','pageCount':1}, [bytes([255,216,255,7,7,7])]))";
  const fromServer = execFileSync('python', ['-c', script]).toString().trim();
  const server = openInReader(fromServer);
  assert.equal(server.data.title, 'Dari Server');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual([...new Uint8Array(await server.blobs[0].arrayBuffer())], [255, 216, 255, 7, 7, 7]);

  // The one-file HTML: stylesheets/scripts inlined, payload embedded, title escaped.
  const template = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="x"><title>Flipbook</title><link rel="stylesheet" href="viewer.css">\n<script defer src="viewer.js"></script></head><body>\n<!-- Shown only when viewer.css is missing (x). -->\n<div id="extract-help">zip</div>\n<main></main></body></html>';
  const html = S.singleHtml(template, ['body{color:red}'], ['var a=1;', 'var b=2;'], '{"v":1}', 'A <b> & C');
  assert.ok(!/href="viewer.css"|src="viewer.js"|extract-help/.test(html));
  assert.match(html, /<title>A &lt;b&gt; &amp; C<\/title>/);
  assert.match(html, /<style>\nbody\{color:red\}\n<\/style>/);
  assert.match(html, /<script type="application\/json" id="book-payload">\{"v":1\}<\/script>\n<script>\nvar a=1;\n<\/script>\n<script>\nvar b=2;\n<\/script>\n<\/body>/);
  assert.throws(() => S.singleHtml(template, [], ['x="</script>"'], '{}', 't'), /cannot be inlined/);
  console.log('PASS book-seal: ChaCha20 (RFC 8439), seal/open round trip, background page decryption, server-sealed books open, one-file HTML');
})().catch(error => { console.error(error); process.exitCode = 1; });
