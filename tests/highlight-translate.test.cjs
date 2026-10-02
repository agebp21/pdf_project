// 🌐 Translate in the highlighter: only the highlighted text is translated
// (AI) into a note linked to its highlight; "Translating…" meanwhile, a
// failure keeps the quote and says why, the tool is exclusive with Summarize,
// and it only shows where translations can be made.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><button id="hl"></button><button id="notes"></button></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
require('../assets/export/layout.js');
const H = global.FlipbookHighlights, N = global.FlipbookNotes;
const tick = () => new Promise(r => setTimeout(r, 0));

const raw = [[1000, 300, 1000, 1000, 2200, 800, 3200, 900], [1400, 300, 1000, 1200, 2400, 700, 3300, 1100]];
const text = ['One small step', 'for all of us'];
const pages = [0].map(() => { const p = w.document.createElement('article'); w.document.body.appendChild(p); p.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000 }); return p; });
let reply = null; const asked = [];
const translate = said => { asked.push(said); return new Promise((ok, fail) => { reply = {ok, fail}; }); };
const notes = N.bind({ key: N.key('Tr', 1, 0.7), title: 'Tr', pages, goPage: () => {}, open: w.document.getElementById('notes'), blank: false,
  onRemove: (i, s) => hl.forget(i, s) });
const hl = H.bind({ key: H.key('Tr', 1, 0.7), pages, words: { '0': raw }, text: { '0': text }, button: w.document.getElementById('hl'),
  onQuote: (i, s, c) => notes.quote(i, s, c), onUnquote: (i, s) => notes.unquote(i, s), onRecolor: (i, s, c) => notes.tint(i, s, c),
  summarize: true, onSummary: () => Promise.resolve('x'),
  translate: true, onTranslate: (i, s, c) => notes.translation(i, s, c, translate) });
const fire = (target, type, x, y) => target.dispatchEvent(new w.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
const drag = (x0, y0, x1, y1) => { fire(pages[0], 'mousedown', x0, y0); fire(w, 'mousemove', x1, y1); w.dispatchEvent(new w.MouseEvent('mouseup', { clientX: x1, clientY: y1 })); };
const items = () => (notes.notes()[0] || { items: [] }).items;
const $ = s => w.document.querySelector(s);

(async () => {
  $('#hl').click();
  const tool = $('.book-hl-translate');
  assert.ok(tool, 'Translate tool in the highlighter bar');
  $('.book-hl-summary').click(); tool.click();
  assert.equal(tool.getAttribute('aria-pressed'), 'true');
  assert.equal($('.book-hl-summary').getAttribute('aria-pressed'), 'false', 'one AI tool at a time');
  assert.match($('.book-hl-hint').textContent, /translation/);

  // Only the highlighted words are sent; the note shows "Translating…", then the translation.
  drag(250, 110, 390, 115); await tick();
  assert.deepEqual(asked, ['small step']);
  assert.deepEqual(items().map(n => [n.text, n.q]), [[N.TRANSLATING, 'small step']]);
  reply.ok('langkah kecil'); await tick(); await tick();
  assert.deepEqual(items().map(n => [n.text, n.q]), [['🌐 langkah kecil', 'small step']]);

  // Failure: the quote stays and the bar says why.
  drag(250, 150, 400, 152); await tick();
  reply.fail(new Error('Budget habis.')); await tick(); await tick(); await tick();
  assert.match(items()[1].text, /^“all of/, 'kept the quote');
  assert.match($('.book-hl-hint').textContent, /Translation failed: Budget habis/);

  // A note left at "Translating…" comes back as the quote.
  localStorage.setItem('y-notes', JSON.stringify({ '0': { items: [{ text: N.TRANSLATING, q: 'satu', updated: 1 }] } }));
  assert.equal(N.load('y-notes')['0'].items[0].text, '“satu”');

  // Without a translator (offline book) there is no Translate tool.
  const other = new JSDOM('<!doctype html><body><button id="hl"></button></body>', { url: 'http://localhost/' }).window;
  global.window = other; global.document = other.document; global.localStorage = other.localStorage;
  H.bind({ key: 'k', pages: [], button: other.document.getElementById('hl') });
  assert.equal(other.document.querySelector('.book-hl-translate'), null);
  console.log('PASS highlight-translate: Translate tool, only the highlighted text, Translating… → translation note, failure keeps the quote, stale pending restored, hidden offline');
})().catch(error => { console.error(error); process.exit(1); });
