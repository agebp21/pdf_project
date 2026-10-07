const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM}=require('../.build/qa-runtime/node_modules/jsdom');
const html=fs.readFileSync('converter.html','utf8');
async function main(){
 for(const tool of ['watermark','edit-pdf','---','jpg-to-pdf']){
  const dom=new JSDOM(html,{url:'http://localhost:8080/converter.html?tool='+tool,runScripts:'outside-only'}),w=dom.window;
  w.console.log=()=>{};w.scrollTo=()=>{};
  w.eval(fs.readFileSync('assets/pdf-edit.js','utf8'));
  const script=[...w.document.scripts].find(s=>s.textContent.includes('const TOOLS')).textContent;
  w.eval(script+'\nwindow.qaFiles=v=>{files=v};');
  assert.ok(w.document.querySelector('#toolTitle').textContent.length, 'header renders for ?tool='+tool);
  if(tool==='jpg-to-pdf'){
   w.Blob=Blob;
   let posted, result;
   w.downloadBlob=(blob,name)=>{result={blob,name}};
   w.fetch=async(url,options)=>{
    if(url==='/api/capabilities')return {ok:true,json:async()=>({office:true,token:'test'})};
    posted={url,options};return {ok:true,blob:async()=>new Blob(['%PDF-1.4 test'])};
   };
   for(const [name,fn,route] of [['test.docx','wordToPdf','word'],['test.xls','excelToPdf','excel'],['test.pptx','pptToPdf','pptx']]){
    const file=new Blob(['X'.repeat(51000)+'END']);file.name=name;w.qaFiles([file]);
    await w[fn]();assert.equal(posted.url,'/api/convert/'+route+'-to-pdf');
    assert.equal(posted.options.body,file);assert.equal(posted.options.headers['X-Build-Token'],'test');
    assert.equal(result.name,'test.pdf');assert.equal(result.blob.type,'application/pdf');
   }
   w.fetch=async()=>({ok:true,json:async()=>({office:false})});
   await assert.rejects(()=>w.wordToPdf(),/Supported files/);
   w.qaFiles([{name:'test.docx'}]);await assert.rejects(()=>w.wordToPdf(),/Office conversion is unavailable|Konversi Office/);
   // More than six table columns must survive extraction.
   const items=Array.from({length:9},(_,i)=>({str:'COL'+i,width:20,transform:[1,0,0,1,i*100,0]}));
   assert.equal(w.cellsOf(items).length,9);
   // A tight 11 pt table row: ~11 pt between cells splits, a word space (3 pt) doesn't.
   const at=(str,x,width)=>({str,width,transform:[11,0,0,11,x,0]});
   assert.deepEqual([...w.cellsOf([at('Jawa',60,24),at('Barat',87,28),at('1.410.500',230,50),at('12,8%',330,30),at('Naik',371,22)])],['Jawa Barat','1.410.500','12,8%','Naik']);
   assert.deepEqual([...w.cellsOf([at('Pendapatan naik di',60,90),at('sebagian',153,40),at('besar',196,26)])],['Pendapatan naik di sebagian besar']);
   w.HTMLCanvasElement.prototype.getContext=()=>({});
   w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,AA==';
   const page={getTextContent:async()=>({items:Array.from({length:350},(_,i)=>({str:'Line'+i+' '+('Z'.repeat(2100)),width:100,transform:[1,0,0,1,0,i*4]}))}),getViewport:()=>({width:100,height:100}),render:()=>({promise:Promise.resolve()}),cleanup(){}};
   const extracted=await w.pdfContentPages({numPages:1,getPage:async()=>page},()=>{});
   assert.equal(extracted.pages[0].lines.length,350);
   assert.ok(extracted.pages[0].lines[0].text.length>2000);
  }
  w.close();
 }
 console.log('PASS unknown-tool startup, malformed slug, Office routes and full upload, missing LibreOffice, >6 columns, tight table columns, >300 extraction lines');
}
main().catch(e=>{console.error(e);process.exit(1)});
