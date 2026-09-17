// Test real PDF transformations; no visual browser verification.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM}=require('../.build/qa-runtime/node_modules/jsdom');
const PDFLib=require('../.build/qa-runtime/node_modules/pdf-lib');
// Bridge jsdom Arrays into the Node library's realm (browser uses a single realm).
const copyPages=PDFLib.PDFDocument.prototype.copyPages;
PDFLib.PDFDocument.prototype.copyPages=function(doc,indices){return copyPages.call(this,doc,Array.from(indices))};
const {fixture}=require('./qa-runtime.cjs');
async function main(){
 const html=fs.readFileSync('converter.html','utf8');
 const dom=new JSDOM(html,{url:'http://localhost:8080/converter.html',runScripts:'outside-only'}),w=dom.window;
 w.scrollTo=()=>{};w.console.log=()=>{};w.Blob=Blob;w.ArrayBuffer=ArrayBuffer;w.Uint8Array=Uint8Array;w.PDFLib=PDFLib;w.JSZip=require('../assets/vendor/jszip.min.js');
 const outputs=[];w.URL.createObjectURL=blob=>{outputs.push(blob);return 'blob:test'};w.URL.revokeObjectURL=()=>{};
 const script=[...w.document.querySelectorAll('script')].find(s=>s.textContent.includes('let active =')).textContent;
 w.eval(script+'\nwindow.qaSetFiles=value=>{files=value}; window.qaOrganize=()=>{organizeOrder=[2,0];organizeRotations={2:90}};');
 const pdf=fixture(3,960,540);pdf.name='input.pdf';
 const result=async(fn,count)=>{outputs.length=0;await w[fn]();assert.equal(outputs.length,1);const doc=await PDFLib.PDFDocument.load(await outputs[0].arrayBuffer());assert.equal(doc.getPageCount(),count);assert.equal(w.document.querySelector('#makeFlipbook').hidden,false);return doc};
 w.qaSetFiles([pdf,pdf]);await result('mergePdf',6);
 w.qaSetFiles([pdf]);w.getSplitMode=()=> 'range';await result('splitPdf',3);
 await result('compressPdf',3);
 const rotated=await result('rotatePdf',3);assert.equal(rotated.getPage(0).getRotation().angle,90);
 w.qaOrganize();const organized=await result('organizePdf',2);assert.equal(organized.getPage(0).getRotation().angle,90);
 w.getSplitMode=()=> 'all';outputs.length=0;await w.splitPdf();const zip=await w.JSZip.loadAsync(await outputs[0].arrayBuffer());assert.equal(Object.keys(zip.files).length,3);assert.equal(w.document.querySelector('#makeFlipbook').hidden,true);
 for(const entry of Object.values(zip.files))assert.equal((await PDFLib.PDFDocument.load(await entry.async('uint8array'))).getPageCount(),1);
 w.close();console.log('PASS converter: merge, extract, split ZIP, compress, rotate, organize, PDF-only flipbook action');
}
main().catch(error=>{console.error(error);process.exit(1)});
