// Engine contract the organize mini-reader relies on (converter.html):
// - with zero geometry, flip() silently does nothing (proven here);
//   update() recalculates from live layout and rescues it;
// - destroy() removes its own block (rebuilds must use updateFromHtml);
// - turnToPage() lands exactly even when flip() is swallowed.
const fs = require('node:fs'), assert = require('node:assert/strict');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="box"></div></body></html>',
    { url: 'http://127.0.0.1:8080/converter.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, errors = [];
  w.addEventListener('error', e => errors.push(e.error || e.message));
  w.eval(fs.readFileSync('assets/vendor/page-flip.browser.js', 'utf8'));
  const pages = n => {
    let box = w.document.getElementById('box');
    if (!box) { box = w.document.createElement('div'); box.id = 'box'; w.document.body.append(box); }
    box.innerHTML = '';
    for (let i = 0; i < n; i++) { const d = w.document.createElement('div'); box.append(d); }
    return Array.from(box.children);
  };
  const settings = { width: 320, height: 440, size: 'stretch', minWidth: 200, maxWidth: 700, minHeight: 140, maxHeight: 560, autoSize: true, usePortrait: true, showCover: false, useMouseEvents: true, swipeDistance: 30, showPageCorners: false, disableFlipByClick: false, mobileScrollSupport: true };
  // Zero geometry (hidden/collapsed container): flip silently goes nowhere.
  let book = new w.St.PageFlip(w.document.getElementById('box'), settings);
  book.loadFromHTML(pages(10));
  book.flip(5); await sleep(1400);
  assert.equal(book.getCurrentPageIndex(), 0, 'zero geometry: flip is a silent no-op');
  // Layout appears later: update() rescues the same instance, no rebuild needed.
  for (const k of ['clientWidth', 'offsetWidth']) Object.defineProperty(w.HTMLElement.prototype, k, { configurable: true, get() { return 900; } });
  for (const k of ['clientHeight', 'offsetHeight']) Object.defineProperty(w.HTMLElement.prototype, k, { configurable: true, get() { return 600; } });
  w.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, width: this.offsetWidth, height: this.offsetHeight, right: this.offsetWidth, bottom: this.offsetHeight }; };
  book.update();
  book.flip(5); await sleep(1400);
  assert.ok(book.getCurrentPageIndex() > 0, 'update() rescues flipping after layout appears');
  book.turnToPage(6); await sleep(100);
  assert.equal(book.getCurrentPageIndex(), 6, 'turnToPage lands exactly');
  // destroy() takes its own block out of the document.
  book.destroy();
  assert.equal(w.document.getElementById('box'), null, 'destroy removes its block');
  // Rebuild on a fresh box, then refresh in place without destroy.
  book = new w.St.PageFlip(w.document.getElementById('box') || (() => { const b = w.document.createElement('div'); b.id = 'box'; w.document.body.append(b); return b; })(), settings);
  book.loadFromHTML(pages(10));
  book.updateFromHtml(pages(8));
  assert.ok(w.document.getElementById('box'), 'update keeps the block in the DOM');
  book.turnToPage(7); await sleep(100);
  assert.equal(book.getCurrentPageIndex(), 6, 'turnToPage lands on the spread start');
  assert.equal(errors.length, 0, String(errors.slice(0, 3)));
  book.destroy(); w.close();
  console.log('PASS organize reader engine: zero-geometry silence, update() rescue, destroy/update/turnToPage');
}
main().catch(e => { console.error(e); process.exit(1); });
