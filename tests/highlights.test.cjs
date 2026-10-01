// Highlighter: word snapping line by line, columns kept apart, free boxes on
// scans, drag/tap/recolour/delete, storage, and pages turning normally when
// the highlighter is off.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><button id="hl"></button></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
require('../assets/export/layout.js');
const H = global.FlipbookHighlights;

// Two lines of three words, plus a word far right (another column) on line 1.
const raw = [[1000, 300, 1000, 1000, 2200, 800, 3200, 900, 7000, 1000], [1400, 300, 1000, 1200, 2400, 700, 3300, 1100]];
const lines = H.lines(raw);
assert.equal(lines.length, 2); assert.equal(lines[0].words.length, 4);
// From the 2nd word of line 1 to the 2nd word of line 2: rest of line 1 + start of line 2;
// the word in the column beside it (same line) stays out.
const rects = H.select(lines, { x: 0.25, y: 0.11 }, { x: 0.27, y: 0.15 });
assert.deepEqual(rects, [[0.22, 0.1, 0.19, 0.03], [0.1, 0.14, 0.21, 0.03]]);
// Two columns whose lines sit between each other (left paragraph, right
// heading + quote): a drag down the left column takes only the left column.
{
  const raw = [
    [1000, 250, 500, 1500, 2100, 1400, 3600, 900],   // left 1
    [1100, 300, 6000, 1200, 7300, 900],                // right "klinik mata"
    [1300, 250, 500, 1600, 2200, 1300, 3600, 900],    // left 2
    [1450, 300, 6000, 1500, 7600, 800],                // right "kesehatan mata."
    [1600, 250, 500, 1400, 2000, 1500, 3600, 900],    // left 3
    [1750, 200, 6000, 2400],                           // right "Lorem ipsum"
    [1900, 250, 500, 1200, 1800, 1100],                // left 4 (short last line)
  ];
  const text = ['Ruang Kosong Minimum', 'klinik mata', 'pedoman minimum dan', 'kesehatan mata.', 'kosong di sekitar', 'Lorem', 'Menempatkan logo'];
  const lines = H.lines(raw, text);
  const left = H.select(lines, { x: 0.06, y: 0.11 }, { x: 0.27, y: 0.2 });
  assert.equal(H.quote(lines, left), 'Ruang Kosong Minimum pedoman minimum dan kosong di sekitar Menempatkan logo', 'left column only');
  assert.ok(left.every(q => q[0] < 0.5), 'no rectangle in the right column');
  // Ending the drag level with a right-column line but over the left column still ends in the left column.
  assert.equal(H.quote(lines, H.select(lines, { x: 0.06, y: 0.11 }, { x: 0.4, y: 0.155 })), 'Ruang Kosong Minimum pedoman minimum dan');
  // The right column on its own.
  assert.equal(H.quote(lines, H.select(lines, { x: 0.61, y: 0.12 }, { x: 0.8, y: 0.16 })), 'klinik mata kesehatan mata.');
  // A drag from one column into the other takes both (the reader asked for it).
  const both = H.quote(lines, H.select(lines, { x: 0.06, y: 0.11 }, { x: 0.8, y: 0.16 }));
  assert.ok(/Ruang/.test(both) && /kesehatan/.test(both));
}
// Dragging backwards gives the same highlight.
assert.deepEqual(H.select(lines, { x: 0.27, y: 0.15 }, { x: 0.25, y: 0.11 }), rects);
// Starting in the margin (no text): null → a free box instead.
assert.equal(H.select(lines, { x: 0.02, y: 0.6 }, { x: 0.3, y: 0.7 }), null);
assert.deepEqual(H.box({ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.25 }), [[0.1, 0.2, 0.2, 0.05]]);
assert.equal(H.box({ x: 0.1, y: 0.2 }, { x: 0.101, y: 0.2 }), null, 'a tap is not a box');

