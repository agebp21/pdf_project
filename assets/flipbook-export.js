'use strict';
(() => {
  /* ── v1 legacy: stat overlay positions ────────────────── */
  const positions = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

  /* ── Element schema validators ───────────────────────── */
  const ANIM_TYPES = new Set(['none','fadeIn','slideUp','slideDown','slideLeft','slideRight','zoomIn','bounce','pulse']);
  const EL_TYPES   = new Set(['text','hotspot']);
  const LINK_TYPES = new Set(['url','page']);

  function validateElement(el, pageCount) {
    if (!el || typeof el !== 'object') throw Error('Invalid element object.');
    if (!EL_TYPES.has(el.type)) throw Error('Unknown element type: ' + el.type);
    for (const coord of ['x','y','w','h']) {
      if (!Number.isFinite(el[coord]) || el[coord] < 0 || el[coord] > 100) throw Error('Element coordinate out of range: ' + coord);
    }
    const rotation = Number.isFinite(el.rotation) ? el.rotation % 360 : 0;
    const content  = typeof el.content === 'string' ? el.content.slice(0, 2000) : '';
    const style = el.style && typeof el.style === 'object' ? {
      fontSize: Math.max(4, Math.min(300, Number(el.style.fontSize) || 18)),
      color:    typeof el.style.color   === 'string' ? el.style.color.slice(0, 32)  : '#1a1a1a',
      bgColor:  typeof el.style.bgColor === 'string' ? el.style.bgColor.slice(0, 32): '',
      bold:     !!el.style.bold,
      italic:   !!el.style.italic,
      align:    ['left','center','right'].includes(el.style.align) ? el.style.align : 'left',
      opacity:  Math.max(0, Math.min(1, Number.isFinite(el.style.opacity) ? el.style.opacity : 1)),
    } : { fontSize: 18, color: '#1a1a1a', bgColor: '', bold: false, italic: false, align: 'left', opacity: 1 };
    const anim = el.animation && typeof el.animation === 'object' ? {
      type:     ANIM_TYPES.has(el.animation.type) ? el.animation.type : 'none',
      delay:    Math.max(0, Math.min(10000, Number(el.animation.delay) || 0)),
      duration: Math.max(50, Math.min(10000, Number(el.animation.duration) || 600)),
    } : { type: 'none', delay: 0, duration: 600 };
    let link = null;
    if (el.link && typeof el.link === 'object' && LINK_TYPES.has(el.link.type)) {
      if (el.link.type === 'url')  link = { type: 'url',  target: String(el.link.target || '').slice(0, 2048) };
      if (el.link.type === 'page') link = { type: 'page', target: Math.max(1, Math.min(pageCount, Number(el.link.target) || 1)) };
    }
    const id = typeof el.id === 'string' && el.id.length < 64 ? el.id : ('el-' + Math.random().toString(36).slice(2));
    return { id, type: el.type, x: el.x, y: el.y, w: el.w, h: el.h, rotation, content, style, animation: anim, link };
  }

  function validatePages(pages, pageCount) {
    if (!pages || typeof pages !== 'object' || Array.isArray(pages)) return {};
    const out = {};
    for (const [key, val] of Object.entries(pages)) {
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= pageCount) continue;
      if (!val || typeof val !== 'object' || !Array.isArray(val.elements)) continue;
      const els = val.elements.map(e => validateElement(e, pageCount)).filter(Boolean);
      if (els.length) out[key] = { elements: els };
    }
    return out;
  }

  /* ── v1 legacy overlay validator ─────────────────────── */
  function validateOverlays(overlays, pageCount) {
    if (!overlays || typeof overlays !== 'object' || Array.isArray(overlays)) return {};
    const out = {};
    for (const [key, config] of Object.entries(overlays)) {
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= pageCount) throw Error('Overlay page index out of range: ' + key);
      if (!config || typeof config.label !== 'string' || !Number.isFinite(config.value) || config.value < 0 || config.value > 999999 || !positions.has(config.position)) throw Error('Invalid overlay config for page ' + key);
      out[key] = { label: config.label.slice(0, 40), value: config.value, position: config.position };
    }
    return out;
  }

  /* ── Main validate (accepts v1 and v2) ───────────────── */
  function validate(data) {
    if (!data || typeof data.title !== 'string' || !Number.isInteger(data.pageCount) || data.pageCount < 1 || !Number.isFinite(data.ratio) || data.ratio <= 0) {
      throw Error('Invalid or unsupported project format.');
    }
    const version = data.version === 2 ? 2 : 1;
    const title     = data.title.slice(0, 200);
    const pageCount = data.pageCount;
    const ratio     = data.ratio;
    const overlays  = validateOverlays(data.overlays || {}, pageCount);
    const pages     = version === 2 ? validatePages(data.pages || {}, pageCount) : {};

    return { version, title, pageCount, ratio, overlays, pages };
  }

  /* ── JSON bootstrap script for exported HTML ─────────── */
  const scriptData = data => {
    const safe = JSON.stringify(validate(data))
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    return 'window.FLIPBOOK_DATA = ' + safe + ';\n';
  };

  /* ── Fetch text asset ────────────────────────────────── */
  async function asset(path) {
    const response = await fetch(path);
    if (!response.ok) throw Error('Export asset unavailable: ' + path);
    return response.text();
  }

  /* ── Package book as ZIP ─────────────────────────────── */
  async function packageBook(model, imageUrls, onProgress = () => {}) {
    const data = validate(model);
    if (imageUrls.length !== data.pageCount) throw Error('Image count does not match page count.');
    const zip = new JSZip();
    // Core viewer files
    for (const name of ['index.html', 'viewer.css', 'book-effects.css', 'layout.js', 'viewer.js']) {
      zip.file(name, await asset('assets/export/' + name));
    }
    // Editor CSS for element rendering in viewer
    zip.file('editor.css', await asset('assets/editor.css'));
    zip.file('page-flip.browser.js', await asset('assets/vendor/page-flip.browser.js'));
    zip.file('ENGINE-SOURCE.md',    await asset('assets/vendor/SOURCE.md'));
    zip.file('PAGEFLIP-LICENSE.txt', await asset('assets/vendor/PAGEFLIP-LICENSE.txt'));
    zip.file('book.json',     JSON.stringify(data, null, 2));
    zip.file('book-data.js',  scriptData(data));
    zip.file('BUKA-BUKU.txt', 'Extract the full ZIP, then open index.html in a browser. No internet or server required. Do not move index.html without the other files.\n');
    for (let i = 0; i < imageUrls.length; i++) {
      onProgress(`Packaging page ${i + 1} / ${imageUrls.length}…`);
      const response = await fetch(imageUrls[i]);
      if (!response.ok) throw Error('Page image could not be read.');
      zip.file(`pages/${i + 1}.jpg`, await response.arrayBuffer());
    }
    return zip.generateAsync({ type: 'blob', compression: 'STORE' }, meta => onProgress(`Creating ZIP ${Math.round(meta.percent)}%…`));
  }

  /* ── Save project as .flipbook (ZIP) ─────────────────── */
  async function saveProject(model, sourcePdf) {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(validate(model), null, 2));
    zip.file('source.pdf', await sourcePdf.arrayBuffer());
    return zip.generateAsync({ type: 'blob', compression: 'STORE' });
  }

  /* ── Read project from .flipbook file ────────────────── */
  async function readProject(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    if (!zip.file('project.json') || !zip.file('source.pdf')) throw Error('Select a .flipbook project file, not an exported HTML ZIP.');
    const data = validate(JSON.parse(await zip.file('project.json').async('string')));
    return { data, pdf: new Blob([await zip.file('source.pdf').async('arraybuffer')], { type: 'application/pdf' }) };
  }

  /* ── Download helpers ────────────────────────────────── */
  function download(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function chooseSave(name) {
    if (typeof globalThis.showSaveFilePicker !== 'function') return null;
    const extension = '.' + name.split('.').pop();
    return globalThis.showSaveFilePicker({ id: 'flipbook-export', suggestedName: name, types: [{ description: 'Flipbook file', accept: { 'application/octet-stream': [extension] } }] });
  }
  async function saveBlob(blob, name, handle) {
    if (!handle) { download(blob, name); return false; }
    const writable = await handle.createWritable();
    try { await writable.write(blob); await writable.close(); }
    catch (cause) { await writable.abort().catch(() => {}); throw cause; }
    return true;
  }
  async function saveRemote(url, name) {
    const handle = await chooseSave(name);
    if (!handle) {
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); return false;
    }
    const response = await fetch(url); if (!response.ok) throw Error('Build result file unavailable.');
    const writable = await handle.createWritable();
    try {
      if (response.body) await response.body.pipeTo(writable);
      else { await writable.write(await response.blob()); await writable.close(); }
    } catch (cause) { await writable.abort().catch(() => {}); throw cause; }
    return true;
  }

  const filename = title => (title.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'flipbook');

  globalThis.FlipbookExport = { validate, scriptData, packageBook, saveProject, readProject, download, filename, chooseSave, saveBlob, saveRemote };
})();
