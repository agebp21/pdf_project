'use strict';
/* ════════════════════════════════════════════════════════════
   Flipbook Animation Editor — animation-editor.js
   Standalone Canva-like editor: PDF import, text extraction,
   drag/resize/rotate elements, CSS animations, links, export
   ════════════════════════════════════════════════════════════ */
(() => {
  /* ─── Utilities ────────────────────────────────────────── */
  const $ = s => document.querySelector(s);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const uid = () => 'el-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const HANDLES = ['tl','tc','tr','ml','mr','bl','bc','br'];
  const ANIM_TYPES = ['none','fadeIn','slideUp','slideDown','slideLeft','slideRight','zoomIn','bounce','pulse'];

  /* ─── State ────────────────────────────────────────────── */
  let pages = {};         // {[pageIndex]: {elements:[]}}
  let pageCount = 0;
  let currentPage = 0;
  let selectedId = null;
  let pdfDoc = null;
  let imageUrls = [];     // object URL per page (JPEG)
  let mode = 'edit';      // 'edit' | 'preview'
  let loading = false;
  let exporting = false;
  let sourceName = '';

  /* ─── DOM refs (set in init) ───────────────────────────── */
  let stageEl = null;   // .ae-stage
  let wrapEl = null;    // .ae-page-wrap
  let stripEl = null;   // .ae-strip

  /* ─── Default element factory ──────────────────────────── */
  function defaultEl(type, x = 28, y = 38) {
    const hot = type === 'hotspot';
    return {
      id: uid(), type,
      x, y,
      w: hot ? 28 : 44,
      h: hot ? 7  : 9,
      rotation: 0,
      content: hot ? 'Click here →' : 'Your text',
      style: {
        fontSize: 18,
        color:   hot ? '#ffffff' : '#1a1a1a',
        bold:    hot,
        italic:  false,
        align:   hot ? 'center' : 'left',
        bgColor: hot ? '#4a7c59' : '',
        opacity: 1,
      },
      animation: { type: 'fadeIn', delay: 0, duration: 600 },
      link: null,
    };
  }

  /* ─── Model helpers ─────────────────────────────────────── */
  function getPage(i)  { if (!pages[i]) pages[i] = { elements: [] }; return pages[i]; }
  function getEls(i)   { return getPage(i).elements; }
  function findEl(id)  { return getEls(currentPage).find(e => e.id === id); }

  /* ─── Apply style to a DOM element ─────────────────────── */
  function applyStyle(div, el, stageH) {
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

  /* ─── Build editor DOM element ──────────────────────────── */
  function buildEl(el) {
    const div = document.createElement('div');
    div.className = `ae-el ae-${el.type}`;
    div.dataset.id = el.id;
    applyStyle(div, el);

    const span = document.createElement('span');
    span.className = 'ae-el-content';
    span.textContent = el.content;
    div.append(span);

    HANDLES.forEach(p => {
      const h = document.createElement('div');
      h.className = 'ae-handle'; h.dataset.p = p;
      div.append(h);
    });
    const rot = document.createElement('div');
    rot.className = 'ae-rotate'; rot.textContent = '↻';
    div.append(rot);

    bindEl(div);
    return div;
  }

  /* ─── Interaction: drag, resize, rotate ─────────────────── */
  function bindEl(div) {
    div.addEventListener('pointerdown', e => {
      if (e.target.classList.contains('ae-handle') || e.target.classList.contains('ae-rotate')) return;
      if (div.classList.contains('ae-editing')) return;
      e.stopPropagation(); e.preventDefault();
      select(div.dataset.id);
      startDrag(div, e);
    });
    div.addEventListener('dblclick', e => {
      if (e.target.classList.contains('ae-handle') || e.target.classList.contains('ae-rotate')) return;
      e.stopPropagation();
      startTextEdit(div);
    });
    div.querySelectorAll('.ae-handle').forEach(h => {
      h.addEventListener('pointerdown', e => {
        e.stopPropagation(); e.preventDefault();
        select(div.dataset.id);
        startResize(div, h.dataset.p, e);
      });
    });
    div.querySelector('.ae-rotate')?.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      select(div.dataset.id);
      startRotate(div, e);
    });
  }

  function startDrag(div, ev) {
    const rect = stageEl.getBoundingClientRect();
    const el = findEl(div.dataset.id); if (!el) return;
    const ox = el.x, oy = el.y;
    const sx = ev.clientX, sy = ev.clientY;
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
      const dx = (e.clientX - sx) / rect.width  * 100;
      const dy = (e.clientY - sy) / rect.height * 100;
      let nx = ox, ny = oy, nw = ow, nh = oh;
      if (pos.includes('l')) { nx = clamp(ox + dx, 0, ox + ow - 4); nw = ox + ow - nx; }
      if (pos.includes('r')) { nw = clamp(ow + dx, 4, 100 - ox); }
      if (pos.includes('t')) { ny = clamp(oy + dy, 0, oy + oh - 3); nh = oy + oh - ny; }
      if (pos.includes('b')) { nh = clamp(oh + dy, 3, 100 - oy); }
      el.x = nx; el.y = ny; el.w = nw; el.h = nh;
      div.style.left = nx + '%'; div.style.top = ny + '%';
      div.style.width = nw + '%'; div.style.height = nh + '%';
      const h = stageEl.getBoundingClientRect().height;
      div.style.fontSize = ((el.style.fontSize / 18) * (h * 0.033)) + 'px';
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  function startRotate(div, ev) {
    const el = findEl(div.dataset.id); if (!el) return;
    const r = div.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const a0 = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
    const or = el.rotation || 0;
    const move = e => {
      el.rotation = Math.round(or + Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI - a0);
      div.style.transform = `rotate(${el.rotation}deg)`;
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  /* ─── Inline text edit ──────────────────────────────────── */
  function startTextEdit(div) {
    const el = findEl(div.dataset.id); if (!el) return;
    div.classList.add('ae-editing');
    const span = div.querySelector('.ae-el-content');
    span.contentEditable = 'true';
    span.focus();
    const range = document.createRange();
    range.selectNodeContents(span);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    const finish = () => {
      span.contentEditable = 'false';
      div.classList.remove('ae-editing');
      el.content = span.textContent;
      updateInspector();
      span.removeEventListener('blur', finish);
      span.removeEventListener('keydown', onKey);
    };
    const onKey = e => { if (e.key === 'Escape') { span.textContent = el.content; finish(); } };
    span.addEventListener('blur', finish);
    span.addEventListener('keydown', onKey);
  }

  /* ─── Selection ─────────────────────────────────────────── */
  function select(id) {
    if (selectedId === id) return;
    stageEl?.querySelector(`[data-id="${selectedId}"]`)?.classList.remove('selected');
    selectedId = id;
    if (id) stageEl?.querySelector(`[data-id="${id}"]`)?.classList.add('selected');
    updateInspector();
  }

  /* ─── Render stage ──────────────────────────────────────── */
  function renderStage() {
    if (!stageEl) return;
    stageEl.querySelectorAll('.ae-el, .ae-page-hint').forEach(e => e.remove());
    const els = getEls(currentPage);
    if (els.length === 0) {
      const h = document.createElement('div');
      h.className = 'ae-page-hint';
      h.innerHTML = '<span>✦</span><p>Add text or a button from the sidebar</p>';
      stageEl.append(h);
    } else {
      els.forEach(el => stageEl.append(buildEl(el)));
    }
    select(null);
  }

  /* ─── Page strip ─────────────────────────────────────────── */
  function buildStrip() {
    if (!stripEl) return;
    stripEl.innerHTML = '';
    for (let i = 0; i < pageCount; i++) {
      const btn = document.createElement('button');
      btn.className = 'ae-strip-btn' + (i === currentPage ? ' active' : '');
      btn.type = 'button';
      btn.title = `Page ${i + 1}`;
      btn.textContent = i + 1;
      if ((pages[i]?.elements?.length || 0) > 0) {
        const dot = document.createElement('span'); dot.className = 'ae-dot'; btn.append(dot);
      }
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
    currentPage = i;
    updateEditorImage();
    renderStage();
    select(null);
    updateStrip();
    updatePageLabel();
    updateButtons();
  }

  function updatePageLabel() {
    const el = $('#ae-page-label');
    if (el) el.textContent = pageCount ? `Page ${currentPage + 1} of ${pageCount}` : '';
  }

  function updateEditorImage() {
    const img = wrapEl?.querySelector('.ae-page-img');
    if (img && imageUrls[currentPage]) { img.src = imageUrls[currentPage]; img.alt = `Page ${currentPage + 1}`; }
  }

  function updateButtons() {
    const ready = pageCount > 0;
    $('#ae-add-text')   && ($('#ae-add-text').disabled    = !ready);
    $('#ae-add-hotspot')&& ($('#ae-add-hotspot').disabled = !ready);
    $('#ae-extract')    && ($('#ae-extract').disabled     = !ready || !pdfDoc);
    $('#ae-extract-all')&& ($('#ae-extract-all').disabled = !ready || !pdfDoc);
    $('#ae-export')     && ($('#ae-export').disabled      = !ready || exporting);
  }

  /* ─── Resize editor canvas proportionally ────────────────── */
  function resizeWrap() {
    if (!wrapEl || !pageCount) return;
    const area = $('.ae-canvas-scroll');
    if (!area) return;
    const availW = area.clientWidth  - 48;
    const availH = area.clientHeight - 48;
    const img = wrapEl.querySelector('.ae-page-img');
    const natural = img?.naturalWidth && img?.naturalHeight ? img.naturalWidth / img.naturalHeight : 0.707;
    let w = availW, h = w / natural;
    if (h > availH) { h = availH; w = h * natural; }
    wrapEl.style.width  = Math.round(w) + 'px';
    wrapEl.style.height = Math.round(h) + 'px';
    // re-apply font sizes
    stageEl?.querySelectorAll('.ae-el').forEach(div => {
      const el = findEl(div.dataset.id); if (el) applyStyle(div, el, h);
    });
  }
  window.addEventListener('resize', () => { if (mode === 'edit') resizeWrap(); });

  /* ─── Open PDF ──────────────────────────────────────────── */
  async function openPdf(blob, name) {
    if (loading) return;
    loading = true;
    setStatus('Reading PDF…'); setError('');
    updateButtons();
    const newUrls = [];
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
        const imgBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.87));
        if (!imgBlob) throw new Error('Page render failed.');
        newUrls.push(URL.createObjectURL(imgBlob));
        page.cleanup(); canvas.width = canvas.height = 0;
      }
      // commit
      if (pdfDoc) await pdfDoc.destroy().catch(() => {});
      imageUrls.forEach(u => URL.revokeObjectURL(u));
      imageUrls = newUrls; pdfDoc = doc; pageCount = doc.numPages;
      pages = {}; currentPage = 0; selectedId = null;
      sourceName = name;
      // show canvas area
      $('.ae-empty')?.remove();
      const canvasScroll = $('.ae-canvas-scroll');
      if (canvasScroll && !$('.ae-page-wrap')) {
        canvasScroll.innerHTML = '';
        const wrap = document.createElement('div'); wrap.className = 'ae-page-wrap'; wrap.id = 'ae-page-wrap';
        const img = document.createElement('img'); img.className = 'ae-page-img'; img.draggable = false;
        const stage = document.createElement('div'); stage.className = 'ae-stage'; stage.id = 'ae-stage';
        wrap.append(img, stage);
        canvasScroll.append(wrap);
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
      setStatus(`${pageCount} page${pageCount > 1 ? 's' : ''} ready. Use ✦ Text or ✦ Button to add elements.`);
    } catch (err) {
      newUrls.forEach(u => URL.revokeObjectURL(u));
      setError('Could not open PDF: ' + (err.message || err));
      setStatus('');
    } finally {
      loading = false;
      updateButtons();
    }
  }

  /* ─── Text extraction (PDF.js) ──────────────────────────── */
  async function extractPage(index) {
    if (!pdfDoc) return 0;
    try {
      const page = await pdfDoc.getPage(index + 1);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const lines = [];
      for (const item of content.items) {
        if (!item.str?.trim()) continue;
        const yPdf = vp.height - item.transform[5];
        const xPdf = item.transform[4];
        const yPct = clamp((yPdf / vp.height) * 100, 0, 95);
        const xPct = clamp((xPdf / vp.width)  * 100, 0, 90);
        const wPct = clamp((item.width  / vp.width)  * 100, 4, 90 - xPct);
        const hPct = clamp((item.height / vp.height) * 100 * 1.6, 3, 18);
        const existing = lines.find(l => Math.abs(l.y - yPct) < 3 && Math.abs(l.x - xPct) < 50);
        if (existing) {
          existing.text += ' ' + item.str.trim();
          existing.w = Math.max(existing.w, xPct + wPct - existing.x);
        } else {
          lines.push({ text: item.str.trim(), x: xPct, y: yPct, w: wPct, h: hPct, fs: Math.round(item.height * 1.2) });
        }
      }
      const dest = getPage(index).elements;
      for (const ln of lines) {
        if (!ln.text.trim()) continue;
        const el = defaultEl('text', Math.round(ln.x), Math.round(ln.y));
        el.content = ln.text.trim();
        el.w = clamp(Math.round(ln.w) + 2, 6, 92);
        el.h = clamp(Math.round(ln.h), 3, 22);
        el.style.fontSize = clamp(Math.round(ln.fs), 7, 72);
        el.style.bgColor = ''; el.animation = { type: 'none', delay: 0, duration: 0 };
        dest.push(el);
      }
      page.cleanup();
      return lines.length;
    } catch (e) {
      console.warn('Extract page', index, e);
      return 0;
    }
  }

  /* ─── Inspector ─────────────────────────────────────────── */
  function updateInspector() {
    const el = selectedId ? findEl(selectedId) : null;
    const panel = $('#ae-inspector');
    if (!panel) return;
    panel.classList.toggle('hidden', !el);
    if (!el) return;
    const v = (id, val) => { const n = $(id); if (n) n.value = val; };
    v('#ae-i-content', el.content);
    v('#ae-i-fs',      el.style.fontSize);
    v('#ae-i-color',   el.style.color || '#1a1a1a');
    v('#ae-i-bgcolor', el.style.bgColor || '#ffffff');
    v('#ae-i-opacity', Math.round((el.style.opacity ?? 1) * 100));
    $('#ae-i-bold')  ?.classList.toggle('on', el.style.bold);
    $('#ae-i-italic')?.classList.toggle('on', el.style.italic);
    ['left','center','right'].forEach(a => $(`#ae-i-align-${a}`)?.classList.toggle('on', el.style.align === a));
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

  function bindInspector() {
    function patchStyle(patch) {
      const el = selectedId ? findEl(selectedId) : null; if (!el) return;
      Object.assign(el.style, patch);
      const div = stageEl?.querySelector(`[data-id="${selectedId}"]`);
      if (div) applyStyle(div, el);
    }
    function patchEl(patch) {
      const el = selectedId ? findEl(selectedId) : null; if (!el) return;
      Object.assign(el, patch);
      const div = stageEl?.querySelector(`[data-id="${selectedId}"]`);
      if (div) { const span = div.querySelector('.ae-el-content'); if (span && patch.content != null) span.textContent = patch.content; }
    }

    on('#ae-i-content',    'input',  e => patchEl({ content: e.target.value }));
    on('#ae-i-fs',         'input',  e => patchStyle({ fontSize: Number(e.target.value) }));
    on('#ae-i-color',      'input',  e => patchStyle({ color: e.target.value }));
    on('#ae-i-bgcolor',    'input',  e => patchStyle({ bgColor: e.target.value }));
    on('#ae-i-opacity',    'input',  e => patchStyle({ opacity: Number(e.target.value) / 100 }));
    on('#ae-i-bold',       'click',  () => { const el = selectedId ? findEl(selectedId) : null; if (el) { patchStyle({ bold: !el.style.bold }); $('#ae-i-bold')?.classList.toggle('on', el.style.bold); } });
    on('#ae-i-italic',     'click',  () => { const el = selectedId ? findEl(selectedId) : null; if (el) { patchStyle({ italic: !el.style.italic }); $('#ae-i-italic')?.classList.toggle('on', el.style.italic); } });
    ['left','center','right'].forEach(a => on(`#ae-i-align-${a}`, 'click', () => {
      patchStyle({ align: a });
      ['left','center','right'].forEach(b => $(`#ae-i-align-${b}`)?.classList.toggle('on', b === a));
    }));

    function patchAnim(patch) {
      const el = selectedId ? findEl(selectedId) : null; if (!el) return;
      Object.assign(el.animation, patch);
    }
    on('#ae-i-anim-type',  'change', e => patchAnim({ type: e.target.value }));
    on('#ae-i-anim-delay', 'input',  e => patchAnim({ delay: Number(e.target.value) }));
    on('#ae-i-anim-dur',   'input',  e => patchAnim({ duration: Number(e.target.value) }));

    function applyLink() {
      const el = selectedId ? findEl(selectedId) : null; if (!el) return;
      const lt = $('#ae-i-link-type')?.value || 'none';
      $('#ae-i-link-url-row') ?.classList.toggle('ae-hidden-row', lt !== 'url');
      $('#ae-i-link-page-row')?.classList.toggle('ae-hidden-row', lt !== 'page');
      if (lt === 'none')  el.link = null;
      else if (lt === 'url')  el.link = { type: 'url',  target: $('#ae-i-link-url')?.value  || '' };
      else if (lt === 'page') el.link = { type: 'page', target: Number($('#ae-i-link-page')?.value || 1) };
    }
    on('#ae-i-link-type',  'change', applyLink);
    on('#ae-i-link-url',   'input',  applyLink);
    on('#ae-i-link-page',  'input',  applyLink);
  }

  function on(sel, ev, fn) { $(sel)?.addEventListener(ev, fn); }

  /* ─── Mode: edit ↔ preview ──────────────────────────────── */
  function setMode(m) {
    mode = m;
    const isEdit = m === 'edit';
    $('#ae-mode-edit')   ?.classList.toggle('active', isEdit);
    $('#ae-mode-preview')?.classList.toggle('active', !isEdit);
    if (!stageEl) return;
    if (isEdit) {
      // restore editor elements
      stageEl.querySelectorAll('.ae-prev-el').forEach(e => e.remove());
      renderStage();
      stageEl.style.pointerEvents = '';
    } else {
      // clear editor elements, show preview elements with animations
      stageEl.querySelectorAll('.ae-el, .ae-page-hint').forEach(e => e.remove());
      select(null);
      playPreview(currentPage);
      stageEl.style.pointerEvents = 'auto';
    }
  }

  function playPreview(index) {
    if (!stageEl) return;
    stageEl.querySelectorAll('.ae-prev-el').forEach(e => e.remove());
    const reduced = matchMedia('(prefers-reduced-motion:reduce)').matches;
    const els = getEls(index);
    els.forEach(el => {
      const div = document.createElement('div');
      div.className = `ae-prev-el ae-${el.type}`;
      div.style.left   = el.x + '%'; div.style.top    = el.y + '%';
      div.style.width  = el.w + '%'; div.style.height = el.h + '%';
      if (el.rotation) div.style.transform = `rotate(${el.rotation}deg)`;
      const s = el.style;
      const h = stageEl.getBoundingClientRect().height || 600;
      div.style.fontSize   = ((s.fontSize / 18) * (h * 0.033)) + 'px';
      div.style.color      = s.color   || '';
      div.style.fontWeight = s.bold    ? '700' : '400';
      div.style.fontStyle  = s.italic  ? 'italic' : '';
      div.style.textAlign  = s.align   || 'left';
      div.style.background = s.bgColor || 'transparent';
      div.style.padding    = '3px 6px';
      div.style.boxSizing  = 'border-box';
      div.style.lineHeight = '1.35';
      div.style.wordBreak  = 'break-word';
      if (el.type === 'hotspot') {
        div.style.borderRadius = '6px'; div.style.display = 'flex';
        div.style.alignItems = 'center'; div.style.justifyContent = 'center';
      }
      div.textContent = el.content;
      // link
      if (el.link) {
        div.classList.add('ae-prev-link');
        div.addEventListener('click', e => {
          e.stopPropagation();
          if (el.link.type === 'url' && el.link.target) window.open(el.link.target, '_blank', 'noopener,noreferrer');
          else if (el.link.type === 'page') goToPreviewPage(Number(el.link.target) - 1);
        });
      }
      // animation
      const anim = el.animation?.type;
      const delay = el.animation?.delay ?? 0;
      const dur   = el.animation?.duration ?? 600;
      if (anim && anim !== 'none') {
        setTimeout(() => {
          div.style.setProperty('--ae-dur', dur + 'ms');
          div.classList.add('ae-prev-animated', `ae-anim-${anim}`);
        }, reduced ? 0 : delay);
      } else {
        div.classList.add('ae-prev-animated');
      }
      stageEl.append(div);
    });
  }

  function goToPreviewPage(i) {
    if (i < 0 || i >= pageCount) return;
    currentPage = i;
    updateEditorImage();
    updateStrip();
    updatePageLabel();
    if (mode === 'preview') playPreview(i);
    else renderStage();
  }

  /* ─── Status helpers ────────────────────────────────────── */
  function setStatus(msg) { const el = $('#ae-status'); if (el) el.textContent = msg; }
  function setError(msg)  {
    const el = $('#ae-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('visible', !!msg);
  }

  /* ─── Export: HTML ZIP (uses PageFlip + viewer assets) ─── */
  async function exportHTML() {
    if (!pageCount || exporting) return;
    exporting = true; updateButtons();
    setStatus('Preparing export…');
    setError('');
    try {
      // build model
      const title = $('#ae-title')?.value.trim() || sourceName.replace(/\.pdf$/i,'') || 'Flipbook';
      const ratio  = (() => { const img = wrapEl?.querySelector('.ae-page-img'); return img?.naturalWidth && img?.naturalHeight ? img.naturalWidth / img.naturalHeight : 0.707; })();
      const pagesData = {};
      for (const [k, v] of Object.entries(pages)) {
        if (v?.elements?.length) pagesData[k] = { elements: v.elements.map(e => ({ ...e, style: { ...e.style }, animation: { ...e.animation }, link: e.link ? { ...e.link } : null })) };
      }
      const data = { version: 2, title, pageCount, ratio, overlays: {}, pages: pagesData };

      const zip = new JSZip();
      const assetFetch = async path => { const r = await fetch(path); if (!r.ok) throw new Error('Asset missing: ' + path); return r.text(); };

      // viewer files
      for (const f of ['index.html','viewer.css','book-effects.css','layout.js','viewer.js']) {
        zip.file(f, await assetFetch('assets/export/' + f));
      }
      zip.file('page-flip.browser.js', await (await fetch('assets/vendor/page-flip.browser.js')).arrayBuffer());
      zip.file('ENGINE-SOURCE.md',     await assetFetch('assets/vendor/SOURCE.md'));
      zip.file('PAGEFLIP-LICENSE.txt', await assetFetch('assets/vendor/PAGEFLIP-LICENSE.txt'));

      // inject editor CSS so viewer can render elements
      const editorCss = await (await fetch('assets/animation-editor.css')).text();
      zip.file('editor.css', editorCss);

      // book data
      const scriptData = 'window.FLIPBOOK_DATA = ' +
        JSON.stringify(data).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029') + ';\n';
      zip.file('book-data.js',  scriptData);
      zip.file('book.json',     JSON.stringify(data, null, 2));
      zip.file('BUKA-BUKU.txt', 'Extract the full ZIP, then open index.html in a browser.\nNo internet or server required.\n');

      // pages
      for (let i = 0; i < imageUrls.length; i++) {
        setStatus(`Packaging page ${i + 1} / ${imageUrls.length}…`);
        const r = await fetch(imageUrls[i]); if (!r.ok) throw new Error('Page image unavailable.');
        zip.file(`pages/${i + 1}.jpg`, await r.arrayBuffer());
      }

      setStatus('Creating ZIP…');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, m => setStatus(`Compressing ${Math.round(m.percent)}%…`));

      // save via File System Access API or fallback download
      const safeTitle = title.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'flipbook';
      const filename = safeTitle + '-interactive.zip';
      let saved = false;
      if (typeof globalThis.showSaveFilePicker === 'function') {
        try {
          const handle = await globalThis.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }] });
          const w = await handle.createWritable();
          await w.write(blob); await w.close();
          saved = true;
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
      setError('Export failed: ' + (err.message || err));
      setStatus('');
    } finally {
      exporting = false; updateButtons();
    }
  }

  /* ─── Public actions ─────────────────────────────────────── */
  function addElement(type) {
    if (!pageCount) return;
    if (mode !== 'edit') setMode('edit');
    const el = defaultEl(type);
    getEls(currentPage).push(el);
    stageEl?.querySelector('.ae-page-hint')?.remove();
    stageEl?.append(buildEl(el));
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

  function clearPage() {
    pages[currentPage] = { elements: [] };
    renderStage(); select(null); updateStrip();
  }

  /* ─── Init: wire up all UI ──────────────────────────────── */
  function init() {
    // Wire DOM refs that exist at startup
    stripEl = $('#ae-strip');

    // Hide inspector hint when an element is selected
    const origSelect = select;
    // inspector hint visibility
    document.addEventListener('click', () => {
      const hint = $('#ae-inspector-hint');
      const panel = $('#ae-inspector');
      if (hint && panel) hint.style.display = panel.classList.contains('hidden') ? '' : 'none';
    });

    // PDF file input
    on('#ae-pdf-file', 'change', e => {
      const f = e.target.files[0]; e.target.value = '';
      if (f) openPdf(f, f.name);
    });

    // Mode toggle
    on('#ae-mode-edit',    'click', () => { if (mode !== 'edit')    setMode('edit');    });
    on('#ae-mode-preview', 'click', () => { if (mode !== 'preview') setMode('preview'); });

    // Add elements
    on('#ae-add-text',    'click', () => addElement('text'));
    on('#ae-add-hotspot', 'click', () => addElement('hotspot'));

    // Delete / clear
    on('#ae-delete-btn', 'click', () => deleteSelected());
    on('#ae-clear-btn',  'click', () => { if (confirm('Clear all elements from this page?')) clearPage(); });

    // Extract text
    on('#ae-extract', 'click', async () => {
      if (!pdfDoc || loading) return;
      setStatus('Extracting text from current page…');
      const n = await extractPage(currentPage);
      renderStage();
      updateStrip();
      setStatus(n ? `Added ${n} text element(s). Edit them in the canvas.` : 'No extractable text found on this page.');
    });

    on('#ae-extract-all', 'click', async () => {
      if (!pdfDoc || loading) return;
      $('#ae-extract-all').disabled = true;
      let total = 0;
      for (let i = 0; i < pageCount; i++) {
        setStatus(`Extracting page ${i + 1} / ${pageCount}…`);
        total += await extractPage(i);
      }
      renderStage(); updateStrip();
      setStatus(`Done — added ${total} text element(s) across all pages.`);
      updateButtons();
    });

    // Page navigation (next/prev in preview)
    on('#ae-prev', 'click', () => goToPreviewPage(currentPage - 1));
    on('#ae-next', 'click', () => goToPreviewPage(currentPage + 1));

    // Export
    on('#ae-export', 'click', exportHTML);

    // Inspector
    bindInspector();

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.target.closest('input,textarea,select,[contenteditable]')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteSelected(); }
      if (e.key === 'Escape') select(null);
    });

    updateButtons();
    setStatus('Upload a PDF to get started.');
  }

  // Start when DOM ready
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
