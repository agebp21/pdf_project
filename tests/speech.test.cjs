// Read aloud: text → sentence chunks, language guess, reading the pages on
// screen in order, turning the page at the end of them, skipping pages
// without text, following manual page turns, stopping at the end.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><button id="speak"></button></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
require('../assets/export/layout.js');
const S = global.FlipbookSpeech;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Chunks: whole sentences, dot leaders dropped, nothing over MAX.
assert.deepEqual(S.chunks(['Pendahuluan ........ 1', 'Visi dan Misi ..... 3']), ['Pendahuluan 1 Visi dan Misi 3']);
assert.deepEqual(S.chunks(['Satu kalimat.', 'Dua kalimat!']), ['Satu kalimat. Dua kalimat!']);
const long = S.chunks([Array.from({ length: 80 }, (_, i) => 'kata' + i).join(' ') + '. Akhir.']);
assert.ok(long.length > 1 && long.every(c => c.length <= S.MAX), 'long text split under MAX');
assert.equal(long.join(' ').split(' ').length, 81, 'no word lost (80 words + Akhir.)');
assert.deepEqual(S.chunks([]), []); assert.deepEqual(S.chunks(undefined), []);
// Language.
assert.equal(S.lang('Ini adalah buku yang dibuat untuk anak dan keluarga'), 'id-ID');
assert.equal(S.lang('This is the book that we made for the family'), 'en-US');

(async () => {
  // A fake engine: records what is spoken, finishes each piece a moment later.
  const spoken = []; let stops = 0;
  const engine = { speak(text, lang, done) { spoken.push(text); setTimeout(() => done(true), 5); }, stop() { stops++; } };
  let page = 1, turns = 0;
  const pages = { '1': ['Halaman dua.'], '2': ['Halaman tiga.'], '4': ['Halaman lima.'] };   // page 3 (index) has no text
  const visible = () => page < 5 ? [page, page + 1].filter(i => i < 6) : [5];
  const button = w.document.getElementById('speak');
  const speech = S.bind({ text: pages, visible, button, engine, next: () => {
    if (page >= 5) return false;
    turns++; page += 2; setTimeout(() => speech.pageChanged(), 5); return true;   // the viewer reports the turn
  } });
  assert.equal(button.hidden, false); assert.equal(button.textContent, '🎧 Listen'); assert.equal(speech.lang(), 'id-ID');
  button.click();
  assert.equal(speech.active(), true); assert.equal(button.textContent, '⏹ Stop');
  await sleep(60);
  // Spread 2–3, then the page turns by itself to 4–5 (index 3 has no text, 4 has).
  assert.deepEqual(spoken, ['Halaman dua.', 'Halaman tiga.', 'Halaman lima.'], 'both pages of the spread in order, then the next spread');
  assert.equal(turns, 2, 'turned after each spread');
  // The last page (index 5) has no text: a short pause, then the book ends.
  assert.equal(speech.active(), true);
  await sleep(1700);
  assert.equal(speech.active(), false, 'stops at the end of the book'); assert.equal(button.textContent, '🎧 Listen');

  // A manual page turn while reading starts reading the new pages.
  spoken.length = 0; page = 1;
  const slow = { speak(text, lang, done) { spoken.push(text); setTimeout(() => done(true), 200); }, stop() {} };
  const s2 = S.bind({ text: pages, visible, engine: slow, next: () => false });
  s2.start(); await sleep(20);
  page = 3; s2.pageChanged(); await sleep(20);
  assert.deepEqual(spoken, ['Halaman dua.', 'Halaman lima.'], 'jumped to the new spread');
  s2.stop(); assert.equal(s2.active(), false);

  // No text anywhere, or no voices: no button.
  const b2 = w.document.createElement('button');
  S.bind({ text: {}, visible, engine, next: () => false, button: b2 }); assert.equal(b2.hidden, true);
  const b3 = w.document.createElement('button');
  S.bind({ text: pages, visible, engine: null, next: () => false, button: b3 }); assert.equal(b3.hidden, true, 'no voices here (jsdom)');
  // Voice choice (Web Speech): an Indonesian woman's voice.
  const pick = voices => {
    let used = null;
    w.SpeechSynthesisUtterance = function (text) { this.text = text; };
    w.speechSynthesis = { getVoices: () => voices, speak: u => { used = u; }, cancel() {} };
    S.engine().speak('Halo', 'id-ID', () => {});
    return used.voice ? used.voice.name : null;
  };
  const v = (name, lang) => ({ name, lang });
  const windows = [v('Microsoft Andika - Indonesian (Indonesia)', 'id-ID'), v('Microsoft Zira - English (United States)', 'en-US')];
  assert.equal(pick(windows.concat([v('Google Bahasa Indonesia', 'id-ID'), v('Google US English', 'en-US')])), 'Google Bahasa Indonesia', 'Chrome: Google');
  assert.equal(pick(windows.concat([v('Microsoft Ardi Online (Natural) - Indonesian (Indonesia)', 'id-ID'), v('Microsoft Gadis Online (Natural) - Indonesian (Indonesia)', 'id-ID')])),
    'Microsoft Gadis Online (Natural) - Indonesian (Indonesia)', 'Edge: Gadis, not Ardi');
  assert.equal(pick(windows), 'Microsoft Andika - Indonesian (Indonesia)', 'Windows only has Andika: still Indonesian');
  assert.equal(pick([v('Some voice', 'in_ID')]), 'Some voice', 'old Android code "in"');
  delete w.speechSynthesis; delete w.SpeechSynthesisUtterance;
  console.log('PASS speech: chunks, language, reads the spread then turns, skips pages without text, follows manual turns, stops at the end, picks an Indonesian woman voice');
})().catch(e => { console.error(e); process.exit(1); });
