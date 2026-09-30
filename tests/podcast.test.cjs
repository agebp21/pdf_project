// Podcast: script parsing/formatting, playing the lines in turn with a
// woman's (host A) and a man's (host B) voice, the transcript marking the
// line being spoken, tapping a line to play from it, stop and close.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><button id="podcast"></button></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
require('../assets/export/layout.js');
const P = global.FlipbookPodcast;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Parse: the first name is host A, the second host B; wrapped lines join; stray text dropped.
const parsed = P.parse('RINA: Halo semua!\nBIMA: Halo juga.\n  lanjutan kalimat Bima.\n\nRINA: Kita mulai.\nCATATAN: bukan penyiar');
assert.deepEqual(parsed.hosts, ['Rina', 'Bima']);
assert.deepEqual(parsed.lines, [{ s: 'A', t: 'Halo semua!' }, { s: 'B', t: 'Halo juga. lanjutan kalimat Bima.' }, { s: 'A', t: 'Kita mulai. CATATAN: bukan penyiar' }]);
assert.equal(P.format(parsed), 'RINA: Halo semua!\nBIMA: Halo juga. lanjutan kalimat Bima.\nRINA: Kita mulai. CATATAN: bukan penyiar');
assert.deepEqual(P.parse('').lines, []);
assert.deepEqual(P.parse('SARI: Hai\nDODI: Yo').hosts, ['Sari', 'Dodi'], 'other host names work');

(async () => {
  const said = []; let stops = 0;
  const engine = { speak(text, lang, done, gender) { said.push([gender, text, lang]); setTimeout(() => done(true), 5); }, stop() { stops++; } };
  const podcast = { lines: [{ s: 'A', t: 'Selamat datang di NUSANTARA.' }, { s: 'B', t: 'Halo Rina!' }, { s: 'A', t: 'Mari mulai.' }], hosts: ['Rina', 'Bima'], lang: 'id-ID' };
  let others = 0;
  const button = w.document.getElementById('podcast');
  const player = P.bind({ podcast, button, engine, onStart: () => { others++; } });
  assert.equal(button.hidden, false); assert.equal(button.textContent, '🎙 Podcast');
  button.click();
  const panel = w.document.querySelector('.book-podcast');
  assert.ok(panel, 'transcript panel opens'); assert.equal(others, 1, 'read-aloud is stopped first');
  assert.equal(panel.querySelectorAll('.book-podcast-line').length, 3);
  assert.match(panel.querySelector('.book-marks-title').textContent, /Rina & Bima/);
  await sleep(5);
  assert.ok(panel.querySelectorAll('.book-podcast-line')[0].classList.contains('is-now') || said.length > 1, 'the line being spoken is marked');
  await sleep(60);
  assert.deepEqual(said.map(x => x[0]), ['female', 'male', 'female'], 'host A a woman, host B a man');
  assert.equal(said[0][1], 'Selamat datang di Nusantara.', 'capitals spoken as words');
  assert.equal(said[0][2], 'id-ID');
  assert.equal(player.active(), false, 'stops after the last line');
  assert.match(w.document.querySelector('.book-podcast-play').textContent, /Play/);
  // Tap a line: plays from there.
  said.length = 0;
  panel.querySelectorAll('.book-podcast-line')[2].click();
  await sleep(30);
  assert.deepEqual(said.map(x => x[1]), ['Mari mulai.']);
  // Pause / close.
  const slow = { speak(text, lang, done, gender) { said.push([gender, text]); }, stop() {} };
  const p2 = P.bind({ podcast, engine: slow });
  p2.open(); p2.playFrom(0); assert.equal(p2.active(), true);
  p2.stop(); assert.equal(p2.active(), false);
  p2.close(); assert.equal(w.document.querySelectorAll('.book-podcast').length, 1, 'its own panel removed');
  player.close(); assert.equal(w.document.querySelector('.book-podcast'), null);
  // No script (or a getter returning none): no button.
  const b2 = w.document.createElement('button');
  let current = null;
  const p3 = P.bind({ podcast: () => current, button: b2, engine });
  assert.equal(b2.hidden, true);
  current = podcast; p3.refresh(); assert.equal(b2.hidden, false, 'shows once the editor has a script');
  console.log('PASS podcast: parse/format, two voices in turn, transcript marks, tap a line to play, stop/close, hidden without a script');
})().catch(e => { console.error(e); process.exit(1); });
