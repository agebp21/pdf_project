'use strict';
// Invisible OCR text layer for scanned PDFs. The original page is kept as
// it is (no re-rendering, same size and quality); recognised words are
// written on top in text render mode 3 (invisible), each one placed and
// stretched to cover exactly its word in the scan, so search, select and
// copy line up with what you see — also on rotated pages.
(() => {
  // Helvetica (WinAnsi) can't encode every script: map common typography to
  // ASCII and drop anything else rather than failing the whole page.
  const REPLACE = {'‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' '};
  function encodable(font, text) {
    let out = '';
    for (const ch of String(text)) {
      const c = REPLACE[ch] || ch;
      try { font.encodeText(c); out += c; } catch (e) { /* not in WinAnsi */ }
    }
    return out.trim();
  }
  /* words: [{text, x0, y0, x1, y1}] in canvas pixels; toPdf(x, y) → [x, y]
     in PDF user space (pdf.js viewport.convertToPdfPoint). Returns the
     number of words written. */
  function addWords(lib, doc, page, font, words, toPdf) {
    const ops = [], {PDFOperator, PDFOperatorNames: Op, PDFNumber} = lib;
    const fontName = page.node.newFontDictionary('OcrHelv', font.ref);
    const num = n => PDFNumber.of(Math.round(n * 1000) / 1000);
    let count = 0;
    for (const word of words) {
      const text = encodable(font, word.text);
      if (!text) continue;
      // Baseline start/end and the top-left corner, in PDF space.
      const base0 = toPdf(word.x0, word.y1), base1 = toPdf(word.x1, word.y1), top0 = toPdf(word.x0, word.y0);
      const dx = base1[0] - base0[0], dy = base1[1] - base0[1];
      const width = Math.hypot(dx, dy), height = Math.hypot(top0[0] - base0[0], top0[1] - base0[1]);
      if (width < 0.5 || height < 0.5) continue;
      const cos = dx / width, sin = dy / width;
      const size = height * 0.9, natural = font.widthOfTextAtSize(text, size);
      if (natural <= 0) continue;
      // Descent: lift the baseline a little so the glyph box matches the word box.
      const lift = height * 0.18;
      ops.push(PDFOperator.of(Op.BeginText),
        PDFOperator.of(Op.SetFontAndSize, [fontName, num(size)]),
        PDFOperator.of(Op.SetTextRenderingMode, [PDFNumber.of(3)]),
        PDFOperator.of(Op.SetTextHorizontalScaling, [num(100 * width / natural)]),
        PDFOperator.of(Op.SetTextMatrix, [num(cos), num(sin), num(-sin), num(cos), num(base0[0] - sin * lift), num(base0[1] + cos * lift)]),
        PDFOperator.of(Op.ShowText, [font.encodeText(text)]),
        PDFOperator.of(Op.EndText));
      count++;
    }
    if (ops.length) page.pushOperators(lib.pushGraphicsState(), ...ops, lib.popGraphicsState());
    return count;
  }
  globalThis.PDFOcrLayer = {addWords, encodable};
})();
