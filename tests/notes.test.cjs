// Reader notes: page tabs, editor autosave, list/jump, download text,
// delete, persistence per book, typing guard, rebinding without duplicates.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><button id="notes"></button></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
require('../assets/export/layout.js');
const N = global.FlipbookNotes;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const pages = Array.from({ length: 5 }, () => { const p = w.document.createElement('article'); w.document.body.appendChild(p); return p; });
  let jumped = null;
  const key = N.key('Laporan', 5, 0.7);
  assert.match(key, /^mf-notes:/); assert.notEqual(key, N.key('Lain', 5, 0.7));
  const bind = () => N.bind({ key, title: 'Laporan', pages, goPage: i => { jumped = i; }, open: w.document.getElementById('notes') });
  let notes = bind();
  const tabs = () => pages.map(p => p.querySelectorAll('.book-note-tab'));
  assert.ok(tabs().every(t => t.length === 1), 'one tab per page');
  assert.equal(pages[2].querySelector('.book-note-tab').textContent, '✎');
  assert.equal(w.document.getElementById('notes').textContent, '📝 0');

  // Open the editor from page 3's tab, type, autosave.
  pages[2].querySelector('.book-note-tab').click();
  const editor = w.document.querySelector('.book-note-editor');
  assert.ok(editor, 'editor opens'); assert.match(editor.textContent, /Note · Page 3/);
  assert.ok(notes.editing());
  const area = editor.querySelector('textarea');
  area.value = 'Cek angka 3.414 di sini'; area.dispatchEvent(new w.Event('input'));
  await sleep(500);
  assert.deepEqual(Object.keys(JSON.parse(localStorage.getItem(key))), ['2'], 'saved while typing');
  assert.ok(pages[2].querySelector('.book-note-tab').classList.contains('has-note'));
  assert.equal(pages[2].querySelector('.book-note-tab').textContent, '📝');
  assert.equal(w.document.getElementById('notes').textContent, '📝 1');
  // Typing in the note must not trigger page keys.
  assert.equal(N.typing({ target: area }), true);
  assert.equal(N.typing({ target: w.document.body }), false);
  // Escape closes; Done/outside also save.
  area.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(w.document.querySelector('.book-note-editor'), null); assert.ok(!notes.editing());

  // A second note, closed with Done before the autosave delay.
  pages[0].querySelector('.book-note-tab').click();
  w.document.querySelector('.book-note-editor textarea').value = 'Sampul depan';
  w.document.querySelector('.book-note-done').click();
  assert.equal(Object.keys(notes.notes()).length, 2);

  // List: sorted, jump, download text.
  w.document.getElementById('notes').click();
  const rows = [...w.document.querySelectorAll('.book-note-row')];
  assert.deepEqual(rows.map(r => r.querySelector('b').textContent), ['Cover', 'Page 3']);
  assert.match(rows[1].textContent, /3\.414/);
  assert.match(notes.text(), /Laporan — my notes\n\n\[Cover\]\nSampul depan\n\n\[Page 3\]\nCek angka 3\.414 di sini/);
  rows[1].click();
  assert.equal(jumped, 2); assert.equal(w.document.querySelector('.book-note-list'), null, 'list closes on jump');

  // Delete empties the note and its tab.
  pages[0].querySelector('.book-note-tab').click();
  w.document.querySelector('.book-note-delete').click();
  assert.deepEqual(Object.keys(notes.notes()), ['2']);
  assert.ok(!pages[0].querySelector('.book-note-tab').classList.contains('has-note'));

  // Reopening the book (preview rebinds): notes kept, no duplicate tabs or handlers.
  notes.close(); notes = bind();
  assert.ok(tabs().every(t => t.length === 1));
  assert.deepEqual(Object.keys(notes.notes()), ['2']);
  w.document.getElementById('notes').click();
  assert.equal(w.document.querySelectorAll('.book-note-list').length, 1);
  notes.close();
  localStorage.setItem(key, '{broken');
  assert.deepEqual(N.load(key), {}, 'corrupt storage is ignored');
  console.log('PASS notes: page tabs, autosave, typing guard, list/jump, text export, delete, persistence, rebind');
})().catch(error => { console.error(error); process.exitCode = 1; });
