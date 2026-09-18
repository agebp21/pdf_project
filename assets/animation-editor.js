'use strict';
/* ════════════════════════════════════════════════════════════
   Flipbook Animation Editor — animation-editor.js
   Pendekatan: PDF jadi background, klik area → pilih zona →
   assign animasi. Tidak ada teks ganda/extract berantakan.
   ════════════════════════════════════════════════════════════ */
(() => {
  /* ─── Utilities ──────────────────────────────────────────── */
  const $ = s => document.querySelector(s);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const uid = () => 'el-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const HANDLES = ['tl','tc','tr','ml','mr','bl','bc','br'];

  /* ─── State ──────────────────────────────────────────────── */
  // elements: [{id, type, x, y, w, h, rotation, content, style, animation, link, isPdfZone}]
  // type: 'text' | 'hotspot' | 'pdfZone'
  // isPdfZone: true = dari PDF (tidak drag, hanya klik+animasi), false = buatan user (drag+edit)
  let pages      = {};      // {[pageIndex]: {elements:[]}}
  let pageCount  = 0;
  let currentPage = 0;
  let selectedId  = null;
  let pdfDoc      = null;
  let imageUrls   = [];     // object URL JPEG per halaman
  let pageVpInfo  = [];     // {canvasW, canvasH, pdfW, pdfH, scale} per halaman
  let mode = 'edit';
  let loading  = false;
  let exporting = false;
  let sourceName = '';

  /* ─── DOM refs ───────────────────────────────────────────── */
  let stageEl = null;
  let wrapEl  = null;
  let stripEl = null;

  /* ─── Model helpers ──────────────────────────────────────── */
  function getPage(i)  { if (!pages[i]) pages[i] = { elements: [] }; return pages[i]; }
  function getEls(i)   { return getPage(i).elements; }
  function findEl(id)  { return getEls(currentPage).find(e => e.id === id); }

  /* ─── Default element factories ─────────────────────────── */
  function makeCustomEl(type, x = 28, y = 38) {
    const hot = type === 'hotspot';
    return {
      id: uid(), type, isPdfZone: false,
      x, y, w: hot ? 28 : 44, h: hot ? 7 : 9, rotation: 0,
      content: hot ? 'Click here →' : 'Your text',
      style: {
        fontSize: 18,
        color:   hot ? '#ffffff' : '#1a1a1a',
        bold:    hot, italic: false,
        align:   hot ? 'center' : 'left',
        bgColor: hot ? '#4a7c59' : '',
        opacity: 1,
      },
      animation: { type: 'fadeIn', delay: 0, duration: 600 },
      link: null,
    };
  }

  function makePdfZone(x, y, w, h, text) {
    return {
      id: uid(), type: 'pdfZone', isPdfZone: true,
      x, y, w, h, rotation: 0,
      content: text || '',
      style: { fontSize: 0, color: 'transparent', bold: false, italic: false, align: 'left', bgColor: 'transparent', opacity: 1 },
      animation: { type: 'fadeIn', delay: 0, duration: 600 },
      link: null,
    };
  }

  /* ════════════════════════════════════════════════════════════
     RENDER STAGE (edit mode)
     ════════════════════════════════════════════════════════════ */
  function renderStage() {
    if (!stageEl) return;
    stageEl.querySelectorAll('.ae-el, .ae-pdf-zone, .ae-page-hint').forEach(e => e.remove());
    const els = getEls(currentPage);
    if (els.length === 0) {
      const h = document.createElement('div');
      h.className = 'ae-page-hint';
      h.innerHTML = '<span>✦</span><p>Click "Load page content" to make PDF elements selectable,<br>or use ✦ Text / ✦ Button to add new elements.</p>';
      stageEl.append(h);
    } else {
      els.forEach(el => {
        if (el.isPdfZone) stageEl.append(buildPdfZone(el));
        else stageEl.append(buildCustomEl(el));
      });
    }
    select(null);
  }

  /* ─── Build: PDF Zone (klik saja, tidak drag) ─────────────── */
  function buildPdfZone(el) {
    const div = document.createElement('div');
    div.className = 'ae-pdf-zone';
    div.dataset.id = el.id;
    applyPdfZonePos(div, el);
    // Show content as tooltip
    if (el.content) div.title = el.content;
    // Animasi badge
    if (el.animation?.type && el.animation.type !== 'none') {
      const badge = document.createElement('span');
      badge.className = 'ae-zone-badge';
      badge.textContent = el.animation.type;
      div.append(badge);
    }
    div.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      select(el.id);
    });
    return div;
  }

  function applyPdfZonePos(div, el) {
    div.style.left   = el.x + '%';
    div.style.top    = el.y + '%';
    div.style.width  = el.w + '%';
    div.style.height = el.h + '%';
  }

  /* ─── Build: Custom Element (drag+resize+rotate) ──────────── */
  function buildCustomEl(el) {
    const div = document.createElement('div');
    div.className = `ae-el ae-${el.type}`;
    div.dataset.id = el.id;
    applyCustomStyle(div, el);

    const span = document.createElement('span');
    span.className = 'ae-el-content';
    span.textContent = el.content;
    div.append(span);

    HANDLES.forEach(p => {
      const h = document.createElement('div');
      h.className = 'ae-handle'; h.dataset.p = p; div.append(h);
    });
    const rot = document.createElement('div');
    rot.className = 'ae-rotate'; rot.textContent = '↻'; div.append(rot);

    bindCustomEl(div);
    return div;
  }

  function applyCustomStyle(div, el, stageH) {
    div.style.left      = el.x + '%';
    div.style.top       = el.y + '%';
    div.style.width     = el.w + '%';
    div.style.height    = el.h + '%';
    div.style.transform = el.rotation ? `rotate(${el.rotation}deg)` : '';
    const s = el.style;
    const ref = stageH || stageEl?.getBoundingClientRect().height || 600;
    div.style.fontSize   = ((s.fontSize / 18) * (ref * 0.033)) + 'px';
    div.style.color      = s.color   || '';
    div.style.fontWeight = s.bold    ? '700' : '400';
    div.style.fontStyle  = s.italic  ? 'italic' : '';
    div.style.textAlign  = s.align   || 'left';
    div.style.background = s.bgColor || 'transparent';
    div.style.opacity    = s.opacity != null ? s.opacity : 1;
  }

  /* ─── Interactions ───────────────────────────────────────── */
  function bindCustomEl(div) {
    div.addEventListener('pointerdown', e => {
      if (e.target.classList.contains('ae-handle') || e.target.classList.contains('ae-rotate')) return;
      if (div.classList.contains('ae-editing')) return;
      e.stopPropagation(); e.preventDefault();
      select(div.dataset.id);
      startDrag(div, e);
    });
    div.addEventListener('dblclick', e => {
      if (e.target.classList.contains('ae-handle') || e.target.classList.contains('ae-rotate')) return;
      e.stopPropagation(); startTextEdit(div);
    });
    div.querySelectorAll('.ae-handle').forEach(h => {
      h.addEventListener('pointerdown', e => {
        e.stopPropagation(); e.preventDefault();
        select(div.dataset.id); startResize(div, h.dataset.p, e);
      });
    });
    div.querySelector('.ae-rotate')?.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      select(div.dataset.id); startRotate(div, e);
    });
  }

  function startDrag(div, ev) {
    const rect = stageEl.getBoundingClientRect();
    const el = findEl(div.dataset.id); if (!el) return;
    const ox = el.x, oy = el.y, sx = ev.clientX, sy = ev.clientY;
    const move = e => {
      el.x = clamp(ox + (e.clientX - sx) / rect.width  * 100, 0, 100 - el.w);
      el.y = clamp(oy + (e.clientY - sy) / rect.height * 100, 0, 100 - el.h);
      div.style.left = el.x + '%'; div.style.top = el.y + '%';
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); updateStrip(); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  function startResize(div, pos, ev) {
    const rect = stageEl.getBoundingClientRect();
    const el = findEl(div.dataset.id); if (!el) return;
    const { x: ox, y: oy, w: ow, h: oh } = el;
    const sx = ev.clientX, sy = ev.clientY;
    const move = e => {
      const dx = (e.clientX - sx) / rect.width * 100, dy = (e.clientY - sy) / rect.height * 100;
      let nx = ox, ny = oy, nw = ow, nh = oh;
      if (pos.includes('l')) { nx = clamp(ox+dx, 0, ox+ow-4); nw = ox+ow-nx; }
      if (pos.includes('r')) { nw = clamp(ow+dx, 4, 100-ox); }
      if (pos.includes('t')) { ny = clamp(oy+dy, 0, oy+oh-3); nh = oy+oh-ny; }
      if (pos.includes('b')) { nh = clamp(oh+dy, 3, 100-oy); }
      el.x = nx; el.y = ny; el.w = nw; el.h = nh;
      div.style.left = nx+'%'; div.style.top = ny+'%'; div.style.width = nw+'%'; div.style.height = nh+'%';
      const h = stageEl.getBoundingClientRect().height;
      div.style.fontSize = ((el.style.fontSize/18)*(h*0.033))+'px';
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  function startRotate(div, ev) {
    const el = findEl(div.dataset.id); if (!el) return;
    const r = div.getBoundingClientRect();
    const cx = r.left+r.width/2, cy = r.top+r.height/2;
    const a0 = Math.atan2(ev.clientY-cy, ev.clientX-cx)*180/Math.PI;
    const or = el.rotation || 0;
    const move = e => { el.rotation = Math.round(or+Math.atan2(e.clientY-cy,e.clientX-cx)*180/Math.PI-a0); div.style.transform = `rotate(${el.rotation}deg)`; };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  function startTextEdit(div) {
    const el = findEl(div.dataset.id); if (!el) return;
    div.classList.add('ae-editing');
    const span = div.querySelector('.ae-el-content');
    span.contentEditable = 'true'; span.focus();
    const range = document.createRange();
    range.selectNodeContents(span); getSelection().removeAllRanges(); getSelection().addRange(range);
    const finish = () => {
      span.contentEditable = 'false'; div.classList.remove('ae-editing');
      el.content = span.textContent; updateInspector();
      span.removeEventListener('blur', finish); span.removeEventListener('keydown', onKey);
    };
    const onKey = e => { if (e.key === 'Escape') { span.textContent = el.content; finish(); } };
    span.addEventListener('blur', finish);
    span.addEventListener('keydown', onKey);
  }

  /* ─── Selection ──────────────────────────────────────────── */
  function select(id) {
    if (selectedId === id) return;
    // deselect old
    const old = stageEl?.querySelector(`[data-id="${selectedId}"]`);
    old?.classList.remove('selected');
    selectedId = id;
    if (id) stageEl?.querySelector(`[data-id="${id}"]`)?.classList.add('selected');
    updateInspector();
  }

  /* ════════════════════════════════════════════════════════════
     PDF TEXT LAYER — posisi akurat pakai viewport transform
     ════════════════════════════════════════════════════════════ */
  async function loadPageTextLayer(pageIndex) {
    if (!pdfDoc) return;
    const info = pageVpInfo[pageIndex];
    if (!info) { setError('Render PDF first.'); return; }

    setStatus(`Loading text zones for page ${pageIndex + 1}…`);

    // Hapus zona PDF lama di halaman ini
    const existing = getEls(pageIndex);
    const withoutZones = existing.filter(e => !e.isPdfZone);
    pages[pageIndex] = { elements: withoutZones };

    try {
      const page = await pdfDoc.getPage(pageIndex + 1);
      const vp = page.getViewport({ scale: info.scale });
      const content = await page.getTextContent();

      // Kumpulkan item dengan posisi akurat
      const rawItems = [];
      for (const item of content.items) {
        if (!item.str?.trim()) continue;
        // Pakai viewport transform untuk konversi koordinat PDF → canvas
        const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
        // tx[4]=canvas x, tx[5]=canvas y (baseline dari atas)
        const fontSize = Math.abs(tx[3]); // tinggi font dalam px canvas
        const cx = tx[4];
        const cy = tx[5] - fontSize; // top of text
        const cw = item.width * info.scale;
        const ch = fontSize * 1.3;
        if (cx < -cw || cy < -ch || cx > info.canvasW * 1.1 || cy > info.canvasH * 1.1) continue;
        rawItems.push({
          text: item.str.trim(),
          cx: clamp(cx, 0, info.canvasW),
          cy: clamp(cy, 0, info.canvasH),
          cw, ch, fontSize,
        });
      }

      // Gabungkan item pada baris yang sama (Y ± toleransi)
      const lines = mergeIntoLines(rawItems, info.canvasH * 0.015);

      // Buat pdfZone per baris
      let added = 0;
      for (const ln of lines) {
        const xPct = (ln.cx / info.canvasW) * 100;
        const yPct = (ln.cy / info.canvasH) * 100;
        const wPct = clamp((ln.cw / info.canvasW) * 100, 2, 98 - xPct);
        const hPct = clamp((ln.ch / info.canvasH) * 100, 1, 15);
        if (xPct < 0 || yPct < 0 || xPct > 99) continue;
        const zone = makePdfZone(
          parseFloat(xPct.toFixed(2)),
          parseFloat(yPct.toFixed(2)),
          parseFloat(wPct.toFixed(2)),
          parseFloat(hPct.toFixed(2)),
          ln.text,
        );
        getEls(pageIndex).push(zone);
        added++;
      }

      page.cleanup();
      setStatus(`Page ${pageIndex + 1}: ${added} text zone(s) loaded. Click a zone to select, then assign animation.`);
    } catch (err) {
      setError('Text load failed: ' + err.message);
      setStatus('');
    }

    if (pageIndex === currentPage) {
      renderStage(); select(null); updateStrip();
    }
  }

  /* ─── Gabungkan raw items → baris teks ─────────────────────── */
  function mergeIntoLines(items, yTol) {
    const lines = [];
    for (const item of items) {
      // Cari baris dengan Y serupa dan X berdekatan
      const existing = lines.find(l =>
        Math.abs(l.cy - item.cy) < yTol &&
        item.cx >= l.cx - 5 &&
        item.cx <= l.cx + l.cw + l.ch * 3 // tidak terlalu jauh ke kanan
      );
      if (existing) {
        existing.text += ' ' + item.text;
        const right = Math.max(existing.cx + existing.cw, item.cx + item.cw);
        existing.cx  = Math.min(existing.cx, item.cx);
        existing.cw  = right - existing.cx;
        existing.cy  = Math.min(existing.cy, item.cy);
        existing.ch  = Math.max(existing.ch, item.ch);
      } else {
        lines.push({ ...item });
      }
    }
    // Urutkan atas→bawah, kiri→kanan
    lines.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
    return lines;
  }

  /* ─── Load all pages text layer ─────────────────────────── */
  async function loadAllTextLayers() {
    if (!pdfDoc) return;
    $('#ae-load-all').disabled = true;
    for (let i = 0; i < pageCount; i++) {
      await loadPageTextLayer(i);
    }
    renderStage(); updateStrip();
    setStatus(`All ${pageCount} pages loaded. Click zones to assign animations.`);
    updateButtons();
  }

  /* ════════════════════════════════════════════════════════════
     OPEN PDF
     ════════════════════════════════════════════════════════════ */
  async function openPdf(blob, name) {
    if (loading) return;
    loading = true; setStatus('Reading PDF…'); setError(''); updateButtons();
    const newUrls = [], newVpInfo = [];
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
      const task = pdfjsLib.getDocument({ data: await blob.arrayBuffer(), isEvalSupported: false });
      const doc = await task.promise;

      for (let i = 1; i <= doc.numPages; i++) {
        setStatus(`Rendering page ${i} / ${doc.numPages}…`);
        const page = await doc.getPage(i);
        const vp0 = page.getViewport({ scale: 1 });
        const scale = Math.min(1.6, 1200 / Math.max(vp0.width, vp0.height));
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        const imgBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.88));
        if (!imgBlob) throw new Error('Page render failed.');
        newUrls.push(URL.createObjectURL(imgBlob));
        newVpInfo.push({ scale, canvasW: canvas.width, canvasH: canvas.height, pdfW: vp0.width, pdfH: vp0.height });
        page.cleanup(); canvas.width = canvas.height = 0;
      }

      if (pdfDoc) await pdfDoc.destroy().catch(() => {});
      imageUrls.forEach(u => URL.revokeObjectURL(u));
      imageUrls = newUrls; pageVpInfo = newVpInfo;
      pdfDoc = doc; pageCount = doc.numPages;
      pages = {}; currentPage = 0; selectedId = null; sourceName = name;

      // Setup canvas area DOM
      const scroll = $('.ae-canvas-scroll');
      if (scroll) {
        scroll.innerHTML = '';
        const wrap = document.createElement('div'); wrap.className = 'ae-page-wrap'; wrap.id = 'ae-page-wrap';
        const img = document.createElement('img'); img.className = 'ae-page-img'; img.draggable = false;
        const stage = document.createElement('div'); stage.className = 'ae-stage'; stage.id = 'ae-stage';
        wrap.append(img, stage); scroll.append(wrap);
        stageEl = stage; wrapEl = wrap;
        stage.addEventListener('pointerdown', e => { if (e.target === stage) select(null); });
        img.addEventListener('load', resizeWrap);
      } else {
        stageEl = $('#ae-stage'); wrapEl = $('#ae-page-wrap');
      }

      updateEditorImage();
      buildStrip();
      renderStage();
      resizeWrap();
      updatePageLabel();
      setStatus(`${pageCount} page(s) ready. Click "Load page content" to make elements selectable.`);

    } catch (err) {
      newUrls.forEach(u => URL.revokeObjectURL(u));
      setError('Cannot open PDF: ' + (err.message || err));
      setStatus('');
    } finally {
      loading = false; updateButtons();
    }
  }

  /* ════════════════════════════════════════════════════════════
     INSPECTOR
     ════════════════════════════════════════════════════════════ */
  function updateInspector() {
    const el = selectedId ? findEl(selectedId) : null;
    const panel = $('#ae-inspector');
    const hint  = $('#ae-inspector-hint');
    if (!panel) return;
    panel.classList.toggle('hidden', !el);
    if (hint) hint.style.display = el ? 'none' : '';
    if (!el) return;

    const isPdf = !!el.isPdfZone;

    // Toggle content + style sections
    const contentSec = $('#ae-insp-content-sec');
    const styleSec   = $('#ae-insp-style-sec');
    const zoneInfo   = $('#ae-zone-content-info');
    if (contentSec) contentSec.classList.toggle('ae-hidden-row', isPdf);
    if (styleSec)   styleSec.classList.toggle('ae-hidden-row',   isPdf);
    if (zoneInfo) {
      zoneInfo.style.display = isPdf ? '' : 'none';
      if (isPdf) zoneInfo.textContent = el.content ? `"${el.content.slice(0, 100)}${el.content.length > 100 ? '…' : ''}"` : '(empty)';
    }

    if (!isPdf) {
      v('#ae-i-content', el.content);
      v('#ae-i-fs',      el.style.fontSize);
      v('#ae-i-color',   el.style.color || '#1a1a1a');
      v('#ae-i-bgcolor', el.style.bgColor || '#ffffff');
      v('#ae-i-opacity', Math.round((el.style.opacity ?? 1) * 100));
      $('#ae-i-bold')  ?.classList.toggle('on', el.style.bold);
      $('#ae-i-italic')?.classList.toggle('on', el.style.italic);
      ['left','center','right'].forEach(a => $(`#ae-i-align-${a}`)?.classList.toggle('on', el.style.align === a));
    }

    v('#ae-i-anim-type',  el.animation.type);
    v('#ae-i-anim-delay', el.animation.delay);
    v('#ae-i-anim-dur',   el.animation.duration);
    const lt = el.link?.type || 'none';
    v('#ae-i-link-type', lt);
    v('#ae-i-link-url',  lt === 'url'  ? el.link.target : '');
    v('#ae-i-link-page', lt === 'page' ? el.link.target : '');
    $('#ae-i-link-url-row') ?.classList.toggle('ae-hidden-row', lt !== 'url');
    $('#ae-i-link-page-row')?.classList.toggle('ae-hidden-row', lt !== 'page');
  }

  function v(id, val) { const n = $(id); if (n) n.value = val; }

  function bindInspector() {
    function patchStyle(patch) {
      const el = selectedId ? findEl(selectedId) : null; if (!el || el.isPdfZone) return;
      Object.assign(el.style, patch);
      const div = stageEl?.querySelector(`[data-id="${selectedId}"]`);
      if (div) applyCustomStyle(div, el);
    }
    function patchElContent(val) {
      const el = selectedId ? findEl(selectedId) : null; if (!el || el.isPdfZone) return;
      el.content = val;
      const span = stageEl?.querySelector(`[data-id="${selectedId}"] .ae-el-content`);
      if (span) span.textContent = val;
    }
    function patchAnim(patch) {
      const el = selectedId ? findEl(selectedId) : null; if (!el) return;
      Object.assign(el.animation, patch);
      // Update badge on pdf zones
      if (el.isPdfZone) {
        const div = stageEl?.querySelector(`[data-id="${selectedId}"]`);
        if (div) {
          let badge = div.querySelector('.ae-zone-badge');
          if (el.animation.type !== 'none') {
            if (!badge) { badge = document.createElement('span'); badge.className = 'ae-zone-badge'; div.append(badge); }
            badge.textContent = el.animation.type;
          } else { badge?.remove(); }
        }
      }
    }
    function applyLink() {
      const el = selectedId ? findEl(selectedId) : null; if (!el) return;
      const lt = $('#ae-i-link-type')?.value || 'none';
      $('#ae-i-link-url-row') ?.classList.toggle('ae-hidden-row', lt !== 'url');
      $('#ae-i-link-page-row')?.classList.toggle('ae-hidden-row', lt !== 'page');
      if (lt === 'none')       el.link = null;
      else if (lt === 'url')   el.link = { type: 'url',  target: $('#ae-i-link-url')?.value  || '' };
      else if (lt === 'page')  el.link = { type: 'page', target: Number($('#ae-i-link-page')?.value || 1) };
    }

    on('#ae-i-content',    'input',  e => patchElContent(e.target.value));
    on('#ae-i-fs',         'input',  e => patchStyle({ fontSize: Number(e.target.value) }));
    on('#ae-i-color',      'input',  e => patchStyle({ color: e.target.value }));
    on('#ae-i-bgcolor',    'input',  e => patchStyle({ bgColor: e.target.value }));
    on('#ae-i-opacity',    'input',  e => patchStyle({ opacity: Number(e.target.value) / 100 }));
    on('#ae-i-bold',   'click', () => { const el = selectedId ? findEl(selectedId) : null; if (el && !el.isPdfZone) { patchStyle({ bold: !el.style.bold }); $('#ae-i-bold')?.classList.toggle('on', el.style.bold); } });
    on('#ae-i-italic', 'click', () => { const el = selectedId ? findEl(selectedId) : null; if (el && !el.isPdfZone) { patchStyle({ italic: !el.style.italic }); $('#ae-i-italic')?.classList.toggle('on', el.style.italic); } });
    ['left','center','right'].forEach(a => on(`#ae-i-align-${a}`, 'click', () => {
      patchStyle({ align: a }); ['left','center','right'].forEach(b => $(`#ae-i-align-${b}`)?.classList.toggle('on', b === a));
    }));
    on('#ae-i-anim-type',  'change', e => patchAnim({ type: e.target.value }));
    on('#ae-i-anim-delay', 'input',  e => patchAnim({ delay: Number(e.target.value) }));
    on('#ae-i-anim-dur',   'input',  e => patchAnim({ duration: Number(e.target.value) }));
    on('#ae-i-link-type',  'change', applyLink);
    on('#ae-i-link-url',   'input',  applyLink);
    on('#ae-i-link-page',  'input',  applyLink);
  }

  function on(sel, ev, fn) { $(sel)?.addEventListener(ev, fn); }

  /* ════════════════════════════════════════════════════════════
     PAGE STRIP & NAVIGATION
     ════════════════════════════════════════════════════════════ */
  function buildStrip() {
    if (!stripEl) return;
    stripEl.innerHTML = '';
    for (let i = 0; i < pageCount; i++) {
      const btn = document.createElement('button');
      btn.className = 'ae-strip-btn' + (i === currentPage ? ' active' : '');
      btn.type = 'button'; btn.title = `Page ${i + 1}`; btn.textContent = i + 1;
      if ((pages[i]?.elements?.length || 0) > 0) { const dot = document.createElement('span'); dot.className = 'ae-dot'; btn.append(dot); }
      btn.addEventListener('click', () => { if (i !== currentPage) goPage(i); });
      stripEl.append(btn);
    }
  }

  function updateStrip() {
    stripEl?.querySelectorAll('.ae-strip-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === currentPage);
      const hasDot = btn.querySelector('.ae-dot');
      const hasEls = (pages[i]?.elements?.length || 0) > 0;
      if (hasEls && !hasDot) { const d = document.createElement('span'); d.className = 'ae-dot'; btn.append(d); }
      else if (!hasEls && hasDot) hasDot.remove();
    });
  }

  function goPage(i) {
    if (i < 0 || i >= pageCount) return;
    currentPage = i;
    updateEditorImage();
    if (mode === 'edit') renderStage();
    else playPreview(i);
    select(null);
    updateStrip();
    updatePageLabel();
    updateNavButtons();
  }

  function updatePageLabel() {
    const el = $('#ae-page-label');
    if (el) el.textContent = pageCount ? `Page ${currentPage + 1} of ${pageCount}` : '';
  }

  function updateEditorImage() {
    const img = wrapEl?.querySelector('.ae-page-img');
    if (img && imageUrls[currentPage]) { img.src = imageUrls[currentPage]; img.alt = `Page ${currentPage + 1}`; }
  }

  function updateNavButtons() {
    const prev = $('#ae-prev'), next = $('#ae-next');
    if (prev) prev.disabled = currentPage === 0;
    if (next) next.disabled = currentPage === pageCount - 1;
  }

  function resizeWrap() {
    if (!wrapEl || !pageCount) return;
    const area = $('.ae-canvas-scroll'); if (!area) return;
    const availW = area.clientWidth - 48, availH = area.clientHeight - 48;
    const img = wrapEl.querySelector('.ae-page-img');
    const ratio = img?.naturalWidth && img?.naturalHeight ? img.naturalWidth / img.naturalHeight : 0.707;
    let w = availW, h = w / ratio;
    if (h > availH) { h = availH; w = h * ratio; }
    wrapEl.style.width = Math.round(w) + 'px'; wrapEl.style.height = Math.round(h) + 'px';
    stageEl?.querySelectorAll('.ae-el').forEach(div => {
      const el = findEl(div.dataset.id); if (el) applyCustomStyle(div, el, h);
    });
  }
  window.addEventListener('resize', () => { if (mode === 'edit') resizeWrap(); });

  function updateButtons() {
    const ready = pageCount > 0;
    if ($('#ae-add-text'))    $('#ae-add-text').disabled    = !ready;
    if ($('#ae-add-hotspot')) $('#ae-add-hotspot').disabled = !ready;
    if ($('#ae-load-page'))   $('#ae-load-page').disabled   = !ready || !pdfDoc;
    if ($('#ae-load-all'))    $('#ae-load-all').disabled    = !ready || !pdfDoc;
    if ($('#ae-export'))      $('#ae-export').disabled      = !ready || exporting;
    if ($('#ae-delete-btn'))  $('#ae-delete-btn').disabled  = !selectedId;
  }

  /* ════════════════════════════════════════════════════════════
     MODE: EDIT ↔ PREVIEW
     ════════════════════════════════════════════════════════════ */
  function setMode(m) {
    mode = m;
    $('#ae-mode-edit')   ?.classList.toggle('active', m === 'edit');
    $('#ae-mode-preview')?.classList.toggle('active', m === 'preview');
    if (!stageEl) return;
    if (m === 'edit') {
      stageEl.querySelectorAll('.ae-prev-el').forEach(e => e.remove());
      renderStage();
      stageEl.style.pointerEvents = '';
    } else {
      stageEl.querySelectorAll('.ae-el, .ae-pdf-zone, .ae-page-hint').forEach(e => e.remove());
      select(null);
      playPreview(currentPage);
    }
    updateNavButtons();
  }

  function playPreview(index) {
    if (!stageEl) return;
    stageEl.querySelectorAll('.ae-prev-el').forEach(e => e.remove());
    const reduced = matchMedia('(prefers-reduced-motion:reduce)').matches;
    const stageH  = stageEl.getBoundingClientRect().height || 600;
    getEls(index).forEach(el => {
      const div = document.createElement('div');
      div.className = `ae-prev-el ae-${el.type}`;
      div.style.left = el.x + '%'; div.style.top  = el.y + '%';
      div.style.width= el.w + '%'; div.style.height= el.h + '%';
      if (el.rotation) div.style.transform = `rotate(${el.rotation}deg)`;

      if (el.isPdfZone) {
        // PDF zona: tampil sebagai highlight semi-transparan
        div.style.background = 'rgba(74,124,89,0.18)';
        div.style.border = '2px solid rgba(74,124,89,0.5)';
        div.style.borderRadius = '2px';
        div.style.boxSizing = 'border-box';
      } else {
        const s = el.style;
        div.style.fontSize   = ((s.fontSize/18)*(stageH*0.033))+'px';
        div.style.color      = s.color   || '';
        div.style.fontWeight = s.bold    ? '700' : '400';
        div.style.fontStyle  = s.italic  ? 'italic' : '';
        div.style.textAlign  = s.align   || 'left';
        div.style.background = s.bgColor || 'transparent';
        div.style.padding    = '3px 6px';
        div.style.boxSizing  = 'border-box';
        div.style.lineHeight = '1.35';
        div.style.wordBreak  = 'break-word';
        if (el.type === 'hotspot') { div.style.borderRadius = '6px'; div.style.display = 'flex'; div.style.alignItems = 'center'; div.style.justifyContent = 'center'; }
        div.textContent = el.content;
      }

      // Link
      if (el.link) {
        div.classList.add('ae-prev-link');
        div.addEventListener('click', e => {
          e.stopPropagation();
          if (el.link.type === 'url' && el.link.target) window.open(el.link.target, '_blank', 'noopener,noreferrer');
          else if (el.link.type === 'page') goPage(Number(el.link.target) - 1);
        });
      }

      // Animation
      const anim = el.animation?.type, delay = el.animation?.delay ?? 0, dur = el.animation?.duration ?? 600;
      if (anim && anim !== 'none') {
        setTimeout(() => { div.style.setProperty('--ae-dur', dur+'ms'); div.classList.add('ae-prev-animated','ae-anim-'+anim); }, reduced ? 0 : delay);
      } else { div.classList.add('ae-prev-animated'); }

      stageEl.append(div);
    });
  }

  /* ════════════════════════════════════════════════════════════
     ACTIONS: ADD / DELETE
     ════════════════════════════════════════════════════════════ */
  function addCustomEl(type) {
    if (!pageCount) return;
    if (mode !== 'edit') setMode('edit');
    const el = makeCustomEl(type);
    getEls(currentPage).push(el);
    stageEl?.querySelector('.ae-page-hint')?.remove();
    stageEl?.append(buildCustomEl(el));
    select(el.id);
    updateStrip();
  }

  function deleteSelected() {
    if (!selectedId) return;
    const idx = getEls(currentPage).findIndex(e => e.id === selectedId);
    if (idx !== -1) getEls(currentPage).splice(idx, 1);
    stageEl?.querySelector(`[data-id="${selectedId}"]`)?.remove();
    select(null);
    if (getEls(currentPage).length === 0) renderStage();
    updateStrip();
  }

  function clearPdfZones() {
    const els = getEls(currentPage);
    const custom = els.filter(e => !e.isPdfZone);
    pages[currentPage] = { elements: custom };
    renderStage(); select(null); updateStrip();
    setStatus('PDF zones cleared from this page.');
  }

  /* ════════════════════════════════════════════════════════════
     EXPORT: HTML ZIP dengan PageFlip engine
     ════════════════════════════════════════════════════════════ */
  async function exportHTML() {
    if (!pageCount || exporting) return;
    exporting = true; updateButtons(); setStatus('Preparing export…'); setError('');
    try {
      const title = $('#ae-title')?.value.trim() || sourceName.replace(/\.pdf$/i,'') || 'Flipbook';
      const info  = pageVpInfo[0];
      const ratio = info ? info.pdfW / info.pdfH : 0.707;

      // Build pages model (clean copy, no isPdfZone flag needed by viewer)
      const pagesData = {};
      for (const [k, v2] of Object.entries(pages)) {
        if (!v2?.elements?.length) continue;
        pagesData[k] = {
          elements: v2.elements.map(e => ({
            id: e.id, type: e.isPdfZone ? 'pdfZone' : e.type,
            x: e.x, y: e.y, w: e.w, h: e.h, rotation: e.rotation,
            content: e.content,
            style: { ...e.style },
            animation: { ...e.animation },
            link: e.link ? { ...e.link } : null,
          })),
        };
      }
      const data = { version: 2, title, pageCount, ratio, overlays: {}, pages: pagesData };

      const zip = new JSZip();
      const txt = async p => { const r = await fetch(p); if (!r.ok) throw Error('Missing: ' + p); return r.text(); };
      const bin = async p => { const r = await fetch(p); if (!r.ok) throw Error('Missing: ' + p); return r.arrayBuffer(); };

      for (const f of ['index.html','viewer.css','book-effects.css','layout.js','viewer.js'])
        zip.file(f, await txt('assets/export/' + f));
      zip.file('page-flip.browser.js', await bin('assets/vendor/page-flip.browser.js'));
      zip.file('ENGINE-SOURCE.md',     await txt('assets/vendor/SOURCE.md'));
      zip.file('PAGEFLIP-LICENSE.txt', await txt('assets/vendor/PAGEFLIP-LICENSE.txt'));
      zip.file('animation-editor.css', await txt('assets/animation-editor.css'));

      const script = 'window.FLIPBOOK_DATA = ' +
        JSON.stringify(data).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029') + ';\n';
      zip.file('book-data.js', script);
      zip.file('book.json',    JSON.stringify(data, null, 2));
      zip.file('BUKA-BUKU.txt','Extract all files, then open index.html in a browser.\nNo internet required.\n');

      for (let i = 0; i < imageUrls.length; i++) {
        setStatus(`Packaging page ${i + 1} / ${imageUrls.length}…`);
        const r = await fetch(imageUrls[i]); if (!r.ok) throw Error('Page image unavailable.');
        zip.file(`pages/${i + 1}.jpg`, await r.arrayBuffer());
      }

      setStatus('Creating ZIP…');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, m => setStatus(`Compressing ${Math.round(m.percent)}%…`));

      const safeTitle = title.replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-|-$/g,'').slice(0,80) || 'flipbook';
      const filename = safeTitle + '-interactive.zip';
      let saved = false;
      if (typeof globalThis.showSaveFilePicker === 'function') {
        try {
          const h = await globalThis.showSaveFilePicker({ suggestedName: filename, types: [{ description:'ZIP', accept:{'application/zip':['.zip']} }] });
          const w = await h.createWritable(); await w.write(blob); await w.close(); saved = true;
        } catch (e) { if (e.name !== 'AbortError') throw e; }
      }
      if (!saved) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      setStatus('Export done! Extract the ZIP and open index.html.');
    } catch (err) {
      setError('Export failed: ' + (err.message || err)); setStatus('');
    } finally {
      exporting = false; updateButtons();
    }
  }

  /* ════════════════════════════════════════════════════════════
     STATUS HELPERS
     ════════════════════════════════════════════════════════════ */
  function setStatus(msg) { const el = $('#ae-status'); if (el) el.textContent = msg; }
  function setError(msg)  {
    const el = $('#ae-error'); if (!el) return;
    el.textContent = msg; el.classList.toggle('visible', !!msg);
  }

  /* ════════════════════════════════════════════════════════════
     INIT
     ════════════════════════════════════════════════════════════ */
  function init() {
    stripEl = $('#ae-strip');

    on('#ae-pdf-file',    'change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) openPdf(f, f.name); });
    on('#ae-mode-edit',   'click',  () => { if (mode !== 'edit')    setMode('edit');    });
    on('#ae-mode-preview','click',  () => { if (mode !== 'preview') setMode('preview'); });
    on('#ae-add-text',    'click',  () => addCustomEl('text'));
    on('#ae-add-hotspot', 'click',  () => addCustomEl('hotspot'));
    on('#ae-load-page',   'click',  () => { if (pdfDoc) loadPageTextLayer(currentPage); });
    on('#ae-load-all',    'click',  () => loadAllTextLayers());
    on('#ae-delete-btn',  'click',  () => deleteSelected());
    on('#ae-clear-zones', 'click',  () => clearPdfZones());
    on('#ae-prev',        'click',  () => goPage(currentPage - 1));
    on('#ae-next',        'click',  () => goPage(currentPage + 1));
    on('#ae-export',      'click',  () => exportHTML());

    bindInspector();

    document.addEventListener('keydown', e => {
      if (e.target.closest('input,textarea,select,[contenteditable]')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteSelected(); }
      if (e.key === 'Escape') select(null);
    });

    updateButtons();
    setStatus('Upload a PDF to get started.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
