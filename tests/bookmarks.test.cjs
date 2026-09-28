// Reader bookmarks: ribbons, list, jumping, removal, persistence per book.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><button id="mark"></button><button id="list"></button></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
require('../assets/export/layout.js');
const B = global.FlipbookBookmarks;

const pages = Array.from({ length: 6 }, (_, i) => {
  const page = w.document.createElement('article'); const img = w.document.createElement('img');
  img.src = `blob:page-${i}`; page.appendChild(img); w.document.body.appendChild(page); return page;
});
let visible = [0], jumped = null;
const key = B.key('Laporan', 6, 0.707);
assert.equal(key, B.key('Laporan', 6, 0.707), 'same book, same key');
assert.notEqual(key, B.key('Laporan 2', 6, 0.707), 'different book, different key');
const bind = () => B.bind({ key, pages, visible: () => visible, goPage: i => { jumped = i; }, toggle: w.document.getElementById('mark'), open: w.document.getElementById('list') });
let marks = bind();
const mark = w.document.getElementById('mark'), list = w.document.getElementById('list');
assert.equal(mark.textContent, '🔖 Mark'); assert.equal(list.textContent, '☰ 0');

visible = [0]; mark.click();
assert.deepEqual(marks.marks(), [0], 'a single page is marked directly');
mark.click(); assert.deepEqual(marks.marks(), [], 'and unmarked again');
assert.equal(w.document.querySelector('.book-marks'), null, 'no picker for one page');

// A spread: Mark opens a left/right picker; either or both pages can be marked.
visible = [3, 4]; marks.refresh(); mark.click();
let picks = [...w.document.querySelectorAll('.book-mark-pick')];
assert.deepEqual(picks.map(p => p.querySelector('span').textContent), ['Left · Page 4', 'Right · Page 5']);
assert.equal(mark.getAttribute('aria-expanded'), 'true');
picks[1].click();
assert.deepEqual(marks.marks(), [4], 'right page of a spread can be marked');
picks = [...w.document.querySelectorAll('.book-mark-pick')];
assert.equal(picks[1].getAttribute('aria-pressed'), 'true', 'picker stays open and shows the state');
picks[0].click();
assert.deepEqual(marks.marks(), [3, 4], 'both pages of a spread');
w.document.querySelectorAll('.book-mark-pick')[1].click();
assert.deepEqual(marks.marks(), [3], 'unmark one side only');
assert.ok(pages[3].querySelector('.book-ribbon'), 'ribbon on the marked page');
assert.equal(pages[4].querySelector('.book-ribbon'), null);
assert.equal(mark.textContent, '🔖 Marked'); assert.equal(mark.getAttribute('aria-pressed'), 'true');
mark.click(); assert.equal(w.document.querySelector('.book-marks'), null, 'Mark again closes the picker');
visible = [1, 2]; marks.refresh(); mark.click(); w.document.querySelector('.book-mark-pick').click();
visible = [5]; marks.refresh();
assert.equal(w.document.querySelector('.book-marks'), null, 'picker closes when the spread becomes one page');
visible = [1, 2];
assert.deepEqual(marks.marks(), [1, 3]); assert.equal(list.textContent, '☰ 2');
assert.deepEqual(JSON.parse(localStorage.getItem(key)), [1, 3], 'saved on this device');

list.click();
const panel = w.document.querySelector('.book-marks');
assert.ok(panel, 'list opens'); assert.equal(list.getAttribute('aria-expanded'), 'true');
const rows = [...panel.querySelectorAll('.book-mark-go')];
assert.deepEqual(rows.map(r => r.textContent), ['Page 2', 'Page 4']);
assert.equal(rows[0].querySelector('img').src, 'blob:page-1', 'thumbnail of the page');
rows[1].click();
assert.equal(jumped, 3, 'jumps to the bookmarked page'); assert.equal(w.document.querySelector('.book-marks'), null, 'list closes');

list.click(); w.document.querySelector('.book-mark-remove').click();
assert.deepEqual(marks.marks(), [3], 'removed from the list');
assert.equal(pages[1].querySelector('.book-ribbon'), null, 'ribbon removed');
w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
assert.equal(w.document.querySelector('.book-marks'), null, 'Escape closes');

visible = [3, 4]; marks.refresh(); mark.click(); w.document.querySelector('.book-mark-pick').click();
assert.deepEqual(marks.marks(), [], 'pressing again on a marked page removes it');
w.document.querySelector('.book-mark-pick').click(); mark.click();
// Opening the same book again (preview rebinds buttons per PDF): no duplicate handlers.
marks = bind();
assert.deepEqual(marks.marks(), [3], 'bookmarks survive reopening the book');
visible = [5]; marks.refresh(); mark.click();
assert.deepEqual(marks.marks(), [3, 5], 'one click adds exactly one bookmark after rebinding');
list.click();
assert.equal(w.document.querySelectorAll('.book-marks').length, 1);
localStorage.setItem(key, 'not json');
assert.deepEqual(B.load(key), [], 'corrupt storage is ignored');
console.log('PASS bookmarks: ribbons, left/right picker on spreads, list jump/remove, Escape, persistence per book, rebind without duplicates');
