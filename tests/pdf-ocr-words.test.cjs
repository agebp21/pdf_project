// Text in pictures (OCR): which pages need it, and Tesseract's lines →
// PdfWords lines (positions in the book page box), weak words/lines dropped.
const assert = require('node:assert/strict');
global.self = global;
require('../assets/pdf-links.js');
require('../assets/pdf-ocr-words.js');
const O = global.PdfOcrWords;

// needs(): a page with fewer than 8 words is a picture page.
assert.equal(O.needs({}, 0), true);
assert.equal(O.needs({ '0': [[100, 50, 1, 2, 3, 4]] }, 0), true);
assert.equal(O.needs({ '0': [[100, 50, ...Array(16).fill(1)]] }, 0), false);

const word = (text, x0, y0, x1, y1, confidence = 90) => ({ text, confidence, bbox: { x0, y0, x1, y1 } });
const viewport = { width: 500, height: 1000 };   // page 1:2, book page box the same shape
const data = { lines: [
  { words: [word('LOVE', 100, 100, 200, 140), word('YOUR', 220, 100, 320, 140), word('WALLS', 340, 100, 460, 140)] },
  { words: [word('~~', 10, 300, 40, 320, 30), word('|', 50, 300, 60, 320, 40)] },            // symbol soup: dropped
  { words: [word('Shop', 100, 500, 160, 520), word('art', 170, 500, 210, 520, 40), word('1', 215, 500, 220, 520, 70), word('a', 225, 500, 230, 520, 70)] },   // weak word + lone speck dropped, "a" kept
] };
const out = O.toLines(data, 2, viewport, 0.5);
assert.deepEqual(out.text, ['LOVE YOUR WALLS', 'Shop a']);
// scale 2: x 100px → 50pt → 0.1 of the width; y 100px → 50pt → 0.05 of the height.
assert.deepEqual(out.lines[0].slice(0, 4), [500, 200, 1000, 1000]);
assert.equal(out.lines[0].length, 2 + 3 * 2);
// Too little readable text: nothing.
assert.equal(O.toLines({ lines: [{ words: [word('Hi', 0, 0, 10, 10)] }] }, 1, viewport, 0.5), null);
console.log('PASS pdf-ocr-words: picture pages found, OCR lines → word positions, weak words / symbol lines / near-empty pages dropped');
