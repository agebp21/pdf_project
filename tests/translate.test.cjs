// Translation panel: shows the translation of the pages on screen, follows
// page turns, switches language, hides without translations, validation.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><button id="tr"></button></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
require('../assets/export/layout.js');
require('../assets/flipbook-export.js');
const T = global.FlipbookTranslate, E = global.FlipbookExport;

const translations = { 'id-ID': { '1': 'Halaman dua.\nParagraf kedua.', '2': 'Halaman tiga.' }, 'ms-MY': { '1': 'Muka surat dua.' } };
let shown = [1, 2];
const button = w.document.getElementById('tr');
const view = T.bind({ translations, visible: () => shown, button });
assert.equal(button.hidden, false); assert.equal(button.textContent, '🌐 Translate');
button.click();
const panel = () => w.document.querySelector('.book-translate');
const texts = () => [...panel().querySelectorAll('.book-translate-body p')].map(p => p.textContent);
assert.deepEqual(texts(), ['Page 2', 'Halaman dua.', 'Paragraf kedua.', 'Page 3', 'Halaman tiga.'], 'both pages on screen, paragraphs kept');
assert.equal(panel().querySelector('select').hidden, false, 'two languages: a picker');
// Turn the page: follows.
shown = [3, 4]; view.pageChanged();
assert.deepEqual(texts(), ['No translation for the pages on screen.']);
// Switch language.
shown = [1, 2]; const pick = panel().querySelector('select'); pick.value = 'ms-MY'; pick.dispatchEvent(new w.Event('change'));
assert.deepEqual(texts(), ['Page 2', 'Muka surat dua.']);
button.click(); assert.equal(panel(), null, 'closes');
// Nothing translated (editor before translating): no button; appears once there is.
const b2 = w.document.createElement('button'); let live = {};
const v2 = T.bind({ translations: () => live, visible: () => [0], button: b2 });
assert.equal(b2.hidden, true);
live = { 'en-US': { '0': 'Cover text.' } }; v2.refresh(); assert.equal(b2.hidden, false);

// Validation in projects / exports.
const model = { version: 1, title: 'x', pageCount: 3, ratio: 1, overlays: {} };
assert.deepEqual(E.validate({ ...model, translations: { 'id-ID': { '0': 'a', '1': '  ' } } }).translations, { 'id-ID': { '0': 'a' } }, 'empty pages dropped');
assert.equal(E.validate(model).translations, undefined, 'books without translations stay as before');
for (const bad of [{ fr: { '0': 'a' } }, { 'id-ID': { '9': 'a' } }, { 'id-ID': { '0': 5 } }, ['x']]) assert.throws(() => E.validate({ ...model, translations: bad }), /terjemahan/);
// Summary panel: headings, paragraphs and bullet points.
const S = global.FlipbookSummary;
assert.deepEqual(S.blocks('Intisari\nBuku ini membahas filsafat Jawa.\nPoin penting\n- Satu hal.\n- Dua hal.\n• Tiga'),
  [{ kind: 'head', text: 'Intisari' }, { kind: 'para', text: 'Buku ini membahas filsafat Jawa.' }, { kind: 'head', text: 'Poin penting' }, { kind: 'list', items: ['Satu hal.', 'Dua hal.', 'Tiga'] }]);
const sb = w.document.createElement('button'); w.document.body.appendChild(sb);
let summary = null;
const sv = S.bind({ summary: () => summary, button: sb });
assert.equal(sb.hidden, true, 'no summary: no button');
summary = { lang: 'id-ID', text: 'Intisari\nIsi buku.\nPoin penting\n- A\n- B' }; sv.refresh();
assert.equal(sb.hidden, false); assert.equal(sb.textContent, '📋 Summary');
sb.click();
const sp = w.document.querySelector('.book-summary');
assert.deepEqual([...sp.querySelectorAll('li')].map(li => li.textContent), ['A', 'B']);
assert.equal(sp.querySelector('.book-translate-page').textContent, 'Intisari');
sb.click(); assert.equal(w.document.querySelector('.book-summary'), null);
assert.deepEqual(E.validate({ ...model, summary: { lang: 'xx', text: ' Isi ' } }).summary, { lang: 'id-ID', text: 'Isi' });
assert.equal(E.validate({ ...model, summary: { text: '  ' } }).summary, undefined);
assert.throws(() => E.validate({ ...model, summary: { text: 5 } }), /ringkasan/);
console.log('PASS translate: pages on screen, follows turns, language picker, hidden without translations, validation; summary panel');
