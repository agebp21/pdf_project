// The AI allowance line under both chats (flipbook highlight chat: aiAllowance in flipbook.js;
// AI Summarizer: aiLeft in notebook.html) also knows the month: close to its end it says
// "bulan ini x dari y"; used up, it says so with the date it refills, whatever the 5-hour window says.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('../.build/qa-runtime/node_modules/jsdom');
const root = path.join(__dirname, '..');
const cut = (source, name) => {
  const start = source.indexOf(`async function ${name}()`);
  assert.ok(start >= 0, name);
  let depth = 0, i = source.indexOf('{', start);
  for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && !--depth) break; }
  return source.slice(start, i + 1);
};
const dom = new JSDOM('<!doctype html><body><div id="ai-left" hidden></div></body>');
const w = dom.window;
let usage = null;
const make = (name, source) => new Function('document', 'fetch', 'L', '$', `${cut(source, name)}; return ${name};`)(
  w.document, async () => ({ ok: true, json: async () => usage }), (en, id) => id, s => w.document.querySelector(s));
const allowance = make('aiAllowance', fs.readFileSync(path.join(root, 'assets/flipbook.js'), 'utf8'));
const aiLeft = make('aiLeft', fs.readFileSync(path.join(root, 'notebook.html'), 'utf8'));
const end = Date.UTC(2026, 11, 1, 0, 0) / 1000 - 7 * 3600;      // 1 December, Jakarta
const day = new Date(end * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' });
const at = n => ({ limited: true, quotas: { ai: { used: 3, limit: 50, resetAt: null, month: { used: n, limit: 600, resetAt: end } } } });

(async () => {
  usage = at(100);
  assert.equal((await allowance()).text, 'Penggunaan kuota AI: 3 dari 50', 'early in the month: the 5-hour line only');
  usage = at(500);
  let a = await allowance();
  assert.equal(a.text, 'Penggunaan kuota AI: 3 dari 50 · bulan ini 500 dari 600', 'past 80% of the month: said too');
  assert.equal(a.out, false);
  usage = at(600);
  a = await allowance();
  assert.deepEqual(a, { out: true, used: 600, limit: 600, text: `Kuota AI bulan ini habis · terisi lagi ${day}` }, 'month used up');

  await aiLeft();
  const out = w.document.querySelector('#ai-left');
  assert.equal(out.hidden, false);
  assert.equal(out.querySelector('span').textContent, `Kuota AI bulan ini habis · terisi lagi ${day}`);
  assert.ok(out.classList.contains('is-out'));
  assert.equal(out.querySelector('.ai-bar i').style.width, '100%');
  assert.ok(out.querySelector('.ai-bar').classList.contains('is-out'));
  usage = at(500);
  await aiLeft();
  assert.equal(out.querySelector('span').textContent, 'Penggunaan kuota AI: 3 dari 50 · bulan ini 500 dari 600');
  assert.equal(out.querySelector('.ai-bar i').style.width, '6%');
  assert.ok(!out.classList.contains('is-out'));
  usage = { limited: true, quotas: { ai: { used: 3, limit: 50, resetAt: null } } };
  assert.equal((await allowance()).text, 'Penggunaan kuota AI: 3 dari 50', 'no monthly limit: as before');
  console.log('PASS ai month: both chats show the monthly AI quota near its end and when used up');
})().catch(e => { console.error(e); process.exit(1); });
