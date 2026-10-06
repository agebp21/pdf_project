// Login nudge: free visitors get a login popup after 3 active minutes
// (weekly at most), never for members, never while typing or over dialogs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('../.build/qa-runtime/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/index.html', virtualConsole: new VirtualConsole() });
const w = dom.window;
global.window = w; global.document = w.document; global.localStorage = w.localStorage; global.location = w.location;
const intervals = [];
global.setInterval = (fn) => { intervals.push({ fn, cleared: false }); return intervals.length - 1; };
global.clearInterval = (id) => { if (intervals[id]) intervals[id].cleared = true; };
let meUser = null, posted = null;
global.fetch = async (url, opts) => {
  if (url === '/api/auth/me') return { ok: true, json: async () => ({ user: meUser }) };
  if (url === '/api/auth/login') { posted = JSON.parse(opts.body); return { ok: true, json: async () => ({}) }; }
  throw new Error('unexpected ' + url);
};
eval(fs.readFileSync(require('node:path').join(__dirname, '../assets/auth.js'), 'utf8'));
const { due } = w.MFAuth._nudge;
const now = Date.now();
(async () => {
  assert.equal(due(0, now), true, 'never shown: due');
  assert.equal(due(now, now), false, 'just shown: wait a week');
  assert.equal(due(now - 8 * 24 * 3600 * 1000, now), true, 'old stamp: due again');
  const tick = async () => { for (const t of intervals) if (!t.cleared) await t.fn(); await new Promise(r => setTimeout(r, 10)); };
  let stopNudge = null;
  const run = () => { if (stopNudge) stopNudge(); stopNudge = w.MFAuth.nudge(5); };
  const modal = () => w.document.getElementById('mf-nudge-back');
  // A guest who keeps working sees the popup with a working login form.
  run();
  await tick();
  assert.ok(modal(), 'popup shows after 5 active seconds');
  assert.ok(modal().querySelector('h2').textContent.length > 3, 'titled');
  assert.equal(modal().querySelectorAll('input').length, 2, 'email + password');
  modal().querySelector('input[type="email"]').value = 'm@b.co';
  modal().querySelector('input[type="password"]').value = 'rahasia-123';
  modal().querySelector('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(posted, { email: 'm@b.co', password: 'rahasia-123' }, 'login posted');
  assert.equal(modal(), null, 'closes after login');
  // Later closes it and snoozes for a week (showing stamps the week).
  w.localStorage.removeItem('mf-login-nudge');
  run(); await tick();
  assert.ok(modal(), 'popup returns while still a guest');
  modal().querySelector('.mf-nudge-later').click();
  assert.equal(modal(), null, 'later closes');
  assert.ok(Number(w.localStorage.getItem('mf-login-nudge')) > 0, 'snooze stamped');
  run(); await tick();
  assert.equal(modal(), null, 'snoozed: stays away');
  // Members never see it (refresh the cached session first).
  w.localStorage.removeItem('mf-login-nudge');
  meUser = { email: 'm@b.co', plan: 'free' };
  await w.MFAuth.me(true);
  run(); await tick();
  assert.equal(modal(), null, 'members: no popup');
  meUser = null;
  await w.MFAuth.me(true);
  // Typing defers it (the timer simply tries again later).
  const input = w.document.createElement('input'); w.document.body.appendChild(input); input.focus();
  run(); await tick();
  assert.equal(modal(), null, 'typing: deferred');
  input.remove();
  // Another dialog open defers it too.
  const other = w.document.createElement('div'); other.setAttribute('role', 'dialog'); w.document.body.appendChild(other);
  run(); await tick();
  assert.equal(modal(), null, 'open dialog: deferred');
  other.remove();
  // Not on the login/account pages themselves.
  w.history.pushState({}, '', '/login.html');
  run(); await tick();
  assert.equal(modal(), null, 'login page: no self-popup');
  w.history.pushState({}, '', '/index.html');
  // On-demand wall (downloads, flipbook entry): guests get the popup now,
  // members and offline pages pass straight through.
  let continued = 0, cancelled = 0;
  await w.MFAuth.me(true);
  w.MFAuth.loginPopup(() => { continued++; }, () => { cancelled++; });
  await new Promise(r => setTimeout(r, 10));
  assert.ok(modal(), 'guest: wall opens on demand');
  modal().querySelector('.mf-nudge-x').click();
  assert.equal(cancelled, 1, 'walking away reports cancel');
  assert.equal(continued, 0, 'no success without login');
  w.MFAuth.loginPopup(() => { continued++; });
  await new Promise(r => setTimeout(r, 10));
  modal().querySelector('input[type="email"]').value = 'w@b.co';
  modal().querySelector('input[type="password"]').value = 'rahasia-123';
  modal().querySelector('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(continued, 1, 'logged in: the held action continues');
  assert.equal(modal(), null, 'modal closes after login');
  meUser = { email: 'w@b.co', plan: 'free' };
  await w.MFAuth.me(true);
  continued = 0;
  w.MFAuth.loginPopup(() => { continued++; });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(continued, 1, 'members pass straight through');
  assert.equal(modal(), null, 'members: no wall either');
  // Trial wall: expired members get the upgrade popup instead of the feature.
  const upg = () => w.document.getElementById('mf-upg-back');
  assert.equal(w.MFAuth.trialWall(null), false, 'guests: no trial wall (login wall handles them)');
  assert.equal(w.MFAuth.trialWall({ plan: 'free' }), false, 'fresh trial: passes');
  assert.equal(w.MFAuth.trialWall({ plan: 'pro' }), false, 'paid: passes');
  assert.equal(w.MFAuth.trialWall({ plan: 'free', trialExpired: true }), true, 'expired: walled');
  assert.ok(upg(), 'upgrade popup opens');
  assert.ok(upg().querySelector('h2').textContent.length > 3, 'titled');
  assert.ok(upg().querySelector('.mf-nudge-reg').href.includes('account.html'), 'plans link goes to the account page');
  upg().querySelector('.mf-nudge-later').click();
  assert.equal(upg(), null, 'later closes the upgrade wall');
  w.close();
  console.log('PASS login nudge: weekly cadence, guest popup + login, snooze, member/typing/dialog/login-page skips');
  console.log('PASS trial wall: expired members walled with upgrade, everyone else passes');
})().catch(e => { console.error(e); process.exit(1); }).then(() => process.exit(0));
