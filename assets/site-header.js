'use strict';
// The site header, the same on every page (the homepage's): logo + tagline, the main links,
// language, "free tools", the account slot (auth.js fills it) and the convert button.
//
//   <header data-site-header></header>            (anything inside stays, before the language button)
//   <header data-site-header data-static></header> (workspaces: not sticky, their toolbar is)
//   <script defer src="/assets/site-header.js"></script>   — before auth.js
(() => {
  const CSS = `
.sh-wrap{position:relative;z-index:50;flex-shrink:0;max-width:1440px;margin:12px auto 0;padding:0 16px;box-sizing:border-box;width:100%}
.sh-wrap.sh-sticky{position:sticky;top:12px}
.sh-nav{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border-radius:16px;box-sizing:border-box;
  background:linear-gradient(180deg,rgba(255,255,255,.95),rgba(255,255,255,.78));-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);
  border:1px solid #E8E2D4;box-shadow:0 10px 28px rgba(28,25,23,.08),inset 0 1px 0 #fff;font-family:'Plus Jakarta Sans',system-ui,sans-serif}
.sh-brand{display:flex;flex-direction:column;gap:1px;text-decoration:none;flex:none;line-height:1}
.sh-brand img{display:block;height:36px;width:auto}
.sh-brand span{font-size:10px;font-weight:700;letter-spacing:.18em;color:#78716C;white-space:nowrap}
.sh-links{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700}
.sh-links a,.sh-star{border:1px solid #E8E2D4;background:#fff;box-shadow:0 3px 10px rgba(28,25,23,.05);transition:.15s;border-radius:999px;padding:6px 14px;
  color:#1C1917;text-decoration:none;white-space:nowrap}
.sh-links a:hover,.sh-star:hover{transform:translateY(-1px);box-shadow:0 8px 18px rgba(28,25,23,.09)}
.sh-links a.sh-on{background:#1A3C34;border-color:#1A3C34;color:#fff;box-shadow:0 6px 14px rgba(26,60,52,.25)}   /* the page being looked at */
.sh-right{display:flex;align-items:center;gap:8px;flex:none}
.sh-lang{border-radius:999px;padding:8px 12px;font:800 12px 'Plus Jakarta Sans',system-ui,sans-serif;background:#E9E4FF;border:1px solid #E8E2D4;color:#1C1917;
  box-shadow:0 4px 12px rgba(28,25,23,.08);cursor:pointer;transition:.15s}
.sh-lang:hover{transform:translateY(-2px)}
.sh-free{font-size:10px;font-weight:800;letter-spacing:.1em;background:#E4F3C2;border:1px solid #E8E2D4;border-radius:999px;padding:4px 10px;white-space:nowrap}
.sh-star{display:none;width:36px;height:36px;padding:0;place-items:center;font-size:14px;font-weight:800}
.sh-cta{display:inline-flex;align-items:center;border-radius:999px;padding:8px 16px;font-size:12px;font-weight:800;white-space:nowrap;text-decoration:none;color:#fff;
  background:linear-gradient(180deg,#FF7A45,#FF5C28);border:1px solid #E04E1F;box-shadow:0 10px 22px rgba(255,92,40,.35),inset 0 1px 0 rgba(255,255,255,.45),inset 0 -2px 5px rgba(0,0,0,.12);transition:.18s}
.sh-cta:hover{transform:translateY(-2px);box-shadow:0 16px 30px rgba(255,92,40,.42),inset 0 1px 0 rgba(255,255,255,.45)}
.sh-right>.back-link,.sh-right>.clay-btn{display:inline-flex!important;align-items:center;gap:6px;border:1px solid #E8E2D4!important;background:#fff!important;color:#1C1917!important;
  box-shadow:0 3px 10px rgba(28,25,23,.05)!important;border-radius:999px!important;padding:6px 14px!important;font:700 12px 'Plus Jakarta Sans',system-ui,sans-serif!important;
  letter-spacing:0!important;text-decoration:none;white-space:nowrap;transform:none!important;min-height:0!important;height:auto!important}
.sh-right>.back-link:hover,.sh-right>.clay-btn:hover{box-shadow:0 8px 18px rgba(28,25,23,.09)!important}
@media (max-width:1279px){.sh-free{display:none}}
@media (max-width:1439px){.sh-extras .sh-free{display:none}}      /* a page button too: room for the account and the convert button */
@media (max-width:1365px){.sh-links{gap:6px}.sh-links a{padding:6px 11px}.sh-right{gap:6px}}
@media (max-width:1199px){.sh-links{display:none}.sh-nav .sh-burger{display:grid}}
@media (max-width:1279px){.sh-extras .sh-links{display:none}.sh-nav.sh-extras .sh-burger{display:grid}}   /* a page button too: the menu a little sooner */
.sh-burger{display:none;width:36px;height:36px;place-items:center;border:1px solid #E8E2D4;background:#fff;border-radius:999px;font-size:16px;font-weight:800;cursor:pointer;color:#1C1917}
.sh-drop{position:absolute;right:16px;top:calc(100% + 8px);display:grid;gap:6px;min-width:240px;padding:10px;background:#fff;border:1px solid #E8E2D4;border-radius:16px;box-shadow:0 18px 40px rgba(28,25,23,.16)}
.sh-drop[hidden]{display:none}
.sh-drop a{padding:10px 14px;border-radius:12px;color:#1C1917;text-decoration:none;font:700 13.5px 'Plus Jakarta Sans',system-ui,sans-serif}
.sh-drop a:hover{background:#EFF6EC}.sh-drop a.sh-on{background:#1A3C34;color:#fff}
@media (max-width:639px){.sh-nav{flex-wrap:wrap;row-gap:8px}.sh-right{flex:1 1 auto;justify-content:flex-end;flex-wrap:wrap;row-gap:6px}.sh-cta{display:none}.sh-brand img{height:30px}.sh-brand span{font-size:8.5px}.sh-right{gap:6px}
  .sh-extras .sh-star,.sh-extras .sh-brand span{display:none}
  .sh-extras .sh-right>.clay-btn,.sh-extras .sh-right>.back-link{padding:7px 10px!important;font-size:11px!important;letter-spacing:0!important}}
@media (max-width:379px){.sh-brand img{height:26px}.sh-nav{padding:8px}}
@media print{.sh-wrap{display:none}}
@media (prefers-reduced-motion:reduce){.sh-links a:hover,.sh-star:hover,.sh-lang:hover,.sh-cta:hover{transform:none}}`;

  function build(slot) {
    if (slot.dataset.built) return;
    slot.dataset.built = '1';
    if (!document.getElementById('sh-style')) document.head.append(Object.assign(document.createElement('style'), { id: 'sh-style', textContent: CSS }));
    const extras = [...slot.childNodes];
    const home = location.pathname === '/' || /\/index\.html$/.test(location.pathname);
    const link = (href, key, text) => `<a href="${href}" data-i18n="${key}">${text}</a>`;
    slot.className = 'sh-wrap' + (slot.hasAttribute('data-static') ? '' : ' sh-sticky');
    slot.innerHTML = `<nav class="sh-nav" aria-label="Menu utama">
  <a href="/" class="sh-brand"><img src="/assets/img/logo.png?v=pro" alt="MyFlipbook Pro" width="147" height="36"><span data-i18n="nav.tag">SARVAMAYA • VERSION 1.0</span></a>
  <div class="sh-links">${link(home ? '#grid' : '/#grid', 'nav.all', '✳ Semua alat')}${link('/flipbook.html', 'nav.flip', '▤ Flipbook')}${link('/journals.html', 'nav.journals', '🔎 Cari Jurnal &amp; Buku Digital')}${link('/notebook.html', 'nav.note', '✦ AI Ringkasan')}${link('/harga', 'nav.pricing', '★ Harga')}</div>
  <div class="sh-right"><span class="sh-extra"></span>
    <button type="button" class="sh-lang" data-lang-toggle title="Ganti bahasa / Switch language">ID</button>
    <span class="sh-free" data-i18n="nav.free">TOOL GRATIS</span>
    <span data-auth-slot></span>
    <button type="button" class="sh-burger" aria-expanded="false" aria-controls="sh-drop" title="Menu" aria-label="Menu">☰</button>
    <a href="/converter.html?tool=merge-pdf" class="sh-cta" data-i18n="nav.cta">Gas convert →</a>
  </div>
</nav>`;
    const spot = slot.querySelector('.sh-extra');
    // Page buttons (share, new book) sit before the language button; on phones the header then gets compact.
    if (extras.some(n => n.nodeType === 1)) { spot.replaceWith(...extras); slot.querySelector('.sh-nav').classList.add('sh-extras'); } else spot.remove();
    // The page being looked at is marked in the links.
    for (const a of slot.querySelectorAll('.sh-links a')) {
      const path = new URL(a.href, location.href).pathname;
      if (path !== '/' && (path === location.pathname || (path === '/harga' && location.pathname === '/harga'))) { a.classList.add('sh-on'); a.setAttribute('aria-current', 'page'); }
    }
    // Narrower screens: the links in a menu under ☰.
    const burger = slot.querySelector('.sh-burger'), drop = document.createElement('div');
    drop.className = 'sh-drop'; drop.id = 'sh-drop'; drop.hidden = true;
    slot.querySelectorAll('.sh-links a').forEach(a => drop.append(a.cloneNode(true)));
    slot.append(drop);
    const show = on => { drop.hidden = !on; burger.setAttribute('aria-expanded', String(on)); };
    burger.onclick = () => show(drop.hidden);
    document.addEventListener('pointerdown', e => { if (!drop.hidden && !drop.contains(e.target) && e.target !== burger) show(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') show(false); });
    // The header sits at the top of the page, whatever wraps the placeholder.
    if (slot.parentElement !== document.body) document.body.prepend(slot);
    if (window.I18N && document.readyState !== 'loading') window.I18N.apply();
  }
  const run = () => document.querySelectorAll('[data-site-header]').forEach(build);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  run();
})();
