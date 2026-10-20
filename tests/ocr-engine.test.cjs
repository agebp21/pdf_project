// The shared OCR engine with the real Tesseract.js and the site's own language data:
// a faded scan is cleaned and read, a page scanned sideways is found turned and its
// word boxes come back in the original picture, and the clean-up / turn helpers.
const path = require('node:path'), assert = require('node:assert/strict');
const canvas = require('../.build/qa-runtime/node_modules/@napi-rs/canvas');
const Tesseract = require('../.build/qa-runtime/node_modules/tesseract.js');
const make = (w, h) => canvas.createCanvas(w, h);
global.self = global;
global.document = { createElement: () => make(1, 1) };
global.navigator = { hardwareConcurrency: 4 };
// The engine's scheduler, with Node's Tesseract reading napi canvases as PNG.
global.Tesseract = {
  createScheduler() {
    const workers = []; let next = 0;
    return {
      addWorker: w => workers.push(w),
      addJob: (_, c) => workers[next++ % workers.length].recognize(c.toBuffer('image/png')),
      terminate: () => Promise.all(workers.map(w => w.terminate())),
    };
  },
  createWorker: (langs, oem) => Tesseract.createWorker(langs, oem, { langPath: path.resolve('assets/vendor/ocr'), gzip: true, cacheMethod: 'none' }),
};
require('../assets/ocr-engine.js');
const E = global.OcrEngine;

function page(lines, { faded = false } = {}) {
  const c = make(1400, 900), ctx = c.getContext('2d');
  ctx.fillStyle = faded ? '#d8d2c4' : '#fff'; ctx.fillRect(0, 0, 1400, 900);
  ctx.fillStyle = faded ? '#a49d90' : '#111'; ctx.font = '46px Arial';
  lines.forEach((t, i) => ctx.fillText(t, 70, 130 + i * 90));
  return c;
}
const TEXT = ['Gamelan adalah ansambel musik Jawa', 'yang terdiri dari gong kendang saron', 'dan bonang dengan laras pelog slendro', 'dimainkan dalam upacara dan wayang'];

(async () => {
  // helpers
  const g = E.prepare(page(TEXT, { faded: true }), 'gray', make).getContext('2d').getImageData(0, 0, 1400, 900).data;
  let min = 255, max = 0;
  for (let i = 0; i < g.length; i += 4) { min = Math.min(min, g[i]); max = Math.max(max, g[i]); }
  assert.ok(min <= 10 && max >= 245, `faded page stretched to black/white (${min}-${max})`);
  const t = E.turn(make(300, 100), 90, make); assert.deepEqual([t.width, t.height], [100, 300]);
  assert.deepEqual(E.unturn({ x0: 10, y0: 20, x1: 30, y1: 60 }, 90, 300, 100), { x0: 20, y0: 70, x1: 60, y1: 90 });
  assert.deepEqual(E.unturn({ x0: 10, y0: 20, x1: 30, y1: 60 }, 180, 300, 100), { x0: 270, y0: 40, x1: 290, y1: 80 });
  assert.deepEqual(E.unturn({ x0: 10, y0: 20, x1: 30, y1: 60 }, 0, 300, 100), { x0: 10, y0: 20, x1: 30, y1: 60 });

  const pool = await E.pool({ langs: 'ind+eng', size: 2 });
  try {
    assert.equal(pool.size, 2);
    // two pages side by side, one faded
    const [clean, faded] = await Promise.all([pool.recognize(page(TEXT), { make }), pool.recognize(page(TEXT, { faded: true }), { make })]);
    for (const r of [clean, faded]) {
      assert.match(r.data.text, /Gamelan/); assert.match(r.data.text, /bonang/); assert.equal(r.rotate, 0);
    }
    // a photo of a page with a heavy shadow (dark at one corner) and grain: the paper is evened out first
    const shadow = make(1400, 900), sx = shadow.getContext('2d'), grad = sx.createLinearGradient(0, 0, 1400, 900);
    grad.addColorStop(0, '#f4efe4'); grad.addColorStop(0.6, '#9a948a'); grad.addColorStop(1, '#4e4a44');
    sx.fillStyle = grad; sx.fillRect(0, 0, 1400, 900); sx.fillStyle = '#2a2620'; sx.font = '40px Georgia';
    TEXT.forEach((t, i) => sx.fillText(t, 60, 130 + i * 160));
    const grain = sx.getImageData(0, 0, 1400, 900); let seed = 7;
    for (let i = 0; i < grain.data.length; i += 4) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; const d = ((seed >> 16) % 60) - 30; for (let k = 0; k < 3; k++) grain.data[i + k] += d; }
    sx.putImageData(grain, 0, 0);
    const dark = await pool.recognize(shadow, { make });
    for (const w of ['saron', 'slendro', 'wayang']) assert.match(dark.data.text, new RegExp(w), `shadowed corner read: ${w}`);
    // a page lying on its side (turned 90° clockwise): read turned back, boxes in the sideways picture
    const sideways = E.turn(page(TEXT), 90, make);
    const r = await pool.recognize(sideways, { make });
    assert.equal(r.rotate, 270, 'turned back a quarter the other way');
    assert.match(r.data.text, /kendang/);
    const word = r.data.words.find(w => /Gamelan/.test(w.text));
    const box = r.toOriginal(word.bbox);
    // "Gamelan" sat top-left on the upright page → top-right, written downwards, on the sideways one
    assert.ok(box.x0 > 700 && box.y0 < 400 && box.y1 - box.y0 > box.x1 - box.x0, JSON.stringify(box));
    // upside down
    const flipped = await pool.recognize(E.turn(page(TEXT), 180, make), { make });
    assert.equal(flipped.rotate, 180); assert.match(flipped.data.text, /laras pelog/);
    console.log(`PASS ocr-engine: clean + faded read side by side (conf ${Math.round(clean.conf)} / ${Math.round(faded.conf)}), sideways / upside-down pages found with boxes mapped back, helpers`);
  } finally { await pool.stop(); }
})().catch(e => { console.error(e); process.exit(1); });
