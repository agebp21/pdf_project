'use strict';
// Used by the animation editor preview and its exported reader.
globalThis.AnimationPlayback = (() => {
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number(n)||0));
  const effects={
    fadeIn:[{opacity:0},{opacity:1}],
    slideUp:[{opacity:0,transform:'translateY(24px)'},{opacity:1,transform:'translateY(0)'}],
    slideDown:[{opacity:0,transform:'translateY(-24px)'},{opacity:1,transform:'translateY(0)'}],
    slideLeft:[{opacity:0,transform:'translateX(24px)'},{opacity:1,transform:'translateX(0)'}],
    slideRight:[{opacity:0,transform:'translateX(-24px)'},{opacity:1,transform:'translateX(0)'}],
    zoomIn:[{opacity:0,transform:'scale(.7)'},{opacity:1,transform:'scale(1)'}],
    bounce:[{opacity:0,transform:'scale(.6)'},{opacity:1,transform:'scale(1.08)',offset:.6},{transform:'scale(.96)',offset:.8},{opacity:1,transform:'scale(1)'}],
    pulse:[{transform:'scale(1)'},{transform:'scale(1.05)'},{transform:'scale(1)'}],
    fadeOut:[{opacity:1},{opacity:0}],
    slideUpOut:[{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-24px)'}],
    slideDownOut:[{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(24px)'}],
    zoomOut:[{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.7)'}]
  };
  // PDF pixels remain in the page image. Animate a visible emphasis layer,
  // rather than pretending the original text has been extracted into objects.
  const zoneEmphasis=[
    {backgroundColor:'rgba(255,210,70,0)',boxShadow:'0 0 0 0 rgba(255,210,70,0)'},
    {backgroundColor:'rgba(255,210,70,.48)',boxShadow:'0 0 14px 3px rgba(255,210,70,.6)',offset:.5},
    {backgroundColor:'rgba(255,210,70,0)',boxShadow:'0 0 0 0 rgba(255,210,70,0)'}
  ];
  function safeLink(link,count){
    if(!link)return null;
    if(link.type==='page')return Number.isInteger(Number(link.target))&&Number(link.target)>=1&&Number(link.target)<=count?{type:'page',target:Number(link.target)}:null;
    if(link.type==='url')try{let target=String(link.target||'').trim();if(!/^[a-z][a-z\d+.-]*:/i.test(target)&&/^(?:[a-z\d-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(target))target='https://'+target;const u=new URL(target);if(['https:','http:','mailto:','tel:'].includes(u.protocol))return {type:'url',target:u.href};}catch(e){}
    return null;
  }
  function previewOut(node,type,duration){
    if(!node||!node.animate||matchMedia('(prefers-reduced-motion: reduce)').matches)return null;
    const frames=effects[type];if(!frames)return null;
    const anim=node.animate(frames,{duration:clamp(duration||600,100,30000),iterations:1,fill:'both',easing:'ease'});
    anim.onfinish=()=>{try{anim.cancel();}catch(e){}};
    return anim;
  }
  function mount(host,elements,{count,goPage,imageBox}={}){
    const entries=[];
    host.style.containerType='size';
    for(const el of elements||[]){
      const link=safeLink(el.link,count);
      const outer=document.createElement(link?.type==='url'?'a':'div');outer.className='ap-element';
      const frame=imageBox||{x:0,y:0,w:100,h:100};
      Object.assign(outer.style,{left:(frame.x+clamp(el.x,0,100)*frame.w/100)+'%',top:(frame.y+clamp(el.y,0,100)*frame.h/100)+'%',width:clamp(el.w,.1,100)*frame.w/100+'%',height:clamp(el.h,.1,100)*frame.h/100+'%',transform:`rotate(${Number(el.rotation)||0}deg)`});
      const body=document.createElement('div');body.className='ap-content';outer.append(body);
      const s=el.style||{},zone=el.isPdfZone||el.type==='pdfZone';
      const visual=document.createElement('div');visual.className='ap-visual'+(zone?' ap-zone':'');body.append(visual);
      visual.style.opacity=String(s.opacity==null?1:clamp(s.opacity,0,1));
      if(el.type==='image'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(el.src||'')){
        const img=document.createElement('img');img.src=el.src;img.alt=el.content||'Gambar';img.draggable=false;visual.classList.add('ap-image');visual.append(img);
      }
      else if(zone){visual.title=el.content||'Zona PDF';}
      else {
        visual.textContent=el.content||'';
        Object.assign(visual.style,{fontSize:(clamp(s.fontSize,6,200)/18*3.3*frame.h/100)+'cqh',color:s.color||'#1a1a1a',background:s.bgColor||'transparent',fontWeight:s.bold?'700':'400',fontStyle:s.italic?'italic':'normal',textAlign:s.align||'left'});
        if(el.type==='hotspot')visual.classList.add('ap-hotspot');
        if(el.isExtracted){visual.classList.add('ap-extracted');visual.style.fontFamily=s.fontFamily||'sans-serif';visual.style.fontSize=(Math.max(.01,Number(s.fontSize)||18)/18*3.3*frame.h/100)+'cqh';}
      }
      if(link){
        outer.classList.add('ap-link');outer.tabIndex=0;outer.setAttribute('role','link');outer.setAttribute('aria-label',el.content||'Open link');
        if(link.type==='url'){outer.href=link.target;outer.target='_blank';outer.rel='noopener noreferrer';}
        for(const event of ['pointerdown','mousedown','touchstart'])outer.addEventListener(event,e=>e.stopPropagation());
        outer.addEventListener('click',e=>{e.stopPropagation();if(link.type==='page')goPage?.(link.target-1);});
        outer.addEventListener('keydown',e=>{if(e.key===' '||(e.key==='Enter'&&link.type==='page')){e.preventDefault();e.stopPropagation();outer.click();}});
      }
      host.append(outer);entries.push({outer,body,visual,zone,el,animation:null,emphasis:null});
    }
    const stop=()=>entries.forEach(e=>{e.animation?.cancel();e.emphasis?.cancel();e.animation=null;e.emphasis=null;e.body.style.opacity='1'});
    return {play(){stop();if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      entries.forEach(e=>{const a=e.el.animation||{},frames=effects[a.type];if(!frames||!e.body.animate)return;
        e.animation=e.body.animate(frames,{duration:clamp(a.duration||600,100,30000),delay:clamp(a.delay,0,30000),iterations:a.type==='pulse'?Infinity:1,fill:'both',easing:'ease'});
        if(e.zone)e.emphasis=e.visual.animate(zoneEmphasis,{duration:Math.max(1200,clamp(a.duration||600,100,30000)),delay:clamp(a.delay,0,30000),iterations:a.type==='pulse'?Infinity:2,fill:'none',easing:'ease-in-out'});
      });},stop,destroy(){stop();entries.forEach(e=>e.outer.remove())}};
  }
  return {mount,safeLink,previewOut};
})();
