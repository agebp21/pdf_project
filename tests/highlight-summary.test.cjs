// ✨ Summarize in the highlighter: a new highlight makes a note that says
// "Summarizing…" and then the AI summary; the note stays linked to its
// highlight (erase one → the other goes, recolour follows), a failure keeps
// the quote and says why, and the tool only shows where summaries can be made.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><button id="hl"></button><button id="notes"></button></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
require('../assets/export/layout.js');
const H = global.FlipbookHighlights, N = global.FlipbookNotes;
const tick = () => new Promise(r => setTimeout(r, 0));

const raw = [[1000, 300, 1000, 1000, 2200, 800, 3200, 900], [1400, 300, 1000, 1200, 2400, 700, 3300, 1100]];
const text = ['Satu langkah seribu', 'makna untuk semua'];
const pages = [0, 1].map(() => { const p = w.document.createElement('article'); w.document.body.appendChild(p); p.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000 }); return p; });
let reply = null; const asked = [];
const summarize = said => { asked.push(said); return new Promise((ok, fail) => { reply = {ok, fail}; }); };
const notes = N.bind({ key: N.key('Ringkas', 2, 0.7), title: 'Ringkas', pages, goPage: () => {}, open: w.document.getElementById('notes'), blank: false,
  onRemove: (i, s) => hl.forget(i, s) });
const hl = H.bind({ key: H.key('Ringkas', 2, 0.7), pages, words: { '0': raw }, text: { '0': text }, button: w.document.getElementById('hl'),
  onQuote: (i, s, c) => notes.quote(i, s, c), onUnquote: (i, s) => notes.unquote(i, s), onRecolor: (i, s, c) => notes.tint(i, s, c),
  summarize: true, onSummary: (i, s, c) => notes.summary(i, s, c, summarize) });
const fire = (target, type, x, y) => target.dispatchEvent(new w.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
const drag = (page, x0, y0, x1, y1) => { fire(pages[page], 'mousedown', x0, y0); fire(w, 'mousemove', x1, y1); w.dispatchEvent(new w.MouseEvent('mouseup', { clientX: x1, clientY: y1 })); };
const items = i => (notes.notes()[i] || { items: [] }).items;
const $ = s => w.document.querySelector(s);

(async () => {
  $('#hl').click();
  const tool = $('.book-hl-summary');
  assert.ok(tool, 'Summarize tool next to the highlighter and eraser');
  assert.equal(tool.getAttribute('aria-pressed'), 'false');
  tool.click();
  assert.equal(tool.getAttribute('aria-pressed'), 'true');
  assert.equal($('.book-hl-brush').getAttribute('aria-pressed'), 'false');
  assert.match($('.book-hl-hint').textContent, /short summary/);

  // Highlight → "Summarizing…" at once, then the summary; the quote stays hidden in the note.
  drag(0, 250, 110, 390, 115); await tick();
  assert.deepEqual(asked, ['langkah seribu']);
  assert.deepEqual(items(0).map(n => [n.text, n.q]), [[N.SUMMARIZING, 'langkah seribu']]);
  reply.ok('Satu langkah kecil punya banyak arti.'); await tick(); await tick();
  assert.deepEqual(items(0).map(n => [n.text, n.q, n.color]), [['✨ Satu langkah kecil punya banyak arti.', 'langkah seribu', H.COLORS.y]]);
  // Highlighting it again doesn't ask twice.
  drag(0, 330, 110, 380, 112);
  assert.equal(asked.length, 1);

  // Recolouring the highlight recolours the summary note.
  $('#hl').click(); $('#hl').click();                      // fresh mode (summary off), then select it
  fire(pages[0], 'mousedown', 300, 112); w.dispatchEvent(new w.MouseEvent('mouseup'));
  $('.book-hl-swatch[title="Green"]').click();
  assert.equal(items(0)[0].color, H.COLORS.g, 'summary note follows the highlight colour');
  assert.equal(items(0)[0].text, '✨ Satu langkah kecil punya banyak arti.', 'still the summary');

  // Erasing the highlight removes its summary note.
  $('.book-hl-eraser').click(); drag(0, 250, 105, 400, 118);
  assert.deepEqual(items(0), [], 'erased highlight → summary note gone');

  // Deleting the summary note removes its highlight.
  $('.book-hl-summary').click();
  drag(0, 250, 110, 390, 115); await tick();
  reply.ok('- Satu\n- Dua'); await tick(); await tick();
  assert.equal(items(0)[0].text, '✨ Summary\n• Satu\n• Dua', 'a list summary reads as a list');
  assert.equal(hl.store()['0'].length, 1);
  pages[0].querySelector('.book-note-tab.has-note').click();
  $('.book-note-card .book-note-done').click();
  $('.book-note-editor .book-note-delete').click();
  assert.equal(hl.store()['0'], undefined, 'deleted summary note → highlight gone');

  // Failure: the note falls back to the quote and the bar says why.
  drag(0, 250, 150, 400, 152); await tick();
  reply.fail(new Error('Layanan AI tidak bisa dihubungi.')); await tick(); await tick(); await tick();
  assert.deepEqual(items(0).map(n => n.text), ['“untuk semua”'], 'kept the quote');
  assert.match($('.book-hl-hint').textContent, /Summary failed: Layanan AI tidak bisa dihubungi/);

  // A note left at "Summarizing…" (book closed meanwhile) comes back as the quote.
  localStorage.setItem('x-notes', JSON.stringify({ '0': { items: [{ text: N.SUMMARIZING, q: 'satu dua', updated: 1 }] } }));
  assert.deepEqual(N.load('x-notes')['0'].items.map(n => [n.text, n.q]), [['“satu dua”', 'satu dua']]);

  // Edited while waiting: the summary doesn't overwrite the reader's text.
  drag(0, 110, 110, 200, 112); await tick();
  const id = items(0).findIndex(n => n.text === N.SUMMARIZING);
  pages[0].querySelectorAll('.book-note-tab.has-note')[id].click();
  $('.book-note-card .book-note-done').click();
  $('.book-note-editor textarea').value = 'tulisanku sendiri';
  $('.book-note-editor .book-note-done').click();
  reply.ok('telat'); await tick(); await tick();
  assert.ok(items(0).some(n => n.text === 'tulisanku sendiri'), "reader's edit kept");
  assert.ok(!items(0).some(n => n.text === '✨ telat'));

  // Without a summarizer (offline book) there is no Summarize tool.
  const other = new JSDOM('<!doctype html><body><button id="hl"></button></body>', { url: 'http://localhost/' }).window;
  global.window = other; global.document = other.document; global.localStorage = other.localStorage;
  H.bind({ key: 'k', pages: [], button: other.document.getElementById('hl') });
  assert.equal(other.document.querySelector('.book-hl-summary'), null, 'no tool without a summarizer');
  console.log('PASS highlight-summary: Summarize tool, Summarizing… → AI summary note linked to its highlight (recolour, erase, delete), failure keeps the quote + message, stale pending note restored, reader edits win, hidden offline');
})().catch(error => { console.error(error); process.exit(1); });
