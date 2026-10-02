// Audio book on a translated edition ("ID | EN"): the edition's text is read
// in the edition's language, block by block (marked), a click on a block
// reads from there, pages not in the edition read the original, and a switch
// of language while reading reads on in the new one.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><button id="speak"></button></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
require('../assets/export/layout.js');
const S = global.FlipbookSpeech;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const spoken = [];
  const engine = { speak(text, lang, done) { spoken.push([text, lang]); setTimeout(() => done(true), 5); }, stop() {}, has: () => true };
  const pages = [0, 1].map(() => { const p = w.document.createElement('article'); w.document.body.appendChild(p); p.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000 }); return p; });
  const original = { '0': ['The first page in English.'], '1': ['The second page in English.'] };
  let shown = null;                                           // the edition on screen
  const edition = { lang: 'id-ID', pages: { '0': [[0.1, 0.1, 0.8, 0.1, 'Halaman pertama. Kalimat kedua di sini.'], [0.1, 0.5, 0.8, 0.1, 'Paragraf bawah.']] } };
  const speech = S.bind({ text: original, pages, visible: () => [0, 1], button: w.document.getElementById('speak'), engine,
    next: () => false, edition: () => shown });
  assert.equal(speech.lang(), 'en-US');

  // Original book: English, in English.
  speech.start(); await sleep(40);
  assert.deepEqual(spoken.map(s => s[1]), ['en-US', 'en-US']);
  speech.stop(); spoken.length = 0;

  // The Indonesian edition: page 1 from its blocks in Indonesian (marked), page 2 (not translated) original.
  shown = edition;
  speech.start(); await sleep(1);
  assert.ok(w.document.querySelector('.book-reading'), 'the block being read is marked');
  await sleep(60);
  assert.deepEqual(spoken, [['Halaman pertama. Kalimat kedua di sini.', 'id-ID'], ['Paragraf bawah.', 'id-ID'], ['The second page in English.', 'en-US']]);
  speech.stop(); spoken.length = 0;

  // A click on the lower block (while the audio book is on) reads from there.
  w.document.getElementById('speak').click();               // arm
  pages[0].dispatchEvent(new w.MouseEvent('mousedown', { clientX: 500, clientY: 550, bubbles: true, cancelable: true }));
  await sleep(40);
  assert.deepEqual(spoken[0], ['Paragraf bawah.', 'id-ID'], 'from the block under the click');
  speech.stop(); spoken.length = 0;

  // Switching back to the original while reading: reads on in English.
  speech.start(); await sleep(3);
  shown = null; speech.editionChanged(); await sleep(40);
  assert.equal(spoken[spoken.length - 1][1], 'en-US');
  speech.stop();
  assert.equal(w.document.getElementById('speak').textContent, '🎧 Audio book');
  console.log('PASS speech-edition: edition text read in its language, blocks marked, click a block, untranslated pages in the original, switch while reading, "Audio book" label');
})().catch(error => { console.error(error); process.exit(1); });
