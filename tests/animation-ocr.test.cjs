const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const canvas=require('../.build/qa-runtime/node_modules/@napi-rs/canvas');
const Tesseract=require('../.build/qa-runtime/node_modules/tesseract.js');
async function main(){
 const context={URL,document:{createElement:()=>canvas.createCanvas(1,1)},location:{href:'http://localhost:8080/animation.html'},Uint8ClampedArray,Tesseract:{createWorker:async(languages,oem,options)=>{
   const worker=await Tesseract.createWorker(languages,oem,{langPath:path.resolve('assets/vendor/ocr'),gzip:true,cacheMethod:'none',logger:options.logger});
   return {setParameters:p=>worker.setParameters(p),recognize:input=>worker.recognize(input.toBuffer('image/png')),terminate:()=>worker.terminate()};
 }}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('assets/animation-ocr.js','utf8'),context);
 const image=process.argv[2]?await canvas.loadImage(process.argv[2]):null;
 const input=canvas.createCanvas(image?.width||1400,image?.height||400),ctx=input.getContext('2d');
 if(image)ctx.drawImage(image,0,0);else{ctx.fillStyle='white';ctx.fillRect(0,0,1400,400);ctx.fillStyle='black';ctx.font='64px Arial';ctx.fillText('DOCUMENT EXTRACTION',60,150);}
 try{
   const lines=await context.AnimationOCR.read(input);assert.ok(lines.length>0,'real OCR extracts raster text');
   const text=lines.map(l=>l.text).join('\n');assert.match(text,image?/TERAS/i:/DOCUMENT EXTRACTION/);
   const boxes=lines.flatMap(l=>l.words.length?l.words:[l.bbox]);const colors=context.AnimationOCR.repair(input,boxes);assert.equal(colors.length,boxes.length);
   if(!image){const data=ctx.getImageData(0,0,1400,400).data;let dark=0;for(let i=0;i<data.length;i+=4)if(data[i]<100)dark++;assert.ok(dark<100,'recognized text pixels removed from plain background');}
   fs.mkdirSync('.build/qa-animation',{recursive:true});fs.writeFileSync('.build/qa-animation/ocr-repaired.png',input.toBuffer('image/png'));
   fs.writeFileSync('.build/qa-animation/ocr-lines.json',JSON.stringify(lines,null,2));console.log(`PASS real local OCR: ${lines.length} lines, ${boxes.length} word boxes, background repair`);
 }finally{await context.AnimationOCR.release();}
}
main().catch(error=>{console.error(error);process.exit(1)});
