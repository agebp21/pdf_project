/* Clickable links for flipbooks, read from the PDF when it is opened.
 *
 * 1. Real PDF links (Link annotations): internal destinations become
 *    "go to page" hotspots, http(s)/mailto links stay external links.
 * 2. Plain-text tables of contents without links: early pages with several
 *    lines ending in a page number ("Introduction ..... 5") get a hotspot per
 *    line. The target is the first later page containing that heading, so a
 *    printed number that differs from the PDF page (uncounted cover, roman
 *    numerals) still lands right; otherwise the median offset of the matched
 *    entries, else the printed number itself.
 *
 * Output: { "<pageIndex>": [{x, y, w, h, page} | {x, y, w, h, url}] } with
 * x/y/w/h as fractions of the book page box (letterboxing for pages whose
 * shape differs from the book's first page already applied).
 */
(function (root) {
  'use strict';
  const MAX_PER_PAGE = 200;
  const TOC_SCAN_PAGES = 15;

  const round = value => Math.round(value * 10000) / 10000;
  const clamp01 = value => Math.min(1, Math.max(0, value));
  const safeUrl = url => typeof url === 'string' && /^(https?:\/\/|mailto:)/i.test(url) && url.length <= 500 ? url : null;
  const normalize = text => String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  // Page-space rectangle -> fractions of the page box that shows this page
  // letterboxed (object-fit: contain) inside a box shaped like page 1.
  function toBox(rect, viewport, bookRatio) {
    const ratio = viewport.width / viewport.height;
    let scaleX = 1, scaleY = 1;
    if (ratio < bookRatio) scaleX = ratio / bookRatio; else if (ratio > bookRatio) scaleY = bookRatio / ratio;
    const offX = (1 - scaleX) / 2, offY = (1 - scaleY) / 2;
    const x1 = clamp01(Math.min(rect[0], rect[2]) / viewport.width), x2 = clamp01(Math.max(rect[0], rect[2]) / viewport.width);
    const y1 = clamp01(Math.min(rect[1], rect[3]) / viewport.height), y2 = clamp01(Math.max(rect[1], rect[3]) / viewport.height);
    return { x: round(offX + x1 * scaleX), y: round(offY + y1 * scaleY), w: round((x2 - x1) * scaleX), h: round((y2 - y1) * scaleY) };
  }

  async function destinationPage(pdf, dest) {
    try {
      const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || !explicit.length) return null;
      const ref = explicit[0];
      const index = typeof ref === 'number' ? ref : await pdf.getPageIndex(ref);
      return Number.isInteger(index) && index >= 0 && index < pdf.numPages ? index : null;
    } catch (e) {
      return null;
    }
  }

  async function annotationLinks(pdf, page, viewport, bookRatio) {
    const out = [];
    let annotations = [];
    try { annotations = await page.getAnnotations({ intent: 'display' }); } catch (e) { return out; }
    for (const a of annotations) {
      if (a.subtype !== 'Link' || !Array.isArray(a.rect)) continue;
      const box = toBox(viewport.convertToViewportRectangle(a.rect), viewport, bookRatio);
      if (box.w < 0.002 || box.h < 0.002) continue;
      if (a.dest) {
        const target = await destinationPage(pdf, a.dest);
        if (target !== null && target !== page.pageNumber - 1) out.push(Object.assign(box, { page: target }));
      } else {
        const url = safeUrl(a.url || a.unsafeUrl);
        if (url) out.push(Object.assign(box, { url }));
      }
    }
    return out;
  }

  // Visual lines split into segments at wide gaps (two-column TOCs).
  function lineSegments(content, viewport) {
    const rows = new Map();
    for (const item of content.items) {
      if (!item.str || !item.transform) continue;
      const tx = root.pdfjsLib.Util.transform(viewport.transform, item.transform);
      const size = Math.hypot(tx[2], tx[3]) || 10;
      const key = Math.round(tx[5] / Math.max(2, size * 0.5));
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ text: item.str, x: tx[4], right: tx[4] + (item.width || 0) * (viewport.scale || 1), baseline: tx[5], size });
    }
    const segments = [];
    for (const items of rows.values()) {
      items.sort((a, b) => a.x - b.x);
      let current = null;
      for (const item of items) {
        if (current && item.x - current.right > current.size * 4) { segments.push(current); current = null; }
        if (!current) current = { text: '', x: item.x, right: item.right, baseline: item.baseline, size: item.size };
        current.text += (current.text && item.x - current.right > item.size * 0.2 ? ' ' : '') + item.text;
        current.right = Math.max(current.right, item.right); current.size = Math.max(current.size, item.size);
      }
      if (current) segments.push(current);
    }
    return segments;
  }

  // "Title ....... 12" / "Title   12" / "12  Title"? -> only trailing numbers.
  function tocEntry(text) {
    const match = /^(.*?[A-Za-zÀ-ɏ].*?)[\s.…·_-]*?\s(\d{1,4})\s*$/.exec(text.trim());
    if (!match) return null;
    const title = match[1].replace(/[.…·_\s-]+$/, '').trim();
    if (title.length < 2 || normalize(title).length < 2) return null;
    return { title, number: Number(match[2]) };
  }

  async function pageTexts(pdf, cache) {
    if (cache.texts) return cache.texts;
    const texts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      try {
        const content = await (await pdf.getPage(i)).getTextContent();
        texts.push(' ' + normalize(content.items.map(item => item.str).join(' ')) + ' ');
      } catch (e) { texts.push(''); }
    }
    cache.texts = texts;
    return texts;
  }

  async function tocLinks(pdf, page, viewport, bookRatio, cache) {
    let content;
    try { content = await page.getTextContent(); } catch (e) { return []; }
    const entries = [];
    for (const segment of lineSegments(content, viewport)) {
      const entry = tocEntry(segment.text);
      if (entry) entries.push(Object.assign(entry, segment));
    }
    if (entries.length < 3) return [];
    // A real TOC mostly lists increasing page numbers.
    // Reading order: left column top-to-bottom, then the right column
    // (indented sub-entries stay in their column).
    const column = entry => (entry.x < viewport.width / 2 ? 0 : 1);
    const byPosition = entries.slice().sort((a, b) => (column(a) - column(b)) || (a.baseline - b.baseline));
    let increasing = 0;
    for (let i = 1; i < byPosition.length; i++) if (byPosition[i].number >= byPosition[i - 1].number) increasing++;
    if (increasing < (byPosition.length - 1) * 0.7) return [];
    const here = page.pageNumber - 1, texts = await pageTexts(pdf, cache);
    const offsets = [];
    for (const entry of entries) {
      const needle = ' ' + normalize(entry.title).split(' ').slice(0, 6).join(' ') + ' ';
      if (needle.trim().length < 3) continue;
      for (let i = here + 1; i < texts.length; i++) {
        if (texts[i].indexOf(needle) >= 0) { entry.found = i; offsets.push(i - entry.number); break; }
      }
    }
    offsets.sort((a, b) => a - b);
    const offset = offsets.length ? offsets[Math.floor(offsets.length / 2)] : -1;
    const out = [];
    for (const entry of entries) {
      const target = entry.found !== undefined ? entry.found : entry.number + offset;
      if (!Number.isInteger(target) || target <= here || target >= pdf.numPages) continue;
      const pad = entry.size * 0.25;
      const rect = [entry.x - pad, entry.baseline - entry.size * 1.05, entry.right + pad, entry.baseline + entry.size * 0.35];
      out.push(Object.assign(toBox(rect, viewport, bookRatio), { page: target, auto: true }));
    }
    return out;
  }

  /* Returns { links, stats: {internal, external, toc} }. */
  async function extract(pdf, options) {
    const opts = options || {};
    const progress = opts.progress || function () {};
    const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
    const bookRatio = first.width / first.height;
    const links = {}, stats = { internal: 0, external: 0, toc: 0 }, cache = {};
    for (let i = 1; i <= pdf.numPages; i++) {
      progress(i, pdf.numPages);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      let list = await annotationLinks(pdf, page, viewport, bookRatio);
      const hasInternal = list.some(link => link.page !== undefined);
      if (!hasInternal && i <= TOC_SCAN_PAGES) {
        const toc = await tocLinks(pdf, page, viewport, bookRatio, cache);
        stats.toc += toc.length;
        list = list.concat(toc);
      }
      list.forEach(link => { if (link.url) stats.external++; else if (!link.auto) stats.internal++; });
      if (list.length) links[String(i - 1)] = list.slice(0, MAX_PER_PAGE).map(link => {
        const clean = { x: link.x, y: link.y, w: link.w, h: link.h };
        if (link.url) clean.url = link.url; else clean.page = link.page;
        return clean;
      });
    }
    return { links, stats };
  }

  root.PdfLinks = { extract, tocEntry, toBox, normalize };
})(typeof window !== 'undefined' ? window : globalThis);
