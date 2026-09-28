// Flipbook page links with the real pdf.js: PDF link annotations and
// plain-text tables of contents (printed numbers offset from PDF pages).
// Fixtures: tests/fixtures/toc-links.pdf (real GoTo + URL links) and
// toc-text.pdf (text-only TOC "Pendahuluan ..... 1" on page 2; chapters on
// PDF pages 3, 5, 7, 9, 11).
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const pdfjs = require('../assets/vendor/pdf.min.js');
pdfjs.GlobalWorkerOptions.workerSrc = path.resolve('assets/vendor/pdf.worker.min.js');
globalThis.pdfjsLib = pdfjs;
require('../assets/pdf-links.js');
require('../assets/flipbook-export.js');
const { PdfLinks, FlipbookExport } = globalThis;

async function links(name) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync('tests/fixtures/' + name)), verbosity: 0 }).promise;
  return PdfLinks.extract(pdf);
}
(async () => {
  const real = await links('toc-links.pdf');
  assert.deepEqual(Object.keys(real.links), ['1'], 'links only on the TOC page');
  assert.deepEqual(real.links['1'].map(l => l.page ?? l.url), [2, 4, 6, 8, 10, 'https://sarvamaya.com/']);
  assert.deepEqual(real.stats, { internal: 5, external: 1, toc: 0 }, 'real links win; no auto TOC on top of them');
  for (const l of real.links['1']) assert.ok([l.x, l.y, l.w, l.h].every(v => v >= 0 && v <= 1) && l.w > 0.3 && l.h > 0.005);

  const text = await links('toc-text.pdf');
  assert.deepEqual(text.links['1'].map(l => l.page), [2, 4, 6, 8, 10], 'printed 1,3,5,7,9 resolved to the heading pages');
  assert.equal(text.stats.toc, 5);
  const first = text.links['1'][0];
  assert.ok(first.y > 0.15 && first.y < 0.2 && first.x < 0.15, 'hotspot sits on the first TOC line');

  // Export validation keeps good links and rejects unsafe/out-of-range ones.
  const base = { version: 1, title: 'T', pageCount: 12, ratio: 0.7, overlays: {} };
  const ok = FlipbookExport.validate(Object.assign({}, base, { links: real.links }));
  assert.equal(ok.links['1'].length, 6);
  assert.deepEqual(FlipbookExport.validate(base).links, {}, 'older projects without links still load');
  const bad = extra => () => FlipbookExport.validate(Object.assign({}, base, { links: { '1': [Object.assign({ x: 0.1, y: 0.1, w: 0.2, h: 0.05 }, extra)] } }));
  assert.throws(bad({ url: 'javascript:alert(1)' }), /Tujuan/);
  assert.throws(bad({ page: 12 }), /Tujuan/);
  assert.throws(bad({ page: 1, x: 1.5 }), /Posisi/);
  assert.throws(() => FlipbookExport.validate(Object.assign({}, base, { links: { '12': [] } })), /Halaman/);
  console.log('PASS page links: PDF GoTo + URL annotations, text TOC with offset numbering, export validation');
})().catch(error => { console.error(error); process.exit(1); });
