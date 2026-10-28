// Home hero preview (owner, 2026-10-23, like Heyzine): Preview (or the sample cover) opens the sample
// book in place of the hero as a real flipbook — a book opened to two pages, turned by click, swipe,
// arrows or keys, with the paper sound. The flipbook engine loads on the first open only.
(function () {
  var book = document.getElementById('hh-book'), demo = document.getElementById('hh-demo');
  if (!book || !demo) return;
  var hero = demo.closest('.hh');
  var flip = null, loading = null, opener = null, settle = null, busy = false, tools = null;
  var originalPages = null, catalogPages = null, magazinePages = null, showingCatalog = false, showingMagazine = false;
  function applySample() {
    if (!flip || busy) return;
    var catalog = hero.dataset.sample === 'interior';
    var magazine = hero.dataset.sample === 'magazine';
    if (catalog === showingCatalog && magazine === showingMagazine) return;
    if (tools) tools.pause();
    if (catalog && !catalogPages) {
      catalogPages = [];
      for (var i=1; i<=12; i++) {
        var page = document.createElement('div'); page.className = 'hh-page hh-catalog-page'; page.dataset.density = 'soft';
        var image = document.createElement('img'); image.src = 'assets/samples/catalog-1/page-' + String(i).padStart(2,'0') + '.webp'; image.alt = 'Nivora Home · ' + i; image.decoding = 'async';
        page.appendChild(image); catalogPages.push(page);
      }
      catalogPages[catalogPages.length-1].dataset.density = 'hard';
    }
    if (magazine && !magazinePages) {
      magazinePages = [];
      for (var m=1; m<=12; m++) {
        var magazinePage = document.createElement('div'); magazinePage.className = 'hh-page hh-catalog-page'; magazinePage.dataset.density = 'soft';
        var magazineImage = document.createElement('img'); magazineImage.src = 'assets/samples/catalog-2/page-' + String(m).padStart(2,'0') + '.webp'; magazineImage.alt = 'RushBite Express · ' + m; magazineImage.decoding = 'async';
        magazinePage.appendChild(magazineImage); magazinePages.push(magazinePage);
      }
      magazinePages[magazinePages.length-1].dataset.density = 'hard';
    }
    showingCatalog = catalog; showingMagazine = magazine;
    flip.updateFromHtml(catalog ? catalogPages : magazine ? magazinePages : originalPages);
    flip.turnToPage(0); if (settle) settle(); status();
  }
  var EN = function () { return window.I18N && I18N.get && I18N.get() === 'en'; };
  function load(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-hh="' + src + '"]')) return resolve();
      var s = document.createElement('script'); s.src = src; s.dataset.hh = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function engine() {
    if (!loading) {
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'assets/export/book-effects.css'; document.head.appendChild(css);
      loading = load('assets/vendor/page-flip.browser.js?v=plain3').then(function () { return load('assets/export/layout.js?v=cover-close2'); }).then(function () { return load('assets/home-hero-tools.js?v=cover-close1'); });
    }
    return loading;
  }
  function status() {
    if (!flip) return;
    var i = flip.getCurrentPageIndex(), n = flip.getPageCount(), spread = flip.getOrientation() === 'landscape';
    var text = i === 0 ? (EN() ? 'Cover' : 'Sampul') + ' · 1 / ' + n : i >= n - 1 ? (EN() ? 'Back cover' : 'Sampul belakang') + ' · ' + n + ' / ' + n
      : (spread && i + 1 < n - 1 ? (i + 1) + '–' + (i + 2) : String(i + 1)) + ' / ' + n;
    document.getElementById('hh-demo-status').textContent = text;
    document.getElementById('hh-demo-prev').disabled = i === 0;
    document.getElementById('hh-demo-next').disabled = i >= n - 1;
    if (showingCatalog) {
      document.getElementById('hh-tool-home').disabled = i === 0;
      document.getElementById('hh-tool-end').disabled = i >= n - 1;
      document.getElementById('hh-tool-open').disabled = document.getElementById('hh-demo-next').disabled;
      document.getElementById('hh-tool-open').textContent = i === 0 ? (EN() ? 'Open cover →' : 'Buka sampul →') : (EN() ? 'Next →' : 'Berikutnya →');
    }
    if (tools && !showingCatalog && !showingMagazine) tools.refresh();
  }
  function build() {
    var box = document.getElementById('hh-demo-book'), pages = [].slice.call(box.querySelectorAll('.hh-page'));
    originalPages = pages;
    pages.forEach(function (page) { page.style.display = ''; });
    var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var motion = window.FlipbookLayout ? FlipbookLayout.motion(reduced) : {};
    // Slightly quicker for the homepage sample; leave reader/export defaults alone.
    motion.flippingTime = reduced ? 1 : 320;
    flip = new St.PageFlip(box, Object.assign({ width: 450, height: 625, size: 'stretch', minWidth: 160, maxWidth: 700, minHeight: 222, maxHeight: 972,
      autoSize: true, usePortrait: true, showCover: true, startPage: 0 }, motion));
    flip.loadFromHTML(pages);
    // Sized to the window like every reader: a spread that fits, one page on a phone held upright.
    if (window.FlipbookLayout) {
      FlipbookLayout.bind(flip, demo.querySelector('.hh-demo-stage'), 450 / 625);
      // The closed cover starts in the middle at once; only opening it glides.
      box.classList.add('book-shift-instant');
      settle = FlipbookLayout.centerCover(flip, box, reduced);
      setTimeout(function () { if (!reduced) box.classList.remove('book-shift-instant'); }, 300);
    }
    if (window.FlipbookSound) { FlipbookSound.attach(flip); FlipbookSound.bindButton(document.getElementById('hh-demo-sound')); }
    if (window.FlipbookTurns) FlipbookTurns.adopt(flip);
    tools = HomeHeroTools.bind({ flip: flip, pages: pages, demo: demo });
    flip.on('flip', status); flip.on('changeOrientation', status);
    flip.on('changeState', function (e) { if (e.data === 'read') status(); });
    status();
  }
  // One move, nothing fades (owner, 2026-10-23): the columns slide to make room while the sample
  // cover itself slides and grows to where the preview book's cover will be; there the real book
  // (whose cover looks the same: both are drawn in units of their own height) takes over unseen
  // and opens. Closing plays it back from the cover.
  var STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MOVE = STILL ? 0 : 500;
  var frame = function (fn) { requestAnimationFrame(function () { requestAnimationFrame(fn); }); };
  var plain = function () { var was = book.style.transform; book.style.transform = 'none'; var r = book.getBoundingClientRect(); book.style.transform = was; return r; };
  // The transform that puts the sample cover (laid out at `from`) over `to`.
  var onto = function (from, to) {
    return 'translate(' + (to.left + to.width / 2 - from.left - from.width / 2).toFixed(1) + 'px,' + (to.top + to.height / 2 - from.top - from.height / 2).toFixed(1) + 'px) scale(' + (to.height / from.height).toFixed(4) + ')';
  };
  // Put the cover somewhere at once (no transition), for the start of a move.
  var place = function (transform) { book.style.transition = 'none'; book.style.transform = transform; void book.offsetWidth; book.style.transition = ''; };
  var coverOf = function () { var c = document.querySelector('#hh-demo-book .hh-page-cover, #hh-demo-book .hh-catalog-page'); return c && c.getBoundingClientRect(); };
  // Where the preview cover will sit, before the book exists: the middle of the book column, as
  // tall as the stage allows (one page wide on narrow screens, two otherwise).
  function predicted() {
    var stage = demo.querySelector('.hh-demo-stage').getBoundingClientRect();
    var ratio = 450 / 625, spread = stage.width >= 700 || stage.width > stage.height;
    var h = Math.min(stage.height, stage.width / (spread ? 2 * ratio : ratio));
    return {left: stage.left + stage.width / 2 - h * ratio / 2, top: stage.top + stage.height / 2 - h / 2, width: h * ratio, height: h};
  }
  function open() {
    if (busy || !demo.hidden) return;
    busy = true; opener = document.activeElement;
    book.classList.add('is-loading');
    engine().then(function () {
      book.classList.remove('is-loading');
      var start = plain();
      // The final layout, measured at once (no transitions), then back to the start to slide there.
      hero.style.transition = 'none';
      demo.classList.add('is-waiting'); demo.hidden = false;
      hero.classList.add('is-preview', 'is-moving');
      var end = plain(), target = (flip && coverOf()) || predicted();
      hero.classList.remove('is-preview');
      void hero.offsetWidth;
      hero.style.transition = '';
      place('none');
      book.classList.add('is-moving');
      void book.offsetWidth;
      // The layout slides the cover from `start` to `end`; the transform adds the rest of the way.
      hero.classList.add('is-preview');
      book.style.transform = 'translate(' + (target.left + target.width / 2 - end.left - end.width / 2).toFixed(1) + 'px,' +
        (target.top + target.height / 2 - end.top - end.height / 2).toFixed(1) + 'px) scale(' + (target.height / end.height).toFixed(4) + ')';
      demo.scrollIntoView({block: 'center', behavior: STILL ? 'auto' : 'smooth'});
      setTimeout(function () {
        if (!flip) build();
        frame(function () {
          var cover = coverOf();
          book.classList.remove('is-moving');
          if (cover) place(onto(plain(), cover));                 // the last pixel, unseen
          hero.classList.add('is-shown'); demo.classList.remove('is-waiting');
          place('');
          hero.classList.remove('is-moving');
          document.getElementById('hh-demo-close').focus({preventScroll: true});
          busy = false;
          applySample();
          setTimeout(function () { if (flip && flip.getCurrentPageIndex() === 0) flip.flipNext(); }, STILL ? 0 : 160);   // it opens itself, like a reader would
        });
      }, MOVE);
    }).catch(function () {
      busy = false;
      book.classList.remove('is-loading');
      var hint = book.querySelector('.hh-preview span'); if (hint) hint.textContent = EN() ? 'Try again' : 'Coba lagi';
    });
  }
  function close() {
    if (busy || demo.hidden) return;
    if (tools) tools.pause();
    busy = true;
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
    var box = document.getElementById('hh-demo-book');
    // First the book closes the way a reader closes it (turned back to the cover, which glides to
    // the middle), then the sample cover takes over from there and slides home.
    var closed = function (then) {
      if (!flip || flip.getCurrentPageIndex() === 0 || STILL) { if (flip && flip.getCurrentPageIndex() !== 0) { flip.turnToPage(0); if (settle) settle(); } frame(then); return; }
      var turn = (flip.getSettings().flippingTime || 320) + 60;
      flip.flip(0);
      // The turn, then the cover's glide to the middle (0.45 s), then the slide home.
      setTimeout(function () { if (flip.getCurrentPageIndex() !== 0) { flip.turnToPage(0); if (settle) settle(); } setTimeout(function () { frame(then); }, 480); }, turn);
    };
    closed(function () {
      var cover = coverOf(), here = plain();
      place(cover ? onto(here, cover) : '');
      hero.classList.add('is-moving'); hero.classList.remove('is-shown'); demo.classList.add('is-waiting');
      book.classList.add('is-moving');
      void book.offsetWidth;
      hero.classList.remove('is-preview');                    // the columns slide back, the cover rides home
      book.style.transform = '';
      setTimeout(function () {
        demo.hidden = true; demo.classList.remove('is-waiting');
        book.classList.remove('is-moving'); hero.classList.remove('is-moving');
        if (!STILL) box.classList.remove('book-shift-instant');
        if (opener && opener.focus) opener.focus({preventScroll: true});
        busy = false;
      }, MOVE);
    });
  }

  book.addEventListener('click', open);
  document.addEventListener('hh-sample-selected', function () {
    if (busy) return;
    if (flip) { if (tools) tools.pause(); flip.turnToPage(0); status(); }
    if (demo.hidden) open();
    else applySample();
  });
  document.getElementById('hh-demo-toolbar').addEventListener('click', function (event) {
    if (!showingCatalog || !flip) return;
    var target = event.target.closest('button'); if (!target) return;
    if (target.id === 'hh-tool-home' || target.id === 'hh-tool-end' || target.id === 'hh-tool-open') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (target.id === 'hh-tool-home') flip.turnToPage(0);
      else if (target.id === 'hh-tool-end') flip.turnToPage(flip.getPageCount()-1);
      else flip.flipNext();
      status();
    }
  }, true);
  book.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  document.getElementById('hh-demo-close').addEventListener('click', close);
  document.getElementById('hh-demo-full').addEventListener('click', function () {
    try { if (document.fullscreenElement) document.exitFullscreen(); else if (demo.requestFullscreen) demo.requestFullscreen(); } catch (e) {}
  });
  document.getElementById('hh-demo-prev').addEventListener('click', function () { if (tools) tools.pause(); if (flip) flip.flipPrev(); });
  document.getElementById('hh-demo-next').addEventListener('click', function () { if (tools) tools.pause(); if (flip) flip.flipNext(); });
  document.addEventListener('keydown', function (e) {
    if (demo.hidden) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' && flip) flip.flipNext();
    else if (e.key === 'ArrowLeft' && flip) flip.flipPrev();
  });
  document.addEventListener('langchange', status);
})();
