/* Theme toggle for PDF Tools: cream (default) <-> midnight dark.
 *
 * Usage: <button data-theme-toggle>...</button> (label auto-switches moon/sun).
 * Persists in localStorage ('pdf-tools-theme'). Fires 'themechange' on switch.
 * Dark surfaces live in assets/dark-mode.css (phase 1: homepage).
 */
(function () {
  var KEY = 'pdf-tools-theme';
  function get() {
    try {
      return localStorage.getItem(KEY) || 'light';
    } catch (e) {
      return 'light';
    }
  }
  function apply() {
    var dark = get() === 'dark';
    try {
      document.documentElement.classList.toggle('dark', dark);
    } catch (e) {}
    var els = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < els.length; i++) els[i].textContent = dark ? '☀️' : '🌙';
  }
  function toggle() {
    var next = get() === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
    } catch (e) {}
    apply();
    try {
      document.dispatchEvent(new CustomEvent('themechange'));
    } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-theme-toggle]') : null;
    if (b) toggle();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
  window.PDFTheme = { get: get, toggle: toggle, apply: apply, KEY: KEY };
})();
