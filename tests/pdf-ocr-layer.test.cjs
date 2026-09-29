// OCR text layer: invisible (render mode 3), stretched to each word's box,
// rotated with the page, unencodable characters dropped instead of failing.
const assert = require('node:assert/strict');
global.PDFLib = require('../.build/qa-runtime/node_modules/pdf-lib');
require('../assets/pdf-ocr-layer.js');
const {PDFDocument, StandardFonts} = PDFLib;
const L = global.PDFOcrLayer;
// Decoded content streams of one page, after a save/load round trip.
async function contentOf(doc, index) {
  const saved = await PDFDocument.load(await doc.save()), contents = saved.getPage(index).node.Contents();
  const streams = contents instanceof PDFLib.PDFArray ? contents.asArray().map(ref => saved.context.lookup(ref)) : [contents];
  return streams.map(stream => new TextDecoder('latin1').decode(PDFLib.decodePDFRawStream(stream).decode())).join('\n');
}

(async () => {
  const doc = await PDFDocument.create(), page = doc.addPage([600, 800]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Canvas pixels at 2x, top-left origin → PDF points, bottom-left origin.
  const toPdf = (x, y) => [x / 2, 800 - y / 2];
  const words = [
    {text: 'Pendapatan', x0: 100, y0: 200, x1: 400, y1: 240},
    {text: '“naik”', x0: 420, y0: 200, x1: 560, y1: 240},
    {text: '中文', x0: 600, y0: 200, x1: 700, y1: 240},   // not in Helvetica: skipped
    {text: 'x', x0: 10, y0: 10, x1: 10.4, y1: 50},        // degenerate box: skipped
  ];
  assert.equal(L.addWords(PDFLib, doc, page, font, words, toPdf), 2);
  const raw = await contentOf(doc, 0);
  assert.match(raw, /3 Tr/, 'invisible text');
  const tz = [...raw.matchAll(/([\d.]+) Tz/g)].map(m => Number(m[1]));
  assert.equal(tz.length, 2);
  const natural = font.widthOfTextAtSize('Pendapatan', 20 * 0.9);
  assert.ok(Math.abs(tz[0] - 100 * 150 / natural) < 0.01, 'stretched to cover the 150 pt word box');
  // Word bottom at 240 px → 680 pt, baseline lifted by the descent (18% of 20 pt).
  assert.match(raw, /1 0 -?0 1 50 683\.6 Tm/, 'upright text matrix on the word baseline');
  assert.equal(L.encodable(font, '“naik”…'), '"naik"...');
  assert.equal(L.encodable(font, '中文'), '');

  // A page shown rotated 90°: the baseline runs along the PDF y axis.
  const turned = doc.addPage([800, 600]);
  L.addWords(PDFLib, doc, turned, font, [{text: 'Halaman', x0: 100, y0: 300, x1: 300, y1: 340}], (x, y) => [y / 2, x / 2]);
  assert.match(await contentOf(doc, 1), /0 1 -?1 0 [\d.]+ 50 Tm/, 'text matrix turned 90° with the page');
  console.log('PASS pdf-ocr-layer: invisible words stretched to their boxes, rotated pages, unencodable text skipped');
})().catch(error => { console.error(error); process.exitCode = 1; });
