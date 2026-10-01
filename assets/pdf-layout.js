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
        addPart(last.parts, (needsSpace ? ' ' : '') + run.text, run);
        var right = Math.max(last.x + last.w, run.x + run.w);
        var top = Math.min(last.y, run.y), bottom = Math.max(last.y + last.h, run.y + run.h);
        last.w = right - last.x; last.y = top; last.h = bottom - top;
        last.bold = last.bold && run.bold; last.italic = last.italic && run.italic;
      } else {
        var line = Object.assign({}, run);
        line.parts = [];
        addPart(line.parts, run.text, run);
        lines.push(line);
      }
    });
    return lines.filter(function (line) {
      line.text = line.text.replace(/\s+/g, ' ').trim();
      line.parts = tidyParts(line.parts);
      return !!line.text;
    });
  }

  // A line keeps its styled pieces ("Objective" bold + ": ..." regular), so
  // mixed styles survive; neighbours with the same style become one piece.
  function addPart(parts, text, run) {
    var last = parts[parts.length - 1];
    if (last && last.bold === run.bold && last.italic === run.italic && last.color === run.color && last.font === run.font) last.text += text;
    else parts.push({ text: text, bold: run.bold, italic: run.italic, color: run.color, font: run.font });
  }

  // Same whitespace rules as line.text, so the pieces always join up to it.
  function tidyParts(parts) {
    var out = [];
    parts.forEach(function (part) {
      var text = part.text.replace(/\s+/g, ' ');
      var prev = out[out.length - 1];
      if ((!prev || / $/.test(prev.text)) && text[0] === ' ') text = text.slice(1);
      if (text) out.push(Object.assign({}, part, { text: text }));
    });
    var tail = out[out.length - 1];
    if (tail) { tail.text = tail.text.replace(/ $/, ''); if (!tail.text) out.pop(); }
    return out;
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
    // The run a painted glyph belongs to. When runs touch ("Objective" + ":"),
    // the glyph goes to the one starting closest on its left, so the colon isn't
    // swallowed by the word before it (and then lost from both text and image).
    function match(px, py) {
      var best = null, bestDist = Infinity, bestX = -Infinity;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var dist = Math.abs(py - it.baseline);
        if (!(dist < Math.max(2, it.size * 0.25) && px >= it.x - 1 && px <= it.x + it.w + 1)) continue;
        var startX = it.x <= px + 0.5 ? it.x : -1e9;
        if (!best || startX > bestX + 0.01 || (Math.abs(startX - bestX) <= 0.01 && dist < bestDist)) { best = it; bestDist = dist; bestX = startX; }
      }
      return best;
    }
    var pictures = [];
    var proxy = new Proxy(ctx, {
      get: function (target, key) {
        if (key === 'drawImage' && options.images) {
          return function () {
            var picture = grabPicture(target, arguments, scale);
            var result = target.drawImage.apply(target, arguments);
            if (picture) pictures.push(picture);
            return result;
          };
        }
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
    var images = options.images ? liftPictures(ctx, pictures) : [];
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
    var layout = { width: base.width, height: base.height, background: background, runs: mergeRuns(runs) };
    if (options.images) layout.images = images;
    return layout;
  }

  /* ---------- Pictures as separate images (options.images, for PowerPoint).
   * Every sizeable, unrotated image the page draws is copied (at the resolution
   * pdf.js paints it) together with what was under it. After rendering, a
   * picture is only lifted out when the finished page still shows it exactly —
   * nothing drawn over it, no clip cutting it — and its spot in the background
   * gets back what was under it. Anything else stays in the background, so the
   * slide always looks like the page. Coordinates in PDF points. */
  var MIN_PICTURE_PT = 24;

  function grabPicture(ctx, args, scale) {
    var src = args[0];
    if (args.length !== 9 || !src || !(src.width > 8) || !(src.height > 8) || src === ctx.canvas) return null;
    if (ctx.globalAlpha < 0.99 || ctx.globalCompositeOperation !== 'source-over') return null;
    var m = ctx.getTransform();
    if (Math.abs(m.b) + Math.abs(m.c) > 1e-3 * (Math.abs(m.a) + Math.abs(m.d))) return null; // rotated / skewed
    var sx = args[1], sy = args[2], sw = args[3], sh = args[4], dx = args[5], dy = args[6], dw = args[7], dh = args[8];
    var x0 = m.a * dx + m.e, x1 = m.a * (dx + dw) + m.e, y0 = m.d * dy + m.f, y1 = m.d * (dy + dh) + m.f;
    var left = Math.min(x0, x1), right = Math.max(x0, x1), top = Math.min(y0, y1), bottom = Math.max(y0, y1);
    if ((right - left) / scale < MIN_PICTURE_PT || (bottom - top) / scale < MIN_PICTURE_PT) return null;
    var W = ctx.canvas.width, H = ctx.canvas.height;
    var L = Math.max(0, Math.floor(left)), T = Math.max(0, Math.floor(top)), R = Math.min(W, Math.ceil(right)), B = Math.min(H, Math.ceil(bottom));
    if (R - L < 8 || B - T < 8) return null;
    // The picture upright as it shows on the page (PDFs often draw flipped).
    var fit = Math.min(1, 2000 / Math.max(Math.abs(sw), Math.abs(sh)));
    var snap = document.createElement('canvas');
    snap.width = Math.max(1, Math.round(Math.abs(sw) * fit)); snap.height = Math.max(1, Math.round(Math.abs(sh) * fit));
    var flipX = m.a * dw < 0, flipY = m.d * dh < 0;
    var sctx = snap.getContext('2d');
    sctx.setTransform(flipX ? -1 : 1, 0, 0, flipY ? -1 : 1, flipX ? snap.width : 0, flipY ? snap.height : 0);
    try { sctx.drawImage(src, sx, sy, sw, sh, 0, 0, snap.width, snap.height); } catch (e) { return null; }
    return { left: left, top: top, right: right, bottom: bottom, L: L, T: T, R: R, B: B, scale: scale, snap: snap, smooth: ctx.imageSmoothingEnabled,
      under: ctx.getImageData(L, T, R - L, B - T) };
  }

  function liftPictures(ctx, pictures) {
    var lifted = [];
    pictures.forEach(function (pic) {
      var w = pic.R - pic.L, h = pic.B - pic.T;
      var shown = ctx.getImageData(pic.L, pic.T, w, h).data;
      var alone = document.createElement('canvas');
      alone.width = w; alone.height = h;
      var actx = alone.getContext('2d');
      actx.imageSmoothingEnabled = pic.smooth !== false;
      actx.drawImage(pic.snap, pic.left - pic.L, pic.top - pic.T, pic.right - pic.left, pic.bottom - pic.top);
      var mine = actx.getImageData(0, 0, w, h).data;
      var solid = 0, differ = 0, seeThrough = false;
      for (var i = 0; i < mine.length; i += 8) {           // every other pixel is plenty
        if (mine[i + 3] < 250) {
          // Soft edges from fractional placement don't make a photo transparent.
          var px = (i / 4) % w, py = Math.floor(i / 4 / w);
          if (px > 2 && py > 2 && px < w - 3 && py < h - 3) seeThrough = true;
          continue;
        }
        solid++;
        if (Math.max(Math.abs(mine[i] - shown[i]), Math.abs(mine[i + 1] - shown[i + 1]), Math.abs(mine[i + 2] - shown[i + 2])) > 48) differ++;
      }
      if (solid < (mine.length / 8) * 0.2 || differ > solid * 0.03) return;   // covered or clipped: stays in the background
      pic.mine = mine; pic.seeThrough = seeThrough;
      lifted.push(pic);
    });
    // Put back what was under each lifted picture (latest first).
    for (var k = lifted.length - 1; k >= 0; k--) {
      var pic = lifted[k], w = pic.R - pic.L, h = pic.B - pic.T;
      var now = ctx.getImageData(pic.L, pic.T, w, h);
      for (var j = 0; j < now.data.length; j += 4) {
        if (pic.mine[j + 3] > 128) { now.data[j] = pic.under.data[j]; now.data[j + 1] = pic.under.data[j + 1]; now.data[j + 2] = pic.under.data[j + 2]; now.data[j + 3] = pic.under.data[j + 3]; }
      }
      ctx.putImageData(now, pic.L, pic.T);
    }
    return lifted.map(function (pic) {
      var png = pic.seeThrough;
      var b64 = pic.snap.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9).split(',')[1];
      var out = { x: pic.left / pic.scale, y: pic.top / pic.scale, w: (pic.right - pic.left) / pic.scale, h: (pic.bottom - pic.top) / pic.scale,
        type: png ? 'png' : 'jpeg', b64: b64 };
      pic.snap.width = pic.snap.height = 0;
      return out;
    });
  }

  root.PdfLayout = { layoutPage: layoutPage, mergeRuns: mergeRuns, fontFace: fontFace, hexColor: hexColor };
})(typeof window !== 'undefined' ? window : globalThis);
