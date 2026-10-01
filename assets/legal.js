/* Privacy / Terms: show the Indonesian or English text with the site's
 * language (the ID/EN button switches it). ?lang=id|en forces one. */
(function () {
  'use strict';
  function current() {
    return window.I18N && window.I18N.get() === 'en' ? 'en' : 'id';
  }
  function show() {
    var lang = current();
    document.querySelectorAll('[data-legal-lang]').forEach(function (part) { part.hidden = part.getAttribute('data-legal-lang') !== lang; });
    document.documentElement.lang = lang;
    var title = document.querySelector('[data-legal-lang="' + lang + '"] h1');
    if (title) document.title = title.textContent + ' — MyFlipbook';
  }
  // A ?lang= link also sets the site language, so the ID/EN button then
  // switches away from what is shown; afterwards the button decides.
  var forced = new URLSearchParams(location.search).get('lang');
  if ((forced === 'id' || forced === 'en') && window.I18N) {
    history.replaceState(null, '', location.pathname + location.hash);
    if (window.I18N.get() !== forced) window.I18N.set(forced);
  }
  document.addEventListener('langchange', show);
  show();
})();
