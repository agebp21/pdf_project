// Letter-spaced titles ("T H E  R O U T L E D G E"): pdf.js gives one space
// between every letter; the words are put back from the painted glyphs —
// a painted word-space glyph (fonts with private-use codes) or wider room.
const assert = require('node:assert/strict');
global.window = global;
require('../assets/pdf-layout.js');
const { spacedWords, looksSpaced } = global.PdfLayout;
const P = c => String.fromCharCode(0xe000 + c.charCodeAt(0));   // pdf.js private-use glyphs

// Word spaces painted as their own glyph.
let x = 0;
const painted = [...'THE ROUTLEDGE CO'].map(c => ({ text: P(c), x: (x += 10), w: c === ' ' ? 4 : 9 }));
assert.equal(spacedWords('T H E R O U T L E D G E C O', painted), 'THE ROUTLEDGE CO');
// Plain letters: words from the wider gaps.
x = 0; const glyphs = [];
for (const c of 'ART OF MAN') { if (c === ' ') { x += 8; continue; } glyphs.push({ text: c, x, w: 8 }); x += 10; }
assert.equal(spacedWords('A R T O F M A N', glyphs), 'ART OF MAN');
// Ordinary text is left alone.
assert.equal(spacedWords('The individual arts', glyphs), 'The individual arts');
assert.equal(spacedWords('A B', glyphs), 'A B');
assert.ok(looksSpaced('C O N T E N T S') && looksSpaced('C O M PA N I O N'));
assert.ok(!looksSpaced('PART 4') && !looksSpaced('A B C') && !looksSpaced('I am a big fan'));
console.log('PASS pdf-layout spaced titles: painted word spaces, wider gaps, ordinary text untouched');
