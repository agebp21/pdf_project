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
      name.textContent = data.user.name || data.user.email.split('@')[0];
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
  window.MFAuth = { me: me, api: api, safeNext: safeNext, mount: mount };
})();
