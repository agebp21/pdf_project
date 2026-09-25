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
  let sourcePdf = null, bookRatio = 1, exporting = false, buildConfig = null;
  function exportState() {
    $('#export-fields').disabled = !sourcePdf || opening || exporting;
    $('#export-apk').disabled = !buildConfig?.apk;
    $('#export-exe').disabled = !buildConfig?.exe;
    $('#project-file').disabled = opening || exporting;
  }
  const model = () => ({version:1,title:$('#export-title').value.trim()||'Buku interaktif',pageCount:pageElements.length,ratio:bookRatio,overlays:Object.fromEntries(overlays)});
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
    opening = true; $('#pdf-file').disabled = true; $('#overlay-fields').disabled = true;
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
      book = new St.PageFlip(container, {width, height:Math.round(width / ratio), size:'stretch', minWidth:230, maxWidth:500, minHeight:115, maxHeight:760, autoSize:true, usePortrait:true, startPage:0, showCover:true, ...FlipbookLayout.motion(reduced)});
      book.on('flip', updatePage); book.on('changeOrientation', () => { updatePage(); animate(true); });
      book.on('changeState', event => {
        if (event.data === 'read') { updatePage(); animate(true); }
        else { stopAnimation(); $('#home').disabled = $('#prev').disabled = $('#next').disabled = true; }
      });
      book.loadFromHTML(newElements);
      disposeLayout=FlipbookLayout.bind(book,$('#reader-stage'),ratio,{compact:true});
      sourcePdf = blob;
      $('#export-title').value = project ? project.title : name.replace(/\.pdf$/i,'');
      if (project) for (const [index,config] of Object.entries(project.overlays)) { overlays.set(Number(index),config); renderOverlay(Number(index),config); }
      $('#build-download').hidden = true;
      $('#document-name').textContent = name;
      $('#target-page').replaceChildren(...newElements.map((_, index) => {
        const option = document.createElement('option'); option.value = String(index); option.textContent = 'Page ' + (index + 1); return option;
      }));
      $('#load-status').textContent = `${newElements.length} pages ready. The first page is the front cover.`;
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
      $('#overlay-fields').disabled = !book; $('#replay').disabled = !book;
      if (book) updatePage();
      exportState();
    }
  }
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
    active: () => !!book && !opening && !exporting && book.getState() === 'read' && book.getCurrentPageIndex() > 0,
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
    try {
      const data = model(), name = FlipbookExport.filename(data.title);
      const outputName = target==='project' ? name+'.smflipbook' : name+'-HTML.zip';
      const saveHandle = target==='project'||target==='html' ? await FlipbookExport.chooseSave(outputName) : null;
      status('Menyiapkan ekspor…');
      if (target === 'project') {
        const saved=await FlipbookExport.saveBlob(await FlipbookExport.saveProject(data,sourcePdf),outputName,saveHandle);
        status(saved?'Proyek tersimpan di lokasi pilihanmu.':'Proyek dikirim ke download browser.');
      } else {
        const bundle = await FlipbookExport.packageBook(data,imageUrls,status);
        if (target === 'html') { const saved=await FlipbookExport.saveBlob(bundle,outputName,saveHandle); status((saved?'HTML tersimpan di lokasi pilihanmu. ':'HTML dikirim ke download browser. ')+'Ekstrak seluruh ZIP lalu buka index.html.'); }
        else {
          const capabilities=await fetch('/api/capabilities',{cache:'no-store'});
          if(!capabilities.ok)throw Error('Layanan build lokal tidak tersedia. Jalankan python server.py.');
          buildConfig=await capabilities.json();
          if(!buildConfig[target])throw Error('Build '+target.toUpperCase()+' belum tersedia di komputer ini.');
          status('Mengirim buku ke layanan build lokal…');
          const response=await fetch('/api/build/'+target,{method:'POST',headers:{'Content-Type':'application/zip','X-Build-Token':buildConfig.token},body:bundle});
          const result=await response.json(); if(!response.ok)throw Error(result.error||'Build gagal dimulai.');
          let complete=false;
          while(!complete) {
            await new Promise(resolve=>setTimeout(resolve,2000));
            const check=await fetch('/api/jobs/'+result.id);if(!check.ok)throw Error('Status build tidak tersedia.');
            const job=await check.json();status(job.message);
            if(job.status==='failed') {
              if(job.log) { const link=$('#build-download');link.onclick=null;link.href=job.log;link.textContent='Download log build';link.hidden=false; }
              throw Error(job.message);
            }
            if(job.status==='done') {
              complete=true; const link=$('#build-download');link.href=job.download;link.textContent=target==='apk'?'Simpan APK sebagai…':'Simpan EXE ZIP sebagai…';link.hidden=false;
              let saving=false;
              link.onclick=async event=>{
                event.preventDefault();if(saving)return;saving=true;error('');
                try {
                  const saved=await FlipbookExport.saveRemote(job.download,name+(target==='apk'?'.apk':'-Windows.zip'));
                  status(saved?'File tersimpan di lokasi pilihanmu.':'File dikirim ke download browser.');
                } catch(cause) { if(cause.name==='AbortError')status('Penyimpanan dibatalkan. Hasil build tetap tersedia.');else error('Gagal menyimpan: '+cause.message); }
                finally { saving=false; }
              };
              status('Build selesai. Klik Simpan sebagai untuk memilih lokasi.');
            }
          }
        }
      }
    } catch(cause) { if(cause.name==='AbortError')status('Penyimpanan dibatalkan.');else { status('Ekspor gagal: '+cause.message); error(cause.message); } }
    finally { exporting=false;exportState();$('#pdf-file').disabled=false;$('#overlay-fields').disabled=!book; }
  }
  $('#save-project').onclick=()=>exportBook('project');$('#export-html').onclick=()=>exportBook('html');
  $('#export-apk').onclick=()=>exportBook('apk');$('#export-exe').onclick=()=>exportBook('exe');
  fetch('/api/capabilities').then(async response=>{
    if(!response.ok)throw Error('Layanan build belum berjalan');
    buildConfig=await response.json();exportState();markLocked();
    $('#build-availability').textContent=buildConfig.apk||buildConfig.exe?'Build APK/EXE memakai komputer ini. Build pertama dapat memerlukan beberapa menit dan internet untuk dependensi.':'Flutter belum tersedia. Ekspor HTML dan simpan proyek tetap bisa digunakan.';
  }).catch(()=>{ $('#build-availability').textContent='Untuk build APK/EXE, jalankan server proyek dengan python server.py. Ekspor HTML tetap tersedia.'; });
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
