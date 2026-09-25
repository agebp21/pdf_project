'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const data = window.FLIPBOOK_DATA;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let book, frame = 0;
  try {
    if (!data || ![1,2].includes(data.version) || (data.version===2&&!window.AnimationPlayback) || !Number.isInteger(data.pageCount) || data.pageCount < 1) throw Error('Invalid book data.');
    // ES2018 only (no ?. / ??): old Android System WebViews must run this.
    const pageElements = index => { const page = data.pages && data.pages[String(index)]; return (page && page.elements) || []; };
      document.title = data.title; $('#title').textContent = data.title;
      const elements = Array.from({length:data.pageCount}, (_, index) => {
      const page = document.createElement('article'); page.className = 'page';
      const image = document.createElement('img'); image.src = `pages/${index + 1}.jpg`; image.alt = `Page ${index + 1}`;
      image.decoding = 'async'; image.loading = index > 2 ? 'lazy' : 'eager';
      image.onerror = () => { $('#error').hidden = false; $('#error').textContent = 'Page image missing. Extract the whole ZIP into one folder.'; };
      page.append(image);
      const config = data.overlays[String(index)];
      if (config) {
        const overlay = document.createElement('div'); overlay.className = 'stat-overlay ' + config.position;
        const number = document.createElement('strong'); number.textContent = config.value.toLocaleString('id-ID');
        const label = document.createElement('span'); label.textContent = config.label;
        overlay.append(number, label); page.append(overlay);
      }
      return page;
    });
    $('#book').append(...elements);
    const players=elements.map((page,index)=>{
      if(data.version!==2)return null;
      const ratio=(data.pageRatios&&data.pageRatios[index])||data.ratio;
      const w=ratio<data.ratio?ratio/data.ratio*100:100,h=ratio>data.ratio?data.ratio/ratio*100:100;
      return AnimationPlayback.mount(page,pageElements(index),{count:data.pageCount,imageBox:{x:(100-w)/2,y:(100-h)/2,w,h},goPage:index=>{if(book.getState()==='read'){book.turnToPage(index);update();animate();}}});
    });
    function visible() {
      const first = book.getCurrentPageIndex();
      return [first, ...(first > 0 && book.getOrientation() === 'landscape' && first + 1 < data.pageCount ? [first + 1] : [])];
    }
    function update() {
      const pages = visible(), cover = pages[0] === 0;
      $('#status').textContent = cover ? `Cover · 1 / ${data.pageCount}` : `${pages.map(i=>i+1).join('–')} / ${data.pageCount}`;
      $('#prev').disabled = $('#home').disabled = cover;
      $('#next').disabled = pages[pages.length-1] === data.pageCount-1;
      $('#next').textContent = cover ? 'Open cover →' : '→';
      $('#next').setAttribute('aria-label', cover ? 'Open cover' : 'Next page');
      elements.forEach((page,index) => { page.setAttribute('aria-hidden', String(!pages.includes(index))); });
      $('#replay').disabled = !pages.some(index => data.overlays[String(index)]||pageElements(index).length);
      // Books without any animation don't need a Replay button at all.
      $('#replay').hidden = !Object.keys(data.overlays||{}).length && !Object.keys(data.pages||{}).some(key => pageElements(key).length);
    }
    function animate(automatic = true) {
      cancelAnimationFrame(frame);
      const pages = visible(), start = performance.now();
      players.forEach((player,index)=>{if(!player)return;if(pages.includes(index))player.play();else player.stop();});
      if (!pages.some(index => data.overlays[String(index)])) return;
      function draw(now) {
        const progress = automatic && reduced ? 1 : Math.min(1,(now-start)/1800), eased = 1-Math.pow(1-progress,3);
        pages.forEach(index=>{
          const config=data.overlays[String(index)], node=elements[index].querySelector('.stat-overlay');
          if(!config || !node)return;
          node.querySelector('strong').textContent=Math.round(config.value*eased).toLocaleString('id-ID');
          node.style.opacity=String(.2+.8*eased);node.style.transform=`translateY(${16*(1-eased)}px)`;
        });
        if(progress<1)frame=requestAnimationFrame(draw);
      }
      draw(start);
    }
    FlipbookLayout.decorate(elements);
    book = new St.PageFlip($('#book'),{width:380,height:Math.round(380/data.ratio),size:'stretch',minWidth:220,maxWidth:750,minHeight:50,maxHeight:1500,autoSize:true,usePortrait:true,showCover:true,startPage:0,...FlipbookLayout.motion(reduced)});
    book.on('flip',update);book.on('changeOrientation',()=>{update();animate()});
    book.on('changeState',event=>{if(event.data==='read'){update();animate()}else{cancelAnimationFrame(frame);players.forEach(p=>{if(p)p.stop();});$('#home').disabled=$('#prev').disabled=$('#next').disabled=true}});
    book.loadFromHTML(elements);update();animate();
    FlipbookLayout.bind(book,$('#stage'),data.ratio);
    $('#fullscreen').onclick=async()=>{
      try { if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen(); }
      catch(cause){$('#error').hidden=false;$('#error').textContent='Fullscreen is not available on this device.';}
    };
    if(!document.documentElement.requestFullscreen)$('#fullscreen').hidden=true;
    document.addEventListener('fullscreenchange',()=>{$('#fullscreen').textContent=document.fullscreenElement?'Exit fullscreen':'Fullscreen'});
    FlipbookIdle.bind({
      active: () => book.getState() === 'read' && book.getCurrentPageIndex() > 0,
      home: () => { book.turnToPage(0); update(); animate(); }
    });
    $('#home').onclick=()=>{if(book.getState()!=='read')return;book.turnToPage(0);update();animate()};
    $('#prev').onclick=()=>book.flipPrev();$('#next').onclick=()=>book.flipNext();$('#replay').onclick=()=>animate(false);
    document.addEventListener('keydown',event=>{if(event.key==='ArrowRight'&&!$('#next').disabled)book.flipNext();if(event.key==='ArrowLeft'&&!$('#prev').disabled)book.flipPrev()});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);players.forEach(p=>{if(p)p.stop();});}else animate()});
  } catch(cause) { $('#error').hidden=false;$('#error').textContent='The book could not be opened. '+cause.message; }
})();
