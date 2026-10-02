// Translated editions ("ID | EN"): paragraph blocks from PDF lines (bullets,
// "Label:" lines, table rows, centred lines kept apart), growing room, the
// ID | EN button, and the book format (lang + versions, picture order).
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><button id="ed"></button></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
require('../assets/export/layout.js');
require('../assets/pdf-translate.js');
require('../assets/flipbook-export.js');
const T = w.PdfTranslate || global.PdfTranslate, ED = global.FlipbookEditions || w.FlipbookEditions, X = global.FlipbookExport;

const line = (text, x, y, w, size = 10, extra = {}) => ({ text, x, y, w, h: size * 1.2, size, baseline: y + size * 0.8, color: '000000', font: 'Arial', bold: false, italic: false, ...extra });
(async () => {
  // A paragraph of three lines, then a heading-sized line, then bullets, then a "Label:" line.
  const lines = [
    line('Big title', 50, 20, 200, 24),
    line('First line of a paragraph that runs', 50, 70, 400), line('on to a second line and then to a', 50, 82, 395), line('third.', 50, 94, 40),
    line('• Bullet one that wraps onto', 50, 120, 300), line('its second line', 62, 132, 120),
    line('• Bullet two', 50, 146, 120),
    line('Objective:', 50, 170, 60, 10, { parts: [{ text: 'Objective', bold: true }, { text: ':', bold: false }] }),
    line('Description on its own line.', 50, 182, 220),
  ];
  const list = T.blocks(lines, 600);
  assert.deepEqual(list.map(b => b.text), ['Big title', 'First line of a paragraph that runs on to a second line and then to a third.',
    'Bullet one that wraps onto its second line', 'Bullet two', 'Objective:', 'Description on its own line.']);
  assert.deepEqual(list.map(b => b.bullet), ['', '', '•', '•', '', '']);
  assert.equal(list[4].label, true, 'bold "Label:" kept for drawing');
  assert.equal(list[2].textX > list[2].x, true, 'bullet text starts after the mark');

  // A table: short label cells beside value cells, rows never joined.
  const table = T.blocks([line('Opening', 60, 100, 50), line(': Ambient cinematic.', 160, 100, 200),
    line('Development', 60, 112, 70), line(': Electronic with strings.', 160, 112, 220)], 600);
  assert.deepEqual(table.map(b => b.text), ['Opening', ': Ambient cinematic.', 'Development', ': Electronic with strings.']);

  // Centred lines (a title over two lines).
  const centred = T.blocks([line('A centred title', 250, 50, 100, 14), line('over two lines of it', 230, 67, 140, 14)], 600);
  assert.equal(centred.length, 1); assert.equal(centred[0].center, true);

  // Room: a one-line block may grow right up to the next block beside it.
  const row = T.blocks([line('Left words', 50, 50, 100), line('Right', 400, 50, 60)], 600);
  T.rooms(row, 600, 800);
  assert.ok(row[0].roomRight <= 400 - 10 + 0.01 && row[0].roomRight > 150, 'stops before the block beside it');

  // Nothing to translate: no letters.
  assert.deepEqual(T.blocks([line('12 / 34', 50, 50, 40)], 600), []);

  // The 🌐 Translate button: original, ready editions, editions that can be made.
  const button = w.document.getElementById('ed');
  let applied = [], made = [], ready = [];
  const ed = ED.bind({ button, original: 'id-ID', ready: () => ready, offer: ['en-US'], apply: l => applied.push(l),
    confirm: async () => true, make: async (l, progress) => { progress('🌐 1 / 2'); made.push(l); ready = [l]; } });
  assert.equal(button.hidden, false); assert.equal(button.textContent, '🌐 Translate');
  assert.equal(button.querySelector('.is-current'), null, 'the original: just "Translate"');
  button.click(); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(made, ['en-US'], 'not ready: made first'); assert.deepEqual(applied, ['en-US']);
  assert.equal(button.textContent, '🌐 Translate · EN'); assert.ok(button.classList.contains('is-translated'));
  button.click(); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(applied, ['en-US', 'id-ID'], 'back to the original'); assert.equal(made.length, 1, 'no second translation');
  // Reader: no maker, nothing ready → no button; a book without a language → no button.
  const b2 = w.document.createElement('button');
  ED.bind({ button: b2, original: 'id-ID', ready: () => [] }); assert.equal(b2.hidden, true);
  ED.bind({ button: b2, original: null, ready: () => ['en-US'] }); assert.equal(b2.hidden, true);
  // A refusal (budget, plan) is reported, the language stays.
  let said = '';
  const b3 = w.document.createElement('button');
  ED.bind({ button: b3, original: 'en-US', offer: ['id-ID'], ready: () => [], confirm: async () => true,
    make: async () => { throw new Error('Budget has been exceeded'); }, onError: m => { said = m; } });
  b3.click(); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  assert.equal(said, 'Budget has been exceeded'); assert.equal(b3.textContent, '🌐 Translate', 'still the original');

  // Book format: lang + versions (sorted, unique, not the book's own language), picture order.
  const model = { version: 1, title: 'Buku', pageCount: 5, ratio: 0.7, overlays: {}, lang: 'id-ID', versions: { 'en-US': [3, 1, 1], 'ms-MY': [0] } };
  const data = X.validate(model);
  assert.deepEqual(data.versions, { 'en-US': [1, 3], 'ms-MY': [0] }); assert.equal(data.lang, 'id-ID');
  assert.deepEqual(X.versionImages(data), [{ lang: 'en-US', page: 1 }, { lang: 'en-US', page: 3 }, { lang: 'ms-MY', page: 0 }]);
  assert.throws(() => X.validate({ ...model, versions: { 'id-ID': [1] } }), /edisi/, "the book's own language is not an edition");
  assert.throws(() => X.validate({ ...model, versions: { 'en-US': [9] } }), /edisi/);
  assert.equal(X.validate({ ...model, lang: 'xx' }).versions, undefined, 'no language: no editions');
  // What translated pages say (audio book): only for pages in the edition, boxes in 0..1, text kept.
  const readText = X.validate({ ...model, versionText: { 'en-US': { '1': [[0.1, 0.2, 0.5, 0.1, 'Hello.'], [0.1, 0.2, 2, 0.1, 'bad box'], [0, 0, 1, 1, '  ']], '2': [[0, 0, 1, 1, 'not in the edition']] }, 'ms-MY': 'x', 'fr-FR': {} } }).versionText;
  assert.deepEqual(readText, { 'en-US': { '1': [[0.1, 0.2, 0.5, 0.1, 'Hello.']] } });
  assert.equal(X.validate({ ...model, versions: undefined, versionText: { 'en-US': { '1': [[0, 0, 1, 1, 'x']] } } }).versionText, undefined, 'no edition: nothing to read');
  console.log('PASS pdf-translate: blocks (paragraphs, bullets, labels, table rows, centred), room, Translate button (make once, back, refusal), lang/versions format + picture order');
})().catch(error => { console.error(error); process.exit(1); });
