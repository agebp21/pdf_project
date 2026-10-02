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
 *   PdfTranslate.book(pdf, {target, translate, maxPx, pages?, onProgress, onPage(index, blob, said, words), isCancelled})
 *   (words: {lines: PdfWords lines of the drawn text, text: their strings, ratio: page width / height})
 *     → Promise<{index: Blob (JPEG)}>   (pages without text are left out)
 *   translate(blocks {key: text}, target) → Promise<{key: translation}>
 */
(function (root) {
  'use strict';

  var BULLET = /^\s*(?:[•●▪◦■□▫▸►✓–—*-]|[-]|\d{1,2}[.)])\s+/;
  var FAMILY = {'Arial': 'Arial, Helvetica, sans-serif', 'Times New Roman': '"Times New Roman", Times, serif',
    'Courier New': '"Courier New", monospace', 'Calibri': 'Calibri, Carlito, Arial, sans-serif',
    'Cambria': 'Cambria, Caladea, Georgia, serif', 'Open Sans': '"Open Sans", Arial, sans-serif'};
  var BATCH_BLOCKS = 40, BATCH_CHARS = 9000;

  // Lines (merged runs from PdfLayout) → paragraph blocks.
  function blocks(lines, pageWidth) {
    var sorted = lines.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    // Table rows: a short cell with its value close beside it on the same
    // baseline ("Opening | : Ambient…"). Rows are never joined. Columns of a
    // magazine page also share baselines, but their lines are as wide as the
    // column and a gutter apart, so they still join into paragraphs.
    var widths = sorted.filter(function (l) { return l.text.length > 30; }).map(function (l) { return l.w; }).sort(function (a, b) { return a - b; });
    var typical = widths.length ? widths[Math.floor(widths.length / 2)] : (pageWidth || 600) * 0.4;
    var short = function (l) { return l.w < Math.min((pageWidth || 600) * 0.25, typical * 0.6); };
    var sizes = sorted.filter(function (l) { return l.text.length > 30; }).map(function (l) { return l.size; }).sort(function (a, b) { return a - b; });
    var bodySize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
    // A line in a right-aligned stack (a photo caption) is no table cell.
    var stacked = function (l) {
      return sorted.some(function (o) {
        var gap = o.y > l.y ? o.y - (l.y + l.h) : l.y - (o.y + o.h);
        return o !== l && Math.abs((o.x + o.w) - (l.x + l.w)) < l.size * 0.6 && Math.abs(o.x - l.x) > l.size * 1.5 && gap > -l.size * 0.4 && gap < l.size * 0.9;
      });
    };
    sorted.forEach(function (line) {
      line.row = !stacked(line) && sorted.some(function (o) {
        if (o === line || Math.abs(o.baseline - line.baseline) >= line.size * 0.35) return false;
        var left = o.x < line.x ? o : line, right = left === o ? line : o;
        // ...same type size, and close (a caption beside a box of tips is no row).
        return short(left) && right.x - (left.x + left.w) < line.size * 4 && Math.abs(o.size - line.size) <= Math.max(0.6, line.size * 0.12);
      });
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
        var rightAligned = Math.abs((line.x + line.w) - (last.x + last.w)) < line.size * 0.6 && line.text.length < 60;
        // A line that ended early or with ":" was broken on purpose; a bold "Label:" starts anew.
        // (Right-aligned captions are ragged on the left: a short line there is normal.)
        var brokeOnPurpose = /:$/.test(last.text) || (startsBold && /[.:;]$/.test(last.text)) || (last.w < line.w * 0.6 && !(rightAligned && !leftAligned));
        return !bullet && !line.row && !last.row && sameSize && gap > -line.size * 0.4 && gap < line.size * 0.9 &&
          overlap > 0 && (leftAligned || centred || rightAligned) && !brokeOnPurpose;
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
      var centres = b.lines.map(function (l) { return l.x + l.w / 2; }), lefts = b.lines.map(function (l) { return l.x; }), rights = b.lines.map(function (l) { return l.x + l.w; });
      var spread = function (v) { return Math.max.apply(null, v) - Math.min.apply(null, v); };
      // Centred: lines sharing a centre but neither a left nor a right edge
      // (justified text with an indented first line shares both centre and
      // right edge: not centred), or short lines whose centre is the page's
      // middle (a title, one line or a few).
      var shared = spread(centres) < b.size * 0.8;
      // A page-middle line is a title only when it looks like one (bigger than
      // the body text, or short) — the middle column of a magazine is not.
      var middle = pageWidth && b.x > pageWidth * 0.15 && Math.abs(centres[0] - pageWidth / 2) < pageWidth * 0.04 &&
        (!bodySize || b.size > bodySize * 1.15 || b.text.length < 30);
      var minLeft = Math.min.apply(null, lefts), moved = lefts.filter(function (x) { return x > minLeft + b.size * 0.4; }).length;
      // Several lines must start further in (ragged left): one indented first line is a paragraph.
      b.center = !b.bullet && ((b.lines.length > 1 && shared && moved >= 2 && moved >= b.lines.length * 0.4 && spread(rights) > b.size * 0.4) || (shared && middle));
      // Right-aligned (photo captions): a shared right edge, ragged left.
      b.right = !b.bullet && !b.center && b.lines.length > 1 && spread(rights) < b.size * 0.5 && spread(lefts) > b.size * 1.5;
    });
    // A drop cap (one big letter beside the start of a paragraph) goes back
    // into its paragraph: "D" + "o you remember…" is translated as one text.
    out.forEach(function (cap) {
      if (cap.lines.length !== 1 || !/^[A-Za-zÀ-ɏ]$/.test(cap.text)) return;
      var para = out.filter(function (b) {
        var x = b.lines[0].x;                                    // its first line sits beside the letter
        return b !== cap && b.size < cap.size * 0.6 && x >= cap.x + cap.w - b.size && x - (cap.x + cap.w) < cap.size * 1.5 &&
          b.y < cap.y + cap.h && b.y + b.h > cap.y;
      }).sort(function (a, b) { return a.y - b.y; })[0];
      if (!para || !/^[a-z]/.test(para.text)) return;
      para.text = cap.text + para.text; cap.text = '';
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
      // Anything to the right in the band the text could grow into (its own
      // lines down to the room below) stops it: no running into the next column.
      var bottom = Math.max(b.y + b.h, b.roomBottom);
      var beside = list.filter(function (o) { return o !== b && o.x >= b.x + b.w - 0.5 && o.y < bottom && o.y + o.h > b.y - b.size * 0.5; });
      var edge = beside.length ? Math.min.apply(null, beside.map(function (o) { return o.x; })) - b.size : pageWidth * 0.96;
      b.roomRight = Math.max(b.x + b.w, Math.min(edge, b.x + b.w * 1.6 + b.size * 4));
      var left = list.filter(function (o) { return o !== b && o.x + o.w <= b.x + 0.5 && o.y < bottom && o.y + o.h > b.y - b.size * 0.5; });
      b.roomLeft = Math.min(b.x, left.length ? Math.max.apply(null, left.map(function (o) { return o.x + o.w; })) + b.size : pageWidth * 0.04);
    });
  }

  function fontOf(b, px, bold) {
    return (b.italic ? 'italic ' : '') + (bold || b.bold ? 'bold ' : '') + px + 'px ' + (FAMILY[b.font] || '"' + b.font + '", Arial, sans-serif');
  }
  function wrap(ctx, text, width, cut) {
    var rows = [], row = '';
    text.split(/\s+/).forEach(function (word) {
      var next = row ? row + ' ' + word : word;
      if (!row || ctx.measureText(next).width <= width) row = next;
      else { rows.push(row); row = word; }
      // A word wider than the column (a long URL) is cut so it stays inside.
      while (cut && ctx.measureText(row).width > width && row.length > 1 && row.indexOf(' ') < 0) {
        var cut = row.length - 1;
        while (cut > 1 && ctx.measureText(row.slice(0, cut)).width > width) cut--;
        rows.push(row.slice(0, cut)); row = row.slice(cut);
      }
    });
    if (row) rows.push(row);
    return rows;
  }

  // The translated page: blocks drawn on the text-free background.
  // Returns the canvas and, for reading aloud, what each block now says with
  // the box it fills: said = [[x, y, w, h, text]] in fractions of the page.
  function draw(layout, image, items) {
    var said = [], rowsOut = [], rowText = [];
    var U = function (v) { return Math.round(Math.max(0, Math.min(1, v)) * 10000); };
    var canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    var k = image.width / layout.width;
    items.forEach(function (item) {
      var b = item.block, text = item.text;
      // Centred blocks may widen evenly on both sides (up to 70% of the page);
      // one-line left-aligned blocks into the empty room on their right.
      // ...but never past the blocks beside them (the next column).
      var mid = b.x + b.w / 2, roomLeft = b.roomLeft != null ? b.roomLeft : 0, roomRight = b.roomRight != null ? b.roomRight : layout.width;
      var width = Math.max((b.x + b.w - b.textX) * 1.02,
        b.center ? Math.min(layout.width * 0.7, Math.min(mid - roomLeft, roomRight - mid) * 2)
          : b.right ? Math.min(b.w * 1.3, b.x + b.w - roomLeft) : b.lines.length === 1 ? roomRight - b.textX : 0);
      var room = b.roomBottom - b.y, size = b.size, rows = [], step = b.step;
      var widest = function () { return Math.max.apply(null, rows.map(function (r) { return ctx.measureText(r).width; })); };
      var fits = function () { return rows.length * step - (step - size) <= room * 1.02 && widest() <= width * k * 1.01; };
      var at = function (s) { size = s; ctx.font = fontOf(b, size * k); rows = wrap(ctx, text, width * k); step = b.step * (size / b.size); };
      // First keep the block's own number of lines with slightly smaller type
      // (a one-line heading stays one line); otherwise wrap, and longer
      // translations get smaller type (down to half) rather than spilling
      // over the block below or out of the column.
      var kept = false;
      for (var s1 = b.size; s1 >= b.size * 0.8; s1 *= 0.96) { at(s1); if (rows.length <= b.lines.length && fits()) { kept = true; break; } }
      if (!kept) for (var tries = 0; tries < 20; tries++) { at(tries ? size * 0.96 : b.size); if (fits() || size <= b.size * 0.5) break; }
      if (widest() > width * k * 1.01) rows = wrap(ctx, text, width * k, true);   // a word still too wide: cut it
      ctx.fillStyle = '#' + (b.color || '000000');
      ctx.textBaseline = 'alphabetic';
      var top = b.y + b.ascent * (size / b.size);
      if (b.bullet) ctx.fillText(b.bullet, b.x * k, top * k);
      var label = b.label && /^[^:]{1,40}:/.exec(text);
      rows.forEach(function (row, i) {
        var x = b.textX * k, y = (top + i * step) * k;
        if (b.center) x = (b.x + b.w / 2) * k - ctx.measureText(row).width / 2;
        else if (b.right) x = (b.x + b.w) * k - ctx.measureText(row).width;
        // Where each word of this row lands (PdfWords lines: [y, h, x0, w0, ...]
        // in 1/10000 of the page), so the highlighter snaps to the translation.
        var line = [U((top + i * step - size * 0.82) / layout.height), Math.max(1, U(size * 1.05 / layout.height))], words = [];
        var re = /\S+/g, m;
        while ((m = re.exec(row)) && line.length < 600) {
          var x0 = x + ctx.measureText(row.slice(0, m.index)).width, w = ctx.measureText(m[0]).width;
          line.push(U(x0 / k / layout.width), Math.max(1, U(w / k / layout.width))); words.push(m[0]);
        }
        if (words.length) { rowsOut.push(line); rowText.push(words.join(' ')); }
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
      var left = b.center ? (b.x + b.w / 2) - width / 2 : b.right ? b.x + b.w - width : b.x, used = Math.max(size * 1.2, rows.length * step);
      var r = function (v) { return Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000; };
      said.push([r(left / layout.width), r(b.y / layout.height), r((b.center ? width : Math.max(b.w, width - (b.textX - b.x))) / layout.width), r(used / layout.height), text]);
    });
    canvas.said = said;
    canvas.words = {lines: rowsOut, text: rowText, ratio: layout.width / layout.height};
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
    var onPage = options.onPage || function () {};          // (index, Blob) as soon as a page is drawn
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
        done[page.index] = await toBlob(canvas); onPage(page.index, done[page.index], canvas.said, canvas.words);
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
      done[page.index] = await toBlob(canvas); onPage(page.index, done[page.index], canvas.said, canvas.words);
      canvas.width = canvas.height = 0;
      finished++;
      progress('draw', finished, total);
    }
  }

  root.PdfTranslate = {book: book, blocks: blocks, rooms: rooms, BATCH_BLOCKS: BATCH_BLOCKS};
})(typeof window !== 'undefined' ? window : globalThis);
