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
      // Each line remembers its parts (font, weight, place): words styled apart keep their look.
      const part = s => ({ text: s, font: it.font, bold: !!it.bold, italic: !!it.italic, x: it.x, y: it.y, w: it.w, h: it.h });
      if (!line) { lines.push({ ...it, text: it.str, parts: [part(it.str)] }); continue; }
      const gap = it.x - (line.x + line.w);
      const space = gap > Math.min(line.h, it.h) * 0.18 && !/\s$/.test(line.text) && !/^\s/.test(it.str) ? ' ' : '';
      line.text += space + it.str; line.parts.push(part(space + it.str));
      const right = Math.max(line.x + line.w, it.x + it.w), top = Math.min(line.y, it.y);
      line.h = Math.max(line.y + line.h, it.y + it.h) - top; line.y = top; line.w = right - line.x;
      line.bold = line.bold && it.bold; line.italic = line.italic && it.italic;
    }
    for (const l of lines) {
      l.text = l.text.replace(/\s+/g, ' ').trim();
      const ps = l.parts || []; ps.forEach(p => { p.text = p.text.replace(/\s+/g, ' '); });
      if (ps.length) { ps[0].text = ps[0].text.replace(/^\s+/, ''); ps[ps.length - 1].text = ps[ps.length - 1].text.replace(/\s+$/, ''); }
    }
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
    // A line with a short neighbour on its baseline (a page number, an amount) is a
    // table row: it never becomes part of a paragraph.
    const row = l => sorted.some(o => o !== l && words(o) <= 2 && Math.abs((o.y + o.h) - (l.y + l.h)) < (l.size || l.h) * 0.35 &&
      (o.x >= l.x + l.w - 1 || o.x + o.w <= l.x + 1));
    const prose = l => {
      if (row(l)) return false;
      const size = l.size || l.h;
      const col = sorted.filter(o => Math.abs(o.x - l.x) < size * 2.2 && Math.abs((o.size || o.h) - size) <= size * 0.15);
      const widest = Math.max(...col.map(o => o.w));
      return words(l) >= 5 && l.w >= widest * 0.7 && col.filter(o => words(o) >= 5).length >= 2;
    };
    for (const l of sorted) {
      const size = l.size || l.h;
      const b = !row(l) && blocks.find(b => !b.closed && b.lastProse && Math.abs(b.size - size) <= size * 0.15 && b.family === (l.family || 'sans') && !!b.bold === !!l.bold && b.font === l.font &&
        l.y - (b.y + b.h) < size * 0.9 && l.y - (b.y + b.h) > -size * 0.5 &&
        (Math.abs(l.x - b.x) < size * 2.2 || Math.abs(l.x - b.lastX) < size * 2.2) &&
        Math.min(l.x + l.w, b.x + b.w) - Math.max(l.x, b.x) > Math.min(l.w, b.w) * 0.3);
      if (!b) { blocks.push({ x: l.x, y: l.y, w: l.w, h: l.h, size, text: l.text, lines: 1, lastX: l.x, lastProse: prose(l), family: l.family || 'sans', bold: !!l.bold, italic: !!l.italic, color: l.color, font: l.font, html: l.html }); continue; }
      // Words split over two lines ("se-" + "hari") join again.
      const joined = /[\p{L}]-$/u.test(b.text) && /^\p{Ll}/u.test(l.text);
      if (b.html || l.html) {                                             // styled words go along
        const bh = b.html ?? escapeHtml(b.text), lh = l.html ?? escapeHtml(l.text);
        b.html = joined ? bh.replace(/-((?:<\/span>)?)$/, '$1') + lh : bh + ' ' + lh;
      }
      if (joined) b.text = b.text.slice(0, -1) + l.text;
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


  // ---- rich text: words styled on their own (bold, italic, underline, colour, size, font) --------
  // A text block may carry html (from the editor) next to its plain text. Only a small
  // set of inline styles is read; everything else is dropped. Sizes are "em" of the
  // block's own font size, fonts a CSS font-family (a FontFace key or a standard family).
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
  const decode = t => t.replace(/&(#x?[0-9a-f]+|[a-z]+|#39);/gi, (m, e) => ENT[e.toLowerCase()] ?? (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : m));
  const escapeHtml = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function cssColor(v) {
    v = String(v || '').trim();
    let m = /^#([0-9a-f]{3})$/i.exec(v); if (m) return '#' + m[1].split('').map(c => c + c).join('').toLowerCase();
    m = /^#([0-9a-f]{6})$/i.exec(v); if (m) return '#' + m[1].toLowerCase();
    m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(v); if (m) return '#' + [m[1], m[2], m[3]].map(n => Math.min(255, +n).toString(16).padStart(2, '0')).join('');
    return null;
  }
  function styleOf(tag, attrs) {
    const st = {};
    if (tag === 'b' || tag === 'strong') st.b = true;
    if (tag === 'i' || tag === 'em') st.i = true;
    if (tag === 'u') st.u = true;
    // Entities first: a quoted font name (&quot;) holds a ";" that is not a separator.
    const css = decode((/style\s*=\s*"([^"]*)"/i.exec(attrs) || /style\s*=\s*'([^']*)'/i.exec(attrs) || [])[1] || '');
    for (const decl of css.split(';')) {
      const k = decl.slice(0, decl.indexOf(':')).trim().toLowerCase(), v = decl.slice(decl.indexOf(':') + 1).trim();
      if (!k || decl.indexOf(':') < 0) continue;
      if (k === 'font-weight') st.b = /bold|[6-9]00/.test(v);
      else if (k === 'font-style') st.i = /italic|oblique/.test(v);
      else if (k === 'text-decoration' || k === 'text-decoration-line') st.u = /underline/.test(v);
      else if (k === 'color') { const c = cssColor(v); if (c) st.color = c; }
      else if (k === 'font-size') { const m = /^([\d.]+)em$/.exec(v); if (m) st.scale = +m[1]; }
      else if (k === 'font-family') st.face = v;
    }
    if (tag === 'font') {
      const c = /color\s*=\s*"?([^"\s>]+)/i.exec(attrs); if (c && cssColor(c[1])) st.color = cssColor(c[1]);
      const f = /face\s*=\s*"([^"]*)"/i.exec(attrs); if (f) st.face = f[1];
    }
    return st;
  }
  // html -> paragraphs of runs: [[{text, b, i, u, color, scale, face}, ...], ...]
  function parseRich(html) {
    const paras = [[]], stack = [];
    const cur = () => Object.assign({}, ...stack.map(x => x.st));
    const push = text => {
      if (!text) return;
      const s = cur(), para = paras[paras.length - 1], last = para[para.length - 1];
      const same = last && ['b', 'i', 'u', 'color', 'scale', 'face'].every(k => last[k] === s[k]);
      if (same) last.text += text; else para.push({ text, ...s });
    };
    const re = /<(\/?)([a-z][a-z0-9]*)([^>]*)>|([^<]+)/gi;
    let m;
    while ((m = re.exec(String(html || '')))) {
      if (m[4] !== undefined) { push(decode(m[4]).replace(/\r?\n/g, ' ')); continue; }
      const close = !!m[1], tag = m[2].toLowerCase(), attrs = m[3] || '';
      if (tag === 'br') { paras.push([]); continue; }
      if (tag === 'div' || tag === 'p') {                                  // a block starts or ends a paragraph
        if (paras[paras.length - 1].length) paras.push([]);
        continue;
      }
      if (close) { const k = stack.map(x => x.tag).lastIndexOf(tag); if (k >= 0) stack.splice(k); continue; }
      if (/\/\s*$/.test(attrs)) continue;
      stack.push({ tag, st: styleOf(tag, attrs) });
    }
    if (paras.length > 1 && !paras[paras.length - 1].length && /<\/(div|p)>\s*$/i.test(String(html))) paras.pop();
    return paras;
  }
  const isRich = html => /<(b|strong|i|em|u|span|font)\b/i.test(String(html || ''));
  const plainRich = html => parseRich(html).map(p => p.map(r => r.text).join('')).join('\n');
  // Runs back to tidy html (one span per styled run, <br> between paragraphs).
  function richHtml(paras) {
    return paras.map(p => p.map(r => {
      const css = [];
      if (r.b !== undefined) css.push('font-weight:' + (r.b ? 'bold' : 'normal'));
      if (r.i !== undefined) css.push('font-style:' + (r.i ? 'italic' : 'normal'));
      if (r.u !== undefined) css.push('text-decoration:' + (r.u ? 'underline' : 'none'));
      if (r.color) css.push('color:' + r.color);
      if (r.scale) css.push('font-size:' + r.scale + 'em');
      if (r.face) css.push('font-family:' + r.face.replace(/"/g, '&quot;'));
      const t = escapeHtml(r.text);
      return css.length ? `<span style="${css.join(';')}">${t}</span>` : t;
    }).join('')).join('<br>');
  }
  const tidyRich = html => richHtml(parseRich(html));
  // A block's words as paragraphs of runs, whether it is plain text or html.
  const richOf = (text, html) => html ? parseRich(html) : String(text || '').split('\n').map(t => t ? [{ text: t }] : []);
  const plainOf = paras => paras.map(p => p.map(r => r.text).join('')).join('\n');
  // Cut paragraphs at character k of their plain text ("\n" between paragraphs counts 1).
  function splitParas(paras, k) {
    const a = [], b = [];
    let left = k;
    for (const para of paras) {
      if (left === null) { b.push(para.map(r => ({ ...r }))); continue; }
      const len = para.reduce((n, r) => n + r.text.length, 0);
      if (left > len) { a.push(para.map(r => ({ ...r }))); left -= len + 1; continue; }
      const pa = [], pb = [];
      let l = left;
      for (const r of para) {
        if (l === null) { pb.push({ ...r }); continue; }
        if (l >= r.text.length && l > 0) { pa.push({ ...r }); l -= r.text.length; continue; }
        if (l > 0) pa.push({ ...r, text: r.text.slice(0, l) });
        pb.push({ ...r, text: r.text.slice(l) }); l = null;
      }
      a.push(pa); b.push(pb); left = null;
    }
    if (!b.length) b.push([]);
    return [a, b];
  }
  // Two blocks' paragraphs end to end: the last paragraph of a goes on with the first of b.
  function joinParas(a, b) {
    if (!a.length) return b.map(p => p.slice());
    if (!b.length) return a.map(p => p.slice());
    return [...a.slice(0, -1), [...a[a.length - 1], ...b[0]], ...b.slice(1)];
  }
  // Paragraphs back into a block: plain text when no word carries a style.
  const sameStyle = (x, y) => ['b', 'i', 'u', 'color', 'scale', 'face'].every(k => x[k] === y[k]);
  function blockOf(paras) {
    paras = paras.map(p => p.reduce((out, r) => { const last = out[out.length - 1]; if (last && sameStyle(last, r)) last.text += r.text; else if (r.text) out.push({ ...r }); return out; }, []));
    const html = richHtml(paras), text = plainOf(paras);
    return isRich(html) ? { text, html } : { text };
  }
  // Where a block may be cut for the next page: after a space or a line break.
  function breakPoints(text) {
    const out = [];
    for (let i = 0; i < text.length; i++) if (text[i] === ' ' || text[i] === '\n') out.push(i + 1);
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

  // clearPaper: a cut-out (a logo on the page) loses its paper. When the rim of the
  // box is one plain colour, that colour turns transparent (soft at the edges, the
  // paper taken out of the edge pixels). Returns false when the rim is not plain.
  function clearPaper(data, w, h) {
    const rim = [];
    for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) if (y >= 0 && y < h) rim.push((y * w + x) * 4);
    for (let y = 2; y < h - 2; y++) for (const x of [0, 1, w - 2, w - 1]) if (x >= 0 && x < w) rim.push((y * w + x) * 4);
    if (!rim.length) return false;
    const m = [0, 1, 2].map(c => rim.reduce((a, i) => a + data[i + c], 0) / rim.length);
    const spread = rim.reduce((a, i) => a + Math.max(...[0, 1, 2].map(c => Math.abs(data[i + c] - m[c]))), 0) / rim.length;
    if (spread > 18) return false;
    for (let i = 0; i < w * h * 4; i += 4) {
      const d = Math.max(Math.abs(data[i] - m[0]), Math.abs(data[i + 1] - m[1]), Math.abs(data[i + 2] - m[2]));
      const a = d <= 10 ? 0 : d >= 60 ? 1 : (d - 10) / 50;
      if (a > 0 && a < 1) for (let c = 0; c < 3; c++) data[i + c] = (data[i + c] - (1 - a) * m[c]) / a;
      data[i + 3] = Math.min(data[i + 3], Math.round(a * 255));
    }
    return true;
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
    // The PDF's own fonts (opts.fonts: {key: font file}, embedded with fontkit) when
    // they hold every character of the text; otherwise the standard font.
    const parsed = {}, custom = {};
    let fontkitOn = false;
    const ownFont = async (key, text) => {
      const data = key && opts.fonts && opts.fonts[key], fk = globalThis.fontkit;
      if (!data || !fk) return null;
      // Check the characters first: a font that cannot write the text is not embedded at all.
      if (!(key in parsed)) { try { parsed[key] = fk.create(data); } catch (e) { parsed[key] = null; } }
      // (pdf.js often leaves the space out of the font: words are then placed one by one.)
      const glyphs = parsed[key];
      if (!glyphs || !Array.from(text).every(ch => ch === '\n' || ch === ' ' || glyphs.hasGlyphForCodePoint(ch.codePointAt(0)))) return null;
      if (!(key in custom)) {
        try {
          if (!fontkitOn) { out.registerFontkit(fk); fontkitOn = true; }
          custom[key] = await out.embedFont(data, { subset: false });
        } catch (e) { custom[key] = null; }
      }
      return custom[key] && { font: custom[key], space: glyphs.hasGlyphForCodePoint(32) };
    };
    const missing = new Set();

    // A block whose words carry their own styles: laid out word by word (sizes, fonts and
    // colours mixed in a line), wrapped to the box, aligned like the editor shows it.
    async function drawRich(page, el, x, w, H) {
      const base = el.fontSize * H, lh = el.lineHeight || LINE, paras = parseRich(el.html);
      const keys = Object.keys(opts.fonts || {});
      const tokens = [];
      for (const [pi, para] of paras.entries()) {
        for (const run of para) {
          const size = base * (run.scale || 1), b = run.b ?? !!el.bold, it = run.i ?? !!el.italic, u = run.u ?? !!el.underline;
          const key = run.face ? keys.find(k => run.face.includes(k)) : el.font;
          let text = clean(run.text), own = key ? await ownFont(key, text) : null;
          const f = own ? own.font : await font(run.face ? family(run.face) : el.family, b, it);
          if (!own) text = Array.from(text).map(ch => { try { f.widthOfTextAtSize(ch, size); return ch; } catch (e) { missing.add(ch); return '?'; } }).join('');
          const gap = own && !own.space ? size * 0.25 : f.widthOfTextAtSize(' ', size);
          for (const piece of text.split(/( +)/)) {
            if (!piece) continue;
            const space = piece[0] === ' ';
            tokens.push({ para: pi, text: piece, space, f, size, u, color: run.color || el.color, w: space ? gap * piece.length : f.widthOfTextAtSize(piece, size) });
          }
        }
        tokens.push({ para: pi, end: true, size: base });                 // paragraph end (keeps empty lines)
      }
      // Lines: greedy wrap; a word wider than the box stays alone on its line.
      const lines = []; let line = { toks: [], w: 0, size: 0 };
      const finish = last => { while (line.toks.length && line.toks[line.toks.length - 1].space) line.w -= line.toks.pop().w; line.last = last; lines.push(line); line = { toks: [], w: 0, size: 0 }; };
      for (const t of tokens) {
        if (t.end) { line.size = line.size || t.size; finish(true); continue; }
        if (!el.fit && !t.space && line.toks.some(k => !k.space) && line.w + t.w > w) finish(false);
        if (t.space && !line.toks.length) continue;
        line.toks.push(t); line.w += t.w; line.size = Math.max(line.size, t.size);
      }
      let top = H - el.y * H;
      for (const ln of lines) {
        const size = ln.size || base, baseY = top - size * baseline(lh);
        const spaces = ln.toks.filter(t => t.space);
        const spread = el.align === 'justify' && !ln.last && spaces.length ? (w - ln.w) / spaces.length : 0;
        let cx = x + (el.align === 'center' ? (w - ln.w) / 2 : el.align === 'right' ? w - ln.w : 0);
        for (const [k, t] of ln.toks.entries()) {
          const tw = t.w + (t.space ? spread : 0);
          if (!t.space) page.drawText(t.text, { x: cx, y: baseY, size: t.size, font: t.f, color: hex(t.color) });
          const next = ln.toks[k + 1];
          if (t.u && (!t.space || (next && next.u))) page.drawLine({ start: { x: cx, y: baseY - t.size * 0.13 }, end: { x: cx + tw, y: baseY - t.size * 0.13 }, thickness: Math.max(0.5, t.size * 0.06), color: hex(t.color) });
          cx += tw;
        }
        top -= size * lh;
      }
    }
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
        } else if (el.type === 'triangle') {
          // SVG paths start at the box's top-left corner, y pointing down.
          const style = { x, y: y + h, borderWidth: (el.strokeWidth || 0) * H };
          if (el.fill) style.color = hex(el.fill); else style.opacity = 0;
          if (el.stroke && el.strokeWidth) style.borderColor = hex(el.stroke);
          page.drawSvgPath(`M ${w / 2} 0 L ${w} ${h} L 0 ${h} Z`, style);
        } else if (el.type === 'arrow') {
          const head = Math.min(h, w * 0.3), t = (el.strokeWidth || 0.003) * H;
          page.drawLine({ start: { x, y: y + h / 2 }, end: { x: x + w - head * 0.9, y: y + h / 2 }, thickness: t, color: hex(el.stroke) });
          page.drawSvgPath(`M ${w - head} 0 L ${w} ${h / 2} L ${w - head} ${h} Z`, { x, y: y + h, color: hex(el.stroke) });
        } else if (el.type === 'text' && el.html && isRich(el.html)) {
          await drawRich(page, el, x, w, H);
        } else if (el.type === 'text') {
          const size = el.fontSize * H;
          const own = el.font ? await ownFont(el.font, clean(el.text)) : null;
          const f = own ? own.font : await font(el.family, el.bold, el.italic);
          // Characters outside the standard fonts become "?" (reported to the user).
          const text = own ? clean(el.text) : Array.from(clean(el.text)).map(ch => {
            if (ch === '\n') return ch;
            try { f.widthOfTextAtSize(ch, size); return ch; } catch (e) { missing.add(ch); return '?'; }
          }).join('');
          const gap = own && !own.space ? size * 0.25 : 0;            // a font without a space glyph
          const width = s => gap ? s.split(' ').reduce((a, word, i) => a + (i ? gap : 0) + f.widthOfTextAtSize(word, size), 0) : f.widthOfTextAtSize(s, size);
          const lh = size * (el.lineHeight || LINE);
          // Each paragraph wraps on its own: in justified text its last line stays left.
          const lines = String(text).split('\n').flatMap(para => {
            const ls = el.fit ? [para] : wrap(para, width, Math.max(w, size));     // a one-line piece only breaks at Enter
            return ls.map((line, i) => ({ line, last: i === ls.length - 1 }));
          });
          let base = H - el.y * H - size * baseline(el.lineHeight || LINE);
          for (const { line, last } of lines) {
            const lw = width(line), words = line.split(/ +/).filter(Boolean);
            let cx = x + (el.align === 'center' ? (w - lw) / 2 : el.align === 'right' ? w - lw : 0);
            // Justify: the words spread to both edges, the space between them grows.
            const spread = el.align === 'justify' && !last && words.length > 1
              ? (w - words.reduce((a, word) => a + f.widthOfTextAtSize(word, size), 0)) / (words.length - 1) : 0;
            const x0 = cx;
            if (!gap && !spread) { if (line) page.drawText(line, { x: cx, y: base, size, font: f, color: hex(el.color) }); }
            else for (const word of words) {
              page.drawText(word, { x: cx, y: base, size, font: f, color: hex(el.color) });
              cx += f.widthOfTextAtSize(word, size) + (spread || gap);
            }
            if (el.underline && line.trim()) {
              const uy = base - size * 0.13;
              page.drawLine({ start: { x: x0, y: uy }, end: { x: x0 + (spread ? w : lw), y: uy }, thickness: Math.max(0.5, size * 0.06), color: hex(el.color) });
            }
            base -= lh;
          }
        }
      }
    }
    const bytes = await out.save();
    return opts.report ? { bytes, missing: [...missing] } : bytes;
  }

  globalThis.PageEditorCore = { FAMILIES, LINE, baseline, clean, family, groupLines, paragraphs, wrap, exportPdf,
    KEY1, KEY2, keyPictures, unkey, repair, textColors, clearPaper, parseRich, isRich, plainRich, richHtml, tidyRich,
    richOf, plainOf, splitParas, joinParas, blockOf, breakPoints };
})();
