/* OCR engine shared by the tools: Tesseract.js v5.1.1 (Apache-2.0) from this site's own
 * assets/vendor/ocr (no CDN, works offline once cached), no AI.
 *
 *   OcrEngine.load()                         the engine script
 *   OcrEngine.pool({langs, size, logger})    → {size, recognize(canvas, {rotate}), stop()}
 *     several workers read pages side by side (size: from the device's cores and memory);
 *     recognize() cleans the picture first (grey, contrast stretched); a weak result is
 *     read again as black-and-white, and a near-empty one turned 90°/180°/270° (a page
 *     scanned sideways or upside down). The best read wins:
 *     → {data, rotate, conf, words, toOriginal(bbox)}  (bbox in the canvas given)
 *   OcrEngine.prepare(canvas, 'gray' | 'binary', make?) · OcrEngine.turn(canvas, deg, make?)
 *   OcrEngine.LANGS  the languages shipped with the site
 */
(function (root) {
  'use strict';
  const LANGS = { ind: 'Indonesia', eng: 'English', msa: 'Melayu', jav: 'Jawa', sun: 'Sunda' };
  let loading = null;

  function base() {
    const href = String(root.location && root.location.href || '').split(/[?#]/)[0];
    return href.slice(0, href.lastIndexOf('/') + 1) + 'assets/vendor/ocr/';
  }
  function load() {
    if (root.Tesseract) return Promise.resolve();
    if (!loading) loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = base() + 'tesseract.min.js';
      s.onload = resolve;
      s.onerror = () => { loading = null; reject(new Error('Mesin OCR gagal dimuat. Muat ulang halaman.')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  // How many pages to read at once: half the cores (1-4); a phone 2 at most (memory), a
  // low-memory device 1.
  function poolSize() {
    const nav = root.navigator || {};
    if (nav.deviceMemory && nav.deviceMemory <= 2) return 1;
    const phone = /Android|iPhone|iPad|Mobi/i.test(nav.userAgent || '');
    return Math.max(1, Math.min(phone ? 2 : 4, Math.floor((nav.hardwareConcurrency || 2) / 2)));
  }

  const blank = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // Grey with the paper evened out: the paper's brightness is found around every spot (the
  // brightest nearby, on a coarse grid, smoothed) and each pixel divided by it, so a shadow,
  // a page curl or yellowed paper becomes white while the ink stays dark; then the contrast
  // is stretched (1st-99th percentile). A clean page stays as it is.
  // 'binary': the evened grey, lightly blurred against specks, cut at Otsu's threshold.
  function prepare(canvas, mode, make = blank) {
    const w = canvas.width, h = canvas.height, out = make(w, h), ctx = out.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    const image = ctx.getImageData(0, 0, w, h), px = image.data, n = w * h;
    const grey = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = px[i * 4 + 3] / 255;                          // transparent = white paper
      grey[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) * a + 255 * (1 - a);
    }
    // paper brightness on a grid of cells: brightest in each cell, spread over nearby cells
    const cell = Math.max(8, Math.round(Math.max(w, h) / 150)), gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    let grid = new Float32Array(gw * gh);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const g = (y / cell | 0) * gw + (x / cell | 0);
      if (grey[y * w + x] > grid[g]) grid[g] = grey[y * w + x];
    }
    const spread = (src, r, pick) => {
      const dst = new Float32Array(gw * gh);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        let v = pick === 'max' ? 0 : 0, count = 0;
        for (let j = Math.max(0, y - r); j <= Math.min(gh - 1, y + r); j++) for (let i = Math.max(0, x - r); i <= Math.min(gw - 1, x + r); i++) {
          const s = src[j * gw + i];
          if (pick === 'max') { if (s > v) v = s; } else { v += s; count++; }
        }
        dst[y * gw + x] = pick === 'max' ? v : v / count;
      }
      return dst;
    };
    grid = spread(spread(grid, 3, 'max'), 2, 'mean');
    const paper = (x, y) => {                                  // bilinear between cell centres
      const fx = Math.max(0, Math.min(gw - 1, x / cell - 0.5)), fy = Math.max(0, Math.min(gh - 1, y / cell - 0.5));
      const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      const top = grid[y0 * gw + x0] * (1 - tx) + grid[y0 * gw + x1] * tx, bottom = grid[y1 * gw + x0] * (1 - tx) + grid[y1 * gw + x1] * tx;
      return top * (1 - ty) + bottom * ty;
    };
    const even = new Uint8ClampedArray(n), hist = new Uint32Array(256);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, v = Math.min(255, grey[i] * 255 / Math.max(24, paper(x, y)));
      even[i] = v; hist[even[i]]++;
    }
    let lo = 0, hi = 255, seen = 0;
    for (; lo < 255 && (seen += hist[lo]) < n * 0.01; lo++);
    seen = 0;
    for (; hi > 0 && (seen += hist[hi]) < n * 0.01; hi--);
    const span = Math.max(1, hi - lo);
    if (span < 230) for (let i = 0; i < n; i++) even[i] = (even[i] - lo) * 255 / span;
    if (mode === 'binary') {
      const soft = new Uint8ClampedArray(n), h2 = new Uint32Array(256);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let sum = 0, count = 0;
        for (let j = Math.max(0, y - 1); j <= Math.min(h - 1, y + 1); j++) for (let i = Math.max(0, x - 1); i <= Math.min(w - 1, x + 1); i++) { sum += even[j * w + i]; count++; }
        soft[y * w + x] = sum / count; h2[soft[y * w + x]]++;
      }
      let total = 0, sumAll = 0;
      for (let v = 0; v < 256; v++) { total += h2[v]; sumAll += v * h2[v]; }
      let wB = 0, sumB = 0, best = 0, cut = 128;
      for (let v = 0; v < 256; v++) {                           // Otsu: the cut that best splits ink from paper
        wB += h2[v]; if (!wB || wB === total) continue;
        sumB += v * h2[v];
        const mB = sumB / wB, mF = (sumAll - sumB) / (total - wB), between = wB * (total - wB) * (mB - mF) * (mB - mF);
        if (between > best) { best = between; cut = v; }
      }
      for (let i = 0; i < n; i++) even[i] = soft[i] > cut ? 255 : 0;
    }
    for (let i = 0; i < n; i++) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = even[i]; px[i * 4 + 3] = 255; }
    ctx.putImageData(image, 0, 0);
    return out;
  }

  // The canvas turned clockwise by 90 / 180 / 270 degrees.
  function turn(canvas, deg, make = blank) {
    const w = canvas.width, h = canvas.height, side = deg % 180 !== 0;
    const out = make(side ? h : w, side ? w : h), ctx = out.getContext('2d');
    ctx.translate(out.width / 2, out.height / 2); ctx.rotate(deg * Math.PI / 180); ctx.drawImage(canvas, -w / 2, -h / 2);
    return out;
  }
  // A box read on the turned canvas, back in the canvas given (w × h).
  function unturn(box, deg, w, h) {
    const back = (u, v) => deg === 90 ? [v, h - u] : deg === 180 ? [w - u, h - v] : deg === 270 ? [w - v, u] : [u, v];
    const a = back(box.x0, box.y0), b = back(box.x1, box.y1);
    return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
  }

  // How good a read is: sure words (confidence 60+) count by how sure, a word Tesseract finds
  // in its dictionary fully, any other real-looking word a little (an upside-down page reads
  // as "uoJes Buepuay", sure enough but not words). share: the dictionary words' part.
  function score(data) {
    const words = (data && data.words || []).filter(w => w.text && /[\p{L}\p{N}]/u.test(w.text));
    let value = 0, known = 0;
    for (const w of words) {
      const dict = w.in_dictionary || /^\p{N}{2,}[.,]?$/u.test(w.text);
      if (dict) known++;
      if (w.confidence >= 60) value += w.confidence * (dict ? 1 : /\p{L}{3,}/u.test(w.text) ? 0.3 : 0);
    }
    const conf = words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0;
    return { value, conf, words: words.length, share: words.length ? known / words.length : 0 };
  }

  async function pool(options = {}) {
    await load();
    const T = root.Tesseract, size = Math.max(1, options.size || poolSize()), path = base();
    const scheduler = T.createScheduler();
    const workers = await Promise.all(Array.from({ length: size }, () => T.createWorker(options.langs || 'ind+eng', 1, {
      workerPath: path + 'worker.min.js', corePath: path, langPath: path.replace(/\/$/, ''), logger: options.logger || (() => {}),
      cachePath: 'ocr-best',        // the browser's saved copy of the language data: the newer, more accurate set
    })));
    for (const w of workers) {
      if (options.params) await w.setParameters(options.params);
      scheduler.addWorker(w);
    }
    const read = canvas => scheduler.addJob('recognize', canvas).then(r => r.data || {});
    return {
      size,
      async recognize(canvas, opts = {}) {
        const w = canvas.width, h = canvas.height, make = opts.make || blank;
        const grey = prepare(canvas, 'gray', make);
        let best = { data: await read(grey), rotate: 0 };
        best.s = score(best.data);
        const tryRead = async (picture, rotate) => {
          const data = await read(picture), s = score(data);
          if (s.value > best.s.value * 1.15) best = { data, rotate, s };
        };
        try {
          if (best.s.conf < 75 || best.s.words < 8) {
            const bin = prepare(canvas, 'binary', make);
            try { await tryRead(bin, 0); } finally { bin.width = bin.height = 0; }
          }
          // Hardly anything sure: maybe the page lies sideways or upside down.
          if (opts.rotate !== false && (best.s.value < 600 || (best.s.share < 0.5 && best.s.conf < 85)) && w * h > 40000) {
            for (const deg of [180, 90, 270]) {
              const turned = turn(grey, deg, make);
              try { await tryRead(turned, deg); } finally { turned.width = turned.height = 0; }
              if (best.rotate && best.s.share >= 0.6 && best.s.conf >= 78) break;   // clearly upright now
            }
          }
        } finally { grey.width = grey.height = 0; }
        const rotate = best.rotate;
        return { data: best.data, rotate, conf: best.s.conf, words: best.s.words, toOriginal: box => unturn(box, rotate, w, h) };
      },
      async stop() { try { await scheduler.terminate(); } catch (e) {} },
    };
  }

  root.OcrEngine = { LANGS, load, pool, poolSize, prepare, turn, unturn, score };
})(typeof self !== 'undefined' ? self : globalThis);
