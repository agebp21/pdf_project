// Quick turns: requests during a turn queue up (none lost), the faster they
// come the faster each turn runs, turning back cancels, the ends stop it.
const assert = require('node:assert/strict');
global.window = {};
global.document = { addEventListener() {}, removeEventListener() {} };
require('../assets/export/layout.js');
let clock = 0; Date.now = () => clock;
const timers = []; global.setTimeout = fn => { timers.push(fn); return timers.length; }; global.clearTimeout = () => {};
const flushTimers = () => { while (timers.length) timers.shift()(); };

function fakeBook(pages) {
  const handlers = [], settings = { flippingTime: 650 };
  const book = { page: 0, state: 'read', durations: [],
    getSettings: () => settings, getState: () => book.state,
    on: (name, fn) => { if (name === 'changeState') handlers.push(fn); },
    set(state) { book.state = state; handlers.forEach(fn => fn({ data: state })); },
    flip(dir) { book.durations.push(settings.flippingTime); book.page += dir; book.set('flipping'); },
    land() { book.set('read'); flushTimers(); } };
  const turns = global.FlipbookTurns.bind(book, forward => {
    if (forward ? book.page >= pages - 1 : book.page <= 0) return false;
    book.flip(forward ? 1 : -1);
  });
  return { book, turns };
}

let { book, turns } = fakeBook(20);
turns.request(true);
assert.equal(book.page, 1); assert.equal(book.durations[0], 650, 'a lone click gets the full turn');
clock += 80; turns.request(true); clock += 80; turns.request(true); clock += 80; turns.request(true);
assert.equal(book.page, 1, 'one turn at a time'); assert.equal(turns.pending(), 3, 'clicks during a turn are queued, not lost');
book.land(); book.land(); book.land(); book.land();
assert.equal(book.page, 4, 'every queued click turned a page');
assert.ok(book.durations.slice(1).every(ms => ms < 650 && ms >= 200), 'a burst turns faster: ' + book.durations);
assert.equal(book.getSettings().flippingTime, 650, 'back to the normal pace once the queue is empty');

clock += 5000; turns.request(true); assert.equal(book.durations.at(-1), 650, 'a click at reading pace is a full turn again');
turns.request(true); turns.request(true); turns.request(false);
assert.equal(turns.pending(), -1, 'turning back cancels the forward turns still waiting');
book.land(); assert.equal(book.page, 4); book.land();

({ book, turns } = fakeBook(3));
for (let i = 0; i < 6; i++) turns.request(true);
book.land(); book.land(); book.land();
assert.equal(book.page, 2, 'stops at the back cover'); assert.equal(turns.pending(), 0, 'the rest of the queue is dropped at the end');
for (let i = 0; i < 20; i++) turns.request(false);
assert.ok(turns.pending() >= -global.FlipbookTurns.MAX_QUEUE, 'the queue is capped');
console.log('PASS flip turns: queued while turning, faster in bursts, back cancels, ends stop, capped');
