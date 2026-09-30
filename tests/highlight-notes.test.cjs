// Highlighting text makes a quoted note on the page edge: the words under
// the highlight, one note per highlight (a longer highlight replaces its
// quote), no note on pages without text, erased highlight → quote removed
// unless the reader wrote in it.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><button id="hl"></button><button id="notes"></button></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
require('../assets/export/layout.js');
const H = global.FlipbookHighlights, N = global.FlipbookNotes;

// Two lines of text on page 1 (positions in 1/10000, text words joined by spaces).
const raw = [[1000, 300, 1000, 1000, 2200, 800, 3200, 900], [1400, 300, 1000, 1200, 2400, 700, 3300, 1100]];
const text = ['Satu langkah seribu', 'makna untuk semua'];
const lines = H.lines(raw, text);
assert.deepEqual(lines[0].words.map(x => x.t), ['Satu', 'langkah', 'seribu']);
assert.equal(H.lines(raw)[0].words[0].t, undefined, 'no text: plain boxes');
assert.equal(H.quote(lines, H.select(lines, { x: 0.25, y: 0.11 }, { x: 0.27, y: 0.15 })), 'langkah seribu makna untuk');
assert.equal(H.quote(H.lines(raw), [[0, 0, 1, 1]]), '', 'no words known → no quote');

const pages = [0, 1].map(() => { const p = w.document.createElement('article'); w.document.body.appendChild(p); p.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000 }); return p; });
const notes = N.bind({ key: N.key('Buku', 2, 0.7), title: 'Buku', pages, goPage: () => {}, open: w.document.getElementById('notes') });
const hl = H.bind({ key: H.key('Buku', 2, 0.7), pages, words: { '0': raw }, text: { '0': text }, button: w.document.getElementById('hl'),
  onQuote: (i, s) => notes.quote(i, s), onUnquote: (i, s) => notes.unquote(i, s) });
const fire = (target, type, x, y) => target.dispatchEvent(new w.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
const drag = (page, x0, y0, x1, y1) => { fire(pages[page], 'mousedown', x0, y0); fire(w, 'mousemove', x1, y1); w.dispatchEvent(new w.MouseEvent('mouseup', { clientX: x1, clientY: y1 })); };
const texts = i => (notes.notes()[i] || { items: [] }).items.map(n => n.text);

w.document.getElementById('hl').click();
// "langkah seribu" → a quoted note, tab on the page edge, pulsing.
drag(0, 250, 110, 390, 115);
assert.deepEqual(texts(0), ['“langkah seribu”']);
assert.equal(pages[0].querySelectorAll('.book-note-tab.has-note').length, 1, 'tab on the page edge');
assert.ok(pages[0].querySelector('.book-note-tab.is-new'), 'the new tab is pointed out');
// Highlighting a word already quoted adds nothing.
drag(0, 330, 110, 380, 112);
assert.deepEqual(texts(0), ['“langkah seribu”']);
// Extending the highlight over two lines replaces the quote instead of adding one.
drag(0, 110, 110, 270, 150);
assert.deepEqual(texts(0), ['“Satu langkah seribu makna untuk”']);
// Page without text: highlight (free box) but no note.
drag(1, 100, 100, 400, 300);
assert.equal(hl.store()['1'].length, 1); assert.deepEqual(texts(1), []);
// A second, separate highlight → a second note.
w.document.querySelector('.book-hl-eraser').click();
drag(0, 110, 150, 115, 152);   // erase the whole two-line highlight
assert.equal(hl.store()['0'], undefined);
assert.deepEqual(texts(0), [], 'erasing the highlight removes its untouched quote');
w.document.querySelector('.book-hl-brush').click();
drag(0, 110, 110, 180, 112);   // "Satu"
drag(0, 250, 150, 400, 152);   // "untuk semua"
assert.deepEqual(texts(0), ['“Satu”', '“untuk semua”']);
// A quote the reader wrote in stays when its highlight is erased.
pages[0].querySelectorAll('.book-note-tab.has-note')[0].click();
w.document.querySelector('.book-note-card .book-note-done').click();   // ✎ Edit
const area = w.document.querySelector('.book-note-editor textarea');
area.value = '“Satu” — penting!'; w.document.querySelector('.book-note-editor .book-note-done').click();
w.document.querySelector('.book-hl-eraser').click();
drag(0, 110, 110, 115, 112);
assert.deepEqual(texts(0), ['“Satu” — penting!', '“untuk semua”']);
console.log('PASS highlight-notes: highlighted text becomes a quoted note, replaced when extended, none without text, removed with its highlight unless edited');
