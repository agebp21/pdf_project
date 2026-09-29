'use strict';
// Workflow engine: run a saved list of PDF steps over the uploaded files.
// Every step takes PDF bytes and returns PDF bytes, entirely in the browser
// (pdf-lib + PDFEdit). The uploaded PDFs are merged in order first.
(() => {
  const positions = ['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'];
  const range = {key: 'range', label: 'Pages', type: 'text', placeholder: 'all or 1-3,5'};
  const STEPS = {
    rotate: {title: 'Rotate pages', icon: '↻', desc: 'Turn pages by 90°, 180° or 270°.',
      fields: [{key: 'angle', label: 'Angle', type: 'select', options: ['90', '180', '270']}, range],
      defaults: {angle: '90', range: 'all'}},
    keep: {title: 'Keep pages', icon: '✂', desc: 'Keep only these pages, drop the rest.',
      fields: [Object.assign({}, range, {placeholder: 'e.g. 1-3,5'})], defaults: {range: '1-3'}},
    remove: {title: 'Remove pages', icon: '🗑', desc: 'Delete these pages.',
      fields: [Object.assign({}, range, {placeholder: 'e.g. 2,4'})], defaults: {range: '1'}},
    watermark: {title: 'Text watermark', icon: 'WM', desc: 'Stamp text such as CONFIDENTIAL on pages.',
      fields: [{key: 'text', label: 'Text', type: 'text'}, {key: 'size', label: 'Size (pt)', type: 'number', min: 1},
        {key: 'opacity', label: 'Opacity (%)', type: 'number', min: 0, max: 100}, {key: 'position', label: 'Position', type: 'select', options: positions},
        {key: 'color', label: 'Color', type: 'color'}, range],
      defaults: {text: 'CONFIDENTIAL', size: '40', opacity: '20', position: 'center', color: '#b91c1c', margin: '10', range: 'all'}},
    'page-numbers': {title: 'Page numbers', icon: '1 2', desc: 'Number the pages.',
      fields: [{key: 'start', label: 'Start at', type: 'number', min: 0}, {key: 'size', label: 'Size (pt)', type: 'number', min: 1},
        {key: 'position', label: 'Position', type: 'select', options: positions}, {key: 'color', label: 'Color', type: 'color'}, range],
      defaults: {start: '1', size: '11', position: 'bottom-center', color: '#1c1917', margin: '10', range: 'all'}},
    crop: {title: 'Crop margins', icon: '⌗', desc: 'Trim page edges (mm).',
      fields: ['top', 'right', 'bottom', 'left'].map(side => ({key: side, label: side[0].toUpperCase() + side.slice(1) + ' (mm)', type: 'number', min: 0})).concat([range]),
      defaults: {top: '10', right: '10', bottom: '10', left: '10', range: 'all'}},
    compress: {title: 'Optimize size', icon: '⇲', desc: 'Re-save compactly. Text PDFs shrink a little; image-heavy PDFs barely change.',
      fields: [], defaults: {}},
  };
  const TEMPLATES = [
    {name: 'Ready to send', steps: [{type: 'page-numbers'}, {type: 'watermark', options: {text: 'CONFIDENTIAL', opacity: '12'}}, {type: 'compress'}]},
    {name: 'Draft for review', steps: [{type: 'watermark', options: {text: 'DRAFT', size: '72', opacity: '15'}}, {type: 'page-numbers', options: {position: 'bottom-right'}}]},
    {name: 'Scanned pages tidy-up', steps: [{type: 'rotate', options: {angle: '90'}}, {type: 'crop', options: {top: '5', right: '5', bottom: '5', left: '5'}}, {type: 'compress'}]},
  ];
  const lib = () => { if (!globalThis.PDFLib) throw Error('PDF engine is unavailable. Reload the page.'); return globalThis.PDFLib; };
  const edit = () => { if (!globalThis.PDFEdit) throw Error('PDF editing module is unavailable. Reload the page.'); return globalThis.PDFEdit; };
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
    if (!inputs.length) throw Error('Add at least one PDF.');
    const out = await PDFDocument.create();
    for (let i = 0; i < inputs.length; i++) {
      progress('Reading ' + inputs[i].name + '…');
      let doc;
      try { doc = await PDFDocument.load(inputs[i].bytes); }
      catch (cause) { throw Error(inputs[i].name + ' could not be read (damaged or password-protected).'); }
      if (!doc.getPageCount()) throw Error(inputs[i].name + ' has no pages.');
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
      if (!keep.length) throw Error('This step would remove every page.');
      return pages(bytes, keep);
    }
    if (step.type === 'watermark') return edit().apply(bytes, Object.assign({tool: 'watermark', mode: 'text'}, o), progress);
    if (step.type === 'page-numbers') return edit().apply(bytes, Object.assign({tool: 'page-numbers'}, o), progress);
    if (step.type === 'crop') return edit().apply(bytes, Object.assign({tool: 'crop-pdf'}, o), progress);
    if (step.type === 'compress') return (await PDF.PDFDocument.load(bytes)).save({useObjectStreams: true});
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
      catch (cause) { throw Error('Step ' + (i + 1) + ' (' + title + '): ' + cause.message); }
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
      if (!clean) throw Error('Give the workflow a name.');
      if (!steps.length) throw Error('Add at least one step.');
      const list = recipes.load().filter(r => r.name.toLowerCase() !== clean.toLowerCase());
      list.unshift({name: clean, steps: steps.map(normalize), updated: Date.now()});
      try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50))); }
      catch (e) { throw Error('This browser could not save the workflow.'); }
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
