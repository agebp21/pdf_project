'use strict';
// Page editor engine (editor.html): turns a PDF page into editable pieces and
// back into a PDF. Plain functions, run by the tests in Node too.
//
// Coordinates: every element sits in fractions of its page (x, y, w, h in
// 0..1 from the top-left); fontSize is a fraction of the page height. Fonts
// are the PDF standard families (sans = Helvetica, serif = Times, mono =
// Courier) so the editor (Arial / Times New Roman / Courier New) and the
// saved PDF measure text alike.
(() => {
  const FAMILIES = {
    sans: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
    serif: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
    mono: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
  };
  const LINE = 1.2;          // line height, in font sizes (editor CSS uses the same)
  // Distance from the top of a text box to its first baseline, in font sizes,
  // for a CSS line-height of lh (half-leading + ascent of the standard fonts).
  const baseline = lh => (lh - 1.12) / 2 + 0.9;

  // Characters PDFs often carry that the standard fonts lack, as their plain equivalents.
  function clean(text) {
    return String(text || '')
      .replace(/[\u2010-\u2012\u2212\u2043\uFE63\uFF0D]/g, '-')
      .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      .replace(/[\u200B-\u200D\u2060\uFEFF\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/\uFB01/g, 'fi').replace(/\uFB02/g, 'fl').replace(/\uFB00/g, 'ff').replace(/\uFB03/g, 'ffi').replace(/\uFB04/g, 'ffl')
      .replace(/[\u2022\u25CF\u25AA\u2023]/g, '•');
  }

  // Font family of a PDF font: sans / serif / mono.
  function family(name) {
    const n = String(name || '').toLowerCase();
    if (/mono|courier|consol|code/.test(n)) return 'mono';
    if (/serif|times|roman|georgia|garamond|book|minion|cambria|palatino|bodoni|caslon/.test(n) && !/sans/.test(n)) return 'serif';
    return 'sans';
  }

  // Text runs -> lines. items: [{str, x, y (top), w, h (font size), bold, italic, family}] in pixels.
  function groupLines(items) {
    const lines = [];
    items = items.map(it => ({ ...it, str: clean(it.str) }));
    const sorted = items.filter(it => it.str && it.str.trim() && it.w > 0 && it.h > 0).sort((a, b) => (a.y + a.h) - (b.y + b.h) || a.x - b.x);
    for (const it of sorted) {
      const base = it.y + it.h;
      // A gap wider than ~1.6 em is a column (a table of contents' page numbers, a
      // price column), not a word gap. `em` is the font's width scale: condensed
      // fonts are narrower than they are tall.
      const line = lines.find(l => Math.abs((l.y + l.h) - base) < Math.max(l.h, it.h) * 0.35 &&
        it.x >= l.x + l.w - Math.max(l.h, it.h) * 0.6 &&
        it.x <= l.x + l.w + Math.min(Math.max(l.h, it.h) * 2.5, Math.min(l.em || l.h, it.em || it.h) * 1.6));
      if (!line) { lines.push({ ...it, text: it.str }); continue; }
      const gap = it.x - (line.x + line.w);
      const space = gap > Math.min(line.h, it.h) * 0.18 && !/\s$/.test(line.text) && !/^\s/.test(it.str) ? ' ' : '';
      line.text += space + it.str;
      const right = Math.max(line.x + line.w, it.x + it.w), top = Math.min(line.y, it.y);
      line.h = Math.max(line.y + line.h, it.y + it.h) - top; line.y = top; line.w = right - line.x;
      line.bold = line.bold && it.bold; line.italic = line.italic && it.italic;
    }
    for (const l of lines) l.text = l.text.replace(/\s+/g, ' ').trim();
    return lines.filter(l => l.text);
  }

  // Lines -> paragraphs: consecutive lines of the same size, close together and
  // starting near the same left edge (a first-line indent is fine) become one
  // block that rewraps when edited — but only for running text: the line before
  // is a sentence-like line (5+ words) running (nearly) the full width of a column
  // that holds more such lines. Labels, addresses, dates, amounts and table rows
  // stay separate lines.
  function paragraphs(lines) {
    const blocks = [];
    const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
    const words = l => l.text.trim().split(/\s+/).length;
    const prose = l => {
      const size = l.size || l.h;
      const col = sorted.filter(o => Math.abs(o.x - l.x) < size * 2.2 && Math.abs((o.size || o.h) - size) <= size * 0.15);
      const widest = Math.max(...col.map(o => o.w));
      return words(l) >= 5 && l.w >= widest * 0.7 && col.filter(o => words(o) >= 5).length >= 2;
    };
    for (const l of sorted) {
      const size = l.size || l.h;
      const b = blocks.find(b => !b.closed && b.lastProse && Math.abs(b.size - size) <= size * 0.15 && b.family === (l.family || 'sans') && !!b.bold === !!l.bold &&
        l.y - (b.y + b.h) < size * 0.9 && l.y - (b.y + b.h) > -size * 0.5 &&
        (Math.abs(l.x - b.x) < size * 2.2 || Math.abs(l.x - b.lastX) < size * 2.2) &&
        Math.min(l.x + l.w, b.x + b.w) - Math.max(l.x, b.x) > Math.min(l.w, b.w) * 0.3);
      if (!b) { blocks.push({ x: l.x, y: l.y, w: l.w, h: l.h, size, text: l.text, lines: 1, lastX: l.x, lastProse: prose(l), family: l.family || 'sans', bold: !!l.bold, italic: !!l.italic, color: l.color }); continue; }
      // Words split over two lines ("se-" + "hari") join again.
      if (/[\p{L}]-$/u.test(b.text) && /^\p{Ll}/u.test(l.text)) b.text = b.text.slice(0, -1) + l.text;
      else b.text += ' ' + l.text;
      const right = Math.max(b.x + b.w, l.x + l.w);
      b.x = Math.min(b.x, l.x); b.w = right - b.x; b.h = l.y + l.h - b.y; b.lines++; b.lastX = l.x; b.lastProse = prose(l);
    }
    // Lines are spaced a little wider than the font: keep the paragraph's own rhythm.
    for (const b of blocks) b.lineHeight = b.lines > 1 ? Math.max(1, Math.min(2.2, b.h / b.lines / b.size)) : LINE;
    return blocks;
  }

  // Greedy word wrap with a width measure (pdf-lib font metrics or canvas).
  function wrap(text, measure, maxWidth) {
    const out = [];
    const cut = word => {                       // a word wider than the box is split
      const parts = [];
      while (word.length > 1 && measure(word) > maxWidth) {
        let n = word.length - 1; while (n > 1 && measure(word.slice(0, n)) > maxWidth) n--;
        parts.push(word.slice(0, n)); word = word.slice(n);
      }
      return [...parts, word];
    };
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const token of para.split(/(\s+)/)) {
        if (!token) continue;
        if (/^\s+$/.test(token)) { if (line) line += token; continue; }
        const pieces = cut(token);
        for (let i = 0; i < pieces.length; i++) {
          const next = line + pieces[i];
          if (!line.trim() || measure(next.trimEnd()) <= maxWidth) line = line.trim() ? next : pieces[i];
          else { out.push(line.trimEnd()); line = pieces[i]; }
          if (i < pieces.length - 1) { out.push(line); line = ''; }
        }
      }
      out.push(line.trimEnd());
    }
    return out;
  }

  function hex(color) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(color || '').trim());
    const v = m ? m[1] : '1c1917';
    return globalThis.PDFLib.rgb(...[0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255));
  }
  const bytesOf = src => {
    if (src instanceof Uint8Array) return src;
    const m = /^data:[^;]+;base64,(.*)$/.exec(String(src || ''));
    if (!m) throw Error('Gambar tidak valid.');
    const bin = typeof atob === 'function' ? atob(m[1]) : Buffer.from(m[1], 'base64').toString('binary');
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  };

  // Rotation about the box centre: pdf-lib rotates about the drawing origin.
  function rotated(x, y, w, h, deg) {
    if (!deg) return { x, y, rotate: undefined };
    const r = -deg * Math.PI / 180, cx = x + w / 2, cy = y + h / 2;
    const ox = cx + (-w / 2) * Math.cos(r) - (-h / 2) * Math.sin(r), oy = cy + (-w / 2) * Math.sin(r) + (-h / 2) * Math.cos(r);
    return { x: ox, y: oy, rotate: globalThis.PDFLib.degrees(-deg) };
  }


  // ---- layers: pictures under the page's design ----------------------------------------------
  // keyPictures: a copy of the PDF where every picture (image XObject, not stencil
  // masks) is one solid colour. Rendering it twice with two key colours tells,
  // pixel by pixel, how much of the design (panels, lines, text) lies over the
  // pictures — see unkey.
  async function keyPictures(input, pngBytes) {
    const lib = globalThis.PDFLib, N = n => lib.PDFName.of(n);
    const doc = await lib.PDFDocument.load(input);
    const key = await doc.embedPng(pngBytes), ctx = doc.context, seen = new Set();
    let replaced = 0;
    const walk = res => {
      if (!(res instanceof lib.PDFDict)) return;
      const xo = res.lookupMaybe(N('XObject'), lib.PDFDict);
      if (!xo) return;
      for (const [name, ref] of xo.entries()) {
        const obj = ctx.lookup(ref);
        if (!obj || !obj.dict) continue;
        const sub = obj.dict.get(N('Subtype'));
        if (sub === N('Image')) {
          const mask = obj.dict.get(N('ImageMask'));
          if (mask && typeof mask.asBoolean === 'function' && mask.asBoolean()) continue;
          xo.set(name, key.ref); replaced++;
        } else if (sub === N('Form') && !seen.has(ref)) { seen.add(ref); walk(obj.dict.lookup(N('Resources'))); }
      }
    };
    for (const page of doc.getPages()) walk(page.node.Resources());
    return { bytes: await doc.save(), replaced };
  }
  const KEY1 = [255, 0, 255], KEY2 = [0, 255, 0];
  // unkey: two renders (pictures as KEY1 / KEY2) -> the design layer, transparent
  // where pictures show through, partly transparent under see-through panels.
  function unkey(a, b) {
    const out = new Uint8ClampedArray(a.length);
    for (let i = 0; i < a.length; i += 4) {
      const t = Math.max(0, Math.min(1, ((a[i] - b[i]) + (b[i + 1] - a[i + 1]) + (a[i + 2] - b[i + 2])) / 765));
      if (a[i + 3] < 250 || b[i + 3] < 250) {                       // not over a picture: keep as it is (fringes go)
        if (t < 0.1) { out[i] = a[i]; out[i + 1] = a[i + 1]; out[i + 2] = a[i + 2]; out[i + 3] = a[i + 3]; }
        continue;
      }
      const alpha = 1 - t;
      if (alpha < 0.03) continue;
      for (let c = 0; c < 3; c++) out[i + c] = (a[i + c] - t * KEY1[c]) / alpha;
      out[i + 3] = alpha * 255;
    }
    return out;
  }
  // repair: fill boxes (text, cut areas) from their surroundings, transparency included.
  function repair(data, w, h, boxes) {
    const src = new Uint8ClampedArray(data), mask = new Uint8Array(w * h), span = new Uint32Array(w * h);
    for (const b of boxes) {
      const pad = b.padding ?? Math.max(2, Math.ceil((b.y1 - b.y0) * 0.15));
      const x0 = Math.max(0, Math.floor(b.x0) - pad), y0 = Math.max(0, Math.floor(b.y0) - pad);
      const x1 = Math.min(w - 1, Math.ceil(b.x1) + pad), y1 = Math.min(h - 1, Math.ceil(b.y1) + pad);
      for (let y = y0; y <= y1; y++) mask.fill(1, y * w + x0, y * w + x1 + 1);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w;) {
      if (!mask[y * w + x]) { x++; continue; }
      const start = x; while (x < w && mask[y * w + x]) x++;
      const L0 = Math.max(0, start - 1), R0 = Math.min(w - 1, x);
      for (let col = start; col < x; col++) {
        const i = y * w + col, t = (col - L0) / Math.max(1, R0 - L0); span[i] = x - start;
        for (let c = 0; c < 4; c++) data[i * 4 + c] = src[(y * w + L0) * 4 + c] * (1 - t) + src[(y * w + R0) * 4 + c] * t;
      }
    }
    for (let x = 0; x < w; x++) for (let y = 0; y < h;) {
      if (!mask[y * w + x]) { y++; continue; }
      const start = y; while (y < h && mask[y * w + x]) y++;
      const T0 = Math.max(0, start - 1), B0 = Math.min(h - 1, y);
      for (let row = start; row < y; row++) {
        const i = row * w + x, t = (row - T0) / Math.max(1, B0 - T0), wgt = span[i] / (span[i] + y - start);
        for (let c = 0; c < 4; c++) data[i * 4 + c] = data[i * 4 + c] * (1 - wgt) + (src[(T0 * w + x) * 4 + c] * (1 - t) + src[(B0 * w + x) * 4 + c] * t) * wgt;
      }
    }
    return data;
  }
  // Text colour of each box: the pixel inside that differs most from the box's rim.
  function textColors(data, w, h, boxes) {
    return boxes.map(b => {
      const x0 = Math.max(0, Math.floor(b.x0) - 2), y0 = Math.max(0, Math.floor(b.y0) - 2), x1 = Math.min(w - 1, Math.ceil(b.x1) + 2), y1 = Math.min(h - 1, Math.ceil(b.y1) + 2);
      const rim = [0, 0, 0]; let n = 0;
      const add = i => { rim[0] += data[i]; rim[1] += data[i + 1]; rim[2] += data[i + 2]; n++; };
      for (let x = x0; x <= x1; x++) { add((y0 * w + x) * 4); add((y1 * w + x) * 4); }
      for (let y = y0; y <= y1; y++) { add((y * w + x0) * 4); add((y * w + x1) * 4); }
      const bg = rim.map(v => v / Math.max(1, n));
      let best = -1, color = [28, 25, 23];
      for (let y = y0 + 2; y < y1 - 1; y++) for (let x = x0 + 2; x < x1 - 1; x++) {
        const i = (y * w + x) * 4, d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
        if (d > best) { best = d; color = [data[i], data[i + 1], data[i + 2]]; }
      }
      return '#' + color.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    });
  }

  // Build the edited PDF. edits: {pageIndex: {size: [W, H] points, background: JPEG bytes,
  // elements: [...]}}; pages without edits are copied untouched (still vector).
  async function exportPdf(input, edits, opts = {}) {
    const lib = globalThis.PDFLib;
    const src = await lib.PDFDocument.load(input, { ignoreEncryption: false });
    const out = await lib.PDFDocument.create();
    const fonts = {};
    const font = async (fam, bold, italic) => {
      const name = (FAMILIES[fam] || FAMILIES.sans)[(bold ? 1 : 0) + (italic ? 2 : 0)];
      return fonts[name] ||= await out.embedFont(lib.StandardFonts[name]);
    };
    const missing = new Set();
    const order = opts.order || src.getPageIndices();
    for (const index of order) {
      const edit = edits[index];
      if (!edit) { const [copy] = await out.copyPages(src, [index]); out.addPage(copy); continue; }
      const [W, H] = edit.size;
      const page = out.addPage([W, H]);
      // Pictures that sit under the page's design go first, then the design layer, then the rest.
      const all = edit.elements || [], under = all.filter(e => e.under), over = all.filter(e => !e.under);
      const drawBackground = async () => {
        if (!edit.background) return;
        const bg = bytesOf(edit.background);
        page.drawImage(bg[0] === 0x89 ? await out.embedPng(bg) : await out.embedJpg(bg), { x: 0, y: 0, width: W, height: H });
      };
      if (!under.length) await drawBackground();
      for (const [n, el] of [...under, null, ...over].entries()) {
        if (el === null) { if (under.length) await drawBackground(); continue; }
        const x = el.x * W, w = el.w * W, h = el.h * H, y = H - el.y * H - h;
        if (el.type === 'image') {
          const b = bytesOf(el.src);
          const img = b[0] === 0x89 ? await out.embedPng(b) : await out.embedJpg(b);
          page.drawImage(img, { width: w, height: h, opacity: el.opacity ?? 1, ...rotated(x, y, w, h, el.rotation) });
        } else if (el.type === 'rect' || el.type === 'ellipse') {
          const style = { opacity: el.fill ? 1 : 0, borderOpacity: 1 };
          if (el.fill) style.color = hex(el.fill);
          if (el.stroke && el.strokeWidth) { style.borderColor = hex(el.stroke); style.borderWidth = el.strokeWidth * H; }
          if (el.type === 'rect') page.drawRectangle({ width: w, height: h, ...style, ...rotated(x, y, w, h, el.rotation) });
          else page.drawEllipse({ x: x + w / 2, y: y + h / 2, xScale: w / 2, yScale: h / 2, ...style });
        } else if (el.type === 'line') {
          page.drawLine({ start: { x, y: y + h }, end: { x: x + w, y }, thickness: (el.strokeWidth || 0.003) * H, color: hex(el.stroke) });
        } else if (el.type === 'text') {
          const f = await font(el.family, el.bold, el.italic), size = el.fontSize * H;
          // Characters outside the standard fonts become "?" (reported to the user).
          const text = Array.from(clean(el.text)).map(ch => {
            if (ch === '\n') return ch;
            try { f.widthOfTextAtSize(ch, size); return ch; } catch (e) { missing.add(ch); return '?'; }
          }).join('');
          const lh = size * (el.lineHeight || LINE);
          const lines = wrap(text, s => f.widthOfTextAtSize(s, size), Math.max(w, size));
          let base = H - el.y * H - size * baseline(el.lineHeight || LINE);
          for (const line of lines) {
            const lw = f.widthOfTextAtSize(line, size);
            const dx = el.align === 'center' ? (w - lw) / 2 : el.align === 'right' ? w - lw : 0;
            if (line) page.drawText(line, { x: x + dx, y: base, size, font: f, color: hex(el.color) });
            base -= lh;
          }
        }
      }
    }
    const bytes = await out.save();
    return opts.report ? { bytes, missing: [...missing] } : bytes;
  }

  globalThis.PageEditorCore = { FAMILIES, LINE, baseline, clean, family, groupLines, paragraphs, wrap, exportPdf,
    KEY1, KEY2, keyPictures, unkey, repair, textColors };
})();
