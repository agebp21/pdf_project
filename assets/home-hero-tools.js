// Reader tools for the HTML homepage sample. No PDF upload, AI call or account required.
(function () {
  window.HomeHeroTools = { bind: function (options) {
    var flip = options.flip, pages = options.pages, demo = options.demo;
    var stage = demo.querySelector('.hh-demo-stage'), target = demo.querySelector('.hh-demo-zoom');
    var toolbar = document.getElementById('hh-demo-toolbar');
    var $ = function (id) { return document.getElementById(id); };
    var en = function () { return window.I18N && I18N.get() === 'en'; };
    var words = {}, text = {}, noticeTimer;
    function visible() {
      var i = flip.getCurrentPageIndex();
      return flip.getOrientation() === 'landscape' && i > 0 && i < pages.length - 1 ? [i, i + 1] : [i];
    }
    function notice(message) {
      var out = $('hh-tool-notice'); out.textContent = message; out.hidden = false;
      clearTimeout(noticeTimer); noticeTimer = setTimeout(function () { out.hidden = true; }, 7000);
    }
    var zoom = FlipbookZoom.bind(stage, target, { button: $('hh-tool-zoom'), state: function () { return flip.getState(); }, content: function () { return $('hh-demo-book').getBoundingClientRect(); } });
    function go(index) { zoom.snap(); if (['read', 'fold_corner'].indexOf(flip.getState()) !== -1) flip.turnToPage(Math.max(0, Math.min(pages.length - 1, index))); }
    var marks = FlipbookBookmarks.bind({ key: 'mf-home-demo-marks-v1', pages: pages, visible: visible, goPage: go, toggle: $('hh-tool-mark'), open: $('hh-tool-marks') });
    var notes = FlipbookNotes.bind({ key: 'mf-home-demo-notes-v1', title: 'MyFlipbook Pro — Demo', pages: pages, goPage: go, open: $('hh-tool-notes'), bookmark: function (i, on) { return marks.set(i, on); } });
    var highlights = FlipbookHighlights.bind({ key: 'mf-home-demo-highlights-v1', pages: pages, words: words, text: text, button: $('hh-tool-pen'), onQuote: function (i, quote, color) { notes.quote(i, quote, color); }, onUnquote: function (i, quote) { notes.unquote(i, quote); } });
    function readText() {
      pages.forEach(function (page, i) {
        var walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT), list = [], node;
        while ((node = walker.nextNode())) {
          if (node.parentElement.closest('.book-note-stack, .book-highlights, .book-reading, .book-ribbon')) continue;
          if (node.textContent.trim()) list.push(node.textContent.trim());
        }
        text[String(i)] = [list.join(' ')];
      });
    }
    readText();
    var speech = FlipbookSpeech.bind({ text: text, pages: pages, visible: visible, button: $('hh-tool-audio'), busy: function () { return highlights.active(); }, onStart: function () { highlights.setMode(false); }, notice: notice,
      edition: function () { var blocks = {}; Object.keys(text).forEach(function (i) { blocks[i] = [[.06, .06, .88, .88, text[i].join(' ')]]; }); return {lang: en() ? 'en' : 'id', pages: blocks}; },
      next: function () { if ($('hh-demo-next').disabled) return false; zoom.snap(); flip.flipNext(); return true; }
    });
    var audio = $('hh-tool-audio');
    if (audio.hidden) { audio.hidden = false; audio.disabled = true; audio.title = en() ? 'Audio is unavailable in this browser' : 'Audio tidak tersedia di browser ini'; }
    else audio.onclick = function () { if (speech.active()) speech.stop(); else speech.start(); };
    function pause() { speech.stop(); highlights.setMode(false); marks.close(); notes.close(); zoom.snap(); }
    $('hh-tool-home').onclick = function () { pause(); go(0); };
    $('hh-tool-end').onclick = function () { pause(); go(pages.length - 1); };
    $('hh-tool-open').onclick = function () { pause(); if (!$('hh-demo-next').disabled) flip.flipNext(); };
    $('hh-tool-translate').onclick = function () { pause(); if (window.I18N) I18N.set(en() ? 'id' : 'en'); };
    // Fullscreen only paints descendants of its element; keep reader popovers inside it.
    function fullscreenPanels() {
      var selectors = '.book-marks, .book-note-card, .book-hl-bar';
      if (document.fullscreenElement === demo) {
        Array.from(document.body.children).forEach(function (node) { if (node.matches(selectors)) demo.appendChild(node); });
        Array.from(demo.children).forEach(function (node) { if (node.matches('.book-marks')) node.style.bottom = Math.max(16, innerHeight - toolbar.getBoundingClientRect().top + 8) + 'px'; });
      } else {
        Array.from(demo.children).forEach(function (node) { if (node.matches(selectors)) { if (node.matches('.book-marks')) node.style.bottom = ''; document.body.appendChild(node); } });
      }
    }
    var panelsObserver = new MutationObserver(fullscreenPanels); panelsObserver.observe(document.body, {childList: true});
    document.addEventListener('fullscreenchange', fullscreenPanels);
    function size() { toolbar.style.width = Math.min(stage.clientWidth, $('hh-demo-book').clientWidth || stage.clientWidth) + 'px'; fullscreenPanels(); }
    var observer = new ResizeObserver(size); observer.observe(stage); observer.observe($('hh-demo-book'));
    function refresh() {
      marks.refresh(); notes.refresh();
      if (audio.disabled) audio.hidden = false;
      $('hh-tool-home').disabled = flip.getCurrentPageIndex() === 0;
      $('hh-tool-end').disabled = flip.getCurrentPageIndex() >= pages.length - 1;
      $('hh-tool-open').disabled = $('hh-demo-next').disabled;
      $('hh-tool-open').textContent = flip.getCurrentPageIndex() === 0 ? (en() ? 'Open cover →' : 'Buka sampul →') : (en() ? 'Next →' : 'Berikutnya →');
      $('hh-tool-mark').textContent = $('hh-tool-mark').getAttribute('aria-pressed') === 'true' ? (en() ? '🔖 Marked' : '🔖 Ditandai') : (en() ? '🔖 Mark' : '🔖 Tandai');
      size();
    }
    $('hh-tool-mark').addEventListener('click', function () { setTimeout(refresh, 0); });
    document.addEventListener('langchange', function () { readText(); speech.refreshText(); speech.editionChanged(); refresh(); });
    flip.on('flip', function () { zoom.snap(); speech.pageChanged(); });
    flip.on('changeState', function (event) { if (event.data === 'read') speech.pageChanged(); });
    refresh();
    return { refresh: refresh, pause: pause };
  }};
})();
