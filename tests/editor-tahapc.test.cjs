// Editor Tahap C: tables (layout and the PDF they make), headings and the table of
// contents, the Word (.docx) export and the document templates.
const assert = require('node:assert/strict');
global.PDFLib = require('../.build/qa-runtime/node_modules/pdf-lib');
const { DOMMatrix, Path2D } = require('../.build/qa-runtime/node_modules/@napi-rs/canvas');
global.DOMMatrix = DOMMatrix; global.Path2D = Path2D;
const pdfjs = require('../assets/vendor/pdf.min.js');
pdfjs.GlobalWorkerOptions.workerSrc = require('node:path').resolve('assets/vendor/pdf.worker.min.js');
const JSZip = require('../assets/vendor/jszip.min.js');
require('../assets/page-editor-core.js');
require('../assets/editor-docx.js');
require('../assets/editor-templates.js');
const C = globalThis.PageEditorCore, D = globalThis.EditorDocx, T = globalThis.EditorTemplates;

async function textOf(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true }).promise;
  const items = (await (await doc.getPage(1)).getTextContent()).items; await doc.destroy();
  return items.map(i => i.str).join(' ').replace(/\s+/g, ' ');
}
// Tags open and close in order (enough to catch a broken document.xml).
function wellFormed(xml) {
  const stack = [];
  for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) { assert.equal(stack.pop(), m[2], 'closing tag matches'); } else stack.push(m[2]);
  }
  assert.equal(stack.length, 0, 'every tag closed');
}

