'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  // English or Indonesian, with the site language (assets/i18n.js).
  const L = (en, id) => window.I18N ? I18N.pick(en, id) : en;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let book = null, pdf = null, pageElements = [], imageUrls = [], frame = 0, loadVersion = 0;
  // Pages are drawn a few at a time: the book opens once the first ones are
  // ready and the rest follow in the background (pagesReady resolves then).
  const FIRST_PAGES = 6;
  let pagesReady = Promise.resolve(), blankPage = '';
  const isBlank = url => !url || url === blankPage;
  let opening = false;
  const overlays = new Map();
  let disposeLayout = null;
  // Opening a PDF: a red bar fills the status box
  // (pages 0–60 %, links 60–75 %, text 75–100 %). loading(null) ends it.
  function loading(text, part) {
    const box = $('#load-status'), on = text != null;
    if (on) box.textContent = text + ' ' + Math.round(Math.min(1, part) * 100) + '%';
    box.style.setProperty('--load-progress', on ? (Math.min(1, part) * 100).toFixed(1) + '%' : '0%');
    box.classList.toggle('is-loading', on);
  }
  // The whole page goes full screen and the preview fills it (class), so the
  // tools that open on the page body (highlighter bar, notes, search, dialogs)
  // stay visible; full-screening the preview alone hid them.
  $('#fullscreen').onclick=async()=>{
    const preview=$('.preview'), root=document.documentElement;
    if(preview.classList.contains('reading-fullscreen')){
      preview.classList.remove('reading-fullscreen');
      try { if(document.fullscreenElement)await document.exitFullscreen(); } catch(cause){}
    } else {
      preview.classList.add('reading-fullscreen');
      try { if(root.requestFullscreen)await root.requestFullscreen(); } catch(cause){}   // no API: the class alone fills the window
    }
    paintFullscreen();
  };
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.fullscreenElement){$('.preview').classList.remove('reading-fullscreen');paintFullscreen();}});
  // ⛶ in the book toolbar: the preview fills the screen (Esc or the button leaves).
  const paintFullscreen=()=>{const on=$('.preview').classList.contains('reading-fullscreen');
    $('#fullscreen').textContent=on?L('✕ Exit full screen','✕ Keluar layar penuh'):L('⛶ Full screen','⛶ Layar penuh');
    $('#fullscreen').setAttribute('aria-pressed',String(on));$('#fullscreen').title=$('#fullscreen').textContent.slice(2);};
  // Esc / the browser leaving full screen: the preview goes back too.
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)$('.preview').classList.remove('reading-fullscreen');paintFullscreen();});paintFullscreen();
  let sourcePdf = null, bookRatio = 1, exporting = false, buildConfig = null, bookLinks = {}, bookWords = {}, bookText = {}, bookPodcast = null, podcastView = null, bookTranslations = {}, translateView = null, bookLang = null, bookVersions = {}, bookVersionText = {}, bookVersionWords = {}, editions = null, bookChecked = {}, bookComplete = new Set(), stopTranslating = false, liveLang = null, bookSummary = null, summaryView = null, marks = null, notes = null, highlights = null, speech = null, curl = null, zoom = null;
  // Zoom (🔍, double-tap, pinch, Ctrl+wheel) scales this wrapper, so it never
  // fights the book's own transforms (cover centring, curl); bound once.
  const zoomBox = document.createElement('div'); zoomBox.id = 'pdf-zoom';
  // A title handed over with ?link= (e.g. from journal search) names the book.
  let pendingTitle = '';
  // My Library: the archived copy of the open book (members only).
  let libraryId = null, openingLibraryId = null, archiveUser;
  function exportState() {
    $('#export-fields').disabled = !sourcePdf || opening || exporting;
    $('#export-apk').disabled = !buildConfig?.apk;
    $('#export-exe').disabled = !buildConfig?.exe;
    $('#project-file').disabled = opening || exporting;
  }
  const model = () => ({version:1,title:$('#export-title').value.trim()||L('Interactive book','Buku interaktif'),pageCount:pageElements.length,ratio:bookRatio,overlays:Object.fromEntries(overlays),links:bookLinks,words:bookWords,text:bookText,...(bookPodcast?{podcast:bookPodcast}:{}),...(Object.keys(bookTranslations).length?{translations:bookTranslations}:{}),...(bookSummary?{summary:bookSummary}:{}),...(bookLang?{lang:bookLang}:{}),...(Object.keys(bookVersions).length?{versions:Object.fromEntries(Object.entries(bookVersions).map(([lang,pages])=>[lang,Object.keys(pages).map(Number).sort((a,b)=>a-b)]))}:{}),...(Object.keys(bookVersionText).length?{versionText:bookVersionText}:{}),...(Object.keys(bookVersionWords).length?{versionWords:bookVersionWords}:{})});
  const error = message => { $('#reader-error').textContent = message; $('#reader-error').hidden = !message; };
  // Sheets on screen (may include the blank back cover of an odd page count).
  function sheetsOnScreen() {
    if (!book) return [];
    const first = book.getCurrentPageIndex();
    const isCover = first === 0;
    return [first, ...(!isCover && book.getOrientation() === 'landscape' && first + 1 < book.getPageCount() ? [first + 1] : [])];
  }
  // Document pages on screen.
  const visiblePages = () => sheetsOnScreen().filter(index => index < pageElements.length);
  function updatePage() {
    const shown = sheetsOnScreen(), visible = visiblePages();
    if (!shown.length) return;
    const isCover = shown[0] === 0;
    $('#page-status').textContent = isCover ? `Front cover · 1 / ${pageElements.length}` : !visible.length ? 'Back cover' : `Pages ${visible.map(i => i + 1).join('–')} / ${pageElements.length}`;
    $('#next').textContent = isCover ? 'Open cover →' : '→';
    $('#next').setAttribute('aria-label', isCover ? 'Open cover' : 'Next page');
    $('#prev').disabled = $('#home').disabled = isCover;
    $('#next').disabled = shown.at(-1) === book.getPageCount() - 1;
  }
  function stopAnimation() { cancelAnimationFrame(frame); frame = 0; }
  function animate(automatic = false) {
    stopAnimation();
    const visible = visiblePages();
    const start = performance.now();
    function draw(now) {
      const progress = automatic && reduced ? 1 : Math.min(1, (now - start) / 1800);
      const eased = 1 - Math.pow(1 - progress, 3);
      visible.forEach(index => {
        const config = overlays.get(index);
        const element = pageElements[index].querySelector('.stat-overlay');
        if (!config || !element) return;
        element.querySelector('strong').textContent = Math.round(config.value * eased).toLocaleString('id-ID');
        element.style.opacity = String(0.2 + 0.8 * eased);
        element.style.transform = `translateY(${16 * (1 - eased)}px)`;
      });
      if (progress < 1) frame = requestAnimationFrame(draw);
    }
    draw(start);
  }
  function renderOverlay(index, config) {
    pageElements[index].querySelector('.stat-overlay')?.remove();
    const element = document.createElement('div');
    element.className = 'stat-overlay ' + config.position;
    const number = document.createElement('strong');
    number.textContent = config.value.toLocaleString('id-ID');
    const label = document.createElement('span'); label.textContent = config.label;
    element.append(number, label); pageElements[index].append(element);
  }
  // Bringing a document into the reader needs an account: guests may look
  // around the empty reader, but the book itself unlocks after signing in.
  // (Shared /s/ links use the standalone reader and are unaffected.)
  function openPdf(blob, name, project = null, pictures = {}) {
    if (!window.MFAuth) return openPdfNow(blob, name, project, pictures);
    return window.MFAuth.me().then(data => {
      if (data.user || data.offline) return openPdfNow(blob, name, project, pictures);
      window.MFAuth.loginPopup(() => openPdfNow(blob, name, project, pictures));
      return false;
    });
  }
  async function openPdfNow(blob, name, project = null, pictures = {}) {
    if (opening || exporting) return false;
    opening = true; $('#pdf-file').disabled = true; $('#add-file').disabled = true; $('#overlay-fields').disabled = true;
    $('#home').disabled = $('#prev').disabled = $('#next').disabled = $('#replay').disabled = true;
    stopAnimation(); error('');
    exportState();
    const version = ++loadVersion;
    let newPdf = null, task = null;
    const newUrls = [];
    let installed = false;
    try {
      loading('Reading PDF…', 0);
      if (!window.pdfjsLib || !window.St) throw new Error('Libraries unavailable. Reload the page.');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
      task = pdfjsLib.getDocument({data: await blob.arrayBuffer(), isEvalSupported:false});
      newPdf = await task.promise;
      if (project && project.pageCount !== newPdf.numPages) throw Error('Project page count differs from the saved PDF.');
      const firstPage = await newPdf.getPage(1);
      const natural = firstPage.getViewport({scale:1});
      const newElements = [], total = newPdf.numPages, first = Math.min(total, FIRST_PAGES);
      // A white page of the book's shape stands in until a page is drawn.
      const blank = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(natural.width)}" height="${Math.round(natural.height)}"><rect width="100%" height="100%" fill="#fff"/></svg>`);
      for (let i = 1; i <= total; i++) {
        let url = blank;
        if (i <= first) {
          loading(`Preparing page ${i} / ${total}…`, (i - 1) / first * 0.6);
          url = await renderPageImage(i === 1 ? firstPage : await newPdf.getPage(i));
        }
        newUrls.push(url);
        const element = document.createElement('article'); element.className = 'pdf-page';
        const image = document.createElement('img'); image.src = url; image.alt = `Page ${i}`;
        element.append(image); newElements.push(element);
      }
      // A project (My Library, .smflipbook) already carries its links and text:
      // no need to read the whole PDF again.
      const saved = project && project.words && typeof project.words === 'object' && project.text && typeof project.text === 'object';
      // Table of contents / cross-reference links (never blocks opening the book).
      let found = {links:{}, stats:{internal:0, external:0, toc:0}};
      if (saved) found = {links: project.links || {}, stats: {internal: Object.values(project.links || {}).reduce((n, list) => n + (list || []).length, 0), external: 0, toc: 0}};
      else try {
        if (window.PdfLinks) found = await PdfLinks.extract(newPdf, {progress:(i, n) => loading(`Finding links ${i} / ${n}…`, 0.6 + i / n * 0.15)});
      } catch (cause) { console.warn('Links skipped:', cause); }
      // Word positions so readers can highlight text (never blocks opening either).
      let words = {}, text = {};
      if (saved) { words = JSON.parse(JSON.stringify(project.words)); text = JSON.parse(JSON.stringify(project.text)); }
      else try {
        if (window.PdfWords) ({words, text} = await PdfWords.extract(newPdf, {withText:true, progress:(i, n) => loading(`Reading text ${i} / ${n}…`, 0.75 + i / n * 0.25)}));
      } catch (cause) { console.warn('Words skipped:', cause); }
      if (version !== loadVersion) return false;
      // Text read from pictures earlier (OCR) comes back with the project.
      Object.keys((project && project.words) || {}).forEach(page => {
        if (window.PdfOcrWords && PdfOcrWords.needs(words, page) && Array.isArray(project.words[page]) && project.text && Array.isArray(project.text[page])) {
          words[page] = project.words[page]; text[page] = project.text[page];
        }
      });
      if (book) { disposeLayout?.(); book.destroy(); book = null; }
      if (pdf) await pdf.destroy();
      imageUrls.forEach(url => { if (!isBlank(url)) URL.revokeObjectURL(url); });
      imageUrls = newUrls; blankPage = blank; pdf = newPdf; pageElements = newElements; overlays.clear(); installed = true; bookLinks = found.links; bookWords = words; bookText = text; bookPodcast = (project && project.podcast) || null; bookTranslations = (project && project.translations) || {}; bookSummary = (project && project.summary) || null;
      // Translated editions ("ID | EN"): the book's language and the pictures kept in the project.
      Object.values(bookVersions).forEach(pages => Object.values(pages).forEach(url => URL.revokeObjectURL(url)));
      bookVersions = {};
      bookLang = (project && project.lang) || FlipbookSpeech.lang(Object.values(text).slice(0, 8).map(lines => (lines || []).join(' ')).join(' ').slice(0, 12000));
      Object.entries((project && project.versions) || {}).forEach(([lang, pages]) => {
        const kept = pictures[lang] || {};
        if (pages.every(page => kept[page])) bookVersions[lang] = Object.fromEntries(pages.map(page => [page, URL.createObjectURL(kept[page])]));
      });
      bookComplete = new Set(Object.keys(bookVersions)); bookChecked = {}; stopTranslating = true;
      bookVersionText = JSON.parse(JSON.stringify((project && project.versionText) || {}));
      bookVersionWords = JSON.parse(JSON.stringify((project && project.versionWords) || {}));
      // Odd page counts get a blank back cover so the book can close.
      const sheets = FlipbookLayout.withBackCover(newElements, 'pdf-page');
      const container = document.createElement('div'); container.id = 'pdf-book'; container.append(...sheets);
      zoom?.reset();
      zoomBox.replaceChildren(container);
      $('#reader-stage').replaceChildren(zoomBox);
      const ratio = natural.width / natural.height;
      bookRatio = ratio;
      const width = ratio > 1 ? 460 : 380;
      FlipbookLayout.decorate(sheets);
      book = new St.PageFlip(container, {width, height:Math.round(width / ratio), size:'stretch', minWidth:230, maxWidth:500, minHeight:115, maxHeight:760, autoSize:true, usePortrait:true, startPage:0, showCover:true, ...FlipbookLayout.motion(reduced)});
      book.on('flip', updatePage); book.on('changeOrientation', () => { updatePage(); animate(true); });
      book.on('changeState', event => {
        if (event.data === 'read') { updatePage(); animate(true); }
        else { stopAnimation(); $('#home').disabled = $('#prev').disabled = $('#next').disabled = true; }
      });
      book.loadFromHTML(sheets);
      disposeLayout=FlipbookLayout.bind(book,$('#reader-stage'),ratio,{compact:true});
      FlipbookLayout.centerCover(book, container, reduced);
      curl = FlipbookCurl.bind(book, container, sheets, {reduced});
      if (!zoom) zoom = FlipbookZoom.bind($('#reader-stage'), zoomBox, {button: $('#zoom'),
        state: () => { try { return book && book.getState(); } catch (e) { return 'read'; } },
        // The pages on screen: pan no further than the book.
        content: () => {
          const bounds = book && book.getBoundsRect(), block = document.querySelector('#pdf-book .stf__block');
          if (!bounds || !block) return null;
          const b = block.getBoundingClientRect(), s = b.width / (block.offsetWidth || b.width);
          return {left: b.left + bounds.left * s, top: b.top + bounds.top * s, width: bounds.width * s, height: bounds.height * s};
        }});
      book.on('flip', () => zoom.reset());
      sourcePdf = blob;
      $('#export-title').value = project ? project.title : pendingTitle || name.replace(/\.pdf$/i,'');
      pendingTitle = '';
      if (project) for (const [index,config] of Object.entries(project.overlays)) { overlays.set(Number(index),config); renderOverlay(Number(index),config); }
      $('#build-download').hidden = true;
      $('#document-name').textContent = name;
      draftName = name; hideDraft(); saveDraft();
      $('#target-page').replaceChildren(...newElements.map((_, index) => {
        const option = document.createElement('option'); option.value = String(index); option.textContent = 'Page ' + (index + 1); return option;
      }));
      // Skip pages already on screen; a hovered corner (fold_corner) may still flip.
      const goPage = target => { if (book && ['read', 'fold_corner'].includes(book.getState()) && !visiblePages().includes(target)) { zoom?.snap(); book.flip(target, 'top'); } };
      Object.entries(bookLinks).forEach(([index, list]) => FlipbookLinks.mount(newElements[Number(index)], list, goPage));
      marks?.close();
      marks = FlipbookBookmarks.bind({key: FlipbookBookmarks.key(name, newElements.length, ratio), pages: newElements,
        visible: visiblePages, goPage, toggle: $('#bookmark'), open: $('#bookmarks')});
      book.on('flip', () => marks.refresh());
      notes?.close();
      notes = FlipbookNotes.bind({key: FlipbookNotes.key(name, newElements.length, ratio), title: name.replace(/\.pdf$/i, ''),
        pages: newElements, goPage, open: $('#notes'), blank: false, bookmark: (index, on) => marks.set(index, on),
        onRemove: (index, said) => highlights?.forget(index, said)});
      highlights?.close();
      highlights = FlipbookHighlights.bind({key: FlipbookHighlights.key(name, newElements.length, ratio),
        pages: newElements, words: bookWords, text: bookText, button: $('#highlight'),
        // On a translated edition the highlighter takes the translated words.
        edition: () => { const shown = editions?.current(), lang = shown && shown !== bookLang ? shown : liveLang; return lang && bookVersionWords[lang] ? {lang, words: bookVersionWords[lang]} : null; },
        onQuote: (index, said, color) => notes.quote(index, said, color), onUnquote: (index, said) => notes.unquote(index, said),
        onRecolor: (index, said, color) => notes.tint(index, said, color),
        // ✨ Summarize: the server's AI turns a highlight into a short note.
        summarize: true, onSummary: (index, said, color) => notes.summary(index, said, color, highlightSummary),
        // 🌐 Translate (AI): only the highlighted text, into a note.
        translate: true, onTranslate: (index, said, color) => notes.translation(index, said, color, highlightTranslate)});
      podcastView?.close();
      // Podcast / summary are made in AI Summarizer (notebook.html); a project that already
      // carries them still plays them in the preview.
      podcastView = FlipbookPodcast.bind({podcast: () => bookPodcast, button: $('#podcast'), onStart: () => speech?.stop()});
      translateView?.close();
      // Page translations made earlier with AI (older projects) still show;
      // new AI translations are made from highlights (Translate tool).
      translateView = FlipbookTranslate.bind({translations: () => bookTranslations, visible: visiblePages, button: $('#translate')});
      book.on('flip', () => translateView.pageChanged());
      // 🌐 ID | EN: the whole book in another language, layout unchanged.
      editions = FlipbookEditions.bind({button: $('#edition'), original: bookLang, ready: () => [...bookComplete],
        offer: bookLang === 'en-US' ? ['id-ID'] : ['en-US'],
        apply: lang => {
          pageElements.forEach((page, index) => {
            const image = page.querySelector('img');
            if (image) image.src = (lang !== bookLang && bookVersions[lang] && bookVersions[lang][index]) || imageUrls[index];
          });
          speech?.editionChanged();                             // the audio book reads on in the new language
          if (lang !== bookLang) fillVersionText(lang);
        },
        cancel: () => { stopTranslating = true; },
        confirm: lang => (bookChecked[lang] && bookChecked[lang].size) ? MFDialog.confirm({
          title: L(`Carry on translating into ${FlipbookEditions.NAMES[lang]}?`, `Lanjutkan terjemahan?`),
          message: L(`${bookChecked[lang].size} of ${pageElements.length} pages are done; the rest follows.`, `${bookChecked[lang].size} dari ${pageElements.length} halaman sudah selesai; sisanya dilanjutkan.`),
          ok: L('Carry on', 'Lanjutkan'), cancel: L('Cancel', 'Batal'), icon: '🌐'}) : MFDialog.confirm({title: L(`Translate the whole book into ${FlipbookEditions.NAMES[lang]}?`, `Terjemahkan seluruh buku ke ${FlipbookEditions.NAMES[lang] === 'English' ? 'bahasa Inggris' : FlipbookEditions.NAMES[lang] === 'Malay' ? 'bahasa Melayu' : 'bahasa Indonesia'}?`),
          message: L(`Every page keeps its look; only the text changes. ${pageElements.length} pages · a minute or a few · free machine translation (no AI credit). The translation is saved with the project and goes into exports.`,
            `Tampilan tiap halaman tetap; hanya teksnya yang berganti. ${pageElements.length} halaman · satu sampai beberapa menit · mesin penerjemah gratis (tanpa kredit AI). Terjemahan disimpan bersama proyek dan ikut diekspor.`),
          ok: L('Translate', 'Terjemahkan'), cancel: L('Cancel', 'Batal'), icon: '🌐'}) ,
        make: translateBook,
        onError: message => error(message)});
      summaryView?.close();
      summaryView = FlipbookSummary.bind({summary: () => bookSummary, button: $('#summary')});
      speech?.close();
      speech = FlipbookSpeech.bind({text: bookText, words: bookWords, pages: newElements, visible: visiblePages, button: $('#speak'),
        busy: () => highlights.active(), onStart: () => podcastView?.stop(), notice: message => { $('#load-status').textContent = message; },
        // A translated edition on screen: read its text, in its language.
        // While a translation runs, its finished pages are already on screen: read those in the new language too.
        edition: () => { const current = editions?.current(), shown = current && current !== bookLang ? current : liveLang;
          return shown && bookVersionText[shown] ? {lang: shown, pages: bookVersionText[shown]} : null; },
        next: () => { if ($('#next').disabled) return false; goNext(); return true; }});
      book.on('flip', () => speech.pageChanged());
      book.on('changeState', event => { if (event.data === 'read') speech.pageChanged(); });
      const linkCount = found.stats.internal + found.stats.toc + found.stats.external;
      loading(null);
      $('#load-status').textContent = `${newElements.length} page${newElements.length === 1 ? '' : 's'} ready. The first page is the front cover.` +
        (linkCount ? ` ${linkCount} clickable link${linkCount === 1 ? '' : 's'} found` + (found.stats.toc ? ` (${found.stats.toc} from the table of contents).` : '.') : '');
      updatePage();
      libraryId = openingLibraryId; openingLibraryId = null;
      // A new book goes into My Library only when the member presses 💾 Save My Library.
      archiveNote(libraryId ? L('☁ Opened from My Library', '☁ Dibuka dari My Library') : '');
      paintLibraryButton();
      pagesReady = drawRest(version);                          // the other pages, in the background
      pagesReady.then(() => readPictures(version));            // picture pages: their text by OCR, in the background
      return true;
    } catch (cause) {
      if (installed) sourcePdf = null;
      paintLibraryButton();
      if (!installed) {
        newUrls.forEach(url => URL.revokeObjectURL(url));
        if (task) await task.destroy().catch(() => {});
      }
      error('Could not open this PDF. ' + (cause.message || 'Make sure the PDF is valid and not password-protected.'));
      loading(null);
      $('#load-status').textContent = 'Failed to load the PDF. Pick another file to try again.';
      return false;
    } finally {
      opening = false; $('#pdf-file').disabled = false; $('#add-file').disabled = false;
      $('#overlay-fields').disabled = !book; $('#replay').disabled = !book;
      if (book) updatePage();
      exportState();
    }
  }
  // ---------- My Library: every book a member opens or exports is kept in their
  // personal archive on the server (project, cover, latest exports).
  async function archiveMember() {
    if (archiveUser === undefined) {
      try { const r = await fetch('/api/auth/me', {credentials:'same-origin', cache:'no-store'}); archiveUser = r.ok ? (await r.json()).user : null; }
      catch (e) { archiveUser = null; }
    }
    return archiveUser;
  }
  function archiveNote(text, bad = false) {
    $('#archive-status').textContent = text || '';
    $('#archive-status').classList.toggle('is-error', bad);
  }
  async function coverJpeg() {
    const img = pageElements[0]?.querySelector('img');
    if (!img || !img.src) return null;
    try {
      const bitmap = await createImageBitmap(await (await fetch(img.src)).blob());
      const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    } catch (e) { return null; }
  }
  // Save (or update) the open book in the member's archive. Never blocks the editor.
  async function archiveBook() {
    if (!sourcePdf || !(await archiveMember())) { if (archiveUser === null) archiveNote(L('Log in to save books in My Library.', 'Masuk untuk menyimpan buku ke My Library.')); return null; }
    try {
      archiveNote(L('☁ Saving to My Library…', '☁ Menyimpan ke My Library…'));
      const project = await FlipbookExport.saveProject(model(), sourcePdf, () => {}, bookVersions);
      const headers = {'Content-Type':'application/zip'};
      if (libraryId) headers['X-Book-Id'] = libraryId;
      const response = await fetch('/api/library/save', {method:'POST', credentials:'same-origin', headers, body: project});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(result.error || L('Saving failed.', 'Gagal menyimpan.'));
      const first = !libraryId;
      libraryId = result.id;
      if (first) {
        const cover = await coverJpeg();
        if (cover) await fetch(`/api/library/${libraryId}/cover`, {method:'POST', credentials:'same-origin', headers:{'Content-Type':'image/jpeg'}, body: cover});
      }
      archiveNote(L('☁ Saved in My Library', '☁ Tersimpan di My Library'));
      return libraryId;
    } catch (cause) { archiveNote('My Library: ' + cause.message, true); return null; }
  }
  // 📚 Open My Library while nothing new is open; 💾 Save My Library once a
  // new book (a new source) is open: it goes into the member's archive only
  // then, and the button is back to 📚 Open My Library (the book is there now,
  // and keeps itself up to date).
  function paintLibraryButton() {
    $('#save-library').textContent = sourcePdf && !libraryId ? '💾 Save My Library' : '📚 Open My Library';
  }
  paintLibraryButton();
  // 💾 Save My Library: the open book goes into the member's archive now
  // (with a link to it); nothing open yet → the archive itself.
  $('#save-library').onclick = async () => {
    if (!sourcePdf || libraryId) { location.href = 'library.html'; return; }
    if (!(await archiveMember())) {
      archiveNote(L('Log in first to save this book in My Library.', 'Masuk dulu untuk menyimpan buku ini ke My Library.'), true);
      return;
    }
    const button = $('#save-library');
    button.disabled = true;
    try {
      if (!(await archiveBook())) return;
      archiveNote(L('☁ Saved in My Library', '☁ Tersimpan di My Library'));
    } finally { button.disabled = false; paintLibraryButton(); }
  };
  // Exports join the book in My Library only when the book is already there.
  async function archiveExport(kind, blob, filename) {
    if (!libraryId || !(await archiveBook())) return;
    try {
      const response = await fetch(`/api/library/${libraryId}/export`, {method:'POST', credentials:'same-origin',
        headers:{'Content-Type':'application/octet-stream', 'X-Kind': kind, 'X-Filename': encodeURIComponent(filename)}, body: blob});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(result.error || L('Saving the export failed.', 'Gagal menyimpan hasil ekspor.'));
      archiveNote(L('☁ Book + ' + kind.toUpperCase() + ' saved in My Library', '☁ Buku + hasil ' + kind.toUpperCase() + ' tersimpan di My Library'));
    } catch (cause) { archiveNote('My Library: ' + cause.message, true); }
  }

  // ---------- Add source: upload (PDF, Office, images), a link or Google Drive.
  const OFFICE_ROUTE = {docx:'word', doc:'word', xlsx:'excel', xls:'excel', csv:'excel', pptx:'pptx', ppt:'pptx'};
  const OFFICE_TYPE = {docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc:'application/msword',
    xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls:'application/vnd.ms-excel', csv:'text/csv',
    pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt:'application/vnd.ms-powerpoint'};
  const isImage = file => /^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name);
  const extOf = name => (String(name).split('.').pop() || '').toLowerCase();
  let adding = false;
  function addStatus(text, bad = false) { $('#add-status').textContent = text; $('#add-status').classList.toggle('is-error', bad); }
  function showAdd(open) {
    $('#add-dialog').hidden = !open;
    $('#add-file').setAttribute('aria-expanded', String(open));
    if (open) {
      addStatus(''); $('#add-drive-help').hidden = true;
      $('#add-url').placeholder = 'Paste a link: PDF, web page or Google Drive';
      setTimeout(() => $('#add-url').focus(), 0);
      loadDriveConfig();
    }
  }
  // Google Drive picker settings (null until the server has GOOGLE_CLIENT_ID +
  // GOOGLE_API_KEY); Google's scripts load as the dialog opens so the
  // sign-in pop-up opens straight from the click.
  let driveConfig = null;
  async function loadDriveConfig() {
    try {
      const r = await fetch('/api/capabilities', {cache:'no-store'});
      driveConfig = r.ok ? (await r.json()).drive || null : null;
      if (driveConfig && window.DrivePicker) DrivePicker.preload().catch(() => {});
    } catch (e) { driveConfig = null; }
  }
  // While Google's file chooser is open, the Add source dialog steps aside
  // (it would cover the chooser); cancelling brings it back.
  async function fromDrive() {
    try {
      const file = await DrivePicker.pick(driveConfig, text => {
        if (/^Choose a file in Google Drive/.test(text)) { $('#add-dialog').hidden = true; return; }
        addStatus(text);
        if (text && $('#add-dialog').hidden) $('#load-status').textContent = text;   // downloading: shown beside the book
      });
      if (!file) { if ($('#add-dialog').hidden) showAdd(true); return; }
      pendingTitle = file.name.replace(/\.[^.]+$/, '').slice(0, 200);
      await openSources([file]);
    } catch (cause) { showAdd(true); addStatus(cause.message, true); }
  }
  // A page's PDF lines as paragraphs (a line runs on unless it ends a sentence,
  // is short, or starts a list item) — what the translator reads.
  function pageParagraphs(index) {
    const lines = (bookText[String(index)] || []).map(l => String(l).replace(/\s+/g, ' ').trim()).filter(Boolean);
    const lengths = lines.map(l => l.length).sort((a, b) => a - b), typical = lengths[Math.floor(lengths.length / 2)] || 0;
    return lines.reduce((out, line, i) => {
      if (!i) return line;
      const prev = lines[i - 1];
      if (/[.!?:;"'”)]$/.test(prev) || prev.length < typical * 0.6 || FlipbookHighlights.item(line)) return out + '\n' + line;
      return /[A-Za-z]-$/.test(prev) && /^[a-z]/.test(line) ? out + line : out + ' ' + line;
    }, '');
  }
  // Translation of some pages ({index: text}) through the server: AI for the
  // page-by-page panel, the free offline translator for whole-book editions.
  const translateFree = (pages, target) => translatePages(pages, target, '/api/translate-free');
  async function translatePages(pages, target, path = '/api/translate') {
    const caps = await serverCaps();
    const response = await fetch(path, {method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Build-Token': caps.token || ''},
      body: JSON.stringify({pages, target, title: $('#export-title').value.trim() || 'Book'})});
    let data = {};
    try { data = await response.json(); } catch (e) {}
    if (!response.ok) throw Error(data.error || L('The translation could not be made.', 'Terjemahan tidak bisa dibuat.'));
    return data.pages || {};
  }
  // Original pages, then each translated edition's pictures (see FlipbookExport.versionImages).
  function allPictures(data) {
    return imageUrls.concat(FlipbookExport.versionImages(data).map(({lang, page}) => bookVersions[lang][page]));
  }
  // The whole book in another language, layout unchanged (assets/pdf-translate.js).
  // Each page shows up as soon as it is done; a press on the button stops, and
  // the next press carries on with the pages still to do.
  async function translateBook(lang, report) {
    if (!pdf) throw Error(L('Open a PDF first.', 'Buka PDF dulu.'));
    const book = pdf, total = pageElements.length;
    const checked = bookChecked[lang] || (bookChecked[lang] = new Set());
    const pages = bookVersions[lang] || (bookVersions[lang] = {});
    // From the page being read onward first, then the pages before it.
    const from = Math.min(...(visiblePages().length ? visiblePages() : [0]));
    const todo = pageElements.map((_, index) => index).filter(index => !checked.has(index))
      .sort((a, b) => (a < from) - (b < from) || a - b);
    const before = total - todo.length;
    stopTranslating = false; liveLang = lang;
    const say = done => report(L(`🌐 ${Math.min(total, before + done)} / ${total} · Stop`, `🌐 ${Math.min(total, before + done)} / ${total} · Berhenti`));
    const original = () => pageElements.forEach((page, index) => { const image = page.querySelector('img'); if (image) image.src = imageUrls[index]; });
    say(0);
    // Carrying on after a stop: the pages done before show translated again right away.
    Object.entries(pages).forEach(([index, url]) => { const image = pageElements[index] && pageElements[index].querySelector('img'); if (image) image.src = url; });
    if (Object.keys(pages).length) speech?.editionChanged();
    try {
      await PdfTranslate.book(book, {target: lang, translate: translateFree, maxPx: 1100, pages: todo,
        isCancelled: () => stopTranslating || book !== pdf,
        onProgress: (stage, done) => { if (stage !== 'read') say(done); },   // pages finished, not just read
        onPage: (index, blob, said, drawn) => {
          if (book !== pdf) return;
          if (pages[index]) URL.revokeObjectURL(pages[index]);
          pages[index] = URL.createObjectURL(blob);
          (bookVersionText[lang] || (bookVersionText[lang] = {}))[index] = said || [];   // read aloud by the audio book
          if (drawn && drawn.lines.length) (bookVersionWords[lang] || (bookVersionWords[lang] = {}))[index] = {w: boxedLines(drawn.lines, drawn.ratio), t: drawn.text};   // the highlighter snaps to it
          highlights?.refreshText(index);
          const image = pageElements[index] && pageElements[index].querySelector('img');
          if (image) image.src = pages[index];                  // the page changes language right away
          if (visiblePages().includes(index)) speech?.editionChanged();   // and the audio book follows
        }});
      todo.forEach(index => checked.add(index));                // pages without text count as done too
    } catch (cause) {
      if (book === pdf) {
        liveLang = null;
        Object.keys(pages).forEach(index => checked.add(Number(index)));
        original();
        speech?.editionChanged();                                             // stopped / failed: back to the original until it's finished
        if (!Object.keys(pages).length) delete bookVersions[lang];
        else if (libraryId) archiveBook();
      }
      throw cause;
    }
    if (book !== pdf) throw Error('cancelled');
    if (!Object.keys(pages).length) {
      delete bookVersions[lang];
      throw Error(L('This book has no text to translate (a scan? run OCR first).', 'Buku ini tidak punya teks untuk diterjemahkan (hasil scan? jalankan OCR dulu).'));
    }
    liveLang = null;                                           // editions.show(lang) takes over
    bookComplete.add(lang);
    if (libraryId) archiveBook();                              // keep My Library up to date
  }
  // Word lines in page fractions → the book page box (pages shaped unlike page 1
  // sit letterboxed in it, like PdfWords does for the original text).
  function boxedLines(lines, ratio) {
    let sx = 1, sy = 1;
    if (ratio < bookRatio) sx = ratio / bookRatio; else if (ratio > bookRatio) sy = bookRatio / ratio;
    if (sx === 1 && sy === 1) return lines;
    const ox = (1 - sx) / 2 * 10000, oy = (1 - sy) / 2 * 10000;
    return lines.map(line => line.map((v, i) => i === 0 ? Math.round(oy + v * sy) : i === 1 ? Math.max(1, Math.round(v * sy))
      : i % 2 === 0 ? Math.round(ox + v * sx) : Math.max(1, Math.round(v * sx))));
  }
  // Editions made before the audio book read them (no text kept): translate
  // the pages' text once more (free translator) so they are read in that language.
  const filling = new Set();
  async function fillVersionText(lang) {
    const said = bookVersionText[lang] || (bookVersionText[lang] = {});
    const missing = Object.keys(bookVersions[lang] || {}).filter(index => !said[index] && pageParagraphs(Number(index)).trim());
    if (!missing.length || filling.has(lang)) return;
    filling.add(lang);
    const book = pdf;
    try {
      const out = await translateFree(Object.fromEntries(missing.map(index => [index, pageParagraphs(Number(index))])), lang);
      if (book !== pdf) return;
      Object.entries(out).forEach(([index, text]) => {
        said[index] = String(text || '').split('\n').map(t => t.trim()).filter(Boolean).map(t => [0, 0, 0, 0, t]);
      });
      speech?.editionChanged();
      if (libraryId) archiveBook();
    } catch (cause) {
      // Not fatal: those pages are read from the original text.
    } finally { filling.delete(lang); }
  }
  // AI translation of one highlighted passage (Translate tool in the highlighter):
  // English text into Indonesian, anything else into English.
  async function highlightTranslate(text) {
    const target = FlipbookSpeech.lang(text) === 'en-US' ? 'id-ID' : 'en-US';
    const out = await translatePages({0: text}, target);
    return out['0'] || out[0];
  }
  // One page as a JPEG picture (object URL).
  async function renderPageImage(page) {
    const original = page.getViewport({scale:1});
    const viewport = page.getViewport({scale: Math.min(1.5, 1100 / Math.max(original.width, original.height))});
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    try {
      await page.render({canvasContext:canvas.getContext('2d'), viewport}).promise;
      const imageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
      if (!imageBlob) throw new Error('Could not render the page image.');
      return URL.createObjectURL(imageBlob);
    } finally { page.cleanup(); canvas.width = canvas.height = 0; }
  }
  // The pages not drawn yet, after the book has opened: the ones on screen
  // first, then onward in order. A page showing its blank stand-in gets its
  // picture at once (a translated edition on screen keeps its own picture).
  async function drawRest(version) {
    const doc = pdf, total = pageElements.length;
    const left = () => imageUrls.map((url, index) => index).filter(index => isBlank(imageUrls[index]));
    if (!left().length) return;
    const gone = () => version !== loadVersion || doc !== pdf;
    let done = total - left().length;
    try {
      while (!gone()) {
        const todo = left();
        if (!todo.length) break;
        const index = visiblePages().find(i => todo.includes(i)) ?? todo[0];
        const url = await renderPageImage(await doc.getPage(index + 1));
        if (gone()) { URL.revokeObjectURL(url); return; }
        imageUrls[index] = url; done++;
        const image = pageElements[index] && pageElements[index].querySelector('img');
        if (image && image.src === blankPage) image.src = url;
        loading(L(`Preparing pages ${done} / ${total}…`, `Menyiapkan halaman ${done} / ${total}…`), done / total);
      }
    } catch (cause) {
      console.warn('Pages skipped:', cause);
    } finally {
      if (!gone()) { loading(null); $('#load-status').textContent = L(`${total} pages ready.`, `${total} halaman siap.`); }
    }
  }
  // Pages that are only a picture (scans, magazine spreads): read their text
  // with OCR in the background, from the page being read onward, so the
  // highlighter and the audio book work there too. The pictures stay as they
  // are; the text is kept with the project / My Library.
  async function readPictures(version) {
    if (!window.PdfOcrWords || !pdf) return;
    const book = pdf, from = Math.min(...(visiblePages().length ? visiblePages() : [0]));
    const todo = pageElements.map((_, index) => index).filter(index => PdfOcrWords.needs(bookWords, index))
      .sort((a, b) => (a < from) - (b < from) || a - b);
    if (!todo.length) return;
    const gone = () => version !== loadVersion || book !== pdf;
    let worker = null, found = 0;
    try {
      loading(L(`Reading text in pictures (OCR) 0 / ${todo.length}…`, `Membaca teks di gambar (OCR) 0 / ${todo.length}…`), 0);
      worker = await PdfOcrWords.start('eng+ind');
      for (let n = 0; n < todo.length; n++) {
        if (gone()) return;
        const index = todo[n], page = await book.getPage(index + 1);
        const got = await worker.page(page, bookRatio);
        page.cleanup();
        if (gone()) return;
        if (got) {
          bookWords[String(index)] = got.lines; bookText[String(index)] = got.text; found++;
          highlights?.refreshText(index); speech?.refreshText();
        }
        loading(L(`Reading text in pictures (OCR) ${n + 1} / ${todo.length}…`, `Membaca teks di gambar (OCR) ${n + 1} / ${todo.length}…`), (n + 1) / todo.length);
      }
      loading(null);
      $('#load-status').textContent = found
        ? L(`Text found in ${found} picture page${found === 1 ? '' : 's'} (OCR): highlighter and audio book work there now.`, `Teks ditemukan di ${found} halaman gambar (OCR): stabilo dan audio book sekarang bisa dipakai di sana.`)
        : L('No readable text in the picture pages.', 'Tidak ada teks yang terbaca di halaman gambar.');
      if (found && libraryId) archiveBook();                   // keep it in My Library
    } catch (cause) {
      if (!gone()) { loading(null); $('#load-status').textContent = L('Text in pictures skipped: ', 'Teks di gambar dilewati: ') + cause.message; }
    } finally { worker?.stop(); }
  }
  // Short AI summary of one highlighted passage (Summarize tool in the preview).
  async function highlightSummary(text) {
    const caps = await serverCaps();
    const response = await fetch('/api/highlight-summary', {method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Build-Token': caps.token || ''}, body: JSON.stringify({text})});
    let data = {};
    try { data = await response.json(); } catch (e) {}
    if (!response.ok) throw Error(data.error || 'The summary could not be made.');
    return data.summary;
  }
  async function serverCaps() {
    let caps = null;
    try { const r = await fetch('/api/capabilities', {cache:'no-store'}); if (r.ok) caps = await r.json(); } catch (e) {}
    if (!caps) throw Error('This needs the MyFlipbook server (python server.py).');
    if (caps.loginRequired && !caps.token) throw Error('Please log in first to add Office files or links.');
    return caps;
  }
  let pdfLibLoading = null;
  function ensurePdfLib() {
    if (window.PDFLib) return Promise.resolve();
    if (!pdfLibLoading) pdfLibLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = 'assets/vendor/pdf-lib.min.js';
      s.onload = resolve; s.onerror = () => reject(Error('Could not load the PDF engine.'));
      document.head.appendChild(s);
    });
    return pdfLibLoading;
  }
  // Images become pages of one PDF, each page the image's own shape
  // (phone photos upright, transparency on white, very large ones scaled).
  async function imagesToPdf(images) {
    await ensurePdfLib();
    const doc = await PDFLib.PDFDocument.create();
    for (let i = 0; i < images.length; i++) {
      addStatus(`Turning image ${i + 1} / ${images.length} into a page…`);
      let bitmap;
      try { bitmap = await createImageBitmap(images[i]); }
      catch (e) {
        // SVG (and a few others) only decode through an <img>.
        bitmap = await new Promise((resolve, reject) => {
          const url = URL.createObjectURL(images[i]), img = new Image();
          img.onload = () => { URL.revokeObjectURL(url); img.naturalWidth ? resolve(img) : reject(); };
          img.onerror = () => { URL.revokeObjectURL(url); reject(); };
          img.src = url;
        }).catch(() => { throw Error(images[i].name + ' could not be read as an image.'); });
        if (!bitmap.width) { bitmap.width = bitmap.naturalWidth; bitmap.height = bitmap.naturalHeight; }
      }
      const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      const image = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const w = canvas.width * 0.75, h = canvas.height * 0.75;
      doc.addPage([w, h]).drawImage(image, {x:0, y:0, width:w, height:h});
      canvas.width = canvas.height = 0;
    }
    return new Blob([await doc.save()], {type:'application/pdf'});
  }
  async function officeToPdf(file) {
    const ext = extOf(file.name), caps = await serverCaps();
    if (!caps.office) throw Error('LibreOffice was not found on the server, so Office files cannot be converted.');
    addStatus('Converting ' + file.name + ' to PDF…');
    const response = await fetch('/api/convert/' + OFFICE_ROUTE[ext] + '-to-pdf', {method:'POST', headers:{
      'Content-Type': OFFICE_TYPE[ext], 'X-Build-Token': caps.token, 'X-Filename': encodeURIComponent(file.name)}, body: file});
    if (!response.ok) { let m = 'Conversion failed.'; try { m = (await response.json()).error || m; } catch (e) {} throw Error(m); }
    return response.blob();
  }
  async function openSources(list) {
    const files = [...list];
    if (!files.length || opening || exporting || adding) return;
    hideDraft();
    adding = true; $('#add-dialog').classList.add('is-busy');
    try {
      const first = files[0], ext = extOf(first.name), base = first.name.replace(/\.[^.]+$/, '') || 'document';
      let pdf;
      if (files.every(isImage)) pdf = await imagesToPdf(files);
      else if (ext === 'pdf' || first.type === 'application/pdf') pdf = first;
      else if (OFFICE_ROUTE[ext]) pdf = await officeToPdf(first);
      else throw Error(first.name + ': this file type is not supported. Use PDF, Word, Excel, PowerPoint or an image.');
      if (files.length > 1 && !files.every(isImage)) addStatus('Only the first file was used: ' + first.name);
      showAdd(false);
      await openPdf(pdf, ext === 'pdf' ? first.name : base + '.pdf');
    } catch (cause) { showAdd(true); addStatus(cause.message, true); }
    finally { adding = false; $('#add-dialog').classList.remove('is-busy'); }
  }
  $('#pdf-file').addEventListener('change', event => {
    const files = [...event.target.files];
    event.target.value = '';
    openSources(files);
  });
  $('#add-file').addEventListener('click', () => showAdd(true));
  $('#add-close').addEventListener('click', () => showAdd(false));
  $('#add-dialog').addEventListener('click', event => { if (event.target === $('#add-dialog')) showAdd(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#add-dialog').hidden) showAdd(false); });
  $('#add-dialog').querySelectorAll('[data-source]').forEach(button => button.addEventListener('click', () => {
    const source = button.dataset.source;
    if (source === 'upload') { $('#pdf-file').click(); return; }
    if (source === 'drive') {
      if (driveConfig && window.DrivePicker) { fromDrive(); return; }
      // Drive picking not set up on this server: open Drive, the reader shares
      // the file publicly and pastes its link.
      window.open('https://drive.google.com/drive/my-drive', '_blank', 'noopener');
      $('#add-url').placeholder = 'Paste the Google Drive share link here';
      $('#add-drive-help').hidden = false;
    }
    $('#add-url').focus();
  }));
  $('#add-link').addEventListener('submit', async event => {
    event.preventDefault();
    const url = $('#add-url').value.trim();
    if (!url || adding || opening) return;
    adding = true; $('#add-dialog').classList.add('is-busy');
    try {
      const caps = await serverCaps();
      addStatus(/google\.com/.test(url) ? 'Downloading from Google Drive…' : 'Fetching the link…');
      const response = await fetch('/api/fetch-source', {method:'POST', headers:{'Content-Type':'application/json', 'X-Build-Token': caps.token}, body: JSON.stringify({url})});
      if (!response.ok) { let m = 'The link could not be opened.'; try { m = (await response.json()).error || m; } catch (e) {} throw Error(m); }
      const blob = await response.blob(), name = decodeURIComponent(response.headers.get('X-Filename') || 'document.pdf');
      adding = false;
      await openSources([new File([blob], name, {type: blob.type})]);
      $('#add-url').value = '';
    } catch (cause) { addStatus(cause.message, true); }
    finally { adding = false; $('#add-dialog').classList.remove('is-busy'); }
  });
  const drop = $('#add-drop');
  ['dragenter', 'dragover'].forEach(type => $('#add-dialog').addEventListener(type, e => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(type => $('#add-dialog').addEventListener(type, e => { e.preventDefault(); if (type === 'drop' || e.target === $('#add-dialog')) drop.classList.remove('is-over'); }));
  $('#add-dialog').addEventListener('drop', e => openSources(e.dataTransfer.files));
  // The cover opens/closes with the curved turn; other pages use PageFlip.
  // Ignore clicks while a cover turn is still animating.
  const goPrev = () => { zoom?.snap(); if (!book || curl?.busy()) return; if (book.getCurrentPageIndex() === 1 && curl?.close()) return; book.flipPrev(); };
  const goNext = () => { zoom?.snap(); if (!book || curl?.busy()) return; if (!curl?.open()) book.flipNext(); };
  $('#prev').addEventListener('click', goPrev);
  $('#next').addEventListener('click', goNext);
  $('#home').addEventListener('click', () => {
    zoom?.reset();
    if (!book || opening || curl?.busy()) return;
    if (curl?.close()) return;
    if (book.getState() !== 'read') return;
    book.turnToPage(0); updatePage(); animate(true);
  });
  FlipbookIdle.bind({
    host: $('.preview'),
    active: () => !!book && !opening && !exporting && book.getState() === 'read' && book.getCurrentPageIndex() > 0 && !speech?.active() && !podcastView?.active(),
    home: () => { book.turnToPage(0); updatePage(); animate(true); }
  });
  $('#replay').addEventListener('click', () => animate());
  $('#overlay-form').addEventListener('submit', event => {
    event.preventDefault(); if (!book || opening || !$('#overlay-form').reportValidity()) return;
    const index = Number($('#target-page').value);
    const config = {label:$('#stat-label').value.trim(), value:Number($('#stat-value').value), position:$('#position').value};
    overlays.set(index, config); renderOverlay(index, config);
    book.turnToPage(index); updatePage(); animate();
  });
  $('#target-page').addEventListener('change', () => {
    const index = Number($('#target-page').value), config = overlays.get(index);
    if (config) { $('#stat-label').value = config.label; $('#stat-value').value = config.value; $('#position').value = config.position; }
    book?.turnToPage(index); updatePage(); animate(true);
  });
  $('#remove-overlay').addEventListener('click', () => {
    const index = Number($('#target-page').value); overlays.delete(index); pageElements[index]?.querySelector('.stat-overlay')?.remove();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAnimation(); });
  $('#project-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file || opening || exporting) return;
    exporting = true; exportState(); $('#pdf-file').disabled = true; $('#overlay-fields').disabled = true;
    try {
      const project = await FlipbookExport.readProject(file);
      exporting = false;
      await openPdf(project.pdf, project.data.title + '.pdf', project.data, project.versions);
    } catch(cause) { error(L('The project could not be opened: ', 'Proyek gagal dibuka: ') + cause.message); }
    finally { exporting = false; exportState(); $('#pdf-file').disabled=false; $('#overlay-fields').disabled=!book; }
  });
  // Paywall (server decides; this only explains it before any work starts).
  function lockedFor(target, caps) {
    if (target === 'project' || !caps || !caps.paywall) return null;
    const need = target === 'exe' ? 'exe' : target === 'apk' ? 'apk' : 'export';
    if ((caps.entitlements || []).includes(need)) return null;
    return target === 'exe' ? 'Business' : 'Pro';
  }
  function showPaywall(plan) {
    const box = $('#export-status');
    const link = Object.assign(document.createElement('a'), { href: 'account.html', textContent: L('See plans →', 'Lihat paket →') });
    link.style.fontWeight = '800';
    box.replaceChildren(L('This export needs the ' + (plan === 'Business' ? 'Business' : 'Pro or Business') + ' plan. Preview and saving the project stay free. ',
      'Ekspor ini butuh paket ' + (plan === 'Business' ? 'Business' : 'Pro atau Business') + '. Preview dan simpan proyek tetap gratis. '), link);
  }
  function markLocked() {
    for (const [id, target] of [['#export-html','html'],['#export-apk','apk'],['#export-exe','exe'],['#share-link','html'],['#share-link-top','html']]) {
      const button = $(id), plan = lockedFor(target, buildConfig);
      if (!button.dataset.label) button.dataset.label = button.textContent;
      button.textContent = button.dataset.label + (plan ? ' · ' + plan.toUpperCase() : '');
    }
  }
  // Progress bar for every export: fraction 0..1, or null to hide.
  function progress(fraction) {
    const bar = $('#export-progress');
    if (fraction === null) { bar.hidden = true; return; }
    const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    bar.hidden = false; bar.setAttribute('aria-valuenow', String(percent));
    bar.querySelector('span').style.width = percent + '%';
    $('#export-percent').textContent = percent + '%';
  }
  const EXPORT_NAMES = {project: '.smflipbook', html: '.html', apk: '.apk', exe: '-Windows.zip'};
  async function exportBook(target) {
    if (!sourcePdf || opening || exporting) return;
    if (target !== 'project') {
      // Use the config loaded with the page so the save dialog still opens
      // within the click; fetch only if it never arrived.
      if (!buildConfig) { try { const r = await fetch('/api/capabilities', { cache: 'no-store' }); if (r.ok) { buildConfig = await r.json(); markLocked(); } } catch (e) {} }
      const plan = lockedFor(target, buildConfig);
      if (plan) { showPaywall(plan); return; }
    }
    exporting = true; exportState(); $('#pdf-file').disabled=true; $('#overlay-fields').disabled=true;
    error(''); $('#build-download').hidden=true;
    const status = message => { $('#export-status').textContent=message; };
    // Map a step's own 0..1 into its slice of the whole bar.
    const step = (from, to) => fraction => progress(from + (to - from) * Math.max(0, Math.min(1, fraction)));
    try {
      const data = model(), name = FlipbookExport.titleFile(data.title);   // files named like the book
      const outputName = name + EXPORT_NAMES[target];
      // Every export asks where to save first (inside the click), then runs to the end on its own.
      const saveHandle = await FlipbookExport.chooseSave(outputName);
      status(L('Preparing the export…', 'Menyiapkan ekspor…')); progress(0);
      if (target === 'project') {
        // Project files unlock exports later: expired trials keep the
        // reader only, so saving one needs Pro too.
        try {
          const who = window.MFAuth ? await window.MFAuth.me() : null;
          if (who && who.user && !who.offline && window.MFAuth.trialWall(who.user)) return;
        } catch (e) {}
        const blob = await FlipbookExport.saveProject(data, sourcePdf, (message, fraction) => { status(message); step(0, .9)(fraction); }, bookVersions);
        status(L('Saving the project…', 'Menyimpan proyek…'));
        const saved = await FlipbookExport.saveBlob(blob, outputName, saveHandle); progress(1);
        status(saved?L('Project saved where you chose.','Proyek tersimpan di lokasi pilihanmu.'):L('Project sent to the browser downloads.','Proyek dikirim ke download browser.'));
        if (libraryId) archiveBook();                          // only books already in My Library
        return;
      }
      const native = target === 'apk' || target === 'exe';
      if (!native) {
        // One file named after the book: pages and data encrypted inside.
        status(L('Preparing the pages…', 'Menyiapkan halaman…')); await pagesReady;
        const single = await FlipbookExport.packageSingleHtml(data, allPictures(data), (message, fraction) => { status(message); if (fraction !== undefined) step(0, .95)(fraction); });
        status(L('Saving the HTML…', 'Menyimpan HTML…'));
        const saved = await FlipbookExport.saveBlob(single, outputName, saveHandle); progress(1);
        archiveExport('html', single, outputName);
        status(L((saved?'HTML saved where you chose. ':'HTML sent to the browser downloads. ')+'Double-click '+outputName+' to read the book.',
          (saved?'HTML tersimpan di lokasi pilihanmu. ':'HTML dikirim ke download browser. ')+'Klik 2x file '+outputName+' untuk membaca bukunya.'));
        return;
      }
      const pack = step(0, .12);
      status(L('Preparing the pages…', 'Menyiapkan halaman…')); await pagesReady;
      const bundle = await FlipbookExport.packageBook(data, allPictures(data), (message, fraction) => { status(message); if (fraction !== undefined) pack(fraction); });
      const capabilities=await fetch('/api/capabilities',{cache:'no-store'});
      if(!capabilities.ok)throw Error(L('The local build service is not available. Run python server.py.', 'Layanan build lokal tidak tersedia. Jalankan python server.py.'));
      buildConfig=await capabilities.json();
      if(!buildConfig[target])throw Error(L(target.toUpperCase()+' builds are not available on this computer yet.', 'Build '+target.toUpperCase()+' belum tersedia di komputer ini.'));
      status(L('Sending the book to the build service…', 'Mengirim buku ke layanan build…'));
      // The server keeps the build with the book in My Library (when it is there).
      const archived = libraryId ? await archiveBook() : null;
      const buildHeaders = {'Content-Type':'application/zip','X-Build-Token':buildConfig.token};
      if (archived) buildHeaders['X-Library-Book'] = archived;
      const sent = await FlipbookExport.upload('/api/build/'+target, bundle, buildHeaders, step(.12, .2));
      if(!sent.ok)throw Error(sent.data.error||L('The build could not start.','Build gagal dimulai.'));
      // Server reports its stage (0..1); while the compiler runs, creep
      // toward the next stage so the bar keeps moving honestly.
      const building = step(.2, .9), started = Date.now(), tau = target === 'apk' ? 45000 : 20000;
      let job = {status: 'queued', progress: 0}, stageAt = Date.now(), stage = 0;
      while (job.status !== 'done') {
        await new Promise(resolve=>setTimeout(resolve,1000));
        const check=await fetch('/api/jobs/'+sent.data.id);if(!check.ok)throw Error(L('Build status is not available.','Status build tidak tersedia.'));
        job=await check.json();status(job.message);
        if(job.status==='failed') {
          if(job.log) { const link=$('#build-download');link.onclick=null;link.href=job.log;link.textContent='Download log build';link.hidden=false; }
          throw Error(job.message);
        }
        const reported = Number(job.progress) || 0;
        if (reported !== stage) { stage = reported; stageAt = Date.now(); }
        const next = reported >= .3 ? .97 : Math.min(.97, reported + .1);
        building(reported + (next - reported) * (1 - Math.exp(-(Date.now() - stageAt) / (reported >= .3 ? tau : 8000))));
      }
      status(L('Saving ','Menyimpan ')+(target==='apk'?'APK':'EXE ZIP')+'…');
      const saved = await FlipbookExport.saveRemote(job.download, outputName, saveHandle, step(.9, 1));
      progress(1);
      // Keep a link to fetch the result again (e.g. another copy for a phone).
      const link=$('#build-download');link.href=job.download;link.textContent=L('Save another copy…','Simpan salinan lagi…');link.hidden=false;
      let saving=false;
      link.onclick=async event=>{
        event.preventDefault();if(saving)return;saving=true;error('');
        try {
          const again = await FlipbookExport.chooseSave(outputName);
          const ok=await FlipbookExport.saveRemote(job.download,outputName,again);
          status(ok?L('Copy saved where you chose.','Salinan tersimpan di lokasi pilihanmu.'):L('File sent to the browser downloads.','File dikirim ke download browser.'));
        } catch(cause) { if(cause.name==='AbortError')status(L('Saving cancelled.','Penyimpanan dibatalkan.'));else error(L('Saving failed: ','Gagal menyimpan: ')+cause.message); }
        finally { saving=false; }
      };
      status((saved?(target==='apk'?'APK':'EXE ZIP')+L(' saved where you chose',' tersimpan di lokasi pilihanmu'):L('Build sent to the browser downloads','Hasil build dikirim ke download browser'))+' ('+Math.round((Date.now()-started)/1000)+L(' seconds).',' detik).'));
    } catch(cause) { progress(null); if(cause.name==='AbortError')status(L('Export cancelled.','Ekspor dibatalkan.'));else { status(L('Export failed: ','Ekspor gagal: ')+cause.message); error(cause.message); } }
    finally { exporting=false;exportState();$('#pdf-file').disabled=false;$('#overlay-fields').disabled=!book; }
  }
  // Draft autosave (this device only): reopening the editor after a
  // refresh offers the last document back, so work is not lost. Notes,
  // highlights and bookmarks already persist per book in localStorage;
  // AI translations/editions do not — use My Library (or a project file)
  // when those must survive. Storage lives in flipbook-export.js so the
  // save/load round-trip is unit-testable.
  let draftName = '', draftTimer = 0;
  function hideDraft() { const box = $('#draft-box'); if (box) box.hidden = true; }
  function saveDraft() {
    if (!sourcePdf) return;
    const titleEl = $('#export-title');
    FlipbookExport.draftSave({blob: sourcePdf, name: draftName || 'document.pdf',
      title: (titleEl && titleEl.value) || '', savedAt: Date.now()}).then(() => {});
  }
  function queueDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 4000); }
  // Share link: upload the sealed single-file HTML so anyone with the  // link can read the book in a browser and download it for keeping.
  // Same bytes as "Save offline HTML", only the destination differs.
  // Share-link popup (top header button): the link text with a Copy button
  // below it. Stays usable on short screens where the sidebar is folded away.
  function openSharePopup(message) {
    $('#share-popup-status').textContent = message || '';
    $('#share-popup-row').hidden = true;
    paintCopy($('#share-popup-copy'), false);
    $('#share-popup').hidden = false;
  }
  function showShareLink(url) {
    $('#share-popup-url').value = url;
    $('#share-popup-row').hidden = false;
  }
  function closeSharePopup() { $('#share-popup').hidden = true; }
  function paintCopy(button, done) {
    if (!button) return;
    if (!button.dataset.label) button.dataset.label = button.textContent;
    if (button.dataset.timer) { clearTimeout(Number(button.dataset.timer)); delete button.dataset.timer; }
    button.classList.toggle('is-copied', !!done);
    button.textContent = done ? L('✓ Copied', '✓ Tersalin') : button.dataset.label;
    if (done) button.dataset.timer = String(setTimeout(() => paintCopy(button, false), 2500));
  }
  async function copyShareLink(input, note, button) {
    if (!input.value) return;
    try { await navigator.clipboard.writeText(input.value); }
    catch (e) { input.select(); try { document.execCommand('copy'); } catch (_) {} }
    note.textContent = L('Link copied.', 'Tautan disalin.');
    paintCopy(button, true);
  }
  async function shareBook(){
    if(!sourcePdf||opening||exporting) return;
    if(!buildConfig){ try{ const r=await fetch('/api/capabilities',{cache:'no-store'}); if(r.ok){ buildConfig=await r.json(); markLocked(); } }catch(e){} }
    const plan=lockedFor('html', buildConfig);
    if(plan){
      // Publishing is Pro, but Free gets its first shares: guests sign in
      // first, members go through — the server counts the 3 free shares and
      // answers 402 (trial over / quota spent) with the upgrade message.
      let loggedIn = false;
      try { const d = window.MFAuth ? await window.MFAuth.me() : null; loggedIn = !!(d && (d.user || d.offline)); } catch (e) {}
      if (!loggedIn && window.MFAuth) { window.MFAuth.loginPopup(() => shareBook()); return; }
      if (!loggedIn) return;
    }
    if(!buildConfig||!buildConfig.token){ error(L('Please sign in to share a book.','Silakan masuk dulu untuk membagikan buku.')); return; }
    exporting=true; exportState(); $('#pdf-file').disabled=true; $('#overlay-fields').disabled=true;
    error(''); $('#share-box').hidden=true;
    const status=message=>{ $('#export-status').textContent=message; $('#share-popup-status').textContent=message; };
    openSharePopup(L('Preparing the pages…','Menyiapkan halaman…'));
    const step=(from,to)=>fraction=>progress(from+(to-from)*Math.max(0,Math.min(1,fraction)));
    try{
      status(L('Preparing the pages…','Menyiapkan halaman…')); await pagesReady;
      const data=model();
      const single=await FlipbookExport.packageSingleHtml(data, allPictures(data), (message,fraction)=>{ status(message); if(fraction!==undefined) step(0,.8)(fraction); });
      status(L('Uploading the book for sharing…','Mengunggah buku untuk dibagikan…'));
      const sent=await FlipbookExport.upload('/api/share', single,
        {'Content-Type':'text/html','X-Build-Token':buildConfig.token,'X-Title':encodeURIComponent(data.title||'Interactive book')}, step(.8,.98));
      if(!sent.ok) throw Error((sent.data&&sent.data.error)||L('Sharing failed.','Berbagi gagal.'));
      const url=location.origin+sent.data.url;
      $('#share-url').value=url; $('#share-box').hidden=false;
      $('#share-status').textContent=L('Link ready — send it anywhere (chat, Drive, email). The book plays in the browser and can be downloaded there.',
        'Tautan siap — kirim ke mana saja (chat, Drive, email). Buku langsung diputar di browser dan bisa diunduh di sana.');
      showShareLink(url);
      progress(1); status(L('Share link ready.','Tautan berbagi siap.'));
    }catch(cause){ progress(null); status(L('Sharing failed: ','Berbagi gagal: ')+cause.message); error(cause.message); }
    finally{ exporting=false; exportState(); $('#pdf-file').disabled=false; $('#overlay-fields').disabled=!book; }
  }
  $('#share-copy').onclick=()=>copyShareLink($('#share-url'), $('#share-status'), $('#share-copy'));
  $('#share-popup-copy').onclick=()=>copyShareLink($('#share-popup-url'), $('#share-popup-status'), $('#share-popup-copy'));
  // Drive launcher: tiny redirect file the owner uploads to Google Drive.
  // Members download + double-click it and land straight in the player.
  $('#share-popup-launcher').onclick=()=>{
    const url = $('#share-popup-url').value; if (!url) return;
    try {
      const title = ($('#export-title') && $('#export-title').value) || 'book';
      FlipbookExport.download(new Blob([FlipbookExport.shareLauncher(title, url)], {type: 'text/html'}),
        'Open-' + FlipbookExport.titleFile(title) + '.html');
      $('#share-popup-status').textContent = L('Launcher downloaded — upload it to Google Drive and share that file. Phones open this one; Windows members can use the .url shortcut below.',
        'Launcher ke-download — upload nang Google Drive terus bagi file kui. HP mbukak iki; member Windows iso nganggo shortcut .url ngisore.');
    } catch (cause) { $('#share-popup-status').textContent = cause.message; }
  };
  $('#share-popup-shortcut').onclick=()=>{
    const url = $('#share-popup-url').value; if (!url) return;
    try {
      const title = ($('#export-title') && $('#export-title').value) || 'book';
      FlipbookExport.download(new Blob([FlipbookExport.shareShortcut(url)], {type: 'application/internet-shortcut'}),
        'Open-' + FlipbookExport.titleFile(title) + '.url');
      $('#share-popup-status').textContent = L('Shortcut downloaded — upload it to Google Drive. On Windows a double-click always opens the browser (never Notepad).',
        'Shortcut ke-download — upload nang Google Drive. Nang Windows double-click mesthi mbukak browser (ora Notepad).');
    } catch (cause) { $('#share-popup-status').textContent = cause.message; }
  };
  // Google Doc straight into the reader's Drive (title = book title, the
  // share link clickable inside): Drive previews Docs natively, one click
  // reaches the player — no download step at all.
  $('#share-popup-doc').onclick = async () => {
    const url = $('#share-popup-url').value; if (!url) return;
    const statusEl = $('#share-popup-status');
    const link = (text, href) => {
      const anchor = document.createElement('a');
      anchor.href = href; anchor.target = '_blank'; anchor.rel = 'noopener'; anchor.textContent = text;
      return anchor;
    };
    try {
      if (!driveConfig) await loadDriveConfig();
      if (!driveConfig || !window.DrivePicker) throw Error(L('Google Drive is not set up on this server (GOOGLE_CLIENT_ID + GOOGLE_API_KEY). Copy the link or grab a file above instead.',
        'Google Drive durung disetel nang server iki (GOOGLE_CLIENT_ID + GOOGLE_API_KEY). Salin link-e utowo download file nang nduwur wae.'));
      const title = ($('#export-title') && $('#export-title').value) || 'book';
      const doc = await DrivePicker.createDoc(driveConfig, title, url, message => { statusEl.textContent = message; });
      if (!doc) { statusEl.textContent = L('Cancelled.', 'Batal.'); return; }
      // Where it landed: fresh Docs always start in My Drive (root), so the
      // owner knows exactly where to find, move and share it.
      const folderUrl = !doc.parentId || doc.parentId === 'root'
        ? 'https://drive.google.com/drive/my-drive'
        : 'https://drive.google.com/drive/folders/' + encodeURIComponent(doc.parentId);
      statusEl.replaceChildren(L('Document created: ', 'Dokumen dadi: '), link(doc.name, doc.url),
        L(' — saved in ', ' — kesimpen nang '), link(L('My Drive', 'Drive-ku'), folderUrl),
        L('. Open it there to move or share it with members.', '. Bukaken nang kono kanggo mindah / bagi ke member.'));
    } catch (cause) { statusEl.textContent = cause.message; }
  };
  $('#share-popup-close').onclick=closeSharePopup;
  $('#share-popup').addEventListener('mousedown', event => { if (event.target.id === 'share-popup') closeSharePopup(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#share-popup').hidden) closeSharePopup(); });
  $('#save-project').onclick=()=>exportBook('project');$('#export-html').onclick=()=>exportBook('html');
  $('#export-apk').onclick=()=>exportBook('apk');$('#export-exe').onclick=()=>exportBook('exe');
  $('#share-link').onclick=()=>shareBook();
  $('#share-link-top').onclick=()=>shareBook();
  $('#organize-pages').onclick=async ()=>{
    if(!sourcePdf){ error(L('Open a PDF first.','Buka PDF dulu.')); return; }
    const raw=(($('#document-name')||{}).textContent||'').trim()||'document.pdf';
    const name=/\.pdf$/i.test(raw)?raw:raw+'.pdf';
    try{
      loading(L('Preparing organize…','Menyiapkan organize…'));
      const id=await FlipbookTransfer.save(sourcePdf, name);
      location.href='converter.html?tool=organize-pdf&source='+encodeURIComponent(id);
    }catch(cause){ error(L('Could not open organize: ','Tidak bisa membuka organize: ')+(cause&&cause.message||cause)); }
  };
  fetch('/api/capabilities').then(async response=>{
    if(!response.ok)throw Error(L('The build service is not running','Layanan build belum berjalan'));
    buildConfig=await response.json();exportState();markLocked();
    const buildNote=$('#build-availability');
    if(buildNote)buildNote.textContent=buildConfig.apk||buildConfig.exe?L('APK/EXE builds use this computer. The first build can take a few minutes and needs internet for dependencies.','Build APK/EXE memakai komputer ini. Build pertama dapat memerlukan beberapa menit dan internet untuk dependensi.'):L('Flutter is not available yet. HTML export and saving projects still work.','Flutter belum tersedia. Ekspor HTML dan simpan proyek tetap bisa digunakan.');
  }).catch(()=>{ const buildNote=$('#build-availability'); if(buildNote)buildNote.textContent=L('For APK/EXE builds, run the project server with python server.py. HTML export still works.','Untuk build APK/EXE, jalankan server proyek dengan python server.py. Ekspor HTML tetap tersedia.'); });
  const fromLibrary = new URLSearchParams(location.search).get('library');
  if (/^[0-9a-f]{32}$/.test(fromLibrary || '')) {
    (async () => {
      try {
        archiveNote(L('☁ Opening from My Library…', '☁ Membuka dari My Library…'));
        const response = await fetch(`/api/library/${fromLibrary}/project`, {credentials:'same-origin'});
        if (!response.ok) throw Error(((await response.json().catch(() => ({}))).error) || L('The book could not be opened from My Library.', 'Buku tidak bisa dibuka dari My Library.'));
        const project = await FlipbookExport.readProject(await response.blob());
        openingLibraryId = fromLibrary;
        await openPdf(project.pdf, project.data.title + '.pdf', project.data, project.versions);
        history.replaceState(null, '', location.pathname);
      } catch (cause) { openingLibraryId = null; archiveNote(cause.message, true); error(cause.message); }
    })();
  }
  // flipbook.html?link=<public PDF>&title=… (journal search): fetch it like
  // "Add source → paste a link" and open it as a book.
  const handedLink = new URLSearchParams(location.search).get('link');
  if (handedLink && /^https?:\/\//i.test(handedLink)) {
    pendingTitle = (new URLSearchParams(location.search).get('title') || '').slice(0, 200);
    history.replaceState(null, '', location.pathname);
    $('#add-url').value = handedLink;
    showAdd(true);
    addStatus(L('Fetching the PDF…', 'Mengambil PDF artikel…'));
    $('#add-link').requestSubmit();
  }
  const source = new URLSearchParams(location.search).get('source');
  // A new title is worth keeping too (debounced into the draft).
  const titleInput = $('#export-title');
  if (titleInput) titleInput.addEventListener('input', queueDraft);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveDraft(); });
  // No incoming document (converter handoff, library, link): offer the
  // autosaved draft back instead of a blank editor.
  if (!fromLibrary && !handedLink && !source) {
    FlipbookExport.draftLoad().then(draft => {
      if (!draft || !draft.blob || sourcePdf) return;
      const box = $('#draft-box'); if (!box) return;
      const when = draft.savedAt ? new Date(draft.savedAt).toLocaleString() : '';
      $('#draft-text').textContent = L(`Continue with “${draft.name}”${when ? ' (' + when + ')' : ''}? Unsaved edits other than notes are lost otherwise.`,
        `Teruske “${draft.name}”${when ? ' (' + when + ')' : ''}? Edit-an sing durung kesimpen (saliyane catatan) bakal ilang.`);
      $('#draft-resume').textContent = L('Continue', 'Teruske');
      $('#draft-discard').textContent = L('Discard', 'Buang');
      box.hidden = false;
      $('#draft-resume').onclick = async () => {
        hideDraft();
        if (await openPdf(draft.blob, draft.name)) {
          if (draft.title) $('#export-title').value = draft.title;
          draftName = draft.name; saveDraft();
        }
      };
      $('#draft-discard').onclick = async () => { hideDraft(); await FlipbookExport.draftClear(); };
    });
  }
  if (source) {    (async () => {
      try {
        const entry = await FlipbookTransfer.get(source);
        if (!entry) throw new Error(L('The conversion result was not found. Choose a PDF or convert again.', 'Hasil konversi tidak ditemukan. Pilih PDF atau konversi ulang.'));
        if (await openPdf(entry.blob, entry.name)) {
          await FlipbookTransfer.remove(source);
          history.replaceState(null, '', location.pathname);
        }
      } catch (cause) { error(cause.message); }
    })();
  }
})();
