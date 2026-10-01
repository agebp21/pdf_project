// PDF -> Word / PowerPoint / Excel with the real libraries (pdf.js 3.11.174,
// docx 9.7.1, PptxGenJS 4.0.1, ExcelJS 4.4.0) inside a simulated DOM.
// Needs .build/qa-runtime (see QA_REPORT.md) and the Office fixture from
// `python tests/qa-office.py` (.build/qa-office/layout.docx.pdf).
// Outputs land in .build/qa-office-export/ for rendering/visual checks.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const R='../.build/qa-runtime/node_modules/';
const {JSDOM}=require(R+'jsdom');
const canvas=require(R+'@napi-rs/canvas');
global.DOMMatrix=canvas.DOMMatrix;global.Path2D=canvas.Path2D;
const pdfjs=require('../assets/vendor/pdf.min.js');
pdfjs.GlobalWorkerOptions.workerSrc=path.resolve('assets/vendor/pdf.worker.min.js');
const JSZip=require('../assets/vendor/jszip.min.js');
const {PDFDocument}=require('../assets/vendor/pdf-lib.min.js');
const OUT=path.resolve('.build/qa-office-export');

function page(){
  const dom=new JSDOM(fs.readFileSync('converter.html','utf8'),{url:'http://127.0.0.1:8080/converter.html?tool=pdf-to-word',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  w.console.log=()=>{};w.scrollTo=()=>{};w.Blob=Blob;w.Uint8Array=Uint8Array;w.ArrayBuffer=ArrayBuffer;
  w.URL.createObjectURL=()=> 'blob:qa';w.URL.revokeObjectURL=()=>{};
  w.HTMLCanvasElement.prototype.getContext=function(){
    if(!this.native||this.native.width!==this.width||this.native.height!==this.height)this.native=canvas.createCanvas(Math.max(1,this.width),Math.max(1,this.height));
    const ctx=this.native.getContext('2d');
    // Drawing one DOM canvas onto another (picture copies) uses the native canvas behind it.
    if(!ctx.qaUnwrap){const draw=ctx.drawImage;ctx.drawImage=function(src,...rest){return draw.call(this,src&&src.native?src.native:src,...rest)};ctx.qaUnwrap=true;}
    return ctx;
  };
  w.HTMLCanvasElement.prototype.toDataURL=function(type,quality){return this.native.toDataURL(type||'image/png',quality)};
  w.pdfjsLib={Util:pdfjs.Util,OPS:pdfjs.OPS,GlobalWorkerOptions:{},getDocument:o=>pdfjs.getDocument({...o,disableFontFace:false,verbosity:0,canvasFactory:new class{create(a,b){const c=canvas.createCanvas(a,b);return {canvas:c,context:c.getContext('2d')}}reset(o,a,b){o.canvas.width=a;o.canvas.height=b}destroy(o){o.canvas.width=0;o.canvas.height=0}}})};
  w.JSZip=JSZip;w.docx=require(R+'docx');w.PptxGenJS=require(R+'pptxgenjs');w.ExcelJS=require(R+'exceljs');
  w.eval(fs.readFileSync('assets/pdf-edit.js','utf8'));
  w.eval(fs.readFileSync('assets/pdf-layout.js','utf8'));
  const script=[...w.document.scripts].find(s=>s.textContent.includes('const TOOLS')).textContent;
  w.eval(script+'\nwindow.qaFiles=v=>{files=v};');
  for(const name of ['ensureDocx','ensurePptx','ensureExcelJS','ensureTesseract'])w[name]=async()=>{};
  w.ocrPageToLines=async()=>['OCR LINE FROM SCAN'];
  const outputs=[];
  const real=w.downloadBlob;
  w.downloadBlob=(blob,name,opts)=>{outputs.push({blob,name,opts});};
  return {w,outputs,real};
}
const file=(buf,name)=>{const b=new Blob([buf],{type:'application/pdf'});b.name=name;return b;};
const zipText=async(blob,entry)=>(await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()))).file(entry)?.async('string');

