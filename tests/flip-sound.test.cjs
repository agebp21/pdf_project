// Page-turn sound: when it plays, when it must not, and the mute toggle.
const assert = require('node:assert/strict');
let sources = 0;
const node = () => ({ connect() {}, gain: param(), frequency: param(), Q: { value: 0 }, playbackRate: { value: 1 },
  start() {}, stop() {}, type: '' });
function param() { return { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
class FakeAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; }
  createBuffer(channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
  createBufferSource() { sources++; return node(); }
  createBiquadFilter() { return node(); }
  createGain() { return node(); }
}
const listeners = {};
const store = {};
global.window = { AudioContext: FakeAudioContext };
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
global.document = { addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); }, removeEventListener() {} };
require('../assets/export/layout.js');
const sound = global.FlipbookSound;
const turns = () => sources / 2;

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
console.log('PASS flip sound: flipping + drag release, silent corner peek and reading, mute toggle persisted');
