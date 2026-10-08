'use strict';
// More PDF tools for the converter, all in the browser: Sign PDF, Scan to PDF,
// PDF Forms, Redact PDF (permanent) and Compare PDF. The PDF work is in plain
// functions (sign, redact, fillForm, formFields, enhance, imagesToPdf, diffLines,
// pdfLines) that the tests run in Node; the rest is the options panel UI.
(() => {
  const L = (en, id) => (globalThis.I18N ? globalThis.I18N.pick(en, id) : en);
  const TOOLS = ['sign-pdf', 'scan-to-pdf', 'pdf-forms', 'redact-pdf', 'compare-pdf'];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Displayed page size and the matrix from displayed coordinates to PDF space
  // (crop box + page rotation), as in pdf-edit.js.
  function geometry(page) {
    const { x, y, width: w, height: h } = page.getCropBox();
    const angle = ((page.getRotation().angle % 360) + 360) % 360;
    const m = { 0: [1, 0, 0, 1, x, y], 90: [0, 1, -1, 0, x + w, y], 180: [-1, 0, 0, -1, x + w, y + h], 270: [0, -1, 1, 0, x, y + h] }[angle];
    if (!m) throw Error('Unsupported page rotation.');
    return { width: angle % 180 ? h : w, height: angle % 180 ? w : h, matrix: m };
  }
  const isPng = b => b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71;
  const isJpg = b => b[0] === 255 && b[1] === 216;

  // ---- Sign PDF ---------------------------------------------------------------
  // placements: [{page (0-based), x, y, w}] as fractions of the displayed page
  // (x, y = top-left corner); the height follows the signature's own shape.
  async function sign(input, image, placements) {
    const lib = globalThis.PDFLib;
    if (!placements || !placements.length) throw Error(L('Place the signature on a page first.', 'Taruh tanda tangan di halaman dulu.'));
    const doc = await lib.PDFDocument.load(input);
    const bytes = new Uint8Array(image);
    const img = isPng(bytes) ? await doc.embedPng(bytes) : isJpg(bytes) ? await doc.embedJpg(bytes) : null;
    if (!img) throw Error(L('The signature must be a PNG or JPEG image.', 'Tanda tangan harus gambar PNG atau JPEG.'));
    for (const p of placements) {
      if (!(p.page >= 0 && p.page < doc.getPageCount())) throw Error(L('A signature is on a page this PDF does not have.', 'Ada tanda tangan di halaman yang tidak ada.'));
      const page = doc.getPage(p.page), g = geometry(page);
      const w = p.w * g.width, h = w * img.height / img.width;
      page.pushOperators(lib.pushGraphicsState(), lib.concatTransformationMatrix(...g.matrix));
      page.drawImage(img, { x: p.x * g.width, y: g.height - p.y * g.height - h, width: w, height: h });
      page.pushOperators(lib.popGraphicsState());
    }
    return doc.save();
  }

  // ---- Redact PDF (permanent) -----------------------------------------------------
  // boxes: {pageIndex: [{x, y, w, h}]} as fractions of the displayed page.
  // Every page with a box is rendered to an image, the boxes are painted black
  // and the page is replaced by that image, so the text underneath is gone for
  // good (copy, search and text extraction find nothing there).
  async function redact(input, boxes, opts = {}) {
    const lib = globalThis.PDFLib, pdfjs = opts.pdfjs || globalThis.pdfjsLib;
    const scale = opts.scale || 2;
    const makeCanvas = opts.canvas || ((w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }));
    const toJpeg = opts.toJpeg || (async c => new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92))).arrayBuffer()));
    const pages = Object.keys(boxes || {}).map(Number).filter(i => boxes[i] && boxes[i].length).sort((a, b) => a - b);
    if (!pages.length) throw Error(L('Mark at least one area to redact.', 'Tandai minimal satu area yang mau disensor.'));
    const doc = await lib.PDFDocument.load(input);
    const view = await pdfjs.getDocument({ data: new Uint8Array(input).slice(), isEvalSupported: false, disableWorker: opts.disableWorker, ...(opts.docOptions || {}) }).promise;
    try {
      for (let n = 0; n < pages.length; n++) {
        const i = pages[n];
        if (i < 0 || i >= doc.getPageCount()) throw Error(L('A box is on a page this PDF does not have.', 'Ada kotak di halaman yang tidak ada.'));
        const pdfPage = await view.getPage(i + 1), vp = pdfPage.getViewport({ scale });
        const canvas = makeCanvas(Math.ceil(vp.width), Math.ceil(vp.height)), ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
        ctx.fillStyle = '#000';
        for (const b of boxes[i]) ctx.fillRect(b.x * canvas.width, b.y * canvas.height, b.w * canvas.width, b.h * canvas.height);
        const img = await doc.embedJpg(await toJpeg(canvas));
        const g = geometry(doc.getPage(i));
        const fresh = doc.insertPage(i, [g.width, g.height]);
        fresh.drawImage(img, { x: 0, y: 0, width: g.width, height: g.height });
        doc.removePage(i + 1);
        if (opts.progress) opts.progress(n + 1, pages.length);
      }
    } finally { await view.destroy(); }
    return doc.save();
  }

  // Boxes (fractions) around every match of `query` on one pdf.js page.
  async function findText(pdfPage, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const vp = pdfPage.getViewport({ scale: 1 }), content = await pdfPage.getTextContent(), out = [];
    const util = (globalThis.pdfjsLib && globalThis.pdfjsLib.Util) || null;
    for (const item of content.items) {
      const str = String(item.str || ''), lower = str.toLowerCase();
      if (!str || !lower.includes(q) || !util) continue;
      const t = util.transform(vp.transform, item.transform);
      const height = Math.hypot(t[2], t[3]) || 10, width = (item.width || 0) * vp.scale;
      for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, at + q.length)) {
        const x = t[4] + width * at / str.length, w = width * q.length / str.length;
        out.push({ x: (x - 1) / vp.width, y: (t[5] - height * 1.05) / vp.height, w: (w + 2) / vp.width, h: (height * 1.3) / vp.height });
      }
    }
    return out;
  }

  // ---- PDF Forms --------------------------------------------------------------------
  function kind(field) {
    const lib = globalThis.PDFLib;
    if (field instanceof lib.PDFTextField) return 'text';
    if (field instanceof lib.PDFCheckBox) return 'checkbox';
    if (field instanceof lib.PDFDropdown) return 'dropdown';
    if (field instanceof lib.PDFRadioGroup) return 'radio';
    if (field instanceof lib.PDFOptionList) return 'list';
    return 'other';
  }
  async function formFields(input) {
    const doc = await globalThis.PDFLib.PDFDocument.load(input);
    let fields;
    try { fields = doc.getForm().getFields(); } catch (e) { throw Error(L('This form type is not supported (XFA).', 'Jenis formulir ini belum didukung (XFA).')); }
    return fields.map(f => {
      const k = kind(f), out = { name: f.getName(), kind: k, readOnly: f.isReadOnly() };
      if (k === 'text') { out.value = f.getText() || ''; out.multiline = f.isMultiline(); }
      else if (k === 'checkbox') out.value = f.isChecked();
      else if (k === 'dropdown' || k === 'list') { out.options = f.getOptions(); out.value = f.getSelected(); }
      else if (k === 'radio') { out.options = f.getOptions(); out.value = f.getSelected() || ''; }
      return out;
    }).filter(f => f.kind !== 'other');
  }
  async function fillForm(input, values, flatten) {
    const doc = await globalThis.PDFLib.PDFDocument.load(input);
    const form = doc.getForm();
    for (const [name, value] of Object.entries(values || {})) {
      const f = form.getFieldMaybe(name);
      if (!f || f.isReadOnly()) continue;
      const k = kind(f);
      try {
        if (k === 'text') f.setText(String(value ?? ''));
        else if (k === 'checkbox') value ? f.check() : f.uncheck();
        else if (k === 'dropdown' || k === 'radio') { if (value) f.select(String(value)); else if (k === 'dropdown') f.clear(); }
        else if (k === 'list') { const v = [].concat(value || []); if (v.length) f.select(v); else f.clear(); }
      } catch (e) {
        throw Error(L(`Field "${name}": ${e.message}`, `Kolom "${name}": ${e.message}`));
      }
    }
    try {
      if (flatten) form.flatten();
      return await doc.save();
    } catch (e) {
      throw Error(L('Some characters cannot be written into this form (the form font only has Latin letters).',
        'Ada huruf yang tidak bisa ditulis di formulir ini (font formulir hanya huruf Latin).'));
    }
  }

  // ---- Scan to PDF ------------------------------------------------------------------
  // Clean up a photo of a document in place (ImageData): 'gray' or 'document'
  // (grey, paper pushed to white, ink darkened); 'color' leaves it as it is.
  function enhance(data, mode) {
    if (mode !== 'gray' && mode !== 'document') return data;
    const px = data.data, hist = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) {
      const g = Math.round(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
      px[i] = px[i + 1] = px[i + 2] = g; hist[g]++;
    }
    if (mode === 'document') {
      const total = px.length / 4, at = share => { let sum = 0; for (let v = 0; v < 256; v++) { sum += hist[v]; if (sum >= total * share) return v; } return 255; };
      const black = at(0.02), white = Math.max(black + 40, at(0.7));
      const map = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) map[v] = Math.round(255 * Math.pow(Math.min(1, Math.max(0, (v - black) / (white - black))), 1.25));
      for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = map[px[i]];
    }
    return data;
  }
  // images: [{bytes: JPEG, width, height}] -> one PDF; size 'a4' (fitted with a
  // small margin, portrait or landscape like the photo) or 'photo' (page = photo at 150 dpi).
  async function imagesToPdf(images, size) {
    const lib = globalThis.PDFLib, doc = await lib.PDFDocument.create();
    if (!images.length) throw Error(L('Add at least one photo.', 'Tambahkan minimal satu foto.'));
    for (const im of images) {
      const img = await doc.embedJpg(im.bytes);
      if (size === 'photo') {
        const w = im.width * 72 / 150, h = im.height * 72 / 150;
        doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
      } else {
        const land = im.width > im.height, W = land ? 842 : 595, H = land ? 595 : 842, m = 18;
        const s = Math.min((W - 2 * m) / im.width, (H - 2 * m) / im.height), w = im.width * s, h = im.height * s;
        doc.addPage([W, H]).drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
      }
    }
    return doc.save();
  }

  // ---- Compare PDF ------------------------------------------------------------------
  // Text lines per page from a pdf.js document: [{text, page}].
  async function pdfLines(pdf) {
    const lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p), content = await page.getTextContent(), rows = [];
      for (const it of content.items) {
        const s = String(it.str || ''); if (!s.trim()) continue;
        const y = it.transform[5], x = it.transform[4];
        let row = rows.find(r => Math.abs(r.y - y) <= Math.max(2, Math.abs(it.transform[3]) * 0.4));
        if (!row) rows.push(row = { y, parts: [] });
        row.parts.push({ x, s });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        const text = r.parts.sort((a, b) => a.x - b.x).map(q => q.s).join(' ').replace(/\s+/g, ' ').trim();
        if (text) lines.push({ text, page: p });
      }
    }
    return lines;
  }
  // Myers diff of two string arrays: [{op: '=' | '-' | '+', a, b}] (indexes),
  // or null when they differ in more than `limit` lines.
  function diffLines(a, b, limit = 4000) {
    const n = a.length, m = b.length, max = n + m, off = max + 1, v = new Int32Array(2 * max + 3), trace = [];
    for (let d = 0; d <= max; d++) {
      if (d > limit) return null;
      trace.push(v.slice(off - d - 1, off + d + 2));
      for (let k = -d; k <= d; k += 2) {
        let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1, y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; }
        v[off + k] = x;
        if (x >= n && y >= m) return backtrack(trace, n, m);
      }
    }
    return [];
  }
  function backtrack(trace, n, m) {
    const ops = []; let x = n, y = m;
    for (let d = trace.length - 1; d >= 0; d--) {
      const vv = trace[d], get = k => vv[k + d + 1], k = x - y;
      const prevK = (k === -d || (k !== d && get(k - 1) < get(k + 1))) ? k + 1 : k - 1;
      const prevX = get(prevK), prevY = prevX - prevK;
      while (x > prevX && y > prevY) { ops.push({ op: '=', a: x - 1, b: y - 1 }); x--; y--; }
      if (d > 0) ops.push(x === prevX ? { op: '+', b: y - 1 } : { op: '-', a: x - 1 });
      x = prevX; y = prevY;
    }
    return ops.reverse();
  }
  // Report data: changed blocks with a line of context around each.
  function compare(linesA, linesB) {
    const ops = diffLines(linesA.map(l => l.text), linesB.map(l => l.text));
    if (!ops) return null;
    const removed = ops.filter(o => o.op === '-').length, added = ops.filter(o => o.op === '+').length;
    const blocks = []; let cur = null;
    ops.forEach((o, i) => {
      if (o.op === '=') return;
      if (!cur || i > cur.end + 2) { cur = { start: Math.max(0, i - 1), end: i }; blocks.push(cur); }
      cur.end = i;
    });
    const rows = blocks.map(bl => ops.slice(bl.start, Math.min(ops.length, bl.end + 2)).map(o => o.op === '+'
      ? { op: '+', text: linesB[o.b].text, page: linesB[o.b].page }
      : { op: o.op, text: linesA[o.a].text, page: linesA[o.a].page, pageB: o.op === '=' ? linesB[o.b].page : null }));
    return { removed, added, same: ops.length - removed - added, blocks: rows };
  }
  function reportHtml(result, nameA, nameB) {
    const head = `<h2 style="margin:0 0 6px">${esc(L('PDF comparison', 'Perbandingan PDF'))}</h2>
      <p style="margin:0 0 12px;color:#57534e;font-size:13px">A: ${esc(nameA)}<br>B: ${esc(nameB)}</p>`;
    if (!result) return head + `<p>${esc(L('The documents are too different to compare line by line.', 'Dokumen terlalu berbeda untuk dibandingkan baris demi baris.'))}</p>`;
    const summary = `<p style="font-size:14px"><b style="color:#b91c1c">− ${result.removed}</b> ${esc(L('lines removed', 'baris dihapus'))} ·
      <b style="color:#15803d">+ ${result.added}</b> ${esc(L('lines added', 'baris ditambah'))} · ${result.same} ${esc(L('unchanged', 'sama'))}</p>`;
    if (!result.blocks.length) return head + summary + `<p>✅ ${esc(L('The text of both PDFs is identical.', 'Teks kedua PDF sama persis.'))}</p>`;
    const row = r => {
      const bg = r.op === '+' ? '#dcfce7' : r.op === '-' ? '#fee2e2' : '#fff', sign = r.op === '=' ? '&nbsp;' : r.op === '+' ? '+' : '−';
      const page = r.op === '+' ? 'B ' + r.page : 'A ' + r.page;
      return `<tr style="background:${bg}"><td style="padding:3px 8px;color:#78716c;white-space:nowrap;font-size:11px">${page}</td>
        <td style="padding:3px 6px;font-weight:700">${sign}</td><td style="padding:3px 8px">${esc(r.text)}</td></tr>`;
    };
    return head + summary + result.blocks.map(b => `<table style="width:100%;border-collapse:collapse;border:1px solid #e7e5e4;margin:10px 0;font-size:13px">${b.map(row).join('')}</table>`).join('');
  }

  // =====================================================================================
  // UI (browser only)
  // =====================================================================================
  const state = { tool: null, file: null, view: null, page: 0, sig: null, sigSize: null, placements: [], boxes: {}, fields: [] };
  const $ = s => document.querySelector(s);
  const card = inner => `<div class="w-full bg-white rounded-xl border border-gray-200 p-4 shadow-sm grid gap-3 text-left text-xs">${inner}</div>`;
  const btn = (label, onclick, primary) => `<button type="button" onclick="${onclick}" class="px-3 py-2 rounded-xl ${primary ? 'bg-[#1A3C34] text-white' : 'border bg-white'} text-xs font-bold">${label}</button>`;
  const previewBox = `<div class="grid gap-2">
      <div class="flex items-center gap-2 justify-between"><div class="flex gap-2">${btn('←', 'PDFExtra.go(-1)')}${btn('→', 'PDFExtra.go(1)')}</div>
      <span id="xp-page" class="text-gray-500"></span></div>
      <div id="xp-stage" class="relative mx-auto select-none" style="touch-action:none;max-width:100%"><canvas id="xp-canvas" class="block border rounded-lg shadow-sm" style="max-width:100%;height:auto"></canvas></div>
    </div>`;

  function controls(tool) {
    state.tool = tool;
    if (tool === 'sign-pdf') return card(`
      <b class="text-sm">1. ${L('Make your signature', 'Buat tanda tangan')}</b>
      <div class="flex flex-wrap gap-2">${btn(L('✍️ Draw', '✍️ Gambar'), "PDFExtra.sigMode('draw')")}${btn(L('🖼 Upload image', '🖼 Unggah gambar'), "PDFExtra.sigMode('image')")}${btn(L('⌨️ Type name', '⌨️ Ketik nama'), "PDFExtra.sigMode('type')")}</div>
      <div id="xs-draw"><canvas id="xs-pad" width="600" height="200" class="w-full border-2 border-dashed rounded-xl bg-white" style="touch-action:none;cursor:crosshair" onpointerdown="PDFExtra.pad(event)" onpointermove="PDFExtra.pad(event)" onpointerup="PDFExtra.pad(event)" onpointercancel="PDFExtra.pad(event)"></canvas>
        <div class="flex gap-2 mt-2 items-center">${btn(L('Clear', 'Hapus'), 'PDFExtra.clearPad()')}<label class="flex items-center gap-1">${L('Ink', 'Tinta')} <select id="xs-color" class="border rounded-lg px-2 py-1"><option value="#111827">${L('Black', 'Hitam')}</option><option value="#1d3fb8">${L('Blue', 'Biru')}</option></select></label></div></div>
      <div id="xs-image" hidden><input id="xs-file" type="file" accept=".png,.jpg,.jpeg" onchange="PDFExtra.sigFromFile(this)"><p class="text-gray-500 mt-1">${L('A PNG with a transparent background looks best.', 'PNG berlatar transparan hasilnya paling rapi.')}</p></div>
      <div id="xs-type" hidden><input id="xs-name" type="text" maxlength="40" placeholder="${L('Your name', 'Nama kamu')}" oninput="PDFExtra.sigFromText()" class="w-full px-3 py-2 rounded-xl border"></div>
      <b class="text-sm">2. ${L('Click the page where it goes', 'Klik di halaman tempat tanda tangan')}</b>
      <p class="text-gray-500">${L('Drag to move, drag the corner to resize, ✕ to remove. Use → for other pages.', 'Geser untuk memindah, tarik pojok untuk mengubah ukuran, ✕ untuk menghapus. Pakai → untuk halaman lain.')}</p>
      ${previewBox}<p id="xs-count" class="font-semibold"></p>`);
    if (tool === 'redact-pdf') return card(`
      <p class="bg-[#FFF7EA] border border-[#F3D9B1] rounded-lg p-2">${L('Drag over the page to black out an area, or search for text (a name, ID number…) to mark every match. Pages with a box become images, so the hidden text is removed for good — text on those pages can no longer be selected.',
        'Seret di halaman untuk menghitamkan area, atau cari teks (nama, NIK…) untuk menandai semua kemunculannya. Halaman yang diberi kotak diubah jadi gambar, jadi teks di bawah kotak benar-benar hilang — teks di halaman itu tidak bisa dipilih lagi.')}</p>
      <div class="flex gap-2"><input id="xr-query" type="text" placeholder="${L('Text to redact on every page', 'Teks yang disensor di semua halaman')}" class="flex-1 px-3 py-2 rounded-xl border">${btn(L('Mark all', 'Tandai semua'), 'PDFExtra.markText()', true)}</div>
      ${previewBox}<div class="flex items-center gap-2"><p id="xr-count" class="font-semibold flex-1"></p>${btn(L('Clear all boxes', 'Hapus semua kotak'), 'PDFExtra.clearBoxes()')}</div>`);
    if (tool === 'pdf-forms') return card(`<div id="xf-fields" class="grid gap-3"><p class="text-gray-500">${L('Choose a PDF that has fillable fields.', 'Pilih PDF yang punya kolom isian.')}</p></div>
      <label class="flex items-center gap-2 font-semibold"><input id="xf-flatten" type="checkbox"> ${L('Lock the answers (flatten — fields can no longer be edited)', 'Kunci isian (flatten — kolom tidak bisa diubah lagi)')}</label>`);
    if (tool === 'scan-to-pdf') return card(`
      <label class="flex items-center justify-center gap-2 px-4 py-4 rounded-2xl bg-[#1A3C34] text-white text-sm font-bold cursor-pointer">📷 ${L('Take photos of the document', 'Foto dokumen sekarang')}
        <input type="file" accept="image/*" capture="environment" multiple hidden onchange="handleFiles(this.files);this.value=''"></label>
      <p class="text-gray-500 text-center">${L('On a phone this opens the camera; take one photo per page. You can also pick photos from the gallery.', 'Di HP ini membuka kamera; ambil satu foto per halaman. Bisa juga pilih foto dari galeri.')}</p>
      <div class="grid sm:grid-cols-2 gap-3">
        <label class="flex flex-col gap-1 font-semibold">${L('Look', 'Tampilan')}<select id="xc-mode" class="px-3 py-2 rounded-xl border bg-white"><option value="document">${L('Document (clean, black & white)', 'Dokumen (bersih, hitam-putih)')}</option><option value="gray">${L('Greyscale', 'Abu-abu')}</option><option value="color">${L('Original colour', 'Warna asli')}</option></select></label>
        <label class="flex flex-col gap-1 font-semibold">${L('Page size', 'Ukuran halaman')}<select id="xc-size" class="px-3 py-2 rounded-xl border bg-white"><option value="a4">A4</option><option value="photo">${L('Same as photo', 'Sama dengan foto')}</option></select></label>
      </div><p class="text-gray-500">${L('Pages follow the order of the file list.', 'Urutan halaman mengikuti daftar file.')}</p>`);
    if (tool === 'compare-pdf') return card(`<p>${L('Choose two PDFs — the older version first, then the newer one. Their text is compared line by line: removed lines in red, added lines in green.',
      'Pilih dua PDF — versi lama dulu, lalu versi baru. Teksnya dibandingkan baris demi baris: baris yang dihapus merah, yang ditambah hijau.')}</p>
      <div id="xd-report" class="bg-[#fafaf9] rounded-xl border p-3 overflow-auto" style="max-height:520px" hidden></div>`);
    return '';
  }
  function button(tool) {
    return { 'sign-pdf': L('Sign PDF →', 'Tanda tangani PDF →'), 'scan-to-pdf': L('Make PDF →', 'Buat PDF →'), 'pdf-forms': L('Save filled PDF →', 'Simpan PDF terisi →'),
      'redact-pdf': L('Redact & download →', 'Sensor & unduh →'), 'compare-pdf': L('Compare →', 'Bandingkan →') }[tool];
  }

  // ---- page preview (sign / redact) ----
  async function onFiles(tool, files) {
    const file = files[0] || null;
    if (tool === 'pdf-forms') return file === state.file ? null : loadForm(file);
    if (tool !== 'sign-pdf' && tool !== 'redact-pdf') return;
    if (file === state.file && state.view) return draw();
    state.file = file; state.page = 0; state.placements = []; state.boxes = {};
    if (state.view) { try { state.view.destroy(); } catch (e) {} state.view = null; }
    if (!file) return;
    state.view = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableWorker: location.protocol === 'file:' }).promise;
    await draw();
  }
  function go(step) {
    if (!state.view) return;
    state.page = Math.min(state.view.numPages - 1, Math.max(0, state.page + step));
    draw();
  }
  async function draw() {
    const canvas = $('#xp-canvas'), stage = $('#xp-stage');
    if (!canvas || !state.view) return;
    const page = await state.view.getPage(state.page + 1);
    const base = page.getViewport({ scale: 1 }), width = Math.min(stage.parentElement.clientWidth || 600, 720);
    const vp = page.getViewport({ scale: width / base.width * (window.devicePixelRatio || 1) });
    canvas.width = vp.width; canvas.height = vp.height; canvas.style.width = width + 'px';
    stage.style.width = width + 'px';
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    $('#xp-page').textContent = L(`Page ${state.page + 1} of ${state.view.numPages}`, `Halaman ${state.page + 1} dari ${state.view.numPages}`);
    overlay();
    stage.onpointerdown = state.tool === 'sign-pdf' ? placeSig : startBox;
  }
  const frac = (e, stage) => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  function overlay() {
    const stage = $('#xp-stage'); if (!stage) return;
    stage.querySelectorAll('.xp-item').forEach(n => n.remove());
    const ratio = stage.clientWidth / stage.clientHeight || 1;
    if (state.tool === 'sign-pdf') {
      state.placements.forEach((p, i) => {
        if (p.page !== state.page) return;
        const h = p.w * ratio * (state.sigSize ? state.sigSize.h / state.sigSize.w : 0.33);
        const el = item(p.x, p.y, p.w, h, i, 'sign');
        el.innerHTML = `<img src="${state.sigUrl}" style="width:100%;height:100%;object-fit:contain;pointer-events:none">`;
        decorate(el, i);
      });
      const c = $('#xs-count'); if (c) c.textContent = state.placements.length ? L(`${state.placements.length} signature(s) placed`, `${state.placements.length} tanda tangan dipasang`) : '';
    } else {
      (state.boxes[state.page] || []).forEach((b, i) => { const el = item(b.x, b.y, b.w, b.h, i, 'box'); el.style.background = 'rgba(0,0,0,.78)'; decorate(el, i); });
      const total = Object.values(state.boxes).reduce((s, l) => s + l.length, 0), pages = Object.values(state.boxes).filter(l => l.length).length;
      const c = $('#xr-count'); if (c) c.textContent = total ? L(`${total} box(es) on ${pages} page(s)`, `${total} kotak di ${pages} halaman`) : '';
    }
  }
  function item(x, y, w, h, i, type) {
    const el = document.createElement('div');
    el.className = 'xp-item'; el.dataset.index = i; el.dataset.type = type;
    el.style.cssText = `position:absolute;left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%;outline:2px dashed #FF5C28;cursor:move`;
    $('#xp-stage').append(el);
    return el;
  }
  function decorate(el, i) {
    const x = document.createElement('button');
    x.type = 'button'; x.textContent = '✕';
    x.style.cssText = 'position:absolute;top:-11px;right:-11px;width:22px;height:22px;border-radius:50%;border:0;background:#b91c1c;color:#fff;font-size:12px;cursor:pointer';
    x.onpointerdown = e => e.stopPropagation();
    x.onclick = () => { if (el.dataset.type === 'sign') state.placements.splice(i, 1); else state.boxes[state.page].splice(i, 1); overlay(); };
    const grip = document.createElement('span');
    grip.style.cssText = 'position:absolute;right:-6px;bottom:-6px;width:14px;height:14px;background:#FF5C28;border-radius:3px;cursor:nwse-resize';
    el.append(x, grip);
    el.onpointerdown = e => {
      e.stopPropagation(); e.preventDefault();
      const stage = $('#xp-stage'), [sx, sy] = frac(e, stage), resize = e.target === grip;
      const obj = el.dataset.type === 'sign' ? state.placements[i] : state.boxes[state.page][i], start = { ...obj };
      const move = ev => {
        const [cx, cy] = frac(ev, stage), dx = cx - sx, dy = cy - sy;
        if (resize) { obj.w = Math.max(0.03, start.w + dx); if (obj.h !== undefined) obj.h = Math.max(0.01, start.h + dy); }
        else { obj.x = Math.min(0.99, Math.max(-0.05, start.x + dx)); obj.y = Math.min(0.99, Math.max(-0.05, start.y + dy)); }
        overlay();
      };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    };
  }
  function placeSig(e) {
    if (!state.sig) { showErr(L('Make your signature first (step 1).', 'Buat tanda tangan dulu (langkah 1).')); return; }
    const stage = $('#xp-stage'), [x, y] = frac(e, stage), w = 0.28;
    const h = w * (stage.clientWidth / stage.clientHeight) * (state.sigSize.h / state.sigSize.w);
    state.placements.push({ page: state.page, x: Math.max(0, x - w / 2), y: Math.max(0, y - h / 2), w });
    overlay();
  }
  function startBox(e) {
    const stage = $('#xp-stage'), [sx, sy] = frac(e, stage);
    const list = state.boxes[state.page] = state.boxes[state.page] || [];
    const box = { x: sx, y: sy, w: 0, h: 0 }; list.push(box);
    const move = ev => { const [cx, cy] = frac(ev, stage); box.x = Math.min(sx, cx); box.y = Math.min(sy, cy); box.w = Math.abs(cx - sx); box.h = Math.abs(cy - sy); overlay(); };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (box.w < 0.005 || box.h < 0.004) list.splice(list.indexOf(box), 1);
      overlay();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
  async function markText() {
    const q = ($('#xr-query') || {}).value;
    if (!state.view) { showErr(L('Choose a PDF first.', 'Pilih PDF dulu.')); return; }
    if (!String(q || '').trim()) { showErr(L('Type the text to find.', 'Ketik teks yang dicari.')); return; }
    let found = 0;
    for (let p = 0; p < state.view.numPages; p++) {
      const boxes = await findText(await state.view.getPage(p + 1), q);
      if (boxes.length) { (state.boxes[p] = state.boxes[p] || []).push(...boxes); found += boxes.length; }
    }
    overlay();
    if (!found) showErr(L('No matches. Scanned pages have no text — draw boxes by hand there.', 'Tidak ditemukan. Halaman hasil scan tidak punya teks — gambar kotaknya manual.'));
  }
  function clearBoxes() { state.boxes = {}; overlay(); }
  function showErr(m) { const e = $('#error'); if (e) { e.textContent = m; e.classList.remove('hidden'); } }

  // ---- signature sources ----
  function sigMode(mode) {
    for (const m of ['draw', 'image', 'type']) { const el = $('#xs-' + m); if (el) el.hidden = m !== mode; }
  }
  // Drawing pad (inline handlers, so it keeps working when the panel is rebuilt).
  const ink = { drawing: false, last: null };
  function pad(e) {
    const el = e.currentTarget, r = el.getBoundingClientRect();
    const p = [(e.clientX - r.left) * el.width / r.width, (e.clientY - r.top) * el.height / r.height];
    if (e.type === 'pointerdown') { ink.drawing = true; ink.last = p; try { el.setPointerCapture(e.pointerId); } catch (err) {} e.preventDefault(); return; }
    if (!ink.drawing) return;
    if (e.type === 'pointermove') {
      const ctx = el.getContext('2d');
      ctx.strokeStyle = ($('#xs-color') || {}).value || '#111827'; ctx.lineWidth = 3.2; ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(...ink.last); ctx.lineTo(...p); ctx.stroke(); ink.last = p;
    } else { ink.drawing = false; useCanvas(el); }
  }
  function clearPad() { const pad = $('#xs-pad'); if (pad) pad.getContext('2d').clearRect(0, 0, pad.width, pad.height); state.sig = null; }
  // Trim the transparent edges, keep the result as PNG bytes.
  function useCanvas(src) {
    const ctx = src.getContext('2d'), { data, width, height } = ctx.getImageData(0, 0, src.width, src.height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return;
    const pad = 6, w = x1 - x0 + 1 + pad * 2, h = y1 - y0 + 1 + pad * 2;
    const out = Object.assign(document.createElement('canvas'), { width: w, height: h });
    out.getContext('2d').drawImage(src, x0 - pad, y0 - pad, w, h, 0, 0, w, h);
    out.toBlob(async blob => { setSig(new Uint8Array(await blob.arrayBuffer()), w, h, URL.createObjectURL(blob)); }, 'image/png');
  }
  function setSig(bytes, w, h, url) {
    if (state.sigUrl) URL.revokeObjectURL(state.sigUrl);
    state.sig = bytes; state.sigSize = { w, h }; state.sigUrl = url; overlay();
  }
  async function sigFromFile(input) {
    const f = input.files[0]; if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!isPng(bytes) && !isJpg(bytes)) { showErr(L('Choose a PNG or JPEG image.', 'Pilih gambar PNG atau JPEG.')); return; }
    const url = URL.createObjectURL(f), img = new Image();
    img.onload = () => setSig(bytes, img.naturalWidth, img.naturalHeight, url);
    img.src = url;
  }
  function sigFromText() {
    const name = (($('#xs-name') || {}).value || '').trim(); if (!name) return;
    const c = Object.assign(document.createElement('canvas'), { width: 900, height: 220 }), ctx = c.getContext('2d');
    ctx.fillStyle = ($('#xs-color') || {}).value || '#111827';
    ctx.font = 'italic 110px "Segoe Script","Brush Script MT","Lucida Handwriting",cursive';
    ctx.textBaseline = 'middle'; ctx.fillText(name, 20, 115);
    useCanvas(c);
  }

  // ---- forms ----
  async function loadForm(file) {
    state.file = file;
    const box = $('#xf-fields'); if (!box) return;
    if (!file) { box.innerHTML = ''; return; }
    try { state.fields = await formFields(new Uint8Array(await file.arrayBuffer())); }
    catch (e) { box.innerHTML = `<p class="text-red-700">${esc(e.message)}</p>`; state.fields = []; return; }
    if (!state.fields.length) {
      box.innerHTML = `<p class="bg-[#FFF7EA] border border-[#F3D9B1] rounded-lg p-2">${L('This PDF has no fillable fields. To write on it anyway, use <a class="underline" href="converter.html?tool=edit-pdf">Edit PDF</a> (add text).',
        'PDF ini tidak punya kolom isian. Untuk tetap menulis di atasnya, pakai <a class="underline" href="converter.html?tool=edit-pdf">Edit PDF</a> (tambah teks).')}</p>`;
      return;
    }
    box.innerHTML = `<p class="font-semibold">${L(`${state.fields.length} field(s) found`, `${state.fields.length} kolom ditemukan`)}</p>` + state.fields.map((f, i) => {
      const id = 'xf-' + i, dis = f.readOnly ? 'disabled' : '', label = `<span class="font-semibold">${esc(f.name)}${f.readOnly ? ' 🔒' : ''}</span>`;
      if (f.kind === 'checkbox') return `<label class="flex items-center gap-2"><input id="${id}" type="checkbox" ${f.value ? 'checked' : ''} ${dis}> ${label}</label>`;
      if (f.kind === 'text') return `<label class="flex flex-col gap-1">${label}${f.multiline ? `<textarea id="${id}" rows="3" class="px-3 py-2 rounded-xl border" ${dis}>${esc(f.value)}</textarea>` : `<input id="${id}" type="text" value="${esc(f.value)}" class="px-3 py-2 rounded-xl border" ${dis}>`}</label>`;
      const multi = f.kind === 'list' ? 'multiple' : '', chosen = [].concat(f.value || []);
      return `<label class="flex flex-col gap-1">${label}<select id="${id}" ${multi} class="px-3 py-2 rounded-xl border bg-white" ${dis}>${f.kind === 'list' ? '' : '<option value="">—</option>'}${f.options.map(o => `<option ${chosen.includes(o) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    }).join('');
  }
  function formValues() {
    const values = {};
    state.fields.forEach((f, i) => {
      const el = $('#xf-' + i); if (!el || f.readOnly) return;
      values[f.name] = f.kind === 'checkbox' ? el.checked : f.kind === 'list' ? [...el.selectedOptions].map(o => o.value) : el.value;
    });
    return values;
  }

  // ---- run (the converter's big button) ----
  const base = name => name.replace(/\.[^.]+$/, '');
  async function loadImage(file) {
    if (globalThis.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {} }
    const url = URL.createObjectURL(file), img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(Error(L(`${file.name} could not be read as an image.`, `${file.name} tidak bisa dibaca sebagai gambar.`))); img.src = url; });
    return img;
  }
  async function run(tool, files, progress) {
    if (tool === 'sign-pdf') {
      if (!state.sig) throw Error(L('Make your signature first (step 1).', 'Buat tanda tangan dulu (langkah 1).'));
      const out = await sign(new Uint8Array(await files[0].arrayBuffer()), state.sig, state.placements);
      return { blob: new Blob([out], { type: 'application/pdf' }), name: base(files[0].name) + '-signed.pdf' };
    }
    if (tool === 'redact-pdf') {
      const out = await redact(new Uint8Array(await files[0].arrayBuffer()), state.boxes, {
        disableWorker: location.protocol === 'file:', progress: (n, t) => progress(L(`Redacting page ${n} / ${t}…`, `Menyensor halaman ${n} / ${t}…`)) });
      return { blob: new Blob([out], { type: 'application/pdf' }), name: base(files[0].name) + '-redacted.pdf' };
    }
    if (tool === 'pdf-forms') {
      if (!state.fields.length) throw Error(L('This PDF has no fillable fields.', 'PDF ini tidak punya kolom isian.'));
      const out = await fillForm(new Uint8Array(await files[0].arrayBuffer()), formValues(), ($('#xf-flatten') || {}).checked);
      return { blob: new Blob([out], { type: 'application/pdf' }), name: base(files[0].name) + '-filled.pdf' };
    }
    if (tool === 'scan-to-pdf') {
      const mode = ($('#xc-mode') || {}).value || 'document', size = ($('#xc-size') || {}).value || 'a4', images = [];
      for (let i = 0; i < files.length; i++) {
        progress(L(`Cleaning photo ${i + 1} / ${files.length}…`, `Merapikan foto ${i + 1} / ${files.length}…`));
        const img = await loadImage(files[i]), w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
        const s = Math.min(1, 2200 / Math.max(w0, h0)), w = Math.round(w0 * s), h = Math.round(h0 * s);
        const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        if (mode !== 'color') ctx.putImageData(enhance(ctx.getImageData(0, 0, w, h), mode), 0, 0);
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', mode === 'document' ? 0.8 : 0.85));
        images.push({ bytes: new Uint8Array(await blob.arrayBuffer()), width: w, height: h });
      }
      const out = await imagesToPdf(images, size);
      return { blob: new Blob([out], { type: 'application/pdf' }), name: 'scan-' + new Date().toISOString().slice(0, 10) + '.pdf' };
    }
    if (tool === 'compare-pdf') {
      if (files.length !== 2) throw Error(L('Choose exactly two PDFs: the old version and the new one.', 'Pilih tepat dua PDF: versi lama dan versi baru.'));
      const read = async f => { const d = await pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()), disableWorker: location.protocol === 'file:' }).promise; try { return await pdfLines(d); } finally { d.destroy(); } };
      progress(L('Reading both PDFs…', 'Membaca kedua PDF…'));
      const [a, b] = [await read(files[0]), await read(files[1])];
      if (!a.length && !b.length) throw Error(L('Neither PDF has text (scans?). Run OCR PDF first.', 'Kedua PDF tidak punya teks (hasil scan?). Jalankan OCR PDF dulu.'));
      const html = reportHtml(compare(a, b), files[0].name, files[1].name);
      const box = $('#xd-report'); if (box) { box.innerHTML = html; box.hidden = false; }
      const page = `<!doctype html><meta charset="utf-8"><title>${esc(L('PDF comparison', 'Perbandingan PDF'))}</title><body style="font-family:system-ui,sans-serif;max-width:960px;margin:24px auto;padding:0 16px">${html}</body>`;
      return { blob: new Blob([page], { type: 'text/html' }), name: L('comparison', 'perbandingan') + '-' + base(files[0].name) + '.html' };
    }
    throw Error('Unknown tool');
  }

  globalThis.PDFExtra = {
    has: t => TOOLS.includes(t), controls, button, onFiles, run, go, markText, clearBoxes, sigMode, clearPad, sigFromFile, sigFromText, pad,
    // the PDF work, for tests
    sign, redact, findText, formFields, fillForm, enhance, imagesToPdf, pdfLines, diffLines, compare, reportHtml,
  };
})();
