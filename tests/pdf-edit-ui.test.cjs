const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM}=require('../.build/qa-runtime/node_modules/jsdom');
const PDFLib=require('../.build/qa-runtime/node_modules/pdf-lib');
async function main(){
 const dom=new JSDOM(fs.readFileSync('converter.html','utf8'),{url:'http://localhost:8080/converter.html?tool=watermark',runScripts:'outside-only'}),w=dom.window;
 w.PDFLib=PDFLib;w.Blob=Blob;w.Uint8Array=Uint8Array;w.ArrayBuffer=ArrayBuffer;w.scrollTo=()=>{};w.console.log=()=>{};w.console.error=()=>{};
 let saved;w.URL.createObjectURL=blob=>{saved=blob;return 'blob:result'};w.URL.revokeObjectURL=()=>{};
 w.eval(fs.readFileSync('assets/pdf-edit.js','utf8'));
 const script=[...w.document.scripts].find(s=>s.textContent.includes('const TOOLS')).textContent;
 w.eval(script+'\nwindow.qaFiles=v=>{files=v;updateFileUI()};');
 const doc=await PDFLib.PDFDocument.create();doc.addPage();doc.addPage();
 const file=new Blob([await doc.save()],{type:'application/pdf'});file.name='source.pdf';
 const wait=async()=>{for(let i=0;i<1000;i++){await new Promise(r=>setTimeout(r,5));if(!w.document.querySelector('#convertBtn').disabled)return}throw Error('Conversion stuck')};
 for(const tool of ['watermark','page-numbers','crop-pdf']){
  w.setTool(tool);w.qaFiles([file]);saved=null;
  w.document.querySelector('#convertBtn').click();await wait();
  assert.ok(saved,tool+' did not download');
  assert.equal((await PDFLib.PDFDocument.load(await saved.arrayBuffer())).getPageCount(),2);
  assert.equal(w.document.querySelector('#makeFlipbook').hidden,false);
  assert.equal(w.document.querySelector('#error').classList.contains('hidden'),true);
 }
 saved=null;w.document.querySelector('#edit-top').value='9999';
 w.document.querySelector('#convertBtn').click();await wait();
 assert.equal(saved,null);assert.equal(w.document.querySelector('#error').classList.contains('hidden'),false);
 assert.match(w.document.querySelector('#error').textContent,/entire area/);
 w.close();console.log('PASS converter buttons: 3 PDF edit tools, PDF handoff, invalid crop remains visible');
}
main().catch(e=>{console.error(e);process.exit(1)});