async function main(){
  fs.mkdirSync(OUT,{recursive:true});
  const fixture=fs.readFileSync('.build/qa-office/layout.docx.pdf');
  // Image-only page (no text operators): must fall back to OCR, not vanish.
  const scan=await PDFDocument.create();const png=await scan.embedPng(fs.readFileSync('.build/qa-office/banner.png'));
  scan.addPage([400,300]).drawImage(png,{x:20,y:20,width:360,height:260});
  const scanBytes=await scan.save();

  // --- Layout model: text removed from background, editable runs returned.
  {
    const {w}=page();
    const pdf=await w.pdfjsLib.getDocument({data:new Uint8Array(fixture)}).promise;
    const layout=await w.PdfLayout.layoutPage(await pdf.getPage(1));
    assert.ok(layout.runs.length>3,'text runs extracted');
    assert.ok(layout.runs.every(r=>r.x>=0&&r.y>=0&&r.x<layout.width&&r.y<layout.height),'runs inside page');
    assert.ok(layout.runs.some(r=>/[A-Za-z]{3}/.test(r.text)));
    assert.ok(layout.background.b64.length>1000);
    assert.equal(w.PdfLayout.fontFace('ABCDEF+Calibri-Bold','sans-serif'),'Calibri');
    assert.equal(w.PdfLayout.hexColor('rgb(255, 0, 16)'),'FF0010');
    const merged=w.PdfLayout.mergeRuns([{text:'Hel',x:0,y:0,w:10,h:12,size:10,baseline:10,bold:false,italic:false},{text:'lo',x:10,y:0,w:8,h:12,size:10,baseline:10,bold:false,italic:false},{text:'Col2',x:200,y:0,w:20,h:12,size:10,baseline:10,bold:false,italic:false},{text:'Hel',x:0.5,y:0,w:10,h:12,size:10,baseline:10.2,bold:false,italic:false}]);
    assert.deepEqual(Array.from(merged,r=>r.text).sort(),['Col2','Hello'],'adjacent runs join, columns stay apart, shadows dedupe');
    const mixed=w.PdfLayout.mergeRuns([{text:'Objective',x:0,y:0,w:50,h:12,size:10,baseline:10,bold:true,italic:false,color:'000000',font:'Arial'},
      {text:':',x:50,y:0,w:3,h:12,size:10,baseline:10,bold:false,italic:false,color:'000000',font:'Arial'},
      {text:'Hero  video',x:56,y:0,w:40,h:12,size:10,baseline:10,bold:false,italic:false,color:'000000',font:'Arial'}]);
    assert.equal(mixed.length,1);assert.equal(mixed[0].text,'Objective: Hero video');
    assert.deepEqual(Array.from(mixed[0].parts,p=>[p.text,p.bold]),[['Objective',true],[': Hero video',false]],'mixed styles stay as pieces');
  }

  // --- Pictures lift out only when the page shows them untouched; ":" right
  // after a bold word is kept (as its own regular-weight piece).
  {
    const L=require('../assets/vendor/pdf-lib.min.js');
    const doc=await PDFDocument.create();const png=await doc.embedPng(fs.readFileSync('.build/qa-office/banner.png'));
    const pg=doc.addPage([600,400]);
    pg.drawImage(png,{x:20,y:220,width:160,height:120});                      // free: lifted
    pg.drawImage(png,{x:220,y:220,width:160,height:120});                     // covered by a box: stays
    pg.drawRectangle({x:260,y:250,width:80,height:60,color:L.rgb(0.9,0.1,0.1)});
    pg.pushOperators(L.pushGraphicsState(),L.moveTo(420,220),L.lineTo(580,220),L.lineTo(500,340),L.closePath(),L.clip(),L.endPath());
    pg.drawImage(png,{x:420,y:220,width:160,height:120});                     // clipped to a triangle: stays
    pg.pushOperators(L.popGraphicsState());
    const bold=await doc.embedFont(L.StandardFonts.HelveticaBold),regular=await doc.embedFont(L.StandardFonts.Helvetica);
    pg.drawText('Objective',{x:40,y:120,size:20,font:bold});
    pg.drawText(': Hero video',{x:40+bold.widthOfTextAtSize('Objective',20),y:120,size:20,font:regular});
    const bytes=await doc.save();
    const {w,outputs}=page();
    const pdf=await w.pdfjsLib.getDocument({data:new Uint8Array(bytes)}).promise;
    const layout=await w.PdfLayout.layoutPage(await pdf.getPage(1),{images:true});
    assert.equal(layout.images.length,1,'only the untouched picture is lifted out');
    const [im]=layout.images;
    assert.ok(Math.abs(im.x-20)<1.5&&Math.abs(im.y-60)<1.5&&Math.abs(im.w-160)<1.5&&Math.abs(im.h-120)<1.5,'picture keeps its place and size');
    assert.ok(im.b64.length>500);
    const line=layout.runs.find(r=>r.text.startsWith('Objective'));
    assert.equal(line&&line.text,'Objective: Hero video','the colon is not lost');
    assert.deepEqual(Array.from(line.parts,p=>[p.text,p.bold]),[['Objective',true],[': Hero video',false]]);
    assert.equal((await w.PdfLayout.layoutPage(await pdf.getPage(1))).images,undefined,'Word layout is unchanged (no picture lifting)');
    // In PowerPoint: the picture is its own shape, the line has two runs and one paragraph-props block.
    w.qaFiles([file(bytes,'pictures.pdf')]);await w.pdfToPpt();
    const slide=await zipText(outputs[0].blob,'ppt/slides/slide1.xml');
    assert.equal((slide.match(/<p:pic>/g)||[]).length,2,'background + lifted picture');
    const para=slide.match(/<a:p>(?:(?!<\/a:p>).)*Objective(?:(?!<\/a:p>).)*<\/a:p>/)[0];
    assert.equal((para.match(/<a:pPr/g)||[]).length,1,'one <a:pPr>, first in the paragraph (no PowerPoint repair prompt)');
    assert.match(para,/b="1"[^>]*>(?:(?!<a:t>).)*<a:t>Objective<\/a:t>/);
    assert.match(para,/<a:t>: Hero video<\/a:t>/);
    fs.writeFileSync(path.join(OUT,'pictures.pptx'),Buffer.from(await outputs[0].blob.arrayBuffer()));
  }

  // --- Word, keep-original-look mode.
  {
    const {w,outputs}=page();
    const source=file(fixture,'layout.pdf');w.qaFiles([source]);
    await w.pdfToWord();
    const out=outputs[0];assert.equal(out.name,'layout.docx');assert.equal(out.opts.flipbookSource,source,'Word keeps the source PDF for the flipbook');
    const xml=await zipText(out.blob,'word/document.xml');
    assert.ok(xml.includes('w:framePr'),'positioned editable text frames');
    assert.ok(xml.includes('behindDoc="1"'),'text-free page background behind text');
    assert.ok((xml.match(/<w:sectPr/g)||[]).length>=2,'one section per PDF page');
    fs.writeFileSync(path.join(OUT,'layout-keep-look.docx'),Buffer.from(await out.blob.arrayBuffer()));
  }
  // --- Word, flowing mode.
  {
    const {w,outputs}=page();
    w.renderHeader();w.document.querySelector('#opt-word-mode').value='flow';
    w.qaFiles([file(fixture,'layout.pdf')]);await w.pdfToWord();
    const xml=await zipText(outputs[0].blob,'word/document.xml');
    assert.ok(!xml.includes('w:framePr'),'flowing mode has no frames');
    assert.ok(/<w:t[^>]*>[^<]{3,}/.test(xml),'flowing text present');
    assert.ok(xml.includes('<w:tbl>'),'multi-column lines become a real Word table');
    fs.writeFileSync(path.join(OUT,'layout-flow.docx'),Buffer.from(await outputs[0].blob.arrayBuffer()));
  }
  // --- Word, scanned page -> picture + OCR text.
  {
    const {w,outputs}=page();w.qaFiles([file(scanBytes,'scan.pdf')]);await w.pdfToWord();
    const xml=await zipText(outputs[0].blob,'word/document.xml');
    assert.ok(xml.includes('OCR LINE FROM SCAN'));assert.ok(xml.includes('<w:drawing>'));
  }
  // --- PowerPoint: editable text boxes on slides + notes.
  {
    const {w,outputs}=page();
    const source=file(fixture,'layout.pdf');w.qaFiles([source]);await w.pdfToPpt();
    const out=outputs[0];assert.equal(out.name,'layout.pptx');assert.equal(out.opts.flipbookSource,source);
    const zip=await JSZip.loadAsync(Buffer.from(await out.blob.arrayBuffer()));
    const slides=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n));
    assert.equal(slides.length,2,'one slide per page');
    const slide=await zip.file('ppt/slides/slide1.xml').async('string');
    assert.ok((slide.match(/<p:sp>/g)||[]).length>3,'text boxes on slide');
    assert.ok(slide.includes('<p:pic>'),'background picture');
    const pres=await zip.file('ppt/presentation.xml').async('string');
    const [,cx,cy]=/<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(pres);
    const first=(await PDFDocument.load(fixture)).getPage(0).getSize();
    assert.ok(Math.abs(cx/cy-first.width/first.height)<0.01,'slide keeps the PDF page ratio');
    fs.writeFileSync(path.join(OUT,'layout.pptx'),Buffer.from(await out.blob.arrayBuffer()));
    // Scan: picture + OCR notes, no text boxes.
    const scanRun=page();scanRun.w.qaFiles([file(scanBytes,'scan.pdf')]);await scanRun.w.pdfToPpt();
    const sz=await JSZip.loadAsync(Buffer.from(await scanRun.outputs[0].blob.arrayBuffer()));
    const notes=Object.keys(sz.files).filter(n=>/notesSlide\d+\.xml$/.test(n));
    assert.ok((await Promise.all(notes.map(n=>sz.file(n).async('string')))).some(x=>x.includes('OCR LINE FROM SCAN')));
  }
  // --- Excel: Data sheet first, numbers typed.
  {
    const {w,outputs}=page();
    const source=file(fs.readFileSync('.build/qa-office/data.csv.pdf'),'data.pdf');w.qaFiles([source]);await w.pdfToExcel();
    const out=outputs[0];assert.equal(out.opts.flipbookSource,source);
    const wb=new w.ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(await out.blob.arrayBuffer()));
    assert.equal(wb.worksheets[0].name,'Data');assert.equal(wb.worksheets[1].name,'Pages (Images)');
    let numbers=0;wb.worksheets[0].eachRow(r=>r.eachCell(c=>{if(typeof c.value==='number')numbers++;}));
    assert.ok(numbers>2,'numeric cells are real numbers');
    fs.writeFileSync(path.join(OUT,'data.xlsx'),Buffer.from(await out.blob.arrayBuffer()));
  }
  // --- Result panel: Office output offers the source PDF as a flipbook.
  {
    const {w,real}=page();
    const source=file(fixture,'layout.pdf');
    real(new Blob(['PK'],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),'x.docx',{flipbookSource:source});
    const button=w.document.querySelector('#makeFlipbook');
    assert.equal(button.hidden,false);assert.match(button.textContent,/source PDF/);
    real(new Blob(['PK'],{type:'application/zip'}),'x.zip');
    assert.equal(button.hidden,true,'ZIP without a source PDF offers no flipbook');
  }
  // --- Coming-soon catalog ids hide the upload area.
  {
    const dom=new JSDOM(fs.readFileSync('converter.html','utf8'),{url:'http://127.0.0.1:8080/converter.html?tool=sign-pdf',runScripts:'outside-only'}),w=dom.window;
    w.console.log=()=>{};w.eval(fs.readFileSync('assets/pdf-edit.js','utf8'));
    w.eval([...w.document.scripts].find(s=>s.textContent.includes('const TOOLS')).textContent);
    assert.ok(w.document.querySelector('#drop').classList.contains('hidden'));
    assert.match(w.document.querySelector('#comingSoon').textContent,/Sign PDF — coming soon/);
    assert.equal(w.document.querySelector('#toolBadge').textContent,'Coming soon');
  }
  console.log('PASS layout model, PPT pictures lifted (free only) + mixed-style colon, Word keep-look/flow/scan, PPT text boxes/ratio/OCR notes, Excel Data sheet + numbers, flipbook source, coming-soon');
}
main().catch(e=>{console.error(e);process.exit(1)});
