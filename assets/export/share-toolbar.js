/* Keep the shared reader's toolbar in the same order as the Flipbook editor. */
'use strict';
(() => {
  function init() {
    const bar = document.querySelector('footer');
    const header = document.querySelector('header');
    if (!bar || !header || !document.getElementById('fullscreen')) return;
    const status = document.getElementById('status');
    if (status && status.parentElement === bar) header.append(status);
    const order = ['prev','home','end','next','zoom','bookmark','fullscreen','bookmarks','notes','highlight',
      'speak','podcast','edition','translate','summary','sound','replay'];
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
    // A shared book is a sealed snapshot. Its original reader hides Translate
    // when no translation was saved at export time. Online shares can translate
    // the open pages with the signed-in reader's existing AI entitlement.
    if (/^\/s\/[0-9a-f]{32}$/.test(location.pathname) && !window.MF_SHARE_TRANSLATE_BOUND &&
        window.FLIPBOOK_DATA && window.FlipbookTranslate && document.getElementById('translate')) {
      window.MF_SHARE_TRANSLATE_BOUND = true;
      const book = window.FLIPBOOK_DATA;
      const results = Object.assign({}, book.translations || {});
      const visible = () => {
        const match = /(?:Cover\s*[·.]\s*)?(\d+)(?:\s*[–-]\s*(\d+))?\s*\/\s*\d+/i.exec(status && status.textContent || '');
        if (!match) return [];
        const start = Number(match[1]), end = Number(match[2] || match[1]);
        return Array.from({length: Math.min(2, end - start + 1)}, (_, offset) => start - 1 + offset);
      };
      const view = window.FlipbookTranslate.bind({
        translations: () => results,
        visible,
        button: document.getElementById('translate'),
        text: index => (book.text && book.text[String(index)] || []).join('\n'),
        preferred: () => book.lang === 'id-ID' ? 'en-US' : 'id-ID',
        save: (lang, pages) => { results[lang] = Object.assign(results[lang] || {}, pages); },
        translate: async (pages, target) => {
          const capsResponse = await fetch('/api/capabilities', {cache: 'no-store'});
          if (!capsResponse.ok) throw Error('Layanan terjemahan belum tersedia.');
          const caps = await capsResponse.json();
          if (!caps.token) throw Error('Masuk ke akun Medium atau Pro untuk menerjemahkan halaman.');
          const response = await fetch('/api/translate', {method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-Build-Token': caps.token},
            body: JSON.stringify({pages, target, title: book.title || 'Buku'})});
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw Error(result.error || 'Terjemahan gagal.');
          return result.pages || {};
        }
      });
      new MutationObserver(() => view.pageChanged()).observe(status, {childList: true, characterData: true, subtree: true});
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
