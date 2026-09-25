'use strict';
/* ════════════════════════════════════════════════════════════
   Flipbook Animation Editor — animation-editor.js
   Support: PDF, Word, Excel, PPT, gambar.
   PDF zone: klik area → select → assign animasi.
   ════════════════════════════════════════════════════════════ */
(() => {
  const $ = s => document.querySelector(s);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const uid   = () => 'el-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const HANDLES = ['tl','tc','tr','ml','mr','bl','bc','br'];

  /* ─── State ───────────────────────────────────────────── */
  let pages       = {};
  let pageCount   = 0;
  let currentPage = 0;
  let selectedId  = null;
  let pdfDoc      = null;
  let imageUrls   = [];
  let originalImageUrls = [];
  let extractionResults = {};
  let pageVpInfo  = [];   // {pdfW, pdfH, canvasW, canvasH, scale}
  let mode        = 'edit';
  let loading     = false;
  let exporting   = false;
  let sourceName  = '';
  let importing = false, extracting = false, previewPlayer = null;

  let stageEl = null;
  let wrapEl  = null;
  let stripEl = null;

  /* ─── Model ───────────────────────────────────────────── */
  function getPage(i)  { if (!pages[i]) pages[i] = { elements:[] }; return pages[i]; }
  function getEls(i)   { return getPage(i).elements; }
  function findEl(id)  { return getEls(currentPage).find(e => e.id === id); }

  function makeCustomEl(type) {
    const hot = type === 'hotspot';
    return {
      id: uid(), type, isPdfZone: false,
      x:28, y:38, w: hot?28:44, h: hot?7:9, rotation: 0,
      content: hot ? 'Klik di sini →' : 'Teks kamu',
      style: { fontSize:18, color: hot?'#ffffff':'#1a1a1a', bold:hot, italic:false,
               align: hot?'center':'left', bgColor: hot?'#4a7c59':'', opacity:1 },
      animation: { type:'fadeIn', delay:0, duration:600 },
      link: hot?{type:'url',target:''}:null,
    };
  }

  function makePdfZone(x, y, w, h, text) {
    return {
      id: uid(), type:'pdfZone', isPdfZone:true,
      x, y, w, h, rotation:0, content: text||'',
      style: { fontSize:0, color:'transparent', bold:false, italic:false, align:'left', bgColor:'transparent', opacity:1 },
      animation: { type:'pulse', delay:0, duration:1400 },
      link: null,
    };
  }

  /* ══════════════════════════════════════════════════════════
     MULTI-FORMAT IMPORT
     ══════════════════════════════════════════════════════════ */
  const OFFICE_ROUTES = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '/api/convert/word-to-pdf',
    'application/msword':                                                        '/api/convert/word-to-pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':         '/api/convert/excel-to-pdf',
    'application/vnd.ms-excel':                                                  '/api/convert/excel-to-pdf',
    'text/csv':                                                                   '/api/convert/excel-to-pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '/api/convert/pptx-to-pdf',
    'application/vnd.ms-powerpoint':                                              '/api/convert/pptx-to-pdf',
  };
  const IMAGE_TYPES = new Set(['image/jpeg','image/png','image/gif','image/webp','image/bmp']);

  async function handleFileInput(file) {
    if(!file||importing||loading||exporting||extracting)return;
    importing=true;updateButtons();setError('');
    try {
      const ext=file.name.split('.').pop().toLowerCase();
      if(IMAGE_TYPES.has(file.type)||['jpg','jpeg','png','gif','webp','bmp'].includes(ext)){
        setStatus('Memproses gambar...');
        await openPdf(await imageToSinglePagePdf(file),file.name.replace(/\.[^.]+$/,'.pdf'));return;
      }
      if(ext==='pdf'){await openPdf(file,file.name);return;}
      const types={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',doc:'application/msword',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',csv:'text/csv',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',ppt:'application/vnd.ms-powerpoint'};
      const mime=types[ext];if(!mime)throw Error('Format tidak didukung: '+file.name);
      const capsResponse=await fetch('/api/capabilities');if(!capsResponse.ok)throw Error('Jalankan server proyek: python server.py');
      const caps=await capsResponse.json();if(!caps.office)throw Error('LibreOffice belum tersedia di komputer ini.');
      showConverting(true);setStatus('Mengkonversi ke PDF...');
      const res=await fetch(OFFICE_ROUTES[mime],{method:'POST',headers:{'Content-Type':mime,'X-Build-Token':caps.token,'X-Filename':encodeURIComponent(file.name)},body:file});
      if(!res.ok){const error=await res.json().catch(()=>({}));throw Error(error.error||'Konversi gagal ('+res.status+')');}
      const blob=await res.blob();if(await blob.slice(0,5).text()!=='%PDF-')throw Error('Server tidak mengembalikan PDF.');
      await openPdf(blob,file.name.replace(/\.[^.]+$/,'.pdf'));
    } catch(error){setError(error.message||String(error));setStatus('');}
    finally{importing=false;showConverting(false);updateButtons();}
  }

  /* Gambar → PDF satu halaman via canvas+PDF kit sederhana (tanpa library) */
  async function imageToSinglePagePdf(file) {
    const url=URL.createObjectURL(file);
    try {
      const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Gambar tidak valid'));image.src=url;});
      if(!img.naturalWidth||!img.naturalHeight)throw Error('Ukuran gambar tidak valid');
      const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0);
      const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));
      if(!jpeg)throw Error('Gambar gagal diproses');
      const doc=await PDFLib.PDFDocument.create(),embedded=await doc.embedJpg(await jpeg.arrayBuffer());
      const page=doc.addPage([img.naturalWidth*.75,img.naturalHeight*.75]);
      page.drawImage(embedded,{x:0,y:0,width:page.getWidth(),height:page.getHeight()});
      canvas.width=canvas.height=0;
      return new Blob([await doc.save()],{type:'application/pdf'});
    } finally {URL.revokeObjectURL(url);}
  }

  function showConverting(v) {
    const el = $('#ae-converting'); if (el) el.classList.toggle('visible', v);
  }

  /* ══════════════════════════════════════════════════════════
     OPEN PDF (render semua halaman ke JPEG)
     ══════════════════════════════════════════════════════════ */
  async function openPdf(blob, name) {
    if (loading) return;
    loading = true; updateButtons(); setStatus('Membaca PDF…');
    const newUrls = [], newVpInfo = [];
    let task=null, installed=false;
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
      task = pdfjsLib.getDocument({ data: await blob.arrayBuffer(), isEvalSupported:false });
      const doc  = await task.promise;

      for (let i = 1; i <= doc.numPages; i++) {
        setStatus(`Render halaman ${i} / ${doc.numPages}…`);
        const page = await doc.getPage(i);
        const vp0  = page.getViewport({ scale:1 });
        const scale = Math.min(1.6, 1200 / Math.max(vp0.width, vp0.height));
        const vp   = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport:vp }).promise;
        const imgBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.88));
        if (!imgBlob) throw new Error('Render halaman gagal.');
        newUrls.push(URL.createObjectURL(imgBlob));
        newVpInfo.push({ pdfW:vp0.width, pdfH:vp0.height, canvasW:canvas.width, canvasH:canvas.height, scale });
        page.cleanup(); canvas.width = canvas.height = 0;
      }

      if (pdfDoc) await pdfDoc.destroy().catch(() => {});
      new Set([...imageUrls,...originalImageUrls]).forEach(u => URL.revokeObjectURL(u));
      imageUrls = newUrls; originalImageUrls = [...newUrls]; pageVpInfo = newVpInfo;
      pdfDoc = doc; pageCount = doc.numPages; installed=true;
      previewPlayer?.destroy(); previewPlayer=null; mode='edit';
      $('#ae-mode-edit')?.classList.add('active'); $('#ae-mode-preview')?.classList.remove('active');
      pages = {}; extractionResults={}; currentPage = 0; selectedId = null; sourceName = name;

      // Setup canvas area
      const scroll = $('.ae-canvas-scroll');
      if (scroll) {
        scroll.innerHTML = '';
        const wrap  = document.createElement('div'); wrap.className = 'ae-page-wrap'; wrap.id = 'ae-page-wrap';
        const img   = document.createElement('img'); img.className = 'ae-page-img'; img.draggable = false;
        const stage = document.createElement('div'); stage.className = 'ae-stage'; stage.id = 'ae-stage';
        wrap.append(img, stage); scroll.append(wrap);
        stageEl = stage; wrapEl  = wrap;
        stage.addEventListener('pointerdown', e => { if (e.target === stage) select(null); });
        img.addEventListener('load', resizeWrap);
      } else {
        stageEl = $('#ae-stage'); wrapEl = $('#ae-page-wrap');
      }

      updateEditorImage(); buildStrip(); renderStage(); resizeWrap(); updatePageLabel();
      setStatus(`${pageCount} halaman siap. Klik "Load konten halaman ini" untuk membuat teks bisa dipilih.`);
    } catch (err) {
      if(!installed){newUrls.forEach(u => URL.revokeObjectURL(u));await task?.destroy().catch(()=>{});}
      setError('Tidak bisa membuka file: ' + (err.message || err)); setStatus('');
    } finally {
      loading = false; updateButtons();
    }
  }

  /* ══════════════════════════════════════════════════════════
     LOAD TEXT LAYER — koordinat akurat dari PDF.js
     ══════════════════════════════════════════════════════════ */
  async function loadPageTextLayer(pageIndex) {
    if (!pdfDoc) return;
    const info = pageVpInfo[pageIndex];
    if (!info) { setError('Render PDF dulu.'); return; }

    setStatus(`Memuat konten halaman ${pageIndex + 1}…`);

    // Bersihkan zona PDF lama
    const existing = getEls(pageIndex);


    try {
      const page    = await pdfDoc.getPage(pageIndex + 1);
      const vp0     = page.getViewport({ scale:1 });
      const content = await page.getTextContent();

      const rawItems = [];
      for (const item of content.items) {
        if (!item.str?.trim()) continue;
        const tx=pdfjsLib.Util.transform(vp0.transform,item.transform);
        const angle=Math.atan2(tx[1],tx[0]);
        const fontSizePdf=Math.hypot(tx[2],tx[3]);
        const font=content.styles[item.fontName]||{};
        const fontAscent=Number.isFinite(font.ascent)?font.ascent:Number.isFinite(font.descent)?1+font.descent:.8;
        const ascent=fontAscent*fontSizePdf;
        const x=tx[4]+Math.sin(angle)*ascent,y=tx[5]-Math.cos(angle)*ascent;
        const dx=Math.cos(angle)*item.width,dy=Math.sin(angle)*item.width;
        const hx=-Math.sin(angle)*fontSizePdf,hy=Math.cos(angle)*fontSizePdf;
        const xs=[x,x+dx,x+hx,x+dx+hx],ys=[y,y+dy,y+hy,y+dy+hy];
        const xPct=Math.min(...xs)/vp0.width*100,yPct=Math.min(...ys)/vp0.height*100;
        const wPct=(Math.max(...xs)-Math.min(...xs))/vp0.width*100;
        const hPct=(Math.max(...ys)-Math.min(...ys))/vp0.height*100;

        if (xPct < -2 || xPct > 102 || yPct < -2 || yPct > 102) continue;
        rawItems.push({
          text: item.str.trim(),
          x: clamp(xPct, 0, 99), y: clamp(yPct, 0, 99),
          w: clamp(wPct, 1, 99), h: clamp(hPct, 0.5, 20),
          fontSize: fontSizePdf,
          baselineX:tx[4], baselineY:tx[5], angle,
          fontName:item.fontName,
          family:font.fontFamily||'sans-serif',
        });
      }

      // Render the original graphics while omitting only matched, normal text
      // draw calls. Outlined/raster text remains untouched, never painted over.
      const canvas=document.createElement('canvas');canvas.width=info.canvasW;canvas.height=info.canvasH;
      const ctx=canvas.getContext('2d'), captured=new Map();
      let suppressType3=false,captureRaster=false;
      const extractedImages=[];
      const proxy=new Proxy(ctx,{
        get(target,key){
          if(key==='drawImage')return (...args)=>{
            if(suppressType3)return;
            const m=target.getTransform(),source=args[0];
            const box=args.length===9?args.slice(5):args.length===5?args.slice(1):[args[1],args[2],source.width,source.height];
            const [dx,dy,dw,dh]=box;
            const left=Math.min(m.a*dx+m.e,m.a*(dx+dw)+m.e),top=Math.min(m.d*dy+m.f,m.d*(dy+dh)+m.f);
            const width=Math.abs(m.a*dw),height=Math.abs(m.d*dh);
            // Keep page backgrounds, rotated/clipped group images and masks in place.
            if(captureRaster&&Math.abs(m.b)<.001&&Math.abs(m.c)<.001&&target.globalCompositeOperation==='source-over'&&width>1&&height>1&&width*height<canvas.width*canvas.height*.8&&left>=-1&&top>=-1&&left+width<=canvas.width+1&&top+height<=canvas.height+1){
              const layer=document.createElement('canvas');layer.width=Math.ceil(width);layer.height=Math.ceil(height);
              const layerCtx=layer.getContext('2d');layerCtx.setTransform(m.a,m.b,m.c,m.d,m.e-left,m.f-top);layerCtx.drawImage(...args);
              extractedImages.push({x:left/canvas.width*100,y:top/canvas.height*100,w:width/canvas.width*100,h:height/canvas.height*100,src:layer.toDataURL('image/png'),opacity:target.globalAlpha});
              layer.width=layer.height=0;return;
            }
            return target.drawImage(...args);
          };
          if(['fill','stroke','fillRect','strokeRect','drawImage'].includes(key))return (...args)=>{if(!suppressType3)return target[key](...args);};
          if(key==='fillText'||key==='strokeText')return function(text,x,y,...rest){
            const m=target.getTransform(),px=(m.a*x+m.c*y+m.e)/info.scale,py=(m.b*x+m.d*y+m.f)/info.scale;
            const item=rawItems.filter(it=>Math.abs(it.angle)<.01&&Math.abs(py-it.baselineY)<Math.max(2,it.fontSize*.25)&&px>=it.baselineX-1&&px<=it.baselineX+it.w*vp0.width/100+1).sort((a,b)=>Math.abs(py-a.baselineY)-Math.abs(py-b.baselineY))[0];
            if(item){if(key==='fillText'||!captured.has(item))captured.set(item,{color:key==='fillText'?target.fillStyle:target.strokeStyle,font:target.font});return;}
            return target[key](text,x,y,...rest);
          };
          const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
        },set(target,key,value){return Reflect.set(target,key,value,target);}
      });
      const renderTask=page.render({canvasContext:proxy,viewport:page.getViewport({scale:info.scale})});
      // PDF.js 3.11.174 draws Type3 shadows through glyph paths, not fillText.
      // Scope this adapter to this render task; never mutate vendor prototypes.
      renderTask.onContinue=resume=>{
        for(const state of page._intentStates?.values()||[])for(const task of state.renderTasks||[]){
          if(task.task!==renderTask||!task.gfx||task.gfx._aeType3Wrapped)continue;
          const gfx=task.gfx,original=gfx.showType3Text;
          gfx._aeType3Wrapped=true;
          const paintImage=gfx.paintImageXObject;
          gfx.paintImageXObject=function(...args){const before=captureRaster;captureRaster=this.groupLevel===0&&!this.current.activeSMask;try{return paintImage.apply(this,args);}finally{captureRaster=before;}};
          // Numeric dispatch aliases the prototype method in this pinned PDF.js.
          if(pdfjsLib.OPS)gfx[pdfjsLib.OPS.paintImageXObject]=gfx.paintImageXObject;
          const beginGroup=gfx.beginGroup,endGroup=gfx.endGroup,groups=[];
          gfx.beginGroup=function(group){groups.push(group);return beginGroup.call(this,group);};
          gfx.endGroup=function(...args){const group=groups.pop(),before=captureRaster;captureRaster=this.groupLevel===1&&!group?.smask&&!this.current.activeSMask;try{return endGroup.apply(this,args);}finally{captureRaster=before;}};
          if(pdfjsLib.OPS){gfx[pdfjsLib.OPS.beginGroup]=gfx.beginGroup;gfx[pdfjsLib.OPS.endGroup]=gfx.endGroup;}
          gfx.showType3Text=function(glyphs){
            const current=this.current,m=this.ctx.getTransform();
            const matrix=pdfjsLib.Util.transform([m.a,m.b,m.c,m.d,m.e,m.f],current.textMatrix);
            const x=(matrix[0]*current.x+matrix[2]*current.y+matrix[4])/info.scale;
            const y=(matrix[1]*current.x+matrix[3]*current.y+matrix[5])/info.scale;
            const compact=value=>value.replace(/\s/g,'');
            const text=compact(glyphs.filter(g=>typeof g!=='number').map(g=>g.unicode||'').join(''));
            const layer=rawItems.find(it=>Math.abs(it.angle)<.01&&text&&compact(it.text).includes(text)&&x>=it.baselineX-2&&x<=it.baselineX+it.w*vp0.width/100+2&&Math.abs(it.baselineY-y)<Math.max(3,it.fontSize*.25)&&page.commonObjs.get(it.fontName)===current.font);
            const primary=layer&&rawItems.find(it=>Number.isFinite(it.w)&&compact(it.text).includes(text)&&x>=it.baselineX-2&&x<=it.baselineX+it.w*vp0.width/100+2&&Math.abs(it.baselineY-y)<Math.max(3,it.fontSize*.2)&&!page.commonObjs.get(it.fontName).isType3Font);
            if(!primary)return original.call(this,glyphs);
            if(!current.font.isType3Font)captured.set(layer,{color:current.fillColor,font:current.font.name||this.ctx.font});
            const previous=suppressType3;suppressType3=true;
            const backups=[],ops=pdfjsLib.OPS;
            const paints=new Set(['stroke','closeStroke','fill','eoFill','fillStroke','eoFillStroke','closeFillStroke','closeEOFillStroke','shadingFill','paintImageXObject','paintInlineImageXObject','paintImageMaskXObject'].map(name=>ops?.[name]));
            if(ops)for(const glyph of glyphs){const key=glyph?.operatorListId,list=current.font.charProcOperatorList[key];if(!list||backups.some(b=>b[0]===key))continue;backups.push([key,list]);current.font.charProcOperatorList[key]={...list,fnArray:list.fnArray.map(fn=>paints.has(fn)?ops.endPath:fn),argsArray:list.argsArray.map((args,i)=>paints.has(list.fnArray[i])?[]:args)};}
            try{return original.call(this,glyphs);}finally{suppressType3=previous;for(const[key,list]of backups)current.font.charProcOperatorList[key]=list;}
          };
        }
        resume();
      };
      await renderTask.promise;
      // PDFs often repeat the same run for a shadow, outline, or faux bold.
      // All matched paints were removed above; recreate one editable element,
      // using the last (foreground) run instead of animating each duplicate.
      const lines=[];
      for(const item of rawItems.filter(it=>captured.has(it))){
        const same=lines.findIndex(other=>other.text===item.text&&Math.abs(other.fontSize-item.fontSize)<Math.max(1,item.fontSize*.1)&&Math.abs(other.baselineX-item.baselineX)<Math.max(2,item.fontSize*.15)&&Math.abs(other.baselineY-item.baselineY)<Math.max(2,item.fontSize*.15));
        if(same<0)lines.push(item);else lines[same]=item;
      }
      if(!lines.length){canvas.width=canvas.height=0;await extractOcrPage(pageIndex);return;}
      let backgroundUrl=null;
      if(lines.length||extractedImages.length){const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));if(!blob)throw Error('Background gagal dirender');backgroundUrl=URL.createObjectURL(blob);}
      canvas.width=canvas.height=0;

      pages[pageIndex] = { elements: [] };
      extractedImages.forEach((image,index)=>{
        const el=makeCustomEl('image');Object.assign(el,image,{isExtractedImage:true,sourceKey:index,content:`Gambar ${index+1}`});el.style.opacity=image.opacity;
        getEls(pageIndex).push(existing.find(e=>e.isExtractedImage&&e.sourceKey===index)||el);
      });
      let added = 0;
      for (const ln of lines) {
        if (!ln.text.trim() || ln.w < 0.5 || ln.h < 0.3) continue;
        const paint=captured.get(ln),zone=makeCustomEl('text');
        Object.assign(zone,{isExtracted:true,sourceText:ln.text,sourceX:ln.x,sourceY:ln.y,x:ln.x,y:ln.y,w:Math.min(ln.w+1,100-ln.x),h:Math.min(Math.max(ln.h*1.3,1),100-ln.y),content:ln.text});
        Object.assign(zone.style,{fontSize:ln.fontSize/vp0.height/0.033*18,color:typeof paint.color==='string'?paint.color:'#1a1a1a',fontFamily:ln.family,bold:/bold|black|heavy/i.test(paint.font),italic:/italic|oblique/i.test(paint.font)});
        const previous=existing.find(e=>e.isExtracted&&e.sourceText===ln.text&&Math.abs(e.sourceX-ln.x)<.5&&Math.abs(e.sourceY-ln.y)<.5);
        getEls(pageIndex).push(previous||zone);
        added++;
      }
      getEls(pageIndex).push(...existing.filter(e=>!e.isPdfZone&&!e.isExtracted&&!e.isExtractedImage));

      if(backgroundUrl){if(imageUrls[pageIndex]!==originalImageUrls[pageIndex])URL.revokeObjectURL(imageUrls[pageIndex]);imageUrls[pageIndex]=backgroundUrl;}
      if(pageIndex===currentPage)updateEditorImage();

      page.cleanup();

      if (added === 0 && !extractedImages.length) {
        extractionResults[pageIndex]={empty:true,message:`Halaman ${pageIndex + 1}: pemeriksaan selesai, tidak ada teks atau gambar terpisah yang didukung. Halaman gambar/scan memerlukan OCR untuk teks; OCR belum tersedia di editor ini. Kamu tetap bisa menambah teks atau tombol link.`};
      } else {
        extractionResults[pageIndex]={empty:false,message:`Halaman ${pageIndex + 1}: ${added} teks dan ${extractedImages.length} gambar dipisahkan. Klik elemen untuk mengatur animasi. Grafis tanpa grup dan gambar yang menyatu dalam background belum dipisahkan.`};
      }
      setStatus(extractionResults[pageIndex].message);
    } catch (err) {
      console.error('loadTextLayer', err);
      extractionResults[pageIndex]={error:true,message:`Halaman ${pageIndex+1}: ekstraksi gagal — ${err.message}`};
      setError('Gagal load teks: ' + err.message); setStatus('');
    }

    if (pageIndex === currentPage) { renderStage(); select(null); updateStrip(); }
    else updateStrip();
  }

  /* Gabungkan teks items berdasarkan posisi Y yang berdekatan */
  function mergeLines(items, pdfH) {
    const tol = (3 / pdfH) * 100; // ~3pt toleransi dalam persen
    const lines = [];
    // Urutkan dari atas ke bawah, kiri ke kanan
    items.sort((a, b) => a.y - b.y || a.x - b.x);

    for (const item of items) {
      const nearby = lines.find(l =>
        Math.abs(l.y - item.y) < Math.max(tol, l.h * 0.6) &&
        item.x >= l.x - 2 &&
        item.x <= l.x + l.w + l.h * 6
      );
      if (nearby) {
        nearby.text += ' ' + item.text;
        const right = Math.max(nearby.x + nearby.w, item.x + item.w);
        nearby.x = Math.min(nearby.x, item.x);
        nearby.w = right - nearby.x;
        nearby.h = Math.max(nearby.h, item.h);
      } else {
        lines.push({ ...item });
      }
    }
    return lines;
  }

  async function loadTextLayers(all=false) {
    if(!pdfDoc||loading||importing||exporting||extracting)return;
    if(mode!=='edit')setMode('edit');
    extracting=true;updateButtons();setError('');
    try {if(all){for(let i=0;i<pageCount;i++)await loadPageTextLayer(i);const results=Object.values(extractionResults),empty=results.filter(r=>r.empty).length,failed=results.filter(r=>r.error).length;setError('');setStatus(`Pemeriksaan ${pageCount} halaman selesai: ${empty} tanpa objek terpisah, ${failed} gagal. ${extractionResults[currentPage]?.message||''}`);}else await loadPageTextLayer(currentPage);}
    finally {await AnimationOCR.release();extracting=false;updateButtons();}
  }

  async function extractOcrPage(index){
    setStatus(`OCR halaman ${index+1}: membaca teks dari gambar…`);
    const page=await pdfDoc.getPage(index+1),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:2200/Math.max(base.width,base.height)});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    try{
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      const lines=await AnimationOCR.read(canvas,event=>{if(event.status==='recognizing text')setStatus(`OCR halaman ${index+1}: ${Math.round((event.progress||0)*100)}%`);});
      const boxes=lines.flatMap(line=>line.words.length?line.words:[line.bbox]);
      const colors=AnimationOCR.repair(canvas,boxes);let colorIndex=0;
      const elements=lines.map(line=>{
        const b=line.bbox,el=makeCustomEl('text');
        Object.assign(el,{isExtracted:true,isOcr:true,sourceText:line.text,sourceX:b.x0/canvas.width*100,sourceY:b.y0/canvas.height*100,content:line.text,x:b.x0/canvas.width*100,y:b.y0/canvas.height*100,w:(b.x1-b.x0)/canvas.width*100+1,h:(b.y1-b.y0)/canvas.height*130,confidence:line.confidence});
        el.style.color=colors[colorIndex]||'#222222';colorIndex+=line.words.length||1;el.style.fontSize=(b.y1-b.y0)/canvas.height/.033*18;
        return el;
      });
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));if(!blob)throw Error('Background OCR gagal dibuat.');
      const old=getEls(index),manual=old.filter(el=>!el.isExtracted&&!el.isExtractedImage&&!el.isPdfZone);
      pages[index]={elements:[...elements.map(el=>old.find(previous=>previous.isOcr&&previous.sourceText===el.sourceText&&Math.abs(previous.sourceX-el.sourceX)<.5&&Math.abs(previous.sourceY-el.sourceY)<.5)||el),...manual]};
      if(imageUrls[index]!==originalImageUrls[index])URL.revokeObjectURL(imageUrls[index]);
      imageUrls[index]=elements.length?URL.createObjectURL(blob):originalImageUrls[index];
      extractionResults[index]={empty:!elements.length,message:elements.length?`Halaman ${index+1}: ${elements.length} baris OCR menjadi teks editable. Periksa ejaan dan background; hasil OCR adalah perkiraan. Grafis lain bisa dipisahkan dengan pilih area.`:`Halaman ${index+1}: OCR selesai, tidak menemukan teks. Gunakan Pisahkan area gambar/logo untuk grafis.`};
      if(index===currentPage){updateEditorImage();renderStage();}updateStrip();setStatus(extractionResults[index].message);
    }finally{canvas.width=canvas.height=0;page.cleanup();}
  }

  async function ocrCurrentPage(){
    if(!pageCount||loading||importing||exporting||extracting)return;
    if(mode!=='edit')setMode('edit');extracting=true;updateButtons();setError('');
    try{await extractOcrPage(currentPage);}catch(error){setError('OCR gagal: '+error.message);}finally{await AnimationOCR.release();extracting=false;updateButtons();}
  }

  function startRegionExtraction(){
    if(!pageCount||loading||importing||exporting||extracting)return;
    if(mode!=='edit')setMode('edit');extracting=true;updateButtons();select(null);
    const overlay=document.createElement('div');overlay.className='ae-region-picker';
    const outline=document.createElement('div');outline.className='ae-region-box';overlay.append(outline);stageEl.append(overlay);
    let start=null;
    setStatus('Tarik kotak mengelilingi gambar/logo. Background bekas area akan diperkirakan. Escape untuk batal.');
    const cleanup=()=>{overlay.remove();document.removeEventListener('keydown',escape);extracting=false;updateButtons();};
    const escape=e=>{if(e.key==='Escape'){cleanup();setStatus('Pemisahan area dibatalkan.');}};document.addEventListener('keydown',escape);
    const point=e=>{const r=overlay.getBoundingClientRect();return {x:clamp((e.clientX-r.left)/r.width,0,1),y:clamp((e.clientY-r.top)/r.height,0,1)};};
    overlay.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();start=point(e);overlay.setPointerCapture?.(e.pointerId);});
    overlay.addEventListener('pointermove',e=>{if(!start)return;const end=point(e);Object.assign(outline.style,{left:Math.min(start.x,end.x)*100+'%',top:Math.min(start.y,end.y)*100+'%',width:Math.abs(start.x-end.x)*100+'%',height:Math.abs(start.y-end.y)*100+'%'});});
    overlay.addEventListener('pointerup',async e=>{
      if(!start)return;const end=point(e),rect={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(start.x-end.x),h:Math.abs(start.y-end.y)};start=null;
      if(rect.w<.005||rect.h<.005){cleanup();setStatus('Area terlalu kecil. Pilih ulang gambar/logo.');return;}
      document.removeEventListener('keydown',escape);
      try{
        const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Gambar halaman gagal dibaca'));image.src=imageUrls[currentPage];});
        const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);
        const x=Math.floor(rect.x*canvas.width),y=Math.floor(rect.y*canvas.height),w=Math.max(1,Math.floor(rect.w*canvas.width)),h=Math.max(1,Math.floor(rect.h*canvas.height));
        const crop=document.createElement('canvas');crop.width=w;crop.height=h;crop.getContext('2d').drawImage(canvas,x,y,w,h,0,0,w,h);
        const el=makeCustomEl('image');Object.assign(el,{isExtractedImage:true,sourceKey:uid(),src:crop.toDataURL('image/png'),content:'Area gambar',x:rect.x*100,y:rect.y*100,w:rect.w*100,h:rect.h*100});
        AnimationOCR.repair(canvas,[{x0:x,y0:y,x1:x+w,y1:y+h,padding:0}]);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));if(!blob)throw Error('Background gagal dibuat');
        if(imageUrls[currentPage]!==originalImageUrls[currentPage])URL.revokeObjectURL(imageUrls[currentPage]);imageUrls[currentPage]=URL.createObjectURL(blob);
        getEls(currentPage).push(el);updateEditorImage();renderStage();select(el.id);updateStrip();
        canvas.width=crop.width=0;setStatus('Area menjadi elemen gambar. Periksa tepi dan background; gunakan Pulihkan konten asli jika hasil belum sesuai.');
      }catch(error){setError(error.message);}finally{cleanup();}
    });
  }

  /* ══════════════════════════════════════════════════════════
     RENDER STAGE
     ══════════════════════════════════════════════════════════ */
  function renderStage() {
    if (!stageEl) return;
    stageEl.querySelectorAll('.ae-el,.ae-pdf-zone,.ae-page-hint,.ae-prev-el').forEach(e => e.remove());
    const els = getEls(currentPage);
    if (els.length === 0 && !extractionResults[currentPage]) {
      const h = document.createElement('div'); h.className = 'ae-page-hint';
      h.innerHTML = '<span>✦</span><p>Klik "Load konten halaman ini" untuk<br>membuat area teks bisa dipilih</p>';
      stageEl.append(h);
    } else {
      els.forEach(el => stageEl.append(el.isPdfZone ? buildPdfZone(el) : buildCustomEl(el)));
    }
    select(null);
  }

  /* ── PDF Zone ──────────────────────────────────────────── */
  function buildPdfZone(el) {
    const div = document.createElement('div');
    div.className = 'ae-pdf-zone'; div.dataset.id = el.id;
    div.style.left = el.x+'%'; div.style.top = el.y+'%';
    div.style.width = el.w+'%'; div.style.height = el.h+'%';
    if (el.content) div.title = el.content;
    if (el.animation?.type && el.animation.type !== 'none') {
      const b = document.createElement('span'); b.className = 'ae-zone-badge'; b.textContent = el.animation.type; div.append(b);
    }
    div.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); select(el.id); });
    return div;
  }

  /* ── Custom element (draggable) ────────────────────────── */
  function buildCustomEl(el) {
    const div = document.createElement('div');
    div.className = `ae-el ae-${el.type}${el.isExtracted?' ae-extracted':''}`; div.dataset.id = el.id;
    applyStyle(div, el);
    const span = document.createElement(el.type==='image'?'img':'span'); span.className = 'ae-el-content';if(el.type==='image'){span.src=el.src;span.alt=el.content;span.draggable=false;}else span.textContent = el.content; div.append(span);
    HANDLES.forEach(p => { const h = document.createElement('div'); h.className = 'ae-handle'; h.dataset.p = p; div.append(h); });
    const rot = document.createElement('div'); rot.className = 'ae-rotate'; rot.textContent = '↻'; div.append(rot);
    bindEl(div); return div;
  }

  function applyStyle(div, el, stageH) {
    div.style.left = el.x+'%'; div.style.top = el.y+'%';
    div.style.width = el.w+'%'; div.style.height = el.h+'%';
    div.style.transform = el.rotation ? `rotate(${el.rotation}deg)` : '';
    const s = el.style, ref = stageH || stageEl?.getBoundingClientRect().height || 600;
    div.style.fontSize   = ((s.fontSize/18)*(ref*0.033))+'px';
    div.style.fontFamily = s.fontFamily || '';
    div.style.color      = s.color   || '';
    div.style.fontWeight = s.bold    ? '700' : '400';
    div.style.fontStyle  = s.italic  ? 'italic' : '';
    div.style.textAlign  = s.align   || 'left';
    div.style.background = s.bgColor || 'transparent';
    div.style.opacity    = s.opacity ?? 1;
  }

  function bindEl(div) {
    div.addEventListener('pointerdown', e => {
      if (e.target.classList.contains('ae-handle') || e.target.classList.contains('ae-rotate')) return;
      if (div.classList.contains('ae-editing')) return;
      e.stopPropagation(); e.preventDefault(); select(div.dataset.id); startDrag(div, e);
    });
    div.addEventListener('dblclick', e => { if (!e.target.classList.contains('ae-handle') && !e.target.classList.contains('ae-rotate')) { e.stopPropagation(); startTextEdit(div); } });
    div.querySelectorAll('.ae-handle').forEach(h => h.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); select(div.dataset.id); startResize(div, h.dataset.p, e); }));
    div.querySelector('.ae-rotate')?.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); select(div.dataset.id); startRotate(div, e); });
  }

  function startDrag(div, ev) {
    const r = stageEl.getBoundingClientRect(), el = findEl(div.dataset.id); if (!el) return;
    const ox=el.x, oy=el.y, sx=ev.clientX, sy=ev.clientY;
    const mv = e => { el.x=clamp(ox+(e.clientX-sx)/r.width*100,0,100-el.w); el.y=clamp(oy+(e.clientY-sy)/r.height*100,0,100-el.h); div.style.left=el.x+'%'; div.style.top=el.y+'%'; };
    const up = () => { document.removeEventListener('pointermove',mv); document.removeEventListener('pointerup',up); updateStrip(); };
    document.addEventListener('pointermove',mv); document.addEventListener('pointerup',up);
  }

  function startResize(div, pos, ev) {
    const r = stageEl.getBoundingClientRect(), el = findEl(div.dataset.id); if (!el) return;
    const {x:ox,y:oy,w:ow,h:oh} = el, sx=ev.clientX, sy=ev.clientY;
    const mv = e => {
      const dx=(e.clientX-sx)/r.width*100, dy=(e.clientY-sy)/r.height*100;
      let nx=ox,ny=oy,nw=ow,nh=oh;
      if(pos.includes('l')){nx=clamp(ox+dx,0,ox+ow-3);nw=ox+ow-nx} if(pos.includes('r')){nw=clamp(ow+dx,3,100-ox)}
      if(pos.includes('t')){ny=clamp(oy+dy,0,oy+oh-2);nh=oy+oh-ny} if(pos.includes('b')){nh=clamp(oh+dy,2,100-oy)}
      el.x=nx;el.y=ny;el.w=nw;el.h=nh;
      div.style.left=nx+'%';div.style.top=ny+'%';div.style.width=nw+'%';div.style.height=nh+'%';
      div.style.fontSize=((el.style.fontSize/18)*(stageEl.getBoundingClientRect().height*0.033))+'px';
    };
    const up = () => { document.removeEventListener('pointermove',mv); document.removeEventListener('pointerup',up); };
    document.addEventListener('pointermove',mv); document.addEventListener('pointerup',up);
  }

  function startRotate(div, ev) {
    const el = findEl(div.dataset.id); if (!el) return;
    const r = div.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2;
    const a0 = Math.atan2(ev.clientY-cy,ev.clientX-cx)*180/Math.PI, or=el.rotation||0;
    const mv = e => { el.rotation=Math.round(or+Math.atan2(e.clientY-cy,e.clientX-cx)*180/Math.PI-a0); div.style.transform=`rotate(${el.rotation}deg)`; };
    const up = () => { document.removeEventListener('pointermove',mv); document.removeEventListener('pointerup',up); };
    document.addEventListener('pointermove',mv); document.addEventListener('pointerup',up);
  }

  function startTextEdit(div) {
    const el = findEl(div.dataset.id); if (!el) return;
    if(el.type==='image')return;
    div.classList.add('ae-editing');
    const span = div.querySelector('.ae-el-content');
    span.contentEditable = 'true'; span.focus();
    const range = document.createRange(); range.selectNodeContents(span);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    const finish = () => { span.contentEditable='false'; div.classList.remove('ae-editing'); el.content=span.textContent; updateInspector(); span.removeEventListener('blur',finish); span.removeEventListener('keydown',onKey); };
    const onKey = e => { if(e.key==='Escape'){span.textContent=el.content;finish();} };
    span.addEventListener('blur',finish); span.addEventListener('keydown',onKey);
  }

  /* ── Selection ─────────────────────────────────────────── */
  function select(id) {
    stageEl?.querySelector(`[data-id="${selectedId}"]`)?.classList.remove('selected');
    selectedId = id;
    if (id) stageEl?.querySelector(`[data-id="${id}"]`)?.classList.add('selected');
    updateInspector();
    renderOrderList();
    if ($('#ae-delete-btn')) $('#ae-delete-btn').disabled = !id;
  }

  /* ── Play order list + stagger (owner request) ───────────── */
  function elLabel(el) {
    const base = el.isPdfZone ? 'Zona PDF' : ({text:'Teks',hotspot:'Tombol',image:'Gambar'}[el.type] || el.type || 'Elemen');
    const txt = (el.content || '').trim().replace(/\s+/g, ' ').slice(0, 26);
    return txt ? `${base}: ${txt}` : base;
  }
  function renderOrderList() {
    const box = $('#ae-order-list'); if (!box) return; box.innerHTML = '';
    const els = [...getEls(currentPage)].sort((a, b) => ((a.animation?.delay) || 0) - ((b.animation?.delay) || 0) || (a.y - b.y) || (a.x - b.x));
    if (!els.length) { box.innerHTML = '<p class="ae-muted">Belum ada elemen di halaman ini.</p>'; return; }
    els.forEach((el, i) => {
      const row = document.createElement('button'); row.type = 'button';
      row.className = 'ae-order-row' + (el.id === selectedId ? ' active' : '');
      row.dataset.orderId = el.id;
      const d = document.createElement('span'); d.className = 'ae-order-delay'; d.textContent = `${i + 1} · ${(el.animation?.delay) || 0}ms`;
      const n = document.createElement('span'); n.className = 'ae-order-name'; n.textContent = elLabel(el);
      row.append(d, n); box.append(row);
    });
  }
  function staggerOrder() {
    const els = [...getEls(currentPage)].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    els.forEach((el, i) => { el.animation = el.animation || {}; el.animation.delay = i * 250; });
    const cur = selectedId && findEl(selectedId); if (cur) sv('#ae-i-anim-delay', cur.animation.delay);
    renderOrderList(); setStatus(`Urutan diatur: ${els.length} elemen, jeda 250ms.`);
  }
  function previewSelectedOut() {
    const el = selectedId ? findEl(selectedId) : null; if (!el) return;
    const node = stageEl?.querySelector(`[data-id="${selectedId}"]`); if (!node) return;
    const type = el.animation?.out && el.animation.out !== 'none' ? el.animation.out : 'fadeOut';
    if (window.AnimationPlayback?.previewOut) window.AnimationPlayback.previewOut(node, type, el.animation?.duration);
  }

  /* ══════════════════════════════════════════════════════════
     INSPECTOR
     ══════════════════════════════════════════════════════════ */
  function updateInspector() {
    const el = selectedId ? findEl(selectedId) : null;
    const panel = $('#ae-inspector'), hint = $('#ae-inspector-hint');
    if (!panel) return;
    panel.classList.toggle('hidden', !el);
    if (hint) hint.style.display = el ? 'none' : '';
    if (!el) return;

    const isPdf = !!el.isPdfZone;
    const contentSec = $('#ae-insp-content-sec'), styleSec = $('#ae-insp-style-sec');
    const zoneInfo   = $('#ae-zone-content-info');
    if (contentSec) contentSec.classList.toggle('ae-hidden-row', isPdf||el.type==='image');
    if (styleSec)   styleSec.classList.toggle('ae-hidden-row', isPdf||el.type==='image');
    if (zoneInfo) {
      zoneInfo.style.display = isPdf ? '' : 'none';
      if (isPdf) zoneInfo.textContent = el.content ? `"${el.content.slice(0,120)}${el.content.length>120?'…':''}"` : '(kosong)';
    }
    if (!isPdf) {
      sv('#ae-i-content', el.content); sv('#ae-i-fs', el.style.fontSize);
      sv('#ae-i-color', el.style.color||'#1a1a1a'); sv('#ae-i-bgcolor', el.style.bgColor||'#ffffff');
      sv('#ae-i-opacity', Math.round((el.style.opacity??1)*100));
      $('#ae-i-bold')  ?.classList.toggle('on', el.style.bold);
      $('#ae-i-italic')?.classList.toggle('on', el.style.italic);
      ['left','center','right'].forEach(a => $(`#ae-i-align-${a}`)?.classList.toggle('on', el.style.align===a));
    }
    sv('#ae-i-anim-type', el.animation.type); sv('#ae-i-anim-delay', el.animation.delay); sv('#ae-i-anim-dur', el.animation.duration);
    sv('#ae-i-anim-out', el.animation.out || 'none');
    const lt = el.link?.type||'none';
    sv('#ae-i-link-type', lt); sv('#ae-i-link-url', lt==='url'?el.link.target:''); sv('#ae-i-link-page', lt==='page'?el.link.target:'');
    $('#ae-i-link-url-row') ?.classList.toggle('ae-hidden-row', lt!=='url');
    $('#ae-i-link-page-row')?.classList.toggle('ae-hidden-row', lt!=='page');
  }

  function sv(id, val) { const n=$(id); if(n) n.value=val; }

  function bindInspector() {
    const pS = patch => { const el=selectedId?findEl(selectedId):null; if(!el||el.isPdfZone)return; Object.assign(el.style,patch); const d=stageEl?.querySelector(`[data-id="${selectedId}"]`); if(d)applyStyle(d,el); };
    const pA = patch => { const el=selectedId?findEl(selectedId):null; if(!el)return; Object.assign(el.animation,patch); refreshBadge(el); renderOrderList(); };
    const lnk = () => {
      const el=selectedId?findEl(selectedId):null; if(!el)return;
      const lt=$('#ae-i-link-type')?.value||'none';
      $('#ae-i-link-url-row') ?.classList.toggle('ae-hidden-row',lt!=='url');
      $('#ae-i-link-page-row')?.classList.toggle('ae-hidden-row',lt!=='page');
      el.link = lt==='none'?null:lt==='url'?{type:'url',target:$('#ae-i-link-url')?.value||''}:{type:'page',target:Number($('#ae-i-link-page')?.value||1)};
      const valid=!el.link||AnimationPlayback.safeLink(el.link,pageCount);
      const feedback=$('#ae-link-feedback');if(feedback)feedback.textContent=valid?'Link dijalankan saat Preview atau pada hasil ekspor.':lt==='page'?`Isi nomor halaman 1–${pageCount}.`:'Isi alamat tujuan, misalnya https://contoh.com.';
    };
    on('#ae-i-content', 'input', e => { const el=selectedId?findEl(selectedId):null; if(el&&!el.isPdfZone){el.content=e.target.value;const sp=stageEl?.querySelector(`[data-id="${selectedId}"] .ae-el-content`);if(sp)sp.textContent=e.target.value;} });
    on('#ae-i-fs',      'input', e => pS({fontSize:Number(e.target.value)}));
    on('#ae-i-color',   'input', e => pS({color:e.target.value}));
    on('#ae-i-bgcolor', 'input', e => pS({bgColor:e.target.value}));
    on('#ae-i-opacity', 'input', e => pS({opacity:Number(e.target.value)/100}));
    on('#ae-i-bold',    'click', () => { const el=selectedId?findEl(selectedId):null; if(el&&!el.isPdfZone){pS({bold:!el.style.bold});$('#ae-i-bold')?.classList.toggle('on',el.style.bold);} });
    on('#ae-i-italic',  'click', () => { const el=selectedId?findEl(selectedId):null; if(el&&!el.isPdfZone){pS({italic:!el.style.italic});$('#ae-i-italic')?.classList.toggle('on',el.style.italic);} });
    ['left','center','right'].forEach(a => on(`#ae-i-align-${a}`,'click',()=>{pS({align:a});['left','center','right'].forEach(b=>$(`#ae-i-align-${b}`)?.classList.toggle('on',b===a));}));
    on('#ae-i-anim-type',  'change', e => pA({type:e.target.value}));
    on('#ae-i-anim-delay', 'input',  e => pA({delay:Number(e.target.value)}));
    on('#ae-i-anim-dur',   'input',  e => pA({duration:Number(e.target.value)}));
    on('#ae-i-anim-out',   'change', e => pA({out:e.target.value}));
    on('#ae-i-anim-out-preview', 'click', previewSelectedOut);
    on('#ae-order-stagger', 'click', staggerOrder);
    document.querySelector('#ae-order-list')?.addEventListener('click', e => {
      const row = e.target.closest('[data-order-id]'); if (row) select(row.dataset.orderId);
    });
    on('#ae-i-link-type',  'change', lnk); on('#ae-i-link-url','input',lnk); on('#ae-i-link-page','input',lnk);
  }

  function refreshBadge(el) {
    const div = stageEl?.querySelector(`[data-id="${el.id}"]`); if(!div||!el.isPdfZone)return;
    let b=div.querySelector('.ae-zone-badge');
    if(el.animation.type!=='none'){if(!b){b=document.createElement('span');b.className='ae-zone-badge';div.append(b);}b.textContent=el.animation.type;}
    else b?.remove();
  }

  function on(sel,ev,fn){$(sel)?.addEventListener(ev,fn);}

  /* ══════════════════════════════════════════════════════════
     NAVIGATION & PAGE STRIP
     ══════════════════════════════════════════════════════════ */
  function buildStrip() {
    if(!stripEl)return; stripEl.innerHTML='';
    for(let i=0;i<pageCount;i++){
      const btn=document.createElement('button');
      btn.className='ae-strip-btn'+(i===currentPage?' active':''); btn.type='button'; btn.title=`Hal. ${i+1}`; btn.textContent=i+1;
      if((pages[i]?.elements?.length||0)>0){const d=document.createElement('span');d.className='ae-dot';btn.append(d);}
      btn.addEventListener('click',()=>{if(i!==currentPage)goPage(i);});
      stripEl.append(btn);
    }
  }

  function updateStrip() {
    stripEl?.querySelectorAll('.ae-strip-btn').forEach((btn,i)=>{
      btn.classList.toggle('active',i===currentPage);
      const hasDot=btn.querySelector('.ae-dot'), hasEls=(pages[i]?.elements?.length||0)>0;
      if(hasEls&&!hasDot){const d=document.createElement('span');d.className='ae-dot';btn.append(d);}
      else if(!hasEls&&hasDot)hasDot.remove();
    });
  }

  function goPage(i) {
    if(i<0||i>=pageCount||loading||importing||exporting||extracting)return;
    currentPage=i; updateEditorImage(); resizeWrap();
    if(mode==='edit')renderStage(); else playPreview(i);
    select(null); updateStrip(); updatePageLabel(); updateNavBtns();
    if(mode==='edit'){setError('');setStatus(extractionResults[i]?.message||`Halaman ${i+1} belum diperiksa. Klik Load konten halaman ini.`);}
  }

  function updatePageLabel(){const e=$('#ae-page-label');if(e)e.textContent=pageCount?`Hal. ${currentPage+1} / ${pageCount}`:'';  }
  function updateEditorImage(){const img=wrapEl?.querySelector('.ae-page-img');if(img&&imageUrls[currentPage]){img.src=imageUrls[currentPage];img.alt=`Hal. ${currentPage+1}`;}}
  function updateNavBtns(){if($('#ae-prev'))$('#ae-prev').disabled=currentPage===0;if($('#ae-next'))$('#ae-next').disabled=currentPage===pageCount-1;}

  function resizeWrap(){
    if(!wrapEl||!pageCount)return;
    const area=$('.ae-canvas-scroll');if(!area)return;
    const availW=Math.max(1,area.clientWidth-40),availH=Math.max(1,area.clientHeight-40);
    const img=wrapEl.querySelector('.ae-page-img');
    const info=pageVpInfo[currentPage];
    const ratio=info?info.pdfW/info.pdfH:0.707;
    let w=availW,h=w/ratio;
    if(h>availH){h=availH;w=h*ratio;}
    wrapEl.style.width=Math.round(w)+'px';wrapEl.style.height=Math.round(h)+'px';
    stageEl?.querySelectorAll('.ae-el').forEach(div=>{const el=findEl(div.dataset.id);if(el)applyStyle(div,el,h);});
  }
  window.addEventListener('resize',resizeWrap);

  function updateButtons(){
    const busy=loading||importing||exporting||extracting,ready=pageCount>0&&!busy;
    ['#ae-add-text','#ae-add-hotspot','#ae-load-page','#ae-load-all','#ae-clear-zones','#ae-export','#ae-mode-edit','#ae-mode-preview','#ae-ocr-page','#ae-extract-region'].forEach(id=>{if($(id))$(id).disabled=!ready;});
    if($('#ae-doc-file'))$('#ae-doc-file').disabled=busy;
    $('#ae-inspector')?.querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=busy);
    stripEl?.querySelectorAll('button').forEach(el=>el.disabled=busy);
    updateNavBtns();if(busy){$('#ae-prev').disabled=true;$('#ae-next').disabled=true;}
  }

  /* ══════════════════════════════════════════════════════════
     PREVIEW MODE
     ══════════════════════════════════════════════════════════ */
  function setMode(m){
    previewPlayer?.destroy();previewPlayer=null;
    mode=m;
    $('#ae-mode-edit')   ?.classList.toggle('active',m==='edit');
    $('#ae-mode-preview')?.classList.toggle('active',m==='preview');
    if(!stageEl)return;
    if(m==='edit'){stageEl.querySelectorAll('.ae-prev-el').forEach(e=>e.remove());renderStage();}
    else{stageEl.querySelectorAll('.ae-el,.ae-pdf-zone,.ae-page-hint').forEach(e=>e.remove());select(null);playPreview(currentPage);}
    updateNavBtns();
  }

  function playPreview(index){
    if(!stageEl)return;
    previewPlayer?.destroy();
    previewPlayer=AnimationPlayback.mount(stageEl,getEls(index),{count:pageCount,goPage});
    previewPlayer.play();
    const invalid=getEls(index).filter(el=>el.link&&!AnimationPlayback.safeLink(el.link,pageCount));
    if(invalid.length){setStatus(`Halaman ${index+1}: ${invalid.length} link belum valid. Kembali ke Edit, pilih tombolnya dan isi URL atau nomor halaman tujuan.`);return;}
    const active=getEls(index).filter(el=>el.animation?.type&&el.animation.type!=='none');
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    setStatus(reduced?'Efek gerak dinonaktifkan oleh pengaturan kurangi gerakan perangkat.':active.length?`Preview halaman ${index+1}: ${active.length} efek. Klik Preview untuk ulang.`:`Halaman ${index+1} belum memiliki animasi aktif. Kembali ke Edit, tambah/pilih elemen lalu pilih tipe animasi.`);
  }

  /* ══════════════════════════════════════════════════════════
     ACTIONS
     ══════════════════════════════════════════════════════════ */
  function addCustomEl(type){
    if(!pageCount||loading||importing||exporting||extracting)return; if(mode!=='edit')setMode('edit');
    const el=makeCustomEl(type); getEls(currentPage).push(el);
    stageEl?.querySelector('.ae-page-hint')?.remove(); stageEl?.append(buildCustomEl(el));
    select(el.id); updateStrip();
    if(type==='hotspot'){setStatus('Tombol link dibuat. Isi URL di Pengaturan elemen, lalu klik tombolnya dalam Preview.');$('#ae-i-link-url')?.focus();$('#ae-i-link-url')?.scrollIntoView?.({block:'nearest'});}
  }

  function deleteSelected(){
    if(!selectedId)return;
    const idx=getEls(currentPage).findIndex(e=>e.id===selectedId);
    if(idx!==-1)getEls(currentPage).splice(idx,1);
    stageEl?.querySelector(`[data-id="${selectedId}"]`)?.remove();
    select(null); if(getEls(currentPage).length===0)renderStage(); updateStrip();
  }

  function clearZones(){
    if(!pageCount||loading||importing||exporting||extracting)return;
    if(mode!=='edit')setMode('edit');
    pages[currentPage]={elements:getEls(currentPage).filter(e=>!e.isPdfZone&&!e.isExtracted&&!e.isExtractedImage)};
    delete extractionResults[currentPage];
    if(imageUrls[currentPage]!==originalImageUrls[currentPage])URL.revokeObjectURL(imageUrls[currentPage]);
    imageUrls[currentPage]=originalImageUrls[currentPage];updateEditorImage();
    renderStage();select(null);updateStrip();setStatus('Ekstraksi dibatalkan; halaman asli dipulihkan.');
  }

  /* ══════════════════════════════════════════════════════════
     EXPORT HTML ZIP
     ══════════════════════════════════════════════════════════ */
  async function exportHTML(){
    if(!pageCount||exporting||loading||importing||extracting)return;
    exporting=true;updateButtons();setStatus('Menyiapkan export…');setError('');
    try{
      const title=($('#ae-title')?.value.trim()||sourceName.replace(/\.pdf$/i,'')||'Flipbook');
      const info=pageVpInfo[0];
      const ratio=info?info.pdfW/info.pdfH:0.707;
      const safeTitle=title.replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'flipbook';
      const filename=safeTitle+'-interaktif.zip';
      const saveHandle=await FlipbookExport.chooseSave(filename);
      const pagesData={};
      for(const[k,v]of Object.entries(pages)){if(!v?.elements?.length)continue;pagesData[k]={elements:v.elements.map(e=>({id:e.id,src:e.type==='image'?e.src:undefined,isExtracted:!!e.isExtracted,type:e.isPdfZone?'pdfZone':e.type,x:e.x,y:e.y,w:e.w,h:e.h,rotation:e.rotation,content:e.content,style:{...e.style},animation:{...e.animation},link:e.link?{...e.link}:null}))};}
      const data={version:2,title,pageCount,ratio,overlays:{},pages:pagesData,pageRatios:pageVpInfo.map(p=>p.pdfW/p.pdfH)};
      for(const page of Object.values(pagesData))for(const el of page.elements)if(el.link&&!AnimationPlayback.safeLink(el.link,pageCount))throw Error('Link tidak valid. Gunakan http(s), mailto, tel, atau nomor halaman yang ada.');
      const zip=new JSZip();
      const txt=async p=>{const r=await fetch(p);if(!r.ok)throw Error('Missing: '+p);return r.text();};
      const bin=async p=>{const r=await fetch(p);if(!r.ok)throw Error('Missing: '+p);return r.arrayBuffer();};
      for(const f of['index.html','viewer.css','book-effects.css','layout.js','viewer.js'])zip.file(f,await txt('assets/export/'+f));
      zip.file('page-flip.browser.js',await bin('assets/vendor/page-flip.browser.js'));
      zip.file('ENGINE-SOURCE.md',await txt('assets/vendor/SOURCE.md'));
      zip.file('PAGEFLIP-LICENSE.txt',await txt('assets/vendor/PAGEFLIP-LICENSE.txt'));
      const shell=await zip.file('index.html').async('string');
      zip.file('index.html',shell.replace('<script defer src="viewer.js"></script>','<link rel="stylesheet" href="animation-playback.css"><script defer src="animation-playback.js"></script><script defer src="viewer.js"></script>'));
      zip.file('animation-playback.js',await txt('assets/animation-playback.js'));
      zip.file('animation-playback.css',await txt('assets/animation-playback.css'));
      zip.file('JSZIP-LICENSE.txt',await txt('assets/vendor/JSZIP-LICENSE.txt'));
      zip.file('book-data.js','window.FLIPBOOK_DATA = '+JSON.stringify(data).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')+';\n');
      zip.file('book.json',JSON.stringify(data,null,2));
      zip.file('BUKA-BUKU.txt','Extract semua file, lalu buka index.html di browser.\nTidak butuh internet atau server.\n');
      for(let i=0;i<imageUrls.length;i++){setStatus(`Paket halaman ${i+1}/${imageUrls.length}…`);const r=await fetch(imageUrls[i]);if(!r.ok)throw Error('Page image unavailable.');zip.file(`pages/${i+1}.jpg`,await r.arrayBuffer());}
      setStatus('Membuat ZIP…');
      const blob=await zip.generateAsync({type:'blob',compression:'STORE'},m=>setStatus(`Kompres ${Math.round(m.percent)}%…`));
      await FlipbookExport.saveBlob(blob,filename,saveHandle);
      setStatus('Export selesai! Extract ZIP dan buka index.html.');
    }catch(err){if(err.name==='AbortError'){setStatus('Penyimpanan dibatalkan.');}else{setError('Export gagal: '+(err.message||err));setStatus('');}}
    finally{exporting=false;updateButtons();}
  }

  /* ── Status ──────────────────────────────────────────────── */
  function setStatus(msg){const e=$('#ae-status');if(e)e.textContent=msg;const status=$('#ae-action-status');if(status&&!$('#ae-error')?.textContent)status.textContent=msg;}
  function setError(msg){const e=$('#ae-error');if(!e)return;e.textContent=msg;e.classList.toggle('visible',!!msg);const status=$('#ae-action-status');if(status){status.textContent=msg||$('#ae-status')?.textContent||'';status.classList.toggle('is-error',!!msg);}}

  /* ══════════════════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════════════════ */
  function init(){
    stripEl=$('#ae-strip');

    on('#ae-doc-file',    'change', e=>{const f=e.target.files[0];e.target.value='';if(f)handleFileInput(f);});
    on('#ae-mode-edit',   'click',  ()=>{if(mode!=='edit')setMode('edit');});
    on('#ae-mode-preview','click',  ()=>setMode('preview'));
    on('#ae-add-text',    'click',  ()=>addCustomEl('text'));
    on('#ae-add-hotspot', 'click',  ()=>addCustomEl('hotspot'));
    on('#ae-load-page',   'click',  ()=>loadTextLayers(false));
    on('#ae-load-all',    'click',  ()=>loadTextLayers(true));
    on('#ae-ocr-page','click',ocrCurrentPage);
    on('#ae-extract-region','click',startRegionExtraction);
    on('#ae-clear-zones', 'click',  ()=>clearZones());
    on('#ae-delete-btn',  'click',  ()=>deleteSelected());
    on('#ae-prev',        'click',  ()=>goPage(currentPage-1));
    on('#ae-next',        'click',  ()=>goPage(currentPage+1));
    on('#ae-export',      'click',  ()=>exportHTML());

    bindInspector();

    document.addEventListener('keydown',e=>{
      if(e.target.closest('input,textarea,select,[contenteditable]'))return;
      if((e.key==='Delete'||e.key==='Backspace')&&selectedId){e.preventDefault();deleteSelected();}
      if(e.key==='Escape')select(null);
    });

    updateButtons();
    setStatus('Upload dokumen untuk memulai.');
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
