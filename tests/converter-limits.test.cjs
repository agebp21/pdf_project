const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM}=require('../.build/qa-runtime/node_modules/jsdom');
const html=fs.readFileSync('converter.html','utf8');
async function main(){
 for(const tool of ['watermark','edit-pdf','---','jpg-to-pdf']){
  const dom=new JSDOM(html,{url:'http://localhost:8080/converter.html?tool='+tool,runScripts:'outside-only'}),w=dom.window;
  w.console.log=()=>{};w.scrollTo=()=>{};
  const script=[...w.document.scripts].find(s=>s.textContent.includes('const TOOLS')).textContent;
  w.eval(script+'\nwindow.qaFiles=v=>{files=v};');
  assert.ok(w.document.querySelector('#toolList').children.length);
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
   w.qaFiles([{name:'test.docx'}]);await assert.rejects(()=>w.wordToPdf(),/LibreOffice/);
   // More than six table columns must survive extraction.
   const items=Array.from({length:9},(_,i)=>({str:'COL'+i,width:20,transform:[1,0,0,1,i*100,0]}));
   assert.equal(w.cellsOf(items).length,9);
   w.HTMLCanvasElement.prototype.getContext=()=>({});
   w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,AA==';
   const page={getTextContent:async()=>({items:Array.from({length:350},(_,i)=>({str:'Line'+i+' '+('Z'.repeat(2100)),width:100,transform:[1,0,0,1,0,i*4]}))}),getViewport:()=>({width:100,height:100}),render:()=>({promise:Promise.resolve()}),cleanup(){}};
   const extracted=await w.pdfContentPages({numPages:1,getPage:async()=>page},()=>{});
   assert.equal(extracted.pages[0].lines.length,350);
   assert.ok(extracted.pages[0].lines[0].text.length>2000);
  }
  w.close();
 }
 console.log('PASS unknown-tool startup, malformed slug, Office routes and full upload, missing LibreOffice, >6 columns, >300 extraction lines');
}
main().catch(e=>{console.error(e);process.exit(1)});
