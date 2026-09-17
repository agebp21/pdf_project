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
    if(!['watermark','page-numbers','crop-pdf'].includes(opts.tool))throw Error('Unknown PDF editing tool.');
    const doc=await lib.PDFDocument.load(input); // Do not silently bypass encrypted PDFs.
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
  const field=(label,body)=>`<label class="flex flex-col gap-1 text-xs font-semibold">${label}${body}</label>`;
  const input=(id,value,type='number',extra='')=>`<input id="${id}" type="${type}" value="${value}" ${extra} class="w-full px-3 py-2 rounded-xl border bg-white text-xs">`;
  function controls(tool) {
    let fields=field('Pages',input('edit-range','all','text','placeholder="all or 1-3,5"'));
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
  async function readOptions(tool, doc=document) {
    const options={tool};
    for(const key of ['range','mode','text','opacity','start','size','position','margin','color','top','right','bottom','left'])options[key]=doc.querySelector('#edit-'+key)?.value;
    if(tool==='watermark'&&options.mode==='image') {
      const image=doc.querySelector('#edit-image').files[0];
      if(!image)throw Error('Choose a PNG or JPEG watermark image.');
      options.image=await image.arrayBuffer();
    }
    return options;
  }
  globalThis.PDFEdit={apply,controls,readOptions,selection};
})();
