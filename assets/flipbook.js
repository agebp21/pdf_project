'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let book = null, pdf = null, pageElements = [], imageUrls = [], frame = 0, loadVersion = 0;
  let opening = false;
  const overlays = new Map(); // legacy v1 stat overlays (kept for backward compat)
  let disposeLayout = null;

  // ── Editor mode state ────────────────────────────────
  let editorMode = false; // false = read, true = edit

  $('#fullscreen').onclick = async () => {
    const preview = $('.preview');
    try { if (document.fullscreenElement) await document.exitFullscreen(); else if (preview.requestFullscreen) await preview.requestFullscreen(); else preview.classList.toggle('reading-fullscreen'); }
    catch (cause) { preview.classList.toggle('reading-fullscreen'); }
  };
  document.addEventListener('keydown', event => { if (event.key === 'Escape') $('.preview').classList.remove('reading-fullscreen'); });
  document.addEventListener('fullscreenchange', () => { $('#fullscreen').textContent = document.fullscreenElement ? 'Keluar fullscreen' : 'Layar penuh'; });

  let sourcePdf = null, bookRatio = 1, exporting = false, buildConfig = null;

  function exportState() {
    $('#export-fields').disabled = !sourcePdf || opening || exporting;
    $('#export-apk').disabled = !buildConfig?.apk;
    $('#export-exe').disabled = !buildConfig?.exe;
    $('#project-file').disabled = opening || exporting;
    const editorReady = !!book && !opening;
    $('#editor-fields').disabled = !editorReady;
    $('#add-text').disabled = !editorReady;
    $('#add-hotspot').disabled = !editorReady;
    $('#ed-extract-page').disabled = !editorReady || !pdf;
    $('#ed-extract-all').disabled = !editorReady || !pdf;
  }

  // v2 model: title, pageCount, ratio, pages (from editor), overlays (legacy)
  const model = () => ({
    version: 2,
    title: $('#export-title').value.trim() || 'Interactive book',
    pageCount: pageElements.length,
    ratio: bookRatio,
    pages: FlipbookEditor.getModel(),
    overlays: Object.fromEntries(overlays), // keep legacy stat overlays
  });

  const error = message => { $('#reader-error').textContent = message; $('#reader-error').hidden = !message; };

  function visiblePages() {
    if (!book) return [];
    const first = book.getCurrentPageIndex();
    const isCover = first === 0;
    return [first, ...(!isCover && book.getOrientation() === 'landscape' && first + 1 < pageElements.length ? [first + 1] : [])];
  }

  function updatePage() {
    const visible = visiblePages();
    if (!visible.length) return;
    const isCover = visible[0] === 0;
    $('#page-status').textContent = isCover ? `Front cover · 1 / ${pageElements.length}` : `Pages ${visible.map(i => i + 1).join('–')} / ${pageElements.length}`;
    $('#next').textContent = isCover ? 'Open cover →' : '→';
    $('#next').setAttribute('aria-label', isCover ? 'Open cover' : 'Next page');
    $('#prev').disabled = $('#home').disabled = visible[0] === 0;
    $('#next').disabled = visible.at(-1) === pageElements.length - 1;
  }

  function stopAnimation() { cancelAnimationFrame(frame); frame = 0; }

  // Legacy stat overlay animation (kept for backward compat)
  function animate(automatic = false) {
    stopAnimation();
    const visible = visiblePages();
    const start = performance.now();
    function draw(now) {
      const progress = automatic && reduced ? 1 : Math.min(1, (now - start) / 1800);
      const eased = 1 - Math.pow(1 - progress, 3);
      visible.forEach(index => {
        const config = overlays.get(index);
        const element = pageElements[index]?.querySelector('.stat-overlay');
        if (!config || !element) return;
        element.querySelector('strong').textContent = Math.round(config.value * eased).toLocaleString('id-ID');
        element.style.opacity = String(0.2 + 0.8 * eased);
        element.style.transform = `translateY(${16 * (1 - eased)}px)`;
      });
      if (progress < 1) frame = requestAnimationFrame(draw);
    }
    draw(start);
    // Also trigger element animations for visible pages
    triggerElementAnimations(visible);
  }

  // ── Element animation (new system) ──────────────────
  function triggerElementAnimations(pageIndices) {
    pageIndices.forEach(index => {
      const pageEl = pageElements[index];
      if (!pageEl) return;
      pageEl.querySelectorAll('.fb-el').forEach(el => {
        // Reset and replay animation
        el.classList.remove('fb-animated');
        const animType = el.dataset.anim;
        const delay = Number(el.dataset.delay || 0);
        const dur = Number(el.dataset.dur || 600);
        if (animType && animType !== 'none') {
          setTimeout(() => {
            el.classList.add('fb-animated', `fb-anim-${animType}`);
            el.style.setProperty('--fb-dur', dur + 'ms');
          }, reduced ? 0 : delay);
        } else {
          el.classList.add('fb-animated');
        }
      });
    });
  }

  // ── Render page elements (read mode overlay) ──────────
  function renderPageElements(pageIndex, container) {
    container.querySelectorAll('.fb-el').forEach(e => e.remove());
    const pagesModel = FlipbookEditor.getModel();
    const pageData = pagesModel[pageIndex];
    if (!pageData?.elements?.length) return;

    const elContainer = document.createElement('div');
    elContainer.className = 'page-elements interactive';
    pageData.elements.forEach(el => {
      const div = document.createElement('div');
      div.className = `fb-el fb-${el.type}`;
      div.dataset.anim  = el.animation?.type || 'none';
      div.dataset.delay = el.animation?.delay ?? 0;
      div.dataset.dur   = el.animation?.duration ?? 600;
      // Position
      div.style.left   = el.x + '%';
      div.style.top    = el.y + '%';
      div.style.width  = el.w + '%';
      div.style.height = el.h + '%';
      if (el.rotation) div.style.transform = `rotate(${el.rotation}deg)`;
      // Style
      const s = el.style || {};
      div.style.fontSize   = s.fontSize ? (s.fontSize * 0.0175) + 'em' : '';
      div.style.color      = s.color || '';
      div.style.fontWeight = s.bold ? '700' : '400';
      div.style.fontStyle  = s.italic ? 'italic' : '';
      div.style.textAlign  = s.align || 'left';
      div.style.background = s.bgColor || 'transparent';
      div.style.opacity    = s.opacity != null ? s.opacity : 1;
      // Padding
      div.style.padding = '3px 6px';
      div.style.boxSizing = 'border-box';
      div.style.lineHeight = '1.35';
      div.style.wordBreak = 'break-word';
      div.style.borderRadius = el.type === 'hotspot' ? '6px' : '';
      div.style.display = el.type === 'hotspot' ? 'flex' : 'block';
      div.style.alignItems = 'center';
      div.style.justifyContent = 'center';
      // Content (safe textContent)
      div.textContent = el.content || '';
      // Link
      if (el.link) {
        div.classList.add('fb-link');
        div.style.cursor = 'pointer';
        div.addEventListener('click', e => {
          e.stopPropagation();
          if (el.link.type === 'url' && el.link.target) {
            window.open(el.link.target, '_blank', 'noopener,noreferrer');
          } else if (el.link.type === 'page' && book) {
            const target = Number(el.link.target) - 1; // 1-based → 0-based
            if (target >= 0 && target < pageElements.length) {
              book.turnToPage(target);
              updatePage();
            }
          }
        });
      }
      elContainer.append(div);
    });
    container.append(elContainer);
  }

  // ── Refresh all page element overlays after model change ──
  function refreshAllPageElements() {
    pageElements.forEach((el, index) => renderPageElements(index, el));
  }

  // ── Legacy stat overlay render ───────────────────────
  function renderOverlay(index, config) {
    pageElements[index].querySelector('.stat-overlay')?.remove();
    const element = document.createElement('div');
    element.className = 'stat-overlay ' + config.position;
    const number = document.createElement('strong');
    number.textContent = config.value.toLocaleString('id-ID');
    const label = document.createElement('span'); label.textContent = config.label;
    element.append(number, label); pageElements[index].append(element);
  }

  // ── Editor mode ──────────────────────────────────────
  function setEditorMode(edit) {
    editorMode = edit;
    const readerStage = $('#reader-stage');
    const editorView  = $('#editor-view');
    const modeRead    = $('#mode-read');
    const modeEdit    = $('#mode-edit');
    const modeHint    = $('#mode-hint');

    if (edit) {
      readerStage.style.display = 'none';
      editorView.classList.remove('hidden');
      modeRead.classList.remove('active');
      modeEdit.classList.add('active');
      modeHint.textContent = 'Editing — switch to Read to preview the flipbook';
      // Sync editor to the current flipbook page
      const currentBookPage = book ? book.getCurrentPageIndex() : 0;
      FlipbookEditor.setPage(currentBookPage);
      resizeEditorView();
    } else {
      readerStage.style.display = '';
      editorView.classList.add('hidden');
      modeRead.classList.add('active');
      modeEdit.classList.remove('active');
      modeHint.textContent = 'Switch to Edit to add animations & links';
      // Refresh overlays in read mode
      refreshAllPageElements();
      // Re-init FlipbookLayout after view restore
      if (book && disposeLayout) {
        setTimeout(() => {
          try { disposeLayout(); disposeLayout = FlipbookLayout.bind(book, readerStage, bookRatio, { compact: true }); } catch (_) {}
        }, 50);
      }
    }
  }

  $('#mode-read')?.addEventListener('click', () => { if (editorMode) setEditorMode(false); });
  $('#mode-edit')?.addEventListener('click', () => { if (!editorMode && book) setEditorMode(true); });

  // ── Resize editor view to fit page proportionally ────
  function resizeEditorView() {
    const editorView = $('#editor-view');
    const wrap = $('#editor-page-wrap');
    if (!wrap || !editorView || !bookRatio) return;
    const availW = editorView.clientWidth - 32;
    const availH = Math.max(420, window.innerHeight * 0.65) - 32;
    let w = availW, h = w / bookRatio;
    if (h > availH) { h = availH; w = h * bookRatio; }
    wrap.style.width  = Math.round(w) + 'px';
    wrap.style.height = Math.round(h) + 'px';
  }
  window.addEventListener('resize', () => { if (editorMode) resizeEditorView(); });

  // ── Open PDF ─────────────────────────────────────────
  async function openPdf(blob, name, project = null) {
    if (opening || exporting) return false;
    opening = true;
    $('#pdf-file').disabled = true;
    $('#home').disabled = $('#prev').disabled = $('#next').disabled = true;
    stopAnimation(); error('');
    exportState();

    const version = ++loadVersion;
    let newPdf = null, task = null;
    const newUrls = [];
    let installed = false;

    try {
      $('#load-status').textContent = 'Reading PDF…';
      if (!window.pdfjsLib || !window.St) throw new Error('Libraries unavailable. Reload the page.');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
      task = pdfjsLib.getDocument({ data: await blob.arrayBuffer(), isEvalSupported: false });
      newPdf = await task.promise;
      if (project && project.pageCount !== newPdf.numPages) throw Error('Project page count differs from the saved PDF.');

      const firstPage = await newPdf.getPage(1);
      const natural = firstPage.getViewport({ scale: 1 });
      const newElements = [];

      for (let i = 1; i <= newPdf.numPages; i++) {
        $('#load-status').textContent = `Preparing page ${i} / ${newPdf.numPages}…`;
        const page = i === 1 ? firstPage : await newPdf.getPage(i);
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(1.5, 1100 / Math.max(original.width, original.height)) });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const imageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
        if (!imageBlob) throw new Error('Could not render the page image.');
        const url = URL.createObjectURL(imageBlob); newUrls.push(url);
        const element = document.createElement('article'); element.className = 'pdf-page';
        const image = document.createElement('img'); image.src = url; image.alt = `Page ${i}`;
        element.append(image); newElements.push(element);
        page.cleanup(); canvas.width = canvas.height = 0;
      }

      if (version !== loadVersion) return false;
      if (book) { disposeLayout?.(); book.destroy(); book = null; }
      if (pdf) await pdf.destroy();
      imageUrls.forEach(url => URL.revokeObjectURL(url));
      imageUrls = newUrls; pdf = newPdf; pageElements = newElements; overlays.clear(); installed = true;

      const container = document.createElement('div'); container.id = 'pdf-book'; container.append(...newElements);
      $('#reader-stage').replaceChildren(container);

      const ratio = natural.width / natural.height;
      bookRatio = ratio;
      const width = ratio > 1 ? 460 : 380;
      FlipbookLayout.decorate(newElements);
      book = new St.PageFlip(container, { width, height: Math.round(width / ratio), size: 'stretch', minWidth: 230, maxWidth: 500, minHeight: 115, maxHeight: 760, autoSize: true, usePortrait: true, startPage: 0, showCover: true, ...FlipbookLayout.motion(reduced) });
      book.on('flip', () => { updatePage(); animate(true); });
      book.on('changeOrientation', () => { updatePage(); animate(true); });
      book.on('changeState', event => {
        if (event.data === 'read') { updatePage(); animate(true); }
        else { stopAnimation(); $('#home').disabled = $('#prev').disabled = $('#next').disabled = true; }
      });
      book.loadFromHTML(newElements);
      disposeLayout = FlipbookLayout.bind(book, $('#reader-stage'), ratio, { compact: true });

      sourcePdf = blob;
      $('#export-title').value = project ? project.title : name.replace(/\.pdf$/i, '');

      // ── Load editor model ────────────────────────────
      FlipbookEditor.reset(newElements.length, newUrls, newPdf);

      // Load saved pages data (v2) or legacy overlays (v1)
      if (project?.pages) {
        FlipbookEditor.loadModel(project.pages);
      } else if (project?.overlays) {
        // Legacy v1: migrate stat overlays to legacy map
        for (const [index, config] of Object.entries(project.overlays)) {
          overlays.set(Number(index), config);
          renderOverlay(Number(index), config);
        }
      }

      // Init editor UI
      FlipbookEditor.init({
        stageEl:   $('#editor-stage'),
        wrapEl:    $('#editor-page-wrap'),
        pageStripEl: $('#page-strip'),
        inspector: {
          panel:      $('#ed-inspector'),
          status:     $('#editor-status'),
          content:    $('#insp-content'),
          fontSize:   $('#insp-fontsize'),
          color:      $('#insp-color'),
          bgColor:    $('#insp-bgcolor'),
          opacity:    $('#insp-opacity'),
          bold:       $('#insp-bold'),
          italic:     $('#insp-italic'),
          align_left:   $('#insp-align-left'),
          align_center: $('#insp-align-center'),
          align_right:  $('#insp-align-right'),
          animType:   $('#insp-anim-type'),
          animDelay:  $('#insp-anim-delay'),
          animDur:    $('#insp-anim-dur'),
          linkType:   $('#insp-link-type'),
          linkUrl:    $('#insp-link-url'),
          linkPage:   $('#insp-link-page'),
          linkUrlRow:  $('#insp-link-url-row'),
          linkPageRow: $('#insp-link-page-row'),
        },
        pageCount:  newElements.length,
        imageUrls:  newUrls,
        pdfDoc:     newPdf,
        onModelChange: () => refreshAllPageElements(),
      });

      // Set max page for link-page input
      if ($('#insp-link-page')) $('#insp-link-page').max = newElements.length;

      // Show mode bar
      $('#editor-mode-bar').hidden = false;

      // Render any loaded elements in read mode
      refreshAllPageElements();

      $('#build-download').hidden = true;
      $('#document-name').textContent = name;
      $('#load-status').textContent = `${newElements.length} pages ready. The first page is the front cover.`;
      $('#editor-status').textContent = `Page 1 of ${newElements.length} — click Edit to start editing`;
      updatePage();
      return true;

    } catch (cause) {
      if (installed) sourcePdf = null;
      if (!installed) {
        newUrls.forEach(url => URL.revokeObjectURL(url));
        if (task) await task.destroy().catch(() => {});
      }
      error('Could not open this PDF. ' + (cause.message || 'Make sure the PDF is valid and not password-protected.'));
      $('#load-status').textContent = 'Failed to load the PDF. Pick another file to try again.';
      return false;
    } finally {
      opening = false; $('#pdf-file').disabled = false;
      if (book) updatePage();
      exportState();
    }
  }

  // ── File input handlers ──────────────────────────────
  $('#pdf-file').addEventListener('change', event => {
    const file = event.target.files[0];
    if (file) openPdf(file, file.name);
    event.target.value = '';
  });

  $('#prev').addEventListener('click', () => book?.flipPrev());
  $('#next').addEventListener('click', () => book?.flipNext());
  $('#home').addEventListener('click', () => {
    if (!book || opening || book.getState() !== 'read') return;
    book.turnToPage(0); updatePage(); animate(true);
  });

  FlipbookIdle.bind({
    host: $('.preview'),
    active: () => !!book && !opening && !exporting && !editorMode && book.getState() === 'read' && book.getCurrentPageIndex() > 0,
    home: () => { book.turnToPage(0); updatePage(); animate(true); }
  });

  // ── Editor toolbar buttons ───────────────────────────
  $('#add-text')?.addEventListener('click', () => {
    if (!book || opening) return;
    if (!editorMode) setEditorMode(true);
    FlipbookEditor.addElement('text');
  });
  $('#add-hotspot')?.addEventListener('click', () => {
    if (!book || opening) return;
    if (!editorMode) setEditorMode(true);
    FlipbookEditor.addElement('hotspot');
  });
  $('#ed-delete-btn')?.addEventListener('click', () => FlipbookEditor.deleteSelected());
  $('#ed-clear-btn')?.addEventListener('click', () => {
    if (confirm('Clear all elements from this page?')) FlipbookEditor.clearPage();
  });
  $('#ed-extract-page')?.addEventListener('click', async () => {
    if (!pdf || opening) return;
    $('#editor-status').textContent = 'Extracting text…';
    const count = await FlipbookEditor.extractCurrentPage();
    $('#editor-status').textContent = count ? `Added ${count} text element(s) from PDF.` : 'No extractable text found on this page.';
  });
  $('#ed-extract-all')?.addEventListener('click', async () => {
    if (!pdf || opening) return;
    if (!editorMode) setEditorMode(true);
    $('#ed-extract-all').disabled = true;
    const count = await FlipbookEditor.extractAllPages(msg => { $('#editor-status').textContent = msg; });
    $('#editor-status').textContent = `Extracted ${count} text element(s) across all pages.`;
    $('#ed-extract-all').disabled = false;
    exportState();
  });

  // ── Project file ─────────────────────────────────────
  $('#project-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file || opening || exporting) return;
    exporting = true; exportState(); $('#pdf-file').disabled = true;
    try {
      const project = await FlipbookExport.readProject(file);
      exporting = false;
      await openPdf(project.pdf, project.data.title + '.pdf', project.data);
    } catch (cause) { error('Failed to open project: ' + cause.message); }
    finally { exporting = false; exportState(); $('#pdf-file').disabled = false; }
  });

  // ── Export ───────────────────────────────────────────
  async function exportBook(target) {
    if (!sourcePdf || opening || exporting) return;
    if (editorMode) setEditorMode(false); // switch to read before export
    exporting = true; exportState(); $('#pdf-file').disabled = true;
    error(''); $('#build-download').hidden = true;
    const status = message => { $('#export-status').textContent = message; };
    try {
      const data = model(), name = FlipbookExport.filename(data.title);
      const outputName = target === 'project' ? name + '.flipbook' : name + '-HTML.zip';
      const saveHandle = (target === 'project' || target === 'html') ? await FlipbookExport.chooseSave(outputName) : null;
      status('Preparing export…');
      if (target === 'project') {
        const saved = await FlipbookExport.saveBlob(await FlipbookExport.saveProject(data, sourcePdf), outputName, saveHandle);
        status(saved ? 'Project saved to your chosen location.' : 'Project sent to browser download.');
      } else {
        const bundle = await FlipbookExport.packageBook(data, imageUrls, status);
        if (target === 'html') {
          const saved = await FlipbookExport.saveBlob(bundle, outputName, saveHandle);
          status((saved ? 'HTML saved to your chosen location. ' : 'HTML sent to browser download. ') + 'Extract the full ZIP then open index.html.');
        } else {
          status('Sending book to local build service…');
          const response = await fetch('/api/build/' + target, { method: 'POST', headers: { 'Content-Type': 'application/zip', 'X-Build-Token': buildConfig.token }, body: bundle });
          const result = await response.json(); if (!response.ok) throw Error(result.error || 'Build failed to start.');
          let complete = false;
          while (!complete) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const check = await fetch('/api/jobs/' + result.id); if (!check.ok) throw Error('Build status unavailable.');
            const job = await check.json(); status(job.message);
            if (job.status === 'failed') {
              if (job.log) { const link = $('#build-download'); link.onclick = null; link.href = job.log; link.textContent = 'Download build log'; link.hidden = false; }
              throw Error(job.message);
            }
            if (job.status === 'done') {
              complete = true; const link = $('#build-download'); link.href = job.download; link.textContent = target === 'apk' ? 'Save APK as…' : 'Save EXE ZIP as…'; link.hidden = false;
              let saving = false;
              link.onclick = async event => {
                event.preventDefault(); if (saving) return; saving = true; error('');
                try {
                  const saved = await FlipbookExport.saveRemote(job.download, name + (target === 'apk' ? '.apk' : '-Windows.zip'));
                  status(saved ? 'File saved to your chosen location.' : 'File sent to browser download.');
                } catch (cause) { if (cause.name === 'AbortError') status('Save cancelled. Build result still available.'); else error('Save failed: ' + cause.message); }
                finally { saving = false; }
              };
              status('Build done. Click Save as to choose location.');
            }
          }
        }
      }
    } catch (cause) { if (cause.name === 'AbortError') status('Save cancelled.'); else { status('Export failed.'); error(cause.message); } }
    finally { exporting = false; exportState(); $('#pdf-file').disabled = false; }
  }

  $('#save-project').onclick = () => exportBook('project');
  $('#export-html').onclick  = () => exportBook('html');
  $('#export-apk').onclick   = () => exportBook('apk');
  $('#export-exe').onclick   = () => exportBook('exe');

  fetch('/api/capabilities').then(async response => {
    if (!response.ok) throw Error('Build service not running');
    buildConfig = await response.json(); exportState();
    $('#build-availability').textContent = buildConfig.apk || buildConfig.exe
      ? 'Build APK/EXE uses this computer. First build may take a few minutes and needs internet for dependencies.'
      : 'Flutter not available. HTML export and project save still work.';
  }).catch(() => { $('#build-availability').textContent = 'For APK/EXE builds, run the project server with python server.py. HTML export is still available.'; });

  // ── Transfer from converter ──────────────────────────
  const source = new URLSearchParams(location.search).get('source');
  if (source) {
    (async () => {
      try {
        const entry = await FlipbookTransfer.get(source);
        if (!entry) throw new Error('Conversion result not found. Pick a PDF or convert again.');
        if (await openPdf(entry.blob, entry.name)) {
          await FlipbookTransfer.remove(source);
          history.replaceState(null, '', location.pathname);
        }
      } catch (cause) { error(cause.message); }
    })();
  }
})();
