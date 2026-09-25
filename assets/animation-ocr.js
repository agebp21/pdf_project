'use strict';
globalThis.AnimationOCR=(()=>{
  let worker=null,loading=null,progress=()=>{};
  async function engine(){
    if(!globalThis.Tesseract){
      loading ||= new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='assets/vendor/ocr/tesseract.min.js';script.onload=resolve;script.onerror=()=>{loading=null;reject(Error('Engine OCR lokal gagal dimuat.'));};document.head.append(script);});
      await loading;
    }
    if(!worker)worker=await Tesseract.createWorker('eng+ind+msa',1,{
      workerPath:new URL('assets/vendor/ocr/worker.min.js',location.href).href,
      corePath:new URL('assets/vendor/ocr/',location.href).href,
      langPath:new URL('assets/vendor/ocr',location.href).href,
      logger:event=>progress(event),cacheMethod:'write'
    });
    return worker;
  }
  // Approximate background repair from each word's perimeter. This cannot
  // reconstruct hidden artwork; always preserve the original for restoration.
  function repair(canvas,boxes){
    const ctx=canvas.getContext('2d'),image=ctx.getImageData(0,0,canvas.width,canvas.height),original=new Uint8ClampedArray(image.data),out=image.data,w=canvas.width,h=canvas.height;
    const mask=new Uint8Array(w*h),horizontalSpan=new Uint32Array(w*h);
    for(const box of boxes){
      const pad=box.padding??Math.max(3,Math.ceil((box.y1-box.y0)*.2));
      const x0=Math.max(0,Math.floor(box.x0)-pad),y0=Math.max(0,Math.floor(box.y0)-pad),x1=Math.min(w-1,Math.ceil(box.x1)+pad),y1=Math.min(h-1,Math.ceil(box.y1)+pad);
      for(let y=y0;y<=y1;y++)mask.fill(1,y*w+x0,y*w+x1+1);
    }
    // Fill unioned masks, so adjacent words never sample each other's pixels.
    for(let y=0;y<h;y++)for(let x=0;x<w;){
      if(!mask[y*w+x]){x++;continue;}const start=x;while(x<w&&mask[y*w+x])x++;const end=x;
      const left=Math.max(0,start-1),right=Math.min(w-1,end);
      for(let col=start;col<end;col++){const i=y*w+col,t=(col-left)/Math.max(1,right-left);horizontalSpan[i]=end-start;
        for(let c=0;c<3;c++)out[i*4+c]=original[(y*w+left)*4+c]*(1-t)+original[(y*w+right)*4+c]*t;
      }
    }
    for(let x=0;x<w;x++)for(let y=0;y<h;){
      if(!mask[y*w+x]){y++;continue;}const start=y;while(y<h&&mask[y*w+x])y++;const end=y;
      const top=Math.max(0,start-1),bottom=Math.min(h-1,end);
      for(let row=start;row<end;row++){const i=row*w+x,t=(row-top)/Math.max(1,bottom-top),weight=horizontalSpan[i]/(horizontalSpan[i]+end-start);
        for(let c=0;c<3;c++){const vertical=original[(top*w+x)*4+c]*(1-t)+original[(bottom*w+x)*4+c]*t;out[i*4+c]=out[i*4+c]*(1-weight)+vertical*weight;}
      }
    }
    const colors=boxes.map(box=>{
      let strongest=-1,color=[34,34,34];
      for(let y=Math.max(0,Math.floor(box.y0));y<Math.min(h,Math.ceil(box.y1));y++)for(let x=Math.max(0,Math.floor(box.x0));x<Math.min(w,Math.ceil(box.x1));x++){
        const p=(y*w+x)*4,difference=Math.abs(original[p]-out[p])+Math.abs(original[p+1]-out[p+1])+Math.abs(original[p+2]-out[p+2]);
        if(difference>strongest){strongest=difference;color=[original[p],original[p+1],original[p+2]];}
      }
      return '#'+color.map(v=>v.toString(16).padStart(2,'0')).join('');
    });
    ctx.putImageData(image,0,0);return colors;
  }
  async function read(canvas,onProgress){
    progress=onProgress||(()=>{});const instance=await engine();
    await instance.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
    const {data}=await instance.recognize(canvas);
    // A second pass isolates dark lettering on colored infographics.
    const contrast=document.createElement('canvas');contrast.width=canvas.width;contrast.height=canvas.height;
    const ctx=contrast.getContext('2d');ctx.drawImage(canvas,0,0);const pixels=ctx.getImageData(0,0,contrast.width,contrast.height);
    for(let i=0;i<pixels.data.length;i+=4){const value=Math.max(pixels.data[i],pixels.data[i+1],pixels.data[i+2])<125?0:255;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=value;}
    ctx.putImageData(pixels,0,0);
    let extra;try{extra=(await instance.recognize(contrast)).data;}finally{contrast.width=contrast.height=0;}
    const lines=[];
    for(const line of [...(data.lines||[]),...(extra.lines||[])]){
      const words=(line.words||[]).filter(word=>/[\p{L}\p{N}]/u.test(word.text||'')&&word.confidence>=45);
      if(!words.length)continue;
      const bbox={x0:Math.min(...words.map(w=>w.bbox.x0)),y0:Math.min(...words.map(w=>w.bbox.y0)),x1:Math.max(...words.map(w=>w.bbox.x1)),y1:Math.max(...words.map(w=>w.bbox.y1))};
      const candidate={text:words.map(w=>w.text).join(' '),confidence:words.reduce((sum,w)=>sum+w.confidence,0)/words.length,bbox,words:words.map(w=>w.bbox)};
      const duplicate=lines.findIndex(old=>{const a=old.bbox,b=bbox,intersection=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));return intersection/Math.max(1,Math.min((a.x1-a.x0)*(a.y1-a.y0),(b.x1-b.x0)*(b.y1-b.y0)))>.6;});
      if(duplicate<0)lines.push(candidate);else if(candidate.confidence>lines[duplicate].confidence)lines[duplicate]=candidate;
    }
    return lines.sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);
  }
  async function release(){const instance=worker;worker=null;if(instance)await instance.terminate();}
  return {read,repair,release};
})();
