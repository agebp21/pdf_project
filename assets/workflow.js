'use strict';
// Workflow engine: run a saved list of PDF steps over the uploaded files.
// Every step takes PDF bytes and returns PDF bytes, entirely in the browser
// (pdf-lib + PDFEdit). The uploaded PDFs are merged in order first.
(() => {
  // Text in the site's language (English without i18n.js, e.g. in the tests); getters so a
  // language switch shows straight away.
  const T = (en, id) => globalThis.I18N ? globalThis.I18N.pick(en, id) : en;
  const positions = ['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'];
  const range = placeholder => ({key: 'range', get label() { return T('Pages', 'Halaman'); }, type: 'text',
    get placeholder() { return placeholder ? T(...placeholder) : T('all or 1-3,5', 'semua atau 1-3,5'); }});
  const size = {key: 'size', get label() { return T('Size (pt)', 'Ukuran (pt)'); }, type: 'number', min: 1};
  const position = {key: 'position', get label() { return T('Position', 'Posisi'); }, type: 'select', options: positions};
  const color = {key: 'color', get label() { return T('Color', 'Warna'); }, type: 'color'};
  const SIDES = {top: ['Top', 'Atas'], right: ['Right', 'Kanan'], bottom: ['Bottom', 'Bawah'], left: ['Left', 'Kiri']};
  const STEPS = {
    rotate: {get title() { return T('Rotate pages', 'Putar halaman'); }, icon: '↻', get desc() { return T('Turn pages by 90°, 180° or 270°.', 'Putar halaman 90°, 180°, atau 270°.'); },
      fields: [{key: 'angle', get label() { return T('Angle', 'Sudut'); }, type: 'select', options: ['90', '180', '270']}, range()],
      defaults: {angle: '90', range: 'all'}},
    keep: {get title() { return T('Keep pages', 'Ambil halaman'); }, icon: '✂', get desc() { return T('Keep only these pages, drop the rest.', 'Simpan hanya halaman ini, sisanya dibuang.'); },
      fields: [range(['e.g. 1-3,5', 'mis. 1-3,5'])], defaults: {range: '1-3'}},
    remove: {get title() { return T('Remove pages', 'Hapus halaman'); }, icon: '🗑', get desc() { return T('Delete these pages.', 'Hapus halaman ini.'); },
      fields: [range(['e.g. 2,4', 'mis. 2,4'])], defaults: {range: '1'}},
    watermark: {get title() { return T('Text watermark', 'Watermark teks'); }, icon: 'WM', get desc() { return T('Stamp text such as CONFIDENTIAL on pages.', 'Cap teks seperti RAHASIA di halaman.'); },
      fields: [{key: 'text', get label() { return T('Text', 'Teks'); }, type: 'text'}, size,
        {key: 'opacity', get label() { return T('Opacity (%)', 'Transparansi (%)'); }, type: 'number', min: 0, max: 100}, position, color, range()],
      defaults: {text: 'CONFIDENTIAL', size: '40', opacity: '20', position: 'center', color: '#b91c1c', margin: '10', range: 'all'}},
    'page-numbers': {get title() { return T('Page numbers', 'Nomor halaman'); }, icon: '1 2', get desc() { return T('Number the pages.', 'Beri nomor pada halaman.'); },
      fields: [{key: 'start', get label() { return T('Start at', 'Mulai dari'); }, type: 'number', min: 0}, size, position, color, range()],
      defaults: {start: '1', size: '11', position: 'bottom-center', color: '#1c1917', margin: '10', range: 'all'}},
    crop: {get title() { return T('Crop margins', 'Potong tepi'); }, icon: '⌗', get desc() { return T('Trim page edges (mm).', 'Pangkas tepi halaman (mm).'); },
      fields: Object.keys(SIDES).map(side => ({key: side, get label() { return T(...SIDES[side]) + ' (mm)'; }, type: 'number', min: 0})).concat([range()]),
      defaults: {top: '10', right: '10', bottom: '10', left: '10', range: 'all'}},
    compress: {get title() { return T('Compress', 'Kompres'); }, icon: '⇲', get desc() { return T('Resize and re-encode photos/scans; text stays sharp.', 'Perkecil foto/hasil scan; teks tetap tajam.'); },
      fields: [{key: 'level', get label() { return T('Level', 'Tingkat'); }, type: 'select', options: ['low', 'medium', 'high']}], defaults: {level: 'medium'}},
  };
  const TEMPLATES = [
    {get name() { return T('Ready to send', 'Siap kirim'); }, steps: [{type: 'page-numbers'}, {type: 'watermark', options: {text: 'CONFIDENTIAL', opacity: '12'}}, {type: 'compress'}]},
    {get name() { return T('Draft for review', 'Draf untuk ditinjau'); }, steps: [{type: 'watermark', options: {text: 'DRAFT', size: '72', opacity: '15'}}, {type: 'page-numbers', options: {position: 'bottom-right'}}]},
    {get name() { return T('Scanned pages tidy-up', 'Rapikan hasil scan'); }, steps: [{type: 'rotate', options: {angle: '90'}}, {type: 'crop', options: {top: '5', right: '5', bottom: '5', left: '5'}}, {type: 'compress'}]},
  ];
  const lib = () => { if (!globalThis.PDFLib) throw Error(T('PDF engine is unavailable. Reload the page.', 'Mesin PDF tidak tersedia. Muat ulang halaman.')); return globalThis.PDFLib; };
  const edit = () => { if (!globalThis.PDFEdit) throw Error(T('PDF editing module is unavailable. Reload the page.', 'Modul edit PDF tidak tersedia. Muat ulang halaman.')); return globalThis.PDFEdit; };
  // A step with every option filled in (defaults for anything missing).
  function normalize(step) {
    const spec = STEPS[step && step.type];
    if (!spec) throw Error('Unknown workflow step: ' + (step && step.type));
    const options = {};
    for (const key of Object.keys(spec.defaults)) {
      const value = step.options && step.options[key];
      options[key] = value === undefined || value === null ? spec.defaults[key] : String(value);
    }
    return {type: step.type, options};
  }
  async function merge(inputs, progress) {
    const {PDFDocument} = lib();
    if (!inputs.length) throw Error(T('Add at least one PDF.', 'Tambahkan minimal satu PDF.'));
    const out = await PDFDocument.create();
    for (let i = 0; i < inputs.length; i++) {
      progress(T('Reading ', 'Membaca ') + inputs[i].name + '…');
      let doc;
      try { doc = await PDFDocument.load(inputs[i].bytes); }
      catch (cause) { throw Error(inputs[i].name + T(' could not be read (damaged or password-protected).', ' tidak bisa dibaca (rusak atau dikunci kata sandi).')); }
      if (!doc.getPageCount()) throw Error(inputs[i].name + T(' has no pages.', ' tidak punya halaman.'));
      (await out.copyPages(doc, doc.getPageIndices())).forEach(page => out.addPage(page));
    }
    return out.save();
  }
  async function pages(bytes, keepIndexes) {
    const {PDFDocument} = lib();
    const source = await PDFDocument.load(bytes), out = await PDFDocument.create();
    (await out.copyPages(source, keepIndexes)).forEach(page => out.addPage(page));
    return out.save();
  }
  async function runStep(bytes, step, progress) {
    const o = step.options, PDF = lib();
    if (step.type === 'rotate') {
      const doc = await PDF.PDFDocument.load(bytes);
      for (const i of edit().selection(o.range, doc.getPageCount())) {
        const page = doc.getPage(i);
        page.setRotation(PDF.degrees((page.getRotation().angle + Number(o.angle)) % 360));
      }
      return doc.save();
    }
    if (step.type === 'keep' || step.type === 'remove') {
      const count = (await PDF.PDFDocument.load(bytes)).getPageCount();
      const chosen = edit().selection(o.range, count);
      const keep = step.type === 'keep' ? chosen : Array.from({length: count}, (_, i) => i).filter(i => chosen.indexOf(i) < 0);
      if (!keep.length) throw Error(T('This step would remove every page.', 'Langkah ini akan menghapus semua halaman.'));
      return pages(bytes, keep);
    }
    if (step.type === 'watermark') return edit().apply(bytes, Object.assign({tool: 'watermark', mode: 'text'}, o), progress);
    if (step.type === 'page-numbers') return edit().apply(bytes, Object.assign({tool: 'page-numbers'}, o), progress);
    if (step.type === 'crop') return edit().apply(bytes, Object.assign({tool: 'crop-pdf'}, o), progress);
    if (step.type === 'compress') {
      if (globalThis.PDFCompress) return (await globalThis.PDFCompress.compress(bytes, o.level, {onProgress: progress})).bytes;
      return (await PDF.PDFDocument.load(bytes)).save({useObjectStreams: true});
    }
    throw Error('Unknown workflow step: ' + step.type);
  }
  /* inputs: [{name, bytes}]; steps: [{type, options}];
     onProgress({step, total, message}) — step 0 = merging the inputs. */
  async function run(inputs, steps, onProgress = () => {}) {
    const list = steps.map(normalize), total = list.length;
    let bytes = await merge(inputs, message => onProgress({step: 0, total, message}));
    for (let i = 0; i < list.length; i++) {
      const title = STEPS[list[i].type].title;
      onProgress({step: i + 1, total, message: title + '…'});
      try { bytes = await runStep(bytes, list[i], message => onProgress({step: i + 1, total, message: title + ': ' + message})); }
      catch (cause) { throw Error(T('Step ', 'Langkah ') + (i + 1) + ' (' + title + '): ' + cause.message); }
    }
    return bytes;
  }
  // Saved recipes live in this browser only.
  const KEY = 'mf-workflows';
  const recipes = {
    load() {
      try {
        const list = JSON.parse(localStorage.getItem(KEY) || '[]');
        return Array.isArray(list) ? list.filter(r => r && typeof r.name === 'string' && Array.isArray(r.steps)) : [];
      } catch (e) { return []; }
    },
    save(name, steps) {
      const clean = String(name || '').trim().slice(0, 60);
      if (!clean) throw Error(T('Give the workflow a name.', 'Beri nama workflow ini.'));
      if (!steps.length) throw Error(T('Add at least one step.', 'Tambahkan minimal satu langkah.'));
      const list = recipes.load().filter(r => r.name.toLowerCase() !== clean.toLowerCase());
      list.unshift({name: clean, steps: steps.map(normalize), updated: Date.now()});
      try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50))); }
      catch (e) { throw Error(T('This browser could not save the workflow.', 'Browser ini tidak bisa menyimpan workflow.')); }
      return list;
    },
    remove(name) {
      const list = recipes.load().filter(r => r.name !== name);
      try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
      return list;
    },
  };
  globalThis.Workflow = {STEPS, TEMPLATES, normalize, run, recipes};
})();
