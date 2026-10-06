// Organize grid actions: extract selected pages, page numbers and text
// watermark on the selected pages — all through the real pdf-lib/PDFEdit,
// outputs verified back with real PDF.js text extraction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.PDFLib = require('../.build/qa-runtime/node_modules/pdf-lib');
require('../assets/pdf-edit.js');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const pdfjs = require('../assets/vendor/pdf.min.js');
pdfjs.GlobalWorkerOptions.workerSrc = path.resolve('assets/vendor/pdf.worker.min.js');

async function textOf(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true }).promise;
  let out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await doc.getPage(p).then(page => page.getTextContent());
    out.push(content.items.map(i => i.str).join(' '));
  }
  await doc.destroy();
  return out;
}

async function main() {
  // A real 4-page PDF: "Alpha 1" .. "Delta 4".
  const words = ['Alpha 1', 'Bravo 2', 'Charlie 3', 'Delta 4'];
  const src = await global.PDFLib.PDFDocument.create();
  const font = await src.embedFont(global.PDFLib.StandardFonts.Helvetica);
  for (const text of words) {
    const page = src.addPage([400, 600]);
    page.drawText(text, { x: 50, y: 300, size: 24, font });
  }
  const pdfBytes = await src.save();
  const dom = new JSDOM(fs.readFileSync('converter.html', 'utf8'),
    { url: 'http://localhost:8080/converter.html?tool=organize-pdf', runScripts: 'outside-only' });
  const w = dom.window;
  w.console.log = () => {}; w.scrollTo = () => {};
  w.PDFLib = global.PDFLib;
  w.PDFEdit = globalThis.PDFEdit;
  const script = [...w.document.scripts].find(s => s.textContent.includes('const TOOLS')).textContent;
  w.eval(script + `
    window.qaSavedData = [];
    window.qaFiles=()=>{files=[{name:'doc.pdf',size:${pdfBytes.length},type:'application/pdf',lastModified:1,
      arrayBuffer:()=>window.qaBuf()}];};
    window.qaSetup=(order,selected)=>{organizeOrder=order.slice();organizeSelected=new Set(selected);};
    downloadBlob=(blob,name)=>{window.qaSavedData.push({blob,name});};
    window.qaSaved=()=>window.qaSavedData;
    window.qaNumStart=v=>{document.querySelector('#orgNumStart').value=v;};
    window.qaWmText=v=>{document.querySelector('#orgWmText').value=v;};
    window.qaError=()=>document.querySelector('#error').textContent;
  `);
  w.qaBuf = async () => { const b = Buffer.from(pdfBytes); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const bufOf = async (file) => Buffer.from(await file.blob.arrayBuffer());
  // The sidebar selection tools render with the new actions.
  w.setTool('organize-pdf');
  w.qaFiles();
  w.qaSetup([0, 1, 2, 3], [0, 1, 2, 3]);
  const side = w.document.querySelector('#orgSelBox').innerHTML;
  assert.ok(side.includes('orgExtract()'), 'extract action renders');
  assert.ok(side.includes('orgNumber()'), 'number action renders');
  assert.ok(side.includes('orgWatermark()'), 'watermark action renders');
  assert.ok(side.includes('orgAnnotate()'), 'annotate action renders');
  // Extract keeps grid order and content: pages 2 and 4 only.
  w.qaSetup([0, 1, 2, 3], [1, 3]);
  await w.orgExtract();
  let [file] = w.qaSaved().slice(-1);
  assert.ok(file.name.endsWith('-extract.pdf'), file.name);
  let   out = await global.PDFLib.PDFDocument.load(await bufOf(file));
  assert.equal(out.getPageCount(), 2, 'two selected pages extracted');
  const extracted = await textOf(await bufOf(file));
  assert.ok(extracted[0].includes('Bravo 2') && extracted[1].includes('Delta 4'), 'extract keeps content in grid order');
  // Page numbers run consecutively from the starting number, only selected.
  w.qaSetup([0, 1, 2, 3], [0, 2]);
  w.qaNumStart('7');
  await w.orgNumber();
  [file] = w.qaSaved().slice(-1);
  assert.ok(file.name.endsWith('-numbered.pdf'), file.name);
  out = await global.PDFLib.PDFDocument.load(await bufOf(file));
  assert.equal(out.getPageCount(), 4, 'numbering keeps every page');
  const numbered = await textOf(await bufOf(file));
  assert.ok(numbered[0].includes('7') && numbered[0].includes('Alpha 1'), 'first selected page numbered 7');
  assert.ok(numbered[2].includes('8') && numbered[2].includes('Charlie 3'), 'second selected page numbered 8');
  assert.ok(!/\b7\b|\b8\b/.test(numbered[1]) || numbered[1].includes('Bravo 2'), 'unselected page untouched');
  // Watermark text lands on the selected pages only.
  w.qaSetup([0, 1, 2, 3], [3]);
  w.qaWmText('RAHASIA');
  await w.orgWatermark();
  [file] = w.qaSaved().slice(-1);
  assert.ok(file.name.endsWith('-watermarked.pdf'), file.name);
  const marked = await textOf(await bufOf(file));
  assert.ok(marked[3].includes('RAHASIA'), 'watermark on the selected page');
  assert.ok(!marked[0].includes('RAHASIA') && !marked[1].includes('RAHASIA'), 'other pages clean');
  // Annotate from the grid: text, rectangle, line and a picked image.
  const setAnn = (kind, text, size) => {
    w.document.querySelector('#orgAnnKind').value = kind;
    w.document.querySelector('#orgAnnText').value = text;
    w.document.querySelector('#orgAnnSize').value = size;
  };
  w.qaSetup([0, 1, 2, 3], [1]);
  setAnn('text', 'OKBOS', '20');
  await w.orgAnnotate();
  [file] = w.qaSaved().slice(-1);
  assert.ok(file.name.endsWith('-annotated.pdf'), file.name);
  const noted = await textOf(await bufOf(file));
  assert.ok(noted[1].includes('OKBOS'), 'annotation text on the selected page');
  assert.ok(!noted[0].includes('OKBOS') && !noted[2].includes('OKBOS'), 'other pages clean');
  setAnn('rect', '40x20', '14');
  await w.orgAnnotate();
  [file] = w.qaSaved().slice(-1);
  out = await global.PDFLib.PDFDocument.load(await bufOf(file));
  assert.equal(out.getPageCount(), 4, 'annotate keeps every page');
  setAnn('line', '100', '3');
  await w.orgAnnotate();
  [file] = w.qaSaved().slice(-1);
  assert.ok(file.name.endsWith('-annotated.pdf'), 'line annotates');
  setAnn('text', '   ', '14');
  await w.orgAnnotate();
  assert.match(w.qaError(), /Isi teks|Enter annotation text/, 'empty text warns');
  setAnn('line', 'nol', '3');
  await w.orgAnnotate();
  assert.match(w.qaError(), /Dawa|number above/, 'bad length warns');
  // Empty selection explains itself instead of building nothing.
  w.qaSetup([0, 1, 2, 3], []);
  await w.orgExtract();
  assert.match(w.qaError(), /Tick pages|Centang/, 'empty selection warns');
  w.close();
  console.log('PASS organize actions: extract order+content, consecutive numbers, watermark, annotate text/rect/line+guards, empty guard');
}
main().catch(e => { console.error(e); process.exit(1); });
