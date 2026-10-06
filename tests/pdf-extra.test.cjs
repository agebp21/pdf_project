// Sign PDF, Redact PDF (permanent), PDF Forms, Scan to PDF and Compare PDF
// (assets/pdf-extra.js) through the real pdf-lib, checked back with PDF.js.
const assert = require('node:assert/strict');
global.PDFLib = require('../.build/qa-runtime/node_modules/pdf-lib');
const { createCanvas, DOMMatrix, Path2D } = require('../.build/qa-runtime/node_modules/@napi-rs/canvas');
global.DOMMatrix = DOMMatrix; global.Path2D = Path2D;
const pdfjs = require('../assets/vendor/pdf.min.js');
pdfjs.GlobalWorkerOptions.workerSrc = require('node:path').resolve('assets/vendor/pdf.worker.min.js');
global.pdfjsLib = pdfjs;
require('../assets/pdf-extra.js');
const X = globalThis.PDFExtra;
const factory = new class {
  create(w, h) { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; }
  reset(o, w, h) { o.canvas.width = w; o.canvas.height = h; }
  destroy(o) { o.canvas.width = 0; o.canvas.height = 0; }
};
const open = bytes => pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true, canvasFactory: factory }).promise;
async function text(bytes, n) { const d = await open(bytes); const c = await (await d.getPage(n)).getTextContent(); await d.destroy(); return c.items.map(i => i.str).join(' '); }
async function pixel(bytes, n, fx, fy) {
  const d = await open(bytes), page = await d.getPage(n), vp = page.getViewport({ scale: 0.5 });
  const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; await d.destroy();
  return [...c.getContext('2d').getImageData(Math.floor(fx * c.width), Math.floor(fy * c.height), 1, 1).data].slice(0, 3);
}

