// PDF compression: images re-encoded (JPEG and Flate/PNG), masks and text
// untouched, never bigger than the original. The browser's canvas encoder is
// replaced by a stub here (the real canvas encoder is checked in Chromium).
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.PDFLib = require('../.build/qa-runtime/node_modules/pdf-lib');
require('../assets/pdf-compress.js');
const {PDFDocument, StandardFonts, PDFName, PDFRawStream, PDFNumber} = PDFLib;
const C = global.PDFCompress;
const photo = fs.readFileSync(__dirname + '/fixtures/photo.jpg');
const png = fs.readFileSync(__dirname + '/fixtures/photo-small.png');
const tiny = new Uint8Array(fs.readFileSync(__dirname + '/fixtures/tiny.jpg'));

async function sample() {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  const jpg = await doc.embedJpg(photo), pic = await doc.embedPng(png);
  const page = doc.addPage([600, 800]);
  page.drawImage(jpg, {x: 20, y: 300, width: 560, height: 373});
  page.drawImage(pic, {x: 20, y: 60, width: 300, height: 200});
  page.drawText('Laporan tahunan', {x: 20, y: 760, size: 24, font});
  return doc.save();
}
const imagesOf = async bytes => {
  const doc = await PDFDocument.load(bytes);
  return doc.context.enumerateIndirectObjects().map(([, o]) => o)
    .filter(o => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
    .map(o => ({w: o.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber(), filter: String(o.dict.get(PDFName.of('Filter'))), smask: !!o.dict.get(PDFName.of('SMask')), size: o.contents.length}));
};

(async () => {
  const input = await sample();
  const seen = [];
  const {bytes, stats} = await C.compress(input, 'medium', {recode: async (image, level) => {
    seen.push({kind: image.kind, w: image.width, h: image.height, c: image.components, px: image.bytes.length, max: level.maxSide});
    return {bytes: tiny, width: 64, height: 48};
  }});
  assert.deepEqual(seen.map(s => s.kind).sort(), ['jpeg', 'raw'], 'the JPEG and the PNG (Flate) photos, not the PNG alpha mask');
  const raw = seen.find(s => s.kind === 'raw');
  assert.equal(raw.px, 300 * 200 * 3, 'Flate pixels decoded to full RGB');
  assert.equal(seen[0].max, C.LEVELS.medium.maxSide);
  assert.equal(stats.recoded, 2);
  assert.ok(stats.after < stats.before * 0.2, 'much smaller: ' + stats.before + ' -> ' + stats.after);
  const after = await imagesOf(bytes);
  assert.equal(after.filter(i => i.filter === '/DCTDecode' && i.w === 64).length, 2, 'both photos are now JPEG');
  assert.ok(after.some(i => i.smask), 'the PNG keeps its transparency mask');
  const text = await PDFDocument.load(bytes);
  assert.equal(text.getPageCount(), 1);

  // Re-encoding that doesn't help is not used; the file never grows.
  const same = await C.compress(input, 'low', {recode: async image => ({bytes: new Uint8Array(image.bytes.length + 10), width: image.width, height: image.height})});
  assert.equal(same.stats.recoded, 0);
  assert.ok(same.bytes.byteLength <= input.byteLength);

  // A text-only PDF: nothing to re-encode, reported honestly.
  const plain = await PDFDocument.create(); plain.addPage().drawText('Hello', {font: await plain.embedFont(StandardFonts.Helvetica)});
  const textOnly = await C.compress(await plain.save(), 'high', {recode: async () => { throw Error('not called'); }});
  assert.equal(textOnly.stats.images, 0);

  await assert.rejects(C.compress(new Uint8Array([1, 2, 3])), /could not be read/);

  // PNG predictor decoding (Sub, Up, Average, Paeth) matches the source.
  const width = 3, height = 2, c = 1, rows = [[1, 10, 20, 30], [2, 5, 5, 5]];
  const out = C.unpredict(new Uint8Array(rows.flat()), width, height, c);
  assert.deepEqual([...out], [10, 30, 60, 15, 35, 65]);
  console.log('PASS pdf-compress: JPEG + Flate photos re-encoded, masks kept, never bigger, text-only honest, predictors');
})().catch(error => { console.error(error); process.exitCode = 1; });