(async () => {
  // ---- tables
  const measure = (t) => t.length * 5;                         // 5 pt per character
  const el = { ...C.newTable(2, 2, 842), x: 0.1, y: 0.1, w: 0.5, rows: [['No', 'Uraian'], ['1', 'Sebuah kalimat yang panjang sekali untuk dibungkus']] };
  assert.deepEqual(C.colWidths(el), [0.5, 0.5]);
  assert.deepEqual(C.colWidths({ rows: [['a', 'b', 'c']], colW: [2, 1, 1] }), [0.5, 0.25, 0.25]);
  assert.deepEqual(C.colWidths({ rows: [['a', 'b', 'c']], colW: [1, 1] }), [1 / 3, 1 / 3, 1 / 3], 'widths that do not match the columns: equal');
  const lay = C.tableLayout(el, 200, 10, measure);
  assert.equal(lay.rows[0].cells[1].length, 1); assert.ok(lay.rows[1].cells[1].length > 1, 'a long cell wraps');
  assert.ok(lay.rows[1].height > lay.rows[0].height, 'a row is as tall as its tallest cell');
  assert.equal(lay.rows[0].bold, true, 'header row'); assert.equal(lay.rows[1].bold, false);
  assert.equal(Math.round(lay.height), Math.round(lay.rows[0].height + lay.rows[1].height));

  const blank = await PDFLib.PDFDocument.create(); blank.addPage([595, 842]);
  const input = await blank.save();
  const bytes = await C.exportPdf(input, { 0: { size: [595, 842], background: null, elements: [{ ...el, rows: [['No', 'Nama'], ['1', 'Batik Parang']] }] } });
  const text = await textOf(bytes);
  for (const word of ['No', 'Nama', '1', 'Batik Parang']) assert.ok(text.includes(word), 'table text in the PDF: ' + word);

  // ---- headings and the table of contents
  const H = (t, s) => `<span style="font-weight:bold;font-size:${s}em">${t}</span>`;
  assert.equal(C.headingLevel(C.parseRich(H('BAB I', 2))[0]), 1);
  assert.equal(C.headingLevel(C.parseRich(H('1.1 Latar', 1.5))[0]), 2);
  assert.equal(C.headingLevel(C.parseRich(H('a', 1.25))[0]), 3);
  assert.equal(C.headingLevel(C.parseRich('<span style="font-size:2em">besar saja</span>')[0]), 0, 'big but not bold: not a heading');
  const pages = [
    { elements: [{ type: 'text', y: 0.1, x: 0.1, text: 'Sampul' }] },
    { elements: [{ type: 'text', y: 0.1, x: 0.1, text: '', html: `${H('BAB I PENDAHULUAN', 2)}<br>Isi paragraf.<br>${H('1.1 Latar Belakang', 1.5)}` },
                 { type: 'text', y: 0.05, x: 0.1, toc: true, html: H('DAFTAR ISI', 2), text: 'DAFTAR ISI' }] },
    { elements: [{ type: 'text', y: 0.1, x: 0.1, text: '', html: H('BAB II TINJAUAN', 2) }] },
  ];
  const heads = C.collectHeadings(pages);
  assert.deepEqual(heads.map(h => [h.level, h.text, h.page]), [[1, 'BAB I PENDAHULUAN', 2], [2, '1.1 Latar Belakang', 2], [1, 'BAB II TINJAUAN', 3]], 'the contents page itself is left out');
  const lines = C.tocLines(heads, t => t.length * 6, 300);
  assert.ok(lines.every(l => l.length * 6 <= 300), 'dot leaders stop inside the width');
  assert.match(lines[0], /^BAB I PENDAHULUAN \.+ 2$/); assert.match(lines[1], /^ {4}1\.1 Latar Belakang \.+ 2$/, 'level 2 indented');

  // ---- Word export
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const blob = await D.build({ title: 'Uji', margin: 72, pages: [
    { size: [595, 842], elements: [
      { type: 'text', x: 0.1, y: 0.3, w: 0.8, h: 0.1, fontSize: 12 / 842, family: 'serif', align: 'justify', text: 'Paragraf & isi <penting>', color: '#1c1917' },
      { type: 'text', x: 0.1, y: 0.1, w: 0.8, h: 0.1, fontSize: 12 / 842, family: 'sans', html: H('BAB I PENDAHULUAN', 2), text: 'BAB I PENDAHULUAN' },
      { type: 'rect', x: 0, y: 0, w: 1, h: 1 }] },
    { size: [595, 842], elements: [{ ...el, rows: [['No', 'Nama'], ['1', 'Batik']] }, { type: 'image', x: 0.1, y: 0.5, w: 0.3, h: 0.2, src: png }] },
  ] }, JSZip);
  const zip = await JSZip.loadAsync(blob instanceof Uint8Array ? blob : new Uint8Array(await blob.arrayBuffer()));
  for (const f of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels', 'word/media/image1.png']) assert.ok(zip.file(f), f);
  const xml = await zip.file('word/document.xml').async('string');
  wellFormed(xml); wellFormed(await zip.file('word/styles.xml').async('string'));
  assert.ok(xml.indexOf('BAB I PENDAHULUAN') < xml.indexOf('Paragraf'), 'top to bottom');
  assert.match(xml, /<w:pStyle w:val="Heading1"\/>/); assert.match(xml, /Paragraf &amp; isi &lt;penting&gt;/);
  assert.match(xml, /<w:jc w:val="both"\/>/); assert.match(xml, /Times New Roman/);
  assert.match(xml, /<w:br w:type="page"\/>/); assert.equal((xml.match(/<w:tr>/g) || []).length + (xml.match(/<w:tr><w:trPr>/g) || []).length > 0, true);
  assert.match(xml, /<w:tblHeader\/>/); assert.match(xml, /r:embed="rIdImg1"/);
  assert.equal((xml.match(/<w:drawing>/g) || []).length, 1, 'one picture; shapes are left out');

  // ---- templates: the cover stays on the page, the body's headings are found
  for (const { id } of T.LIST) {
    const t = T.make(id, [595.28, 841.89]);
    assert.ok(t.cover.length >= 5, id);
    for (const e of t.cover) assert.ok(e.x >= 0 && e.y >= 0 && e.x + e.w <= 1.0001 && e.y + e.h <= 1, id + ': cover block on the page');
    const found = C.collectHeadings([{ elements: [{ type: 'text', x: 0, y: 0, text: C.plainRich(t.body.html), html: t.body.html }] }]);
    assert.ok(found.filter(h => h.level === 1).length >= 4, id + ': chapters as Heading 1');
  }
  assert.ok(C.collectHeadings([{ elements: [{ type: 'text', x: 0, y: 0, html: T.make('skripsi').body.html, text: '' }] }]).some(h => h.text === 'BAB I PENDAHULUAN'));
  console.log('PASS editor tahap C: tables (layout + PDF), headings & table of contents, Word export, templates');
})().catch(error => { console.error(error); process.exitCode = 1; });
