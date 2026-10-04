// Shared "Add source" dialog (assets/add-source.js): title, file kinds, upload
// hands over only accepted files (one unless multiple), a wrong kind is
// refused with a message, an error from the page stays in the dialog, and the
// Drive picker is asked for the tool's kinds only.
const assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
const w = dom.window;
global.window = w; global.document = w.document;
w.fetch = async () => ({ ok: true, json: async () => ({ drive: { clientId: 'c', apiKey: 'k' }, token: 't' }) });
let picked = null;
w.DrivePicker = { preload: async () => {}, pick: async (cfg, status, opts) => { picked = opts.mimeTypes; status('Choose a file in Google Drive…'); return new w.File(['%PDF'], 'from-drive.pdf', { type: 'application/pdf' }); } };
require('../assets/add-source.js');
const A = w.AddSource;
const $ = s => w.document.querySelector(s);
const tick = () => new Promise(r => setTimeout(r, 0));
const pick = files => { const input = $('.as-dialog input[type=file]'); Object.defineProperty(input, 'files', { value: files, configurable: true }); input.dispatchEvent(new w.Event('change')); };

(async () => {
  let got = [];
  A.open({ title: 'Merge PDF', subtitle: 'your files', accept: '.pdf', multiple: true, onFiles: files => { got = files; } });
  assert.equal($('.as-dialog').hidden, false);
  assert.match($('#as-title').textContent, /Merge PDF from\s*your files/);
  assert.equal($('.as-drop').textContent, 'Drop files here · PDF');
  assert.equal($('.as-dialog input[type=file]').accept, '.pdf');
  pick([new w.File(['a'], 'a.pdf'), new w.File(['b'], 'b.PDF'), new w.File(['c'], 'c.docx')]);
  await tick();
  assert.deepEqual(got.map(f => f.name), ['a.pdf', 'b.PDF'], 'only the accepted kinds');
  assert.equal($('.as-dialog').hidden, true, 'closes after handing over');
  // Single file + a wrong kind.
  A.open({ title: 'AI Summarizer', subtitle: 'your PDF', accept: '.pdf', onFiles: files => { got = files; } });
  pick([new w.File(['x'], 'song.mp3')]); await tick();
  assert.match($('.as-status').textContent, /song\.mp3: this kind of file can't be used here/);
  assert.equal($('.as-dialog').hidden, false);
  pick([new w.File(['a'], 'a.pdf'), new w.File(['b'], 'b.pdf')]); await tick();
  assert.deepEqual(got.map(f => f.name), ['a.pdf'], 'one file unless multiple');
  // The page's own error stays in the dialog.
  A.open({ title: 'X', accept: '.pdf', onFiles: async () => { throw new Error('Too big'); } });
  pick([new w.File(['a'], 'a.pdf')]); await tick(); await tick();
  assert.equal($('.as-status').textContent, 'Too big'); assert.equal($('.as-dialog').hidden, false);
  // Google Drive: only the tool's kinds (PDF + Google files exported as PDF).
  A.open({ title: 'X', accept: '.pdf', onFiles: files => { got = files; } });
  $('[data-source="drive"]').click(); await tick(); await tick(); await tick();
  assert.ok(picked.includes('application/pdf') && picked.includes('application/vnd.google-apps.document') && !picked.includes('image/png'));
  assert.deepEqual(got.map(f => f.name), ['from-drive.pdf']);
  console.log('PASS add-source: title & kinds, accepted files only, single vs multiple, wrong kind message, page errors kept, Drive filtered to the tool');
})().catch(error => { console.error(error); process.exit(1); });
