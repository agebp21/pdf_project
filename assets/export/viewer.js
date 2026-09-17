'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const data = window.FLIPBOOK_DATA;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let book, frame = 0;
  let elements = []; // page article elements — populated in try block


  /* ── Animation type list (must be before try block) ── */
  const ANIM_TYPES = ['fadeIn','slideUp','slideDown','slideLeft','slideRight','zoomIn','bounce','pulse'];

  /* ── Element rendering helpers ───────────────────────── */
  function renderPageElements(index, pageArticle) {
    const pageData = data.pages?.[String(index)];
    if (!pageData?.elements?.length) return;

    const container = document.createElement('div');
    container.className = 'page-elements interactive';

    pageData.elements.forEach(el => {
      const div = document.createElement('div');
      div.className = `fb-el fb-${el.type}`;
      // Store animation config as data attrs for later triggering
      div.dataset.anim  = el.animation?.type  || 'none';
      div.dataset.delay = el.animation?.delay  ?? 0;
      div.dataset.dur   = el.animation?.duration ?? 600;

      // Position & size (percent)
      div.style.left   = el.x + '%';
      div.style.top    = el.y + '%';
      div.style.width  = el.w + '%';
      div.style.height = el.h + '%';
      if (el.rotation) div.style.transform = `rotate(${el.rotation}deg)`;

      // Style
      const s = el.style || {};
      if (s.fontSize) div.style.fontSize = (s.fontSize * 0.0175) + 'em';
      if (s.color)    div.style.color     = s.color;
      div.style.fontWeight = s.bold   ? '700' : '400';
      div.style.fontStyle  = s.italic ? 'italic' : '';
      div.style.textAlign  = s.align  || 'left';
      if (s.bgColor) div.style.background = s.bgColor;
      div.style.opacity   = s.opacity != null ? s.opacity : 1;
      div.style.padding   = '3px 6px';
      div.style.boxSizing = 'border-box';
      div.style.lineHeight = '1.35';
      div.style.wordBreak = 'break-word';
      if (el.type === 'hotspot') {
        div.style.borderRadius = '6px';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'center';
        div.style.whiteSpace = 'nowrap';
        div.style.overflow = 'hidden';
        div.style.textOverflow = 'ellipsis';
      }

      // Content (safe — textContent only)
      if (el.content) div.textContent = el.content;

      // Link / click handler
      if (el.link) {
        div.classList.add('fb-link');
        div.style.cursor = 'pointer';
        div.addEventListener('click', e => {
          e.stopPropagation();
          if (el.link.type === 'url' && el.link.target) {
            window.open(el.link.target, '_blank', 'noopener,noreferrer');
          } else if (el.link.type === 'page' && book) {
            const target = Number(el.link.target) - 1; // 1-based → 0-based
            if (target >= 0 && target < data.pageCount) {
              book.turnToPage(target);
              update();
              playElementAnimations(visible());
            }
          }
        });
      }

      container.append(div);
    });
    pageArticle.append(container);
  }

  /* ── Trigger element animations on the given pages ───── */
  function playElementAnimations(pageIndices) {
    pageIndices.forEach(index => {
      const pageEl = elements[index];
      if (!pageEl) return;
      pageEl.querySelectorAll('.fb-el').forEach(el => {
        // Remove previous animation class to re-trigger
        el.style.animation = 'none';
        el.classList.remove('fb-animated');
        ANIM_TYPES.forEach(t => el.classList.remove('fb-anim-' + t));
        const animType = el.dataset.anim;
        const delay    = Number(el.dataset.delay || 0);
        const dur      = Number(el.dataset.dur || 600);
        if (animType && animType !== 'none') {
          setTimeout(() => {
            el.style.animation = '';
            el.style.setProperty('--fb-dur', dur + 'ms');
            el.classList.add('fb-animated', 'fb-anim-' + animType);
          }, reduced ? 0 : delay);
        } else {
          setTimeout(() => {
            el.style.animation = '';
            el.classList.add('fb-animated');
          }, 0);
        }
      });
    });
  }


  try {
    if (!data || !Number.isInteger(data.pageCount) || data.pageCount < 1) throw Error('Invalid book data.');
    document.title = data.title;
    $('#title').textContent = data.title;

    elements = Array.from({ length: data.pageCount }, (_, index) => {
      const page  = document.createElement('article'); page.className = 'page';
      const image = document.createElement('img');
      image.src = `pages/${index + 1}.jpg`;
      image.alt = `Page ${index + 1}`;
      image.decoding = 'async';
      image.loading  = index > 2 ? 'lazy' : 'eager';
      image.onerror  = () => { $('#error').hidden = false; $('#error').textContent = 'Page image missing. Extract the whole ZIP into one folder.'; };
      page.append(image);

      // Legacy v1 stat overlay
      const config = data.overlays?.[String(index)];
      if (config) {
        const overlay = document.createElement('div'); overlay.className = 'stat-overlay ' + config.position;
        const number  = document.createElement('strong'); number.textContent = config.value.toLocaleString('id-ID');
        const label   = document.createElement('span');   label.textContent  = config.label;
        overlay.append(number, label); page.append(overlay);
      }

      // v2 per-page elements (text, hotspot, link)
      renderPageElements(index, page);

      return page;
    });

    $('#book').append(...elements);

    function visible() {
      const first = book.getCurrentPageIndex();
      return [first, ...(first > 0 && book.getOrientation() === 'landscape' && first + 1 < data.pageCount ? [first + 1] : [])];
    }

    function update() {
      const pages = visible(), cover = pages[0] === 0;
      $('#status').textContent = cover ? `Cover · 1 / ${data.pageCount}` : `${pages.map(i => i + 1).join('–')} / ${data.pageCount}`;
      $('#prev').disabled = $('#home').disabled = cover;
      $('#next').disabled = pages[pages.length - 1] === data.pageCount - 1;
      $('#next').textContent = cover ? 'Open cover →' : '→';
      $('#next').setAttribute('aria-label', cover ? 'Open cover' : 'Next page');
      elements.forEach((page, index) => { page.setAttribute('aria-hidden', String(!pages.includes(index))); });
      const hasOverlay = pages.some(index => data.overlays?.[String(index)]);
      $('#replay').disabled = !hasOverlay && !pages.some(index => data.pages?.[String(index)]?.elements?.length);
    }

    /* ── Legacy stat overlay animation ──────────────────── */
    function animate(automatic = true) {
      cancelAnimationFrame(frame);
      const pages = visible(), start = performance.now();
      const hasOverlays = pages.some(index => data.overlays?.[String(index)]);

      if (hasOverlays) {
        function draw(now) {
          const progress = automatic && reduced ? 1 : Math.min(1, (now - start) / 1800);
          const eased = 1 - Math.pow(1 - progress, 3);
          pages.forEach(index => {
            const config = data.overlays?.[String(index)];
            const node = elements[index].querySelector('.stat-overlay');
            if (!config || !node) return;
            node.querySelector('strong').textContent = Math.round(config.value * eased).toLocaleString('id-ID');
            node.style.opacity   = String(0.2 + 0.8 * eased);
            node.style.transform = `translateY(${16 * (1 - eased)}px)`;
          });
          if (progress < 1) frame = requestAnimationFrame(draw);
        }
        draw(start);
      }

      // v2 element animations
      playElementAnimations(pages);
    }

    FlipbookLayout.decorate(elements);
    book = new St.PageFlip($('#book'), {
      width: 380, height: Math.round(380 / data.ratio), size: 'stretch',
      minWidth: 220, maxWidth: 750, minHeight: 50, maxHeight: 1500,
      autoSize: true, usePortrait: true, showCover: true, startPage: 0,
      ...FlipbookLayout.motion(reduced)
    });
    book.on('flip', () => { update(); animate(); });
    book.on('changeOrientation', () => { update(); animate(); });
    book.on('changeState', event => {
      if (event.data === 'read') { update(); animate(); }
      else { cancelAnimationFrame(frame); $('#home').disabled = $('#prev').disabled = $('#next').disabled = true; }
    });
    book.loadFromHTML(elements); update(); animate();
    FlipbookLayout.bind(book, $('#stage'), data.ratio);

    $('#fullscreen').onclick = async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      } catch (cause) { $('#error').hidden = false; $('#error').textContent = 'Fullscreen not available on this device.'; }
    };
    if (!document.documentElement.requestFullscreen) $('#fullscreen').hidden = true;
    document.addEventListener('fullscreenchange', () => { $('#fullscreen').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'; });

    FlipbookIdle.bind({
      active: () => book.getState() === 'read' && book.getCurrentPageIndex() > 0,
      home:   () => { book.turnToPage(0); update(); animate(); }
    });

    $('#home').onclick = () => { if (book.getState() !== 'read') return; book.turnToPage(0); update(); animate(); };
    $('#prev').onclick = () => book.flipPrev();
    $('#next').onclick = () => book.flipNext();
    $('#replay').onclick = () => animate(false);

    document.addEventListener('keydown', event => {
      if (event.key === 'ArrowRight' && !$('#next').disabled) book.flipNext();
      if (event.key === 'ArrowLeft'  && !$('#prev').disabled) book.flipPrev();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(frame); });

  } catch (cause) { $('#error').hidden = false; $('#error').textContent = 'Book failed to open. ' + cause.message; }
})();
