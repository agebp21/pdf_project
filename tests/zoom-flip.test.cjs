// Zoom never fights a page turn: no zooming in mid-flip, taps while
// zoomed leave the zoom (instead of dead corner clicks), turns unzoom
// instantly before they start (no wobble out of a smooth zoom-out).
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><main id="m"><div id="stage"></div></main></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
global.addEventListener = w.addEventListener.bind(w);
require('../assets/export/layout.js');
const Z = global.FlipbookZoom;

const surface = w.document.getElementById('m'), target = w.document.getElementById('stage');
const page = w.document.createElement('article'); page.className = 'page';
const link = w.document.createElement('a'); link.href = '#x'; page.appendChild(link);
target.appendChild(page);
const button = w.document.createElement('button'); button.textContent = '🔍';
w.document.body.appendChild(button);
let state = 'read';
const zoom = Z.bind(surface, target, { button, state: () => state });
assert.ok(typeof zoom.snap === 'function', 'snap exposed');
assert.equal(zoom.scale(), 1);

// Zooming in mid-turn is refused (the turn would play zoomed and snap).
button.click(); assert.equal(zoom.scale(), 2, 'zoom in while idle');
state = 'flipping';
button.click(); assert.equal(zoom.scale(), 2, 'button zoom ignored mid-flip');
state = 'read';
button.click(); assert.equal(zoom.scale(), 1, 'toggle back while idle');

// snap() unzooms instantly (no smooth transition left behind).
button.click(); assert.equal(zoom.scale(), 2);
zoom.snap();
assert.equal(zoom.scale(), 1, 'snapped out');
assert.equal(target.style.transition, '', 'no smooth glide left behind');
assert.equal(target.style.transform, '', 'stage back to 100%');

// A tap while zoomed leaves the zoom (PageFlip never sees it); links
// and buttons still work; idle taps do nothing.
button.click(); assert.equal(zoom.scale(), 2);
page.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
assert.equal(zoom.scale(), 1, 'tap on the page exits the zoom');
button.click(); assert.equal(zoom.scale(), 2);
link.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
assert.equal(zoom.scale(), 2, 'tap on a link keeps the zoom');
button.click(); assert.equal(zoom.scale(), 1, 'zoom button still toggles by design');
button.click(); assert.equal(zoom.scale(), 2, 'zoom again for the mark test');
const mark = w.document.createElement('div'); mark.className = 'book-hl'; page.appendChild(mark);
mark.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
assert.equal(zoom.scale(), 2, 'tap on a highlight keeps the zoom');
zoom.snap();
page.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
assert.equal(zoom.scale(), 1, 'tap at 100% is not swallowed');
w.close();
console.log('PASS zoom-flip: mid-turn gate, instant pre-turn snap, tap exits zoom');
