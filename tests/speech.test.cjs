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
// Capitals: pronounceable words are read as words, acronyms stay spelled.
assert.equal(S.say('Selamat datang di NUSANTARA MAHAYATRA.'), 'Selamat datang di Nusantara Mahayatra.');
assert.equal(S.say('Laporan UMKM dan BUMN dalam PDF oleh DPRD.'), 'Laporan UMKM dan BUMN dalam PDF oleh DPRD.');
assert.equal(S.say('Program AI untuk JKT2A.'), 'Program AI untuk JKT2A.');
assert.equal(S.say('STRATEGI PROGRAM KERJA'), 'Strategi Program Kerja');
assert.equal(S.say('VISI DAN MISI YANG BARU'), 'Visi Dan Misi Yang Baru', 'a heading in capitals reads as words');
assert.equal(S.say('(PENTING) catatan'), '(Penting) catatan', 'punctuation kept');
assert.equal(S.say('Teks FILM dan TEKS'), 'Teks Film dan Teks');
assert.deepEqual(S.chunks(['KATA PENGANTAR', 'Buku ini tentang NUSANTARA.']), ['Kata Pengantar Buku ini tentang Nusantara.']);
// Language.
assert.equal(S.lang('Ini adalah buku yang dibuat untuk anak dan keluarga'), 'id-ID');
assert.equal(S.lang('This is the book that we made for the family'), 'en-US');
assert.equal(S.lang('Buku ini iaitu untuk semua rakyat kerana kerajaan boleh membantu anda sahaja, sila baca'), 'ms-MY', 'Malay');
assert.equal(S.lang('Video ini telah dibuat bagi anda yang ingin tahu, kerana menarik'), 'id-ID', 'one Malay word is not enough');
assert.equal(S.lang('Buku ini adalah untuk semua orang karena pemerintah bisa membantu'), 'id-ID', 'Indonesian');

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
  await sleep(30);
  assert.deepEqual(spoken, [], 'Listen alone says nothing until a word is clicked');
  speech.start();                                           // e.g. a click on the first word
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
  // Click a word while reading: read on from that word; the piece being read is marked.
  {
    const raw = [[1000, 300, 1000, 1000, 2200, 800, 3200, 900], [1400, 300, 1000, 1200, 2400, 700, 3300, 1100]];
    const lines = ['Satu langkah seribu.', 'Makna untuk semua.'];
    const page = w.document.createElement('article'); w.document.body.appendChild(page);
    page.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000 });
    const heard = []; let finish = null;
    const held = { speak(text, lang, done) { heard.push(text); finish = done; }, stop() {} };
    let busy = false;
    const s3 = S.bind({ text: { '0': lines }, words: { '0': raw }, pages: [page], visible: () => [0], next: () => false, engine: held, busy: () => busy });
    const down = (x, y) => page.dispatchEvent(new w.MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
    // Not reading: a click does nothing (the page turns as usual).
    down(250, 110); assert.deepEqual(heard, []);
    // Listen: silent, and a manual page turn doesn't start it either.
    s3.arm(); assert.deepEqual(heard, []); s3.pageChanged(); assert.deepEqual(heard, []);
    // The first word click starts reading there.
    down(110, 110); assert.deepEqual(heard, ['Satu langkah seribu. Makna untuk semua.']); heard.length = 0;
    s3.start();
    assert.deepEqual(heard, ['Satu langkah seribu. Makna untuk semua.']);
    assert.ok(w.document.body.classList.contains('is-reading'), 'speaker cursor on');
    let marks = [...page.querySelectorAll('.book-reading span')];
    assert.equal(marks.length, 2, 'both lines of the piece marked');
    assert.equal(marks[0].style.left, '10%'); assert.equal(marks[0].style.top, '10%');
    // Click "seribu" (3rd word of line 1): reads from there.
    let outside = 0; w.document.body.addEventListener('mousedown', () => { outside++; });
    down(360, 115);
    assert.equal(heard[1], 'seribu. Makna untuk semua.');
    assert.equal(outside, 0, 'the click on a word never reaches PageFlip');
    marks = [...page.querySelectorAll('.book-reading span')];
    assert.equal(marks[0].style.left, '32%', 'the mark starts at the clicked word');
    // Click "untuk" (2nd word of line 2).
    down(270, 150); assert.equal(heard[2], 'untuk semua.');
    // A margin click is not a word: the page keeps it.
    down(900, 800); assert.equal(heard.length, 3); assert.equal(outside, 1);
    // While the highlighter owns clicks, nothing happens.
    busy = true; down(110, 110); assert.equal(heard.length, 3); busy = false;
    s3.close();
    assert.equal(page.querySelector('.book-reading'), null, 'mark removed on stop');
    assert.ok(!w.document.body.classList.contains('is-reading'));
    down(110, 110); assert.equal(heard.length, 3, 'listeners removed on close');
  }

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
  const pickFor = (lang, voices) => {
    let used = null;
    w.SpeechSynthesisUtterance = function (text) { this.text = text; };
    w.speechSynthesis = { getVoices: () => voices, speak: u => { used = u; }, cancel() {} };
    S.engine().speak('Hello', lang, () => {});
    return used.voice ? used.voice.name + ' ' + used.lang : 'default ' + used.lang;
  };
  const chrome = [v('Google US English', 'en-US'), v('Google UK English Male', 'en-GB'), v('Google Bahasa Indonesia', 'id-ID')];
  assert.equal(pickFor('en-US', [v('Google UK English Male', 'en-GB')].concat(chrome)), 'Google US English en-US', 'Chrome English: a woman, not UK Male');
  assert.equal(pickFor('en-US', [v('Microsoft David - English (United States)', 'en-US'), v('Microsoft Zira - English (United States)', 'en-US')]), 'Microsoft Zira - English (United States) en-US', 'Windows: Zira, not David');
  assert.equal(pickFor('en-US', [v('Microsoft Guy Online (Natural) - English (United States)', 'en-US'), v('Microsoft Aria Online (Natural) - English (United States)', 'en-US')]), 'Microsoft Aria Online (Natural) - English (United States) en-US', 'Edge: Aria');
  assert.equal(pickFor('ms-MY', [v('Microsoft Osman Online (Natural) - Malay (Malaysia)', 'ms-MY'), v('Microsoft Yasmin Online (Natural) - Malay (Malaysia)', 'ms-MY')]), 'Microsoft Yasmin Online (Natural) - Malay (Malaysia) ms-MY', 'Edge Malay: Yasmin');
  assert.equal(pickFor('ms-MY', chrome), 'Google Bahasa Indonesia id-ID', 'no Malay voice (Chrome): the Indonesian one');
  delete w.speechSynthesis; delete w.SpeechSynthesisUtterance;
  console.log('PASS speech: chunks, language, reads the spread then turns, skips pages without text, follows manual turns, stops at the end, picks an Indonesian woman voice, click a word to read from there, capitals read as words, Malay and English voices, Listen waits for a word');
})().catch(e => { console.error(e); process.exit(1); });
