/* MyFlipbook account chip for page navs + small shared helpers.
 *
 * Put <span data-auth-slot></span> in a nav and load this script. It shows
 * "Log in" or the signed-in name + plan (link to account.html). When the page
 * is served without the Python server (plain static hosting / file://) the
 * API is missing and the slot simply stays empty.
 */
(function () {
  'use strict';
  var cache = null;
  // Visit statistics: counted once the page runs in a real browser (once per page).
  if (!window.__mfVisitSent && /^https?:$/.test(location.protocol)) {
    window.__mfVisitSent = true;
    try {
      fetch('/api/visit', { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: location.pathname, ref: document.referrer || '' }) }).catch(function () {});
    } catch (e) {}
  }
  // Referral link (?ref=CODE): kept 30 days, read when an account is created.
  try {
    var ref = new URLSearchParams(location.search).get('ref');
    if (ref && /^[A-Za-z0-9]{4,12}$/.test(ref)) document.cookie = 'mf_ref=' + ref.toUpperCase() + '; Max-Age=' + 30 * 86400 + '; Path=/; SameSite=Lax';
  } catch (e) {}
  var T = function (key, fallback) {
    var value = window.I18N ? window.I18N.t(key) : key;
    return value === key ? fallback : value;
  };

  function me(refresh) {
    if (!cache || refresh) {
      cache = fetch('/api/auth/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : { user: null, offline: true }; })
        .catch(function () { return { user: null, offline: true }; });
    }
    return cache;
  }

  // Only same-site page paths are allowed as post-login destinations.
  function safeNext(value) {
    return /^[a-z0-9-]+\.html(\?[^#<>"']*)?$/i.test(value || '') ? value : null;
  }

  async function api(method, path, body) {
    var response = await fetch(path, {
      method: method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = {};
    try { data = await response.json(); } catch (e) {}
    if (!response.ok) {
      var error = new Error(data.error || ('HTTP ' + response.status));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function injectStyle() {
    if (document.getElementById('mf-auth-style')) return;
    var style = document.createElement('style');
    style.id = 'mf-auth-style';
    style.textContent =
      '.mf-auth-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #E4DED0;background:#fff;color:#1C1917;' +
      'border-radius:999px;padding:7px 12px;font:800 12px/1 "Plus Jakarta Sans",system-ui,sans-serif;text-decoration:none;' +
      'box-shadow:0 4px 12px rgba(28,25,23,.06);white-space:nowrap;max-width:220px;transition:transform .15s}' +
      '.mf-auth-chip:hover{transform:translateY(-1px)}' +
      '.mf-auth-chip .mf-plan{font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;padding:3px 7px;border-radius:999px;background:#E4F3C2;color:#1A3C34}' +
      '.mf-auth-chip .mf-plan.paid{background:#1A3C34;color:#FFF7EA}' +
      '.mf-auth-chip .mf-name{overflow:hidden;text-overflow:ellipsis}';
    document.head.appendChild(style);
  }

  function render(slot, data) {
    slot.replaceChildren();
    if (data.offline) return;
    var link = document.createElement('a');
    link.className = 'mf-auth-chip';
    if (data.user) {
      link.href = 'account.html';
      var name = document.createElement('span');
      name.className = 'mf-name';
      name.textContent = (data.user.verified ? '✓ ' : '') + (data.user.name || data.user.email.split('@')[0]);
      link.title = data.user.email + (data.user.verified ? ' · ' + T('auth.verified', 'verified') : '');
      var plan = document.createElement('span');
      plan.className = 'mf-plan' + (data.user.plan !== 'free' ? ' paid' : '');
      plan.textContent = data.user.planName;
      link.append(name, plan);
    } else {
      link.href = 'login.html?next=' + encodeURIComponent(location.pathname.replace(/^\//, '') + location.search);
      link.textContent = T('auth.login', 'Log in');
    }
    slot.appendChild(link);
  }

  function mount() {
    var slots = document.querySelectorAll('[data-auth-slot]');
    if (!slots.length) return;
    injectStyle();
    me().then(function (data) {
      for (var i = 0; i < slots.length; i++) render(slots[i], data);
    });
  }

  document.addEventListener('langchange', mount);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  /* Login nudge: free visitors may try everything, but after 3 minutes of
   * active use a login popup invites them in (once a week at most, never
   * for members, never while typing or over another dialog). Runs on every
   * page that loads this script.
   */
  var NUDGE_AFTER = 180;            // active seconds before the popup
  var NUDGE_EVERY = 7 * 24 * 3600;  // seconds between popups
  var NUDGE_KEY = 'mf-login-nudge';
  var NUDGE_SKIP = /(^|\/)(login|account)\.html$/;

  function nudgeDue(lastShown, now) {
    return !lastShown || (now - lastShown) >= NUDGE_EVERY * 1000;
  }

  function nudgeBusy() {
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (document.activeElement && document.activeElement.isContentEditable) return true;
    return !!document.querySelector('[role="dialog"]:not([hidden]), [role="alertdialog"]:not([hidden])');
  }

  function nudgeStamp(now) {
    try { localStorage.setItem(NUDGE_KEY, String(now)); } catch (e) {}
  }

  function nudgeLast() {
    try { return Number(localStorage.getItem(NUDGE_KEY)) || 0; } catch (e) { return 0; }
  }

  function nudgeSnooze() { nudgeStamp(Date.now()); }

  function nudgeStyle() {
    if (document.getElementById('mf-nudge-style')) return;
    var style = document.createElement('style');
    style.id = 'mf-nudge-style';
    style.textContent =
      '.mf-nudge-back{position:fixed;inset:0;z-index:4000;display:flex;align-items:center;justify-content:center;' +
      'padding:16px;background:rgba(28,25,23,.5);backdrop-filter:blur(3px)}' +
      '.mf-nudge-back[hidden]{display:none}' +
      '.mf-nudge-card{position:relative;width:min(400px,100%);max-height:calc(100vh - 32px);overflow:auto;' +
      'padding:24px 22px 18px;border-radius:22px;background:#FFFDF6;border:1.5px solid #1C1917;box-shadow:5px 5px 0 #1C1917;' +
      'font-family:"Plus Jakarta Sans",system-ui,sans-serif;color:#1C1917}' +
      '.mf-nudge-card h2{margin:0 0 8px;font-size:19px;text-align:center}' +
      '.mf-nudge-card p{margin:0 0 12px;font-size:13px;line-height:1.55;color:#57534E;text-align:center}' +
      '.mf-nudge-card form{display:grid;gap:8px}' +
      '.mf-nudge-card input{width:100%;padding:10px 12px;border:1.5px solid #E4DED0;border-radius:12px;font-size:13px;box-sizing:border-box}' +
      '.mf-nudge-card button{cursor:pointer}' +
      '.mf-nudge-go{padding:11px;border:0;border-radius:999px;background:#FF5C28;color:#fff;font-weight:800;font-size:14px}' +
      '.mf-nudge-error{min-height:1.2em;font-size:12px;color:#b3121a;text-align:center}' +
      '.mf-nudge-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px}' +
      '.mf-nudge-later{border:0;background:none;color:#57534E;font-size:13px;text-decoration:underline}' +
      '.mf-nudge-reg{font-size:13px;font-weight:700;color:#1A3C34}' +
      '.mf-nudge-x{position:absolute;top:8px;right:10px;border:0;background:none;font-size:20px;color:#57534E}' +
      '.mf-nudge-g{margin:4px auto 0;min-height:0}';
    document.head.appendChild(style);
  }

  function nudgeGoogle(box, clientId, onDone) {
    if (window.google && window.google.accounts) { nudgeGoogleRender(box, clientId, onDone); return; }
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = function () { nudgeGoogleRender(box, clientId, onDone); };
    s.onerror = function () {};
    document.head.appendChild(s);
  }

  function nudgeGoogleRender(box, clientId, onDone) {
    try {
      window.google.accounts.id.initialize({ client_id: clientId, callback: function (response) {
        api('POST', '/api/auth/google', { credential: response.credential }).then(onDone, function (error) { onDone(null, error); });
      }});
      window.google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: 300 });
    } catch (e) {}
  }

  function showNudge(clientId, onLogin, onClose) {
    if (document.getElementById('mf-nudge-back')) return;
    nudgeStyle();
    var done = onLogin || function () { location.reload(); };
    var back = document.createElement('div');
    back.className = 'mf-nudge-back'; back.id = 'mf-nudge-back';
    back.innerHTML =
      '<div class="mf-nudge-card" role="dialog" aria-modal="true" aria-labelledby="mf-nudge-title">' +
      '<button type="button" class="mf-nudge-x" aria-label="' + T('auth.nudgeClose', 'Close') + '">×</button>' +
      '<h2 id="mf-nudge-title"></h2><p class="mf-nudge-sub"></p>' +
      '<form><input type="email" required autocomplete="email" /><input type="password" required autocomplete="current-password" />' +
      '<button type="submit" class="mf-nudge-go"></button></form>' +
      '<p class="mf-nudge-error"></p><div class="mf-nudge-g"></div>' +
      '<div class="mf-nudge-row"><button type="button" class="mf-nudge-later"></button><a class="mf-nudge-reg" href="#"></a></div></div>';
    back.querySelector('h2').textContent = T('auth.nudgeTitle', 'Keep your books everywhere');
    back.querySelector('.mf-nudge-sub').textContent = T('auth.nudgeBody', 'Free to try, free to join.');
    var inputs = back.querySelectorAll('input');
    inputs[0].placeholder = T('auth.email', 'Email');
    inputs[0].setAttribute('aria-label', T('auth.email', 'Email'));
    inputs[1].placeholder = T('auth.password', 'Password');
    inputs[1].setAttribute('aria-label', T('auth.password', 'Password'));
    back.querySelector('.mf-nudge-go').textContent = T('auth.submitLogin', 'Log in →');
    back.querySelector('.mf-nudge-later').textContent = T('auth.nudgeLater', 'Later');
    var reg = back.querySelector('.mf-nudge-reg');
    reg.textContent = T('auth.nudgeRegister', 'No account yet? Create one →');
    reg.href = 'login.html?mode=register&next=' + encodeURIComponent(location.pathname.replace(/^\//, '') + location.search);
    function close(cancelled) {
      if (cancelled !== false) nudgeSnooze();
      back.remove();
      if (cancelled && onClose) { try { onClose(); } catch (e) {} }
    }
    back.querySelector('.mf-nudge-x').onclick = function () { close(true); };
    back.querySelector('.mf-nudge-later').onclick = function () { close(true); };
    back.addEventListener('mousedown', function (event) { if (event.target === back) close(true); });
    back.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(true); });
    var error = back.querySelector('.mf-nudge-error');
    back.querySelector('form').addEventListener('submit', function (event) {
      event.preventDefault(); error.textContent = '';
      api('POST', '/api/auth/login', { email: inputs[0].value.trim(), password: inputs[1].value }).then(
        function () { close(false); done(); },
        function (cause) { error.textContent = cause.message || cause; });
    });
    document.body.appendChild(back);
    if (clientId) nudgeGoogle(back.querySelector('.mf-nudge-g'), clientId, function (ok, cause) {
      if (ok !== null && !cause) { close(false); done(); }
      else error.textContent = (cause && cause.message) || cause || '';
    });
    var email = back.querySelector('input[type="email"]');
    if (email) email.focus();
  }

  function nudgeStart(afterSeconds, hooks) {
    hooks = hooks || {};
    if (NUDGE_SKIP.test(location.pathname)) return function () {};
    var active = 0, lastTouch = 0, shown = false, timer = null;
    function touch() { lastTouch = Date.now(); }
    ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'].forEach(function (name) {
      document.addEventListener(name, touch, { passive: true });
    });
    touch();
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    timer = setInterval(function () {
      if (shown || document.visibilityState === 'hidden') return;
      if (Date.now() - lastTouch > 30000) return;
      active += 5;
      if (active < (afterSeconds == null ? NUDGE_AFTER : afterSeconds)) return;
      me().then(function (data) {
        if (shown || data.user || data.offline) { if (data.user || data.offline) stop(); return; }
        if (!nudgeDue(nudgeLast(), Date.now())) { stop(); return; }
        if (nudgeBusy()) return;
        shown = true; stop();
        nudgeSnooze();
        (hooks.show || showNudge)(data.googleClientId, hooks.onLogin);
      });
    }, 5000);
    return stop;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { nudgeStart(); });
  else nudgeStart();

  /* On-demand login wall (downloads, flipbook entry): guests get the same
   * popup right away; onSuccess continues what they were doing (no reload),
   * onCancel runs when they walk away. Members and offline pages pass
   * straight through.
   */
  function loginPopup(onSuccess, onCancel) {
    me(true).then(function (data) {
      if (data.user || data.offline) { if (onSuccess) onSuccess(); return; }
      if (document.getElementById('mf-nudge-back')) return;
      showNudge(data.googleClientId, function () {
        cache = null;
        me(true).then(function () { mount(); if (onSuccess) onSuccess(); });
      }, onCancel);
    }, function () { if (onSuccess) onSuccess(); });
  }

  /* Free-trial wall: after 7 days only the flipbook reader stays. Locked
   * actions call trialWall(user) instead: expired members get the upgrade
   * popup every time (it is a gate, not a nudge), everyone else passes.
   */
  function trialExpired(user) { return !!(user && user.plan === 'free' && user.trialExpired); }

  function upgradePopup() {
    if (document.getElementById('mf-upg-back')) return;
    nudgeStyle();
    var back = document.createElement('div');
    back.className = 'mf-nudge-back'; back.id = 'mf-upg-back';
    back.innerHTML =
      '<div class="mf-nudge-card" role="dialog" aria-modal="true" aria-labelledby="mf-upg-title">' +
      '<button type="button" class="mf-nudge-x" aria-label="' + T('auth.nudgeClose', 'Close') + '">×</button>' +
      '<h2 id="mf-upg-title"></h2><p class="mf-nudge-sub"></p>' +
      '<div class="mf-nudge-row"><a class="mf-nudge-reg" href="account.html"></a>' +
      '<button type="button" class="mf-nudge-later"></button></div></div>';
    back.querySelector('h2').textContent = T('auth.upgTitle', 'Free trial ended');
    back.querySelector('.mf-nudge-sub').textContent = T('auth.upgBody', 'Upgrade to Pro.');
    var plans = back.querySelector('.mf-nudge-reg');
    plans.textContent = T('auth.upgPlans', 'See plans →');
    back.querySelector('.mf-nudge-later').textContent = T('auth.nudgeLater', 'Later');
    function close() { back.remove(); }
    back.querySelector('.mf-nudge-x').onclick = close;
    back.querySelector('.mf-nudge-later').onclick = close;
    back.addEventListener('mousedown', function (event) { if (event.target === back) close(); });
    back.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); });
    document.body.appendChild(back);
  }

  function trialWall(user) {
    if (!trialExpired(user)) return false;
    upgradePopup();
    return true;
  }

  window.MFAuth = { me: me, api: api, safeNext: safeNext, mount: mount, nudge: nudgeStart, loginPopup: loginPopup, trialWall: trialWall, _nudge: { due: nudgeDue, busy: nudgeBusy } };
})();