// Bound to pages: drag, tap to select, recolour, delete.
const pages = [0, 1].map(() => { const p = w.document.createElement('article'); w.document.body.appendChild(p); p.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000 }); return p; });
const key = H.key('Laporan', 2, 0.7);
const button = w.document.getElementById('hl');
let hl = H.bind({ key, pages, words: { '0': raw }, button });
const fire = (target, type, x, y) => target.dispatchEvent(new w.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
let pageFlipSaw = 0;
w.document.body.addEventListener('mousedown', () => { pageFlipSaw++; });   // stands in for PageFlip's listener
fire(pages[0], 'mousedown', 250, 110);
assert.equal(pageFlipSaw, 1, 'highlighter off: the page turns as usual');
w.dispatchEvent(new w.MouseEvent('mouseup'));

button.click();
assert.equal(button.getAttribute('aria-pressed'), 'true'); assert.ok(w.document.body.classList.contains('is-highlighting'));
assert.equal(w.document.querySelector('.book-hl-bar').hidden, false);
fire(pages[0], 'mousedown', 250, 110);
assert.equal(pageFlipSaw, 1, 'highlighter on: PageFlip never sees the press');
fire(w, 'mousemove', 270, 150); w.dispatchEvent(new w.MouseEvent('mouseup', { clientX: 270, clientY: 150 }));
let saved = hl.store();
assert.equal(saved['0'].length, 1); assert.equal(saved['0'][0].c, 'y'); assert.deepEqual(saved['0'][0].r, rects);
assert.equal(pages[0].querySelectorAll('.book-highlights .book-hl').length, 2, 'drawn on the page (the column beside it stays out)');
assert.deepEqual(Object.keys(JSON.parse(localStorage.getItem(key))), ['0'], 'kept on this device');

// A free box on the page without text.
fire(pages[1], 'mousedown', 100, 100); fire(w, 'mousemove', 400, 300); w.dispatchEvent(new w.MouseEvent('mouseup'));
assert.deepEqual(hl.store()['1'][0].r, [[0.1, 0.1, 0.3, 0.2]]);

// Tap the first highlight, recolour it green, then delete it.
fire(pages[0], 'mousedown', 300, 115); w.dispatchEvent(new w.MouseEvent('mouseup'));
assert.equal(pages[0].querySelectorAll('.book-hl.is-selected').length, 2, 'tap selects the whole highlight');
w.document.querySelector('.book-hl-swatch[title="Green"]').click();
assert.equal(hl.store()['0'][0].c, 'g');
w.document.querySelector('.book-hl-delete').click();
assert.equal(hl.store()['0'], undefined);
assert.equal(pages[0].querySelectorAll('.book-hl').length, 0);

// Escape leaves highlighter mode; rebinding keeps highlights and doesn't stack handlers.
w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
assert.ok(!hl.active()); assert.ok(!w.document.body.classList.contains('is-highlighting'));
hl.close(); hl = H.bind({ key, pages, words: { '0': raw }, button });
assert.equal(w.document.querySelectorAll('.book-hl-bar').length, 1);
assert.equal(pages[1].querySelectorAll('.book-hl').length, 1, 'the box is drawn again after reopening');
// Highlighting over an existing highlight merges instead of stacking (and recolours it).
const line = [0.1, 0.1, 0.3, 0.03];
let list = H.add([], [line], 'y');
list = H.add(list, [[0.3, 0.1, 0.3, 0.03]], 'g');
assert.equal(list.length, 1, 'one highlight, not two on top of each other');
assert.deepEqual(list[0], { c: 'g', r: [[0.1, 0.1, 0.5, 0.03]] }, 'joined into one strip in the new colour');
list = H.add(list, [[0.1, 0.2, 0.2, 0.03]], 'p');
assert.equal(list.length, 2, 'a separate line stays a separate highlight');
assert.equal(H.overlap([0, 0.1, 0.5, 0.03], [0, 0.128, 0.5, 0.03]) < 0.25, true, 'neighbouring lines that barely touch are not merged');
// The eraser removes what it touches; a tap removes one highlight.
assert.deepEqual(H.erase(list, [0.15, 0.09, 0.05, 0.02]).map(h => h.c), ['p']);
assert.deepEqual(H.erase(list, [0.15, 0.21, 0, 0]).map(h => h.c), ['g']);
assert.equal(H.erase(list, [0.9, 0.9, 0, 0]).length, 2);

// Through the UI: drag twice over the same words → still one highlight; eraser removes it.
hl.setMode(true);
const dragOn = (x1, y1, x2, y2) => { fire(pages[0], 'mousedown', x1, y1); fire(w, 'mousemove', x2, y2); w.dispatchEvent(new w.MouseEvent('mouseup', { clientX: x2, clientY: y2 })); };
dragOn(110, 115, 390, 115); dragOn(110, 115, 390, 115);
assert.equal(hl.store()['0'].length, 1, 'no double highlight');
w.document.querySelector('.book-hl-eraser').click();
assert.ok(w.document.body.classList.contains('is-erasing'));
dragOn(150, 100, 200, 130);
assert.equal(hl.store()['0'], undefined, 'erased');
w.document.querySelector('.book-hl-swatch[title="Yellow"]').click();
assert.ok(!w.document.body.classList.contains('is-erasing'), 'picking a colour leaves the eraser');
hl.setMode(false);

localStorage.setItem(key, JSON.stringify({ '0': [{ c: 'zz', r: [[0, 0, 1, 1]] }], '1': [{ c: 'y', r: [[0, 0, 2, 1]] }], x: [] }));
assert.deepEqual(H.load(key), {}, 'bad colours, out-of-page boxes and keys are dropped');
console.log('PASS highlights: word snapping, column gaps, free boxes, drag/tap/recolour/delete, no stacking, eraser, PageFlip untouched, storage, rebind');
