// Mouse wheel / trackpad scroll turns pages: one turn per gesture, both ways,
// never over Ctrl+wheel (zoom) or a wheel the zoom already took (panning).
const assert = require('node:assert/strict');
global.window = {};
global.document = { addEventListener() {}, removeEventListener() {} };
require('../assets/export/layout.js');
let clock = 0;
Date.now = () => clock;
let handler = null;
const surface = { addEventListener: (name, fn) => { if (name === 'wheel') handler = fn; }, removeEventListener() {} };
const turns = [];
let on = true;
global.FlipbookWheel.bind(surface, { enabled: () => on, next: () => turns.push('next'), prev: () => turns.push('prev') });
const wheel = (deltaY, extra) => { const e = Object.assign({ deltaY, deltaX: 0, deltaMode: 0, cancelable: true, defaultPrevented: false,
  ctrlKey: false, preventDefault() { this.prevented = true; } }, extra); handler(e); return e; };

const first = wheel(100);
assert.deepEqual(turns, ['next'], 'scrolling down turns forward');
assert.ok(first.prevented, 'the wheel over the book does not scroll the page');
for (let i = 0; i < 20; i++) { clock += 16; wheel(30); }
assert.deepEqual(turns, ['next'], 'a trackpad burst is one turn');
clock += 1000; wheel(-120);
assert.deepEqual(turns, ['next', 'prev'], 'scrolling up turns back');
clock += 1000; wheel(10); wheel(10);
assert.equal(turns.length, 2, 'a tiny nudge is ignored');
clock += 1000; wheel(0, { deltaX: 80 });
assert.deepEqual(turns.at(-1), 'next', 'a sideways swipe right turns forward');
clock += 1000; wheel(200, { ctrlKey: true }); wheel(200, { defaultPrevented: true });
assert.equal(turns.length, 3, 'Ctrl+wheel zooms and a zoomed pan is left alone');
on = false; clock += 1000; wheel(200);
assert.equal(turns.length, 3, 'no book, no turn');
console.log('PASS flip wheel: one turn per gesture, both directions, zoom/pan untouched');
