// Mouse wheel / trackpad scroll turns pages: every mouse notch is a turn (a fast
// spin riffles through the book), trackpad deltas add up, never over Ctrl+wheel
// (zoom) or a wheel the zoom already took (panning).
const assert = require('node:assert/strict');
global.window = {};
global.document = { addEventListener() {}, removeEventListener() {} };
require('../assets/export/layout.js');
let handler = null;
const surface = { addEventListener: (name, fn) => { if (name === 'wheel') handler = fn; }, removeEventListener() {} };
const turns = [];
let on = true;
global.FlipbookWheel.bind(surface, { enabled: () => on, next: () => turns.push('next'), prev: () => turns.push('prev') });
const wheel = (deltaY, extra) => { const e = Object.assign({ deltaY, deltaX: 0, deltaMode: 0, cancelable: true, defaultPrevented: false,
  ctrlKey: false, preventDefault() { this.prevented = true; } }, extra); handler(e); return e; };

const first = wheel(100);
assert.deepEqual(turns, ['next'], 'a notch down turns forward at once');
assert.ok(first.prevented, 'the wheel over the book does not scroll the page');
wheel(100); wheel(100); wheel(100);
assert.equal(turns.length, 4, 'a fast spin: one turn per notch, none dropped');
turns.length = 0;
for (let i = 0; i < 8; i++) wheel(30);
assert.deepEqual(turns, ['next', 'next'], 'trackpad deltas add up (240 px = 2 turns)');
turns.length = 0;
wheel(-120);
assert.deepEqual(turns, ['prev'], 'scrolling up turns back');
wheel(10); wheel(-10); wheel(10);
assert.equal(turns.length, 1, 'tiny jitter is ignored');
wheel(0, { deltaX: 80 });
assert.equal(turns.at(-1), 'next', 'a sideways swipe right turns forward');
wheel(3, { deltaMode: 1 }); assert.equal(turns.length, 3, 'line mode (Firefox): 3 lines is a notch');
wheel(200, { ctrlKey: true }); wheel(200, { defaultPrevented: true });
assert.equal(turns.length, 3, 'Ctrl+wheel zooms and a zoomed pan is left alone');
on = false; wheel(200);
assert.equal(turns.length, 3, 'no book, no turn');
console.log('PASS flip wheel: a turn per notch, trackpad adds up, both directions, zoom/pan untouched');
