// Magnifier: contained-image geometry, background layers, zoom levels,
// and the lens toggling from its button.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><button id="lp"></button></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
global.requestAnimationFrame = () => 1; global.cancelAnimationFrame = () => {};
require('../assets/export/layout.js');
const L = global.FlipbookLoupe;

// A portrait image in a square box sits centred horizontally.
assert.deepEqual(L.fit(500, 1000, { left: 0, top: 0, width: 400, height: 400 }), { left: 100, top: 0, width: 200, height: 400 });
assert.equal(L.fit(0, 10, { left: 0, top: 0, width: 4, height: 4 }), null);
// Lens radius 50 at (150, 100), 2x: the point under the centre lands in the lens centre.
const layer = L.layer({ left: 100, top: 0, width: 200, height: 400 }, 150, 100, 50, 2);
assert.equal(layer.size, '400.0px 800.0px');
assert.equal(layer.position, '-50.0px -150.0px');   // content (50,100) * 2 = (100,200); 50 - 100, 50 - 200
assert.equal(L.touches({ left: 0, top: 0, width: 100, height: 100 }, 140, 50, 50), true);
assert.equal(L.touches({ left: 0, top: 0, width: 100, height: 100 }, 151, 50, 50), false);
assert.equal(L.touches({ left: 0, top: 0, width: 0, height: 0 }, 0, 0, 50), false, 'hidden page');
assert.deepEqual([L.next(2), L.next(3), L.next(4), L.next(2.5), L.next(5)], [3, 4, 2, 3, 2]);

// Bound: the button toggles the lens; close removes it.
const page = w.document.createElement('article'); w.document.body.appendChild(page);
page.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 400 });
const button = w.document.getElementById('lp');
const loupe = L.bind({ pages: [page], button });
const lens = w.document.querySelector('.book-loupe');
assert.equal(button.textContent, '🔎'); assert.equal(lens.hidden, true); assert.equal(loupe.active(), false);
button.click();
assert.equal(loupe.active(), true); assert.equal(lens.hidden, false); assert.equal(button.getAttribute('aria-pressed'), 'true');
assert.equal(lens.style.left, (150 - parseInt(lens.style.width) / 2) + 'px', 'starts over the middle of the page');
assert.match(w.document.querySelector('.book-loupe-glass').style.backgroundImage, /linear-gradient/, 'white sheet drawn');
w.document.querySelector('.book-loupe-close').click();
assert.equal(loupe.active(), false); assert.equal(lens.hidden, true);
loupe.close();
assert.equal(w.document.querySelector('.book-loupe'), null);
console.log('loupe: PASS');
