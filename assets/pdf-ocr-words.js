/* Text in pictures (OCR): pages that are only a picture (scanned books,
 * magazine spreads) get words with positions in the PdfWords format, so the
 * highlighter, notes, search and the audio book work there too. The page
 * pictures are never changed; this only reads them.
 *
 * Tesseract.js v5.1.1 (Apache-2.0, https://github.com/naptha/tesseract.js),
 * pinned on jsDelivr and loaded only when a book has picture pages.
 *
 *   PdfOcrWords.needs(words, index) → true when the page has (almost) no text
 *   PdfOcrWords.start(langs) → worker;  worker.page(pdfPage, bookRatio) →
 *     {lines: [[y, h, x0, w0, ...]], text: [line strings]} or null;  worker.stop()
 */
(function (root) {
  'use strict';
  const UNIT = 10000, MIN_WORDS = 8;
  let loading = null;
  function load() {
    if (root.Tesseract) return Promise.resolve();
    if (!loading) loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = resolve;
      s.onerror = () => { loading = null; reject(new Error('Could not load the OCR engine (internet needed the first time).')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  function needs(words, index) {
    const lines = (words || {})[String(index)] || [];
    let count = 0;
    lines.forEach(line => { count += Math.max(0, (line.length - 2) / 2); });
    return count < MIN_WORDS;
  }
  // Tesseract's lines (reading order: blocks, then lines) → PdfWords lines.
  // Display type and artwork make OCR invent symbols: weak words and lines
  // are dropped, and a page with too little left gives nothing.
  function toLines(data, scale, viewport, bookRatio) {
    const lines = [], text = [];
    let total = 0;
    (data.lines || []).forEach(line => {
      // Lone letters/digits are mostly specks read as text ("il 1 4 4"): kept only when sure.
      const words = (line.words || []).filter(w => w.text && w.text.trim() && w.confidence >= 55 && /[A-Za-z0-9\u00c0-\u024f]/.test(w.text) &&
        (w.text.trim().length > 1 || /^[aAI&$%]$/.test(w.text.trim()) || w.confidence >= 88));
      if (!words.length) return;
      const mean = words.reduce((sum, w) => sum + w.confidence, 0) / words.length;
      const said = words.map(w => w.text.trim()).join(' ');
      if (mean < 62 || (said.match(/[A-Za-z0-9\u00c0-\u024f]/g) || []).length < 2) return;
      const boxes = words.map(w => root.PdfLinks.toBox([w.bbox.x0 / scale, w.bbox.y0 / scale, w.bbox.x1 / scale, w.bbox.y1 / scale], viewport, bookRatio));
      const top = Math.min.apply(null, boxes.map(b => b.y)), bottom = Math.max.apply(null, boxes.map(b => b.y + b.h));
      const out = [Math.round(top * UNIT), Math.max(1, Math.round((bottom - top) * UNIT))];
      boxes.forEach(b => out.push(Math.round(b.x * UNIT), Math.max(1, Math.round(b.w * UNIT))));
      lines.push(out); text.push(said); total += words.length;
    });
    return total >= 3 ? { lines, text } : null;
  }
  async function start(langs) {
    await load();
    const worker = await root.Tesseract.createWorker(langs || 'eng+ind', 1);
    return {
      async page(pdfPage, bookRatio) {
        const viewport = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(3, 2200 / Math.max(viewport.width, viewport.height));
        const view = pdfPage.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
        await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: view }).promise;
        try {
          const result = await worker.recognize(canvas);
          return toLines(result.data || {}, scale, viewport, bookRatio);
        } finally { canvas.width = canvas.height = 0; }
      },
      stop() { try { worker.terminate(); } catch (e) {} }
    };
  }
  root.PdfOcrWords = { needs, start, toLines, MIN_WORDS };
})(typeof self !== 'undefined' ? self : globalThis);
