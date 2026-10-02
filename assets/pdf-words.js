/* Word positions for reader highlights ("stabilo"), read from the PDF text
 * when it is opened. Pages are shown as pictures, so this lets a highlight
 * snap to the words under the reader's finger.
 *
 * Output: { "<pageIndex>": [[y, h, x0, w0, x1, w1, ...], ...] } — one array
 * per text line, top to bottom, words left to right, all integers in
 * 1/10000 of the book page box (letterboxing already applied). Pages
 * without text (scans) are left out; highlights there are free boxes.
 *
 * With {withText: true} it returns {words, text}: text has the same pages
 * and lines, each line a string of its words joined by single spaces (so
 * word i of the line is line.split(' ')[i]) — highlighted text becomes a
 * note in the reader.
 */
(function (root) {
  'use strict';
  const UNIT = 10000, MAX_LINES = 400, MAX_WORDS = 300, MAX_LINE_TEXT = 4000;

  async function pageLines(page, bookRatio) {
    const viewport = page.getViewport({ scale: 1 }), none = { lines: [], text: [] };
    let content;
    try { content = await page.getTextContent(); } catch (e) { return none; }
    const Util = root.pdfjsLib && root.pdfjsLib.Util;
    if (!Util) return none;
    const unit = Math.hypot(viewport.transform[0], viewport.transform[1]) || 1;
    // Letter-spaced titles ("T H E  R O U T L E D G E"): the words come back
    // from where the letters are painted (assets/pdf-layout.js), so they are
    // read aloud and noted as words, not spelt out.
    let spaced = {};
    const Layout = root.PdfLayout;
    if (Layout && Layout.looksSpaced && content.items.some(item => Layout.looksSpaced(item.str))) {
      try { spaced = (await Layout.layoutPage(page, { maxPx: 900 })).spaced || {}; } catch (e) {}
    }
    const boxes = [];
    for (let index = 0; index < content.items.length; index++) {
      const item = content.items[index];
      if (!item.str || !item.str.trim() || !(item.width > 0)) continue;
      const tx = Util.transform(viewport.transform, item.transform);
      if (Math.abs(tx[1]) > Math.abs(tx[0]) * 0.1) continue;   // rotated text: not supported
      const size = Math.hypot(tx[2], tx[3]);
      if (!(size > 0)) continue;
      const width = item.width * unit, left = tx[4], top = tx[5] - size * 0.82, height = size * 1.05;
      // Split the run into words, sharing its width by character count.
      const text = spaced[index] || item.str, n = text.length, words = /\S+/g;
      let m;
      while ((m = words.exec(text))) {
        const x = left + width * m.index / n, w = width * m[0].length / n;
        const box = root.PdfLinks.toBox([x, top, x + w, top + height], viewport, bookRatio);
        if (box.w > 0 && box.h > 0) { box.t = m[0]; boxes.push(box); }
      }
    }
    // Group into lines: boxes whose vertical centres are within half a line.
    boxes.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const lines = [];
    for (const box of boxes) {
      const mid = box.y + box.h / 2;
      let line = null;
      for (let i = lines.length - 1; i >= 0 && i >= lines.length - 4; i--) {
        const l = lines[i];
        if (Math.abs(l.y + l.h / 2 - mid) < Math.min(l.h, box.h) * 0.5) { line = l; break; }
      }
      if (!line) { line = { y: box.y, h: box.h, words: [] }; lines.push(line); }
      else { const bottom = Math.max(line.y + line.h, box.y + box.h); line.y = Math.min(line.y, box.y); line.h = bottom - line.y; }
      line.words.push(box);
    }
    const kept = lines.slice(0, MAX_LINES);
    kept.forEach(line => { line.words.sort((a, b) => a.x - b.x); line.words = line.words.slice(0, MAX_WORDS); });
    return {
      lines: kept.map(line => {
        const out = [Math.round(line.y * UNIT), Math.max(1, Math.round(line.h * UNIT))];
        line.words.forEach(w => out.push(Math.round(w.x * UNIT), Math.max(1, Math.round(w.w * UNIT))));
        return out;
      }),
      text: kept.map(line => line.words.map(w => w.t).join(' ').slice(0, MAX_LINE_TEXT))
    };
  }

  async function extract(pdf, options) {
    const opts = options || {};
    const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
    const bookRatio = first.width / first.height, out = {}, text = {};
    for (let i = 1; i <= pdf.numPages; i++) {
      if (opts.progress) opts.progress(i, pdf.numPages);
      const page = await pdf.getPage(i);
      const found = await pageLines(page, bookRatio);
      if (found.lines.length) { out[String(i - 1)] = found.lines; text[String(i - 1)] = found.text; }
      page.cleanup();
    }
    return opts.withText ? { words: out, text } : out;
  }

  root.PdfWords = { extract, UNIT };
})(typeof window !== 'undefined' ? window : globalThis);
