// Organize grid actions: extract selected pages, page numbers and text
// watermark on the selected pages — all through the real pdf-lib/PDFEdit,
// outputs verified back with real PDF.js text extraction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.PDFLib = require('../.build/qa-runtime/node_modules/pdf-lib');
global.JSZip = require('../.build/qa-runtime/node_modules/jszip');
require('../assets/pdf-edit.js');
global.PDFCompress = require('../assets/pdf-compress.js').PDFCompress || globalThis.PDFCompress;
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
  w.PDFCompress = global.PDFCompress;
  w.JSZip = global.JSZip;
  const script = [...w.document.scripts].find(s => s.textContent.includes('const TOOLS')).textContent;
  w.eval(script + `
    window.qaSavedData = [];
    window.qaFiles=()=>{files=[{name:'doc.pdf',size:${pdfBytes.length},type:'application/pdf',lastModified:1,
      arrayBuffer:()=>window.qaBuf()}];};
    window.qaSetup=(order,selected)=>{organizeOrder=order.slice();organizeSelected=new Set(selected);};
    downloadBlob=(blob,name)=>{window.qaSavedData.push({blob,name});};
    window.qaSaved=()=>window.qaSavedData;
    window.qaInputs=()=>{
      const mk=(tag,id,type,value)=>{let el=document.querySelector('#'+id);
        if(!el){el=document.createElement(tag);el.id=id;if(type)el.type=type;document.body.append(el);}
        if(value!==undefined)el.value=value;return el;};
      mk('input','orgNumStart','number','1');mk('input','orgWmText','text','');
      const sel=mk('select','orgAnnKind');
      sel.innerHTML='<option value="text">Text</option><option value="rect">Rectangle</option><option value="ellipse">Ellipse</option><option value="line">Line</option><option value="image">Image</option>';
      mk('input','orgAnnText','text','');mk('input','orgAnnSize','number','14');
    };
    window.qaError=()=>document.querySelector('#error').textContent;
  `);
  w.qaBuf = async () => { const b = Buffer.from(pdfBytes); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const bufOf = async (file) => Buffer.from(await file.blob.arrayBuffer());
  // The selection panel lives for split/edit modes (merge keeps it hidden).
  assert.ok(w.document.querySelector('#orgSelBox'), 'selection panel present');
  w.qaInputs();
  w.qaFiles();
  // Extract keeps grid order and content: pages 2 and 4 only.
  w.qaSetup([0, 1, 2, 3], [1, 3]);
  await w.orgExtract();
  assert.ok(!w.qaError(), 'no error: ' + w.qaError());
  let [file] = w.qaSaved().slice(-1);
  assert.ok(file.name.endsWith('-extract.pdf'), file.name);
  let   out = await global.PDFLib.PDFDocument.load(await bufOf(file));
  assert.equal(out.getPageCount(), 2, 'two selected pages extracted');
  const extracted = await textOf(await bufOf(file));
  assert.ok(extracted[0].includes('Bravo 2') && extracted[1].includes('Delta 4'), 'extract keeps content in grid order');
  // Page numbers run consecutively from the starting number, only selected.
  w.qaSetup([0, 1, 2, 3], [0, 2]);
  w.document.querySelector('#orgNumStart').value = '7';
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
  w.document.querySelector('#orgWmText').value = 'RAHASIA';
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
  // Modes share one shell: merge flips, split/edit select, tools per mode.
  const tabs = JSON.stringify([...w.document.querySelectorAll('.org-tabs button')].map(b => b.dataset.mode));
  assert.equal(tabs, JSON.stringify(['merge', 'split', 'edit', 'compress']), 'four mode tabs');
  const tabActive = () => w.document.querySelector('.org-tabs button.active').dataset.mode;
  assert.equal(tabActive(), 'merge', 'merge by default');
  w.qaSetup([0, 1, 2, 3], []);
  w.renderOrganizeGrid();
  w.orgCardClick({ target: { closest: () => null } }, 2);
  assert.ok(!w.document.querySelector('#organizeGrid').innerHTML.includes(' sel'), 'merge click does not select');
  w.orgModeSet('split');
  assert.equal(tabActive(), 'split', 'tab follows');
  assert.ok(!w.document.querySelector('#orgSplitTools').classList.contains('is-hidden'), 'split tools show');
  assert.ok(w.document.querySelector('#orgSelBox').classList.contains('is-hidden'), 'no selection yet, box hidden');
  w.orgCardClick({ target: { closest: () => null } }, 2);
  assert.ok(w.document.querySelector('#organizeGrid').innerHTML.includes(' sel'), 'split click selects');
  assert.ok(!w.document.querySelector('#orgSelBox').classList.contains('is-hidden'), 'box opens on selection');
  w.orgModeSet('merge');
  w.renderOrganizeGrid();
  assert.ok(w.document.querySelector('#orgSelBox').classList.contains('is-hidden'), 'merge hides the box');
  // Split ZIP: one PDF per selected page, in grid order.
  w.orgModeSet('split');
  w.qaSetup([0, 1, 2, 3], [3, 1]);
  await w.orgSplitZip();
  [file] = w.qaSaved().slice(-1);
  assert.ok(file.name.endsWith('-split.zip'), file.name);
  const JSZip = require('../.build/qa-runtime/node_modules/jszip');
  let zip = await JSZip.loadAsync(await bufOf(file));
  assert.deepEqual(Object.keys(zip.files).sort(), ['page-1.pdf', 'page-2.pdf']);
  let first = await global.PDFLib.PDFDocument.load(await zip.file('page-1.pdf').async('uint8array'));
  assert.equal(first.getPageCount(), 1);
  assert.ok((await textOf(await zip.file('page-1.pdf').async('uint8array')))[0].includes('Bravo 2'), 'first selected page first');
  // Split every N: chunks across the arranged order.
  w.qaSetup([3, 2, 1, 0], []);
  w.document.querySelector('#orgSplitN').value = '3';
  await w.orgSplitEvery();
  [file] = w.qaSaved().slice(-1);
  assert.ok(file.name.endsWith('-split-every-3.zip'), file.name);
  zip = await JSZip.loadAsync(await bufOf(file));
  const names = Object.keys(zip.files).sort();
  assert.equal(names.length, 2, '4 pages in threes');
  first = await global.PDFLib.PDFDocument.load(await zip.file(names[0]).async('uint8array'));
  assert.equal(first.getPageCount(), 3, 'first chunk holds three');
  // Compress keeps every page in a valid PDF.
  w.qaSetup([0, 1, 2, 3], []);
  await w.orgCompress();
  [file] = w.qaSaved().slice(-1);
  assert.ok(file.name.endsWith('-compressed-medium.pdf'), file.name);
  out = await global.PDFLib.PDFDocument.load(await bufOf(file));
  assert.equal(out.getPageCount(), 4, 'compressed keeps every page');
  // Edit mode brings the selection box back.
  w.orgModeSet('edit');
  w.qaSetup([0, 1, 2, 3], [0]);
  w.renderOrganizeGrid();
  assert.ok(!w.document.querySelector('#orgSelBox').classList.contains('is-hidden'), 'edit shows the box');
  w.close();
  console.log('PASS organize actions: extract order+content, consecutive numbers, watermark, annotate text/rect/line+guards, empty guard');
}
main().catch(e => { console.error(e); process.exit(1); });
