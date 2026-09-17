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
   let written=[];w.jspdf={jsPDF:class{
    setFontSize(){} setFont(){} addPage(){} text(t){written.push(t)}
    splitTextToSize(t){return t.match(/.{1,100}/gs)||[]}
    output(){return new Blob(['test'],{type:'application/pdf'})}
   }};
   w.downloadBlob=()=>{};
   const file={name:'test.docx',arrayBuffer:async()=>new ArrayBuffer(0)};w.qaFiles([file]);
   const long='A'.repeat(51000)+'END_DOCX';w.mammoth={extractRawText:async()=>({value:long})};
   await w.wordToPdf();assert.ok(written.join('').endsWith('END_DOCX'));
   written=[];const rows=Array.from({length:75},(_,i)=>['ROW'+i+' '+('X'.repeat(180))+'END'+i]);
   w.XLSX={read:()=>({SheetNames:['Sheet'],Sheets:{Sheet:{}}}),utils:{sheet_to_json:()=>rows}};
   await w.excelToPdf();assert.ok(written.join('').includes(rows[74][0]));
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
 console.log('PASS unknown-tool startup, malformed slug, DOCX >50k, Excel >60 rows and >150 chars, >6 columns');
}
main().catch(e=>{console.error(e);process.exit(1)});
