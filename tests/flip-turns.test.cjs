// Quick turns: requests during a turn queue up (none lost), the faster they
// come the faster each turn runs, a hard scroll sweeps many spreads in one
// turn (thick books), turning back cancels, the ends stop it.
const assert = require('node:assert/strict');
global.window = {};
global.document = { addEventListener() {}, removeEventListener() {} };
require('../assets/export/layout.js');
let clock = 1000; Date.now = () => clock;
const timers = []; global.setTimeout = fn => { timers.push(fn); return timers.length; }; global.clearTimeout = () => {};
const flushTimers = () => { while (timers.length) timers.shift()(); };

function fakeBook(pages) {
  const handlers = [], settings = { flippingTime: 650 };
  const book = { page: 0, state: 'read', durations: [],
    getSettings: () => settings, getState: () => book.state,
    on: (name, fn) => { if (name === 'changeState') handlers.push(fn); },
    set(state) { book.state = state; handlers.forEach(fn => fn({ data: state })); },
    sweeps: [], getPageCount: () => pages,
    flip(dir) { book.durations.push(settings.flippingTime); book.sweeps.push(Math.abs(dir)); book.page += dir; book.set('flipping'); },
    land() { book.set('read'); flushTimers(); } };
  const turns = global.FlipbookTurns.bind(book, (forward, steps) => {
    if (forward ? book.page >= pages - 1 : book.page <= 0) return false;
    book.flip((forward ? 1 : -1) * Math.min(steps, forward ? pages - 1 - book.page : book.page));
  });
  return { book, turns };
}

let { book, turns } = fakeBook(20);
turns.request(true);
assert.equal(book.page, 1); assert.equal(book.durations[0], 650, 'a lone click gets the full turn');
clock += 300; turns.request(true);
assert.equal(turns.pending(), 1, 'a click during a turn is queued, not lost');
book.land();
assert.equal(book.page, 2); assert.ok(book.durations[1] < 650 && book.durations[1] >= 200, 'a quick second click turns faster: ' + book.durations);
clock += 80; turns.request(true); clock += 80; turns.request(true); clock += 80; turns.request(true);
assert.equal(book.page, 2, 'one turn at a time'); assert.equal(turns.pending(), 3);
book.land(); book.land();
assert.equal(book.page, 5, 'every queued click turned a page');
assert.deepEqual(book.sweeps.slice(-1), [3], 'three waiting: one sweep over all three');
assert.equal(book.getSettings().flippingTime, 650, 'back to the normal pace once the queue is empty');

clock += 5000; turns.request(true); assert.equal(book.durations.at(-1), 650, 'a click at reading pace is a full turn again');
turns.request(true); turns.request(true); turns.request(false);
assert.equal(turns.pending(), -1, 'turning back cancels the forward turns still waiting');
book.land(); assert.equal(book.page, 5); book.land();

({ book, turns } = fakeBook(3));
for (let i = 0; i < 6; i++) turns.request(true);
book.land(); book.land(); book.land();
assert.equal(book.page, 2, 'stops at the back cover'); assert.equal(turns.pending(), 0, 'the rest of the queue is dropped at the end');
for (let i = 0; i < 20; i++) turns.request(false);
assert.ok(turns.pending() >= -global.FlipbookTurns.MAX_QUEUE, 'the queue is capped');

// A thick book: a hard scroll (40 notches during one turn) sweeps far, capped at a quarter of the book.
({ book, turns } = fakeBook(400));
turns.request(true);
for (let i = 0; i < 40; i++) { clock += 20; turns.request(true); }
assert.equal(turns.pending(), 40, '400 pages: up to 50 waiting');
book.land();
assert.equal(book.page, 41, 'the 40 waiting turns went in one sweep');
for (let i = 0; i < 200; i++) turns.request(true);
assert.equal(turns.pending(), 50, 'capped at a quarter of the spreads (400 / 8)');
console.log('PASS flip turns: queued while turning, faster in bursts, hard scroll sweeps many spreads, back cancels, ends stop, capped');
