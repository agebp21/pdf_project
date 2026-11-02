// 📋 Summary button: a book without a summary offers "Summarize book", which asks the
// server's AI (make) and then opens the panel; a failure is reported and the button returns.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const w = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' }).window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
require('../assets/export/layout.js');
const S = global.FlipbookSummary;
const tick = () => new Promise(r => setTimeout(r, 0));

(async () => {
  const b = w.document.createElement('button'); w.document.body.appendChild(b);
  let summary = null, calls = 0, fail = true, errors = [];
  let release;
  S.bind({ summary: () => summary, button: b, onError: m => errors.push(m),
    labels: { make: '✨ Ringkas buku', making: '⏳ Meringkas…' },
    make: () => new Promise((ok, no) => { calls++; release = () => (fail ? no(Error('Kuota habis')) : (summary = { lang: 'id-ID', text: 'Isi buku.\n- A' }, ok())); }) });
  assert.equal(b.hidden, false, 'make offered without a summary');
  assert.equal(b.textContent, '✨ Ringkas buku');

  b.click(); assert.equal(b.textContent, '⏳ Meringkas…'); assert.equal(b.disabled, true);
  b.click(); assert.equal(calls, 1, 'no second request while one runs');
  release(); await tick(); await tick();
  assert.deepEqual(errors, ['Kuota habis']);
  assert.equal(b.disabled, false); assert.equal(b.textContent, '✨ Ringkas buku');
  assert.equal(w.document.querySelector('.book-summary'), null);

  fail = false; b.click(); release(); await tick(); await tick();
  assert.equal(calls, 2);
  assert.ok(w.document.querySelector('.book-summary'), 'panel opens with the new summary');
  assert.equal(b.textContent, '📋 Summary');
  b.click(); assert.equal(w.document.querySelector('.book-summary'), null);
  b.click(); assert.equal(calls, 2, 'an existing summary just opens'); 
  console.log('summary-make ok');
})().catch(e => { console.error(e); process.exit(1); });
