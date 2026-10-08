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
  const st = { pdf: null, bytes: null, name: 'dokumen.pdf', pages: [], cur: -1, sel: null, group: [], picked: new Set(), oldDocs: [], zoom: 1, past: [], future: [],
    from: new URLSearchParams(location.search).get('from') || '' };
  let uid = 1;
  const newId = () => 'e' + (uid++);

  const NEW_NAME = () => L('new-document.pdf', 'dokumen-baru.pdf');
  function status(text) { const el = $('#pe-status'); if (el) el.textContent = text || ''; }
  const page = () => st.pages[st.cur];
  const els = () => (page() ? page().elements : []);
  const find = id => els().find(e => e.id === id);

  // ---- open: PDFs, pictures (photos of documents), or a blank document ----------------------
  const A4 = [595.28, 841.89];
  const isPdf = f => /pdf/i.test(f.type || '') || /\.pdf$/i.test(f.name || '');
  const fresh = () => ({ ready: false, edited: false, elements: [], bg: null, thumb: null });
  async function open(input, name) {
    const files = Array.isArray(input) ? input : [input];
    status(L('Opening…', 'Membuka…'));
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
    const bytes = files.length === 1 && isPdf(files[0]) ? new Uint8Array(await files[0].arrayBuffer()) : await bundle(files);
    st.name = name || ((files[0] && files[0].name) ? files[0].name.replace(/\.[^.]+$/, '') + '.pdf' : 'dokumen.pdf');
    st.fonts = {}; st.oldDocs = []; st.picked = new Set();
    await useBytes(bytes, null);
    if (!files.length) st.pages[0].blank = true;                         // a new document: its page waits for typing
    $('#pe-start').hidden = true; $('#pe-app').hidden = false;
    document.title = st.name + ' — ' + L('PDF Editor', 'Editor PDF');
    renderThumbs(); thumbsLazy();
    const want = Number(new URLSearchParams(location.search).get('page')) || 1;
    await go(Math.min(st.pages.length, Math.max(1, want)) - 1);
  }
  // Several files (PDFs and pictures) -> one PDF; a picture becomes an A4-wide page.
  async function bundle(files) {
    const lib = PDFLib, out = await lib.PDFDocument.create();
    for (const f of files) {
      if (isPdf(f)) {
        const src = await lib.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
        for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
      } else await imagePage(out, f);
    }
    if (!out.getPageCount()) out.addPage(A4);
    return out.save();
  }
  async function imagePage(out, file) {
    const url = URL.createObjectURL(file), img = new Image();
    try {
      await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(Error(L(`${file.name}: this picture format cannot be opened here (HEIC: convert it with Image to PDF first).`,
        `${file.name}: format gambar ini belum bisa dibuka di sini (HEIC: ubah dulu lewat Image to PDF).`))); img.src = url; });
    } finally { URL.revokeObjectURL(url); }
    const s = Math.min(1, 2600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * s), height: Math.round(img.naturalHeight * s) });
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const png = /png|gif|webp|svg/i.test(file.type || '');
    const data = Uint8Array.from(atob(c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.92).split(',')[1]), ch => ch.charCodeAt(0)); c.width = 0;
    const pic = png ? await out.embedPng(data) : await out.embedJpg(data);
    const W = A4[0], H = W * pic.height / pic.width, page = out.addPage([W, H]);
    page.drawImage(pic, { x: 0, y: 0, width: W, height: H });
  }
  // The working PDF: page i of st.bytes is st.pages[i]. Page edits live in the entries,
  // so pages can move, be added or removed and their edits go with them.
  async function useBytes(bytes, pages) {
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(), fontExtraProperties: true }).promise;
    if (st.pdf) st.oldDocs.push(st.pdf);                    // its fonts stay in use on prepared pages
    if (st.keyed) { st.keyed.forEach(d => d.destroy()); st.keyed = null; }
    st.bytes = bytes; st.pdf = doc;
    pages = pages || Array.from({ length: doc.numPages }, fresh);
    for (let i = 0; i < pages.length; i++) {
      const pg = pages[i]; pg.index = i;
      if (!pg.ready) { const v = (await doc.getPage(i + 1)).getViewport({ scale: 1 }); pg.size = [v.width, v.height]; }
    }
    st.pages = pages;
  }

  async function thumbsLazy() {
    const doc = st.pdf;
    for (const pg of st.pages) {
      if (st.pdf !== doc) return;                              // the document changed: a newer run takes over
      if (pg.thumb) continue;
      const p = await doc.getPage(pg.index + 1), v = p.getViewport({ scale: 1 }), vp = p.getViewport({ scale: 130 / v.width });
      const c = Object.assign(document.createElement('canvas'), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
      await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      if (st.pdf !== doc) return;
      pg.thumb = c.toDataURL('image/jpeg', 0.7); c.width = 0;
      renderThumbs();
    }
  }

  // ---- the page sidebar: pick, drag to reorder, drop files, right-click menu --------------------
  function renderThumbs() {
    const box = $('#pe-thumbs'); if (!box) return;
    const items = st.pages.map((pg, i) => {
      const d = document.createElement('div');
      d.className = 'pe-thumb' + (i === st.cur ? ' on' : '') + (st.picked.has(i) ? ' picked' : '');
      d.draggable = true; d.dataset.i = i;
      const mini = pg.ready && pg.edited ? miniPage(pg) : null;
      d.innerHTML = (mini ? '' : pg.thumb ? `<img src="${pg.thumb}" alt="" draggable="false">` : '<div class="pe-thumb-wait"></div>')
        + `<span>${i + 1}${pg.edited ? `<span class="dot" title="${L('Changed', 'Diubah')}"></span>` : ''}</span>`
        + `<button class="pe-more" title="${L('Page menu', 'Menu halaman')}">⋯</button>`;
      if (mini) d.prepend(mini);
      d.onclick = e => pick(e, i);
      d.oncontextmenu = e => { e.preventDefault(); if (!st.picked.has(i)) { st.picked = new Set([i]); renderThumbs(); } pageMenu(e.clientX, e.clientY, i); };
      d.querySelector('.pe-more').onclick = e => {
        e.stopPropagation(); if (!st.picked.has(i)) { st.picked = new Set([i]); renderThumbs(); }
        const r = e.currentTarget.getBoundingClientRect(); pageMenu(r.left, r.bottom + 4, i);
      };
      d.ondragstart = e => { if (!st.picked.has(i)) { st.picked = new Set([i]); } dragPages = [...st.picked]; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'pages'); };
      d.ondragend = () => { dragPages = null; dropMark(null); };
      return d;
    });
    const tools = document.createElement('div'); tools.className = 'pe-thumb-tools';
    tools.innerHTML = `<button type="button" data-act="blank">＋ ${L('Blank page', 'Halaman kosong')}</button>`
      + `<button type="button" data-act="insert">📄 ${L('Insert PDF / picture', 'Sisipkan PDF / gambar')}</button>`;
    tools.querySelector('[data-act=blank]').onclick = () => addBlank(st.pages.length - 1);
    tools.querySelector('[data-act=insert]').onclick = () => pickFiles(st.pages.length);
    box.replaceChildren(...items, tools);
  }
  // A changed page's thumbnail shows its pieces (the PDF's own picture of it is out of date).
  const minis = new WeakMap();
  let thumbTimer = 0;
  function miniPage(pg) {
    const sig = pg.bg.length + '|' + JSON.stringify(pg.elements), hit = minis.get(pg);
    if (hit && hit.sig === sig) return hit.node;
    const W = 126, H = W * pg.size[1] / pg.size[0], node = document.createElement('div');
    node.className = 'pe-mini'; node.style.height = H + 'px';
    for (const el of pg.elements) if (el.under) node.append(build(el, H));
    const bg = document.createElement('img'); bg.className = 'pe-bg'; bg.src = pg.bg; bg.alt = ''; node.append(bg);
    for (const el of pg.elements) if (!el.under) node.append(build(el, H));
    minis.set(pg, { sig, node });
    return node;
  }
  let dragPages = null, anchor = 0;
  function pick(e, i) {
    if (e.ctrlKey || e.metaKey) { st.picked.has(i) ? st.picked.delete(i) : st.picked.add(i); if (!st.picked.size) st.picked.add(i); anchor = i; renderThumbs(); return; }
    if (e.shiftKey) { st.picked = new Set(); for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) st.picked.add(k); renderThumbs(); return; }
    st.picked = new Set([i]); anchor = i; go(i, true);
  }
  // Where a drop lands: before the thumbnail under the pointer (or after it, past its middle).
  function dropAt(e) {
    const t = e.target.closest && e.target.closest('.pe-thumb');
    if (!t) return st.pages.length;
    const r = t.getBoundingClientRect(), across = getComputedStyle($('#pe-thumbs')).display === 'flex';
    const after = across ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    return Number(t.dataset.i) + (after ? 1 : 0);
  }
  function dropMark(at) {
    document.querySelectorAll('#pe-thumbs .pe-thumb').forEach(n => n.classList.remove('drop-before', 'drop-after'));
    if (at === null) return;
    const all = document.querySelectorAll('#pe-thumbs .pe-thumb');
    if (at < all.length) all[at].classList.add('drop-before'); else if (all.length) all[all.length - 1].classList.add('drop-after');
  }
  function pickFiles(at) {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: 'application/pdf,.pdf,image/*' });
    input.onchange = () => { const files = [...input.files]; if (files.length) insertFiles(files, at); };
    input.click();
  }
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function pageMenu(x, y, i) {
    closeMenu();
    const idxs = [...st.picked].sort((a, b) => a - b), n = idxs.length, last = idxs[n - 1];
    const items = [
      [L('Blank page after', 'Halaman kosong sesudahnya'), () => addBlank(last)],
      [L('Insert PDF / pictures after', 'Sisipkan PDF / gambar sesudahnya'), () => pickFiles(last + 1)],
      [n > 1 ? L(`Duplicate ${n} pages`, `Duplikat ${n} halaman`) : L('Duplicate', 'Duplikat'), () => duplicate(idxs)],
      [L('Rotate 90°', 'Putar 90°'), () => rotate(idxs)],
      [n > 1 ? L(`Save these ${n} pages as a PDF`, `Simpan ${n} halaman ini jadi PDF`) : L('Save this page as a PDF', 'Simpan halaman ini jadi PDF'), () => save('download', { order: idxs })],
      ...(n === 1 ? [[L('Read the text (OCR)', 'Baca teks (OCR)'), () => ocrPage(i)]] : []),
      [n > 1 ? L(`Delete ${n} pages`, `Hapus ${n} halaman`) : L('Delete page', 'Hapus halaman'), () => removePages(idxs), 'danger'],
    ];
    showMenu(x, y, items);
  }
  // A small menu at (x, y): items are [label, action, class?, shortcut?]; null is a divider.
  function showMenu(x, y, items) {
    closeMenu();
    menuEl = document.createElement('div'); menuEl.className = 'pe-menu';
    for (const item of items) {
      if (!item) { menuEl.append(Object.assign(document.createElement('hr'), { className: 'pe-menu-sep' })); continue; }
      const [label, fn, cls, key] = item;
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls;
      if (key) b.append(Object.assign(document.createElement('kbd'), { textContent: key }));
      b.onclick = () => { closeMenu(); Promise.resolve(fn()).catch(err => status(err.message || String(err))); };
      menuEl.append(b);
    }
    document.body.append(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    menuEl.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  }

  // ---- page operations: the working PDF is rebuilt in the new order --------------------------------
  const same = () => st.pages.map(pg => ({ pg, index: pg.index }));
  async function restructure(list, focus) {
    commitTyping(); closeMenu();
    status(L('Updating the pages…', 'Memperbarui halaman…'));
    const lib = PDFLib, out = await lib.PDFDocument.create();
    const cur = await lib.PDFDocument.load(st.bytes, { ignoreEncryption: true });
    for (const it of list) {
      let p;
      if (it.blank) p = out.addPage(it.blank);
      else if (it.size) {                                                 // the page's content fitted onto new paper
        const emb = await out.embedPage((it.doc || cur).getPage(it.index)), [W, H] = it.size, s = Math.min(W / emb.width, H / emb.height);
        p = out.addPage([W, H]); p.drawPage(emb, { x: (W - emb.width * s) / 2, y: (H - emb.height * s) / 2, xScale: s, yScale: s });
      }
      else { [p] = await out.copyPages(it.doc || cur, [it.index]); out.addPage(p); }
      if (it.rotate) p.setRotation(lib.degrees(((p.getRotation().angle || 0) + it.rotate) % 360));
    }
    const was = page(), keep = focus || was;
    await useBytes(await out.save(), list.map(it => it.pg));
    let at = st.pages.indexOf(keep); if (at < 0) at = Math.min(st.cur, st.pages.length - 1);
    st.picked = new Set([at]); anchor = at;
    thumbsLazy();
    if (st.pages[at] === was && was && was.ready) { st.cur = at; renderThumbs(); render(); status(''); }
    else await go(at);
  }
  async function addBlank(after) {
    const list = same(), pg = { ...fresh(), blank: true }, size = (st.pages[after] || st.pages[0] || { size: A4 }).size;
    list.splice(after + 1, 0, { pg, blank: [size[0], size[1]] });
    await restructure(list, pg);
    status(L('Blank page added: use T Text, 🖼 Picture or the shapes to fill it.', 'Halaman kosong ditambahkan: isi dengan T Teks, 🖼 Gambar, atau bentuk.'));
  }
  async function insertFiles(files, at) {
    status(L('Reading the files…', 'Membaca file…'));
    const src = await PDFLib.PDFDocument.load(await bundle(files), { ignoreEncryption: true });
    const list = same(), add = src.getPageIndices().map(k => ({ pg: fresh(), doc: src, index: k }));
    list.splice(at, 0, ...add);
    await restructure(list, add[0].pg);
    status(L(`${add.length} page(s) inserted. Drag them in the sidebar to change the order.`, `${add.length} halaman disisipkan. Seret di panel kiri untuk mengubah urutan.`));
  }
  const clone = pg => pg.ready ? { ...pg, elements: JSON.parse(JSON.stringify(pg.elements)) } : { ...fresh(), thumb: pg.thumb };
  async function duplicate(idxs) {
    const list = [];
    for (const it of same()) { list.push(it); if (idxs.includes(it.index)) list.push({ pg: clone(it.pg), index: it.index }); }
    await restructure(list);
  }
  async function removePages(idxs) {
    if (idxs.length >= st.pages.length) { status(L('A document keeps at least one page.', 'Dokumen minimal berisi satu halaman.')); return; }
    if (idxs.some(i => st.pages[i].edited) && !confirm(L('Some of these pages have changes. Delete them anyway?', 'Ada halaman yang sudah diubah. Tetap hapus?'))) return;
    await restructure(same().filter(it => !idxs.includes(it.index)));
  }
  async function rotate(idxs) {
    if (idxs.some(i => st.pages[i].edited) && !confirm(L('Rotating starts these pages over (their changes go). Continue?', 'Memutar akan mengulang halaman ini dari awal (perubahannya hilang). Lanjutkan?'))) return;
    await restructure(same().map(it => idxs.includes(it.index) ? { pg: fresh(), index: it.index, rotate: 90 } : it));
  }
  async function movePages(idxs, to) {
    const list = same(), moving = list.filter(it => idxs.includes(it.index)), rest = list.filter(it => !idxs.includes(it.index));
    rest.splice(rest.filter(it => it.index < to).length, 0, ...moving);
    if (rest.every((it, k) => it.index === k)) return;
    await restructure(rest);
  }
  async function ocrPage(i) {
    const pg = st.pages[i];
    if (pg.edited && !confirm(L('Reading the text starts this page over (its changes go). Continue?', 'Membaca teks akan mengulang halaman ini (perubahannya hilang). Lanjutkan?'))) return;
    Object.assign(pg, fresh(), { forceOcr: true });
    await go(i);
  }

  // ---- turn a page into pieces ------------------------------------------------------------
  // Pictures painted on the page: the decoded picture (pdf.js objs) and where it lands.
  // Also gathers simple vector shapes (straight rules, plain boxes) into `shapes`, so table
  // lines and separators can be moved. A picture under a soft mask (a drawn shadow) is not
  // a picture you could move: it stays in the background.
  function pictureOps(ops, vpTransform, shapes) {
    const U = pdfjsLib.Util, O = pdfjsLib.OPS, out = [], stack = [];
    let ctm = [1, 0, 0, 1, 0, 0], gs = { lw: 1, fill: '#000000', stroke: '#000000', smask: false }, path = null;
    const groups = []; let inMask = 0;                                    // drawing inside a soft-mask group is the mask, not the page
    const hexOf = a => typeof a[0] === 'string' ? a[0] : '#' + [a[0], a[1], a[2]].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
    const PAINT = new Set([O.stroke, O.closeStroke, O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
    const STROKES = new Set([O.stroke, O.closeStroke, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
    const FILLS = new Set([O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k], a = ops.argsArray[k];
      if (fn === O.save) stack.push({ ctm: ctm.slice(), gs: { ...gs } });
      else if (fn === O.restore) { const s = stack.pop(); if (s) { ctm = s.ctm; gs = s.gs; } }
      else if (fn === O.transform) ctm = U.transform(ctm, a);
      else if (fn === O.paintFormXObjectBegin) { stack.push({ ctm: ctm.slice(), gs: { ...gs } }); if (a && a[0]) ctm = U.transform(ctm, a[0]); }
      else if (fn === O.paintFormXObjectEnd) { const s = stack.pop(); if (s) { ctm = s.ctm; gs = s.gs; } }
      else if (fn === O.beginGroup) { const m = a && a[0] && a[0].smask ? 1 : 0; groups.push(m); inMask += m; }
      else if (fn === O.endGroup) inMask -= groups.pop() || 0;
      else if (inMask > 0) continue;
      else if (fn === O.setLineWidth) gs.lw = a[0];
      else if (fn === O.setFillRGBColor) gs.fill = hexOf(a);
      else if (fn === O.setStrokeRGBColor) gs.stroke = hexOf(a);
      else if (fn === O.setGState) { for (const [key, v] of a[0] || []) if (key === 'SMask') gs.smask = !!v; }
      else if (fn === O.constructPath) path = { ops: a[0], coords: a[1], m: U.transform(vpTransform, ctm) };
      else if (PAINT.has(fn) && path && shapes && !gs.smask) { shapeOf(path, STROKES.has(fn), FILLS.has(fn), gs, shapes); path = null; }
      else if (fn === O.endPath) path = null;
      else if ((fn === O.paintImageXObject || fn === O.paintInlineImageXObject) && gs.smask) continue;
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
  // A path that is only straight axis-aligned lines, or only rectangles, becomes shapes
  // (in page pixels): {box, fill, stroke, width}.
  function shapeOf(path, stroked, filled, gs, shapes) {
    const O = pdfjsLib.OPS, m = path.m, P = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1, t = Math.max(1, (gs.lw || 0) * scale);
    const rects = [], segs = []; let c = 0, cur = null, other = false;
    for (const op of path.ops) {
      if (op === O.rectangle) { const [x, y, w, h] = path.coords.slice(c, c + 4); c += 4; const p = [P(x, y), P(x + w, y + h)]; rects.push({ x0: Math.min(p[0][0], p[1][0]), y0: Math.min(p[0][1], p[1][1]), x1: Math.max(p[0][0], p[1][0]), y1: Math.max(p[0][1], p[1][1]) }); }
      else if (op === O.moveTo) { cur = P(path.coords[c], path.coords[c + 1]); c += 2; }
      else if (op === O.lineTo) { const q = P(path.coords[c], path.coords[c + 1]); c += 2; if (cur) segs.push([cur, q]); cur = q; }
      else if (op === O.closePath) { /* a closed polyline is a polygon, not rules */ other = true; }
      else { other = true; c += op === O.curveTo ? 6 : 4; }
    }
    if (other || (rects.length && segs.length)) return;
    for (const [p, q] of segs) {                                          // straight rules (separators, table lines)
      if (!stroked) return;
      const horiz = Math.abs(p[1] - q[1]) < 1.5, vert = Math.abs(p[0] - q[0]) < 1.5;
      if (!horiz && !vert) return;
      shapes.push({ box: { x0: Math.min(p[0], q[0]) - (vert ? t / 2 : 0), y0: Math.min(p[1], q[1]) - (horiz ? t / 2 : 0), x1: Math.max(p[0], q[0]) + (vert ? t / 2 : 0), y1: Math.max(p[1], q[1]) + (horiz ? t / 2 : 0) }, fill: gs.stroke });
    }
    for (const r of rects) {
      const thin = Math.min(r.x1 - r.x0, r.y1 - r.y0) <= 3;
      if (filled && thin) shapes.push({ box: r, fill: gs.fill });
      else if (filled && !/^#f[a-f]f[a-f]f[a-f]$/i.test(gs.fill)) shapes.push({ box: r, fill: gs.fill, stroke: stroked ? gs.stroke : '', width: stroked ? t : 0 });
      else if (stroked) shapes.push({ box: r, fill: '', stroke: gs.stroke, width: t });
    }
  }
  // The picture itself (no panels or text over it), drawn the way the page shows it.
  function pictureSrc(p, op, page) {
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
    // Does it look like the page there? A picture painted through a mask the PDF applies
    // elsewhere (a soft shadow) comes out as a dark slab: it stays in the background.
    if (page) {
      let diff = 0, n = 0;
      const stepX = Math.max(1, Math.floor(c.width / 24)), stepY = Math.max(1, Math.floor(c.height / 24));
      for (let y = Math.floor(stepY / 2); y < c.height; y += stepY) for (let x = Math.floor(stepX / 2); x < c.width; x += stepX) {
        const gx = Math.floor(box.x0 + x / f), gy = Math.floor(box.y0 + y / f);
        if (gx < 0 || gy < 0 || gx >= page.width || gy >= page.height) continue;
        const i = (y * c.width + x) * 4, j = (gy * page.width + gx) * 4;
        if (px[i + 3] < 250) continue;                                     // see-through parts show what is under them
        for (let k = 0; k < 3; k++) diff += Math.abs(px[i + k] - page.data[j + k]);
        n += 3;
      }
      if (n && diff / n > 70) { c.width = 0; return null; }
    }
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
    const shapes = [];
    try { ops = pictureOps(await p.getOperatorList(), vp.transform, shapes); } catch (e) {}
    const area = o => (o.box.x1 - o.box.x0) * (o.box.y1 - o.box.y0) / (W * H);
    // OCR only for a scan (a picture over most of the page). A page without text that
    // is not a scan (a title drawn as artwork) stays design: OCR there reads nonsense.
    const scanned = !content.items.some(it => it.str && it.str.trim()) && (pg.forceOcr || ops.some(o => area(o) > 0.5));
    // "Read the text (OCR)" on a page that has text too (a poster, a photo with words on it):
    // the page is read as a picture; lines the PDF already gave are not taken twice.
    if (scanned || pg.forceOcr) {
      status(L('Reading the text (OCR)…', 'Membaca teks (OCR)…'));
      const found = await AnimationOCR.read(canvas, e => { if (e.status === 'recognizing text') status(L('OCR ', 'OCR ') + Math.round((e.progress || 0) * 100) + '%'); });
      const read = found.filter(l => goodLine(l) && l.confidence >= (scanned ? 75 : 60))
        .map(l => ({ text: C.clean(l.text), x: l.bbox.x0, y: l.bbox.y0, w: l.bbox.x1 - l.bbox.x0, h: l.bbox.y1 - l.bbox.y0, size: ocrSize(l.text, l.bbox.y1 - l.bbox.y0), family: 'sans' }));
      const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
      lines = scanned ? read : [...lines, ...read.filter(l => !lines.some(o => overlap(o, l) > 0.3))];
    }
    if (pg.forceOcr) ops = [];                                           // read as a picture: the page stays one background

    // Pictures become movable, replaceable images under the page's design.
    // (A scanned page's full-page picture holds its text: it stays the background.)
    ops = ops.filter(o => area(o) > 0.004 && !(scanned && area(o) > 0.6));
    const imgEls = [];
    for (const o of ops) {
      const src = pictureSrc(p, o, original);
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
    // A picture filling the page with nothing drawn over it but text (a scan, or a page
    // this editor saved before) is the page itself: it stays the background, and
    // ✂ Area → picture can still cut a logo out of it.
    if (imgEls.some(im => im.w * im.h >= 0.85)) {
      const textMask = new Uint8Array(W * H);
      for (const l of lines) {
        const x0 = Math.max(0, Math.floor(l.x) - 3), x1 = Math.min(W - 1, Math.ceil(l.x + l.w) + 3);
        for (let y = Math.max(0, Math.floor(l.y) - 3), y1 = Math.min(H - 1, Math.ceil(l.y + l.h) + 3); y <= y1; y++) textMask.fill(1, y * W + x0, y * W + x1 + 1);
      }
      for (let k = imgEls.length - 1; k >= 0; k--) {
        if (imgEls[k].w * imgEls[k].h < 0.85) continue;
        let over = 0, n = 0;
        for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) { const i = y * W + x; if (textMask[i]) continue; n++; if (layer[i * 4 + 3] > 25) over++; }
        if (over / Math.max(1, n) < 0.02) imgEls.splice(k, 1);
      }
      if (!imgEls.length) layer = null;
    }
    // Only a big photo, or one with see-through design over it (a panel), stays under
    // the design. Others (logos, figures) sit on top, so they can move anywhere; the
    // paper fills the hole they leave.
    const holes = [];
    for (const im of imgEls) {
      const b = im.clip, x0 = Math.floor(b.x0), y0 = Math.floor(b.y0), x1 = Math.ceil(b.x1), y1 = Math.ceil(b.y1);
      let semi = 0, n = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const a = layer[(y * W + x) * 4 + 3]; n++; if (a > 25 && a < 230) semi++; }
      im.under = im.w * im.h > 0.25 || semi / Math.max(1, n) > 0.08;
      if (!im.under) holes.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, padding: 2 });
    }

    // Rules and plain boxes become shapes you can move (a busy drawing stays in the background).
    const keepShapes = !pg.forceOcr && !scanned ? shapes.filter(sh => {
      const w = sh.box.x1 - sh.box.x0, h = sh.box.y1 - sh.box.y0, a = w * h / (W * H);
      return Math.max(w, h) >= W * 0.02 && a < 0.5;
    }) : [];
    const shapeEls = keepShapes.length > 150 ? [] : keepShapes.map(sh => ({ id: newId(), type: 'rect', x: sh.box.x0 / W, y: sh.box.y0 / H,
      w: Math.max(1, sh.box.x1 - sh.box.x0) / W, h: Math.max(1, sh.box.y1 - sh.box.y0) / H, fill: sh.fill || '', stroke: sh.stroke || '', strokeWidth: (sh.width || 0) / H, rotation: 0 }));
    const shapeBoxes = shapeEls.length ? keepShapes.map(sh => ({ ...sh.box, padding: 1 })) : [];
    // Text colours from the page as printed; then the text leaves the design layer.
    const lineBoxes = lines.map(l => ({ x0: l.x, y0: l.y, x1: l.x + l.w, y1: l.y + l.h }));
    const colors = C.textColors(original.data, W, H, lineBoxes);
    lines.forEach((l, i) => { l.color = colors[i]; });
    // Words in a line that differ (another colour, weight or font) keep it, as styled words.
    const partList = lines.flatMap((l, i) => (l.parts && l.parts.length > 1 ? l.parts : []).map(pt => ({ pt, i })));
    if (partList.length) {
      const pc = C.textColors(original.data, W, H, partList.map(({ pt }) => ({ x0: pt.x, y0: pt.y, x1: pt.x + pt.w, y1: pt.y + pt.h })));
      partList.forEach(({ pt }, k) => { pt.color = pc[k]; });
      const far = (c1, c2) => { const v = s => [1, 3, 5].map(j => parseInt(s.slice(j, j + 2), 16)); const a = v(c1), b = v(c2); return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 90; };
      for (const l of lines) {
        const ps = l.parts || []; if (ps.length < 2) continue;
        const main = ps.reduce((m, pt) => pt.text.length > m.text.length ? pt : m, ps[0]);
        l.color = main.color; l.font = main.font; l.bold = main.bold; l.italic = main.italic;
        const runs = ps.map(pt => ({ text: pt.text, ...(pt.bold !== l.bold ? { b: pt.bold } : {}), ...(pt.italic !== l.italic ? { i: pt.italic } : {}),
          ...(far(pt.color, l.color) ? { color: pt.color } : {}), ...(pt.font && pt.font !== l.font ? { face: `"${pt.font}"` } : {}) }));
        if (runs.some(r => Object.keys(r).length > 1)) l.html = C.richHtml([runs]);
      }
    }
    const bgData = new ImageData(layer || new Uint8ClampedArray(original.data), W, H);
    C.repair(bgData.data, W, H, [...lineBoxes, ...holes, ...shapeBoxes]);
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
        ...(b.font ? { font: b.font } : {}), ...(b.html ? { html: C.tidyRich(b.html) } : {}),
        // A one-line piece (a label, an amount, a table cell) never wraps by itself: typing
        // more makes it longer, like a line in Word, and nothing below moves.
        ...(b.lines === 1 ? { fit: true } : {}) };
    });
    pg.layered = !!layer;
    pg.bg = canvas.toDataURL(pg.layered ? 'image/png' : 'image/jpeg', 0.9);
    const oc = Object.assign(document.createElement('canvas'), { width: W, height: H }); oc.getContext('2d').putImageData(original, 0, 0);
    pg.original = oc.toDataURL('image/jpeg', 0.9); oc.width = 0;
    canvas.width = 0;
    pg.elements = [...imgEls.map(({ clip, ...e }) => e), ...shapeEls, ...textEls];
    // A blank page gets a body text block inside the margins (2.5 cm), like a new Word page.
    if (pg.blank && !pg.elements.length) {
      const [PW, PH] = pg.size, m = st.margin || 72;
      pg.elements.push({ id: newId(), type: 'text', x: m / PW, y: m / PH, w: (PW - 2 * m) / PW, h: 18 / PH, text: '', fontSize: 12 / PH,
        family: 'sans', bold: false, italic: false, color: '#1c1917', align: 'left', lineHeight: 1.4, ph: true });
    }
    pg.initial = JSON.stringify(pg.elements); pg.initialBg = pg.bg;
    pg.ready = true;
    p.cleanup();
  }

  async function go(i, scroll) {
    if (i < 0 || i >= st.pages.length) return;
    commitTyping();
    const prev = page(); if (prev) sheets.delete(prev);                  // drawn again with its changes
    st.cur = i; st.sel = null; st.group = []; st.past = []; st.future = [];
    if (!st.picked.has(i)) { st.picked = new Set([i]); anchor = i; }
    renderThumbs();
    const stage = $('#pe-stage');
    stage.innerHTML = '<div class="pe-busy">' + L('Preparing the page…', 'Menyiapkan halaman…') + '</div>';
    sizeStage(); layoutDesk();
    if (scroll) stage.scrollIntoView({ block: 'start', behavior: 'instant' });
    try { await prepare(page()); status(L('Click any text to type. Drag pictures to move them.', 'Klik teks mana saja untuk mengetik. Seret gambar untuk memindahkan.')); }
    catch (e) { status(L('This page could not be prepared: ', 'Halaman ini tidak bisa disiapkan: ') + (e.message || e)); }
    if (st.cur === i) { render(); caretOnBlank(); }
  }

  // ---- drawing the stage --------------------------------------------------------------------
  // Pages sit one under another (like Word): every page has the same width.
  const sheetWidth = () => { const desk = $('#pe-desk'); return Math.min(Math.max(280, (desk ? desk.clientWidth : 800) - 44), 860) * st.zoom; };
  function sizeStage() {
    const pg = page(), stage = $('#pe-stage');
    if (!pg || !stage) return;
    const [W, H] = pg.size, width = sheetWidth();
    stage.style.width = width + 'px'; stage.style.height = width * H / W + 'px';
  }
  // The other pages: sheets drawn when they scroll into view; a click edits that page.
  const sheets = new Map();
  let sheetSeen = null;
  function layoutDesk() {
    const desk = $('#pe-desk'), stage = $('#pe-stage'), width = sheetWidth();
    if (!desk || !stage) return;
    sheetSeen = sheetSeen || new IntersectionObserver(entries => { for (const en of entries) if (en.isIntersecting) fillSheet(en.target); }, { rootMargin: '600px 0px' });
    const kids = st.pages.map((pg, i) => {
      if (i === st.cur) return stage;
      let sh = sheets.get(pg);
      if (!sh || sh.width !== width) {
        sh = document.createElement('div'); sh.className = 'pe-sheet'; sh.page = pg; sh.width = width;
        sh.title = L('Click to edit this page', 'Klik untuk mengedit halaman ini');
        sh.addEventListener('click', () => go(st.pages.indexOf(pg)));
        sheets.set(pg, sh);
      }
      sh.style.width = width + 'px'; sh.style.height = width * pg.size[1] / pg.size[0] + 'px';
      return sh;
    });
    if (kids.length !== desk.children.length || kids.some((k, i) => desk.children[i] !== k)) desk.replaceChildren(...kids);
    for (const k of kids) if (k !== stage && !k.filled) sheetSeen.observe(k);
  }
  async function fillSheet(sh) {
    if (sh.filled) return; sh.filled = true; sheetSeen.unobserve(sh);
    const pg = sh.page, Hpx = parseFloat(sh.style.height);
    if (pg.ready) {
      for (const el of pg.elements) if (el.under) sh.append(build(el, Hpx));
      const bg = document.createElement('img'); bg.className = 'pe-bg'; bg.src = pg.bg; bg.alt = ''; sh.append(bg);
      for (const el of pg.elements) if (!el.under) sh.append(build(el, Hpx));
      return;
    }
    try {
      const doc = st.pdf, p = await doc.getPage(pg.index + 1), v = p.getViewport({ scale: 1 });
      const vp = p.getViewport({ scale: sh.width * Math.min(2, devicePixelRatio || 1) / v.width });
      const c = Object.assign(document.createElement('canvas'), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await p.render({ canvasContext: g, viewport: vp }).promise;
      if (st.pdf === doc) { c.className = 'pe-bg'; sh.append(c); }
    } catch (e) { sh.filled = false; }
  }
  function statusBar() {
    const sb = $('#pe-sb'); if (!sb) return;
    const words = st.pages.reduce((n, pg) => n + (pg.ready ? pg.elements.filter(e => e.type === 'text').reduce((a, e) => a + (String(e.text).match(/[\p{L}\p{N}]+/gu) || []).length, 0) : 0), 0);
    sb.textContent = L(`Page ${st.cur + 1} of ${st.pages.length} · ${words} words · Zoom ${Math.round(st.zoom * 100)}%`,
      `Halaman ${st.cur + 1} dari ${st.pages.length} · ${words} kata · Zoom ${Math.round(st.zoom * 100)}%`);
  }
  const stageH = () => $('#pe-stage').getBoundingClientRect().height || 1;

  function render() {
    const pg = page(), stage = $('#pe-stage');
    if (!pg || !pg.ready) return;
    sizeStage(); layoutDesk(); statusBar();
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
  function styleText(node, el, Hpx) {
    const H = Hpx || stageH();
    // The PDF's own font already is bold/italic where it was: no faux styles on top.
    const own = el.font && st.fonts && st.fonts[el.font];
    Object.assign(node.style, { fontFamily: (own ? `"${el.font}", ` : '') + (CSS_FONT[el.family] || CSS_FONT.sans), fontSize: el.fontSize * H + 'px', lineHeight: String(el.lineHeight || C.LINE),
      fontWeight: !own && el.bold ? '700' : '400', fontStyle: !own && el.italic ? 'italic' : 'normal', color: el.color || '#1c1917', textAlign: el.align || 'left',
      textDecoration: el.underline ? 'underline' : 'none', whiteSpace: el.fit ? 'pre' : 'pre-wrap' });
  }
  function build(el, sheetH) {
    const div = document.createElement('div');
    if (sheetH) {                                                         // a page that is not being edited: a picture of it
      div.className = 'pe-el pe-' + el.type; place(div, el);
      const sH = () => sheetH;
      if (el.type === 'text') { const t = document.createElement('div'); t.className = 'pe-txt'; fillText(t, el); styleText(t, el, sheetH); div.append(t); }
      else if (el.type === 'image') { const img = document.createElement('img'); img.src = el.src; img.alt = ''; div.append(img); div.style.opacity = el.opacity ?? 1; }
      else shapeInto(div, el, sH());
      return div;
    }
    const many = st.group.includes(el.id);
    div.className = 'pe-el pe-' + el.type + (el.under ? ' pe-under' : '') + (st.sel === el.id || many ? ' sel' : '') + (many ? ' multi' : ''); div.dataset.id = el.id;
    if (el.type === 'rect' && page() && Math.min(el.w * page().size[0], el.h * page().size[1]) < 6) div.classList.add('pe-thin');
    place(div, el);
    if (el.type === 'text') {
      const t = document.createElement('div'); t.className = 'pe-txt'; t.contentEditable = 'true'; t.spellcheck = false;
      fillText(t, el); styleText(t, el); div.append(t);
      if (el.ph) t.dataset.ph = L('Start typing…', 'Mulai mengetik…');
      let h0 = 0;                                                         // the text's height before this keystroke
      t.addEventListener('focus', () => { select(el.id, false); h0 = t.getBoundingClientRect().height; });
      t.addEventListener('blur', commitTyping);
      t.addEventListener('input', () => {
        syncText(el, t); touched(true); statusBar(); flowAfterTyping(el, t); clearTimeout(thumbTimer); thumbTimer = setTimeout(renderThumbs, 700);
        reflow(el, div, t, h0); h0 = t.getBoundingClientRect().height;
      });
      t.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && /^[biu]$/i.test(e.key)) { e.preventDefault(); $({ b: '#pe-bold', i: '#pe-italic', u: '#pe-underline' }[e.key.toLowerCase()]).click(); return; }
        if (e.key === 'Enter') {
          e.preventDefault();
          // In a list, Enter starts the next item; Enter on an empty item ends the list.
          const m = caretLine(t).match(/^(• |(\d+)\. )(.*)$/);
          if (m && !m[3].trim()) { for (let k = 0; k < m[1].length; k++) document.execCommand('delete'); return; }
          document.execCommand('insertLineBreak');
          if (m) document.execCommand('insertText', false, m[2] ? `${Number(m[2]) + 1}. ` : '• ');
        }
        if (e.key === 'Escape') t.blur();
        // At the edge of a typed page the caret goes on to the page before / after.
        if (el.ph && isTyped(page()) && !e.shiftKey && !e.ctrlKey && ['Backspace', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(e.key) && getSelection().isCollapsed) {
          const off = textBefore(t).length, end = C.plainOf(parasOf(el)).length, back = ['Backspace', 'ArrowUp', 'ArrowLeft'].includes(e.key);
          const to = back ? (off === 0 ? st.cur - 1 : -1) : (off >= end ? st.cur + 1 : -1);
          if (to >= 0 && isTyped(st.pages[to])) {
            e.preventDefault();
            go(to).then(() => { const b = bodyOf(page()), tt = document.querySelector(`#pe-stage [data-id="${b.id}"] .pe-txt`); if (tt) { tt.focus(); setCaret(tt, back ? C.plainOf(parasOf(b)).length : 0); } });
          }
        }
      });
      t.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });
      t.addEventListener('dragstart', e => e.preventDefault());           // a drag from selected text selects on (no drag-and-drop)
    } else if (el.type === 'image') {
      const img = document.createElement('img'); img.src = el.src; img.alt = ''; img.draggable = false; div.append(img);
      div.style.opacity = el.opacity ?? 1;
    } else shapeInto(div, el, stageH());
    for (const h of ['nw', 'ne', 'sw', 'se'].concat(el.type === 'text' ? ['move'] : ['rot'])) {
      const hd = document.createElement('div'); hd.className = 'pe-h'; hd.dataset.h = h; div.append(hd);
    }
    div.addEventListener('pointerdown', e => down(e, el, div));
    return div;
  }
  function shapeInto(div, el, H) {
    const svg = inner => `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%;overflow:visible">${inner}</svg>`;
    const sw = w => Math.max(1, (w || 0) * H);
    if (el.type === 'line') div.innerHTML = svg(`<line x1="0" y1="100" x2="100" y2="0" stroke="${el.stroke}" stroke-width="${sw(el.strokeWidth || .003)}" vector-effect="non-scaling-stroke"/>`);
    else if (el.type === 'triangle') div.innerHTML = svg(`<polygon points="50,0 100,100 0,100" fill="${el.fill || 'none'}" stroke="${el.stroke || 'none'}" stroke-width="${sw(el.strokeWidth)}" vector-effect="non-scaling-stroke"/>`);
    else if (el.type === 'arrow') {
      const pg = st.pages.find(p => p.elements.includes(el)) || page(), [PW, PH] = pg.size, hp = Math.min(30, (el.h * PH) / Math.max(1e-6, el.w * PW) * 100);
      div.innerHTML = svg(`<line x1="0" y1="50" x2="${100 - hp * 0.9}" y2="50" stroke="${el.stroke}" stroke-width="${sw(el.strokeWidth || .003)}" vector-effect="non-scaling-stroke"/><polygon points="${100 - hp},0 100,50 ${100 - hp},100" fill="${el.stroke}"/>`);
    } else {
      div.style.background = el.fill || 'transparent';
      div.style.border = el.stroke && el.strokeWidth ? `${sw(el.strokeWidth)}px solid ${el.stroke}` : 'none';
    }
  }
  // A block's words: plain text, or tidy html when some words carry their own styles.
  function fillText(t, el) { if (el.html) t.innerHTML = el.html; else t.textContent = el.text; }
  function syncText(el, t) {
    el.text = t.innerText.replace(/\n$/, '');
    if (C.isRich(t.innerHTML)) el.html = C.tidyRich(t.innerHTML); else delete el.html;
  }
  // Styling selected words (like Word): the selection is remembered so a toolbar
  // control (colour, size, font) can still reach it after taking the focus.
  let kept = null, paraAt = null;
  function textUpTo(t, node, offset) {
    const r = document.createRange(); r.setStart(t, 0); try { r.setEnd(node, offset); } catch (e) { return ''; }
    let out = '';
    const walk = n => { for (const c of n.childNodes) { if (c.nodeName === 'BR') out += '\n'; else if (c.nodeType === 3) out += c.nodeValue; else { if (/^(DIV|P)$/.test(c.nodeName) && out) out += '\n'; walk(c); } } };
    walk(r.cloneContents());
    return out;
  }
  document.addEventListener('selectionchange', () => {
    const sel = getSelection(); if (!sel.rangeCount) return;
    const n = sel.anchorNode, host = n && (n.nodeType === 1 ? n : n.parentElement), t = host && host.closest && host.closest('#pe-stage .pe-txt');
    if (!t) return;
    kept = sel.isCollapsed ? null : { t, range: sel.getRangeAt(0).cloneRange() };
    const r = sel.getRangeAt(0);                                          // the paragraphs the caret / selection is in
    paraAt = { t, a: textUpTo(t, r.startContainer, r.startOffset).split('\n').length - 1, b: textUpTo(t, r.endContainer, r.endOffset).split('\n').length - 1 };
    for (const [id, cmd] of [['#pe-bold', 'bold'], ['#pe-italic', 'italic'], ['#pe-underline', 'underline']]) {
      try { $(id).classList.toggle('on', document.queryCommandState(cmd)); } catch (e) {}
    }
  });
  function inline(cmd) {
    const now = getSelection();                                           // a selection in the text right now wins
    if (now.rangeCount && !now.isCollapsed) {
      const n = now.anchorNode, host = n && (n.nodeType === 1 ? n : n.parentElement), t = host && host.closest && host.closest('#pe-stage .pe-txt');
      if (t) kept = { t, range: now.getRangeAt(0).cloneRange() };
    }
    if (!kept || !kept.t.isConnected || kept.range.collapsed) return false;
    const t = kept.t, box = t.closest('.pe-el'), el = box && find(box.dataset.id);
    if (!el || el.type !== 'text') return false;
    commitTyping(); snapshot();
    t.focus(); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(kept.range);
    document.execCommand('styleWithCSS', false, true);
    cmd(t, el);
    syncText(el, t); touched(); grow(box, el); statusBar();
    kept = sel.rangeCount && !sel.isCollapsed ? { t, range: sel.getRangeAt(0).cloneRange() } : null;
    return true;
  }
  // execCommand marks a size / font with a placeholder; it becomes our own style here.
  function restyle(t, find, apply) {
    for (const n of [...t.querySelectorAll(find)]) {
      let span = n;
      if (n.tagName === 'FONT') { span = document.createElement('span'); span.append(...n.childNodes); n.replaceWith(span); }
      span.removeAttribute('size'); span.removeAttribute('face'); apply(span);
    }
  }

  // ---- flowing text over typed pages (like Word) ---------------------------------------------
  // Typed pages next to each other are one document: the body block of each page holds
  // what fits inside its margins, the rest goes on to the next page (a new page is
  // added when needed, and taken away again when its text is gone).
  const isTyped = pg => !!(pg && pg.blank && pg.ready && pg.elements.some(e => e.ph));
  const bodyOf = pg => pg.elements.find(e => e.ph);
  const parasOf = el => C.richOf(el.text, el.html);
  let measurer = null, white = null;
  function measureFor(pg, el) {
    if (!measurer) { measurer = document.createElement('div'); measurer.className = 'pe-txt pe-measure'; }
    if (!measurer.isConnected) document.body.append(measurer);
    const W = sheetWidth(), H = W * pg.size[1] / pg.size[0];
    measurer.style.width = el.w * W + 'px'; styleText(measurer, el, H);
    return (pg.size[1] - (st.margin || 72)) / pg.size[1] * H - el.y * H;
  }
  function fits(paras, limit) {
    const b = C.blockOf(paras);
    if (b.html) measurer.innerHTML = b.html; else measurer.textContent = b.text;
    return measurer.scrollHeight <= limit + 0.5;
  }
  // How many characters fit on the page: cut after a word (a very long word is cut anyway).
  function fitLength(paras, limit) {
    const plain = C.plainOf(paras);
    if (fits(paras, limit)) return plain.length;
    const at = C.breakPoints(plain);
    let lo = 0, hi = at.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (fits(C.splitParas(paras, at[mid])[0], limit)) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    if (best >= 0) return at[best];
    let a = 1, b = plain.length - 1, ok = 1;
    while (a <= b) { const mid = (a + b) >> 1; if (fits(C.splitParas(paras, mid)[0], limit)) { ok = mid; a = mid + 1; } else b = mid - 1; }
    return ok;
  }
  function whitePage() {
    if (!white) { const c = Object.assign(document.createElement('canvas'), { width: 8, height: 8 }); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 8, 8); white = c.toDataURL('image/jpeg', 0.9); }
    return white;
  }
  // A new typed page after `prev`, its body styled like prev's.
  function typedPageAfter(prev) {
    const body = { ...bodyOf(prev), id: newId(), text: '' }; delete body.html;
    const pg = { ...fresh(), blank: true, auto: true, ready: true, edited: true, size: prev.size.slice(), layered: false, bg: whitePage(), original: whitePage(), elements: [body] };
    pg.initial = JSON.stringify(pg.elements); pg.initialBg = pg.bg;
    return pg;
  }
  let flowBusy = false, flowAgain = false;
  async function flowFrom(i) {
    if (flowBusy) { flowAgain = true; return; }
    flowBusy = true;
    try { do { flowAgain = false; await flowOnce(i); i = st.cur; } while (flowAgain); }
    catch (e) { status(e.message || String(e)); }
    finally { flowBusy = false; }
  }
  async function flowOnce(start) {
    while (start > 0 && isTyped(st.pages[start - 1])) start--;
    if (!isTyped(st.pages[start])) return;
    const chain = [];
    for (let j = start; j < st.pages.length && isTyped(st.pages[j]); j++) chain.push(st.pages[j]);
    // The caret, as a place in the whole chain's text.
    const cur = page(), ci = chain.indexOf(cur), act = document.activeElement;
    const curBody = ci >= 0 && bodyOf(cur), curT = curBody && document.querySelector(`#pe-stage [data-id="${curBody.id}"] .pe-txt`);
    let caret = null;
    if (curT && act === curT) { syncText(curBody, curT); caret = chain.slice(0, ci).reduce((n, pg) => n + C.plainOf(parasOf(bodyOf(pg))).length, 0) + textBefore(curT).length; }
    let rest = chain.reduce((all, pg) => C.joinParas(all, parasOf(bodyOf(pg))), []);
    const out = [];
    for (let j = 0; j < chain.length || C.plainOf(rest).length; j++) {
      if (j >= chain.length) chain.push(typedPageAfter(chain[chain.length - 1]));
      const pg = chain[j], el = bodyOf(pg), limit = measureFor(pg, el);
      const k = C.plainOf(rest).length ? fitLength(rest, limit) : 0;
      const [a, b] = C.splitParas(rest, k);
      out.push({ pg, block: C.blockOf(a), len: C.plainOf(a).length });
      rest = b;
    }
    // Pages the flow added that end up empty go again; pages you added yourself stay.
    let keep = out.length;
    while (keep > 1 && !out[keep - 1].len && out[keep - 1].pg.auto && out[keep - 1].pg !== cur) keep--;
    const added = out.slice(0, keep).filter(o => !st.pages.includes(o.pg)).map(o => o.pg);
    const removed = out.slice(keep).map(o => o.pg).filter(pg => st.pages.includes(pg));
    let changedCur = false;
    for (const o of out.slice(0, keep)) {
      const el = bodyOf(o.pg), before = JSON.stringify([el.text, el.html || '']);
      el.text = o.block.text; if (o.block.html) el.html = o.block.html; else delete el.html;
      if (JSON.stringify([el.text, el.html || '']) !== before) { o.pg.edited = true; sheets.delete(o.pg); if (o.pg === cur) changedCur = true; }
    }
    // Where the caret lands: on the page holding that place in the text.
    let target = cur, off = 0;
    if (caret !== null) {
      let left = caret;
      for (const o of out.slice(0, keep)) { target = o.pg; off = left; if (left <= o.len) break; left -= o.len; }
    }
    if (added.length || removed.length) {
      const list = same().filter(it => !removed.includes(it.pg));
      const lastKept = out.slice(0, keep).filter(o => st.pages.includes(o.pg)).pop();
      list.splice(list.findIndex(it => it.pg === lastKept.pg) + 1, 0, ...added.map(pg => ({ pg, blank: pg.size.slice() })));
      await restructure(list, target);
    } else if (changedCur && target === cur) render();
    else if (target === cur) { layoutDesk(); return; }
    layoutDesk(); renderThumbs(); statusBar();
    if (caret === null) return;
    if (page() !== target) await go(st.pages.indexOf(target));
    const t = document.querySelector(`#pe-stage [data-id="${bodyOf(target).id}"] .pe-txt`);
    if (t) { t.focus(); setCaret(t, off); const r = getSelection().rangeCount && getSelection().getRangeAt(0).getBoundingClientRect(); if (r && (r.bottom > innerHeight - 40 || r.top < 130)) scrollBy({ top: r.top - innerHeight / 2 }); }
  }
  // After typing in a page's body: flow when it runs over, or when the next page could give some back.
  function flowAfterTyping(el, t) {
    const pg = page(); if (!el.ph || !isTyped(pg)) return;
    const limit = measureFor(pg, el), next = st.pages[st.cur + 1];
    const over = t.scrollHeight > limit + 0.5;
    const room = isTyped(next) && C.plainOf(parasOf(bodyOf(next))).length && t.scrollHeight < limit - el.fontSize * stageH() * (el.lineHeight || 1.4);
    if (over || room) flowFrom(st.cur);
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
  // Several blocks at once (Ctrl+A, a box dragged over empty space, Shift+click):
  // st.group holds them; st.sel is the one the toolbar shows.
  const selected = () => st.group.length ? st.group.map(find).filter(Boolean) : [find(st.sel)].filter(Boolean);
  function selectMany(ids) {
    if (ids.length < 2) { st.group = []; select(ids[0] || null); render(); return; }
    commitTyping(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    st.group = ids; st.sel = ids[0]; render();
    status(L(`${ids.length} blocks selected — change font, size or colour, drag, delete or copy (Ctrl+C) them together.`,
      `${ids.length} blok dipilih — ubah font, ukuran, atau warna, geser, hapus, atau salin (Ctrl+C) sekaligus.`));
  }
  function select(id, rerender = true) {
    if (id !== st.sel) kept = null;
    if (st.group.length) { st.group = []; st.sel = id; render(); return; }
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
    const field = document.activeElement;                                 // leave the toolbar's size box / menus
    if (field && /input|select/i.test(field.tagName)) field.blur();
    if (e.shiftKey) {                                                     // Shift+click adds / removes a block
      e.preventDefault(); e.stopPropagation();
      const ids = selected().map(o => o.id);
      selectMany(ids.includes(el.id) ? ids.filter(i => i !== el.id) : [...ids, el.id]); return;
    }
    const kind = handle ? handle.dataset.h : 'move';
    const group = st.group.includes(el.id) && kind === 'move' ? selected() : null;
    // Text has no frame or grip: Alt+drag moves a block (a plain drag selects text).
    if (onText && !handle && !group && !e.altKey) { select(el.id); dragAcross(e, div); return; }   // caret goes where you clicked
    e.preventDefault(); e.stopPropagation();
    commitTyping(); if (!group) select(el.id);
    const stage = $('#pe-stage').getBoundingClientRect(), sx = e.clientX, sy = e.clientY, start = { ...el };
    const starts = group ? group.map(o => ({ o, x: o.x, y: o.y })) : null;
    let moved = false;
    const move = ev => {
      const dx = (ev.clientX - sx) / stage.width, dy = (ev.clientY - sy) / stage.height;
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 2) { moved = true; snapshot(); }
      if (!moved) return;
      if (starts) {
        for (const s of starts) { s.o.x = s.x + dx; s.o.y = s.y + dy; document.querySelectorAll(`#pe-stage [data-id="${s.o.id}"]`).forEach(n => place(n, s.o)); }
        return;
      }
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
      else if (group) {                                                   // a plain click leaves the group
        select(el.id);
        const t = document.querySelector(`#pe-stage [data-id="${el.id}"] .pe-txt`); if (t) t.focus();
      }
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
    pg.elements = s.e; pg.bg = s.bg; st.sel = null; st.group = [];
    pg.edited = JSON.stringify(s.e) !== pg.initial || s.bg !== pg.initialBg;
    render(); renderThumbs();
  }
  function undo() { commitTyping(); if (!st.past.length) return; st.future.push(state()); restore(st.past.pop()); }
  function redo() { if (!st.future.length) return; st.past.push(state()); restore(st.future.pop()); }

  // ---- toolbar -------------------------------------------------------------------------------------
  function toolbar() {
    const el = find(st.sel), H = page() ? page().size[1] : 0;
    const text = el && (el.type === 'text' || selected().some(o => o.type === 'text'));
    for (const id of ['#pe-family', '#pe-size', '#pe-bold', '#pe-italic', '#pe-underline', '#pe-list-bullet', '#pe-list-number', '#pe-align-left', '#pe-align-center', '#pe-align-right', '#pe-align-justify']) { const b = $(id); if (b) b.disabled = !text; }
    for (const id of ['#pe-delete', '#pe-front', '#pe-back', '#pe-color']) { const b = $(id); if (b) b.disabled = !el; }
    const fill = $('#pe-fill'); if (fill) fill.disabled = !(el && (el.type === 'rect' || el.type === 'ellipse' || el.type === 'triangle'));
    const rep = $('#pe-replace'); if (rep) rep.parentElement.style.display = el && el.type === 'image' ? '' : 'none';
    if (text && el.type === 'text') {
      fontSelect(el);
      $('#pe-size').value = Math.round(el.fontSize * H * 10) / 10;
      $('#pe-bold').classList.toggle('on', !!el.bold); $('#pe-italic').classList.toggle('on', !!el.italic); $('#pe-underline').classList.toggle('on', !!el.underline);
      const lines = String(el.text).split('\n');
      $('#pe-list-bullet').classList.toggle('on', lines.every(l => /^• /.test(l))); $('#pe-list-number').classList.toggle('on', lines.every(l => /^\d+\. /.test(l)));
      for (const a of ['left', 'center', 'right', 'justify']) $('#pe-align-' + a).classList.toggle('on', (el.align || 'left') === a);
    }
    if (el) { const c = el.type === 'text' ? el.color : el.stroke; if (c && /^#[0-9a-f]{6}$/i.test(c)) $('#pe-color').value = c; if (el.fill && /^#[0-9a-f]{6}$/i.test(el.fill)) $('#pe-fill').value = el.fill; }
    $('#pe-undo').disabled = !st.past.length; $('#pe-redo').disabled = !st.future.length;
    $('#pe-zoom').textContent = Math.round(st.zoom * 100) + '%';
    $('#pe-reset').disabled = !(page() && page().edited);
  }
  function change(fn) {
    const all = selected(), el = all[0]; if (!el) return;
    // The caret is kept as (line, distance from the line's end): list marks added or
    // removed at line starts do not move it within the words.
    const act = document.activeElement, typing = act && act.classList.contains('pe-txt') && el.type === 'text';
    let line = 0, fromEnd = 0;
    if (typing) { const before = textBefore(act).split('\n'); line = before.length - 1; fromEnd = Math.max(0, (String(el.text).split('\n')[line] || '').length - before[line].length); }
    commitTyping(); snapshot(); for (const o of all) fn(o); touched(); render();
    if (all.length === 1 && el.type === 'text') {
      const t = document.querySelector(`#pe-stage [data-id="${el.id}"] .pe-txt`);
      if (t) {
        t.focus();
        if (typing) { const ls = String(el.text).split('\n'), k = Math.min(line, ls.length - 1); let off = 0; for (let i = 0; i < k; i++) off += ls[i].length + 1; setCaret(t, off + Math.max(0, ls[k].length - fromEnd)); }
      }
    }
  }
  // The text before the caret in a block, line breaks counted ("\n").
  function textBefore(t) {
    const s = getSelection(); if (!s.rangeCount || !t.contains(s.anchorNode)) return '';
    const r = s.getRangeAt(0).cloneRange(); r.setStart(t, 0);
    let out = '';
    const walk = n => { for (const c of n.childNodes) { if (c.nodeName === 'BR') out += '\n'; else if (c.nodeType === 3) out += c.nodeValue; else { if (/^(DIV|P)$/.test(c.nodeName) && out) out += '\n'; walk(c); } } };
    walk(r.cloneContents());
    return out;
  }
  const caretLine = t => textBefore(t).split('\n').pop();
  function setCaret(t, off) {
    let left = off, node = null, at = 0;
    const walk = n => { for (const c of n.childNodes) { if (node) return;
      if (c.nodeType === 3) { if (left <= c.nodeValue.length) { node = c; at = left; return; } left -= c.nodeValue.length; }
      else if (c.nodeName === 'BR') { if (left === 0) { node = c.parentNode; at = [...c.parentNode.childNodes].indexOf(c); return; } left -= 1; }
      else walk(c); } };
    walk(t);
    const r = document.createRange();
    if (node) r.setStart(node, at); else { r.selectNodeContents(t); r.collapse(false); }
    r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  // ---- fonts: the PDF's own, the standard three, the computer's (Local Font Access) or a file ----
  // A font from the computer or a file is registered as a FontFace named by its key
  // ("u:…") and embedded with fontkit on save, like the PDF's own fonts.
  let fontsVer = 0, fontsShown = -1;
  function fontSelect(el) {
    const sel = $('#pe-family');
    if (fontsShown !== fontsVer) {
      fontsShown = fontsVer; sel.replaceChildren();
      const opt = (v, t) => Object.assign(document.createElement('option'), { value: v, textContent: t });
      const group = (label, opts) => { if (!opts.length) return; const g = document.createElement('optgroup'); g.label = label; g.append(...opts); sel.append(g); };
      const all = Object.entries(st.fonts || {}), pdf = all.filter(([k]) => !k.startsWith('u:')), pc = all.filter(([k]) => k.startsWith('u:'));
      const pdfOpts = [];
      for (const [k, f] of pdf) { if (pdfOpts.some(o => o.textContent === f.name)) continue; pdfOpts.push(opt('f:' + k, f.name || 'PDF')); }
      group(L('Fonts in this PDF (shown as they are)', 'Font di PDF ini (tampil apa adanya)'), pdfOpts);
      group(L('Standard', 'Standar'), [opt('sans', 'Sans (Arial)'), opt('serif', 'Serif (Times)'), opt('mono', 'Mono (Courier)')]);
      const loaded = new Set(pc.map(([k]) => k));
      group(L('On this computer', 'Font di komputer'), [...pc.map(([k, f]) => opt('f:' + k, f.name)),
        ...(st.localList || []).filter(f => !loaded.has('u:' + f.postscriptName)).map(f => opt('l:' + f.postscriptName, f.fullName))]);
      if ('queryLocalFonts' in window && !st.localList) sel.append(opt('__local', L('＋ Load fonts from this computer…', '＋ Muat font dari komputer…')));
      sel.append(opt('__upload', L('＋ Upload a font file (.ttf / .otf)…', '＋ Unggah file font (.ttf / .otf)…')));
    }
    sel.value = el && el.font && st.fonts[el.font] ? 'f:' + el.font : (el && el.family) || 'sans';
  }
  async function addFont(key, data, info) {
    if (!st.fonts[key]) {
      const face = new FontFace(key, data); await face.load(); document.fonts.add(face);
      st.fonts[key] = { data: new Uint8Array(data), ...info }; fontsVer++;
    }
    return key;
  }
  async function loadLocalFonts() {
    try {
      const list = await window.queryLocalFonts();
      st.localList = list.filter(f => f.postscriptName).sort((a, b) => a.fullName.localeCompare(b.fullName)); fontsVer++;
      status(L(`${st.localList.length} fonts from this computer are in the font list.`, `${st.localList.length} font dari komputer ada di daftar font.`));
    } catch (e) { status(L('The browser did not allow reading the computer\'s fonts. Upload a font file instead.', 'Browser tidak mengizinkan membaca font komputer. Unggah file font saja.')); }
  }
  async function useLocal(ps) {
    const f = (st.localList || []).find(x => x.postscriptName === ps); if (!f) return null;
    const data = await (await f.blob()).arrayBuffer();
    return addFont('u:' + ps, data, { name: f.fullName, family: f.family, style: f.style });
  }
  function uploadFont() {
    return new Promise(res => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.ttf,.otf,font/ttf,font/otf' });
      input.onchange = async () => {
        const f = input.files[0]; if (!f) return res(null);
        try { res(await addFont('u:' + f.name, await f.arrayBuffer(), { name: f.name.replace(/\.(ttf|otf)$/i, '') })); }
        catch (e) { status(L('This font file cannot be read.', 'File font ini tidak bisa dibaca.')); res(null); }
      };
      input.click();
    });
  }
  // Bold / italic of a computer font: its own Bold / Italic file when there is one.
  async function styleFont(el, bold, italic) {
    const cur = el.font && st.fonts[el.font];
    if (!cur || !cur.family || !st.localList) return null;
    const want = (bold ? 'bold' : '') + (italic ? 'italic' : '');
    const f = st.localList.find(x => x.family === cur.family && x.style.toLowerCase().replace(/[^a-z]/g, '').replace('oblique', 'italic').replace('regular', '') === want);
    return f ? useLocal(f.postscriptName) : null;
  }

  // ---- Page setup and printing ---------------------------------------------------------------
  const PAPERS = { A4: [595.28, 841.89], F4: [609.45, 935.43], Letter: [612, 792], Legal: [612, 1008], A5: [419.53, 595.28] };
  function pageSetupDialog() {
    const pg = page(); if (!pg) return;
    const [W, H] = pg.size, land = W > H, short = Math.min(W, H), long = Math.max(W, H);
    const paper = Object.keys(PAPERS).find(k => Math.abs(PAPERS[k][0] - short) < 4 && Math.abs(PAPERS[k][1] - long) < 4) || 'A4';
    const box = document.createElement('div'); box.className = 'pe-modal';
    box.innerHTML = `<form class="pe-dlg"><h3>${L('Page setup', 'Pengaturan halaman')}</h3>
      <label>${L('Paper size', 'Ukuran kertas')}<select name="paper">${Object.entries({ A4: 'A4 (21 × 29,7 cm)', F4: 'F4 / Folio (21,5 × 33 cm)', Letter: 'Letter (21,6 × 27,9 cm)', Legal: 'Legal (21,6 × 35,6 cm)', A5: 'A5 (14,8 × 21 cm)' })
        .map(([k, t]) => `<option value="${k}"${k === paper ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>${L('Orientation', 'Orientasi')}<select name="orient"><option value="p"${land ? '' : ' selected'}>${L('Portrait', 'Tegak')}</option><option value="l"${land ? ' selected' : ''}>${L('Landscape', 'Mendatar')}</option></select></label>
      <label>${L('Margins (cm, for typed pages)', 'Margin (cm, untuk halaman ketikan)')}<input name="margin" type="number" min="0" max="6" step="0.1" value="${((st.margin || 72) * 2.54 / 72).toFixed(2)}"></label>
      <label>${L('Apply to', 'Terapkan ke')}<select name="all"><option value="1">${L('All pages', 'Semua halaman')}</option><option value="0">${L('This page', 'Halaman ini')}</option></select></label>
      <p class="pe-dlg-note">${L('Typed pages keep their text and reflow to the new margins; pages of a PDF are scaled to fit the paper.', 'Halaman ketikan tetap berisi teksnya dan menyesuaikan margin baru; halaman PDF diperkecil/diperbesar agar pas di kertas.')}</p>
      <div class="pe-dlg-btns"><button type="button" data-x>${L('Cancel', 'Batal')}</button><button type="submit" class="pe-save">${L('Apply', 'Terapkan')}</button></div></form>`;
    document.body.append(box);
    const form = box.querySelector('form'), close = () => box.remove();
    box.querySelector('[data-x]').onclick = close;
    box.addEventListener('pointerdown', e => { if (e.target === box) close(); });
    form.onsubmit = e => {
      e.preventDefault(); const v = Object.fromEntries(new FormData(form)); close();
      pageSetup(v.paper, v.orient === 'l', Number(v.margin), v.all === '1').catch(err => status(err.message || String(err)));
    };
  }
  async function pageSetup(paper, landscape, marginCm, all) {
    let [W, H] = PAPERS[paper] || PAPERS.A4; if (landscape) [W, H] = [H, W];
    const m = Math.max(0, marginCm) * 72 / 2.54; st.margin = m;
    const targets = all ? st.pages.map((_, i) => i) : [st.cur];
    if (targets.some(i => st.pages[i].edited && !st.pages[i].blank)
      && !confirm(L('Pages of the PDF you changed start over on the new paper (their changes go). Continue?', 'Halaman PDF yang sudah diubah akan diulang di kertas baru (perubahannya hilang). Lanjutkan?'))) return;
    await restructure(same().map(it => {
      if (!targets.includes(it.index)) return it;
      const pg = it.pg;
      if (pg.blank) { if (pg.ready) resizeTyped(pg, W, H, m); else pg.size = [W, H]; return { pg, blank: [W, H] }; }
      return { pg: fresh(), index: it.index, size: [W, H] };
    }));
    status(L('Page setup applied.', 'Pengaturan halaman diterapkan.'));
    const first = st.pages.findIndex(isTyped); if (first >= 0) await flowFrom(first);
  }
  // A typed page on new paper: everything keeps its size in points; the body block takes the new margins.
  function resizeTyped(pg, W, H, m) {
    const [oW, oH] = pg.size;
    for (const e of pg.elements) {
      if (e.ph) { e.x = m / W; e.y = m / H; e.w = Math.max(0.05, (W - 2 * m) / W); }
      else { e.x *= oW / W; e.w = Math.min(e.w * oW / W, 1 - e.x); e.y *= oH / H; }
      e.h *= oH / H; if (e.fontSize) e.fontSize *= oH / H; if (e.strokeWidth) e.strokeWidth *= oH / H;
    }
    pg.size = [W, H];
  }
  async function printDoc() {
    commitTyping();
    status(L('Preparing to print…', 'Menyiapkan cetak…'));
    const { bytes } = await buildPdf({ compress: false });
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise, first = (await doc.getPage(1)).getViewport({ scale: 1 });
    const frame = document.createElement('iframe'); frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.append(frame);
    const d = frame.contentDocument;
    d.open(); d.write(`<!doctype html><html><head><style>@page{size:${first.width}pt ${first.height}pt;margin:0}html,body{margin:0}img{display:block;width:100%;break-after:page}</style></head><body></body></html>`); d.close();
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 2 });
      const c = Object.assign(document.createElement('canvas'), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: g, viewport: vp }).promise;
      const img = d.createElement('img'); img.src = c.toDataURL('image/jpeg', 0.92); c.width = 0; d.body.append(img);
      status(L(`Preparing to print… ${i}/${doc.numPages}`, `Menyiapkan cetak… ${i}/${doc.numPages}`));
    }
    await Promise.all([...d.images].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
    doc.destroy(); status('');
    frame.contentWindow.focus(); frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  }
  function saveAs() {
    const base = st.name.replace(/\.pdf$/i, '');
    const name = prompt(L('Save as (file name):', 'Simpan sebagai (nama file):'), base);
    if (!name || !name.trim()) return;
    st.name = name.trim().replace(/\.pdf$/i, '') + '.pdf'; st.savedAs = true;
    document.title = st.name + ' — ' + L('PDF Editor', 'Editor PDF');
    return save('download');
  }
  function newDocument() {
    if (st.pages.some(p => p.edited) && !confirm(L('Start a new document? Changes not saved yet will be lost.', 'Mulai dokumen baru? Perubahan yang belum disimpan akan hilang.'))) return;
    st.savedAs = false;
    return open([], NEW_NAME());
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
  let cutting = false;                                                  // false | 'img' (✂ Area → picture) | 'ocr' (Area → text)
  // Text in a picture has no letters in the PDF: from its height, a font size.
  // All capitals fill less of the line than mixed text with descenders.
  const ocrSize = (text, h) => /[a-z]/.test(text) ? h * 0.92 : h / 0.74;
  // A line OCR read: short ones (texture, specks in a photo) only when it is very sure.
  const goodLine = l => { const n = (l.text.match(/[\p{L}\p{N}]/gu) || []).length; return n >= 4 ? l.confidence >= 55 : n >= 2 && l.confidence >= 85; };
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
      const mode = cutting;
      cutting = false; $('#pe-cut').classList.remove('on'); $('#pe-ocr-area').classList.remove('on'); stage.style.cursor = '';
      if (!b || b.w < 0.01 || b.h < 0.01) return;
      try { await (mode === 'ocr' ? ocrArea(b) : cutArea(b)); } catch (err) { status(err.message || String(err)); }
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
  // Area → text (OCR): the words in a picture become text you can edit. A patch of the
  // page with those words wiped sits under the new text, so the old words do not show.
  async function ocrArea(b) {
    const pg = page(), orig = await loadImg(pg.original), W = orig.naturalWidth, H = orig.naturalHeight;
    const x0 = Math.round(b.x * W), y0 = Math.round(b.y * H), cw = Math.max(1, Math.round(b.w * W)), ch = Math.max(1, Math.round(b.h * H));
    const crop = Object.assign(document.createElement('canvas'), { width: cw, height: ch }), cg = crop.getContext('2d', { willReadFrequently: true });
    cg.drawImage(orig, x0, y0, cw, ch, 0, 0, cw, ch);
    const f = Math.min(3, Math.max(1, 1400 / Math.max(cw, ch)));          // small words read better larger
    const big = Object.assign(document.createElement('canvas'), { width: Math.round(cw * f), height: Math.round(ch * f) });
    big.getContext('2d').drawImage(crop, 0, 0, big.width, big.height);
    status(L('Reading the text (OCR)…', 'Membaca teks (OCR)…'));
    const found = (await AnimationOCR.read(big, e => { if (e.status === 'recognizing text') status('OCR ' + Math.round((e.progress || 0) * 100) + '%'); }))
      .filter(goodLine);
    big.width = 0;
    if (!found.length) { crop.width = 0; status(L('No text could be read in that area. Try a box closer around the words.', 'Tidak ada teks yang terbaca di area itu. Coba kotak yang lebih pas di sekitar tulisan.')); return; }
    const boxes = found.map(l => ({ x0: l.bbox.x0 / f, y0: l.bbox.y0 / f, x1: l.bbox.x1 / f, y1: l.bbox.y1 / f }));
    const data = cg.getImageData(0, 0, cw, ch), colors = C.textColors(data.data, cw, ch, boxes);
    C.repair(data.data, cw, ch, boxes); cg.putImageData(data, 0, 0);
    snapshot();
    els().push({ id: newId(), type: 'image', x: x0 / W, y: y0 / H, w: cw / W, h: ch / H, src: crop.toDataURL('image/png'), rotation: 0 });
    crop.width = 0;
    found.forEach((l, i) => {
      const bx = boxes[i], size = ocrSize(l.text, bx.y1 - bx.y0), x = (x0 + bx.x0) / W;
      els().push({ id: newId(), type: 'text', x, y: Math.max(0, y0 + bx.y0 - size * 0.22) / H, w: Math.min(1 - x, (bx.x1 - bx.x0 + size * 0.8) / W), h: (bx.y1 - bx.y0) / H,
        text: C.clean(l.text), fontSize: size / H, family: 'sans', bold: false, italic: false, color: colors[i], align: 'left', lineHeight: C.LINE });
    });
    touched(); render();
    status(L(`${found.length} line(s) read: click to edit them, change font or size from the toolbar.`, `${found.length} baris terbaca: klik untuk mengedit, ganti font atau ukuran dari toolbar.`));
  }
  async function cutArea(b) {
    const pg = page(), orig = await loadImg(pg.original), bg = await loadImg(pg.bg);
    const W = orig.naturalWidth, H = orig.naturalHeight, px = { x0: b.x * W, y0: b.y * H, x1: (b.x + b.w) * W, y1: (b.y + b.h) * H };
    const crop = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(px.x1 - px.x0)), height: Math.max(1, Math.round(px.y1 - px.y0)) });
    const cg = crop.getContext('2d', { willReadFrequently: true });
    cg.drawImage(orig, px.x0, px.y0, crop.width, crop.height, 0, 0, crop.width, crop.height);
    // A logo on plain paper comes out without the paper (transparent around it).
    const cd = cg.getImageData(0, 0, crop.width, crop.height);
    if (C.clearPaper(cd.data, crop.width, crop.height)) cg.putImageData(cd, 0, 0);
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
    $('#pe-file').onchange = e => { const f = [...e.target.files]; if (f.length) open(f, f.length > 1 ? L('merged.pdf', 'gabungan.pdf') : null).catch(err => status(err.message)); };
    const blankDoc = $('#pe-blank'); if (blankDoc) blankDoc.onclick = () => open([], NEW_NAME()).catch(err => status(err.message));
    const openBtn = $('#pe-open');
    if (openBtn) openBtn.onchange = e => {
      const f = [...e.target.files]; e.target.value = ''; if (!f.length) return;
      if (st.pages.some(p => p.edited) && !confirm(L('Open another file? Changes not saved yet will be lost.', 'Buka file lain? Perubahan yang belum disimpan akan hilang.'))) return;
      open(f, f.length > 1 ? L('merged.pdf', 'gabungan.pdf') : null).catch(err => status(err.message));
    };
    const start = $('#pe-start');
    start.addEventListener('dragover', e => { e.preventDefault(); start.classList.add('over'); });
    start.addEventListener('dragleave', () => start.classList.remove('over'));
    start.addEventListener('drop', e => { e.preventDefault(); start.classList.remove('over'); const f = [...e.dataTransfer.files]; if (f.length) open(f, f.length > 1 ? L('merged.pdf', 'gabungan.pdf') : null).catch(err => status(err.message)); });
    const thumbs = $('#pe-thumbs');
    thumbs.addEventListener('dragover', e => { if (!dragPages && !(e.dataTransfer.types || []).includes('Files')) return; e.preventDefault(); dropMark(dropAt(e)); });
    thumbs.addEventListener('dragleave', e => { if (!thumbs.contains(e.relatedTarget)) dropMark(null); });
    thumbs.addEventListener('drop', e => {
      e.preventDefault(); const at = dropAt(e); dropMark(null);
      const files = [...(e.dataTransfer.files || [])];
      const job = files.length ? insertFiles(files, at) : dragPages ? movePages(dragPages, at) : null;
      dragPages = null; if (job) job.catch(err => status(err.message || String(err)));
    });
    addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
    addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
    $('#pe-undo').onclick = undo; $('#pe-redo').onclick = redo;
    // Like Word's ribbon: clicking a toolbar button keeps the caret in the text.
    $('#pe-bar').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    const textOnly = fn => el => { if (el.type === 'text') fn(el); };
    $('#pe-add-text').onclick = () => add({ type: 'text', x: 0.3, y: 0.4, w: 0.4, h: 0.05, text: L('Type here', 'Ketik di sini'), fontSize: 14 / page().size[1], family: 'sans', color: '#1c1917', align: 'left', lineHeight: C.LINE });
    const shape = {
      rect: () => add({ type: 'rect', x: 0.35, y: 0.4, w: 0.3, h: 0.12, fill: '#ffffff', stroke: '#1c1917', strokeWidth: 0.0025, rotation: 0 }),
      ellipse: () => add({ type: 'ellipse', x: 0.38, y: 0.4, w: 0.24, h: 0.15, fill: '', stroke: '#FF5C28', strokeWidth: 0.003, rotation: 0 }),
      line: () => add({ type: 'line', x: 0.3, y: 0.45, w: 0.4, h: 0.06, stroke: '#1c1917', strokeWidth: 0.003, rotation: 0 }),
      arrow: () => add({ type: 'arrow', x: 0.3, y: 0.45, w: 0.35, h: 0.03, stroke: '#1c1917', strokeWidth: 0.003, rotation: 0 }),
      triangle: () => add({ type: 'triangle', x: 0.4, y: 0.4, w: 0.2, h: 0.14, fill: '#FFE3D9', stroke: '#1c1917', strokeWidth: 0.0025, rotation: 0 }),
    };
    $('#pe-shapes').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); showMenu(r.left, r.bottom + 4, [
      ['▢ ' + L('Rectangle', 'Kotak'), shape.rect], ['◯ ' + L('Ellipse', 'Elips'), shape.ellipse], ['╲ ' + L('Line', 'Garis'), shape.line],
      ['➝ ' + L('Arrow', 'Panah'), shape.arrow], ['△ ' + L('Triangle', 'Segitiga'), shape.triangle]]); };
    $('#pe-open-btn').onclick = () => $('#pe-open').click();
    $('#pe-file-menu').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); showMenu(r.left, r.bottom + 4, [
      [L('New', 'Baru'), newDocument],
      [L('Open…', 'Buka…'), () => $('#pe-open').click(), '', 'Ctrl+O'],
      [L('Import PDF / pictures…', 'Impor PDF / gambar…'), () => pickFiles(st.cur + 1)],
      null,
      [L('Save', 'Simpan'), () => save('download'), '', 'Ctrl+S'],
      [L('Save as…', 'Simpan sebagai…'), saveAs],
      [L('Save as flipbook', 'Simpan jadi flipbook'), () => save('flipbook')],
      null,
      [L('Page setup…', 'Pengaturan halaman…'), pageSetupDialog],
      [L('Print…', 'Cetak…'), printDoc, '', 'Ctrl+P']]); };
    for (const tab of document.querySelectorAll('.pe-tab')) tab.onclick = () => {
      for (const t of document.querySelectorAll('.pe-tab')) t.classList.toggle('on', t === tab);
      for (const pnl of document.querySelectorAll('.pe-ribbon')) pnl.hidden = pnl.dataset.panel !== tab.dataset.tab;
    };
    $('#pe-ins-blank').onclick = () => addBlank(st.cur);
    $('#pe-ins-file').onclick = () => pickFiles(st.cur + 1);
    $('#pe-setup').onclick = pageSetupDialog;
    const quick = (paper, landscape) => pageSetup(paper, landscape, (st.margin || 72) * 2.54 / 72, true).catch(err => status(err.message || String(err)));
    const curPaper = () => { const [W, H] = page().size, a = Math.min(W, H), b = Math.max(W, H); return Object.keys(PAPERS).find(k => Math.abs(PAPERS[k][0] - a) < 4 && Math.abs(PAPERS[k][1] - b) < 4) || 'A4'; };
    $('#pe-orient-p').onclick = () => quick(curPaper(), false);
    $('#pe-orient-l').onclick = () => quick(curPaper(), true);
    $('#pe-paper').onchange = e => { const [W, H] = page().size; quick(e.target.value, W > H); };
    $('#pe-rot-page').onclick = () => rotate([st.cur]);
    $('#pe-print').onclick = () => printDoc().catch(err => status(err.message || String(err)));
    $('#pe-zoom-fit').onclick = () => { st.zoom = 1; render(); };
    $('#pe-underline').onclick = () => { if (inline(() => document.execCommand('underline'))) return; const v = !(find(st.sel) || {}).underline; change(textOnly(el => { el.underline = v; })); };
    const toggleList = kind => {
      const mark = kind === 'bullet' ? /^• / : /^\d+\. /;
      change(textOnly(o => {
        if (o.html) {                                                     // styled words: the marks go in front of each line
          const lines = o.html.split(/<br\s*\/?>/i), on = lines.every(l => mark.test(C.plainRich(l)));
          o.html = lines.map((l, i) => { l = l.replace(/^((?:<[^>]+>)*)(• |\d+\. )/, '$1'); return on ? l : (kind === 'bullet' ? '• ' : `${i + 1}. `) + l; }).join('<br>');
          o.text = C.plainRich(o.html); return;
        }
        const lines = String(o.text).split('\n'), on = lines.every(l => mark.test(l));
        o.text = lines.map((l, i) => { l = l.replace(/^(• |\d+\. )/, ''); return on ? l : (kind === 'bullet' ? '• ' : `${i + 1}. `) + l; }).join('\n');
      }));
    };
    // Paragraph styles (like Word's Normal / Heading 1-3): the paragraphs the caret or
    // the selection touches get that size and weight.
    const STYLES = { normal: null, h1: 2, h2: 1.5, h3: 1.25 };
    $('#pe-style').onchange = e => {
      const kind = e.target.value; e.target.value = '';
      const t = paraAt && paraAt.t.isConnected ? paraAt.t : null, box = t && t.closest('.pe-el'), el = box && find(box.dataset.id);
      if (!el || el.type !== 'text' || !(kind in STYLES)) return;
      const a = paraAt.a, b = paraAt.b;
      t.focus();
      st.sel = el.id;
      change(textOnly(o => {
        if (o !== el) return;
        const paras = C.richOf(o.text, o.html), scale = STYLES[kind];
        for (let k = Math.min(a, b); k <= Math.max(a, b) && k < paras.length; k++)
          paras[k] = paras[k].map(r => { const x = { ...r }; delete x.scale; delete x.b; if (scale) { x.scale = scale; x.b = true; } return x; });
        const blk = C.blockOf(paras); o.text = blk.text; if (blk.html) o.html = blk.html; else delete o.html;
      }));
    };
    $('#pe-list-bullet').onclick = () => toggleList('bullet');
    $('#pe-list-number').onclick = () => toggleList('number');
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
    $('#pe-family').onchange = async e => {
      const v = e.target.value, el = find(st.sel);
      if (v === '__local') { await loadLocalFonts(); fontSelect(el); return; }
      let key = null;
      if (v === '__upload') { key = await uploadFont(); if (!key) { fontSelect(el); return; } }
      else if (v.startsWith('l:')) { status(L('Loading the font…', 'Memuat font…')); key = await useLocal(v.slice(2)); status(''); }
      else if (v.startsWith('f:')) key = v.slice(2);
      const face = key ? `"${key}"` : (CSS_FONT[v] || CSS_FONT.sans);
      if (inline(t => { document.execCommand('fontName', false, 'pe-mark'); restyle(t, '[style*="pe-mark"],font[face="pe-mark"]', n => { n.style.fontFamily = face; }); })) return;
      change(textOnly(o => { if (key) { o.font = key; o.bold = false; o.italic = false; } else { o.family = v; delete o.font; } }));
    };
    $('#pe-size').onchange = e => {
      const v = Number(e.target.value); if (!(v > 0)) return;
      if (inline((t, el) => {
        const ratio = Math.round(v / (el.fontSize * page().size[1]) * 1000) / 1000;
        document.execCommand('fontSize', false, '7'); restyle(t, '[style*="xxx-large"],font[size="7"]', n => { n.style.fontSize = ratio + 'em'; });
      })) return;
      change(textOnly(el => { el.fontSize = v / page().size[1]; }));
    };
    // Bold/italic are standard-font styles: the text leaves the PDF's own font.
    // With several blocks, all follow the first one (all on, or all off).
    const styled = async (prop) => {
      const el = find(st.sel) || {}, v = !el[prop], bold = prop === 'bold' ? v : !!el.bold, italic = prop === 'italic' ? v : !!el.italic;
      const key = el.font && st.fonts[el.font] && st.fonts[el.font].family ? await styleFont(el, bold, italic) : null;
      change(textOnly(o => { o[prop] = v; if (key) o.font = key; else delete o.font; }));
    };
    $('#pe-bold').onclick = () => { if (!inline(() => document.execCommand('bold'))) styled('bold'); };
    $('#pe-italic').onclick = () => { if (!inline(() => document.execCommand('italic'))) styled('italic'); };
    for (const a of ['left', 'center', 'right', 'justify']) $('#pe-align-' + a).onclick = () => change(textOnly(el => { el.align = a; }));
    $('#pe-color').oninput = e => { if (inline(() => document.execCommand('foreColor', false, e.target.value))) return; change(el => { if (el.type === 'text') el.color = e.target.value; else el.stroke = e.target.value; }); };
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
    $('#pe-reset').onclick = () => { if (!page()) return; snapshot(); page().elements = JSON.parse(page().initial); page().bg = page().initialBg; page().edited = false; st.sel = null; st.group = []; render(); renderThumbs(); };
    $('#pe-ocr-area').onclick = () => { cutting = cutting === 'ocr' ? false : 'ocr'; $('#pe-ocr-area').classList.toggle('on', !!cutting); $('#pe-cut').classList.remove('on'); $('#pe-stage').style.cursor = cutting ? 'crosshair' : '';
      if (cutting) status(L('Drag a box around words in a picture: they become text you can edit.', 'Seret kotak di sekitar tulisan pada gambar: tulisan itu menjadi teks yang bisa diedit.')); };
    $('#pe-cut').onclick = () => { cutting = cutting === 'img' ? false : 'img'; $('#pe-cut').classList.toggle('on', !!cutting); $('#pe-ocr-area').classList.remove('on'); $('#pe-stage').style.cursor = cutting ? 'crosshair' : '';
      if (cutting) status(L('Drag a box around a logo, chart or drawing: it becomes a picture you can move.', 'Seret kotak di sekitar logo, grafik, atau gambar: area itu menjadi gambar yang bisa dipindah.')); };
    $('#pe-save').onclick = () => save(st.from === 'organize' ? 'organize' : 'download');
    $('#pe-download').onclick = () => save('download');
    $('#pe-flipbook').onclick = () => save('flipbook');
    if (st.from === 'organize') { $('#pe-save').textContent = L('💾 Save & back to Organize', '💾 Simpan & kembali ke Organize'); $('#pe-download').hidden = false; }
    $('#pe-desk').addEventListener('pointerdown', e => {
      if (cutting && e.target.closest('#pe-stage')) { e.preventDefault(); e.stopPropagation(); startCut(e); return; }
      if (e.target.closest('.pe-el') || e.target.closest('.pe-sheet')) return;
      commitTyping(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (page() && page().ready) startBox(e); else select(null);
    });
    // Holding Alt shows the move cursor on text blocks.
    const altCursor = on => document.querySelectorAll('#pe-stage .pe-text').forEach(n => n.classList.toggle('pe-alt', on));
    addEventListener('keyup', e => { if (e.key === 'Alt') altCursor(false); });
    addEventListener('blur', () => altCursor(false));
    addEventListener('keydown', e => {
      if (e.key === 'Alt') { altCursor(true); e.preventDefault(); }
      const typing = document.activeElement && document.activeElement.isContentEditable;
      const ctrl = e.ctrlKey || e.metaKey, field = /input|select|textarea/i.test(document.activeElement.tagName);
      // Ctrl+A: all the text on the page (inside a block: first its own text, again for all).
      if (ctrl && e.key.toLowerCase() === 'a' && !field && page() && page().ready) {
        const t = typing && document.activeElement, s = getSelection();
        if (!t || s.toString().trim().length >= t.innerText.trim().length) { e.preventDefault(); selectMany(els().filter(o => o.type === 'text').map(o => o.id)); return; }
      }
      if (ctrl && e.key.toLowerCase() === 'c' && !typing && !field && st.group.length) { e.preventDefault(); copyText(); return; }
      if (ctrl && !e.shiftKey && page()) {
        const k = e.key.toLowerCase();
        if (k === 's') { e.preventDefault(); save('download'); return; }
        if (k === 'o') { e.preventDefault(); $('#pe-open').click(); return; }
        if (k === 'p') { e.preventDefault(); printDoc().catch(err => status(err.message || String(err))); return; }
        const align = { l: 'left', e: 'center', r: 'right', j: 'justify' }[k];
        if (align && find(st.sel) && find(st.sel).type === 'text') { e.preventDefault(); $('#pe-align-' + align).click(); return; }
      }
      if (e.key === 'Escape' && st.group.length) { select(null); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && st.sel && !/input|select|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); remove(); }
    });
    addEventListener('resize', () => { if (page() && page().ready) render(); });
  }
  // Leaving with unsaved changes asks first.
  let dirtyLeave = true;
  addEventListener('beforeunload', e => { if (dirtyLeave && st.pages.some(p => p.edited)) { e.preventDefault(); e.returnValue = ''; } });
  function remove() {
    const all = selected(); if (!all.length) return;
    snapshot(); for (const el of all) els().splice(els().indexOf(el), 1); st.sel = null; st.group = []; touched(); render();
  }
  // The selected text, top to bottom, as plain text on the clipboard.
  function copyText() {
    const text = selected().filter(o => o.type === 'text').sort((a, b) => a.y - b.y || a.x - b.x).map(o => o.text).join('\n');
    if (!text) return;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
      () => status(L('Copied the selected text.', 'Teks yang dipilih sudah disalin.')),
      () => status(L('Could not copy: the browser blocked the clipboard.', 'Gagal menyalin: browser memblokir clipboard.')));
  }
  // Like Word: a text selection dragged out of its paragraph (up or down) becomes a
  // selection of every paragraph from where it started to the pointer.
  function dragAcross(e, home) {
    const sy = e.clientY, box = home.getBoundingClientRect();
    let ids = null;
    const move = ev => {
      if (!ids && ev.clientY <= box.bottom + 4 && ev.clientY >= box.top - 4) return;
      const top = Math.min(sy, ev.clientY), bottom = Math.max(sy, ev.clientY);
      ids = els().filter(o => {
        if (o.type !== 'text') return false;
        const n = document.querySelector(`#pe-stage [data-id="${o.id}"]`), r = n && n.getBoundingClientRect();
        return r && r.top < bottom && r.bottom > top;
      }).map(o => o.id);
      getSelection().removeAllRanges();
      document.querySelectorAll('#pe-stage .pe-text').forEach(n => n.classList.toggle('multi', ids.includes(n.dataset.id)));
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (ids) selectMany(ids);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
  // A box dragged over empty space selects every block it touches (a click deselects).
  function startBox(e) {
    const stage = $('#pe-stage'), r = stage.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
    let box = null, b = null;
    const move = ev => {
      if (!box && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
      if (!box) { box = document.createElement('div'); box.style.cssText = 'position:absolute;border:1px solid #FF5C28;background:rgba(255,92,40,.08);z-index:9;pointer-events:none'; stage.append(box); }
      const x0 = (Math.min(sx, ev.clientX) - r.left) / r.width, y0 = (Math.min(sy, ev.clientY) - r.top) / r.height;
      b = { x0, y0, x1: x0 + Math.abs(ev.clientX - sx) / r.width, y1: y0 + Math.abs(ev.clientY - sy) / r.height };
      Object.assign(box.style, { left: b.x0 * 100 + '%', top: b.y0 * 100 + '%', width: (b.x1 - b.x0) * 100 + '%', height: (b.y1 - b.y0) * 100 + '%' });
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (!box) { select(null); return; }
      box.remove();
      // Pictures under the design only when wholly inside (they often fill the page).
      selectMany(els().filter(o => o.under
        ? o.x >= b.x0 && o.y >= b.y0 && o.x + o.w <= b.x1 && o.y + o.h <= b.y1
        : o.x < b.x1 && o.x + o.w > b.x0 && o.y < b.y1 && o.y + o.h > b.y0).map(o => o.id));
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  // ---- save ---------------------------------------------------------------------------------------------
  // where: 'download' | 'flipbook' | 'organize' (back to the Organize workspace with the edited PDF).
  async function save(where, opts = {}) {
    commitTyping();
    if (window.MFAuth) {
      try {
        const data = await MFAuth.me();
        if (data.user && !data.offline && MFAuth.trialWall(data.user)) return;
        if (!data.user && !data.offline) { MFAuth.loginPopup(() => save(where, opts)); return; }
      } catch (e) {}
    }
    const btns = ['#pe-save', '#pe-download', '#pe-flipbook'].map(s => $(s)).filter(Boolean); btns.forEach(b => b.disabled = true);
    try {
      const { bytes, missing, edits } = await buildPdf({ order: opts.order, compress: true });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const name = st.savedAs && !opts.order ? st.name : st.name.replace(/\.pdf$/i, '') + (opts.order ? L('-pages.pdf', '-halaman.pdf') : '-edit.pdf');
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
      const n = Object.keys(edits).length, kb = Math.round(blob.size / 1024);
      status((opts.order ? L(`Saved: ${name} (${opts.order.length} page(s), ${kb} KB).`, `Tersimpan: ${name} (${opts.order.length} halaman, ${kb} KB).`)
        : L(`Saved: ${name} (${n} page(s) changed, ${kb} KB).`, `Tersimpan: ${name} (${n} halaman diubah, ${kb} KB).`)) + note);
    } catch (e) { status(L('Could not save: ', 'Gagal menyimpan: ') + (e.message || e)); }
    finally { btns.forEach(b => b.disabled = false); }
  }

  // The edited document as PDF bytes (fonts embedded, optionally made smaller).
  async function buildPdf({ order, compress } = {}) {
    const edits = {};
    st.pages.forEach((pg, i) => { if (pg.edited && pg.ready) edits[i] = { size: pg.size, background: pg.bg, elements: pg.elements }; });
    status(L('Building the PDF…', 'Menyusun PDF…'));
    // The PDF's own fonts and fonts from the computer go in with fontkit (loaded only when needed).
    const fonts = {};
    for (const e of Object.values(edits)) for (const el of e.elements) {
      if (el.font && st.fonts[el.font]) fonts[el.font] = st.fonts[el.font].data;
      if (el.html) for (const k of Object.keys(st.fonts || {})) if (el.html.includes(k)) fonts[k] = st.fonts[k].data;   // fonts of single words
    }
    if (Object.keys(fonts).length && !window.fontkit) await new Promise(res => {
      const s = Object.assign(document.createElement('script'), { src: 'assets/vendor/fontkit.umd.min.js' });
      s.onload = s.onerror = res; document.head.append(s);
    });
    let { bytes, missing } = await C.exportPdf(st.bytes, edits, { report: true, fonts, order });
    // Smaller file: photos and scans re-encoded (text and drawings stay sharp).
    const level = ($('#pe-quality') || {}).value;
    if (compress && level && level !== 'orig' && window.PDFCompress) {
      status(L('Making the file smaller…', 'Memperkecil ukuran file…'));
      try { bytes = (await PDFCompress.compress(bytes, level)).bytes; } catch (e) {}
    }
    return { bytes, missing, edits };
  }

  async function boot() {
    wire();
    // EN / ID switched: the editor's own texts follow (the page's HTML follows I18N itself).
    document.addEventListener('langchange', () => {
      fontsVer++; renderThumbs(); statusBar(); if (page() && page().ready) { toolbar(); render(); }
      if (st.name && st.pages.length) document.title = st.name + ' — ' + L('PDF Editor', 'Editor PDF');
      status('');
    });
    // Arriving from Merge / Split / Compress: the same editor, set up for that job.
    const tool = new URLSearchParams(location.search).get('tool') || '';
    const hint = {
      merge: L('Pick several PDFs or pictures at once: they open as one document. Drag pages in the sidebar to set the order.', 'Pilih beberapa PDF atau gambar sekaligus: semuanya terbuka jadi satu dokumen. Seret halaman di panel kiri untuk mengatur urutan.'),
      split: L('Open the PDF, select pages in the sidebar (Ctrl/Shift+click), right-click → Save these pages as a PDF.', 'Buka PDF, pilih halaman di panel kiri (Ctrl/Shift+klik), klik kanan → Simpan halaman ini jadi PDF.'),
      compress: L('Open the PDF and press Save: "Small" quality is already chosen.', 'Buka PDF lalu tekan Simpan: kualitas "Kecil" sudah dipilih.'),
    }[tool.replace(/-pdf$/, '')];
    if (hint) { const h = $('#pe-start-hint'); if (h) h.textContent = hint; }
    if (/compress/.test(tool) && $('#pe-quality')) $('#pe-quality').value = 'high';
    const id = new URLSearchParams(location.search).get('source');
    if (id && window.FlipbookTransfer) {
      try {
        const entry = await FlipbookTransfer.get(id);
        if (entry) { await open(entry.blob, entry.name); await FlipbookTransfer.remove(id); history.replaceState(null, '', location.pathname); return; }
      } catch (e) { status(e.message || String(e)); }
    }
    // Like Word: Edit PDF opens on a blank page with the caret ready.
    if (!tool) await open([], NEW_NAME());
  }
  // On a blank page whose body is still empty, the caret waits in it.
  function caretOnBlank() {
    const pg = page(); if (!pg || !pg.blank) return;
    const el = pg.elements.find(e => e.type === 'text' && e.ph && !e.text); if (!el) return;
    const t = document.querySelector(`#pe-stage [data-id="${el.id}"] .pe-txt`); if (t) t.focus();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  globalThis.PageEditor = { open, state: st, go, save };
})();
