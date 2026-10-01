// MyFlipbook's own confirm / message box (assets/mf-dialog.js): answers, keys,
// click outside, focus (a dangerous action starts on Cancel), text is text.
const fs = require('node:fs'), assert = require('node:assert/strict');
const {JSDOM} = require('../.build/qa-runtime/node_modules/jsdom');

(async () => {
  const dom = new JSDOM('<!doctype html><html lang="id"><head></head><body><button id="trigger">x</button></body></html>', {runScripts: 'outside-only'});
  const w = dom.window, d = w.document;
  w.eval(fs.readFileSync('assets/mf-dialog.js', 'utf8'));
  const box = () => d.querySelector('.mfd-back');
  const key = k => d.dispatchEvent(new w.KeyboardEvent('keydown', {key: k, bubbles: true}));

  // OK -> true; title, message, buttons, Indonesian default "Batal"; text never parsed as HTML.
  d.querySelector('#trigger').focus();
  let answer = w.MFDialog.confirm({title: 'Hapus "<b>Buku</b>"?', message: 'Tidak bisa\ndibatalkan.', ok: 'Hapus', danger: true});
  assert.ok(box(), 'shown');
  assert.equal(d.querySelector('.mfd-title').textContent, 'Hapus "<b>Buku</b>"?');
  assert.equal(d.querySelector('.mfd-title b'), null, 'title is text, not HTML');
  assert.equal(d.querySelector('.mfd-card').getAttribute('role'), 'alertdialog');
  assert.equal(d.querySelector('.mfd-cancel').textContent, 'Batal');
  assert.ok(d.querySelector('.mfd-card').classList.contains('danger'));
  assert.equal(d.activeElement, d.querySelector('.mfd-cancel'), 'dangerous: focus starts on Cancel');
  key('Tab'); assert.equal(d.activeElement, d.querySelector('.mfd-ok'), 'Tab stays inside the box');
  key('Tab'); assert.equal(d.activeElement, d.querySelector('.mfd-cancel'));
  d.querySelector('.mfd-ok').click();
  assert.equal(await answer, true); assert.equal(box(), null, 'closed');
  assert.equal(d.activeElement, d.querySelector('#trigger'), 'focus goes back');

  // Esc and Cancel -> false; a click outside -> false, a click on the card doesn't close.
  answer = w.MFDialog.confirm('Lanjut?'); key('Escape'); assert.equal(await answer, false);
  answer = w.MFDialog.confirm({message: 'Lanjut?'}); d.querySelector('.mfd-cancel').click(); assert.equal(await answer, false);
  answer = w.MFDialog.confirm({message: 'Lanjut?'});
  assert.equal(d.activeElement, d.querySelector('.mfd-ok'), 'normal confirm starts on OK');
  d.querySelector('.mfd-card').dispatchEvent(new w.MouseEvent('mousedown', {bubbles: true}));
  assert.ok(box(), 'click inside keeps it open');
  box().dispatchEvent(new w.MouseEvent('mousedown', {bubbles: true}));
  assert.equal(await answer, false);

  // Message box: one button, resolves when closed; style injected once.
  const done = w.MFDialog.alert({title: 'Selesai', message: 'Tersimpan.'});
  assert.equal(d.querySelectorAll('.mfd-btn').length, 1);
  d.querySelector('.mfd-ok').click(); assert.equal(await done, undefined);
  assert.equal(d.querySelectorAll('#mfd-style').length, 1);

  // Pages use it instead of the browser's confirm().
  for (const page of ['library.html', 'notebook.html', 'workflow.html']) {
    const html = fs.readFileSync(page, 'utf8');
    assert.ok(html.includes('assets/mf-dialog.js'), page + ' loads mf-dialog.js');
    assert.ok(!/[^.\w]confirm\(/.test(html.replace(/MFDialog\.confirm\(/g, '')), page + ' has no browser confirm()');
  }
  console.log('PASS mf-dialog: OK/Cancel/Esc/outside click, danger focus on Cancel, Tab trap, text-only, alert, pages switched');
})().catch(error => { console.error(error); process.exit(1); });
