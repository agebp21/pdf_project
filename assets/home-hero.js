// Home hero preview (owner, 2026-10-23): Preview (or the sample cover) opens the sample book as a
// real flipbook in a window over the page — a book opened to two pages, turned by click, swipe,
// arrows or keys, with the paper sound. The flipbook engine loads on the first open only.
(function () {
  var book = document.getElementById('hh-book'), demo = document.getElementById('hh-demo');
  if (!book || !demo) return;
  document.body.appendChild(demo);              // out of the hero's stacking context: over everything on the page
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
    if (window.FlipbookLayout) { FlipbookLayout.bind(flip, demo.querySelector('.hh-demo-stage'), 450 / 625); FlipbookLayout.centerCover(flip, box, reduced); }
    if (window.FlipbookSound) { FlipbookSound.attach(flip); FlipbookSound.bindButton(document.getElementById('hh-demo-sound')); }
    if (window.FlipbookTurns) FlipbookTurns.adopt(flip);
    flip.on('flip', status); flip.on('changeOrientation', status);
    flip.on('changeState', function (e) { if (e.data === 'read') status(); });
    status();
  }
  function open() {
    opener = document.activeElement;
    demo.hidden = false; document.body.classList.add('hh-demo-open');
    document.getElementById('hh-demo-close').focus();
    engine().then(function () {
      if (!flip) build();
      setTimeout(function () { if (flip && flip.getCurrentPageIndex() === 0) flip.flipNext(); }, 450);   // it opens itself, like a reader would
    }).catch(function () { document.getElementById('hh-demo-status').textContent = EN() ? 'The preview could not load.' : 'Pratinjau gagal dimuat.'; });
  }
  function close() {
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
    demo.hidden = true; document.body.classList.remove('hh-demo-open');
    if (opener && opener.focus) opener.focus();
  }
  book.addEventListener('click', open);
  book.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  document.getElementById('hh-demo-close').addEventListener('click', close);
  document.getElementById('hh-demo-full').addEventListener('click', function () {
    try { if (document.fullscreenElement) document.exitFullscreen(); else if (demo.requestFullscreen) demo.requestFullscreen(); } catch (e) {}
  });
  demo.addEventListener('click', function (e) { if (e.target === demo) close(); });
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
