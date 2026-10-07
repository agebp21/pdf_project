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
      const line = lines.find(l => Math.abs((l.y + l.h) - base) < Math.max(l.h, it.h) * 0.35 &&
        it.x >= l.x + l.w - Math.max(l.h, it.h) * 0.6 && it.x <= l.x + l.w + Math.max(l.h, it.h) * 2.5);
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
      if (edit.background) page.drawImage(await out.embedJpg(bytesOf(edit.background)), { x: 0, y: 0, width: W, height: H });
      for (const el of edit.elements || []) {
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

  globalThis.PageEditorCore = { FAMILIES, LINE, baseline, clean, family, groupLines, paragraphs, wrap, exportPdf };
})();
