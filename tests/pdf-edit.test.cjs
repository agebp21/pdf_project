const assert=require('node:assert/strict'),fs=require('node:fs');
global.PDFLib=require('../.build/qa-runtime/node_modules/pdf-lib');
require('../assets/pdf-edit.js');
const {createCanvas,DOMMatrix,Path2D}=require('../.build/qa-runtime/node_modules/@napi-rs/canvas');
global.DOMMatrix=DOMMatrix;global.Path2D=Path2D;
const pdfjs=require('../assets/vendor/pdf.min.js');
pdfjs.GlobalWorkerOptions.workerSrc=require('node:path').resolve('assets/vendor/pdf.worker.min.js');
async function inspect(bytes){return pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true}).promise}
async function main(){
 const {PDFDocument,degrees,rgb}=PDFLib;
 const source=await PDFDocument.create();
 for(const angle of [0,90,180,270]){
  const p=source.addPage([500,700]);p.setCropBox(30,40,440,620);p.setRotation(degrees(angle));
  p.drawRectangle({x:30,y:40,width:440,height:620,color:rgb(.93,.96,.94)});
  p.drawText('Original page '+angle,{x:80,y:200,size:20});
 }
 const bytes=await source.save();
 const common={range:'all',size:16,position:'bottom-center',margin:10,color:'#214d40'};
 const numbered=await PDFEdit.apply(bytes,{...common,tool:'page-numbers',start:10});
 const pdf=await inspect(numbered);
 fs.mkdirSync('.build/qa-edit',{recursive:true});
 fs.writeFileSync('.build/qa-edit/numbered.pdf',numbered);
 for(let i=1;i<=4;i++){
  const page=await pdf.getPage(i),text=await page.getTextContent();
  assert.ok(text.items.some(item=>item.str===String(i+9)));
 }
 await pdf.destroy();
 const cropped=await PDFEdit.apply(bytes,{tool:'crop-pdf',range:'2,4',top:10,right:20,bottom:5,left:15});
 const read=await PDFDocument.load(cropped),mm=72/25.4;
 assert.deepEqual(read.getPage(0).getCropBox(),source.getPage(0).getCropBox());
 const b=read.getPage(1).getCropBox();
 assert.ok(Math.abs(b.width-(440-15*mm))<.01);assert.ok(Math.abs(b.height-(620-35*mm))<.01);
 assert.ok(Math.abs(b.x-(30+10*mm))<.01);assert.ok(Math.abs(b.y-(40+15*mm))<.01);
 fs.writeFileSync('.build/qa-edit/cropped.pdf',cropped);
 const marked=await PDFEdit.apply(bytes,{...common,tool:'watermark',mode:'text',text:'DRAFT',opacity:30,range:'1,3',position:'center',size:36});
 fs.writeFileSync('.build/qa-edit/watermark.pdf',marked);
 const stamped=await inspect(marked);
 for(let i=1;i<=4;i++){
  const text=await (await stamped.getPage(i)).getTextContent();
  assert.equal(text.items.some(x=>x.str==='DRAFT'),i===1||i===3);
 }await stamped.destroy();
 const logo=createCanvas(200,80);const ctx=logo.getContext('2d');ctx.fillStyle='#214d40';ctx.fillRect(0,0,200,80);ctx.fillStyle='white';ctx.font='24px sans-serif';ctx.fillText('LOGO',20,50);
 const image=await PDFEdit.apply(bytes,{...common,tool:'watermark',mode:'image',image:logo.toBuffer('image/png'),opacity:40,position:'top-right',size:30});
 fs.writeFileSync('.build/qa-edit/image-watermark.pdf',image);
 await assert.rejects(()=>PDFEdit.apply(bytes,{tool:'crop-pdf',top:500,right:0,bottom:0,left:0}),/entire area/);
 await assert.rejects(()=>PDFEdit.apply(bytes,{...common,tool:'page-numbers',start:1,range:'1-999999999'}),/outside/);
 await assert.rejects(()=>PDFEdit.apply(bytes,{...common,tool:'watermark',mode:'text',text:'too large',opacity:40,size:9999}),/does not fit/);
 assert.throws(()=>PDFEdit.selection('1foo',4),/page numbers/);
 console.log('PASS real PDF edits: numbering 4 rotations, crop offsets/ranges, text/image watermark, invalid input');
}
main().catch(e=>{console.error(e);process.exit(1)});
