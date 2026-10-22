// Page-turn sound: the one recorded paper sound (embedded MP3), when it
// plays, when it must not, and the mute toggle.
const assert = require('node:assert/strict');
let sources = 0;
const decoded = [];
const node = () => ({ connect() {}, gain: param(), frequency: param(), Q: { value: 0 }, playbackRate: { value: 1 },
  start() {}, stop() {}, type: '' });
function param() { return { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
class FakeAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; }
  decodeAudioData(bytes, ok) { decoded.push(Buffer.from(new Uint8Array(bytes))); ok({ duration: 0.6, size: bytes.byteLength }); }
  createBufferSource() { sources++; return node(); }
  createBiquadFilter() { return node(); }
  createGain() { return node(); }
}
const listeners = {};
const store = {};
global.window = { AudioContext: FakeAudioContext };
global.atob = text => Buffer.from(text, 'base64').toString('binary');
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
global.document = { addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); }, removeEventListener() {} };
require('../assets/export/layout.js');
const sound = global.FlipbookSound;
const turns = () => sources; // one buffer source per page turn

// A fake PageFlip that only emits state changes.
const handlers = [];
const book = { on: (name, fn) => { if (name === 'changeState') handlers.push(fn); } };
const state = value => handlers.forEach(fn => fn({ data: value }));
const release = () => (listeners.pointerup || []).forEach(fn => fn());
sound.attach(book);

state('fold_corner'); state('read');
assert.equal(turns(), 0, 'peeking at a corner is silent');
state('flipping'); state('read');
assert.equal(turns(), 1, 'buttons/keys/swipes (flipping) play once');
const file = name => require('node:fs').readFileSync(require('node:path').join(__dirname, '../assets/sounds/' + name));
assert.ok(decoded.some(b => b.equals(file('paper-flip.mp3'))), 'the cover recording is assets/sounds/paper-flip.mp3');
assert.ok(decoded.some(b => b.equals(file('page-turn.mp3'))), 'the inside-page recording is assets/sounds/page-turn.mp3');
assert.equal(sound.styles, undefined, 'no synthesised styles any more');
release();
assert.equal(turns(), 1, 'a click release after a flip does not double the sound');
state('user_fold'); release(); state('read');
assert.equal(turns(), 2, 'a drag plays when released');
release();
assert.equal(turns(), 2, 'no sound for releases while just reading');

const button = { textContent: '', title: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(n, fn) { this.click = fn; } };
sound.bindButton(button);
assert.match(button.textContent, /Sound/);
button.click();
assert.equal(store['mf-flip-sound'], 'off', 'mute is remembered');
assert.match(button.textContent, /Muted/);
assert.equal(button.attrs['aria-pressed'], 'false');
state('flipping');
assert.equal(turns(), 2, 'muted flips are silent');
button.click();
state('flipping');
assert.equal(turns(), 3, 'unmuted again');
console.log('PASS flip sound: embedded recording, flipping + drag release, silent corner peek and reading, mute toggle persisted');

// Covers sound as recorded; inside pages as a thin sheet (higher, quicker, no low thump).
const cover = (count, index, back, spread = true) => sound.coverTurn({ getPageCount: () => count, getCurrentPageIndex: () => index,
  getRender: () => ({ getDirection: () => back ? 1 : 0 }), getOrientation: () => spread ? 'landscape' : 'portrait' });
assert.equal(cover(24, 0, false), true, 'opening the front cover');
assert.equal(cover(24, 1, true), true, 'closing the front cover');
assert.equal(cover(24, 3, false), false, 'an inside page');
assert.equal(cover(24, 3, true), false, 'an inside page turned back');
// 24 PDF pages + the blank back sheet = 25: the last spread is [23 back cover, 24 blank].
assert.equal(cover(25, 21, false), true, 'onto the back cover');
assert.equal(cover(25, 19, false), false, 'not yet the back cover');
assert.equal(cover(25, 23, true), true, 'off the back cover');
assert.equal(cover(25, 21, true), false, 'an inside page turned back near the end');
assert.equal(cover(26, 23, false), true, 'even count: onto the lone last page');
assert.equal(cover(25, 22, false, false), true, 'portrait: onto the back cover');
assert.equal(cover(24, 5, true, false), false, 'portrait: inside');
const made = [];
const ctx = { state: 'running', currentTime: 0, destination: {}, createGain: () => { const n = node(); made.push(['gain', n]); return n; },
  createBiquadFilter: () => { const n = node(); made.push(['filter', n]); return n; }, createBufferSource: () => { const n = node(); made.push(['source', n]); return n; } };
const played = kind => { made.length = 0; sound.play(kind, ctx); return made.find(([k]) => k === 'source')[1]; };
assert.equal(played('page').buffer.size, file('page-turn.mp3').length, 'an inside page plays the thin newspaper recording');
assert.equal(played('cover').buffer.size, file('paper-flip.mp3').length, 'a cover plays the thick recording');
const rate = played('page').playbackRate.value;
assert.ok(rate > 0.95 && rate < 1.05, 'both play as recorded'); assert.equal(made.filter(([k]) => k === 'filter').length, 0, 'no filters');
console.log('PASS flip sound voices: covers thick recording, inside pages newspaper recording');
made.length = 0; sound.play('page', ctx); const pageGain = made.find(([k]) => k === 'gain')[1].gain.value;
made.length = 0; sound.play('cover', ctx); const coverGain = made.find(([k]) => k === 'gain')[1].gain.value;
assert.ok(pageGain <= 0.15 && pageGain < coverGain, 'inside pages are soft (owner: 0.3 was too loud): ' + pageGain);
console.log('PASS flip sound volume: inside pages softer than the cover');
