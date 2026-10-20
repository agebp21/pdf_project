'use strict';
// Real PDF compression in the browser. Photos and scans inside the PDF are
// scaled down and re-encoded as JPEG; text and vector drawings are left
// alone (they stay sharp). An image is replaced only when the new version is
// smaller, then the file is saved with compact object streams.
(() => {
  const LEVELS = {
    low: {maxSide: 2400, quality: 0.85, label: 'Light'},
    medium: {maxSide: 1700, quality: 0.72, label: 'Balanced'},
    high: {maxSide: 1150, quality: 0.58, label: 'Strong'},
  };
  const MAX_PIXELS = 40e6;   // bigger images are left as they are (memory)
  // compressTo's settings, best quality first: it looks for the first one under the target size.
  const LADDER = [
    {maxSide: 2400, quality: 0.85}, {maxSide: 1700, quality: 0.72}, {maxSide: 1400, quality: 0.62}, {maxSide: 1150, quality: 0.55},
    {maxSide: 1000, quality: 0.48}, {maxSide: 850, quality: 0.42}, {maxSide: 700, quality: 0.36}, {maxSide: 560, quality: 0.3},
  ];

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') throw Error('no DecompressionStream');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  // Undo PNG row predictors (DecodeParms /Predictor 10-15).
  function unpredict(data, width, height, components) {
    const row = width * components, out = new Uint8Array(row * height);
    for (let y = 0; y < height; y++) {
      const type = data[y * (row + 1)], src = y * (row + 1) + 1, dst = y * row;
      for (let x = 0; x < row; x++) {
        const raw = data[src + x], left = x >= components ? out[dst + x - components] : 0;
        const up = y ? out[dst - row + x] : 0, upLeft = y && x >= components ? out[dst - row + x - components] : 0;
        let value;
        if (type === 0) value = raw;
        else if (type === 1) value = raw + left;
        else if (type === 2) value = raw + up;
        else if (type === 3) value = raw + ((left + up) >> 1);
        else if (type === 4) { const p = left + up - upLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft); value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft); }
        else throw Error('bad predictor');
        out[dst + x] = value & 255;
      }
    }
    return out;
  }
  // Browser re-encoder: decode (JPEG bytes or raw pixels), scale, encode JPEG.
  async function canvasRecode(image, level) {
    let source, width = image.width, height = image.height;
    if (image.kind === 'jpeg') source = await createImageBitmap(new Blob([image.bytes], {type: 'image/jpeg'}));
    else {
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0, j = 0; i < width * height; i++, j += image.components) {
        rgba[i * 4] = image.bytes[j]; rgba[i * 4 + 1] = image.bytes[j + (image.components === 3 ? 1 : 0)];
        rgba[i * 4 + 2] = image.bytes[j + (image.components === 3 ? 2 : 0)]; rgba[i * 4 + 3] = 255;
      }
      source = await createImageBitmap(new ImageData(rgba, width, height));
    }
    const scale = Math.min(1, level.maxSide / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), {width: w, height: h});
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, w, h);
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, w, h);
    if (source.close) source.close();
    const blob = canvas.convertToBlob ? await canvas.convertToBlob({type: 'image/jpeg', quality: level.quality})
      : await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', level.quality));
    return {bytes: new Uint8Array(await blob.arrayBuffer()), width: w, height: h};
  }

  /* compress(bytes, levelName, {onProgress(message, fraction), recode, level}) →
     {bytes, stats: {images, recoded, skipped, before, after}}; options.level ({maxSide, quality}) overrides the name. */
  async function compress(input, levelName = 'medium', options = {}) {
    const lib = globalThis.PDFLib;
    if (!lib) throw Error('PDF engine is unavailable. Reload the page.');
    const level = options.level || LEVELS[levelName] || LEVELS.medium;
    const recode = options.recode || canvasRecode, progress = options.onProgress || (() => {});
    const {PDFName, PDFRawStream, PDFArray, PDFNumber, PDFDict, PDFRef} = lib;
    const before = input.byteLength;
    let doc;
    try { doc = await lib.PDFDocument.load(input); }
    catch (cause) { throw Error('This PDF could not be read (damaged or password-protected).'); }
    const context = doc.context, N = name => PDFName.of(name);
    const objects = context.enumerateIndirectObjects();
    // Images used as soft masks (transparency) keep their exact pixels.
    const masks = new Set();
    for (const [, object] of objects) {
      if (object instanceof PDFRawStream) {
        const mask = object.dict.get(N('SMask'));
        if (mask instanceof PDFRef) masks.add(mask.toString());
      }
    }
    const images = objects.filter(([ref, object]) => object instanceof PDFRawStream && object.dict.get(N('Subtype')) === N('Image') && !masks.has(ref.toString()));
    const stats = {images: images.length, recoded: 0, skipped: 0, before, after: before};
    const components = dict => {
      let space = dict.lookup(N('ColorSpace'));
      if (space === N('DeviceRGB')) return 3;
      if (space === N('DeviceGray')) return 1;
      if (space instanceof PDFArray && space.lookup(0) === N('ICCBased')) {
        const profile = space.lookup(1);
        const n = profile && profile.dict && profile.dict.lookup(N('N'));
        if (n instanceof PDFNumber && (n.asNumber() === 3 || n.asNumber() === 1)) return n.asNumber();
      }
      return 0;
    };
    for (let i = 0; i < images.length; i++) {
      const [ref, stream] = images[i], dict = stream.dict;
      progress('Compressing image ' + (i + 1) + ' / ' + images.length + '…', images.length ? i / images.length : 1);
      try {
        const width = dict.lookup(N('Width'), PDFNumber).asNumber(), height = dict.lookup(N('Height'), PDFNumber).asNumber();
        let filter = dict.lookup(N('Filter'));
        if (filter instanceof PDFArray) filter = filter.size() === 1 ? filter.lookup(0) : null;
        const bits = dict.lookup(N('BitsPerComponent'));
        const channels = components(dict);
        if (!channels || dict.get(N('ImageMask')) || dict.get(N('Mask')) || dict.get(N('Decode')) || width * height > MAX_PIXELS || width < 16 || height < 16) { stats.skipped++; continue; }
        let image;
        if (filter === N('DCTDecode')) image = {kind: 'jpeg', bytes: stream.contents, width, height, components: channels};
        else if (filter === N('FlateDecode') && bits instanceof PDFNumber && bits.asNumber() === 8) {
          let pixels = await inflate(stream.contents);
          let parms = dict.lookup(N('DecodeParms'));
          if (parms instanceof PDFArray) parms = parms.lookup(0);
          const predictor = parms instanceof PDFDict && parms.lookup(N('Predictor'));
          const p = predictor instanceof PDFNumber ? predictor.asNumber() : 1;
          if (p >= 10) pixels = unpredict(pixels, width, height, channels);
          else if (p !== 1) { stats.skipped++; continue; }
          if (pixels.length < width * height * channels) { stats.skipped++; continue; }
          image = {kind: 'raw', bytes: pixels, width, height, components: channels};
        } else { stats.skipped++; continue; }
        const result = await recode(image, level);
        if (!result || result.bytes.length >= stream.contents.length * 0.95) { stats.skipped++; continue; }
        const entries = {Type: 'XObject', Subtype: 'Image', Width: result.width, Height: result.height,
          ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode'};
        const replaced = context.stream(result.bytes, entries);
        for (const key of ['SMask', 'Interpolate', 'Intent', 'OC']) { const value = dict.get(N(key)); if (value) replaced.dict.set(N(key), value); }
        context.assign(ref, replaced);
        stats.recoded++;
      } catch (cause) { stats.skipped++; }
      if (i % 4 === 3) await new Promise(resolve => setTimeout(resolve, 0));
    }
    progress('Saving…', 1);
    const bytes = await doc.save({useObjectStreams: true});
    // Never hand back a bigger file than the original.
    if (bytes.byteLength >= before) return {bytes: new Uint8Array(input), stats: Object.assign(stats, {after: before, unchanged: true})};
    stats.after = bytes.byteLength;
    return {bytes, stats};
  }
  /* compressTo(bytes, targetBytes, {onProgress(message, fraction), recode}) →
     {bytes, stats, reached, step}: the best-quality LADDER step whose file fits the target
     (binary search: a few passes, each from the original), else the smallest one tried. */
  async function compressTo(input, target, options = {}) {
    const progress = options.onProgress || (() => {});
    const original = new Uint8Array(input);
    if (original.byteLength <= target) return {bytes: original, stats: {before: original.byteLength, after: original.byteLength, unchanged: true}, reached: true, step: -1};
    const tried = new Map();
    let pass = 0;
    const attempt = async step => {
      if (!tried.has(step)) {
        pass++;
        const result = await compress(original.slice(), '', Object.assign({}, options, {level: LADDER[step],
          onProgress: (message, fraction) => progress(message, Math.min(0.98, (pass - 1 + (fraction || 0)) / 4))}));
        tried.set(step, result);
      }
      return tried.get(step);
    };
    let low = 0, high = LADDER.length - 1, best = null;
    if ((await attempt(high)).bytes.byteLength > target) {
      return Object.assign({}, tried.get(high), {reached: false, step: high});      // even the strongest is too big
    }
    best = high;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((await attempt(middle)).bytes.byteLength <= target) { best = middle; high = middle; }
      else low = middle + 1;
    }
    progress('Done', 1);
    return Object.assign({}, tried.get(best), {reached: true, step: best});
  }
  globalThis.PDFCompress = {LEVELS, LADDER, compress, compressTo, unpredict};
})();
