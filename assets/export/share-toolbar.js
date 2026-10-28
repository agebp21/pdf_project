/* Keep the shared reader's toolbar in the same order as the Flipbook editor. */
'use strict';
(() => {
  function init() {
    const bar = document.querySelector('footer');
    const header = document.querySelector('header');
    if (!bar || !header || !document.getElementById('fullscreen')) return;
    const status = document.getElementById('status');
    if (status && status.parentElement === bar) header.append(status);
    const order = ['prev','home','end','next','zoom','bookmark','bookmarks','notes','highlight',
      'fullscreen','speak','podcast','edition','translate','summary','sound','replay'];
    order.forEach(id => { const button = document.getElementById(id); if (button && button.parentElement === bar) bar.append(button); });
    const next = document.getElementById('next');
    if (next) {
      const compact = () => { if (next.textContent !== '→') next.textContent = '→'; };
      new MutationObserver(compact).observe(next, {childList:true,subtree:true,characterData:true});
      compact();
    }
    const fullscreen = document.getElementById('fullscreen');
    const label = () => { fullscreen.textContent = document.fullscreenElement ? '⛶ Keluar layar penuh' : '⛶ Layar penuh'; };
    document.addEventListener('fullscreenchange', label);
    label();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
