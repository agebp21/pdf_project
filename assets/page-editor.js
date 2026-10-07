'use strict';
// Editor PDF (editor.html): each page opens as editable pieces — text blocks
// you click into and type (like Word), images and shapes you move, resize,
// rotate, replace or delete (like PowerPoint) — over a cleaned background.
// Saving rebuilds only the pages you changed (PageEditorCore.exportPdf).
(() => {
  const C = globalThis.PageEditorCore;
  const $ = s => document.querySelector(s);
  const L = (en, id) => (globalThis.I18N && I18N.pick ? I18N.pick(en, id) : id);
  const CSS_FONT = { sans: 'Arial, Helvetica, sans-serif', serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace' };
  const st = { pdf: null, bytes: null, name: 'dokumen.pdf', pages: [], cur: -1, sel: null, zoom: 1, past: [], future: [],
    from: new URLSearchParams(location.search).get('from') || '' };
  let uid = 1;
  const newId = () => 'e' + (uid++);

  function status(text) { const el = $('#pe-status'); if (el) el.textContent = text || ''; }
  const page = () => st.pages[st.cur];
  const els = () => (page() ? page().elements : []);
  const find = id => els().find(e => e.id === id);

  // ---- open a PDF ---------------------------------------------------------------------
  async function open(blob, name) {
    st.bytes = new Uint8Array(await blob.arrayBuffer());
    st.name = name || 'dokumen.pdf';
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
    st.pdf = await pdfjsLib.getDocument({ data: st.bytes.slice() }).promise;
    st.pages = [];
    for (let i = 0; i < st.pdf.numPages; i++) {
      const p = await st.pdf.getPage(i + 1), v = p.getViewport({ scale: 1 });
      st.pages.push({ index: i, size: [v.width, v.height], ready: false, edited: false, elements: [], bg: null, thumb: null });
    }
    $('#pe-start').hidden = true; $('#pe-app').hidden = false;
    document.title = st.name + ' — Editor PDF';
    renderThumbs(); thumbsLazy();
    const want = Number(new URLSearchParams(location.search).get('page')) || 1;
    await go(Math.min(st.pages.length, Math.max(1, want)) - 1);
  }

  async function thumbsLazy() {
    for (const pg of st.pages) {
      if (pg.thumb) continue;
      const p = await st.pdf.getPage(pg.index + 1), v = p.getViewport({ scale: 1 }), vp = p.getViewport({ scale: 130 / v.width });
      const c = Object.assign(document.createElement('canvas'), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
      await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      pg.thumb = c.toDataURL('image/jpeg', 0.7); c.width = 0;
      renderThumbs();
    }
  }
  function renderThumbs() {
    const box = $('#pe-thumbs'); if (!box) return;
    box.replaceChildren(...st.pages.map((pg, i) => {
      const d = document.createElement('div');
      d.className = 'pe-thumb' + (i === st.cur ? ' on' : '');
      d.innerHTML = (pg.thumb ? `<img src="${pg.thumb}" alt="">` : '<div style="height:90px"></div>') + `${i + 1}${pg.edited ? '<span class="dot" title="Diubah"></span>' : ''}`;
      d.onclick = () => go(i);
      return d;
    }));
  }

  // ---- turn a page into pieces ------------------------------------------------------------
  function imageBoxes(ops, vpTransform) {
    const U = pdfjsLib.Util, O = pdfjsLib.OPS, boxes = [], stack = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k], a = ops.argsArray[k];
      if (fn === O.save) stack.push(ctm.slice());
      else if (fn === O.restore) ctm = stack.pop() || ctm;
      else if (fn === O.transform) ctm = U.transform(ctm, a);
      else if (fn === O.paintFormXObjectBegin) { stack.push(ctm.slice()); if (a && a[0]) ctm = U.transform(ctm, a[0]); }
      else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
      else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageXObjectRepeat) {
        const m = U.transform(vpTransform, ctm);
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        boxes.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
      }
    }
    return boxes;
  }

  async function prepare(pg) {
    if (pg.ready) return;
    const p = await st.pdf.getPage(pg.index + 1), base = p.getViewport({ scale: 1 });
    const scale = Math.min(3, 1700 / Math.max(base.width, base.height)), vp = p.getViewport({ scale });
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvasContext: ctx, viewport: vp }).promise;
    const W = canvas.width, H = canvas.height;
    const original = Object.assign(document.createElement('canvas'), { width: W, height: H });
    original.getContext('2d').drawImage(canvas, 0, 0);

    // Text: the PDF's own text, or OCR for scanned pages.
    const content = await p.getTextContent();
    const items = [];
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const t = pdfjsLib.Util.transform(vp.transform, it.transform);
      if (Math.abs(t[1]) > Math.abs(t[0]) * 0.2 || Math.abs(t[2]) > Math.abs(t[3]) * 0.2) continue;      // rotated text stays in the background
      const h = Math.hypot(t[2], t[3]);
      let fname = (content.styles[it.fontName] || {}).fontFamily || '';
      try { const fo = p.commonObjs.get(it.fontName); if (fo && fo.name) fname = fo.name + ' ' + fname; } catch (e) {}
      items.push({ str: it.str, x: t[4], y: t[5] - h * 0.82, w: (it.width || 0) * scale, h, size: h, family: C.family(fname),
        bold: /bold|black|heavy|semibold|demi/i.test(fname), italic: /italic|oblique/i.test(fname) });
    }
    let lines = C.groupLines(items);
    if (!lines.length) {
      status(L('Scanned page: reading the text (OCR)…', 'Halaman hasil scan: membaca teks (OCR)…'));
      const found = await AnimationOCR.read(canvas, e => { if (e.status === 'recognizing text') status(L('OCR ', 'OCR ') + Math.round((e.progress || 0) * 100) + '%'); });
      lines = found.map(l => ({ text: C.clean(l.text), x: l.bbox.x0, y: l.bbox.y0, w: l.bbox.x1 - l.bbox.x0, h: l.bbox.y1 - l.bbox.y0, size: (l.bbox.y1 - l.bbox.y0) * 0.92, family: 'sans' }));
    }

    // Pictures in the page become movable images (not full-page backgrounds).
    let pictures = [];
    try {
      pictures = imageBoxes(await p.getOperatorList(), vp.transform).map(b => ({ x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(W, b.x1), y1: Math.min(H, b.y1) }))
        .filter(b => { const a = (b.x1 - b.x0) * (b.y1 - b.y0) / (W * H); return a > 0.004 && a < 0.8; });
    } catch (e) {}
    const imgEls = pictures.map(b => {
      const c = Object.assign(document.createElement('canvas'), { width: Math.round(b.x1 - b.x0), height: Math.round(b.y1 - b.y0) });
      c.getContext('2d').drawImage(original, b.x0, b.y0, c.width, c.height, 0, 0, c.width, c.height);
      const src = c.toDataURL('image/jpeg', 0.92); c.width = 0;
      return { id: newId(), type: 'image', x: b.x0 / W, y: b.y0 / H, w: (b.x1 - b.x0) / W, h: (b.y1 - b.y0) / H, src, rotation: 0 };
    });

    // Clean the background under every line and picture (colours come back per line).
    const lineBoxes = lines.map(l => ({ x0: l.x, y0: l.y, x1: l.x + l.w, y1: l.y + l.h }));
    const colors = AnimationOCR.repair(canvas, [...lineBoxes, ...pictures.map(b => ({ ...b, padding: 2 }))]);
    lines.forEach((l, i) => { l.color = colors[i]; });
    const blocks = C.paragraphs(lines);
    const measure = document.createElement('canvas').getContext('2d');
    const textEls = blocks.map(b => {
      let size = b.size;
      // Our fonts may run wider than the PDF's own: shrink a little rather than reflow.
      measure.font = `${b.italic ? 'italic ' : ''}${b.bold ? '700 ' : ''}${size}px ${CSS_FONT[b.family] || CSS_FONT.sans}`;
      const words = b.text.split(' '), perLine = Math.ceil(words.length / b.lines);
      let widest = 0; for (let i = 0; i < words.length; i += perLine) widest = Math.max(widest, measure.measureText(words.slice(i, i + perLine).join(' ')).width);
      if (b.lines === 1 && widest > b.w) size *= Math.max(0.8, b.w / widest);
      // Keep the first line's baseline where it was (the editor and the PDF share this offset).
      const lh = b.lineHeight || C.LINE, top = b.y + b.size * 0.82 - size * C.baseline(lh);
      return { id: newId(), type: 'text', x: b.x / W, y: Math.max(0, top) / H, w: Math.min(1 - b.x / W, (b.w + size * 0.6) / W), h: b.h / H, text: b.text,
        fontSize: size / H, family: b.family || 'sans', bold: !!b.bold, italic: !!b.italic, color: b.color || '#1c1917', align: 'left', lineHeight: b.lineHeight || C.LINE };
    });
    pg.bg = canvas.toDataURL('image/jpeg', 0.9);
    pg.original = original.toDataURL('image/jpeg', 0.9);
    canvas.width = original.width = 0;
    pg.elements = [...imgEls, ...textEls];
    pg.initial = JSON.stringify(pg.elements); pg.initialBg = pg.bg;
    pg.ready = true;
    p.cleanup();
  }

  async function go(i) {
    if (i < 0 || i >= st.pages.length) return;
    commitTyping();
    st.cur = i; st.sel = null; st.past = []; st.future = [];
    renderThumbs();
    const stage = $('#pe-stage');
    stage.innerHTML = '<div class="pe-busy">' + L('Preparing the page…', 'Menyiapkan halaman…') + '</div>';
    sizeStage();
    try { await prepare(page()); status(L('Click any text to type. Drag pictures to move them.', 'Klik teks mana saja untuk mengetik. Seret gambar untuk memindahkan.')); }
    catch (e) { status(L('This page could not be prepared: ', 'Halaman ini tidak bisa disiapkan: ') + (e.message || e)); }
    if (st.cur === i) render();
  }

  // ---- drawing the stage --------------------------------------------------------------------
  function sizeStage() {
    const pg = page(), stage = $('#pe-stage'), desk = $('#pe-desk');
    if (!pg || !stage || !desk) return;
    const [W, H] = pg.size, avail = Math.max(280, desk.clientWidth - 44), tall = Math.max(420, innerHeight - 190);
    const width = Math.min(avail, tall * W / H) * st.zoom;
    stage.style.width = width + 'px'; stage.style.height = width * H / W + 'px';
  }
  const stageH = () => $('#pe-stage').getBoundingClientRect().height || 1;

  function render() {
    const pg = page(), stage = $('#pe-stage');
    if (!pg || !pg.ready) return;
    sizeStage();
    stage.replaceChildren();
    const bg = document.createElement('img'); bg.className = 'pe-bg'; bg.src = pg.bg; bg.alt = ''; stage.append(bg);
    for (const el of pg.elements) stage.append(build(el));
    toolbar();
  }

  function place(div, el) {
    div.style.left = el.x * 100 + '%'; div.style.top = el.y * 100 + '%'; div.style.width = el.w * 100 + '%';
    if (el.type === 'text') div.style.minHeight = el.h * 100 + '%'; else div.style.height = el.h * 100 + '%';
    div.style.transform = el.rotation ? `rotate(${el.rotation}deg)` : '';
  }
  function styleText(node, el) {
    const H = stageH();
    Object.assign(node.style, { fontFamily: CSS_FONT[el.family] || CSS_FONT.sans, fontSize: el.fontSize * H + 'px', lineHeight: String(el.lineHeight || C.LINE),
      fontWeight: el.bold ? '700' : '400', fontStyle: el.italic ? 'italic' : 'normal', color: el.color || '#1c1917', textAlign: el.align || 'left' });
  }
  function build(el) {
    const div = document.createElement('div');
    div.className = 'pe-el pe-' + el.type + (st.sel === el.id ? ' sel' : ''); div.dataset.id = el.id;
    place(div, el);
    if (el.type === 'text') {
      const t = document.createElement('div'); t.className = 'pe-txt'; t.contentEditable = 'true'; t.spellcheck = false;
      t.textContent = el.text; styleText(t, el); div.append(t);
      t.addEventListener('focus', () => select(el.id, false));
      t.addEventListener('blur', commitTyping);
      t.addEventListener('input', () => { el.text = t.innerText.replace(/\n$/, ''); touched(true); grow(div, el); });
      t.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); } if (e.key === 'Escape') t.blur(); });
      t.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });
    } else if (el.type === 'image') {
      const img = document.createElement('img'); img.src = el.src; img.alt = ''; img.draggable = false; div.append(img);
      div.style.opacity = el.opacity ?? 1;
    } else if (el.type === 'line') {
      div.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%;overflow:visible"><line x1="0" y1="100" x2="100" y2="0" stroke="${el.stroke}" stroke-width="${Math.max(1, (el.strokeWidth || .003) * stageH())}" vector-effect="non-scaling-stroke"/></svg>`;
    } else {
      div.style.background = el.fill || 'transparent';
      div.style.border = el.stroke && el.strokeWidth ? `${Math.max(1, el.strokeWidth * stageH())}px solid ${el.stroke}` : 'none';
    }
    for (const h of ['nw', 'ne', 'sw', 'se'].concat(el.type === 'text' ? ['move'] : ['rot'])) {
      const hd = document.createElement('div'); hd.className = 'pe-h'; hd.dataset.h = h; div.append(hd);
    }
    div.addEventListener('pointerdown', e => down(e, el, div));
    return div;
  }
  function grow(div, el) { el.h = Math.max(el.h, div.getBoundingClientRect().height / stageH()); }

  // ---- select / drag / resize / rotate -----------------------------------------------------------
  function select(id, rerender = true) {
    if (st.sel === id) return;
    st.sel = id;
    document.querySelectorAll('#pe-stage .pe-el').forEach(d => d.classList.toggle('sel', d.dataset.id === id));
    toolbar();
  }
  function down(e, el, div) {
    if (cutting) return;                                                  // the desk handles the cut
    const handle = e.target.closest('.pe-h');
    const onText = e.target.closest('.pe-txt');
    if (onText && !handle) { select(el.id); return; }                  // caret goes where you clicked
    e.preventDefault(); e.stopPropagation();
    commitTyping(); select(el.id);
    const stage = $('#pe-stage').getBoundingClientRect(), sx = e.clientX, sy = e.clientY, start = { ...el };
    const kind = handle ? handle.dataset.h : 'move';
    let moved = false;
    const move = ev => {
      const dx = (ev.clientX - sx) / stage.width, dy = (ev.clientY - sy) / stage.height;
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 2) { moved = true; snapshot(); }
      if (!moved) return;
      if (kind === 'move') { el.x = start.x + dx; el.y = start.y + dy; }
      else if (kind === 'rot') {
        const r = div.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let deg = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
        if (!ev.shiftKey) deg = Math.round(deg / 5) * 5;
        el.rotation = ((Math.round(deg) % 360) + 360) % 360;
      } else {
        let { x, y, w, h } = start;
        if (kind.includes('e')) w = Math.max(0.02, start.w + dx);
        if (kind.includes('s')) h = Math.max(0.01, start.h + dy);
        if (kind.includes('w')) { w = Math.max(0.02, start.w - dx); x = start.x + start.w - w; }
        if (kind.includes('n')) { h = Math.max(0.01, start.h - dy); y = start.y + start.h - h; }
        if (el.type === 'image' && !ev.shiftKey) {                     // pictures keep their shape
          const ratio = start.h / start.w;
          h = w * ratio; if (kind.includes('n')) y = start.y + start.h - h;
        }
        Object.assign(el, { x, y, w, h });
      }
      place(div, el);
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (moved) { touched(); render(); }
      else if (el.type === 'text') { const t = div.querySelector('.pe-txt'); t && t.focus(); }
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  // ---- history -----------------------------------------------------------------------------------
  let typingSnap = null;
  const state = () => JSON.stringify({ e: els(), bg: page().bg });
  function snapshot() { st.past.push(state()); if (st.past.length > 60) st.past.shift(); st.future = []; }
  function touched(typing) {
    const pg = page(); if (!pg) return;
    if (typing) { if (!typingSnap) { typingSnap = true; snapshot(); } }
    if (!pg.edited) { pg.edited = true; renderThumbs(); }
  }
  function commitTyping() { typingSnap = null; }
  function restore(json) {
    const s = JSON.parse(json), pg = page();
    pg.elements = s.e; pg.bg = s.bg; st.sel = null;
    pg.edited = JSON.stringify(s.e) !== pg.initial || s.bg !== pg.initialBg;
    render(); renderThumbs();
  }
  function undo() { commitTyping(); if (!st.past.length) return; st.future.push(state()); restore(st.past.pop()); }
  function redo() { if (!st.future.length) return; st.past.push(state()); restore(st.future.pop()); }

  // ---- toolbar -------------------------------------------------------------------------------------
  function toolbar() {
    const el = find(st.sel), text = el && el.type === 'text', H = page() ? page().size[1] : 0;
    for (const id of ['#pe-family', '#pe-size', '#pe-bold', '#pe-italic', '#pe-align-left', '#pe-align-center', '#pe-align-right']) { const b = $(id); if (b) b.disabled = !text; }
    for (const id of ['#pe-delete', '#pe-front', '#pe-back', '#pe-color']) { const b = $(id); if (b) b.disabled = !el; }
    const fill = $('#pe-fill'); if (fill) fill.disabled = !(el && (el.type === 'rect' || el.type === 'ellipse'));
    const rep = $('#pe-replace'); if (rep) rep.parentElement.style.display = el && el.type === 'image' ? '' : 'none';
    if (text) {
      $('#pe-family').value = el.family || 'sans';
      $('#pe-size').value = Math.round(el.fontSize * H * 10) / 10;
      $('#pe-bold').classList.toggle('on', !!el.bold); $('#pe-italic').classList.toggle('on', !!el.italic);
      for (const a of ['left', 'center', 'right']) $('#pe-align-' + a).classList.toggle('on', (el.align || 'left') === a);
    }
    if (el) { const c = el.type === 'text' ? el.color : el.stroke; if (c && /^#[0-9a-f]{6}$/i.test(c)) $('#pe-color').value = c; if (el.fill && /^#[0-9a-f]{6}$/i.test(el.fill)) $('#pe-fill').value = el.fill; }
    $('#pe-undo').disabled = !st.past.length; $('#pe-redo').disabled = !st.future.length;
    $('#pe-zoom').textContent = Math.round(st.zoom * 100) + '%';
    $('#pe-reset').disabled = !(page() && page().edited);
  }
  function change(fn) {
    const el = find(st.sel); if (!el) return;
    commitTyping(); snapshot(); fn(el); touched(); render();
    if (el.type === 'text') { const t = document.querySelector(`#pe-stage [data-id="${el.id}"] .pe-txt`); t && t.focus(); }
  }
  function add(el) {
    if (!page() || !page().ready) return;
    commitTyping(); snapshot();
    el.id = newId(); els().push(el); touched(); st.sel = el.id; render();
    if (el.type === 'text') {
      const t = document.querySelector(`#pe-stage [data-id="${el.id}"] .pe-txt`);
      if (t) { t.focus(); const r = document.createRange(); r.selectNodeContents(t); getSelection().removeAllRanges(); getSelection().addRange(r); }
    }
  }
  async function readImage(file) {
    const url = URL.createObjectURL(file), img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(Error(L('This file is not an image.', 'File ini bukan gambar.'))); img.src = url; });
    const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * s), height: Math.round(img.naturalHeight * s) });
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    const png = /png|gif|webp|svg/i.test(file.type);
    const out = { src: c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9), ratio: c.height / c.width }; c.width = 0;
    return out;
  }

  // ✂ Area → picture: logos and drawings made of vector paths are not pictures in
  // the PDF; a box around them is cut from the original page and the background
  // under it repaired.
  let cutting = false;
  const loadImg = src => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
  function startCut(e) {
    const stage = $('#pe-stage'), r = stage.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;border:2px dashed #FF5C28;background:rgba(255,92,40,.08);z-index:9;pointer-events:none';
    stage.append(box);
    let b = null;
    const move = ev => {
      const x0 = Math.min(sx, ev.clientX) - r.left, y0 = Math.min(sy, ev.clientY) - r.top;
      b = { x: Math.max(0, x0 / r.width), y: Math.max(0, y0 / r.height), w: Math.abs(ev.clientX - sx) / r.width, h: Math.abs(ev.clientY - sy) / r.height };
      Object.assign(box.style, { left: b.x * 100 + '%', top: b.y * 100 + '%', width: b.w * 100 + '%', height: b.h * 100 + '%' });
    };
    const up = async () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); box.remove();
      cutting = false; $('#pe-cut').classList.remove('on'); stage.style.cursor = '';
      if (!b || b.w < 0.01 || b.h < 0.01) return;
      try { await cutArea(b); } catch (err) { status(err.message || String(err)); }
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
  async function cutArea(b) {
    const pg = page(), orig = await loadImg(pg.original), bg = await loadImg(pg.bg);
    const W = orig.naturalWidth, H = orig.naturalHeight, px = { x0: b.x * W, y0: b.y * H, x1: (b.x + b.w) * W, y1: (b.y + b.h) * H };
    const crop = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(px.x1 - px.x0)), height: Math.max(1, Math.round(px.y1 - px.y0)) });
    crop.getContext('2d').drawImage(orig, px.x0, px.y0, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const src = crop.toDataURL('image/png'); crop.width = 0;
    const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(bg, 0, 0, W, H);
    AnimationOCR.repair(canvas, [{ ...px, padding: 2 }]);
    snapshot();
    pg.bg = canvas.toDataURL('image/jpeg', 0.9); canvas.width = 0;
    const el = { id: newId(), type: 'image', x: b.x, y: b.y, w: b.w, h: b.h, src, rotation: 0 };
    els().push(el); touched(); st.sel = el.id; render();
    status(L('Done: the area is now a picture — drag it, resize it or delete it.', 'Selesai: area itu sekarang gambar — seret, ubah ukuran, atau hapus.'));
  }

  function wire() {
    $('#pe-file').onchange = e => { const f = e.target.files[0]; if (f) open(f, f.name).catch(err => status(err.message)); };
    $('#pe-undo').onclick = undo; $('#pe-redo').onclick = redo;
    $('#pe-add-text').onclick = () => add({ type: 'text', x: 0.3, y: 0.4, w: 0.4, h: 0.05, text: L('Type here', 'Ketik di sini'), fontSize: 14 / page().size[1], family: 'sans', color: '#1c1917', align: 'left', lineHeight: C.LINE });
    $('#pe-add-rect').onclick = () => add({ type: 'rect', x: 0.35, y: 0.4, w: 0.3, h: 0.12, fill: '#ffffff', stroke: '#1c1917', strokeWidth: 0.0025, rotation: 0 });
    $('#pe-add-ellipse').onclick = () => add({ type: 'ellipse', x: 0.38, y: 0.4, w: 0.24, h: 0.15, fill: '', stroke: '#FF5C28', strokeWidth: 0.003, rotation: 0 });
    $('#pe-add-line').onclick = () => add({ type: 'line', x: 0.3, y: 0.45, w: 0.4, h: 0.06, stroke: '#1c1917', strokeWidth: 0.003, rotation: 0 });
    $('#pe-add-image').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { const { src, ratio } = await readImage(f); const [W, H] = page().size, w = 0.4; add({ type: 'image', x: 0.3, y: 0.3, w, h: w * ratio * W / H, src, rotation: 0 }); }
      catch (err) { status(err.message); }
    };
    $('#pe-replace').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { const { src, ratio } = await readImage(f); change(el => { if (el.type !== 'image') return; el.src = src; const [W, H] = page().size; el.h = el.w * ratio * W / H; }); }
      catch (err) { status(err.message); }
    };
    $('#pe-family').onchange = e => change(el => { el.family = e.target.value; });
    $('#pe-size').onchange = e => change(el => { const v = Number(e.target.value); if (v > 0) el.fontSize = v / page().size[1]; });
    $('#pe-bold').onclick = () => change(el => { el.bold = !el.bold; });
    $('#pe-italic').onclick = () => change(el => { el.italic = !el.italic; });
    for (const a of ['left', 'center', 'right']) $('#pe-align-' + a).onclick = () => change(el => { el.align = a; });
    $('#pe-color').oninput = e => change(el => { if (el.type === 'text') el.color = e.target.value; else el.stroke = e.target.value; });
    $('#pe-fill').oninput = e => change(el => { el.fill = e.target.value; });
    $('#pe-front').onclick = () => change(el => { const a = els(); a.splice(a.indexOf(el), 1); a.push(el); });
    $('#pe-back').onclick = () => change(el => { const a = els(); a.splice(a.indexOf(el), 1); a.unshift(el); });
    $('#pe-delete').onclick = remove;
    $('#pe-zoom-in').onclick = () => { st.zoom = Math.min(3, st.zoom + 0.25); render(); };
    $('#pe-zoom-out').onclick = () => { st.zoom = Math.max(0.5, st.zoom - 0.25); render(); };
    $('#pe-reset').onclick = () => { if (!page()) return; snapshot(); page().elements = JSON.parse(page().initial); page().bg = page().initialBg; page().edited = false; st.sel = null; render(); renderThumbs(); };
    $('#pe-cut').onclick = () => { cutting = !cutting; $('#pe-cut').classList.toggle('on', cutting); $('#pe-stage').style.cursor = cutting ? 'crosshair' : '';
      if (cutting) status(L('Drag a box around a logo, chart or drawing: it becomes a picture you can move.', 'Seret kotak di sekitar logo, grafik, atau gambar: area itu menjadi gambar yang bisa dipindah.')); };
    $('#pe-save').onclick = () => save(st.from === 'organize' ? 'organize' : 'download');
    $('#pe-download').onclick = () => save('download');
    $('#pe-flipbook').onclick = () => save('flipbook');
    if (st.from === 'organize') { $('#pe-save').textContent = L('💾 Save & back to Organize', '💾 Simpan & kembali ke Organize'); $('#pe-download').hidden = false; }
    $('#pe-desk').addEventListener('pointerdown', e => {
      if (cutting && e.target.closest('#pe-stage')) { e.preventDefault(); e.stopPropagation(); startCut(e); return; }
      if (!e.target.closest('.pe-el')) { commitTyping(); select(null); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } });
    addEventListener('keydown', e => {
      const typing = document.activeElement && document.activeElement.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && st.sel && !/input|select|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); remove(); }
    });
    addEventListener('resize', () => { if (page() && page().ready) render(); });
  }
  // Leaving with unsaved changes asks first.
  let dirtyLeave = true;
  addEventListener('beforeunload', e => { if (dirtyLeave && st.pages.some(p => p.edited)) { e.preventDefault(); e.returnValue = ''; } });
  function remove() { const el = find(st.sel); if (!el) return; snapshot(); els().splice(els().indexOf(el), 1); st.sel = null; touched(); render(); }

  // ---- save ---------------------------------------------------------------------------------------------
  // where: 'download' | 'flipbook' | 'organize' (back to the Organize workspace with the edited PDF).
  async function save(where) {
    commitTyping();
    if (window.MFAuth) {
      try {
        const data = await MFAuth.me();
        if (data.user && !data.offline && MFAuth.trialWall(data.user)) return;
        if (!data.user && !data.offline) { MFAuth.loginPopup(() => save(where)); return; }
      } catch (e) {}
    }
    const edits = {};
    st.pages.forEach((pg, i) => { if (pg.edited && pg.ready) edits[i] = { size: pg.size, background: pg.bg, elements: pg.elements }; });
    const btns = ['#pe-save', '#pe-download', '#pe-flipbook'].map(s => $(s)).filter(Boolean); btns.forEach(b => b.disabled = true);
    status(L('Building the PDF…', 'Menyusun PDF…'));
    try {
      const { bytes, missing } = await C.exportPdf(st.bytes, edits, { report: true });
      const blob = new Blob([bytes], { type: 'application/pdf' }), name = st.name.replace(/\.pdf$/i, '') + '-edit.pdf';
      const note = missing.length ? L(` Some characters are not in the PDF fonts and became "?": ${missing.join(' ')}`, ` Beberapa huruf tidak ada di font PDF dan menjadi "?": ${missing.join(' ')}`) : '';
      if ((where === 'flipbook' || where === 'organize') && window.FlipbookTransfer) {
        const id = await FlipbookTransfer.save(blob, where === 'organize' ? st.name : name);
        dirtyLeave = false;
        location.href = where === 'organize' ? 'converter.html?tool=organize-pdf&source=' + encodeURIComponent(id)
          : 'flipbook.html?source=' + encodeURIComponent(id);
        return;
      }
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      const n = Object.keys(edits).length;
      status(L(`Saved: ${name} (${n} page(s) changed).`, `Tersimpan: ${name} (${n} halaman diubah).`) + note);
    } catch (e) { status(L('Could not save: ', 'Gagal menyimpan: ') + (e.message || e)); }
    finally { btns.forEach(b => b.disabled = false); }
  }

  async function boot() {
    wire();
    const id = new URLSearchParams(location.search).get('source');
    if (id && window.FlipbookTransfer) {
      try {
        const entry = await FlipbookTransfer.get(id);
        if (entry) { await open(entry.blob, entry.name); await FlipbookTransfer.remove(id); history.replaceState(null, '', location.pathname); }
      } catch (e) { status(e.message || String(e)); }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  globalThis.PageEditor = { open, state: st, go, save };
})();
