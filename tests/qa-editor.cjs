const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {runtime,fixture}=require('./qa-runtime.cjs');
const canvas=require('../.build/qa-runtime/node_modules/@napi-rs/canvas');
const {indexedDB}=require('../.build/qa-runtime/node_modules/fake-indexeddb');
const pdfjs=require('../assets/vendor/pdf.min.js');
const root=path.resolve(__dirname,'..');
pdfjs.GlobalWorkerOptions.workerSrc=path.join(root,'assets/vendor/pdf.worker.min.js');
async function until(test,predicate,label){for(let i=0;i<500;i++){test.pump(40);await new Promise(r=>setTimeout(r,5));if(predicate())return}throw Error('Timed out: '+label+' / '+test.w.document.querySelector('#reader-error').textContent)}
function install(test){
 const w=test.w;w.Blob=Blob;w.fetch=url=>fetch(new URL(url,w.location.href));
 w.URL.createObjectURL=URL.createObjectURL;w.URL.revokeObjectURL=URL.revokeObjectURL;
 w.indexedDB=indexedDB;w.structuredClone=structuredClone;
 w.pdfjsLib={GlobalWorkerOptions:{},getDocument:options=>pdfjs.getDocument(options)};
 w.HTMLCanvasElement.prototype.getContext=function(){if(!this.native||this.native.width!==this.width||this.native.height!==this.height)this.native=canvas.createCanvas(this.width,this.height);return this.native.getContext('2d')};
 w.HTMLCanvasElement.prototype.toBlob=function(callback){callback(new Blob([this.native.toBuffer('image/jpeg')],{type:'image/jpeg'}))};
 // Use the same bundled JSZip through Node to avoid jsdom's postMessage scheduler.
 w.JSZip=require('../assets/vendor/jszip.min.js');test.load('assets/flipbook-export.js');test.load('assets/flipbook-transfer.js');
 const files=new Map();w.showSaveFilePicker=async options=>({createWritable:async()=>({write:async blob=>{files.set(options.suggestedName,blob)},close:async()=>{},abort:async()=>{}})});
 return files;
}
async function main(){
 const test=runtime('flipbook.html',null,1200),w=test.w,files=install(test);
 test.load('assets/flipbook.js');
 const input=w.document.querySelector('#pdf-file');
 const source=fixture(8,960,540);source.name='QA landscape.pdf';
 Object.defineProperty(input,'files',{configurable:true,value:[source]});input.dispatchEvent(new w.Event('change'));
 await until(test,()=>/8 (halaman siap|pages ready)/.test(w.document.querySelector('#load-status').textContent),'load PDF');
 test.pump(100);
 assert.equal(w.document.querySelector('#reader-error').hidden,true,w.document.querySelector('#reader-error').textContent);
 assert.equal(w.document.querySelector('#overlay-form').hidden,true);assert.equal(w.document.querySelector('.playback').hidden,true);
 const height=w.document.querySelector('#reader-stage').style.height;
 w.document.querySelector('#next').click();test.pump(1400);
 assert.equal(w.engine.getCurrentPageIndex(),1);assert.equal(w.document.querySelector('#reader-stage').style.height,height);
 w.document.querySelector('#home').click();test.pump();
 assert.equal(w.engine.getCurrentPageIndex(),0);assert.equal(w.document.querySelector('#home').disabled,true);
 w.document.querySelector('#save-project').click();await until(test,()=>files.size===1,'save project');
 const saved=[...files.values()][0];assert.ok(saved.size>0);
 await until(test,()=>!w.document.querySelector('#export-fields').disabled,'save unlock');
 const projectInput=w.document.querySelector('#project-file');
 Object.defineProperty(projectInput,'files',{configurable:true,value:[saved]});projectInput.dispatchEvent(new w.Event('change'));
 await until(test,()=>!projectInput.disabled,'restore project');
 assert.equal(w.engine.getPageCount(),8);assert.equal(w.document.querySelector('#reader-error').hidden,true);
 w.document.querySelector('#export-html').click();await until(test,()=>files.size===2,'export HTML');
 await until(test,()=>!w.document.querySelector('#export-fields').disabled,'export unlock');
 const zip=[...files.entries()].find(([name])=>name.endsWith('.zip'))[1];
 const parsed=await w.JSZip.loadAsync(await zip.arrayBuffer());assert.ok(parsed.file('book-effects.css'));assert.ok(parsed.file('pages/8.jpg'));
 fs.writeFileSync(path.join(root,'.build/qa/qa-from-editor-HTML.zip'),Buffer.from(await zip.arrayBuffer()));
 // Simulate a server restart after page load: build must fetch a fresh token.
 const normalFetch=w.fetch;let submitted=[];
 w.fetch=async(url,options)=>{
   if(url==='/api/capabilities')return new Response(JSON.stringify({apk:true,exe:true,token:'fresh-session'}));
   if(String(url).startsWith('/api/build/')){assert.equal(options.headers['X-Build-Token'],'fresh-session');assert.ok(options.body.size>0);submitted.push(url);return new Response(JSON.stringify({id:'test'}));}
   if(url==='/api/jobs/test')return new Response(JSON.stringify({status:'done',message:'Complete',download:'/api/jobs/test/download'}));
   if(url==='/api/jobs/test/download')return {ok:true,body:null,blob:async()=>new Blob(['native artifact'])};
   return normalFetch(url,options);
 };
 for(const target of ['apk','exe']){
   w.document.querySelector('#export-'+target).click();
   await until(test,()=>!w.document.querySelector('#build-download').hidden&&!w.document.querySelector('#export-fields').disabled,'native '+target);
   const count=files.size;w.document.querySelector('#build-download').click();await until(test,()=>files.size===count+1,'save native '+target);
 }
 assert.deepEqual(submitted,['/api/build/apk','/api/build/exe']);w.fetch=normalFetch;
 const bad=new Blob(['invalid']);bad.name='invalid.pdf';Object.defineProperty(input,'files',{configurable:true,value:[bad]});input.dispatchEvent(new w.Event('change'));
 await until(test,()=>!input.disabled,'invalid PDF recovery');assert.equal(w.document.querySelector('#reader-error').hidden,false);
 assert.equal(w.document.querySelector('#export-fields').disabled,false,'existing valid book lost on invalid input');
 const id=await w.FlipbookTransfer.save(source,'QA handoff.pdf');const received=await w.FlipbookTransfer.get(id);assert.equal(received.name,'QA handoff.pdf');assert.equal(received.blob.size,source.size);await w.FlipbookTransfer.remove(id);assert.equal(await w.FlipbookTransfer.get(id),undefined);
 assert.equal(test.errors.length,0,String(test.errors));w.engine.destroy();w.close();
 console.log('PASS editor: actual PDF load, hidden controls preserved, stable cover size, project save/restore, HTML output, invalid-file recovery, IndexedDB transfer');
}
main().catch(error=>{console.error(error);process.exit(1)});

