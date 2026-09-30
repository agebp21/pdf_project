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
      const image = document.createElement('img'); image.alt = `Page ${index + 1}`;
      // A sealed one-file book hands out decrypted pages; otherwise pages/N.jpg.
      if (window.FLIPBOOK_PAGE_URL) window.FLIPBOOK_PAGE_URL(index, url => { image.src = url; });
      else image.src = `pages/${index + 1}.jpg`;
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
    // Odd page counts get a blank back cover so the book can close.
    const sheets = FlipbookLayout.withBackCover(elements, 'page');
    $('#book').append(...sheets);
    const players=elements.map((page,index)=>{
      if(data.version!==2)return null;
      const ratio=(data.pageRatios&&data.pageRatios[index])||data.ratio;
      const w=ratio<data.ratio?ratio/data.ratio*100:100,h=ratio>data.ratio?data.ratio/ratio*100:100;
      return AnimationPlayback.mount(page,pageElements(index),{count:data.pageCount,imageBox:{x:(100-w)/2,y:(100-h)/2,w,h},goPage:index=>{if(book.getState()==='read'){book.turnToPage(index);update();animate();}}});
    });
    // Sheets on screen (may include the blank back cover) / document pages on screen.
    function onScreen() {
      const first = book.getCurrentPageIndex();
      return [first, ...(first > 0 && book.getOrientation() === 'landscape' && first + 1 < sheets.length ? [first + 1] : [])];
    }
    const visible = () => onScreen().filter(index => index < data.pageCount);
    function update() {
      const shown = onScreen(), pages = visible(), cover = shown[0] === 0;
      $('#status').textContent = cover ? `Cover · 1 / ${data.pageCount}` : !pages.length ? 'Back cover' : `${pages.map(i=>i+1).join('–')} / ${data.pageCount}`;
      $('#prev').disabled = $('#home').disabled = cover;
      $('#next').disabled = shown[shown.length-1] === sheets.length-1;
      $('#next').textContent = cover ? 'Open cover →' : '→';
      $('#next').setAttribute('aria-label', cover ? 'Open cover' : 'Next page');
      sheets.forEach((page,index) => { page.setAttribute('aria-hidden', String(!shown.includes(index))); });
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
    FlipbookLayout.decorate(sheets);
    book = new St.PageFlip($('#book'),{width:380,height:Math.round(380/data.ratio),size:'stretch',minWidth:220,maxWidth:750,minHeight:50,maxHeight:1500,autoSize:true,usePortrait:true,showCover:true,startPage:0,...FlipbookLayout.motion(reduced),
      // After motion(), which allows click-to-flip: on touch a tap in the middle of a page
      // doesn't turn it (double-tap zooms); swipes and corner taps still do.
      disableFlipByClick:matchMedia('(hover: none)').matches});
    book.on('flip',update);book.on('changeOrientation',()=>{update();animate()});
    FlipbookSound.attach(book);
    // Skip pages already on screen; a hovered corner (fold_corner) may still flip.
    const goPage = target => { if (['read', 'fold_corner'].indexOf(book.getState()) >= 0 && visible().indexOf(target) < 0) book.flip(target, 'top'); };
    Object.keys(data.links || {}).forEach(key => FlipbookLinks.mount(elements[Number(key)], data.links[key], goPage));
    book.on('changeState',event=>{if(event.data==='read'){update();animate()}else{cancelAnimationFrame(frame);players.forEach(p=>{if(p)p.stop();});$('#home').disabled=$('#prev').disabled=$('#next').disabled=true}});
    book.loadFromHTML(sheets);update();animate();
    // After loadFromHTML: PageFlip has no current page before that.
    const marks = FlipbookBookmarks.bind({key: FlipbookBookmarks.key(data.title, data.pageCount, data.ratio), pages: elements,
      visible, goPage, toggle: $('#bookmark'), open: $('#bookmarks')});
    book.on('flip', () => marks.refresh());
    // Reader notes: ✎ on the edge of every page, kept on this device.
    const notes = FlipbookNotes.bind({key: FlipbookNotes.key(data.title, data.pageCount, data.ratio), title: data.title,
      pages: elements, goPage, open: $('#notes'), bookmark: (index, on) => marks.set(index, on)});
    // Highlighter ("stabilo"): snaps to the words read from the PDF.
    const highlights = FlipbookHighlights.bind({key: FlipbookHighlights.key(data.title, data.pageCount, data.ratio),
      pages: elements, words: data.words || {}, button: $('#highlight')});
    // Magnifier: a lens dragged over the page.
    const loupe = FlipbookLoupe.bind({pages: elements, button: $('#loupe')});
    // Like the preview, the book ends above the control bar so the bar never
    // covers the bottom of a page (measured: the bar wraps on small phones).
    const reserveBar = () => { document.querySelector('main').style.bottom = ($('footer').offsetHeight + 16) + 'px'; };
    reserveBar(); addEventListener('resize', reserveBar);
    FlipbookSound.bindButton($('#sound'));
    FlipbookLayout.bind(book,$('#stage'),data.ratio);
    FlipbookLayout.centerCover(book, $('#book'), reduced);
    const curl = FlipbookCurl.bind(book, $('#book'), sheets, {reduced, onTurn: () => FlipbookSound.play()});
    $('#fullscreen').onclick=async()=>{
      try { if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen(); }
      catch(cause){$('#error').hidden=false;$('#error').textContent='Fullscreen is not available on this device.';}
    };
    if(!document.documentElement.requestFullscreen)$('#fullscreen').hidden=true;
    // Inside the Android/Windows app: a close button (the app is already full screen on Android).
    const android=window.MyFlipbook&&window.MyFlipbook.postMessage?window.MyFlipbook:null;
    const webview=window.chrome&&window.chrome.webview&&window.chrome.webview.postMessage?window.chrome.webview:null;
    if(android||webview){
      $('#close').hidden=false;
      $('#close').onclick=()=>(android||webview).postMessage('close');
      if(android)$('#fullscreen').hidden=true;
    }
    document.addEventListener('fullscreenchange',()=>{$('#fullscreen').textContent=document.fullscreenElement?'Exit fullscreen':'Fullscreen'});
    FlipbookIdle.bind({
      active: () => book.getState() === 'read' && book.getCurrentPageIndex() > 0 && !notes.editing() && !highlights.active() && !loupe.active(),
      home: () => { book.turnToPage(0); update(); animate(); }
    });
    const zoom = FlipbookZoom.bind($('main'), $('#stage'), {button: $('#zoom'), chip: $('#zoom-chip'), hint: $('#zoom-hint'),
      // The pages on screen (PageFlip's bounds inside its block): pan no further than the book.
      content: () => {
        const bounds = book.getBoundsRect(), block = document.querySelector('#book .stf__block');
        if (!bounds || !block) return null;
        const b = block.getBoundingClientRect(), s = b.width / (block.offsetWidth || b.width);
        return {left: b.left + bounds.left * s, top: b.top + bounds.top * s, width: bounds.width * s, height: bounds.height * s};
      }});
    book.on('flip', () => zoom.reset());
    // The cover opens/closes with the curved turn; ignore clicks while it animates.
    const goPrev=()=>{zoom.reset();if(curl.busy())return;if(book.getCurrentPageIndex()===1&&curl.close())return;book.flipPrev()};
    const goNext=()=>{zoom.reset();if(curl.busy())return;if(!curl.open())book.flipNext()};
    $('#home').onclick=()=>{zoom.reset();if(curl.busy()||curl.close())return;if(book.getState()!=='read')return;book.turnToPage(0);update();animate()};
    $('#prev').onclick=goPrev;$('#next').onclick=goNext;$('#replay').onclick=()=>animate(false);
    document.addEventListener('keydown',event=>{if(FlipbookNotes.typing(event))return;if(event.key==='ArrowRight'&&!$('#next').disabled)goNext();if(event.key==='ArrowLeft'&&!$('#prev').disabled)goPrev()});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);players.forEach(p=>{if(p)p.stop();});}else animate()});
  } catch(cause) { $('#error').hidden=false;$('#error').textContent='The book could not be opened. '+cause.message; }
})();