async function main() {
  const { PDFDocument, StandardFonts, degrees } = PDFLib;
  const src = await PDFDocument.create(), font = await src.embedFont(StandardFonts.Helvetica);
  for (const angle of [0, 90]) {
    const p = src.addPage([400, 600]); p.setRotation(degrees(angle));
    p.drawText('NIK 3507123456789 RAHASIA', { x: 40, y: 500, size: 16, font });
    p.drawText('Bagian publik tetap terbaca', { x: 40, y: 200, size: 16, font });
  }
  const bytes = await src.save();

  // Sign: a red block placed bottom-right on page 1 lands where it was put.
  const sig = createCanvas(200, 80); const sc = sig.getContext('2d'); sc.fillStyle = '#d00000'; sc.fillRect(0, 0, 200, 80);
  const signed = await X.sign(bytes, sig.toBuffer('image/png'), [{ page: 0, x: 0.6, y: 0.8, w: 0.3 }, { page: 1, x: 0.1, y: 0.1, w: 0.2 }]);
  const red = await pixel(signed, 1, 0.75, 0.83), white = await pixel(signed, 1, 0.2, 0.9);
  assert.ok(red[0] > 180 && red[1] < 60, 'signature drawn at its spot ' + red);
  assert.ok(white[0] > 240 && white[1] > 240, 'elsewhere untouched ' + white);
  assert.ok((await pixel(signed, 2, 0.15, 0.12))[1] < 60, 'rotated page: signature at the displayed top-left');
  await assert.rejects(X.sign(bytes, sig.toBuffer('image/png'), []), /signature|tanda tangan/i);

  // Redact: text search finds the NIK; the redacted page holds no text at all
  // any more (really removed), the other page keeps its text.
  const view = await open(bytes);
  const found = await X.findText(await view.getPage(1), '3507123456789');
  await view.destroy();
  assert.equal(found.length, 1);
  assert.ok(found[0].y > 0.1 && found[0].y < 0.25 && found[0].x > 0.1, 'box near the top line ' + JSON.stringify(found[0]));
  const redacted = await X.redact(bytes, { 0: found }, { pdfjs, docOptions: { canvasFactory: factory, useSystemFonts: true },
    canvas: (w, h) => createCanvas(w, h), toJpeg: c => c.toBuffer('image/jpeg') });
  assert.equal(await text(redacted, 1), '', 'no text left on the redacted page');
  assert.match(await text(redacted, 2), /RAHASIA/, 'the other page is untouched');
  const doc = await PDFDocument.load(redacted);
  assert.equal(doc.getPageCount(), 2);
  assert.deepEqual([doc.getPage(0).getWidth(), doc.getPage(0).getHeight()], [400, 600]);
  const box = found[0], black = await pixel(redacted, 1, box.x + box.w / 2, box.y + box.h / 2);
  assert.ok(black.every(v => v < 40), 'the box is black ' + black);
  await assert.rejects(X.redact(bytes, {}), /Mark|Tandai/);

  // Forms: list, fill, keep editable or flatten.
  const f = await PDFDocument.create(), fp = f.addPage([400, 400]), form = f.getForm();
  form.createTextField('nama').addToPage(fp, { x: 20, y: 320, width: 200, height: 24 });
  form.createCheckBox('setuju').addToPage(fp, { x: 20, y: 280, width: 16, height: 16 });
  const dd = form.createDropdown('kota'); dd.addOptions(['Malang', 'Surabaya']); dd.addToPage(fp, { x: 20, y: 240, width: 150, height: 22 });
  const rg = form.createRadioGroup('jenis'); rg.addOptionToPage('L', fp, { x: 20, y: 200, width: 14, height: 14 }); rg.addOptionToPage('P', fp, { x: 50, y: 200, width: 14, height: 14 });
  const formBytes = await f.save();
  const fields = await X.formFields(formBytes);
  assert.deepEqual(fields.map(x => [x.name, x.kind]), [['nama', 'text'], ['setuju', 'checkbox'], ['kota', 'dropdown'], ['jenis', 'radio']]);
  assert.deepEqual(fields[2].options, ['Malang', 'Surabaya']);
  const filled = await PDFDocument.load(await X.fillForm(formBytes, { nama: 'Agung', setuju: true, kota: 'Surabaya', jenis: 'P' }, false));
  const ff = filled.getForm();
  assert.equal(ff.getTextField('nama').getText(), 'Agung'); assert.ok(ff.getCheckBox('setuju').isChecked());
  assert.deepEqual(ff.getDropdown('kota').getSelected(), ['Surabaya']); assert.equal(ff.getRadioGroup('jenis').getSelected(), 'P');
  const flat = await X.fillForm(formBytes, { nama: 'Agung' }, true);
  assert.equal((await PDFDocument.load(flat)).getForm().getFields().length, 0, 'flattened: no fields left');
  assert.deepEqual(await X.formFields(bytes), [], 'a PDF without a form has no fields');

  // Scan: grey paper becomes white, ink becomes dark; pages A4 or photo-sized.
  const px = new Uint8ClampedArray(100 * 4);
  for (let i = 0; i < 100; i++) { const v = i < 10 ? 60 : 190; px.set([v, v + 5, v - 5, 255], i * 4); }
  X.enhance({ data: px }, 'document');
  assert.equal(px[50 * 4], 255, 'paper white'); assert.ok(px[0] < 20, 'ink dark');
  const photo = createCanvas(300, 200); photo.getContext('2d').fillStyle = '#888'; photo.getContext('2d').fillRect(0, 0, 300, 200);
  const jpg = photo.toBuffer('image/jpeg');
  const scan = await PDFDocument.load(await X.imagesToPdf([{ bytes: jpg, width: 300, height: 200 }, { bytes: jpg, width: 200, height: 300 }], 'a4'));
  assert.deepEqual(scan.getPages().map(p => [p.getWidth(), p.getHeight()]), [[842, 595], [595, 842]], 'A4 follows the photo orientation');
  const sized = await PDFDocument.load(await X.imagesToPdf([{ bytes: jpg, width: 300, height: 200 }], 'photo'));
  assert.deepEqual([sized.getPage(0).getWidth(), sized.getPage(0).getHeight()], [144, 96]);

  // Compare: Myers diff, then real PDFs.
  assert.deepEqual(X.diffLines(['a', 'b', 'c'], ['a', 'x', 'c']).map(o => o.op), ['=', '-', '+', '=']);
  assert.deepEqual(X.diffLines([], ['a']).map(o => o.op), ['+']);
  assert.deepEqual(X.diffLines(['a', 'b'], ['a', 'b']).map(o => o.op), ['=', '=']);
  const make = async pages => {
    const d = await PDFDocument.create(), fo = await d.embedFont(StandardFonts.Helvetica);
    pages.forEach(lines => { const p = d.addPage([400, 400]); lines.forEach((t, i) => p.drawText(t, { x: 30, y: 350 - i * 30, size: 14, font: fo })); });
    return d.save();
  };
  const A = await make([['Pasal 1 Harga Rp 10.000', 'Pasal 2 Pengiriman 3 hari'], ['Pasal 3 Garansi 1 tahun']]);
  const B = await make([['Pasal 1 Harga Rp 12.500', 'Pasal 2 Pengiriman 3 hari'], ['Pasal 3 Garansi 1 tahun', 'Pasal 4 Retur 7 hari']]);
  const la = await X.pdfLines(await open(A)), lb = await X.pdfLines(await open(B));
  assert.deepEqual(la.map(l => l.text), ['Pasal 1 Harga Rp 10.000', 'Pasal 2 Pengiriman 3 hari', 'Pasal 3 Garansi 1 tahun']);
  const result = X.compare(la, lb);
  assert.equal(result.removed, 1); assert.equal(result.added, 2);
  const html = X.reportHtml(result, 'lama.pdf', 'baru.pdf');
  assert.match(html, /Rp 10\.000/); assert.match(html, /Retur 7 hari/); assert.match(html, /B 2/);
  assert.match(X.reportHtml(X.compare(la, la), 'a', 'a'), /identical|sama persis/);
  assert.ok(!/<script/.test(X.reportHtml(X.compare([{ text: '<script>x</script>', page: 1 }], []), 'a', 'b')), 'report escapes text');
  console.log('pdf-extra tests passed');
}
main().catch(e => { console.error(e); process.exit(1); });
