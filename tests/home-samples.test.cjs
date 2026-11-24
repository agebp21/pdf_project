const fs = require('node:fs');
const assert = require('node:assert/strict');
const {JSDOM} = require('../.build/qa-runtime/node_modules/jsdom');
(async () => {
  const dom = new JSDOM(fs.readFileSync('index.html','utf8'), {url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window;
  w.matchMedia = () => ({matches:true});
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.HTMLElement.prototype.getBoundingClientRect = function () { return {left:0,top:0,width:450,height:625,right:450,bottom:625}; };
  w.I18N = {get:()=> 'id'};
  w.fetch = async () => ({ok:true, json:async () => ({items:[{id:'abcdefabcdefabcdefabcdef',slot:'custom-abcdefabcdefabcdefabcdef',title:'PDF Unggahan',pages:3,cover:'/api/home-samples/abcdefabcdefabcdefabcdef/page-1.webp',pageBase:'/api/home-samples/abcdefabcdefabcdefabcdef/page-'}]})});
  let pageCount=0;
  w.St = {PageFlip: class {
    constructor(box) {this.box=box;this.index=0;this.handlers={};w.__qaFlip=this;}
    loadFromHTML(pages) {this.pages=[...pages];pageCount=this.pages.length;}
    updateFromHtml(pages) {this.pages=[...pages];this.box.replaceChildren(...pages);pageCount=pages.length;}
    getCurrentPageIndex(){return this.index;} getPageCount(){return this.pages.length;}
    getOrientation(){return 'landscape';} getSettings(){return {flippingTime:1};}
    on(name,fn){this.handlers[name]=fn;} turnToPage(i){this.index=i;this.handlers.flip?.();}
    flip(i){this.turnToPage(i);} flipNext(){this.turnToPage(this.index+1);} flipPrev(){this.turnToPage(this.index-1);}
  }};
  w.HomeHeroTools={bind:()=>({refresh(){},pause(){}})};
  const append=w.document.head.appendChild.bind(w.document.head);
  w.document.head.appendChild = node => {const out=append(node);if(node.tagName==='SCRIPT')setTimeout(()=>node.onload?.(),0);return out;};
  w.eval(fs.readFileSync('assets/home-hero.js','utf8'));
  w.eval(fs.readFileSync('assets/home-samples.js','utf8'));
  const click = id => w.document.querySelector('.hh-sample[data-sample='+id+']').click();
  const wait = () => new Promise(resolve=>setTimeout(resolve,100));
  click('interior'); await wait();
  assert.equal(pageCount,12);assert.equal(w.document.querySelectorAll('.hh-catalog-page').length,12);
  assert.equal(w.document.querySelectorAll('.hh-sample-back').length,0,'PDF final page is the back cover');
  w.__qaFlip.turnToPage(10);
  assert.equal(w.document.getElementById('hh-demo-next').disabled,false,'last content spread can still close onto the back cover');
  assert.equal(w.document.getElementById('hh-tool-end').disabled,false,'End remains available before the back cover');
  w.document.getElementById('hh-tool-end').click();
  assert.equal(w.__qaFlip.getCurrentPageIndex(),11,'End reaches the closed back cover');
  assert.equal(w.document.getElementById('hh-demo-next').disabled,true,'next stops only on the back cover');
  w.document.getElementById('hh-demo-close').click();await wait();await wait();
  click('interior');await wait();assert.equal(w.document.getElementById('hh-demo').hidden,false);
  click('travel');await wait();assert.equal(pageCount,10);assert.equal(w.document.querySelectorAll('#hh-demo-book .hh-page').length,10);
  click('interior');await wait();assert.equal(pageCount,12);
  click('custom-abcdefabcdefabcdefabcdef');await wait();
  assert.equal(pageCount,4,'odd PDF pages receive one back cover');
  assert.equal(w.document.querySelectorAll('#hh-demo-book .hh-catalog-page').length,3);
  assert.match(w.document.querySelector('#hh-book .hh-upload-cover').src,/page-1\.webp$/);
  click('travel');await wait();assert.equal(pageCount,10,'built-in sample restores after uploaded PDF');
  w.HomeSampleOverrides.travel = {id:'111111111111111111111111',title:'Satu halaman',pages:1,pageBase:'/api/home-samples/111111111111111111111111/page-'};
  click('interior');await wait();click('travel');await wait();
  assert.equal(pageCount,2,'single-page PDF includes a closing back cover');
  dom.window.close();
  console.log('PASS built-in and uploaded PDF samples, switching and back cover (mock engine)');
})().catch(error=>{console.error(error);process.exit(1);});
