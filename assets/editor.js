'use strict';
/* ═══════════════════════════════════════════════════════
   FlipbookEditor — Canva-like per-page element editor
   Phase 1: Text elements, Hotspot/link buttons,
            animations (CSS-based), URL + goto-page links,
            auto PDF text extraction via PDF.js
   ═══════════════════════════════════════════════════════ */
const FlipbookEditor = (() => {

  /* ─── Utilities ─────────────────────────────────────── */
  function uuid() {
    return 'el-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  const ANIM_TYPES = ['none', 'fadeIn', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'zoomIn', 'bounce', 'pulse'];
  const HANDLES = ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'];

  /* ─── Default element factory ────────────────────────── */
  function defaultEl(type, x = 30, y = 40) {
    const isHotspot = type === 'hotspot';
    return {
      id: uuid(), type,
      x, y,
      w: isHotspot ? 30 : 45,
      h: isHotspot ? 7 : 9,
      rotation: 0,
      content: isHotspot ? 'Click here →' : 'Your text',
      style: {
        fontSize: 18,
        color: isHotspot ? '#ffffff' : '#1a1a1a',
        bold: isHotspot,
        italic: false,
        align: isHotspot ? 'center' : 'left',
        bgColor: isHotspot ? '#4a7c59' : '',
        opacity: 1,
      },
      animation: { type: 'fadeIn', delay: 0, duration: 600 },
      link: null,
    };
  }

  /* ─── Model ─────────────────────────────────────────── */
  // pages[pageIndex] = { elements: [] }
  let pages = {};
  let _pageCount = 0;
  let _pdfDoc = null;      // PDF.js doc for text extraction

  function getPage(i) {
    if (!pages[i]) pages[i] = { elements: [] };
    return pages[i];
  }
  function getEls(i) { return getPage(i).elements; }
  function findEl(pageIndex, id) { return getEls(pageIndex).find(e => e.id === id); }

  /* ─── State ──────────────────────────────────────────── */
  let _currentPage = 0;
  let _selectedId = null;
  let _imageUrls = [];     // from flipbook.js (object URLs per page)
  let _stageEl = null;     // .editor-stage div
  let _wrapEl = null;      // .editor-page-wrap div (contains img + stage)
  let _onModelChange = () => {};

  /* ─── Inspector DOM refs (set in init) ─────────────────── */
  let insp = {};

  /* ─── Build DOM element (editor mode) ──────────────────── */
  function buildDomEl(el, stageW, stageH) {
    const div = document.createElement('div');
    div.className = `ed-el ed-${el.type}`;
    div.dataset.id = el.id;
    applyElStyle(div, el, stageW, stageH);

    // Content (text; hotspot uses label via content)
    const span = document.createElement('span');
    span.className = 'ed-content';
    span.textContent = el.content;
    div.append(span);

    // Resize handles
    HANDLES.forEach(pos => {
      const h = document.createElement('div');
      h.className = 'ed-handle';
      h.dataset.pos = pos;
      div.append(h);
    });

    // Rotation handle
    const rot = document.createElement('div');
    rot.className = 'ed-rotate';
    rot.textContent = '↻';
    div.append(rot);

    bindElInteraction(div);
    return div;
  }

  function applyElStyle(div, el, stageW, stageH) {
    div.style.left   = el.x + '%';
    div.style.top    = el.y + '%';
    div.style.width  = el.w + '%';
    div.style.height = el.h + '%';
    div.style.transform = el.rotation ? `rotate(${el.rotation}deg)` : '';
    const s = el.style;
    const refH = stageH || 600;
    div.style.fontSize   = ((s.fontSize / 18) * (refH * 0.032)) + 'px';
    div.style.color      = s.color || '';
    div.style.fontWeight = s.bold ? '700' : '400';
    div.style.fontStyle  = s.italic ? 'italic' : '';
    div.style.textAlign  = s.align || 'left';
    div.style.background = s.bgColor || 'transparent';
    div.style.opacity    = s.opacity != null ? s.opacity : 1;
  }

  /* ─── Selection ──────────────────────────────────────── */
  function select(id) {
    if (_selectedId === id) return;
    // deselect old
    if (_selectedId && _stageEl) {
      const old = _stageEl.querySelector(`[data-id="${_selectedId}"]`);
      old?.classList.remove('selected');
    }
    _selectedId = id;
    if (id && _stageEl) {
      const el = _stageEl.querySelector(`[data-id="${id}"]`);
      el?.classList.add('selected');
    }
    updateInspector();
  }

  /* ─── Drag & Resize ──────────────────────────────────── */
  function bindElInteraction(div) {
    div.addEventListener('pointerdown', e => {
      if (e.target.classList.contains('ed-handle') || e.target.classList.contains('ed-rotate')) return;
      if (div.classList.contains('editing')) return;
      e.stopPropagation();
      e.preventDefault();
      select(div.dataset.id);
      startDrag(div, e);
    });

    div.addEventListener('dblclick', e => {
      if (e.target.classList.contains('ed-handle') || e.target.classList.contains('ed-rotate')) return;
      e.stopPropagation();
      startTextEdit(div);
    });

    // Handle resize
    div.querySelectorAll('.ed-handle').forEach(h => {
      h.addEventListener('pointerdown', e => {
        e.stopPropagation();
        e.preventDefault();
        select(div.dataset.id);
        startResize(div, h.dataset.pos, e);
      });
    });

    // Rotation handle
    div.querySelector('.ed-rotate')?.addEventListener('pointerdown', e => {
      e.stopPropagation();
      e.preventDefault();
      select(div.dataset.id);
      startRotate(div, e);
    });
  }

  function startDrag(div, startEvent) {
    if (!_stageEl) return;
    const stageRect = _stageEl.getBoundingClientRect();
    const el = findEl(_currentPage, div.dataset.id);
    if (!el) return;
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const origX = el.x, origY = el.y;

    function onMove(e) {
      const dx = ((e.clientX - startX) / stageRect.width)  * 100;
      const dy = ((e.clientY - startY) / stageRect.height) * 100;
      el.x = clamp(origX + dx, 0, 100 - el.w);
      el.y = clamp(origY + dy, 0, 100 - el.h);
      div.style.left = el.x + '%';
      div.style.top  = el.y + '%';
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      _onModelChange();
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function startResize(div, pos, startEvent) {
    if (!_stageEl) return;
    const stageRect = _stageEl.getBoundingClientRect();
    const el = findEl(_currentPage, div.dataset.id);
    if (!el) return;
    const { x: ox, y: oy, w: ow, h: oh } = el;
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;

    function onMove(e) {
      const dx = ((e.clientX - startX) / stageRect.width)  * 100;
      const dy = ((e.clientY - startY) / stageRect.height) * 100;
      let nx = ox, ny = oy, nw = ow, nh = oh;
      if (pos.includes('l')) { nx = clamp(ox + dx, 0, ox + ow - 5); nw = ox + ow - nx; }
      if (pos.includes('r')) { nw = clamp(ow + dx, 5, 100 - ox); }
      if (pos.includes('t')) { ny = clamp(oy + dy, 0, oy + oh - 3); nh = oy + oh - ny; }
      if (pos.includes('b')) { nh = clamp(oh + dy, 3, 100 - oy); }
      el.x = nx; el.y = ny; el.w = nw; el.h = nh;
      div.style.left   = nx + '%';
      div.style.top    = ny + '%';
      div.style.width  = nw + '%';
      div.style.height = nh + '%';
      const refH = _stageEl.getBoundingClientRect().height;
      div.style.fontSize = ((el.style.fontSize / 18) * (refH * 0.032)) + 'px';
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      _onModelChange();
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function startRotate(div, startEvent) {
    const el = findEl(_currentPage, div.dataset.id);
    if (!el) return;
    const rect = div.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startAngle = Math.atan2(startEvent.clientY - cy, startEvent.clientX - cx) * 180 / Math.PI;
    const origRot = el.rotation || 0;

    function onMove(e) {
      const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
      el.rotation = Math.round(origRot + (angle - startAngle));
      div.style.transform = `rotate(${el.rotation}deg)`;
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      _onModelChange();
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /* ─── Inline text editing ────────────────────────────── */
  function startTextEdit(div) {
    const el = findEl(_currentPage, div.dataset.id);
    if (!el) return;
    div.classList.add('editing');
    const span = div.querySelector('.ed-content');
    span.contentEditable = 'true';
    span.focus();
    // Select all
    const range = document.createRange();
    range.selectNodeContents(span);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    function finish() {
      span.contentEditable = 'false';
      div.classList.remove('editing');
      el.content = span.textContent;
      span.removeEventListener('blur', finish);
      span.removeEventListener('keydown', onKey);
      updateInspector();
      _onModelChange();
    }
    function onKey(e) {
      if (e.key === 'Escape') { span.textContent = el.content; finish(); }
    }
    span.addEventListener('blur', finish);
    span.addEventListener('keydown', onKey);
  }

  /* ─── Render page elements into stage ────────────────── */
  function renderStage() {
    if (!_stageEl) return;
    // Clear existing elements but keep empty hint if needed
    _stageEl.querySelectorAll('.ed-el').forEach(e => e.remove());
    _stageEl.querySelector('.ed-empty-hint')?.remove();

    const els = getEls(_currentPage);
    const stageRect = _stageEl.getBoundingClientRect();
    const sw = stageRect.width  || 400;
    const sh = stageRect.height || 600;

    if (els.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'ed-empty-hint';
      hint.innerHTML = '<span>✦</span><p>Add a text or button using the sidebar tools</p>';
      _stageEl.append(hint);
    } else {
      els.forEach(el => {
        const div = buildDomEl(el, sw, sh);
        _stageEl.append(div);
      });
    }

    // Deselect on click on empty stage
    _stageEl.addEventListener('pointerdown', e => {
      if (e.target === _stageEl) select(null);
    }, { once: false });

    select(null);
  }

  /* ─── Inspector ──────────────────────────────────────── */
  function updateInspector() {
    const el = _selectedId ? findEl(_currentPage, _selectedId) : null;
    const show = !!el;

    if (insp.panel) insp.panel.classList.toggle('hidden', !show);
    if (!show) return;

    // Content
    if (insp.content) insp.content.value = el.content;
    // Style
    if (insp.fontSize)  insp.fontSize.value  = el.style.fontSize;
    if (insp.color)     insp.color.value     = el.style.color    || '#1a1a1a';
    if (insp.bgColor)   insp.bgColor.value   = el.style.bgColor  || '#ffffff';
    if (insp.opacity)   insp.opacity.value   = Math.round((el.style.opacity ?? 1) * 100);
    if (insp.bold)      insp.bold.classList.toggle('on',   el.style.bold);
    if (insp.italic)    insp.italic.classList.toggle('on', el.style.italic);
    ['left','center','right'].forEach(a => {
      insp['align_' + a]?.classList.toggle('on', el.style.align === a);
    });
    // Animation
    if (insp.animType)  insp.animType.value  = el.animation.type;
    if (insp.animDelay) insp.animDelay.value = el.animation.delay;
    if (insp.animDur)   insp.animDur.value   = el.animation.duration;
    // Link
    if (insp.linkType) {
      const lt = el.link?.type || 'none';
      insp.linkType.value = lt;
      if (insp.linkUrl)  { insp.linkUrl.value = lt === 'url'  ? el.link.target : ''; }
      if (insp.linkPage) { insp.linkPage.value = lt === 'page' ? el.link.target : ''; }
      insp.linkUrlRow?.classList.toggle('hidden', lt !== 'url');
      insp.linkPageRow?.classList.toggle('hidden', lt !== 'page');
    }
  }

  function bindInspectorEvents() {
    function patchEl(patch) {
      if (!_selectedId) return;
      const el = findEl(_currentPage, _selectedId);
      if (!el) return;
      Object.assign(el, patch);
      // re-apply style to DOM element
      const div = _stageEl?.querySelector(`[data-id="${_selectedId}"]`);
      if (div) {
        const stageRect = _stageEl.getBoundingClientRect();
        applyElStyle(div, el, stageRect.width, stageRect.height);
        const span = div.querySelector('.ed-content');
        if (span && el.content !== undefined) span.textContent = el.content;
      }
      _onModelChange();
    }
    function patchStyle(patch) {
      if (!_selectedId) return;
      const el = findEl(_currentPage, _selectedId);
      if (!el) return;
      Object.assign(el.style, patch);
      const div = _stageEl?.querySelector(`[data-id="${_selectedId}"]`);
      if (div) {
        const stageRect = _stageEl.getBoundingClientRect();
        applyElStyle(div, el, stageRect.width, stageRect.height);
      }
      _onModelChange();
    }

    if (insp.content) insp.content.addEventListener('input', () => patchEl({ content: insp.content.value }));
    if (insp.fontSize) insp.fontSize.addEventListener('input', () => patchStyle({ fontSize: Number(insp.fontSize.value) }));
    if (insp.color) insp.color.addEventListener('input', () => patchStyle({ color: insp.color.value }));
    if (insp.bgColor) insp.bgColor.addEventListener('input', () => patchStyle({ bgColor: insp.bgColor.value }));
    if (insp.opacity) insp.opacity.addEventListener('input', () => patchStyle({ opacity: Number(insp.opacity.value) / 100 }));
    if (insp.bold) insp.bold.addEventListener('click', () => {
      const el = findEl(_currentPage, _selectedId); if (!el) return;
      patchStyle({ bold: !el.style.bold });
      insp.bold.classList.toggle('on', el.style.bold);
    });
    if (insp.italic) insp.italic.addEventListener('click', () => {
      const el = findEl(_currentPage, _selectedId); if (!el) return;
      patchStyle({ italic: !el.style.italic });
      insp.italic.classList.toggle('on', el.style.italic);
    });
    ['left','center','right'].forEach(a => {
      insp['align_' + a]?.addEventListener('click', () => {
        patchStyle({ align: a });
        ['left','center','right'].forEach(b => insp['align_' + b]?.classList.toggle('on', b === a));
      });
    });

    // Animation
    if (insp.animType) insp.animType.addEventListener('change', () => {
      if (!_selectedId) return;
      const el = findEl(_currentPage, _selectedId); if (!el) return;
      el.animation.type = insp.animType.value; _onModelChange();
    });
    if (insp.animDelay) insp.animDelay.addEventListener('input', () => {
      if (!_selectedId) return;
      const el = findEl(_currentPage, _selectedId); if (!el) return;
      el.animation.delay = Number(insp.animDelay.value); _onModelChange();
    });
    if (insp.animDur) insp.animDur.addEventListener('input', () => {
      if (!_selectedId) return;
      const el = findEl(_currentPage, _selectedId); if (!el) return;
      el.animation.duration = Number(insp.animDur.value); _onModelChange();
    });

    // Link
    function updateLink() {
      if (!_selectedId) return;
      const el = findEl(_currentPage, _selectedId); if (!el) return;
      const lt = insp.linkType?.value || 'none';
      insp.linkUrlRow?.classList.toggle('hidden', lt !== 'url');
      insp.linkPageRow?.classList.toggle('hidden', lt !== 'page');
      if (lt === 'none') { el.link = null; }
      else if (lt === 'url')  { el.link = { type: 'url',  target: insp.linkUrl?.value  || '' }; }
      else if (lt === 'page') { el.link = { type: 'page', target: Number(insp.linkPage?.value || 0) }; }
      _onModelChange();
    }
    if (insp.linkType)  insp.linkType.addEventListener('change', updateLink);
    if (insp.linkUrl)   insp.linkUrl.addEventListener('input',   updateLink);
    if (insp.linkPage)  insp.linkPage.addEventListener('input',  updateLink);
  }

  /* ─── Page strip ─────────────────────────────────────── */
  function updatePageStrip(container) {
    if (!container) return;
    container.querySelectorAll('.page-strip-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === _currentPage);
      const dot = btn.querySelector('.has-els');
      const hasEls = (pages[i]?.elements?.length || 0) > 0;
      if (hasEls && !dot) {
        const d = document.createElement('span');
        d.className = 'has-els';
        btn.append(d);
      } else if (!hasEls && dot) {
        dot.remove();
      }
    });
  }

  function buildPageStrip(container, n, onSelect) {
    container.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const btn = document.createElement('button');
      btn.className = 'page-strip-btn' + (i === _currentPage ? ' active' : '');
      btn.type = 'button';
      btn.title = `Edit page ${i + 1}`;
      btn.textContent = i + 1;
      btn.addEventListener('click', () => {
        if (i === _currentPage) return;
        _currentPage = i;
        renderStage();
        select(null);
        updatePageStrip(container);
        updateEditorPageImage();
        if (insp.status) insp.status.textContent = `Editing page ${i + 1} of ${n}`;
        onSelect?.(i);
      });
      container.append(btn);
    }
  }

  function updateEditorPageImage() {
    if (!_wrapEl) return;
    const img = _wrapEl.querySelector('img.editor-page-img');
    if (img && _imageUrls[_currentPage]) {
      img.src = _imageUrls[_currentPage];
      img.alt = `Page ${_currentPage + 1}`;
    }
  }

  /* ─── PDF text extraction ────────────────────────────── */
  async function extractTextForPage(pageIndex, pdfDoc) {
    try {
      const pdfPage = await pdfDoc.getPage(pageIndex + 1);
      const vp = pdfPage.getViewport({ scale: 1 });
      const content = await pdfPage.getTextContent();
      const els = [];

      // Group items into visual lines by Y (within 5pt tolerance)
      const lines = [];
      for (const item of content.items) {
        if (!item.str?.trim()) continue;
        // transform[5] = y from bottom in PDF coord, convert to % from top
        const yPdf = vp.height - item.transform[5];
        const xPdf = item.transform[4];
        const yPct = clamp((yPdf / vp.height) * 100, 0, 95);
        const xPct = clamp((xPdf / vp.width)  * 100, 0, 90);
        const wPct = clamp((item.width / vp.width) * 100, 5, 90 - xPct);
        const hPct = clamp((item.height / vp.height) * 100 * 1.5, 3, 20);
        const fontSize = Math.round(item.height * 1.2);

        // Merge with nearby lines (same Y ± 3%)
        const existing = lines.find(l => Math.abs(l.yPct - yPct) < 3 && Math.abs(l.xPct - xPct) < 50);
        if (existing) {
          existing.text += ' ' + item.str.trim();
          existing.wPct = Math.max(existing.wPct, xPct + wPct - existing.xPct);
        } else {
          lines.push({ text: item.str.trim(), xPct, yPct, wPct, hPct, fontSize });
        }
      }

      for (const line of lines) {
        if (!line.text.trim()) continue;
        const el = defaultEl('text', Math.round(line.xPct), Math.round(line.yPct));
        el.content = line.text.trim();
        el.w = clamp(Math.round(line.wPct) + 3, 8, 92);
        el.h = clamp(Math.round(line.hPct), 4, 25);
        el.style.fontSize = clamp(Math.round(line.fontSize), 8, 72);
        el.style.color = '#1a1a1a';
        el.style.bgColor = '';
        el.animation = { type: 'none', delay: 0, duration: 0 };
        els.push(el);
      }
      pdfPage.cleanup();
      return els;
    } catch (e) {
      console.warn('FlipbookEditor: text extraction failed for page', pageIndex, e);
      return [];
    }
  }

  /* ─── Public API ─────────────────────────────────────── */

  /** Initialize the editor.
   *  @param {object} opts
   *    stageEl       — .editor-stage DOM element
   *    wrapEl        — .editor-page-wrap DOM element (img + stage)
   *    inspector     — object of inspector DOM refs (see bindInspectorEvents)
   *    pageStripEl   — container for page strip buttons
   *    pageCount     — total pages
   *    imageUrls     — array of object URLs (JPEG per page)
   *    pdfDoc        — PDF.js doc (for text extraction)
   *    onModelChange — callback when model changes
   */
  function init({ stageEl, wrapEl, inspector, pageStripEl, pageCount, imageUrls, pdfDoc, onModelChange }) {
    _stageEl  = stageEl;
    _wrapEl   = wrapEl;
    _imageUrls = imageUrls || [];
    _pdfDoc   = pdfDoc;
    _pageCount = pageCount;
    _onModelChange = onModelChange || (() => {});
    insp = inspector || {};
    _currentPage = 0;
    _selectedId = null;

    buildPageStrip(pageStripEl, pageCount, null);
    updateEditorPageImage();
    renderStage();
    bindInspectorEvents();
    updateInspector();
  }

  /** Add a new element of given type to the current page. */
  function addElement(type) {
    const el = defaultEl(type);
    getEls(_currentPage).push(el);
    const stageRect = _stageEl?.getBoundingClientRect();
    const div = buildDomEl(el, stageRect?.width || 400, stageRect?.height || 600);
    _stageEl?.querySelector('.ed-empty-hint')?.remove();
    _stageEl?.append(div);
    select(el.id);
    updatePageStrip(_stageEl?.closest('.workspace')?.querySelector('.page-strip'));
    _onModelChange();
    return el;
  }

  /** Delete the currently selected element. */
  function deleteSelected() {
    if (!_selectedId) return;
    const idx = getEls(_currentPage).findIndex(e => e.id === _selectedId);
    if (idx !== -1) getEls(_currentPage).splice(idx, 1);
    _stageEl?.querySelector(`[data-id="${_selectedId}"]`)?.remove();
    select(null);
    if (getEls(_currentPage).length === 0) renderStage(); // show hint
    updatePageStrip(_stageEl?.closest('.workspace')?.querySelector('.page-strip'));
    _onModelChange();
  }

  /** Clear all elements from current page. */
  function clearPage() {
    pages[_currentPage] = { elements: [] };
    renderStage();
    select(null);
    _onModelChange();
  }

  /** Extract text from PDF for current page (auto-populate elements). */
  async function extractCurrentPage() {
    if (!_pdfDoc) return;
    const existing = getEls(_currentPage);
    const extracted = await extractTextForPage(_currentPage, _pdfDoc);
    if (!extracted.length) return;
    extracted.forEach(el => existing.push(el));
    renderStage();
    // re-select none
    select(null);
    updatePageStrip(_stageEl?.closest('.workspace')?.querySelector('.page-strip'));
    _onModelChange();
    return extracted.length;
  }

  /** Extract text from ALL pages of the PDF. Returns count map. */
  async function extractAllPages(onProgress) {
    if (!_pdfDoc) return;
    let total = 0;
    for (let i = 0; i < _pageCount; i++) {
      onProgress?.(`Extracting page ${i + 1} / ${_pageCount}…`);
      const els = await extractTextForPage(i, _pdfDoc);
      if (els.length) { getPage(i).elements.push(...els); total += els.length; }
    }
    renderStage();
    select(null);
    updatePageStrip(_stageEl?.closest('.workspace')?.querySelector('.page-strip'));
    _onModelChange();
    return total;
  }

  /** Navigate editor to a specific page. */
  function setPage(index) {
    if (index < 0 || index >= _pageCount) return;
    _currentPage = index;
    _selectedId = null;
    updateEditorPageImage();
    renderStage();
    select(null);
    updatePageStrip(_stageEl?.closest('.workspace')?.querySelector('.page-strip'));
    if (insp.status) insp.status.textContent = `Editing page ${index + 1} of ${_pageCount}`;
  }

  /** Return serializable model (pages object). */
  function getModel() {
    // Deep clone only pages with elements
    const out = {};
    for (const [k, v] of Object.entries(pages)) {
      if (v.elements?.length) out[k] = { elements: v.elements.map(e => ({ ...e, style: { ...e.style }, animation: { ...e.animation }, link: e.link ? { ...e.link } : null })) };
    }
    return out;
  }

  /** Load model from saved project.pages data. */
  function loadModel(pagesData) {
    pages = {};
    if (pagesData && typeof pagesData === 'object') {
      for (const [k, v] of Object.entries(pagesData)) {
        if (v?.elements?.length) {
          pages[k] = { elements: v.elements.map(e => ({ ...e, style: { ...e.style }, animation: { ...e.animation }, link: e.link ? { ...e.link } : null })) };
        }
      }
    }
    renderStage();
    select(null);
  }

  /** Reset everything (new PDF opened). */
  function reset(pageCount, imageUrls, pdfDoc) {
    pages = {};
    _pageCount = pageCount;
    _imageUrls = imageUrls || [];
    _pdfDoc = pdfDoc;
    _currentPage = 0;
    _selectedId = null;
  }

  /** Update image URLs (e.g. after PDF reload). */
  function setImageUrls(urls) { _imageUrls = urls || []; }

  /** Get current page index. */
  function getCurrentPage() { return _currentPage; }

  return { init, addElement, deleteSelected, clearPage, extractCurrentPage, extractAllPages, setPage, getModel, loadModel, reset, setImageUrls, getCurrentPage };
})();
globalThis.FlipbookEditor = FlipbookEditor;
