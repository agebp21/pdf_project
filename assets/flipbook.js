'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let book = null, pdf = null, pageElements = [], imageUrls = [], frame = 0, loadVersion = 0;
  let opening = false;
  const overlays = new Map();
  let disposeLayout = null;
  $('#fullscreen').onclick=async()=>{
    const preview=$('.preview');
    try { if(document.fullscreenElement)await document.exitFullscreen();else if(preview.requestFullscreen)await preview.requestFullscreen();else preview.classList.toggle('reading-fullscreen'); }
    catch(cause){preview.classList.toggle('reading-fullscreen');}
  };
  document.addEventListener('keydown',event=>{if(event.key==='Escape')$('.preview').classList.remove('reading-fullscreen')});
  document.addEventListener('fullscreenchange',()=>{$('#fullscreen').textContent=document.fullscreenElement?'Keluar fullscreen':'Layar penuh'});
  let sourcePdf = null, bookRatio = 1, exporting = false, buildConfig = null, bookLinks = {}, bookWords = {}, marks = null, notes = null, highlights = null, loupe = null, curl = null;
  // Arsipku: the archived copy of the open book (members only).
  let libraryId = null, openingLibraryId = null, archiveUser;
  function exportState() {
    $('#export-fields').disabled = !sourcePdf || opening || exporting;
    $('#export-apk').disabled = !buildConfig?.apk;
    $('#export-exe').disabled = !buildConfig?.exe;
    $('#project-file').disabled = opening || exporting;
  }
  const model = () => ({version:1,title:$('#export-title').value.trim()||'Buku interaktif',pageCount:pageElements.length,ratio:bookRatio,overlays:Object.fromEntries(overlays),links:bookLinks,words:bookWords});
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
  async function openPdf(blob, name, project = null) {
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
      $('#load-status').textContent = 'Reading PDF…';
      if (!window.pdfjsLib || !window.St) throw new Error('Libraries unavailable. Reload the page.');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
      task = pdfjsLib.getDocument({data: await blob.arrayBuffer(), isEvalSupported:false});
      newPdf = await task.promise;
      if (project && project.pageCount !== newPdf.numPages) throw Error('Project page count differs from the saved PDF.');
      const firstPage = await newPdf.getPage(1);
      const natural = firstPage.getViewport({scale:1});
      const newElements = [];
      for (let i = 1; i <= newPdf.numPages; i++) {
        $('#load-status').textContent = `Preparing page ${i} / ${newPdf.numPages}…`;
        const page = i === 1 ? firstPage : await newPdf.getPage(i);
        const original = page.getViewport({scale:1});
        const viewport = page.getViewport({scale: Math.min(1.5, 1100 / Math.max(original.width, original.height))});
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({canvasContext:canvas.getContext('2d'), viewport}).promise;
        const imageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
        if (!imageBlob) throw new Error('Could not render the page image.');
        const url = URL.createObjectURL(imageBlob); newUrls.push(url);
        const element = document.createElement('article'); element.className = 'pdf-page';
        const image = document.createElement('img'); image.src = url; image.alt = `Page ${i}`;
        element.append(image); newElements.push(element);
        page.cleanup(); canvas.width = canvas.height = 0;
      }
      // Table of contents / cross-reference links (never blocks opening the book).
      let found = {links:{}, stats:{internal:0, external:0, toc:0}};
      try {
        if (window.PdfLinks) found = await PdfLinks.extract(newPdf, {progress:(i, n) => { $('#load-status').textContent = `Finding links ${i} / ${n}…`; }});
      } catch (cause) { console.warn('Links skipped:', cause); }
      // Word positions so readers can highlight text (never blocks opening either).
      let words = {};
      try {
        if (window.PdfWords) words = await PdfWords.extract(newPdf, {progress:(i, n) => { $('#load-status').textContent = `Reading text ${i} / ${n}…`; }});
      } catch (cause) { console.warn('Words skipped:', cause); }
      if (version !== loadVersion) return false;
      if (book) { disposeLayout?.(); book.destroy(); book = null; }
      if (pdf) await pdf.destroy();
      imageUrls.forEach(url => URL.revokeObjectURL(url));
      imageUrls = newUrls; pdf = newPdf; pageElements = newElements; overlays.clear(); installed = true; bookLinks = found.links; bookWords = words;
      // Odd page counts get a blank back cover so the book can close.
      const sheets = FlipbookLayout.withBackCover(newElements, 'pdf-page');
      const container = document.createElement('div'); container.id = 'pdf-book'; container.append(...sheets);
      $('#reader-stage').replaceChildren(container);
      const ratio = natural.width / natural.height;
      bookRatio = ratio;
      const width = ratio > 1 ? 460 : 380;
      FlipbookLayout.decorate(sheets);
      book = new St.PageFlip(container, {width, height:Math.round(width / ratio), size:'stretch', minWidth:230, maxWidth:500, minHeight:115, maxHeight:760, autoSize:true, usePortrait:true, startPage:0, showCover:true, ...FlipbookLayout.motion(reduced)});
      book.on('flip', updatePage); book.on('changeOrientation', () => { updatePage(); animate(true); });
      FlipbookSound.attach(book);
      book.on('changeState', event => {
        if (event.data === 'read') { updatePage(); animate(true); }
        else { stopAnimation(); $('#home').disabled = $('#prev').disabled = $('#next').disabled = true; }
      });
      book.loadFromHTML(sheets);
      disposeLayout=FlipbookLayout.bind(book,$('#reader-stage'),ratio,{compact:true});
      FlipbookLayout.centerCover(book, container, reduced);
      curl = FlipbookCurl.bind(book, container, sheets, {reduced, onTurn: () => FlipbookSound.play()});
      sourcePdf = blob;
      $('#export-title').value = project ? project.title : name.replace(/\.pdf$/i,'');
      if (project) for (const [index,config] of Object.entries(project.overlays)) { overlays.set(Number(index),config); renderOverlay(Number(index),config); }
      $('#build-download').hidden = true;
      $('#document-name').textContent = name;
      $('#target-page').replaceChildren(...newElements.map((_, index) => {
        const option = document.createElement('option'); option.value = String(index); option.textContent = 'Page ' + (index + 1); return option;
      }));
      // Skip pages already on screen; a hovered corner (fold_corner) may still flip.
      const goPage = target => { if (book && ['read', 'fold_corner'].includes(book.getState()) && !visiblePages().includes(target)) book.flip(target, 'top'); };
      Object.entries(bookLinks).forEach(([index, list]) => FlipbookLinks.mount(newElements[Number(index)], list, goPage));
      marks?.close();
      marks = FlipbookBookmarks.bind({key: FlipbookBookmarks.key(name, newElements.length, ratio), pages: newElements,
        visible: visiblePages, goPage, toggle: $('#bookmark'), open: $('#bookmarks')});
      book.on('flip', () => marks.refresh());
      notes?.close();
      notes = FlipbookNotes.bind({key: FlipbookNotes.key(name, newElements.length, ratio), title: name.replace(/\.pdf$/i, ''),
        pages: newElements, goPage, open: $('#notes'), bookmark: (index, on) => marks.set(index, on)});
      highlights?.close();
      highlights = FlipbookHighlights.bind({key: FlipbookHighlights.key(name, newElements.length, ratio),
        pages: newElements, words: bookWords, button: $('#highlight')});
      loupe?.close();
      loupe = FlipbookLoupe.bind({pages: newElements, button: $('#loupe')});
      const linkCount = found.stats.internal + found.stats.toc + found.stats.external;
      $('#load-status').textContent = `${newElements.length} page${newElements.length === 1 ? '' : 's'} ready. The first page is the front cover.` +
        (linkCount ? ` ${linkCount} clickable link${linkCount === 1 ? '' : 's'} found` + (found.stats.toc ? ` (${found.stats.toc} from the table of contents).` : '.') : '');
      updatePage();
      libraryId = openingLibraryId; openingLibraryId = null;
      if (libraryId) archiveNote('☁ Dibuka dari Arsipku'); else archiveBook();
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
      opening = false; $('#pdf-file').disabled = false; $('#add-file').disabled = false;
      $('#overlay-fields').disabled = !book; $('#replay').disabled = !book;
      if (book) updatePage();
      exportState();
    }
  }
  // ---------- Arsipku: every book a member opens or exports is kept in their
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
    if (!sourcePdf || !(await archiveMember())) { if (archiveUser === null) archiveNote('Masuk untuk menyimpan otomatis ke Arsipku.'); return null; }
    try {
      archiveNote('☁ Menyimpan ke Arsipku…');
      const project = await FlipbookExport.saveProject(model(), sourcePdf);
      const headers = {'Content-Type':'application/zip'};
      if (libraryId) headers['X-Book-Id'] = libraryId;
      const response = await fetch('/api/library/save', {method:'POST', credentials:'same-origin', headers, body: project});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(result.error || 'Gagal menyimpan.');
      const first = !libraryId;
      libraryId = result.id;
      if (first) {
        const cover = await coverJpeg();
        if (cover) await fetch(`/api/library/${libraryId}/cover`, {method:'POST', credentials:'same-origin', headers:{'Content-Type':'image/jpeg'}, body: cover});
      }
      archiveNote('☁ Tersimpan di Arsipku');
      return libraryId;
    } catch (cause) { archiveNote('Arsipku: ' + cause.message, true); return null; }
  }
  async function archiveExport(kind, blob, filename) {
    if (!(await archiveBook())) return;
    try {
      const response = await fetch(`/api/library/${libraryId}/export`, {method:'POST', credentials:'same-origin',
        headers:{'Content-Type':'application/octet-stream', 'X-Kind': kind, 'X-Filename': encodeURIComponent(filename)}, body: blob});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(result.error || 'Gagal menyimpan hasil ekspor.');
      archiveNote('☁ Buku + hasil ' + kind.toUpperCase() + ' tersimpan di Arsipku');
    } catch (cause) { archiveNote('Arsipku: ' + cause.message, true); }
  }

  // ---------- Add file: upload (PDF, Office, images), a link or Google Drive.
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
    if (open) { addStatus(''); setTimeout(() => $('#add-url').focus(), 0); }
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
    $('#add-url').placeholder = source === 'drive' ? 'Paste a Google Drive, Docs, Sheets or Slides share link' : 'Paste a link to a PDF, Office file or web page';
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
  const goPrev = () => { if (!book || curl?.busy()) return; if (book.getCurrentPageIndex() === 1 && curl?.close()) return; book.flipPrev(); };
  const goNext = () => { if (!book || curl?.busy()) return; if (!curl?.open()) book.flipNext(); };
  $('#prev').addEventListener('click', goPrev);
  $('#next').addEventListener('click', goNext);
  $('#home').addEventListener('click', () => {
    if (!book || opening || curl?.busy()) return;
    if (curl?.close()) return;
    if (book.getState() !== 'read') return;
    book.turnToPage(0); updatePage(); animate(true);
  });
  FlipbookIdle.bind({
    host: $('.preview'),
    active: () => !!book && !opening && !exporting && book.getState() === 'read' && book.getCurrentPageIndex() > 0 && !loupe?.active(),
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
      await openPdf(project.pdf, project.data.title + '.pdf', project.data);
    } catch(cause) { error('Proyek gagal dibuka: ' + cause.message); }
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
    const link = Object.assign(document.createElement('a'), { href: 'account.html', textContent: 'Lihat paket →' });
    link.style.fontWeight = '800';
    box.replaceChildren('Ekspor ini butuh paket ' + (plan === 'Business' ? 'Business' : 'Pro atau Business') + '. Preview dan simpan proyek tetap gratis. ', link);
  }
  function markLocked() {
    for (const [id, target] of [['#export-html','html'],['#export-apk','apk'],['#export-exe','exe']]) {
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
      status('Menyiapkan ekspor…'); progress(0);
      if (target === 'project') {
        const blob = await FlipbookExport.saveProject(data, sourcePdf, (message, fraction) => { status(message); step(0, .9)(fraction); });
        status('Menyimpan proyek…');
        const saved = await FlipbookExport.saveBlob(blob, outputName, saveHandle); progress(1);
        status(saved?'Proyek tersimpan di lokasi pilihanmu.':'Proyek dikirim ke download browser.');
        archiveBook();
        return;
      }
      const native = target === 'apk' || target === 'exe';
      if (!native) {
        // One file named after the book: pages and data encrypted inside.
        const single = await FlipbookExport.packageSingleHtml(data, imageUrls, (message, fraction) => { status(message); if (fraction !== undefined) step(0, .95)(fraction); });
        status('Menyimpan HTML…');
        const saved = await FlipbookExport.saveBlob(single, outputName, saveHandle); progress(1);
        archiveExport('html', single, outputName);
        status((saved?'HTML tersimpan di lokasi pilihanmu. ':'HTML dikirim ke download browser. ')+'Klik 2x file '+outputName+' untuk membaca bukunya.');
        return;
      }
      const pack = step(0, .12);
      const bundle = await FlipbookExport.packageBook(data, imageUrls, (message, fraction) => { status(message); if (fraction !== undefined) pack(fraction); });
      const capabilities=await fetch('/api/capabilities',{cache:'no-store'});
      if(!capabilities.ok)throw Error('Layanan build lokal tidak tersedia. Jalankan python server.py.');
      buildConfig=await capabilities.json();
      if(!buildConfig[target])throw Error('Build '+target.toUpperCase()+' belum tersedia di komputer ini.');
      status('Mengirim buku ke layanan build…');
      // The server keeps the build in the member's archive too.
      const archived = await archiveBook();
      const buildHeaders = {'Content-Type':'application/zip','X-Build-Token':buildConfig.token};
      if (archived) buildHeaders['X-Library-Book'] = archived;
      const sent = await FlipbookExport.upload('/api/build/'+target, bundle, buildHeaders, step(.12, .2));
      if(!sent.ok)throw Error(sent.data.error||'Build gagal dimulai.');
      // Server reports its stage (0..1); while the compiler runs, creep
      // toward the next stage so the bar keeps moving honestly.
      const building = step(.2, .9), started = Date.now(), tau = target === 'apk' ? 45000 : 20000;
      let job = {status: 'queued', progress: 0}, stageAt = Date.now(), stage = 0;
      while (job.status !== 'done') {
        await new Promise(resolve=>setTimeout(resolve,1000));
        const check=await fetch('/api/jobs/'+sent.data.id);if(!check.ok)throw Error('Status build tidak tersedia.');
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
      status('Menyimpan '+(target==='apk'?'APK':'EXE ZIP')+'…');
      const saved = await FlipbookExport.saveRemote(job.download, outputName, saveHandle, step(.9, 1));
      progress(1);
      // Keep a link to fetch the result again (e.g. another copy for a phone).
      const link=$('#build-download');link.href=job.download;link.textContent='Simpan salinan lagi…';link.hidden=false;
      let saving=false;
      link.onclick=async event=>{
        event.preventDefault();if(saving)return;saving=true;error('');
        try {
          const again = await FlipbookExport.chooseSave(outputName);
          const ok=await FlipbookExport.saveRemote(job.download,outputName,again);
          status(ok?'Salinan tersimpan di lokasi pilihanmu.':'File dikirim ke download browser.');
        } catch(cause) { if(cause.name==='AbortError')status('Penyimpanan dibatalkan.');else error('Gagal menyimpan: '+cause.message); }
        finally { saving=false; }
      };
      status((saved?(target==='apk'?'APK':'EXE ZIP')+' tersimpan di lokasi pilihanmu':'Hasil build dikirim ke download browser')+' ('+Math.round((Date.now()-started)/1000)+' detik).');
    } catch(cause) { progress(null); if(cause.name==='AbortError')status('Ekspor dibatalkan.');else { status('Ekspor gagal: '+cause.message); error(cause.message); } }
    finally { exporting=false;exportState();$('#pdf-file').disabled=false;$('#overlay-fields').disabled=!book; }
  }
  FlipbookSound.bindButton($('#sound'));
  $('#save-project').onclick=()=>exportBook('project');$('#export-html').onclick=()=>exportBook('html');
  $('#export-apk').onclick=()=>exportBook('apk');$('#export-exe').onclick=()=>exportBook('exe');
  fetch('/api/capabilities').then(async response=>{
    if(!response.ok)throw Error('Layanan build belum berjalan');
    buildConfig=await response.json();exportState();markLocked();
    $('#build-availability').textContent=buildConfig.apk||buildConfig.exe?'Build APK/EXE memakai komputer ini. Build pertama dapat memerlukan beberapa menit dan internet untuk dependensi.':'Flutter belum tersedia. Ekspor HTML dan simpan proyek tetap bisa digunakan.';
  }).catch(()=>{ $('#build-availability').textContent='Untuk build APK/EXE, jalankan server proyek dengan python server.py. Ekspor HTML tetap tersedia.'; });
  const fromLibrary = new URLSearchParams(location.search).get('library');
  if (/^[0-9a-f]{32}$/.test(fromLibrary || '')) {
    (async () => {
      try {
        archiveNote('☁ Membuka dari Arsipku…');
        const response = await fetch(`/api/library/${fromLibrary}/project`, {credentials:'same-origin'});
        if (!response.ok) throw Error(((await response.json().catch(() => ({}))).error) || 'Buku tidak bisa dibuka dari Arsipku.');
        const project = await FlipbookExport.readProject(await response.blob());
        openingLibraryId = fromLibrary;
        await openPdf(project.pdf, project.data.title + '.pdf', project.data);
        history.replaceState(null, '', location.pathname);
      } catch (cause) { openingLibraryId = null; archiveNote(cause.message, true); error(cause.message); }
    })();
  }
  const source = new URLSearchParams(location.search).get('source');
  if (source) {
    (async () => {
      try {
        const entry = await FlipbookTransfer.get(source);
        if (!entry) throw new Error('Hasil konversi tidak ditemukan. Pilih PDF atau konversi ulang.');
        if (await openPdf(entry.blob, entry.name)) {
          await FlipbookTransfer.remove(source);
          history.replaceState(null, '', location.pathname);
        }
      } catch (cause) { error(cause.message); }
    })();
  }
})();
