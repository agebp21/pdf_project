// Reader notes as agenda tabs: several notes per page stacked as numbered
// tabs, ＋ to add, tap to read / edit / delete, autosave, list and text
// export, auto-bookmark, migration from one-note-per-page, rebinding.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><button id="notes"></button></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
require('../assets/export/layout.js');
const N = global.FlipbookNotes, B = global.FlipbookBookmarks;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const pages = Array.from({ length: 5 }, () => { const p = w.document.createElement('article'); w.document.body.appendChild(p); return p; });
  const key = N.key('Laporan', 5, 0.7);
  assert.match(key, /^mf-notes:/); assert.notEqual(key, N.key('Lain', 5, 0.7));
  const marks = B.bind({ key: B.key('Laporan', 5, 0.7), pages, visible: () => [0], goPage: () => {} });
  let jumped = null;
  const bind = () => N.bind({ key, title: 'Laporan', pages, goPage: i => { jumped = i; }, open: w.document.getElementById('notes'), bookmark: (i, on) => marks.set(i, on) });
  let notes = bind();
  const tabsOf = i => [...pages[i].querySelectorAll('.book-note-stack .book-note-tab')].map(t => t.textContent);
  assert.ok(pages.every(p => p.querySelectorAll('.book-note-stack').length === 1), 'one tab stack per page');
  assert.deepEqual(tabsOf(2), ['✎'], 'an empty page shows the write tab');

  // First note: autosave while typing, numbered tab, bookmark.
  pages[2].querySelector('.book-note-add').click();
  let editor = w.document.querySelector('.book-note-editor');
  assert.match(editor.textContent, /Page 3 · new note/);
  const area = editor.querySelector('textarea');
  area.value = 'Cek angka 3.414'; area.dispatchEvent(new w.Event('input'));
  await sleep(500);
  area.value = 'Cek angka 3.414 lagi'; area.dispatchEvent(new w.Event('input'));
  await sleep(500);
  assert.equal(notes.notes()['2'].items.length, 1, 'still one note while typing');
  assert.deepEqual(tabsOf(2), ['1', '＋']);
  assert.deepEqual([...marks.marks()], [2], 'first note bookmarks the page');
  assert.equal(N.typing({ target: area }), true);
  w.document.querySelector('.book-note-done').click();

  // Second note on the same page stacks below.
  pages[2].querySelector('.book-note-add').click();
  w.document.querySelector('.book-note-editor textarea').value = 'Tanya ke tim';
  w.document.querySelector('.book-note-done').click();
  assert.deepEqual(tabsOf(2), ['1', '2', '＋'], 'tabs stack down the edge');
  assert.equal(w.document.getElementById('notes').textContent, '📝 2');

  // Tap tab 2: its text shows beside it; edit and delete from there.
  const tab2 = [...pages[2].querySelectorAll('.book-note-tab')][1];
  tab2.getBoundingClientRect = () => ({ left: 900, right: 930, top: 200, width: 30, height: 36 });
  tab2.click();
  let card = w.document.querySelector('.book-note-card');
  assert.ok(card); assert.equal(card.querySelector('.book-note-card-text').textContent, 'Tanya ke tim');
  assert.ok(pages[2].querySelectorAll('.book-note-tab.is-open').length === 1, 'the open tab sticks out');
  [...card.querySelectorAll('button')].find(b => /Edit/.test(b.textContent)).click();
  editor = w.document.querySelector('.book-note-editor');
  assert.equal(editor.querySelector('textarea').value, 'Tanya ke tim');
  editor.querySelector('textarea').value = 'Tanya ke tim statistik';
  w.document.querySelector('.book-note-done').click();
  assert.equal(notes.notes()['2'].items[1].text, 'Tanya ke tim statistik');
  [...pages[2].querySelectorAll('.book-note-tab')][0].click();
  [...w.document.querySelector('.book-note-card').querySelectorAll('button')].find(b => /Delete/.test(b.textContent)).click();
  assert.deepEqual(notes.notes()['2'].items.map(n => n.text), ['Tanya ke tim statistik'], 'note 1 deleted, note 2 becomes 1');
  assert.deepEqual(tabsOf(2), ['1', '＋']);
  assert.deepEqual([...marks.marks()], [2], 'page stays bookmarked while it has notes');

  // List + text export.
  w.document.getElementById('notes').click();
  assert.deepEqual([...w.document.querySelectorAll('.book-note-row b')].map(b => b.textContent), ['Page 3']);
  assert.match(notes.text(), /\[Page 3\]\nTanya ke tim statistik/);
  w.document.querySelector('.book-note-row').click();
  assert.equal(jumped, 2);

  // Deleting the last note removes the bookmark the note added.
  [...pages[2].querySelectorAll('.book-note-tab')][0].click();
  [...w.document.querySelector('.book-note-card').querySelectorAll('button')].find(b => /Delete/.test(b.textContent)).click();
  assert.equal(notes.notes()['2'], undefined);
  assert.deepEqual([...marks.marks()], []);
  assert.deepEqual(tabsOf(2), ['✎']);

  // Older books saved one note per page: it becomes note 1.
  notes.close();
  localStorage.setItem(key, JSON.stringify({ '1': { text: 'catatan lama', updated: 5, marked: true } }));
  notes = bind();
  assert.deepEqual(notes.notes(), { '1': { items: [{ text: 'catatan lama', updated: 5 }], marked: true } });
  assert.deepEqual(tabsOf(1), ['1', '＋']);
  assert.ok(pages.every(p => p.querySelectorAll('.book-note-stack').length === 1), 'rebinding keeps one stack per page');
  notes.close();
  localStorage.setItem(key, '{broken');
  assert.deepEqual(N.load(key), {}, 'corrupt storage is ignored');
  console.log('PASS notes: agenda tabs, several notes per page, read/edit/delete, autosave, list/export, auto-bookmark, migration, rebind');
})().catch(error => { console.error(error); process.exitCode = 1; });
