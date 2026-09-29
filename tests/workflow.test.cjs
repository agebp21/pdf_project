// Workflow engine: merge inputs, run steps in order, recipes in localStorage.
const assert = require('node:assert/strict');
global.PDFLib = require('../.build/qa-runtime/node_modules/pdf-lib');
const store = new Map();
global.localStorage = {getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v))};
require('../assets/pdf-edit.js');
require('../assets/workflow.js');
const {PDFDocument, StandardFonts} = PDFLib;
const W = global.Workflow;

async function pdf(pageCount, label) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) doc.addPage([400, 600]).drawText(label + ' ' + (i + 1), {x: 50, y: 500, size: 20, font});
  return {name: label + '.pdf', bytes: await doc.save()};
}
const load = bytes => PDFDocument.load(bytes);

(async () => {
  const a = await pdf(3, 'A'), b = await pdf(2, 'B');
  const progress = [];
  // Merge in order, then keep 2-4, rotate page 1, number, watermark, crop, compress.
  let out = await W.run([a, b], [
    {type: 'keep', options: {range: '2-4'}},
    {type: 'rotate', options: {angle: '90', range: '1'}},
    {type: 'page-numbers'},
    {type: 'watermark', options: {text: 'DRAFT'}},
    {type: 'crop', options: {top: '5', right: '5', bottom: '5', left: '5'}},
    {type: 'compress'},
  ], p => progress.push(p));
  let doc = await load(out);
  assert.equal(doc.getPageCount(), 3, 'merged 5 pages, kept 2-4');
  assert.equal(doc.getPage(0).getRotation().angle, 90, 'rotated only page 1');
  assert.equal(doc.getPage(1).getRotation().angle, 0);
  const box = doc.getPage(1).getCropBox();
  assert.ok(Math.abs(box.width - (400 - 2 * 5 * 72 / 25.4)) < 0.01, 'cropped 5 mm each side');
  assert.deepEqual([...new Set(progress.map(p => p.step))], [0, 1, 2, 3, 4, 5, 6], 'progress for every step, in order');
  assert.ok(progress.every(p => p.total === 6));

  out = await W.run([a], [{type: 'remove', options: {range: '1,3'}}]);
  assert.equal((await load(out)).getPageCount(), 1, 'removed pages 1 and 3');
  await assert.rejects(W.run([a], [{type: 'remove', options: {range: 'all'}}]), /Step 1 \(Remove pages\): .*every page/);
  await assert.rejects(W.run([a], [{type: 'keep', options: {range: '9'}}]), /Step 1 \(Keep pages\)/);
  await assert.rejects(W.run([], [{type: 'compress'}]), /at least one PDF/);
  await assert.rejects(W.run([{name: 'bad.pdf', bytes: new Uint8Array([1, 2, 3])}], []), /bad\.pdf could not be read/);
  assert.throws(() => W.normalize({type: 'format-disk'}), /Unknown workflow step/);
  assert.deepEqual(W.normalize({type: 'rotate'}).options, {angle: '90', range: 'all'}, 'defaults fill missing options');

  // Templates only use known steps.
  W.TEMPLATES.forEach(t => t.steps.forEach(s => W.normalize(s)));

  // Recipes: save, overwrite by name, remove, corrupt storage ignored.
  assert.deepEqual(W.recipes.load(), []);
  W.recipes.save('Laporan', [{type: 'compress'}]);
  W.recipes.save('laporan', [{type: 'rotate'}, {type: 'compress'}]);
  let list = W.recipes.load();
  assert.equal(list.length, 1, 'same name (any case) replaces the recipe');
  assert.equal(list[0].steps.length, 2);
  assert.throws(() => W.recipes.save('  ', [{type: 'compress'}]), /name/);
  assert.throws(() => W.recipes.save('Empty', []), /at least one step/);
  W.recipes.remove('laporan');
  assert.deepEqual(W.recipes.load(), []);
  store.set('mf-workflows', '{oops');
  assert.deepEqual(W.recipes.load(), [], 'corrupt storage is ignored');
  console.log('PASS workflow: merge + 6 steps in order with progress, keep/remove/rotate/crop checks, errors name the step, recipes');
})().catch(error => { console.error(error); process.exitCode = 1; });
