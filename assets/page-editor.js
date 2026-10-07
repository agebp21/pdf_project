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
    // fontExtraProperties keeps each font's file: text keeps the PDF's own font.
    st.pdf = await pdfjsLib.getDocument({ data: st.bytes.slice(), fontExtraProperties: true }).promise;
    st.fonts = {};
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
  // Pictures painted on the page: the decoded picture (pdf.js objs) and where it lands.
  function pictureOps(ops, vpTransform) {
    const U = pdfjsLib.Util, O = pdfjsLib.OPS, out = [], stack = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k], a = ops.argsArray[k];
      if (fn === O.save) stack.push(ctm.slice());
      else if (fn === O.restore) ctm = stack.pop() || ctm;
      else if (fn === O.transform) ctm = U.transform(ctm, a);
      else if (fn === O.paintFormXObjectBegin) { stack.push(ctm.slice()); if (a && a[0]) ctm = U.transform(ctm, a[0]); }
      else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
      else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject) {
        const m = U.transform(vpTransform, ctm);
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
        const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
        out.push({ m, ref: fn === O.paintImageXObject ? a[0] : a[0], inline: fn === O.paintInlineImageXObject,
          box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } });
      }
    }
    return out;
  }
  // The picture itself (no panels or text over it), drawn the way the page shows it.
  function pictureSrc(p, op) {
    let obj = op.inline ? op.ref : null;
    if (!obj) try { obj = String(op.ref).startsWith('g_') ? p.commonObjs.get(op.ref) : p.objs.get(op.ref); } catch (e) { return null; }
    if (!obj) return null;
    let source = obj.bitmap || null;
    const iw = obj.width || (source && source.width), ih = obj.height || (source && source.height);
    if (!iw || !ih) return null;
    if (!source && obj.data && (obj.kind === 2 || obj.kind === 3)) {
      const c = Object.assign(document.createElement('canvas'), { width: iw, height: ih }), g = c.getContext('2d'), img = g.createImageData(iw, ih);
      if (obj.kind === 3) img.data.set(obj.data.subarray(0, iw * ih * 4));
      else for (let i = 0, j = 0; i < iw * ih; i++, j += 3) { img.data[i * 4] = obj.data[j]; img.data[i * 4 + 1] = obj.data[j + 1]; img.data[i * 4 + 2] = obj.data[j + 2]; img.data[i * 4 + 3] = 255; }
      g.putImageData(img, 0, 0); source = c;
    }
    if (!source) return null;
    const { box, m } = op, bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    const f = Math.max(1, Math.min(2.5, iw / Math.max(1, bw), 2400 / Math.max(bw, bh)));
    const c = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(bw * f)), height: Math.max(1, Math.round(bh * f)) });
    const g = c.getContext('2d');
    g.setTransform(f, 0, 0, f, -box.x0 * f, -box.y0 * f);
    g.transform(m[0] / iw, m[1] / iw, -m[2] / ih, -m[3] / ih, m[2] + m[4], m[3] + m[5]);
    g.drawImage(source, 0, 0, iw, ih);
    // Keep transparency only when the picture has any.
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let clear = false; for (let i = 3; i < px.length; i += 4 * 97) if (px[i] < 245) { clear = true; break; }
    const src = c.toDataURL(clear ? 'image/png' : 'image/jpeg', 0.9); c.width = 0;
    return src;
  }
  // Two renders with the pictures replaced by key colours -> the page's design layer
  // (panels, lines, logos), transparent where pictures show through.
  async function keyedDocs() {
    if (st.keyed) return st.keyed;
    const png = rgb => { const k = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }), g = k.getContext('2d');
      g.fillStyle = `rgb(${rgb.join(',')})`; g.fillRect(0, 0, 1, 1); return Uint8Array.from(atob(k.toDataURL('image/png').split(',')[1]), ch => ch.charCodeAt(0)); };
    const a = await C.keyPictures(st.bytes, png(C.KEY1)), b = await C.keyPictures(st.bytes, png(C.KEY2));
    st.keyed = [await pdfjsLib.getDocument({ data: a.bytes }).promise, await pdfjsLib.getDocument({ data: b.bytes }).promise];
    return st.keyed;
  }
  async function renderData(doc, index, vp) {
    const pg = await doc.getPage(index + 1);
    const c = Object.assign(document.createElement('canvas'), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
    const g = c.getContext('2d', { willReadFrequently: true });
    await pg.render({ canvasContext: g, viewport: pg.getViewport({ scale: vp.scale }) }).promise;
    const d = g.getImageData(0, 0, c.width, c.height); c.width = 0; pg.cleanup();
    return d;
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
    const original = ctx.getImageData(0, 0, W, H);

    // Text: the PDF's own text, or OCR for scanned pages.
    const content = await p.getTextContent();
    const items = [];
    // Does the PDF's own font draw these characters? Missing ones fall back to the
    // second family, so two different fallbacks measure differently.
    const probe = document.createElement('canvas').getContext('2d');
    const drawable = (key, s) => {
      s = s.replace(/\s+/g, '');
      probe.font = `40px "${key}", monospace`; const a = probe.measureText(s).width;
      probe.font = `40px "${key}", serif`; return Math.abs(a - probe.measureText(s).width) < 0.5;
    };
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const t = pdfjsLib.Util.transform(vp.transform, it.transform);
      if (Math.abs(t[1]) > Math.abs(t[0]) * 0.2 || Math.abs(t[2]) > Math.abs(t[3]) * 0.2) continue;      // rotated text stays in the background
      const h = Math.hypot(t[2], t[3]);
      let fname = (content.styles[it.fontName] || {}).fontFamily || '', font;
      try {
        const fo = p.commonObjs.get(it.fontName);
        if (fo && fo.name) fname = fo.name + ' ' + fname;
        // Artwork lettering (Type3 glyphs, or a font whose characters do not match its
        // shapes) stays in the background: as text it would come out as other letters.
        if (fo && fo.isType3Font) continue;
        // An embedded font pdf.js loaded into the page (its FontFace is named loadedName).
        if (fo && fo.data && fo.loadedName && !fo.missingFile) {
          if (!drawable(fo.loadedName, it.str)) continue;
          font = fo.loadedName;
          st.fonts[font] ||= { data: fo.data, name: String(fo.name || '').replace(/^[A-Z]{6}\+/, '').replace(/-\d+$/, '') };
        }
      } catch (e) {}
      items.push({ str: it.str, x: t[4], y: t[5] - h * 0.82, w: (it.width || 0) * scale, h, size: h, em: Math.hypot(t[0], t[1]), font, family: C.family(fname),
        bold: /bold|black|heavy|semibold|demi/i.test(fname), italic: /italic|oblique/i.test(fname) });
    }
    let lines = C.groupLines(items);
    let ops = [];
    try { ops = pictureOps(await p.getOperatorList(), vp.transform); } catch (e) {}
    const area = o => (o.box.x1 - o.box.x0) * (o.box.y1 - o.box.y0) / (W * H);
    // OCR only for a scan (a picture over most of the page). A page without text that
    // is not a scan (a title drawn as artwork) stays design: OCR there reads nonsense.
    const scanned = !content.items.some(it => it.str && it.str.trim()) && ops.some(o => area(o) > 0.5);
    if (scanned) {
      status(L('Scanned page: reading the text (OCR)…', 'Halaman hasil scan: membaca teks (OCR)…'));
      const found = await AnimationOCR.read(canvas, e => { if (e.status === 'recognizing text') status(L('OCR ', 'OCR ') + Math.round((e.progress || 0) * 100) + '%'); });
      lines = found.filter(l => l.confidence >= 75 && (l.text.match(/[\p{L}\p{N}]/gu) || []).length >= 2)
        .map(l => ({ text: C.clean(l.text), x: l.bbox.x0, y: l.bbox.y0, w: l.bbox.x1 - l.bbox.x0, h: l.bbox.y1 - l.bbox.y0, size: (l.bbox.y1 - l.bbox.y0) * 0.92, family: 'sans' }));
    }

    // Pictures become movable, replaceable images under the page's design.
    // (A scanned page's full-page picture holds its text: it stays the background.)
    ops = ops.filter(o => area(o) > 0.004 && !(scanned && area(o) > 0.6));
    const imgEls = [];
    for (const o of ops) {
      const src = pictureSrc(p, o);
      if (!src) continue;
      const b = { x0: Math.max(0, o.box.x0), y0: Math.max(0, o.box.y0), x1: Math.min(W, o.box.x1), y1: Math.min(H, o.box.y1) };
      imgEls.push({ id: newId(), type: 'image', under: true, x: o.box.x0 / W, y: o.box.y0 / H, w: (o.box.x1 - o.box.x0) / W, h: (o.box.y1 - o.box.y0) / H, src, rotation: 0, clip: b });
    }
    let layer = null;
    if (imgEls.length) {
      try {
        status(L('Separating the pictures from the design…', 'Memisahkan gambar dari desain halaman…'));
        const [ka, kb] = await keyedDocs();
        const a = await renderData(ka, pg.index, vp), b = await renderData(kb, pg.index, vp);
        if (a.width === W && b.width === W) layer = C.unkey(a.data, b.data);
      } catch (e) { layer = null; }
    }
    if (!layer) imgEls.length = 0;                                       // could not separate: keep pictures in the background

    // Text colours from the page as printed; then the text leaves the design layer.
    const lineBoxes = lines.map(l => ({ x0: l.x, y0: l.y, x1: l.x + l.w, y1: l.y + l.h }));
    const colors = C.textColors(original.data, W, H, lineBoxes);
    lines.forEach((l, i) => { l.color = colors[i]; });
    const bgData = new ImageData(layer || new Uint8ClampedArray(original.data), W, H);
    C.repair(bgData.data, W, H, lineBoxes);
    ctx.clearRect(0, 0, W, H); ctx.putImageData(bgData, 0, 0);

    const blocks = C.paragraphs(lines);
    const measure = document.createElement('canvas').getContext('2d');
    const textEls = blocks.map(b => {
      let size = b.size;
      // Our fonts may run wider than the PDF's own (condensed fonts much wider):
      // a single line shrinks to fit and never wraps onto the line below.
      measure.font = b.font ? `${size}px "${b.font}", ${CSS_FONT[b.family] || CSS_FONT.sans}`
        : `${b.italic ? 'italic ' : ''}${b.bold ? '700 ' : ''}${size}px ${CSS_FONT[b.family] || CSS_FONT.sans}`;
      const words = b.text.split(' '), perLine = Math.ceil(words.length / b.lines);
      let widest = 0; for (let i = 0; i < words.length; i += perLine) widest = Math.max(widest, measure.measureText(words.slice(i, i + perLine).join(' ')).width);
      if (b.lines === 1 && widest > b.w) size *= Math.max(0.5, b.w / widest);
      const fitted = b.lines === 1 ? widest * size / b.size : b.w;
      // Keep the first line's baseline where it was (the editor and the PDF share this offset).
      const lh = b.lineHeight || C.LINE, top = b.y + b.size * 0.82 - size * C.baseline(lh);
      return { id: newId(), type: 'text', x: b.x / W, y: Math.max(0, top) / H, w: Math.min(1 - b.x / W, (Math.max(b.w, fitted) + size * 0.6) / W), h: b.h / H, text: b.text,
        fontSize: size / H, family: b.family || 'sans', bold: !!b.bold, italic: !!b.italic, color: b.color || '#1c1917', align: 'left', lineHeight: b.lineHeight || C.LINE,
        ...(b.font ? { font: b.font } : {}) };
    });
    pg.layered = !!layer;
    pg.bg = canvas.toDataURL(pg.layered ? 'image/png' : 'image/jpeg', 0.9);
    const oc = Object.assign(document.createElement('canvas'), { width: W, height: H }); oc.getContext('2d').putImageData(original, 0, 0);
    pg.original = oc.toDataURL('image/jpeg', 0.9); oc.width = 0;
    canvas.width = 0;
    pg.elements = [...imgEls.map(({ clip, ...e }) => e), ...textEls];
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
    for (const el of pg.elements) if (el.under) stage.append(build(el));
    const bg = document.createElement('img'); bg.className = 'pe-bg'; bg.src = pg.bg; bg.alt = ''; stage.append(bg);
    for (const el of pg.elements) if (!el.under) stage.append(build(el));
    // A selected picture under the design keeps its place in the layers; its frame
    // and handles are drawn on top so it can still be resized and turned.
    const sel = find(st.sel);
    if (sel && sel.under) {
      const ghost = document.createElement('div');
      ghost.className = 'pe-el pe-ghost sel'; ghost.dataset.id = sel.id; place(ghost, sel);
      for (const h of ['nw', 'ne', 'sw', 'se', 'rot']) { const hd = document.createElement('div'); hd.className = 'pe-h'; hd.dataset.h = h; ghost.append(hd); }
      ghost.addEventListener('pointerdown', e => down(e, sel, ghost));
      stage.append(ghost);
    }
    toolbar();
  }

  function place(div, el) {
    div.style.left = el.x * 100 + '%'; div.style.top = el.y * 100 + '%'; div.style.width = el.w * 100 + '%';
    if (el.type === 'text') div.style.minHeight = el.h * 100 + '%'; else div.style.height = el.h * 100 + '%';
    div.style.transform = el.rotation ? `rotate(${el.rotation}deg)` : '';
  }
  function styleText(node, el) {
    const H = stageH();
    // The PDF's own font already is bold/italic where it was: no faux styles on top.
    const own = el.font && st.fonts && st.fonts[el.font];
    Object.assign(node.style, { fontFamily: (own ? `"${el.font}", ` : '') + (CSS_FONT[el.family] || CSS_FONT.sans), fontSize: el.fontSize * H + 'px', lineHeight: String(el.lineHeight || C.LINE),
      fontWeight: !own && el.bold ? '700' : '400', fontStyle: !own && el.italic ? 'italic' : 'normal', color: el.color || '#1c1917', textAlign: el.align || 'left' });
  }
  function build(el) {
    const div = document.createElement('div');
    div.className = 'pe-el pe-' + el.type + (el.under ? ' pe-under' : '') + (st.sel === el.id ? ' sel' : ''); div.dataset.id = el.id;
    place(div, el);
    if (el.type === 'text') {
      const t = document.createElement('div'); t.className = 'pe-txt'; t.contentEditable = 'true'; t.spellcheck = false;
      t.textContent = el.text; styleText(t, el); div.append(t);
      let h0 = 0;                                                         // the text's height before this keystroke
      t.addEventListener('focus', () => { select(el.id, false); h0 = t.getBoundingClientRect().height; });
      t.addEventListener('blur', commitTyping);
      t.addEventListener('input', () => {
        el.text = t.innerText.replace(/\n$/, ''); touched(true);
        reflow(el, div, t, h0); h0 = t.getBoundingClientRect().height;
      });
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
  // Like Word: when a text block gets taller (Enter, a longer paragraph) or shorter,
  // everything below it moves down / up with it, except a parallel column (one that
  // runs beside the edited block, as in a two-column layout); whatever shares a row
  // with a moving block (a page number, an amount) moves along.
  function reflow(el, div, t, h0) {
    const H = stageH(), d = (t.getBoundingClientRect().height - h0) / H;
    if (!h0 || Math.abs(d) < 0.5 / H) { grow(div, el); return; }
    const bottom = el.y + h0 / H, below = els().filter(o => o !== el && o.y >= bottom - 0.002);
    const apart = o => o.x >= el.x + el.w || o.x + o.w <= el.x;
    const beside = els().filter(p => p !== el && apart(p) && p.y < bottom && p.y + p.h > el.y);
    const parallel = o => apart(o) && beside.some(p => p.x < o.x + o.w && p.x + p.w > o.x);
    const moving = new Set(below.filter(o => !parallel(o)));
    const short = o => o.type === 'text' && String(o.text).trim().split(/\s+/).length <= 2;
    for (const o of below) if (!moving.has(o) && short(o) && [...moving].some(m => Math.abs(m.y - o.y) < 0.004)) moving.add(o);
    for (const o of moving) {
      o.y = Math.max(0, o.y + d);
      document.querySelectorAll(`#pe-stage [data-id="${o.id}"]`).forEach(n => place(n, o));
    }
    el.h = Math.max(0.005, el.h + d); place(div, el);
  }

  // ---- select / drag / resize / rotate -----------------------------------------------------------
  function select(id, rerender = true) {
    if (st.sel === id) return;
    const was = find(st.sel), now = find(id);
    st.sel = id;
    if ((was && was.under) || (now && now.under)) { render(); return; }
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
        const r = (document.querySelector(`#pe-stage [data-id="${el.id}"]`) || div).getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
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
      document.querySelectorAll(`#pe-stage [data-id="${el.id}"]`).forEach(n => place(n, el));
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
      const fam = $('#pe-family'), own = el.font && st.fonts && st.fonts[el.font];
      let orig = fam.querySelector('option[value="orig"]');
      if (own) {
        if (!orig) { orig = document.createElement('option'); orig.value = 'orig'; fam.prepend(orig); }
        orig.textContent = L('Original: ', 'Asli: ') + (own.name || 'PDF');
        fam.value = 'orig';
      } else { if (orig) orig.remove(); fam.value = el.family || 'sans'; }
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
    const g = canvas.getContext('2d', { willReadFrequently: true }); g.drawImage(bg, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H); C.repair(d.data, W, H, [{ ...px, padding: 2 }]); g.putImageData(d, 0, 0);
    snapshot();
    pg.bg = canvas.toDataURL(pg.layered ? 'image/png' : 'image/jpeg', 0.9); canvas.width = 0;
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
    $('#pe-family').onchange = e => change(el => { if (e.target.value === 'orig') return; el.family = e.target.value; delete el.font; });
    $('#pe-size').onchange = e => change(el => { const v = Number(e.target.value); if (v > 0) el.fontSize = v / page().size[1]; });
    // Bold/italic are standard-font styles: the text leaves the PDF's own font.
    $('#pe-bold').onclick = () => change(el => { el.bold = !el.bold; delete el.font; });
    $('#pe-italic').onclick = () => change(el => { el.italic = !el.italic; delete el.font; });
    for (const a of ['left', 'center', 'right']) $('#pe-align-' + a).onclick = () => change(el => { el.align = a; });
    $('#pe-color').oninput = e => change(el => { if (el.type === 'text') el.color = e.target.value; else el.stroke = e.target.value; });
    $('#pe-fill').oninput = e => change(el => { el.fill = e.target.value; });
    // Front: a picture under the design comes above it; Back: to the bottom of its layer, then under the design.
    $('#pe-front').onclick = () => change(el => { const a = els(); a.splice(a.indexOf(el), 1); if (el.under) delete el.under; a.push(el); });
    $('#pe-back').onclick = () => change(el => {
      const a = els(), first = a.findIndex(e => !!e.under === !!el.under);
      if (a[first] === el && !el.under && el.type !== 'text') el.under = true;
      a.splice(a.indexOf(el), 1); a.unshift(el);
    });
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
      // The PDF's own fonts go back in with fontkit (loaded only when needed).
      const fonts = {};
      for (const e of Object.values(edits)) for (const el of e.elements) if (el.font && st.fonts[el.font]) fonts[el.font] = st.fonts[el.font].data;
      if (Object.keys(fonts).length && !window.fontkit) await new Promise(res => {
        const s = Object.assign(document.createElement('script'), { src: 'assets/vendor/fontkit.umd.min.js' });
        s.onload = s.onerror = res; document.head.append(s);
      });
      const { bytes, missing } = await C.exportPdf(st.bytes, edits, { report: true, fonts });
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
