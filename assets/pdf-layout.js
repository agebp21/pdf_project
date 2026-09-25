/* Layout-preserving page model for PDF -> Word / PowerPoint.
 *
 * For each page: render the graphics WITHOUT the text PDF.js paints via
 * fillText/strokeText (a scoped canvas proxy; vendor code untouched), and
 * return those text runs with position, size, colour and font so they can be
 * rebuilt as editable text on top of the text-free background.
 *
 * Only runs whose paint was actually suppressed are returned. Text drawn
 * another way (Type3 glyph paths, outlines, raster scans) stays in the
 * background image, so nothing is shown twice. Scanned pages therefore come
 * back with runs=[] and the caller falls back to OCR / page image.
 *
 * Units: page coordinates in PDF points (1/72 in), origin top-left.
 */
(function (root) {
  'use strict';

  var KNOWN_FONTS = [
    [/arial|helvetica|liberationsans|arimo/i, 'Arial'],
    [/times|liberationserif|tinos/i, 'Times New Roman'],
    [/courier|liberationmono|cousine/i, 'Courier New'],
    [/calibri|carlito/i, 'Calibri'],
    [/cambria|caladea/i, 'Cambria'],
    [/georgia/i, 'Georgia'],
    [/verdana/i, 'Verdana'],
    [/tahoma/i, 'Tahoma'],
    [/trebuchet/i, 'Trebuchet MS'],
    [/segoe/i, 'Segoe UI'],
    [/garamond/i, 'Garamond'],
    [/century\s*gothic|centurygothic/i, 'Century Gothic'],
    [/montserrat/i, 'Montserrat'],
    [/poppins/i, 'Poppins'],
    [/roboto/i, 'Roboto'],
    [/open\s*sans|opensans/i, 'Open Sans'],
    [/lato/i, 'Lato'],
  ];

  // "ABCDEF+Calibri-BoldItalic" -> "Calibri". Unknown faces fall back to the
  // PDF's generic family so Office always has something installed to use.
  function fontFace(name, generic) {
    var clean = String(name || '').replace(/^[A-Z]{6}\+/, '');
    for (var i = 0; i < KNOWN_FONTS.length; i++) if (KNOWN_FONTS[i][0].test(clean)) return KNOWN_FONTS[i][1];
    if (/serif/i.test(generic) && !/sans/i.test(generic)) return 'Times New Roman';
    if (/mono/i.test(generic)) return 'Courier New';
    return 'Arial';
  }

  function hexColor(style) {
    if (typeof style !== 'string') return '000000';
    var m = /^#([0-9a-f]{6})$/i.exec(style);
    if (m) return m[1].toUpperCase();
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(style);
    if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
    m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(style);
    if (m) return [m[1], m[2], m[3]].map(function (v) { return ('0' + Math.min(255, +v).toString(16)).slice(-2); }).join('').toUpperCase();
    return '000000';
  }

  // Join same-baseline runs that sit next to each other into one text box,
  // so a line is one editable box instead of dozens of fragments. A wide gap
  // (table column) starts a new box so columns stay where they were.
  function mergeRuns(runs) {
    // PDFs often paint the same run twice (shadow, faux bold): keep one,
    // before joining, so the copy can't end up as a stray second box.
    var unique = [];
    runs.forEach(function (run) {
      var twin = unique.findIndex(function (o) {
        return o.text === run.text && Math.abs(o.x - run.x) < Math.max(2, run.size * 0.2) && Math.abs(o.baseline - run.baseline) < Math.max(2, run.size * 0.2);
      });
      if (twin < 0) unique.push(run); else unique[twin] = run;
    });
    var sorted = unique.sort(function (a, b) {
      var sameLine = Math.abs(a.baseline - b.baseline) < Math.max(1.5, Math.min(a.size, b.size) * 0.3);
      return sameLine ? a.x - b.x : a.baseline - b.baseline;
    });
    var lines = [];
    sorted.forEach(function (run) {
      var last = lines[lines.length - 1];
      var sameLine = last && Math.abs(last.baseline - run.baseline) < Math.max(1.5, run.size * 0.3);
      var gap = last ? run.x - (last.x + last.w) : 0;
      if (sameLine && gap < Math.max(last.size, run.size) * 1.2 && gap > -Math.max(2, run.size * 0.5) &&
          Math.abs(last.size - run.size) < Math.max(1, run.size * 0.25)) {
        var needsSpace = gap > run.size * 0.15 && !/\s$/.test(last.text) && !/^\s/.test(run.text);
        last.text += (needsSpace ? ' ' : '') + run.text;
        var right = Math.max(last.x + last.w, run.x + run.w);
        var top = Math.min(last.y, run.y), bottom = Math.max(last.y + last.h, run.y + run.h);
        last.w = right - last.x; last.y = top; last.h = bottom - top;
        last.bold = last.bold && run.bold; last.italic = last.italic && run.italic;
      } else {
        lines.push(Object.assign({}, run));
      }
    });
    return lines.filter(function (line) { line.text = line.text.replace(/\s+/g, ' ').trim(); return !!line.text; });
  }

  /* Render one pdf.js page. Returns
   * {width, height, background:{w,h,b64}, runs:[{text,x,y,w,h,size,baseline,color,font,bold,italic}]}
   * maxPx bounds the background image's longest side. */
  async function layoutPage(page, options) {
    options = options || {};
    var pdfjs = options.pdfjsLib || root.pdfjsLib;
    var maxPx = options.maxPx || 1800;
    var base = page.getViewport({ scale: 1 });
    var scale = Math.min(2.5, maxPx / Math.max(base.width, base.height));
    var viewport = page.getViewport({ scale: scale });
    var content = await page.getTextContent();
    var styles = content.styles || {};
    var items = [];
    content.items.forEach(function (item) {
      if (!item.str || !item.str.trim() || !item.transform) return;
      var tx = pdfjs.Util.transform(base.transform, item.transform);
      var angle = Math.atan2(tx[1], tx[0]);
      if (Math.abs(angle) > 0.01) return; // rotated text stays in the background
      var size = Math.hypot(tx[2], tx[3]);
      if (!(size > 0)) return;
      var style = styles[item.fontName] || {};
      var ascent = Number.isFinite(style.ascent) ? style.ascent : Number.isFinite(style.descent) ? 1 + style.descent : 0.8;
      items.push({ item: item, text: item.str, x: tx[4], baseline: tx[5], size: size, ascent: ascent * size,
        w: Math.max(item.width || 0, size * 0.3), generic: style.fontFamily || 'sans-serif' });
    });

    var canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    var ctx = canvas.getContext('2d');
    var captured = new Map();
    function match(px, py) {
      var best = null, bestDist = Infinity;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var dist = Math.abs(py - it.baseline);
        if (dist < Math.max(2, it.size * 0.25) && px >= it.x - 1 && px <= it.x + it.w + 1 && dist < bestDist) { best = it; bestDist = dist; }
      }
      return best;
    }
    var proxy = new Proxy(ctx, {
      get: function (target, key) {
        if (key === 'fillText' || key === 'strokeText') {
          return function (text, x, y) {
            var m = target.getTransform();
            var px = (m.a * x + m.c * y + m.e) / scale, py = (m.b * x + m.d * y + m.f) / scale;
            var it = match(px, py);
            if (it) {
              if (key === 'fillText' || !captured.has(it)) captured.set(it, { color: key === 'fillText' ? target.fillStyle : target.strokeStyle, font: target.font });
              return;
            }
            return target[key].apply(target, arguments);
          };
        }
        var value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set: function (target, key, value) { return Reflect.set(target, key, value, target); },
    });
    var white = ctx.fillStyle; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = white;
    await page.render({ canvasContext: proxy, viewport: viewport }).promise;
    var background = { w: canvas.width, h: canvas.height, b64: canvas.toDataURL('image/jpeg', 0.88).split(',')[1] };
    canvas.width = canvas.height = 0;

    var runs = [];
    items.forEach(function (it) {
      var paint = captured.get(it);
      if (!paint) return;
      var realName = '';
      try { realName = (page.commonObjs.get(it.item.fontName) || {}).name || ''; } catch (e) {}
      var fontString = realName + ' ' + (paint.font || '');
      runs.push({ text: it.text, x: it.x, y: it.baseline - it.ascent, w: it.w, h: it.size * 1.2, size: it.size,
        baseline: it.baseline, color: hexColor(paint.color), font: fontFace(realName, it.generic),
        bold: /bold|black|heavy|semibold|demi/i.test(fontString), italic: /italic|oblique/i.test(fontString) });
    });
    return { width: base.width, height: base.height, background: background, runs: mergeRuns(runs) };
  }

  root.PdfLayout = { layoutPage: layoutPage, mergeRuns: mergeRuns, fontFace: fontFace, hexColor: hexColor };
})(typeof window !== 'undefined' ? window : globalThis);
