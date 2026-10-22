// Mouse wheel / trackpad scroll turns pages: one scroll is one turn (more notches
// and trackpad inertia in the same scroll are ignored until the wheel rests),
// never over Ctrl+wheel (zoom) or a wheel the zoom already took (panning).
const assert = require('node:assert/strict');
global.window = {};
global.document = { addEventListener() {}, removeEventListener() {} };
const timers = new Map(); let id = 0;
global.setTimeout = fn => { timers.set(++id, fn); return id; };
global.clearTimeout = t => { timers.delete(t); };
const rest = () => { const all = [...timers.values()]; timers.clear(); all.forEach(fn => fn()); };
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
assert.equal(turns.length, 1, 'a fast spin is still one turn');
rest(); wheel(100);
assert.equal(turns.length, 2, 'after the wheel rests, the next scroll turns again');
rest(); turns.length = 0;
for (let i = 0; i < 30; i++) wheel(12);
assert.deepEqual(turns, ['next'], 'a trackpad swipe with its inertia: one turn');
rest(); wheel(-120);
assert.deepEqual(turns, ['next', 'prev'], 'scrolling up turns back');
rest(); wheel(10); wheel(-10); wheel(10);
assert.equal(turns.length, 2, 'tiny jitter is ignored');
rest(); wheel(0, { deltaX: 80 });
assert.equal(turns.at(-1), 'next', 'a sideways swipe right turns forward');
rest(); wheel(3, { deltaMode: 1 }); assert.equal(turns.length, 4, 'line mode (Firefox): a notch turns');
rest(); wheel(200, { ctrlKey: true }); wheel(200, { defaultPrevented: true });
assert.equal(turns.length, 4, 'Ctrl+wheel zooms and a zoomed pan is left alone');
on = false; rest(); wheel(200);
assert.equal(turns.length, 4, 'no book, no turn');
console.log('PASS flip wheel: one scroll = one turn, both directions, inertia ignored, zoom/pan untouched');
