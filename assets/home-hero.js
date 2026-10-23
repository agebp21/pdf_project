// Home hero preview (owner, 2026-10-23, like Heyzine): Preview (or the sample cover) opens the sample
// book in place of the hero as a real flipbook — a book opened to two pages, turned by click, swipe,
// arrows or keys, with the paper sound. The flipbook engine loads on the first open only.
(function () {
  var book = document.getElementById('hh-book'), demo = document.getElementById('hh-demo');
  if (!book || !demo) return;
  var hero = demo.closest('.hh');
  var flip = null, loading = null, opener = null;
  var EN = function () { return window.I18N && I18N.get && I18N.get() === 'en'; };
  function load(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-hh="' + src + '"]')) return resolve();
      var s = document.createElement('script'); s.src = src; s.dataset.hh = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function engine() {
    if (!loading) loading = load('assets/vendor/page-flip.browser.js?v=plain3').then(function () { return load('assets/export/layout.js?v=fs'); });
    return loading;
  }
  function status() {
    if (!flip) return;
    var i = flip.getCurrentPageIndex(), n = flip.getPageCount(), spread = flip.getOrientation() === 'landscape';
    var text = i === 0 ? (EN() ? 'Cover' : 'Sampul') : i >= n - 1 ? (EN() ? 'Back cover' : 'Sampul belakang')
      : (spread && i + 1 < n - 1 ? (i + 1) + '–' + (i + 2) : String(i + 1)) + ' / ' + (n - 2);
    document.getElementById('hh-demo-status').textContent = text;
    document.getElementById('hh-demo-prev').disabled = i === 0;
    document.getElementById('hh-demo-next').disabled = i >= n - (spread ? 2 : 1);
  }
  function build() {
    var box = document.getElementById('hh-demo-book'), pages = [].slice.call(box.querySelectorAll('.hh-page'));
    pages.forEach(function (page) { page.style.display = ''; });
    var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var motion = window.FlipbookLayout ? FlipbookLayout.motion(reduced) : {};
    flip = new St.PageFlip(box, Object.assign({ width: 450, height: 625, size: 'stretch', minWidth: 160, maxWidth: 700, minHeight: 222, maxHeight: 972,
      autoSize: true, usePortrait: true, showCover: true, startPage: 0 }, motion));
    flip.loadFromHTML(pages);
    // Sized to the window like every reader: a spread that fits, one page on a phone held upright.
    if (window.FlipbookLayout) {
      FlipbookLayout.bind(flip, demo.querySelector('.hh-demo-stage'), 450 / 625);
      // The closed cover starts in the middle at once; only opening it glides.
      box.classList.add('book-shift-instant');
      FlipbookLayout.centerCover(flip, box, reduced);
      setTimeout(function () { if (!reduced) box.classList.remove('book-shift-instant'); }, 300);
    }
    if (window.FlipbookSound) { FlipbookSound.attach(flip); FlipbookSound.bindButton(document.getElementById('hh-demo-sound')); }
    if (window.FlipbookTurns) FlipbookTurns.adopt(flip);
    flip.on('flip', status); flip.on('changeOrientation', status);
    flip.on('changeState', function (e) { if (e.data === 'read') status(); });
    status();
  }
  // One smooth move, never a jump: the sample cover fades, the columns slide to make room
  // (CSS transition on the grid), then the open book fades in and opens itself. Close plays it back.
  var STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FADE = STILL ? 0 : 200, SLIDE = STILL ? 0 : 460;
  function open() {
    if (!demo.hidden || book.classList.contains('is-loading')) return;
    opener = document.activeElement;
    book.classList.add('is-loading');
    // The sample cover stays until the preview book is ready.
    engine().then(function () {
      book.classList.remove('is-loading');
      hero.classList.add('is-leaving');
      setTimeout(function () {
        demo.classList.add('is-soft'); demo.hidden = false;
        hero.classList.add('is-preview'); hero.classList.remove('is-leaving');
        demo.scrollIntoView({block: 'center', behavior: STILL ? 'auto' : 'smooth'});
        setTimeout(function () {
          if (!flip) build();
          requestAnimationFrame(function () { demo.classList.remove('is-soft'); });
          document.getElementById('hh-demo-close').focus({preventScroll: true});
          setTimeout(function () { if (flip && flip.getCurrentPageIndex() === 0) flip.flipNext(); }, STILL ? 0 : 550);   // it opens itself, like a reader would
        }, SLIDE);
      }, FADE);
    }).catch(function () {
      book.classList.remove('is-loading');
      var hint = book.querySelector('.hh-preview span'); if (hint) hint.textContent = EN() ? 'Try again' : 'Coba lagi';
    });
  }


  function close() {
    if (demo.hidden) return;
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
    demo.classList.add('is-soft');
    setTimeout(function () {
      demo.hidden = true;
      hero.classList.add('is-leaving'); hero.classList.remove('is-preview');   // columns slide back, the cover waits
      setTimeout(function () { hero.classList.remove('is-leaving'); }, SLIDE);
      if (opener && opener.focus) opener.focus({preventScroll: true});
    }, FADE + 100);
  }

  book.addEventListener('click', open);
  book.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  document.getElementById('hh-demo-close').addEventListener('click', close);
  document.getElementById('hh-demo-full').addEventListener('click', function () {
    try { if (document.fullscreenElement) document.exitFullscreen(); else if (demo.requestFullscreen) demo.requestFullscreen(); } catch (e) {}
  });
  document.getElementById('hh-demo-prev').addEventListener('click', function () { if (flip) flip.flipPrev(); });
  document.getElementById('hh-demo-next').addEventListener('click', function () { if (flip) flip.flipNext(); });
  document.addEventListener('keydown', function (e) {
    if (demo.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' && flip) flip.flipNext();
    else if (e.key === 'ArrowLeft' && flip) flip.flipPrev();
  });
  document.addEventListener('langchange', status);
})();
