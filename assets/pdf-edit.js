'use strict';
(() => {
  const MM = 72 / 25.4;
  const positions = ['top-left','top-center','top-right','center','bottom-left','bottom-center','bottom-right'];
  function selection(range, count) {
    if (!range.trim() || /^(all|semua)$/i.test(range.trim())) return Array.from({length:count},(_,i)=>i);
    const pages = new Set();
    for (const part of range.split(',')) {
      const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) throw Error('Use page numbers such as 1-3,5 or all.');
      const a=Number(match[1]), b=Number(match[2]||a);
      if (!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<1||b<a||b>count) throw Error('Page range is outside this PDF or reversed.');
      for(let i=a;i<=b;i++)pages.add(i-1);
    }
    return [...pages].sort((a,b)=>a-b);
  }
  function geometry(page) {
    const {x,y,width:w,height:h}=page.getCropBox();
    const angle=((page.getRotation().angle%360)+360)%360;
    const transforms={0:[1,0,0,1,x,y],90:[0,1,-1,0,x+w,y],180:[-1,0,0,-1,x+w,y+h],270:[0,-1,1,0,x,y+h]};
    if(!transforms[angle])throw Error('Unsupported page rotation.');
    return {width:angle%180?h:w,height:angle%180?w:h,matrix:transforms[angle]};
  }
  function numeric(value, name, min=0) {
    const n=Number(value);
    if(value===''||!Number.isFinite(n)||n<min)throw Error(name+' must be a valid number of at least '+min+'.');
    return n;
  }
  function location(position, width, height, w, h, padding) {
    if(w+padding*2>width||h+padding*2>height)throw Error('The watermark/number does not fit. Reduce its size or margin.');
    const x=position.endsWith('left')?padding:position.endsWith('right')?width-padding-w:(width-w)/2;
    const y=position.startsWith('top')?height-padding-h:position.startsWith('bottom')?padding:(height-h)/2;
    return {x,y};
  }
  async function apply(input, opts, progress=()=>{}) {
    const lib=globalThis.PDFLib;
    if(!lib)throw Error('PDF engine is unavailable. Reload the page.');
    if(!['watermark','page-numbers','crop-pdf','edit-pdf'].includes(opts.tool))throw Error('Unknown PDF editing tool.');
    const doc=await lib.PDFDocument.load(input); // Do not silently bypass encrypted PDFs.
    if(opts.tool==='edit-pdf') return annotate(doc, opts, progress);
    const pages=selection(opts.range||'',doc.getPageCount());
    let font, image, size, opacity, margin, start, color, crop;
    if(opts.tool==='crop-pdf') {
      crop=['top','right','bottom','left'].map(k=>numeric(opts[k],k+' margin')*MM);
    } else {
      if(!positions.includes(opts.position))throw Error('Choose a valid position.');
      margin=numeric(opts.margin,'Margin')*MM;
      size=numeric(opts.size,'Size',.1);
      opacity=opts.tool==='watermark'?numeric(opts.opacity,'Opacity')/100:1;
      if(opacity>1)throw Error('Opacity must be between 0 and 100.');
      if(!/^#[0-9a-f]{6}$/i.test(opts.color||''))throw Error('Choose a valid color.');
      color=lib.rgb(...[1,3,5].map(i=>parseInt(opts.color.slice(i,i+2),16)/255));
      if(opts.tool==='watermark'&&opts.mode==='image') {
        const bytes=new Uint8Array(opts.image||[]);
        if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)image=await doc.embedPng(bytes);
        else if(bytes[0]===255&&bytes[1]===216)image=await doc.embedJpg(bytes);
        else throw Error('Choose a PNG or JPEG watermark image.');
      } else {
        if(opts.tool==='watermark'&&!String(opts.text||'').trim())throw Error('Enter watermark text.');
        font=await doc.embedFont(lib.StandardFonts.Helvetica);
        if(opts.tool==='page-numbers') {
          start=numeric(opts.start,'Starting number');
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(start+pages.length-1))throw Error('Starting number must be a whole number within the supported numeric range.');
        }
      }
    }
    for(let n=0;n<pages.length;n++) {
      const page=doc.getPage(pages[n]), g=geometry(page);
      if(crop) {
        const [top,right,bottom,left]=crop;
        if(left+right>=g.width||top+bottom>=g.height)throw Error('Crop margins remove the entire area on page '+(pages[n]+1)+'.');
        const [a,b,c,d,e,f]=g.matrix;
        const points=[[left,bottom],[g.width-right,bottom],[left,g.height-top],[g.width-right,g.height-top]].map(([u,v])=>[a*u+c*v+e,b*u+d*v+f]);
        const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
        page.setCropBox(Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));
      } else {
        let text,w,h;
        if(image){w=size*MM;h=w*image.height/image.width;}
        else {
          text=opts.tool==='page-numbers'?String(start+n):String(opts.text).trim();
          try { w=font.widthOfTextAtSize(text,size); }
          catch(e){throw Error('This text contains characters unavailable in the PDF font. Use a PNG watermark for this script.');}
          h=font.heightAtSize(size);
        }
        const point=location(opts.position,g.width,g.height,w,h,margin);
        page.pushOperators(lib.pushGraphicsState(),lib.concatTransformationMatrix(...g.matrix));
        if(image)page.drawImage(image,{...point,width:w,height:h,opacity});
        else {
          const descent=font.heightAtSize(size)-font.heightAtSize(size,{descender:false});
          page.drawText(text,{x:point.x,y:point.y+descent,size,font,color,opacity});
        }
        page.pushOperators(lib.popGraphicsState());
      }
      progress(`Processing page ${n+1} / ${pages.length}...`);
      if(n%20===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    return doc.save();
  }
  // --- Edit PDF: free annotations stacked in one run (text, image stamp,
  // rectangle, ellipse, line). Freehand drawing needs a visual canvas and
  // is not part of this options form.
  const editKinds = ['text','image','rect','ellipse','line'];
  const drafts = [];
  function checkElement(raw, index) {
    const el = Object.assign({}, raw);
    const at = 'Annotation ' + (index + 1) + ': ';
    if (!editKinds.includes(el.kind)) throw Error(at + 'pick text, image, rectangle, ellipse or line.');
    el.range = String(el.range ?? 'all');
    el.position = String(el.position || 'center');
    if (!positions.includes(el.position)) throw Error(at + 'pick a valid position.');
    el.margin = numeric(el.margin ?? 10, 'Margin');
    el.dx = Number(el.dx ?? 0); el.dy = Number(el.dy ?? 0);
    if (![el.dx, el.dy].every(Number.isFinite)) throw Error(at + 'offsets must be numbers.');
    el.rotation = Number(el.rotation ?? 0);
    if (!Number.isFinite(el.rotation)) throw Error(at + 'rotation must be a number.');
    el.opacity = (el.opacity === undefined || el.opacity === '') ? 100 : numeric(el.opacity, 'Opacity');
    if (el.opacity > 100) throw Error(at + 'opacity must be between 0 and 100.');
    el.color = String(el.color || '#214d40');
    if (!/^#[0-9a-f]{6}$/i.test(el.color)) throw Error(at + 'pick a valid color.');
    if (el.kind === 'text') {
      el.text = String(el.text ?? '').trim();
      if (!el.text) throw Error(at + 'enter some text.');
      el.size = numeric(el.size ?? 14, 'Size', .1);
    } else if (el.kind === 'image') {
      const bytes = new Uint8Array(el.image || []);
      if (!bytes.length) throw Error(at + 'choose a PNG or JPEG image.');
      el.size = numeric(el.size ?? 40, 'Size', .1);
      el._bytes = bytes;
    } else if (el.kind === 'rect' || el.kind === 'ellipse') {
      el.width = numeric(el.width ?? 40, 'Width', .1);
      el.height = numeric(el.height ?? 20, 'Height', .1);
      el.border = numeric(el.border ?? 0, 'Border');
    } else {
      el.length = numeric(el.length ?? 50, 'Length', .1);
      el.thickness = numeric(el.thickness ?? 1, 'Thickness', .1);
    }
    return el;
  }
  async function annotate(doc, opts, progress) {
    const lib = globalThis.PDFLib;
    if (!Array.isArray(opts.elements) || !opts.elements.length) throw Error('Add at least one annotation first.');
    if (opts.elements.length > 20) throw Error('At most 20 annotations per run.');
    const elements = opts.elements.map(checkElement);
    const font = await doc.embedFont(lib.StandardFonts.Helvetica);
    const rgb = hex => lib.rgb(...[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255));
    for (const el of elements) {
      if (el.kind === 'image') {
        const b = el._bytes;
        if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) el._img = await doc.embedPng(b);
        else if (b[0] === 255 && b[1] === 216) el._img = await doc.embedJpg(b);
        else throw Error('Annotation: choose a PNG or JPEG image.');
      }
      el.pages = selection(el.range, doc.getPageCount());
    }
    let done = 0;
    const total = elements.reduce((a, el) => a + el.pages.length, 0) || 1;
    for (const el of elements) {
      const op = el.opacity / 100, rot = lib.degrees(((el.rotation % 360) + 360) % 360), col = rgb(el.color);
      for (const p of el.pages) {
        const page = doc.getPage(p), g = geometry(page);
        // Fully transparent fill without a border paints nothing: skip.
        if ((el.kind === 'rect' || el.kind === 'ellipse') && op <= 0 && !(el.border > 0)) {
          progress(`Annotating ${++done} / ${total}...`);
          continue;
        }
        const paint = fn => {
          try { fn(); }
          catch (e) { throw Error('Annotation ' + (elements.indexOf(el) + 1) + ' does not fit on page ' + (p + 1) + '. Shrink it or move it.'); }
        };
        page.pushOperators(lib.pushGraphicsState(), lib.concatTransformationMatrix(...g.matrix));
        if (el.kind === 'text') {
          let w;
          try { w = font.widthOfTextAtSize(el.text, el.size); }
          catch (e) { throw Error('Annotation: this text has characters unavailable in the PDF font.'); }
          const h = font.heightAtSize(el.size);
          paint(() => {
            const pt = location(el.position, g.width, g.height, w, h, el.margin * MM);
            const descent = font.heightAtSize(el.size) - font.heightAtSize(el.size, { descender: false });
            page.drawText(el.text, { x: pt.x + el.dx * MM, y: pt.y + descent + el.dy * MM, size: el.size, font, color: col, opacity: op, rotate: rot });
          });
        } else if (el.kind === 'image') {
          const iw = el.size * MM, ih = iw * el._img.height / el._img.width;
          paint(() => {
            const pt = location(el.position, g.width, g.height, iw, ih, el.margin * MM);
            page.drawImage(el._img, { x: pt.x + el.dx * MM, y: pt.y + el.dy * MM, width: iw, height: ih, opacity: op, rotate: rot });
          });
        } else if (el.kind === 'rect' || el.kind === 'ellipse') {
          const wdt = el.width * MM, hgt = el.height * MM;
          paint(() => {
            const pt = location(el.position, g.width, g.height, wdt, hgt, el.margin * MM);
            const box = { x: pt.x + el.dx * MM, y: pt.y + el.dy * MM, opacity: op, rotate: rot };
            if (el.border > 0) { box.borderColor = col; box.borderWidth = el.border * MM; }
            if (op > 0) box.color = col;
            if (el.kind === 'rect') { box.width = wdt; box.height = hgt; page.drawRectangle(box); }
            else { box.xScale = wdt / 2; box.yScale = hgt / 2; box.x += wdt / 2; box.y += hgt / 2; page.drawEllipse(box); }
          });
        } else {
          const len = el.length * MM, th = el.thickness * MM;
          paint(() => {
            const pt = location(el.position, g.width, g.height, len, th, el.margin * MM);
            const a = ((el.rotation % 360) + 360) % 360 * Math.PI / 180;
            const cx = pt.x + el.dx * MM + len / 2, cy = pt.y + el.dy * MM + th / 2;
            const cdx = Math.cos(a) * len / 2, cdy = Math.sin(a) * len / 2;
            page.drawLine({ start: { x: cx - cdx, y: cy - cdy }, end: { x: cx + cdx, y: cy + cdy }, thickness: th, color: col, opacity: op });
          });
        }
        page.pushOperators(lib.popGraphicsState());
        progress(`Annotating ${++done} / ${total}...`);
        if (done % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    return doc.save();
  }
  const field=(label,body)=>`<label class="flex flex-col gap-1 text-xs font-semibold">${label}${body}</label>`;
  const input=(id,value,type='number',extra='')=>`<input id="${id}" type="${type}" value="${value}" ${extra} class="w-full px-3 py-2 rounded-xl border bg-white text-xs">`;
  function editControls(pagesField) {
    const kindField = field('Annotation',
      '<select id="edit-kind" onchange="PDFEdit.toggleKind()" class="px-3 py-2 rounded-xl border bg-white">'
      + [['text', 'Text'], ['image', 'Image (PNG/JPEG)'], ['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['line', 'Line']]
        .map(([v, label]) => `<option value="${v}">${label}</option>`).join('') + '</select>');
    const group = (kinds, inner) => `<div data-kind="${kinds}" style="display:contents">${inner}</div>`;
    const sel = positions.map(p => `<option value="${p}">${p.replaceAll('-', ' ')}</option>`).join('');
    const fields = pagesField + kindField
      + group('text', field('Text', input('edit-text', 'Approved', 'text')) + field('Size (pt)', input('edit-text-size', 14, 'number', 'min="0.1" step="0.5"')))
      + group('image', field('Image file', '<input id="edit-image" type="file" accept=".png,.jpg,.jpeg" class="text-xs">') + field('Width (mm)', input('edit-image-size', 40, 'number', 'min="0.1" step="0.5"')))
      + group('rect ellipse', field('Width (mm)', input('edit-shape-w', 40, 'number', 'min="0.1" step="0.5"')) + field('Height (mm)', input('edit-shape-h', 20, 'number', 'min="0.1" step="0.5"')) + field('Border (mm, 0 = none)', input('edit-shape-border', 0, 'number', 'min="0" step="0.5"')))
      + group('line', field('Length (mm)', input('edit-line-len', 50, 'number', 'min="0.1" step="0.5"')) + field('Thickness (mm)', input('edit-line-thick', 1, 'number', 'min="0.1" step="0.5"')))
      + field('Position', `<select id="edit-position" class="px-3 py-2 rounded-xl border bg-white">${sel}</select>`)
      + field('Shift right (mm)', input('edit-dx', 0, 'number', 'step="0.5"'))
      + field('Shift up (mm)', input('edit-dy', 0, 'number', 'step="0.5"'))
      + field('Rotation (°)', input('edit-rotation', 0, 'number', 'step="1"'))
      + field('Color', input('edit-color', '#214d40', 'color'))
      + field('Opacity (%)', input('edit-opacity', 100, 'number', 'min="0" max="100"'))
      + '<div class="col-span-full flex flex-wrap gap-2">'
      + '<button type="button" onclick="PDFEdit.addDraft().catch(PDFEdit.showDraftError)" class="px-4 py-2 rounded-xl bg-[#1A3C34] text-white text-xs font-bold">＋ Add annotation</button>'
      + '<button type="button" onclick="PDFEdit.clearDrafts()" class="px-4 py-2 rounded-xl border text-xs font-bold">Clear</button>'
      + '</div>'
      + '<div id="edit-draft-list" class="col-span-full grid gap-1"></div>'
      + '<p class="text-xs text-gray-500 col-span-full">Stacked annotations apply together when you press convert. Freehand drawing is not part of this form.</p>';
    return `<div class="w-full bg-white rounded-xl border border-gray-200 p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">${fields}</div>`;
  }
  function anyDoc(doc) { return doc || (typeof document !== 'undefined' ? document : null); }
  function toggleKind(doc) {
    doc = anyDoc(doc);
    if (!doc) return;
    const kind = doc.querySelector('#edit-kind')?.value || 'text';
    doc.querySelectorAll('#options [data-kind], dialog [data-kind]').forEach(group => {
      group.style.display = group.dataset.kind.split(' ').includes(kind) ? '' : 'none';
    });
    // Fallback when the options panel has another root (tests, embeds).
    if (!doc.querySelector('#options [data-kind]') && !doc.querySelector('dialog [data-kind]')) {
      doc.querySelectorAll('[data-kind]').forEach(group => {
        group.style.display = group.dataset.kind.split(' ').includes(kind) ? '' : 'none';
      });
    }
  }
  function draftSummary(el) {
    if (el.kind === 'text') return `“${el.text}”`;
    if (el.kind === 'image') return 'image';
    if (el.kind === 'rect' || el.kind === 'ellipse') return `${el.width}×${el.height}mm`;
    return `${el.length}mm line`;
  }
  function renderDrafts(doc) {
    doc = anyDoc(doc);
    if (!doc) return;
    const list = doc.querySelector('#edit-draft-list');
    if (!list) return;
    list.replaceChildren();
    drafts.forEach((el, i) => {
      const row = doc.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:.5rem;font-size:11px;background:#f8faf5;border:1px solid #e5e7eb;border-radius:10px;padding:.35rem .6rem';
      const label = doc.createElement('span');
      label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      label.textContent = `${i + 1}. ${el.kind} ${draftSummary(el)} · ${el.range}`;
      const remove = doc.createElement('button');
      remove.type = 'button'; remove.textContent = '✕'; remove.title = 'Remove';
      remove.style.cssText = 'border:0;background:none;color:#b3121a;font-weight:800;cursor:pointer';
      remove.onclick = () => removeDraft(i);
      row.append(label, remove);
      list.append(row);
    });
  }
  function showDraftError(cause) {
    const box = document.querySelector('#error');
    if (box) { box.textContent = (cause && cause.message) || String(cause); box.classList.remove('hidden'); }
  }
  async function addDraft(doc) {
    doc = anyDoc(doc);
    if (!doc) throw Error('Annotation form is not available.');
    const value = id => doc.querySelector('#edit-' + id)?.value;
    const kind = value('kind') || 'text';
    const el = {
      kind, range: value('range') || 'all', position: value('position') || 'center',
      margin: value('margin') ?? '10', dx: value('dx') ?? '0', dy: value('dy') ?? '0',
      rotation: value('rotation') ?? '0', color: value('color') || '#214d40', opacity: value('opacity') ?? '100',
    };
    if (kind === 'text') { el.text = value('text'); el.size = value('text-size'); }
    else if (kind === 'image') {
      el.size = value('image-size');
      const picked = doc.querySelector('#edit-image')?.files?.[0];
      if (!picked) throw Error('Choose a PNG or JPEG image.');
      el.image = [...new Uint8Array(await picked.arrayBuffer())];
    }
    else if (kind === 'rect' || kind === 'ellipse') { el.width = value('shape-w'); el.height = value('shape-h'); el.border = value('shape-border'); }
    else if (kind === 'line') { el.length = value('line-len'); el.thickness = value('line-thick'); }
    else throw Error('Pick an annotation kind first.');
    drafts.push(checkElement(el, drafts.length));
    renderDrafts(doc);
  }
  function removeDraft(index) { drafts.splice(index, 1); renderDrafts(); }
  function clearDrafts() { drafts.length = 0; renderDrafts(); }
  function controls(tool) {
    let fields=field('Pages',input('edit-range','all','text','placeholder="all or 1-3,5"'));
    if(tool==='edit-pdf') return editControls(fields);
    if(tool==='crop-pdf') {
      for(const side of ['top','right','bottom','left'])fields+=field(side[0].toUpperCase()+side.slice(1)+' margin (mm)',input('edit-'+side,10,'number','min="0" step="0.5"'));
      fields+='<p class="text-xs text-gray-500 col-span-full">Margins follow the displayed page orientation. Crop hides edges; it does not permanently remove their contents.</p>';
    } else {
      if(tool==='watermark') {
        fields+=field('Watermark type','<select id="edit-mode" class="px-3 py-2 rounded-xl border bg-white"><option value="text">Text</option><option value="image">Image (PNG/JPEG)</option></select>');
        fields+=field('Text',input('edit-text','CONFIDENTIAL','text'));
        fields+=field('Image (used in Image mode)','<input id="edit-image" type="file" accept=".png,.jpg,.jpeg" class="text-xs">');
        fields+=field('Opacity (%)',input('edit-opacity',25,'number','min="0" max="100"'));
      } else fields+=field('Starting number',input('edit-start',1,'number','min="0" step="1"'));
      fields+=field(tool==='watermark'?'Text size (pt) / image width (mm)':'Font size (pt)',input('edit-size',tool==='watermark'?36:12,'number','min="0.1" step="0.5"'));
      fields+=field('Position',`<select id="edit-position" class="px-3 py-2 rounded-xl border bg-white">${positions.map(p=>`<option value="${p}" ${p===(tool==='watermark'?'center':'bottom-center')?'selected':''}>${p.replaceAll('-',' ')}</option>`).join('')}</select>`);
      fields+=field('Edge margin (mm)',input('edit-margin',10,'number','min="0" step="0.5"'));
      fields+=field('Text color',input('edit-color','#214d40','color'));
      if(tool==='page-numbers')fields+='<p class="text-xs text-gray-500 col-span-full">Numbers run consecutively across the selected pages.</p>';
    }
    return `<div class="w-full bg-white rounded-xl border border-gray-200 p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">${fields}</div>`;
  }
  function showDraftError(cause) {
    const box = typeof document !== 'undefined' && document.querySelector ? document.querySelector('#error') : null;
    if (box) { box.textContent = (cause && cause.message) || String(cause); box.classList.remove('hidden'); }
  }
  async function readOptions(tool, doc=document) {
    if (tool === 'edit-pdf') return { tool, elements: drafts.map(el => Object.assign({}, el)) };
    const options={tool};
    for(const key of ['range','mode','text','opacity','start','size','position','margin','color','top','right','bottom','left'])options[key]=doc.querySelector('#edit-'+key)?.value;
    if(tool==='watermark'&&options.mode==='image') {
      const image=doc.querySelector('#edit-image').files[0];
      if(!image)throw Error('Choose a PNG or JPEG watermark image.');
      options.image=await image.arrayBuffer();
    }
    return options;
  }
  globalThis.PDFEdit={apply,controls,readOptions,selection,toggleKind,renderDrafts,addDraft,removeDraft,clearDrafts,showDraftError,draftCount:()=>drafts.length};
})();
