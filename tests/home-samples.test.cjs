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
  let pageCount=0;
  w.St = {PageFlip: class {
    constructor(box) {this.box=box;this.index=0;this.handlers={};}
    loadFromHTML(pages) {this.pages=[...pages];pageCount=this.pages.length;}
    updateFromHtml(pages) {this.pages=[...pages];this.box.replaceChildren(...pages);pageCount=pages.length;}
    getCurrentPageIndex(){return this.index;} getPageCount(){return this.pages.length;}
    getOrientation(){return 'portrait';} getSettings(){return {flippingTime:1};}
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
  assert.equal(pageCount,20);assert.equal(w.document.querySelectorAll('.hh-catalog-page').length,19);
  assert.equal(w.document.querySelectorAll('.hh-sample-back').length,1);
  w.document.getElementById('hh-demo-close').click();await wait();await wait();
  click('interior');await wait();assert.equal(w.document.getElementById('hh-demo').hidden,false);
  click('travel');await wait();assert.equal(pageCount,10);assert.equal(w.document.querySelectorAll('#hh-demo-book .hh-page').length,10);
  click('interior');await wait();assert.equal(pageCount,20);
  dom.window.close();
  console.log('PASS sample catalog20/book10, catalog close/reopen and repeated switching (mock engine)');
})().catch(error=>{console.error(error);process.exit(1);});
