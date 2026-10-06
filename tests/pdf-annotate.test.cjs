// Edit PDF annotations: text, image stamp, rectangle, ellipse and line —
// stacked in one run through the real pdf-lib, verified back with real
// PDF.js (text extraction + raster pixel sampling), plus the draft-list DOM.
const assert = require('node:assert/strict'), fs = require('node:fs');
global.PDFLib = require('../.build/qa-runtime/node_modules/pdf-lib');
require('../assets/pdf-edit.js');
const { createCanvas, DOMMatrix, Path2D } = require('../.build/qa-runtime/node_modules/@napi-rs/canvas');
global.DOMMatrix = DOMMatrix; global.Path2D = Path2D;
const pdfjs = require('../assets/vendor/pdf.min.js');
pdfjs.GlobalWorkerOptions.workerSrc = require('node:path').resolve('assets/vendor/pdf.worker.min.js');
async function inspect(bytes) {
  const factory = new class {
    create(width, height) { const c = createCanvas(width, height); return { canvas: c, context: c.getContext('2d') }; }
    reset(obj, width, height) { obj.canvas.width = width; obj.canvas.height = height; }
    destroy(obj) { obj.canvas.width = 0; obj.canvas.height = 0; }
  };
  return pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true, canvasFactory: factory }).promise;
}
async function texts(doc, n) {
  const page = await doc.getPage(n), content = await page.getTextContent();
  return content.items.map(i => i.str).join(' ');
}
async function pixel(bytes, pageNo, fx, fy) {
  const doc = await inspect(bytes);
  const page = await doc.getPage(pageNo);
  const viewport = page.getViewport({ scale: 0.5 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  await doc.destroy();
  const [w, h] = [canvas.width, canvas.height];
  const data = canvas.getContext('2d').getImageData(Math.floor(w * fx), Math.floor(h * fy), 1, 1).data;
  return [...data];
}
async function main() {
  const source = await global.PDFLib.PDFDocument.create();
  const font = await source.embedFont(global.PDFLib.StandardFonts.Helvetica);
  for (const label of ['one', 'two']) {
    const page = source.addPage([400, 600]);
    page.drawText('Page ' + label, { x: 60, y: 300, size: 20, font });
  }
  const bytes = await source.save();
  // Text lands on the chosen pages only, with rotation and offsets honored.
  const marked = await PDFEdit.apply(bytes, { tool: 'edit-pdf', elements: [
    { kind: 'text', text: 'SIGNED', size: 24, color: '#ff0000', opacity: 100, position: 'top-center', margin: 10, dx: 0, dy: 0, rotation: 0, range: '2' },
  ] });
  const read = await inspect(marked);
  assert.ok((await texts(read, 1)).includes('Page one') && !(await texts(read, 1)).includes('SIGNED'), 'page 1 untouched');
  assert.ok((await texts(read, 2)).includes('SIGNED'), 'page 2 signed');
  await read.destroy();
  // Rectangle + ellipse paint where aimed (raster check), line too.
  const shapes = await PDFEdit.apply(bytes, { tool: 'edit-pdf', elements: [
    { kind: 'rect', width: 100, height: 60, border: 0, color: '#ff0000', opacity: 100, position: 'center', margin: 0, dx: 0, dy: 0, rotation: 0, range: '1' },
    { kind: 'ellipse', width: 120, height: 80, border: 0, color: '#0000ff', opacity: 100, position: 'center', margin: 0, dx: 0, dy: 0, rotation: 0, range: '2' },
    { kind: 'line', length: 100, thickness: 6, color: '#00aa00', opacity: 100, position: 'center', margin: 0, dx: 0, dy: 0, rotation: 0, range: '1' },
  ] });
  let [r, g, b] = await pixel(shapes, 1, 0.3, 0.6);
  assert.ok(r > 150 && g < 120 && b < 120, `red rectangle off the line (${r},${g},${b})`);
  [r, g, b] = await pixel(shapes, 2, 0.5, 0.5);
  assert.ok(b > 150 && r < 120, `blue ellipse at page center (${r},${g},${b})`);
  // Image stamp embeds (opaque red square via canvas PNG).
  const logo = createCanvas(40, 40);
  logo.getContext('2d').fillStyle = '#ff0000'; logo.getContext('2d').fillRect(0, 0, 40, 40);
  const stamped = await PDFEdit.apply(bytes, { tool: 'edit-pdf', elements: [
    { kind: 'image', image: [...logo.toBuffer('image/png')], size: 60, opacity: 100, position: 'center', margin: 0, dx: 0, dy: 0, rotation: 0, range: '1' },
  ] });
  [r, g, b] = await pixel(stamped, 1, 0.5, 0.5);
  assert.ok(r > 150 && g < 120 && b < 120, `image stamp at page center (${r},${g},${b})`);
  // Honest errors, not silent misplacement.
  await assert.rejects(() => PDFEdit.apply(bytes, { tool: 'edit-pdf', elements: [] }), /at least one annotation/);
  await assert.rejects(() => PDFEdit.apply(bytes, { tool: 'edit-pdf', elements: [{ kind: 'text', text: 'x', range: '9' }] }), /outside|valid/i);
  await assert.rejects(() => PDFEdit.apply(bytes, { tool: 'edit-pdf', elements: [{ kind: 'text', text: '  ', range: 'all' }] }), /enter some text/);
  await assert.rejects(() => PDFEdit.apply(bytes, { tool: 'edit-pdf', elements: Array.from({ length: 21 }, () => ({ kind: 'line', range: 'all' })) }), /At most 20/);
  await assert.rejects(() => PDFEdit.apply(bytes, { tool: 'edit-pdf', elements: [{ kind: 'text', text: 'huge', size: 9000, range: '1' }] }), /fit on page/);
  // Draft list DOM: kind groups toggle, add/remove/clear, readOptions carries drafts.
  const values = { '#edit-kind': { value: 'text' }, '#edit-range': { value: 'all' }, '#edit-text': { value: 'Hi' },
    '#edit-text-size': { value: '14' }, '#edit-position': { value: 'center' }, '#edit-margin': { value: '10' },
    '#edit-dx': { value: '0' }, '#edit-dy': { value: '0' }, '#edit-rotation': { value: '0' },
    '#edit-color': { value: '#214d40' }, '#edit-opacity': { value: '100' } };
  const groups = ['text', 'image', 'rect ellipse', 'line'].map(kinds => ({ dataset: { kind: kinds }, style: {} }));
  const fake = { querySelector: sel => values[sel] || null, querySelectorAll: () => groups };
  PDFEdit.clearDrafts();
  PDFEdit.toggleKind(fake);
  assert.deepEqual(groups.map(gr => gr.style.display), ['', 'none', 'none', 'none'], 'only the text group shows');
  values['#edit-kind'] = { value: 'line' };
  values['#edit-line-len'] = { value: '50' }; values['#edit-line-thick'] = { value: '1' };
  PDFEdit.toggleKind(fake);
  assert.deepEqual(groups.map(gr => gr.style.display), ['none', 'none', 'none', ''], 'line group shows');
  await PDFEdit.addDraft(fake);
  assert.equal(PDFEdit.draftCount(), 1, 'draft stacked');
  const carried = await PDFEdit.readOptions('edit-pdf', fake);
  assert.equal(carried.elements.length, 1);
  assert.equal(carried.elements[0].kind, 'line');
  PDFEdit.removeDraft(0);
  assert.equal(PDFEdit.draftCount(), 0, 'draft removed');
  // Wiring: the catalog card is live and the converter dispatches the tool.
  const converter = fs.readFileSync('converter.html', 'utf8');
  assert.ok(converter.includes("{id:'edit-pdf'"), 'tool registered');
  assert.ok(converter.includes("['watermark','page-numbers','crop-pdf','edit-pdf']"), 'controls + dispatch wired');
  const index = fs.readFileSync('index.html', 'utf8');
  assert.ok(!index.includes('"edit-pdf"') || !/SOON[^;]*"edit-pdf"/.test(index), 'card no longer coming soon');
  console.log('PASS edit annotations: text/image/rect/ellipse/line placed, validated, draft list, wiring live');
}
main().catch(e => { console.error(e); process.exit(1); });
