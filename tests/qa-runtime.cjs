// Optional integration harness: npm install --prefix .build/qa-runtime jsdom @napi-rs/canvas
// Uses the real PageFlip engine and PDF.js; DOM dimensions are simulated, not visual QA.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('../.build/qa-runtime/node_modules/jsdom');
const canvasLib=require('../.build/qa-runtime/node_modules/@napi-rs/canvas');
global.DOMMatrix=canvasLib.DOMMatrix;global.Path2D=canvasLib.Path2D;
const pdfjs=require('../assets/vendor/pdf.min.js');
pdfjs.GlobalWorkerOptions.workerSrc=path.resolve(__dirname,'../assets/vendor/pdf.worker.min.js');
global.JSZip=require('../assets/vendor/jszip.min.js');require('../assets/flipbook-export.js');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.build/qa');fs.mkdirSync(out,{recursive:true});
function fixture(count,width,height){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',''];
 for(let i=0;i<count;i++){
  const content=`q ${(i%3)/4+.2} .45 .3 rg 0 0 ${width} ${height} re f .9 .85 .6 rg 20 20 ${width-40} ${height-40} re f Q`;
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents ${4+i*2} 0 R >>`);
  objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
 }
 objects[1]=`<< /Type /Pages /Count ${count} /Kids [${Array.from({length:count},(_,i)=>`${3+i*2} 0 R`).join(' ')}] >>`;
 let text='%PDF-1.4\n',offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${object}\nendobj\n`});
 const xref=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('');
 text+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return new Blob([text],{type:'application/pdf'});
}
function runtime(file,model,width=1200,height=720){
 const dom=new JSDOM(fs.readFileSync(path.join(root,file),'utf8'),{url:'http://127.0.0.1:8080/'+file,runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,errors=[];let clock=0,rafId=0;const frames=new Map();
 w.addEventListener('error',event=>errors.push(event.error||event.message));
 w.matchMedia=()=>({matches:false});w.ResizeObserver=class{observe(){}disconnect(){}};
 w.requestAnimationFrame=callback=>{frames.set(++rafId,callback);return rafId};w.cancelAnimationFrame=id=>frames.delete(id);
 Object.defineProperty(w.performance,'now',{value:()=>clock});
 for(const key of ['clientWidth','offsetWidth'])Object.defineProperty(w.HTMLElement.prototype,key,{configurable:true,get(){return width}});
 for(const key of ['clientHeight','offsetHeight'])Object.defineProperty(w.HTMLElement.prototype,key,{configurable:true,get(){const stage=w.document.querySelector('#reader-stage');return stage?.style.height.endsWith('px')?parseFloat(stage.style.height):height}});
 w.HTMLElement.prototype.getBoundingClientRect=function(){return {x:0,y:0,left:0,top:0,width:this.offsetWidth,height:this.offsetHeight,right:this.offsetWidth,bottom:this.offsetHeight}};
 const load=file=>w.eval(fs.readFileSync(path.join(root,file),'utf8'));
 load('assets/vendor/page-flip.browser.js');
 const Original=w.St.PageFlip;w.St.PageFlip=class extends Original{constructor(...args){super(...args);w.engine=this}};
 load('assets/export/layout.js');
 if(model){w.FLIPBOOK_DATA=JSON.parse(JSON.stringify(model));load('assets/export/viewer.js')}
 const pump=(ms=1400)=>{for(let t=0;t<ms;t+=20){clock+=20;const tasks=[...frames.values()];frames.clear();tasks.forEach(fn=>fn(clock))}};
 return {dom,w,errors,load,pump,resize(newWidth,newHeight){width=newWidth;height=newHeight;w.engine.update();w.dispatchEvent(new w.Event('resize'))}};
}
async function testViewer(count,ratio,width=1200){
 const data={version:1,title:'QA',pageCount:count,ratio,overlays:{}};
 const test=runtime('assets/export/index.html',data,width);test.pump();
 const {w}=test;assert.equal(w.document.querySelector('#error').hidden,true,w.document.querySelector('#error').textContent);
 assert.equal(w.engine.getCurrentPageIndex(),0);const originalWidth=w.engine.getBoundsRect().pageWidth;
 let steps=0;
 while(!w.document.querySelector('#next').disabled&&steps++<count+2){w.document.querySelector('#next').click();test.pump();assert.equal(w.engine.getState(),'read');assert.ok(Math.abs(w.engine.getBoundsRect().pageWidth-originalWidth)<.01,'cover and page sizes differ')}
 assert.ok(steps<=count+1,'navigation stuck before last page');
 const last=w.engine.getCurrentPageIndex();assert.ok(last>=count-2,`last page unreachable: ${last}/${count}`);
 w.document.querySelector('#home').click();test.pump();
 assert.equal(w.engine.getCurrentPageIndex(),0,'Home must return to cover');
 assert.equal(w.document.querySelector('#home').disabled,true);
 w.engine.turnToPage(last);test.pump();
 steps=0;while(!w.document.querySelector('#prev').disabled&&steps++<count+2){w.document.querySelector('#prev').click();test.pump()}
 assert.equal(w.engine.getCurrentPageIndex(),0);assert.equal(test.errors.length,0,String(test.errors));
 w.engine.destroy();w.close();console.log(`PASS actual PageFlip DOM runtime: ${count} pages, ratio ${ratio}, viewport ${width}`);
}
async function main(){
 for(const [count,ratio,width] of [[1,.7,1200],[2,1.78,1200],[3,1,1200],[8,16/9,1200],[8,.7,390],[5,3,1200],[4,.3,1200]])await testViewer(count,ratio,width);
 const source=fixture(8,960,540);fs.writeFileSync(path.join(out,'qa-landscape.pdf'),Buffer.from(await source.arrayBuffer()));
 const pdf=await pdfjs.getDocument({data:new Uint8Array(await source.arrayBuffer()),isEvalSupported:false}).promise;
 const urls=[];
 for(let index=1;index<=pdf.numPages;index++){
  const page=await pdf.getPage(index),viewport=page.getViewport({scale:1});
  const canvas=canvasLib.createCanvas(viewport.width,viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
  const filename=path.join(out,`page-${index}.jpg`);fs.writeFileSync(filename,canvas.toBuffer('image/jpeg'));urls.push(filename);page.cleanup();
 }
 await pdf.destroy();
 const fetchOriginal=global.fetch;global.fetch=async file=>new Response(fs.readFileSync(path.isAbsolute(file)?file:path.join(root,file)));
 const model={version:1,title:'QA Final Export',pageCount:8,ratio:960/540,overlays:{'2':{label:'QA statistic',value:1250,position:'bottom-right'}}};
 const bundle=await FlipbookExport.packageBook(model,urls);fs.writeFileSync(path.join(out,'qa-final-HTML.zip'),Buffer.from(await bundle.arrayBuffer()));
 const saved=await FlipbookExport.saveProject(model,source);fs.writeFileSync(path.join(out,'qa-final.flipbook'),Buffer.from(await saved.arrayBuffer()));
 const restored=await FlipbookExport.readProject(saved);
 // validate() adds 'pages:{}' to all results; compare relevant fields
 assert.equal(restored.data.title,model.title);assert.equal(restored.data.pageCount,model.pageCount);
 assert.equal(restored.data.ratio,model.ratio);assert.deepEqual(restored.data.overlays,model.overlays);
 assert.deepEqual(Buffer.from(await restored.pdf.arrayBuffer()),Buffer.from(await source.arrayBuffer()));
 global.fetch=fetchOriginal;console.log('PASS real PDF rendering -> JPEG -> HTML ZIP, editable project round-trip');
}
module.exports={runtime,fixture};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1});
