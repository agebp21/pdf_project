/* Translate a whole book "in place": every page keeps its background,
 * pictures, colours and layout; only the text is swapped for a translation.
 *
 * Per page (assets/pdf-layout.js): the page without its text + the text runs
 * (lines with position, size, font, colour). Lines are grouped into
 * paragraph blocks (headings, bullet items, "Label:" lines, table cells and
 * centred lines kept apart), blocks of several pages are translated together
 * (fewer AI calls, consistent terms), and each translation is drawn back into
 * its block — wrapped, growing into empty room, shrunk a little if needed.
 *
 *   PdfTranslate.book(pdf, {target, translate, maxPx, pages?, onProgress, isCancelled})
 *     → Promise<{index: Blob (JPEG)}>   (pages without text are left out)
 *   translate(blocks {key: text}, target) → Promise<{key: translation}>
 */
(function (root) {
  'use strict';

  var BULLET = /^\s*(?:[•●▪◦–—*-]|[-]|\d{1,2}[.)])\s+/;
  var FAMILY = {'Arial': 'Arial, Helvetica, sans-serif', 'Times New Roman': '"Times New Roman", Times, serif',
    'Courier New': '"Courier New", monospace', 'Calibri': 'Calibri, Carlito, Arial, sans-serif',
    'Cambria': 'Cambria, Caladea, Georgia, serif', 'Open Sans': '"Open Sans", Arial, sans-serif'};
  var BATCH_BLOCKS = 40, BATCH_CHARS = 9000;

  // Lines (merged runs from PdfLayout) → paragraph blocks.
  function blocks(lines, pageWidth) {
    var sorted = lines.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    // Table rows: a line with another on the same baseline where one of them
    // is a short cell ("Opening | : Ambient…"). Rows are never joined.
    var short = function (l) { return l.w < (pageWidth || 600) * 0.25; };
    sorted.forEach(function (line) {
      line.row = sorted.some(function (o) { return o !== line && Math.abs(o.baseline - line.baseline) < line.size * 0.35 && (short(o) || short(line)); });
    });
    var out = [];
    sorted.forEach(function (line) {
      var bullet = BULLET.test(line.text);
      var startsBold = !!(line.parts && line.parts[0] && line.parts[0].bold && !line.bold);   // "Label: text"
      var fits = out.filter(function (b) {
        var last = b.lines[b.lines.length - 1];
        var gap = line.y - (last.y + last.h);
        var sameSize = Math.abs(last.size - line.size) <= Math.max(0.6, last.size * 0.15);
        var overlap = Math.min(b.x + b.w, line.x + line.w) - Math.max(b.x, line.x);
        var leftAligned = Math.abs(line.x - b.textX) < line.size * 1.2;
        var centred = Math.abs((line.x + line.w / 2) - (last.x + last.w / 2)) < line.size * 0.8;
        // A line that ended early or with ":" was broken on purpose; a bold "Label:" starts anew.
        var brokeOnPurpose = /:$/.test(last.text) || (startsBold && /[.:;]$/.test(last.text)) || last.w < line.w * 0.6;
        return !bullet && !line.row && !last.row && sameSize && gap > -line.size * 0.4 && gap < line.size * 0.9 &&
          overlap > 0 && (leftAligned || centred) && !brokeOnPurpose;
      });
      var b = fits[fits.length - 1];
      if (b) {
        b.lines.push(line);
        var right = Math.max(b.x + b.w, line.x + line.w);
        b.x = Math.min(b.x, line.x); b.w = right - b.x;
      } else {
        var mark = bullet ? (BULLET.exec(line.text) || [''])[0] : '';
        out.push({lines: [line], x: line.x, w: line.w, textX: bullet ? line.x + line.size * 1.2 : line.x, bullet: mark.trim()});
      }
    });
    out.forEach(function (b) {
      var first = b.lines[0], last = b.lines[b.lines.length - 1];
      b.y = first.y; b.h = last.y + last.h - first.y;
      b.size = first.size; b.color = first.color; b.font = first.font; b.bold = first.bold; b.italic = first.italic;
      b.step = b.lines.length > 1 ? (last.baseline - first.baseline) / (b.lines.length - 1) : first.size * 1.25;
      b.ascent = first.baseline - first.y;
      b.text = b.lines.map(function (l, i) { return i === 0 && b.bullet ? l.text.replace(BULLET, '') : l.text; })
        .reduce(function (all, t) { return /[A-Za-z]-$/.test(all) ? all.slice(0, -1) + t : (all ? all + ' ' : '') + t; }, '').trim();
      var p0 = first.parts && first.parts[0];
      b.label = !!(p0 && p0.bold && !first.bold && /:\s*$/.test(p0.text + (first.parts[1] ? first.parts[1].text.slice(0, 1) : '')));
      var centres = b.lines.map(function (l) { return l.x + l.w / 2; }), lefts = b.lines.map(function (l) { return l.x; });
      b.center = b.lines.length > 1 && Math.max.apply(null, centres) - Math.min.apply(null, centres) < b.size * 0.8 &&
        Math.max.apply(null, lefts) - Math.min.apply(null, lefts) > b.size;
    });
    return out.filter(function (b) { return /[A-Za-zÀ-ɏ]{2}/.test(b.text); });
  }

  // How far each block may grow: down to the next block in its columns, right
  // to the next block beside it (one-line blocks) or near the page edge.
  function rooms(list, pageWidth, pageHeight) {
    list.forEach(function (b) {
      var below = list.filter(function (o) { return o !== b && o.y >= b.y + b.h - 0.5 && Math.min(o.x + o.w, b.x + b.w) - Math.max(o.x, b.x) > 0; });
      var next = below.length ? Math.min.apply(null, below.map(function (o) { return o.y; })) : pageHeight - 20;
      b.roomBottom = Math.max(b.y + b.h, next - b.size * 0.3);
      var beside = list.filter(function (o) { return o !== b && o.x >= b.x + b.w - 0.5 && Math.min(o.y + o.h, b.y + b.h) - Math.max(o.y, b.y) > 0; });
      var edge = beside.length ? Math.min.apply(null, beside.map(function (o) { return o.x; })) - b.size : pageWidth * 0.96;
      b.roomRight = Math.min(edge, b.x + b.w * 1.6 + b.size * 4);
    });
  }

  function fontOf(b, px, bold) {
    return (b.italic ? 'italic ' : '') + (bold || b.bold ? 'bold ' : '') + px + 'px ' + (FAMILY[b.font] || '"' + b.font + '", Arial, sans-serif');
  }
  function wrap(ctx, text, width) {
    var rows = [], row = '';
    text.split(/\s+/).forEach(function (word) {
      var next = row ? row + ' ' + word : word;
      if (!row || ctx.measureText(next).width <= width) row = next;
      else { rows.push(row); row = word; }
    });
    if (row) rows.push(row);
    return rows;
  }

  // The translated page: blocks drawn on the text-free background.
  function draw(layout, image, items) {
    var canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    var k = image.width / layout.width;
    items.forEach(function (item) {
      var b = item.block, text = item.text;
      var width = Math.max((b.x + b.w - b.textX) * 1.04, b.lines.length === 1 && !b.center ? b.roomRight - b.textX : 0);
      var room = b.roomBottom - b.y, size = b.size, rows = [], step = b.step;
      for (var tries = 0; tries < 14; tries++) {
        ctx.font = fontOf(b, size * k);
        rows = wrap(ctx, text, width * k);
        step = b.step * (size / b.size);
        if (rows.length * step - (step - size) <= room * 1.02 || size <= b.size * 0.6) break;
        size *= 0.95;
      }
      ctx.fillStyle = '#' + (b.color || '000000');
      ctx.textBaseline = 'alphabetic';
      var top = b.y + b.ascent * (size / b.size);
      if (b.bullet) ctx.fillText(b.bullet, b.x * k, top * k);
      var label = b.label && /^[^:]{1,40}:/.exec(text);
      rows.forEach(function (row, i) {
        var x = b.textX * k, y = (top + i * step) * k;
        if (b.center) x = (b.x + b.w / 2) * k - ctx.measureText(row).width / 2;
        if (i === 0 && label && row.indexOf(label[0]) === 0) {
          var plain = ctx.font;
          ctx.font = fontOf(b, size * k, true);
          ctx.fillText(label[0], x, y);
          var w = ctx.measureText(label[0]).width;
          ctx.font = plain;
          ctx.fillText(row.slice(label[0].length), x + w, y);
          return;
        }
        ctx.fillText(row, x, y);
      });
    });
    return canvas;
  }

  function loadImage(b64) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('The page picture could not be read.')); };
      image.src = 'data:image/jpeg;base64,' + b64;
    });
  }
  function toBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error('The translated page could not be saved.')); }, 'image/jpeg', 0.86);
    });
  }

  // The whole book. Pages are read in order; blocks of several pages go to the
  // translator together; each page is drawn as soon as its blocks are back.
  async function book(pdf, options) {
    var target = options.target, maxPx = options.maxPx || 1100;
    // A hiccup (timeout, a reply the server could not read) is tried once more;
    // a second failure stops the book with the reason.
    var translate = async function (request, lang) {
      try { return await options.translate(request, lang); }
      catch (first) {
        if (/budget|quota|429|402|Pro|Business|log in|masuk/i.test(first && first.message)) throw first;   // retrying won't help
        await new Promise(function (resolve) { setTimeout(resolve, options.retryDelay === undefined ? 1500 : options.retryDelay); });
        return options.translate(request, lang);
      }
    };
    var progress = options.onProgress || function () {};
    var cancelled = options.isCancelled || function () { return false; };
    var wanted = options.pages || Array.from({length: pdf.numPages}, function (_, i) { return i; });
    var done = {}, batch = [], chars = 0, count = 0;
    var total = wanted.length, finished = 0;

    async function flush() {
      if (!batch.length) return;
      var request = {}, key = 0;
      batch.forEach(function (page) { page.list.forEach(function (b) { b.key = String(key++); request[b.key] = b.text; }); });
      progress('translate', finished, total);
      var answer = await translate(request, target) || {};
      for (var i = 0; i < batch.length; i++) {
        if (cancelled()) throw new Error('cancelled');
        var page = batch[i];
        var items = page.list.map(function (b) { return {block: b, text: String(answer[b.key] || b.text).replace(/\s+/g, ' ').trim()}; });
        var image = await loadImage(page.layout.background.b64);
        var canvas = draw(page.layout, image, items);
        done[page.index] = await toBlob(canvas);
        canvas.width = canvas.height = 0;
        finished++;
        progress('draw', finished, total);
      }
      batch = []; chars = 0;
    }

    for (var n = 0; n < wanted.length; n++) {
      if (cancelled()) throw new Error('cancelled');
      var index = wanted[n];
      progress('read', count++, total);
      var page = await pdf.getPage(index + 1);
      var layout = await root.PdfLayout.layoutPage(page, {maxPx: maxPx});
      page.cleanup();
      var list = blocks(layout.runs, layout.width);
      if (!list.length) { finished++; continue; }              // no text: the original page is used
      rooms(list, layout.width, layout.height);
      var size = list.reduce(function (s, b) { return s + b.text.length; }, 0);
      var queued = batch.reduce(function (s, p) { return s + p.list.length; }, 0);
      if (batch.length && (queued + list.length > BATCH_BLOCKS || chars + size > BATCH_CHARS)) await flush();
      batch.push({index: index, layout: layout, list: list}); chars += size;
      // A single page with more blocks than one request takes: on its own, in parts.
      if (list.length > BATCH_BLOCKS) await flushLarge();
    }
    await flush();
    return done;

    // One page with very many blocks: translate it in several requests.
    async function flushLarge() {
      var page = batch.pop(), answer = {};
      await flush();
      for (var i = 0; i < page.list.length; i += BATCH_BLOCKS) {
        var request = {};
        page.list.slice(i, i + BATCH_BLOCKS).forEach(function (b, j) { b.key = String(i + j); request[b.key] = b.text; });
        progress('translate', finished, total);
        Object.assign(answer, await translate(request, target) || {});
      }
      var items = page.list.map(function (b) { return {block: b, text: String(answer[b.key] || b.text).replace(/\s+/g, ' ').trim()}; });
      var image = await loadImage(page.layout.background.b64);
      var canvas = draw(page.layout, image, items);
      done[page.index] = await toBlob(canvas);
      canvas.width = canvas.height = 0;
      finished++;
      progress('draw', finished, total);
    }
  }

  root.PdfTranslate = {book: book, blocks: blocks, rooms: rooms, BATCH_BLOCKS: BATCH_BLOCKS};
})(typeof window !== 'undefined' ? window : globalThis);
