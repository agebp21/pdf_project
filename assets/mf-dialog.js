/* MyFlipbook dialogs: a confirm / message box in the middle of the screen, in
 * the site's own look, instead of the browser's confirm() / alert() bar.
 *
 *   if (!await MFDialog.confirm({title: 'Hapus buku?', message: '…', ok: 'Hapus', danger: true})) return;
 *   await MFDialog.alert({title: 'Selesai', message: '…'});
 *
 * Esc / a click outside = cancel, Enter = the focused button. A dangerous
 * action starts on "Batal", so Enter alone never deletes anything.
 */
(function (root) {
  'use strict';

  var STYLE =
    '.mfd-back{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;' +
    'background:rgba(28,25,23,.42);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);animation:mfd-fade .14s ease-out}' +
    '.mfd-card{width:min(420px,100%);background:#FFFDF8;border:1px solid #E8E2D4;border-radius:24px;padding:24px 22px 20px;' +
    'box-shadow:0 24px 60px rgba(28,25,23,.28),inset 0 1px 0 #fff;text-align:center;color:#1C1917;' +
    'font-family:"Plus Jakarta Sans",system-ui,sans-serif;animation:mfd-pop .18s cubic-bezier(.2,.9,.3,1.2)}' +
    '.mfd-icon{width:52px;height:52px;margin:0 auto 12px;border-radius:16px;display:flex;align-items:center;justify-content:center;' +
    'font-size:26px;background:#EFF6EC;box-shadow:inset 0 -3px 0 rgba(26,60,52,.08)}' +
    '.mfd-card.danger .mfd-icon{background:#FEF2F2}' +
    '.mfd-title{margin:0 0 6px;font:800 19px/1.3 "Fraunces",Georgia,serif;overflow-wrap:anywhere}' +
    '.mfd-msg{margin:0;font-size:13.5px;line-height:1.6;color:#57534E;overflow-wrap:anywhere;white-space:pre-line}' +
    '.mfd-actions{display:flex;gap:10px;justify-content:center;margin-top:20px}' +
    '.mfd-btn{flex:1;max-width:170px;border:0;border-radius:999px;padding:11px 18px;font:800 13px "Plus Jakarta Sans",system-ui,sans-serif;' +
    'cursor:pointer;transition:transform .12s,box-shadow .12s}' +
    '.mfd-btn:hover{transform:translateY(-1px)}' +
    '.mfd-btn:focus-visible{outline:3px solid #A3C98A;outline-offset:2px}' +
    '.mfd-cancel{background:#F3EFE6;color:#44403C}' +
    '.mfd-ok{background:#1A3C34;color:#FFF7EA;box-shadow:0 6px 16px rgba(26,60,52,.25)}' +
    '.mfd-card.danger .mfd-ok{background:#DC2626;box-shadow:0 6px 16px rgba(220,38,38,.28)}' +
    '@keyframes mfd-fade{from{opacity:0}}@keyframes mfd-pop{from{opacity:0;transform:scale(.94) translateY(6px)}}' +
    '@media (prefers-reduced-motion:reduce){.mfd-back,.mfd-card{animation:none}}';

  function injectStyle() {
    if (document.getElementById('mfd-style')) return;
    var style = document.createElement('style');
    style.id = 'mfd-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function idLang() { return /^id/i.test(document.documentElement.lang || ''); }

  function open(options, withCancel) {
    options = typeof options === 'string' ? { message: options } : (options || {});
    injectStyle();
    var before = document.activeElement;
    return new Promise(function (resolve) {
      var back = el('div', 'mfd-back');
      var card = el('div', 'mfd-card' + (options.danger ? ' danger' : ''));
      card.setAttribute('role', withCancel ? 'alertdialog' : 'dialog');
      card.setAttribute('aria-modal', 'true');
      var title = el('h2', 'mfd-title', options.title || (withCancel ? (idLang() ? 'Yakin?' : 'Are you sure?') : 'MyFlipbook'));
      title.id = 'mfd-title-' + Date.now();
      card.setAttribute('aria-labelledby', title.id);
      card.append(el('div', 'mfd-icon', options.icon || (options.danger ? '🗑️' : withCancel ? '❓' : 'ℹ️')), title);
      if (options.message) card.append(el('p', 'mfd-msg', options.message));
      var actions = el('div', 'mfd-actions');
      var ok = el('button', 'mfd-btn mfd-ok', options.ok || 'OK');
      ok.type = 'button';
      var cancel = null;
      if (withCancel) {
        cancel = el('button', 'mfd-btn mfd-cancel', options.cancel || (idLang() ? 'Batal' : 'Cancel'));
        cancel.type = 'button';
        actions.append(cancel);
      }
      actions.append(ok);
      card.append(actions);
      back.append(card);

      function close(answer) {
        document.removeEventListener('keydown', keys, true);
        back.remove();
        if (before && before.focus) try { before.focus(); } catch (e) {}
        resolve(answer);
      }
      function keys(event) {
        if (event.key === 'Escape') { event.preventDefault(); close(false); }
        else if (event.key === 'Tab') {         // keep focus inside the box
          var buttons = cancel ? [cancel, ok] : [ok];
          var i = buttons.indexOf(document.activeElement);
          event.preventDefault();
          buttons[(i + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
        }
      }
      ok.onclick = function () { close(true); };
      if (cancel) cancel.onclick = function () { close(false); };
      back.addEventListener('mousedown', function (event) { if (event.target === back) close(false); });
      document.addEventListener('keydown', keys, true);
      document.body.appendChild(back);
      (options.danger && cancel ? cancel : ok).focus();
    });
  }

  root.MFDialog = {
    confirm: function (options) { return open(options, true); },
    alert: function (options) { return open(options, false).then(function () {}); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
