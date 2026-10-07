// Page editor engine (assets/page-editor-core.js): text runs -> lines ->
// paragraphs, word wrap, and the edited PDF (unedited pages copied as they
// were, edited pages rebuilt from background + text/images/shapes).
const assert = require('node:assert/strict');
global.PDFLib = require('../.build/qa-runtime/node_modules/pdf-lib');
const { createCanvas, DOMMatrix, Path2D } = require('../.build/qa-runtime/node_modules/@napi-rs/canvas');
global.DOMMatrix = DOMMatrix; global.Path2D = Path2D;
const pdfjs = require('../assets/vendor/pdf.min.js');
pdfjs.GlobalWorkerOptions.workerSrc = require('node:path').resolve('assets/vendor/pdf.worker.min.js');
require('../assets/page-editor-core.js');
const E = globalThis.PageEditorCore;

const factory = new class {
  create(w, h) { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; }
  reset(o, w, h) { o.canvas.width = w; o.canvas.height = h; }
  destroy(o) { o.canvas.width = 0; o.canvas.height = 0; }
};
const open = b => pdfjs.getDocument({ data: new Uint8Array(b), isEvalSupported: false, useSystemFonts: true, canvasFactory: factory }).promise;
async function text(b, n) { const d = await open(b); const c = await (await d.getPage(n)).getTextContent(); await d.destroy(); return c.items.map(i => i.str).join(' ').replace(/\s+/g, ' '); }
async function pixel(b, n, fx, fy) {
  const d = await open(b), page = await d.getPage(n), vp = page.getViewport({ scale: 0.5 });
  const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; await d.destroy();
  return [...c.getContext('2d').getImageData(Math.floor(fx * c.width), Math.floor(fy * c.height), 1, 1).data].slice(0, 3);
}

async function main() {
  assert.equal(E.family('ABCDEF+TimesNewRomanPS-BoldMT'), 'serif');
  assert.equal(E.family('Arial'), 'sans'); assert.equal(E.family('CourierNew'), 'mono'); assert.equal(E.family('sans-serif'), 'sans');

  // Runs of one line join (with a space where the gap is a word gap); a new baseline starts a line.
  const runs = [
    { str: 'Sebagaimana', x: 10, y: 100, w: 90, h: 12 }, { str: 'pelayaran', x: 104, y: 100, w: 70, h: 12 },
    { str: 'sebuah perahu', x: 10, y: 116, w: 100, h: 12 }, { str: 'Judul', x: 10, y: 40, w: 60, h: 24 },
  ];
  const lines = E.groupLines(runs);
  assert.deepEqual(lines.map(l => l.text), ['Judul', 'Sebagaimana pelayaran', 'sebuah perahu']);
  // Paragraphs: the two body lines merge, the big title stays alone; hyphenated words rejoin.
  const blocks = E.paragraphs([...lines, { text: 'se-', x: 10, y: 160, w: 30, h: 12 }, { text: 'hari penuh', x: 10, y: 176, w: 80, h: 12 }]);
  assert.deepEqual(blocks.map(b => b.text), ['Judul', 'Sebagaimana pelayaran sebuah perahu', 'sehari penuh']);
  assert.equal(blocks[1].lines, 2); assert.ok(blocks[1].lineHeight > 1 && blocks[1].lineHeight < 1.6);

  // Wrap: by width, explicit newlines kept, an over-long word is cut.
  const m = s => s.length;
  assert.deepEqual(E.wrap('satu dua tiga empat', m, 9), ['satu dua', 'tiga', 'empat']);
  assert.deepEqual(E.wrap('a\nb c', m, 10), ['a', 'b c']);
  assert.deepEqual(E.wrap('panjaaaaaaang', m, 5), ['panja', 'aaaaa', 'ang']);

  // Export: page 1 edited (background + new text + image + rectangle), page 2 untouched.
  const { PDFDocument, StandardFonts } = PDFLib;
  const src = await PDFDocument.create(), f = await src.embedFont(StandardFonts.Helvetica);
  src.addPage([400, 600]).drawText('Teks lama halaman satu', { x: 40, y: 500, size: 18, font: f });
  src.addPage([400, 600]).drawText('Halaman dua tetap asli', { x: 40, y: 500, size: 18, font: f });
  const bytes = await src.save();
  const bg = createCanvas(400, 600); const g = bg.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 400, 600);
  const red = createCanvas(40, 20); red.getContext('2d').fillStyle = '#d00000'; red.getContext('2d').fillRect(0, 0, 40, 20);
  const edits = { 0: { size: [400, 600], background: bg.toBuffer('image/jpeg'), elements: [
    { type: 'text', x: 0.1, y: 0.1, w: 0.8, h: 0.1, text: 'Teks baru yang diedit — “kutipan”', fontSize: 0.03, family: 'serif', bold: true, color: '#1d4ed8' },
    { type: 'image', x: 0.5, y: 0.5, w: 0.3, h: 0.1, src: 'data:image/png;base64,' + red.toBuffer('image/png').toString('base64') },
    { type: 'rect', x: 0.1, y: 0.8, w: 0.2, h: 0.1, fill: '#00a000' },
    { type: 'text', x: 0.1, y: 0.3, w: 0.8, h: 0.1, text: 'Huruf aneh 日本', fontSize: 0.03 },
  ] } };
  const { bytes: out, missing } = await E.exportPdf(bytes, edits, { report: true });
  const t1 = await text(out, 1);
  assert.match(t1, /Teks baru yang diedit/); assert.doesNotMatch(t1, /Teks lama/, 'old text replaced');
  assert.deepEqual(missing.sort(), ['日', '本'], 'characters outside the PDF fonts are reported');
  assert.match(await text(out, 2), /Halaman dua tetap asli/, 'untouched page copied as text');
  const r = await pixel(out, 1, 0.65, 0.55); assert.ok(r[0] > 180 && r[1] < 60, 'image placed ' + r);
  const gr = await pixel(out, 1, 0.2, 0.85); assert.ok(gr[1] > 120 && gr[0] < 60, 'rectangle filled ' + gr);
  const doc = await PDFDocument.load(out); assert.equal(doc.getPageCount(), 2);
  assert.deepEqual([doc.getPage(0).getWidth(), doc.getPage(0).getHeight()], [400, 600]);
  // Page order can be chosen (e.g. after reordering).
  const swapped = await E.exportPdf(bytes, {}, { order: [1, 0] });
  assert.match(await text(swapped, 1), /Halaman dua/);
  console.log('page-editor core tests passed');
}
main().catch(e => { console.error(e); process.exit(1); });
