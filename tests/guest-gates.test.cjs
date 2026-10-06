// Guest + trial gates: downloads and flipbook entry need an account (the
// held action continues after login); expired trials get the upgrade popup
// instead; members and offline pages pass straight through.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM(fs.readFileSync('converter.html', 'utf8'),
  { url: 'http://localhost:8080/converter.html?tool=split-pdf', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
const w = dom.window;
w.console.log = () => {}; w.scrollTo = () => {};
w.URL.createObjectURL = () => 'blob:fake'; w.URL.revokeObjectURL = () => {};
let saved = 0, meUser = null, offline = false;
w.FlipbookTransfer = { save: async () => { saved++; return 'id-1'; } };
w.fetch = async (url, opts) => {
  if (offline) throw new Error('no server');
  if (url === '/api/auth/me') return { ok: true, json: async () => ({ user: meUser }) };
  if (url === '/api/auth/login') return { ok: true, json: async () => ({}) };
  throw new Error('unexpected ' + url);
};
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
w.eval(read('assets/auth.js'));
const script = [...w.document.scripts].find(s => s.textContent.includes('const TOOLS')).textContent;
w.eval(script + `
  window.qaResult = () => { downloadBlob(new Blob(['%PDF-1.4'], {type: 'application/pdf'}), 'a.pdf'); };
  window.qaSetFiles = (v) => { files = v; };
  window.qaClickDownload = () => {
    const a = document.querySelector('#downloadBtn');
    const event = new MouseEvent('click', {bubbles: true, cancelable: true});
    a.dispatchEvent(event);
    return event.defaultPrevented;
  };
  let clicks = 0;
  document.querySelector('#downloadBtn').addEventListener('click', () => { clicks++; });
  window.qaClicks = () => clicks;
  window.qaClickFlipbook = () => { document.querySelector('#makeFlipbook').click(); };
  window.qaEnableFlipbook = () => { const b = document.querySelector('#makeFlipbook'); b.disabled = false; };
  window.qaConvert = () => { document.querySelector('#convertBtn').click(); };
`);
const modal = (id) => w.document.getElementById(id);
const flush = () => new Promise(r => setTimeout(r, 15));
async function loginAs(user) {
  meUser = user;
  await w.MFAuth.me(true);
  const box = modal('mf-nudge-back');
  if (!box) return;
  box.querySelector('input[type="email"]').value = 'm@b.co';
  box.querySelector('input[type="password"]').value = 'rahasia-123';
  box.querySelector('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}
(async () => {
  await w.qaResult();
  // Offline (no server at all): the gate passes through and downloads.
  offline = true;
  assert.equal(await w.qaClickDownload(), true, 'offline: click intercepted');
  await flush();
  assert.equal(await w.qaClicks(), 2, 'offline: manual held, re-click proceeds');
  assert.equal(modal('mf-nudge-back'), null, 'offline: no wall at all');
  offline = false;
  await w.MFAuth.me(true);
  const c0 = await w.qaClicks();
  // Guest download: held for login, then continues where it stopped.
  assert.equal(await w.qaClickDownload(), true, 'guest: download held');
  await flush();
  assert.equal(await w.qaClicks(), c0 + 1, 'guest: no second click yet');
  assert.ok(modal('mf-nudge-back'), 'guest: login wall opens');
  await loginAs({ email: 'm@b.co', plan: 'free' });
  assert.equal(modal('mf-nudge-back'), null, 'modal closes after login');
  assert.equal(await w.qaClicks(), c0 + 2, 'after login: the held download clicks through');
  // Guest flipbook entry: transfer waits for the login too.
  meUser = null; await w.MFAuth.me(true);
  saved = 0;
  await w.qaClickFlipbook();
  await flush();
  assert.ok(modal('mf-nudge-back'), 'guest: flipbook entry walled');
  assert.equal(saved, 0, 'guest: nothing transferred yet');
  await loginAs({ email: 'm@b.co', plan: 'free' });
  assert.equal(saved, 1, 'after login: transfer runs');
  // Expired trial: downloads and Convert die on the upgrade wall instead.
  meUser = { email: 'old@b.co', plan: 'free', trialExpired: true };
  await w.MFAuth.me(true);
  await w.qaEnableFlipbook();
  await w.qaSetFiles([{ name: 'a.pdf' }]);
  await w.qaConvert();
  await flush();
  assert.ok(modal('mf-upg-back'), 'expired: Convert walled with upgrade');
  assert.ok(modal('mf-upg-back').querySelector('.mf-nudge-reg').href.includes('account.html'), 'upgrade points at plans');
  modal('mf-upg-back').querySelector('.mf-nudge-later').click();
  assert.equal(await w.qaClickDownload(), true, 'expired: download held');
  await flush();
  assert.ok(modal('mf-upg-back'), 'expired: download walled with upgrade, not login');
  modal('mf-upg-back').querySelector('.mf-nudge-later').click();
  // Members pass both gates with no wall.
  meUser = { email: 'm@b.co', plan: 'free' };
  await w.MFAuth.me(true);
  saved = 0; const seen = await w.qaClicks();
  assert.equal(await w.qaClickDownload(), true, 'member: click intercepted');
  await flush();
  assert.equal(await w.qaClicks(), seen + 2, 'member: manual held, re-click proceeds');
  await w.qaClickFlipbook();
  assert.equal(saved, 1, 'member: transfer runs');
  assert.equal(modal('mf-upg-back'), null, 'member: no upgrade wall');
  assert.equal(modal('mf-nudge-back'), null, 'member: no login wall either');
  w.close();
  console.log('PASS guest gates: download + flipbook entry walled for guests, trial upgrade walls, continue after login, members/offline pass');
})().catch(e => { console.error(e); process.exit(1); }).then(() => process.exit(0));
