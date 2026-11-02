// A highlight's AI note (summary / translation) opens as wide as the book with a chat under it: a question goes
// to onAsk with the passage, its note and the earlier turns; the answer can be added to
// the note; a failure is shown and the next question still works. Quotes and plain notes stay small.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body><button id="notes"></button></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage;
require('../assets/export/layout.js');
const N = global.FlipbookNotes;
const tick = () => new Promise(r => setTimeout(r, 0));
const $ = s => w.document.querySelector(s);

// Two pages side by side: the book is 200..1000 wide, 50..650 high.
const pages = [0, 1].map(i => {
  const p = w.document.createElement('article'); w.document.body.appendChild(p);
  p.getBoundingClientRect = () => ({ left: 200 + i * 400, right: 600 + i * 400, top: 50, bottom: 650, width: 400, height: 600 });
  return p;
});
Object.defineProperty(w, 'innerWidth', { value: 1200 }); Object.defineProperty(w, 'innerHeight', { value: 800 });
const asked = []; let answer = null;
const notes = N.bind({ key: N.key('Chat', 2, 0.7), title: 'Chat', pages, goPage: () => {}, open: $('#notes'), blank: false,
  onAsk: ask => { asked.push(ask); return new Promise((ok, no) => { answer = { ok, no }; }); },
  askLabels: { send: 'Kirim', add: '＋ Tambahkan ke catatan', starters: ['Beri saran praktis', 'Apa contohnya?'] } });
const items = i => (notes.notes()[i] || { items: [] }).items;

(async () => {
  await notes.summary(1, 'keteladanan guru', '#bbf7d0', () => 'Karakter tumbuh dari teladan.');
  pages[1].querySelector('.book-note-tab.has-note').click();
  const card = $('.book-note-card');
  assert.ok(card.classList.contains('is-chat'), 'highlight note: chat card');
  assert.equal(card.style.width, '800px', 'as wide as the book');
  assert.equal(card.style.left, '200px'); assert.equal(card.style.top, '50px'); assert.equal(card.style.height, '600px');
  assert.ok($('.book-note-chat-intro'), 'intro before the first question');
  assert.ok($('.book-note-chat-log').contains($('.book-note-card-text')) && $('.book-note-chat-log').contains($('.book-note-chat-msgs')), 'note text and chat in one scroll');
  assert.equal(card.querySelector('.book-note-actions'), null, 'no Delete / Edit row on the chat card');
  card.querySelector('.book-note-card-close').click();
  assert.equal($('.book-note-card'), null, '✕ closes it');
  pages[1].querySelector('.book-note-tab.has-note').click();

  const input = $('.book-note-chat-form input'), form = $('.book-note-chat-form');
  const chips = () => [...w.document.querySelectorAll('.book-note-chat-chip')].map(c => c.textContent);
  assert.deepEqual(chips(), ['Beri saran praktis', 'Apa contohnya?'], 'starters before the first question');
  // A starter clicked is asked at once.
  w.document.querySelector('.book-note-chat-chip').click(); await tick();
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0], { page: 1, quote: 'keteladanan guru', note: '✨ Karakter tumbuh dari teladan.', question: 'Beri saran praktis', history: [] });
  assert.deepEqual(chips(), [], 'no choices while it answers');
  assert.equal($('.book-note-chat-send').disabled, true, 'one question at a time');
  input.value = 'lagi'; form.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  assert.equal(asked.length, 1);

  answer.ok({ text: 'Saran: mulai dari guru (hlm. 2).', suggestions: ['Bagaimana caranya?', 7, ' ', 'Siapa yang memulai?'] }); await tick(); await tick();
  const msgs = () => [...w.document.querySelectorAll('.book-note-chat-msg')].map(m => m.className.replace('book-note-chat-msg ', '') + ':' + m.querySelector('p').textContent);
  assert.deepEqual(msgs(), ['is-user:Beri saran praktis', 'is-assistant:Saran: mulai dari guru (hlm. 2).']);
  assert.deepEqual(chips(), ['Bagaimana caranya?', 'Siapa yang memulai?'], "the AI's follow-ups to click");

  // Add the answer to the note: the note grows, the card shows it.
  $('.book-note-chat-add').click();
  assert.equal(items(1)[0].text, '✨ Karakter tumbuh dari teladan.\n\nSaran: mulai dari guru (hlm. 2).');
  assert.equal(items(1)[0].q, 'keteladanan guru', 'still linked to its highlight');
  assert.equal($('.book-note-card-text').textContent, items(1)[0].text);
  assert.equal($('.book-note-chat-add'), null, 'added once');

  // A failure is shown; the next question carries the earlier turns.
  input.value = 'Tambah dari buku'; form.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  answer.no(Error('Kuota habis')); await tick(); await tick();
  assert.deepEqual(chips(), [], 'after a failure: no stale choices');
  assert.match(msgs()[3], /is-error:Kuota habis/);
  input.value = 'Coba lagi'; form.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  assert.deepEqual(asked[2].history, [{ role: 'user', text: 'Beri saran praktis' }, { role: 'assistant', text: 'Saran: mulai dari guru (hlm. 2).' }, { role: 'user', text: 'Tambah dari buku' }]);
  answer.ok('Oke.'); await tick(); await tick();

  // Closed and opened again: the chat is still there (this visit).
  notes.close();
  pages[1].querySelector('.book-note-tab.has-note').click();
  assert.equal(w.document.querySelectorAll('.book-note-chat-msg').length, 6);
  notes.close();

  // A plain quote note keeps the small card, no chat.
  notes.quote(1, 'teks lain', '#fde68a');
  pages[1].querySelectorAll('.book-note-tab.has-note')[1].click();
  assert.equal($('.book-note-card').classList.contains('is-chat'), false);
  assert.equal($('.book-note-chat'), null);
  assert.equal($('.book-note-card').style.width, '320px');
  assert.ok($('.book-note-card .book-note-delete') && $('.book-note-card .book-note-done'), 'small cards keep Delete / Edit');
  assert.equal($('.book-note-card .book-note-card-close'), null);
  console.log('PASS note chat: highlight notes as wide as the book, ask with passage + note + history, add answer to note, errors, plain notes unchanged');
})().catch(e => { console.error(e); process.exit(1); });
