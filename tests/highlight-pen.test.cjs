// ✏ Marker in the highlighter bar: free drawing on the page in the chosen
// ink, kept per book (survives a reload), a tap makes a dot, the eraser
// removes the strokes it touches, and bad stored data is ignored.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><button id="hl"></button></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
require('../assets/export/layout.js');
const H = global.FlipbookHighlights;
const pages = [0, 1].map(() => { const p = w.document.createElement('article'); w.document.body.appendChild(p); p.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000 }); return p; });
const key = H.key('Pen', 2, 0.7);
const fire = (target, type, x, y) => target.dispatchEvent(new w.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
const stroke = (page, pts) => { fire(pages[page], 'mousedown', ...pts[0]); pts.slice(1).forEach(p => fire(w, 'mousemove', ...p)); w.dispatchEvent(new w.MouseEvent('mouseup', { clientX: pts[pts.length - 1][0], clientY: pts[pts.length - 1][1] })); };
const $ = s => w.document.querySelector(s);

let hl = H.bind({ key, pages, words: {}, text: {}, button: w.document.getElementById('hl') });
$('#hl').click();
const pen = $('.book-hl-pen');
assert.ok(pen, 'Marker tool in the bar');
pen.click();
assert.equal(pen.getAttribute('aria-pressed'), 'true');
assert.equal($('.book-hl-brush').getAttribute('aria-pressed'), 'false');
assert.match($('.book-hl-hint').textContent, /marker/i);

// A stroke in blue: stored in page units and drawn as an SVG path.
$('.book-hl-swatch[title="Blue"]').click();
stroke(0, [[100, 100], [200, 150], [300, 120], [400, 200]]);
let ink = hl.ink();
assert.equal(ink['0'].length, 1); assert.equal(ink['0'][0].c, 'b');
assert.deepEqual(ink['0'][0].p.slice(0, 4), [0.1, 0.1, 0.2, 0.15]);
const path = pages[0].querySelector('.book-ink-layer path');
assert.ok(path && /^M0\.1 0\.1/.test(path.getAttribute('d')), 'drawn on the page');
assert.equal(path.getAttribute('stroke'), H.INK.b);
assert.equal(pages[0].querySelector('.book-ink-live'), null, 'live stroke cleared');
// A tap: a dot. No highlight and no note is made by the marker.
stroke(1, [[500, 500]]);
assert.equal(hl.ink()['1'].length, 1); assert.deepEqual(hl.store(), {});

// Kept for the book: a new binding finds the drawings again.
hl.close();
hl = H.bind({ key, pages, words: {}, text: {}, button: w.document.getElementById('hl') });
assert.equal(hl.ink()['0'].length, 1);
assert.ok(pages[0].querySelector('.book-ink-layer path'));

// Eraser over the stroke removes it (and its layer).
$('#hl').click(); $('.book-hl-eraser').click();
stroke(0, [[180, 130], [230, 170]]);
assert.equal(hl.ink()['0'], undefined, 'erased');
assert.equal(pages[0].querySelector('.book-ink-layer'), null);
assert.equal(hl.ink()['1'].length, 1, 'other page untouched');

// Bad stored data is dropped.
localStorage.setItem('bad:ink', JSON.stringify({ '0': [{ c: 'b', p: [0.1, 0.2, 5, 0.3] }, { c: 'x', p: [0, 0, 1, 1] }, { c: 'g', p: [0, 0, 0.5, 0.5] }], 'z': [] }));
assert.deepEqual(H.loadInk('bad:ink'), { '0': [{ c: 'g', p: [0, 0, 0.5, 0.5] }] });
console.log('PASS highlight-pen: marker tool, coloured strokes as SVG, tap = dot, kept per book, eraser removes strokes, bad data dropped');
