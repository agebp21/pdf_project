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
    { str: 'Sebagaimana pelayaran sebuah', x: 10, y: 100, w: 150, h: 12 }, { str: 'perahu dimungkinkan karena', x: 164, y: 100, w: 140, h: 12 },
    { str: 'aneka faktor pendukung dan awak kapal', x: 10, y: 116, w: 290, h: 12 }, { str: 'Judul', x: 10, y: 40, w: 60, h: 24 },
  ];
  const lines = E.groupLines(runs);
  assert.deepEqual(lines.map(l => l.text), ['Judul', 'Sebagaimana pelayaran sebuah perahu dimungkinkan karena', 'aneka faktor pendukung dan awak kapal']);
  // Table of contents: title and page number are columns, also with a condensed font (em < h).
  const toc = E.groupLines([{ str: '13. Rencana Besar Wanda', x: 100, y: 300, w: 150, h: 12 }, { str: '106', x: 290, y: 300, w: 20, h: 12 },
    { str: '14. Buku Harta', x: 100, y: 320, w: 90, h: 16, em: 10 }, { str: '116', x: 212, y: 320, w: 20, h: 16, em: 10 },
    { str: 'kata', x: 100, y: 340, w: 30, h: 12 }, { str: 'biasa', x: 134, y: 340, w: 30, h: 12 }]);
  assert.deepEqual(toc.map(l => l.text), ['13. Rencana Besar Wanda', '106', '14. Buku Harta', '116', 'kata biasa']);
  // Paragraphs: the two body lines merge, the big title stays alone; hyphenated words rejoin.
  const blocks = E.paragraphs([...lines, { text: 'ini kalimat panjang yang berakhir se-', x: 10, y: 160, w: 280, h: 12 }, { text: 'hari penuh', x: 10, y: 176, w: 80, h: 12 }]);
  assert.deepEqual(blocks.map(b => b.text), ['Judul', 'Sebagaimana pelayaran sebuah perahu dimungkinkan karena aneka faktor pendukung dan awak kapal',
    'ini kalimat panjang yang berakhir sehari penuh']);
  // Labels, addresses and table rows (short lines) stay separate lines.
  const labels = E.paragraphs([{ text: 'Subtotal', x: 300, y: 400, w: 50, h: 10 }, { text: 'Total excluding tax', x: 300, y: 414, w: 100, h: 10 },
    { text: 'VAT - Indonesia (11% incl. on Rp314,414.41)', x: 300, y: 428, w: 210, h: 10 }]);
  assert.equal(labels.length, 3, 'short lines are not merged');
  const amounts = E.paragraphs(['Rp349,000.00', 'Rp314,414.41', 'Rp34,585.59', 'Rp349,000.00'].map((t, i) => ({ text: t, x: 490, y: 400 + i * 16, w: 60, h: 10 })));
  assert.equal(amounts.length, 4, 'a column of amounts stays one per line');
  assert.equal(E.clean('71F029DE\u20110009 Aug 26\u2011Sep\u00a026 \ufb01le'), '71F029DE-0009 Aug 26-Sep 26 file');
  assert.equal(blocks[1].lines, 2); assert.ok(blocks[1].lineHeight > 1 && blocks[1].lineHeight < 1.6);

  // Wrap: by width, explicit newlines kept, an over-long word is cut.
  const m = s => s.length;
  assert.deepEqual(E.wrap('satu dua tiga empat', m, 9), ['satu dua', 'tiga', 'empat']);
  assert.deepEqual(E.wrap('a\nb c', m, 10), ['a', 'b c']);
  assert.deepEqual(E.wrap('panjaaaaaaang', m, 5), ['panja', 'aaaaa', 'ang']);

  // Export: page 1 edited (background + new text + image + rectangle), page 2 untouched.
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
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

  // Layers: a full-page photo under a see-through white panel and text. The design
  // layer comes out transparent over the photo, half-transparent under the panel.
  {
    const ad = await PDFDocument.create(), fo = await ad.embedFont(StandardFonts.HelveticaBold);
    const photo = createCanvas(80, 120); const pc = photo.getContext('2d'); pc.fillStyle = '#3060c0'; pc.fillRect(0, 0, 80, 120);
    const pg = ad.addPage([400, 600]);
    pg.drawImage(await ad.embedPng(photo.toBuffer('image/png')), { x: 0, y: 0, width: 400, height: 600 });
    pg.drawRectangle({ x: 200, y: 450, width: 180, height: 100, color: rgb(1, 1, 1), opacity: 0.5 });
    pg.drawText('MARVEL', { x: 220, y: 490, size: 28, font: fo, color: rgb(0, 0, 0) });
    const adBytes = await ad.save();
    const keyPng = c => { const k = createCanvas(1, 1), g = k.getContext('2d'); g.fillStyle = `rgb(${c.join(',')})`; g.fillRect(0, 0, 1, 1); return k.toBuffer('image/png'); };
    const k1 = await E.keyPictures(adBytes, keyPng(E.KEY1)), k2 = await E.keyPictures(adBytes, keyPng(E.KEY2));
    assert.equal(k1.replaced, 1, 'one picture replaced');
    const raster = async b => { const d = await open(b), pp = await d.getPage(1), vp = pp.getViewport({ scale: 0.5 });
      const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height)); await pp.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; await d.destroy();
      return c.getContext('2d').getImageData(0, 0, c.width, c.height); };
    const r1 = await raster(k1.bytes), r2 = await raster(k2.bytes);
    const layer = E.unkey(r1.data, r2.data), at = (fx, fy) => { const i = (Math.floor(fy * r1.height) * r1.width + Math.floor(fx * r1.width)) * 4; return [...layer.slice(i, i + 4)]; };
    assert.ok(at(0.2, 0.5)[3] < 10, 'photo area is transparent ' + at(0.2, 0.5));
    const panel = at(0.9, 0.1);
    assert.ok(panel[3] > 100 && panel[3] < 160 && panel[0] > 230, 'see-through white panel kept half transparent ' + panel);
    // Text removal keeps transparency (no white/black box left behind).
    const data = new Uint8ClampedArray(layer); E.repair(data, r1.width, r1.height, [{ x0: 0.1 * r1.width, y0: 0.4 * r1.height, x1: 0.3 * r1.width, y1: 0.45 * r1.height }]);
    const i = (Math.floor(0.42 * r1.height) * r1.width + Math.floor(0.2 * r1.width)) * 4;
    assert.ok(data[i + 3] < 10, 'repaired area over the photo stays transparent');
    // Saving: a new picture under the design layer shows through the panel.
    const layerCanvas = createCanvas(r1.width, r1.height), ld = layerCanvas.getContext('2d').createImageData(r1.width, r1.height);
    ld.data.set(layer); layerCanvas.getContext('2d').putImageData(ld, 0, 0);
    const green = createCanvas(40, 60); green.getContext('2d').fillStyle = '#00a000'; green.getContext('2d').fillRect(0, 0, 40, 60);
    const saved = await E.exportPdf(adBytes, { 0: { size: [400, 600], background: layerCanvas.toBuffer('image/png'), elements: [
      { type: 'image', under: true, x: 0, y: 0, w: 1, h: 1, src: 'data:image/png;base64,' + green.toBuffer('image/png').toString('base64') }] } });
    const open1 = await pixel(saved, 1, 0.2, 0.6), under = await pixel(saved, 1, 0.9, 0.1);
    assert.ok(open1[1] > 120 && open1[0] < 60, 'new picture visible ' + open1);
    assert.ok(under[1] > under[0] + 40 && under[0] > 90, 'panel still lightens the picture under it ' + under);
  }
  // Table of contents rows (title + page number on one baseline) never merge into a paragraph.
  const tocRows = ['8. Memulai dari yang Kecil sekali', '9. Proyek Percomblangan yang panjang', '10. Kurator Muda di kota besar'].flatMap((t, i) => [
    { text: t, x: 100, y: 300 + i * 16, w: 200, h: 12 }, { text: String(65 + i * 7), x: 330, y: 300 + i * 16, w: 14, h: 12 }]);
  assert.equal(E.paragraphs(tocRows).length, 6, 'rows with a page number stay one line each');

  // The PDF's own embedded font: pdf.js hands its file over, the export embeds it again.
  const narrow = 'C:/Windows/Fonts/ARIALN.TTF';
  if (require('node:fs').existsSync(narrow)) {
    globalThis.fontkit = require('../assets/vendor/fontkit.umd.min.js');
    const d0 = await PDFDocument.create(); d0.registerFontkit(globalThis.fontkit);
    const an = await d0.embedFont(require('node:fs').readFileSync(narrow), { subset: true });
    d0.addPage([300, 200]).drawText('Memulai dari yang Kecil 65', { x: 20, y: 150, size: 14, font: an });
    const srcBytes = await d0.save();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(srcBytes), isEvalSupported: false, fontExtraProperties: true, canvasFactory: factory }).promise;
    const pg = await doc.getPage(1), vp = pg.getViewport({ scale: 1 }), cv = createCanvas(300, 200);
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    const key = (await pg.getTextContent()).items[0].fontName, fo = pg.commonObjs.get(key);
    assert.ok(fo.data && fo.data.length > 1000, 'pdf.js keeps the font file');
    const el = (text, font) => ({ type: 'text', x: 0.05, y: 0.2, w: 0.9, h: 0.1, text, fontSize: 14 / 200, family: 'sans', color: '#000000', font });
    const ownOut = await E.exportPdf(srcBytes, { 0: { size: [300, 200], elements: [el('Memulai dari yang Kecil 56', key)] } }, { fonts: { [key]: fo.data } });
    const fontsOf = async b => { const dd = await PDFDocument.load(b); return dd.context.enumerateIndirectObjects().map(([, o]) => o.get && o.get(PDFLib.PDFName.of('BaseFont'))).filter(Boolean).map(String).join(' '); };
    assert.match(await fontsOf(ownOut), /ArialNarrow/, 'text keeps the PDF font');
    assert.match(await text(ownOut, 1), /Memulai dari yang Kecil 56/);
    // A character the font subset lacks: the whole text falls back to the standard font.
    const fbOut = await E.exportPdf(srcBytes, { 0: { size: [300, 200], elements: [el('Zebra Quiz 66', key)] } }, { fonts: { [key]: fo.data } });
    assert.match(await fontsOf(fbOut), /Helvetica/); assert.doesNotMatch(await fontsOf(fbOut), /ArialNarrow/);
    await doc.destroy();
  } else console.log('(skip own-font export: no Arial Narrow on this machine)');
  console.log('page-editor core tests passed');
}
main().catch(e => { console.error(e); process.exit(1); });
