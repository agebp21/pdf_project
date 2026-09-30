const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
global.JSZip = require('../assets/vendor/jszip.min.js');
require('../assets/flipbook-export.js');
const api = global.FlipbookExport;
require('../assets/export/layout.js');
const pages=Array.from({length:8},()=>{const classes=[];return {dataset:{},classes,classList:{add(name){classes.push(name)}}}});
FlipbookLayout.decorate(pages);
// Covers bend like paper when turned (a rigid 'hard' plate looked stiff) but keep the board look.
assert.deepEqual(pages.map(page=>page.dataset.density),Array(8).fill('soft'));
assert.deepEqual(pages.map(page=>page.classes.includes('book-board')),[true,true,false,false,false,false,true,true]);
assert.equal(FlipbookLayout.motion(false).flippingTime,1150,'slower, smoother turns');
assert.equal(FlipbookLayout.motion(false).useMouseEvents,true);
assert.equal(FlipbookLayout.motion(true).flippingTime,1);
{ // Closed covers sit centred and slide to the spread when opened.
  const handlers={},state={index:0,orientation:'landscape'};
  const book={getPageCount:()=>12,getOrientation:()=>state.orientation,getCurrentPageIndex:()=>state.index,getBoundsRect:()=>({pageWidth:400}),on:(n,f)=>{(handlers[n]=handlers[n]||[]).push(f)}};
  const root={style:{},classList:{add(){}}};
  const emit=(n,d)=>(handlers[n]||[]).forEach(f=>f({data:d}));
  FlipbookLayout.centerCover(book,root,false);
  assert.equal(root.style.transform,'translateX(-200.0px)','front cover centred');
  emit('changeState','flipping');assert.equal(root.style.transform,'','opening slides back to the spread');
  state.index=1;emit('flip');assert.equal(root.style.transform,'','spreads are not shifted');
  state.index=11;emit('flip');assert.equal(root.style.transform,'translateX(200.0px)','lone back cover centred');
  state.orientation='portrait';emit('changeOrientation');assert.equal(root.style.transform,'','single-page mode never shifts');
}
{ // Curved cover turn: strip angles always add up to the turn; the free edge leads when opening.
  const n=FlipbookCurl.STRIPS,sum=a=>a.reduce((x,y)=>x+y,0);
  const orient=a=>a.reduce((o,x)=>(o.push((o.length?o[o.length-1]:0)+x),o),[]);
  for(const theta of [0,Math.PI])for(const bend of [-1.15,0,1.15])assert.ok(orient(FlipbookCurl.angles(theta,bend*Math.sin(theta?Math.PI:0),n)).every(o=>Math.abs(o-theta)<1e-9),'flat at both ends (no half-tube before the swap)');
  const mid=orient(FlipbookCurl.angles(Math.PI/2,1.15,n));
  assert.ok(Math.abs(mid[0]-Math.PI/2)<1e-9,'spine side turns rigidly');
  assert.ok(mid[n-1]<mid[0]&&mid.every((o,i)=>!i||o<=mid[i-1]+1e-12),'free edge trails smoothly (the board curls)');
  assert.ok(orient(FlipbookCurl.angles(.2,1.15,n)).every(o=>o>=0)&&orient(FlipbookCurl.angles(3,-1.15,n)).every(o=>o<=Math.PI+1e-12),'never dips through the book');
  assert.ok(Math.abs(sum(FlipbookCurl.angles(Math.PI,0,n))-Math.PI)<1e-9);
}
assert.equal(FlipbookLayout.geometry(1920,1080,.7,0,8).single,false);
assert.deepEqual(FlipbookLayout.geometry(1920,1080,.7,0,8),FlipbookLayout.geometry(1920,1080,.7,1,8));
assert.deepEqual(FlipbookLayout.geometry(1920,1080,.7,7,8),FlipbookLayout.geometry(1920,1080,.7,1,8));
assert.equal(FlipbookLayout.geometry(1920,1080,.7,1,8).single,false);
assert.equal(FlipbookLayout.geometry(390,844,.7,1,8).single,true);
assert.equal(FlipbookLayout.geometry(1920,1080,2.5,1,8).single,false,'wide pages still spread, like the preview');
assert.equal(FlipbookLayout.geometry(1280,720,1.29,1,8).single,false,'landscape PDF spreads on a laptop screen');
assert.equal(FlipbookLayout.geometry(699,900,.7,1,8).single,true);
{
  const Z=FlipbookZoom;
  assert.deepEqual(Z.clamp(2,50,50,400,300),{x:0,y:0},'no empty edge at the top-left');
  assert.deepEqual(Z.clamp(2,-900,-900,400,300),{x:-400,y:-300},'nor at the bottom-right');
  // A book in the middle of a wide stage: never pan into the background beside it.
  const book={x:200,y:0,w:340,h:240};
  assert.deepEqual(Z.clamp(2.5,0,0,740,240,book),{x:-500,y:0},'left edge of the book');
  assert.deepEqual(Z.clamp(2.5,-5000,-5000,740,240,book),{x:-610,y:-360},'right/bottom edge of the book');
  assert.deepEqual(Z.clamp(1.5,-100,0,740,240,book),{x:-(1.5*340-740)/2-300,y:0},'narrower than the view: centred');
  const a=Z.anchor(1,2.5,0,0,100,60);
  assert.deepEqual(a,{x:-150,y:-90},'the tapped point stays under the finger');
  const b=Z.anchor(2.5,1,a.x,a.y,100,60);
  assert.ok(Math.abs(b.x)<1e-9&&Math.abs(b.y)<1e-9,'zooming back returns to the start');
  // − 100% + toolbar: one step — + zooms to 200%, pressed again back to 100%; − always 100%.
  assert.deepEqual([1,2,3.4,1.2].map(v=>Z.up(v)),[2,1,1,1]);
  assert.deepEqual([4,2,1].map(v=>Z.down(v)),[1,1,1]);
}
assert.equal(FlipbookLayout.geometry(640,330,.7,1,8).single,false,'landscape phone keeps the two-page spread');
assert.equal(FlipbookLayout.geometry(640,330,.7,1,8,true).single,true,'compact editor preview: width decides');
assert.equal(FlipbookLayout.geometry(640,330,.7,1,1).single,true,'one page stays single');
assert.equal(FlipbookLayout.geometry(3840,2160,.7,1,8).maxWidth,3840);
const model = {version:1,title:'Buku <uji> & "offline"',pageCount:3,ratio:.72,overlays:{'1':{label:'Peserta </script>',value:1250,position:'bottom-right'}}};
const realFetch = global.fetch;
global.fetch = async path => {
  if (path.startsWith('test:')) return new Response(new Uint8Array([255,216,255,224,255,217]));
  return new Response(fs.readFileSync(require('node:path').join(__dirname,'..',path)));
};
(async()=>{
  assert.throws(()=>api.validate({...model,pageCount:0}));
  assert.throws(()=>api.validate({...model,overlays:{'3':model.overlays['1']}}));
  assert.throws(()=>api.validate({...model,overlays:{'1':{...model.overlays['1'],position:'bad'}}}));
  assert.throws(()=>api.validate({...model,overlays:{'1':{...model.overlays['1'],value:Infinity}}}));
  assert.deepEqual(api.validate({...model,words:{'0':[[100,200,300,50,400,60]]}}).words,{'0':[[100,200,300,50,400,60]]});
  for(const bad of [{'9':[[1,2,3,4]]},{'0':[[1,2,3]]},{'0':[[1,2,3,20000]]},{'0':[[1,2,3,4.5]]},[1]])assert.throws(()=>api.validate({...model,words:bad}),/teks/);
  // Line text rides along with the word positions (same pages, no more lines).
  const worded={...model,words:{'0':[[100,200,300,50,400,60]]}};
  assert.deepEqual(api.validate({...worded,text:{'0':['Halo dunia']}}).text,{'0':['Halo dunia']});
  assert.deepEqual(api.validate(worded).text,{},'older projects have no text');
  for(const bad of [{'1':['x']},{'0':['a','b']},{'0':[5]},['x']])assert.throws(()=>api.validate({...worded,text:bad}),/teks/);
  const pdf = new Blob(['%PDF-fixture'],{type:'application/pdf'});
  const saved = await api.saveProject(model,pdf);
  const restored = await api.readProject(saved);
  assert.deepEqual(restored.data,{...model,links:{},words:{},text:{}});assert.equal(await restored.pdf.text(),await pdf.text()); // validated projects always carry links and words (empty here)
  const bundle = await api.packageBook(model,['test:1','test:2','test:3']);
  const zip = await JSZip.loadAsync(await bundle.arrayBuffer());
  for(const file of ['index.html','viewer.js','viewer.css','book-data.js','book.json','page-flip.browser.js','pages/1.jpg','pages/3.jpg','PAGEFLIP-LICENSE.txt'])assert.ok(zip.file(file),file);
  const script = await zip.file('book-data.js').async('string');assert.ok(!script.includes('</script>'));
  const context={window:{}};vm.runInNewContext(script,context);
  assert.equal(context.window.FLIPBOOK_DATA.overlays['1'].label,'Peserta </script>');
  const html = await zip.file('index.html').async('string');
  for(const [,file] of html.matchAll(/(?:src|href)="([^"]+)"/g))assert.ok(zip.file(file),'offline asset '+file);
  await assert.rejects(()=>api.readProject(bundle));
  await assert.rejects(()=>api.packageBook(model,['test:1']));
  console.log('PASS project round-trip, manifest validation, offline package, escaped script data, asset completeness');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{global.fetch=realFetch});
