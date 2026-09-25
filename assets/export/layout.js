'use strict';
(typeof self!=='undefined'?self:global).FlipbookLayout = {
  motion(reduced) {
    return {useMouseEvents:true,drawShadow:true,maxShadowOpacity:.38,flippingTime:reduced?1:950,showPageCorners:!reduced,disableFlipByClick:false,mobileScrollSupport:true,swipeDistance:30};
  },
  decorate(pages) {
    pages.forEach((page,index)=>{
      // A hard cover has two faces. Only an even page count has a separate
      // closing back-cover sheet in this engine's cover-first spreads.
      const hard=index<2||(pages.length>=4&&pages.length%2===0&&index>=pages.length-2);
      page.dataset.density=hard?'hard':'soft';
      page.classList.add('book-paper');
      if(hard)page.classList.add('book-board');
    });
  },
  geometry(width,height,ratio,index,count) {
    // Same rule as the editor preview so exports look like what was
    // previewed: a two-page spread from 700px wide, one page on phones.
    // Depends on the reading area only, never on the current page;
    // showCover keeps the cover alone without enlarging it.
    const single=count===1 || width<700;
    return {single,minWidth:single?width+1:1,maxWidth:width,maxHeight:height};
  },
  bind(book,stage,ratio,{compact=false}={}) {
    let signature='',frame=0;
    const fit=()=>{
      const w=stage.clientWidth;
      if(compact) {
        const immersive=Boolean(document.fullscreenElement)||Boolean(stage.closest('.reading-fullscreen'));
        if(immersive) stage.style.height='100%';
        else {
          const pages=book.getPageCount()===1||w<700?1:2;
          stage.style.height=(w/(ratio*pages))+'px';
        }
      }
      const h=stage.clientHeight;
      if(!w||!h)return;
      const layout=this.geometry(w,h,ratio,book.getCurrentPageIndex(),book.getPageCount());
      const next=[w,h,layout.single].join(':');if(next===signature)return;signature=next;
      Object.assign(book.getSettings(),layout,{width:ratio*1000,height:1000});
      book.update();
    };
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(fit)};
    const observer=new ResizeObserver(schedule);observer.observe(stage);
    document.addEventListener('fullscreenchange',schedule);
    book.on('flip',schedule);book.on('changeState',event=>{if(event.data==='read')schedule()});
    schedule();return ()=>{observer.disconnect();cancelAnimationFrame(frame);document.removeEventListener('fullscreenchange',schedule)};
  }
};

// Shared inactivity reminder for preview and all exported readers.
(typeof self!=='undefined'?self:global).FlipbookIdle = {
  bind({active, home, host = document.body}) {
    const english = document.documentElement.lang.startsWith('en');
    const overlay = document.createElement('div');
    overlay.className = 'book-idle'; overlay.hidden = true;
    const panel = document.createElement('div'); panel.className = 'book-idle-panel';
    const message = document.createElement('p'); message.setAttribute('role', 'status');
    const resume = document.createElement('button'); resume.type = 'button';
    resume.textContent = english ? 'Continue reading' : 'Lanjut membaca';
    panel.append(message, resume); overlay.append(panel); host.append(overlay);
    let lastActivity = Date.now();
    const reset = () => { lastActivity = Date.now(); overlay.hidden = true; };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'];
    events.forEach(name => document.addEventListener(name, reset, {passive:true}));
    resume.addEventListener('click', reset);
    const check = () => {
      if (!active()) { reset(); return; }
      const remaining = 180000 - (Date.now() - lastActivity);
      if (remaining <= 0) { reset(); home(); return; }
      if (remaining <= 10000) {
        const seconds = Math.ceil(remaining / 1000);
        message.textContent = english
          ? `No activity. Returning to the cover in ${seconds} seconds.`
          : `Tidak ada aktivitas. Kembali ke sampul dalam ${seconds} detik.`;
        overlay.hidden = false;
      }
    };
    const timer = setInterval(check, 250);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer); overlay.remove();
      events.forEach(name => document.removeEventListener(name, reset));
      document.removeEventListener('visibilitychange', check);
    };
  }
};

// Paper page-turn sound, synthesised with Web Audio (no audio file, works
// offline, no licensing). Shared by the preview and every exported reader.
// ES2018 only: exported books must run in old Android WebViews.
(typeof self!=='undefined'?self:global).FlipbookSound = (function () {
  const KEY = 'mf-flip-sound';
  let ctx = null, noise = null, enabled = true;
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch (e) {}
  const buttons = [];

  function context() {
    if (typeof window === 'undefined') return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) { try { ctx = new AC(); } catch (e) { return null; } }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    return ctx;
  }
  // White noise with a little brown noise mixed in gives paper its body.
  function noiseBuffer(c) {
    if (noise) return noise;
    const length = Math.floor(c.sampleRate * 0.8);
    noise = c.createBuffer(1, length, c.sampleRate);
    const data = noise.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      brown = (brown + 0.02 * white) / 1.02;
      data[i] = white * 0.55 + brown * 3.2;
    }
    return noise;
  }
  // One filtered noise burst: bandpass sweeping from `from` to `to` Hz.
  function burst(c, at, duration, peak, from, to) {
    const source = c.createBufferSource();
    source.buffer = noiseBuffer(c);
    source.playbackRate.value = 0.85 + Math.random() * 0.3;
    const band = c.createBiquadFilter();
    band.type = 'bandpass'; band.Q.value = 0.8;
    band.frequency.setValueAtTime(from, at);
    band.frequency.exponentialRampToValueAtTime(to, at + duration);
    const high = c.createBiquadFilter();
    high.type = 'highpass'; high.frequency.value = 300;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + duration * 0.18);
    gain.gain.exponentialRampToValueAtTime(peak * 0.35, at + duration * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(band); band.connect(high); high.connect(gain); gain.connect(c.destination);
    source.start(at, Math.random() * 0.2);
    source.stop(at + duration + 0.05);
  }
  // A page turn: the sheet sweeps across (swish), then settles (soft tap).
  // `target` lets tests render the sound offline (OfflineAudioContext).
  function play(target) {
    if (!enabled) return false;
    const c = target || context();
    if (!c) return false;
    const t = c.currentTime + 0.01;
    const vary = 0.9 + Math.random() * 0.2;
    burst(c, t, 0.42 * vary, 0.55, 3600 * vary, 1100);
    burst(c, t + 0.36 * vary, 0.12, 0.28, 1800, 600);
    return true;
  }
  function render(button) {
    button.textContent = enabled ? '🔊 Sound' : '🔇 Muted';
    button.setAttribute('aria-pressed', String(enabled));
    button.title = enabled ? 'Turn page sound off' : 'Turn page sound on';
  }
  function setEnabled(value) {
    enabled = !!value;
    try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (e) {}
    buttons.forEach(render);
    if (enabled) context();
  }
  // Buttons, keys and swipes put PageFlip in 'flipping'; a mouse/finger drag
  // only reports 'user_fold' and settles without 'flipping', so play when a
  // drag is released (paper sounds when let go, whether it turns or not).
  function attach(book) {
    let state = 'read';
    book.on('changeState', event => { state = event.data; if (state === 'flipping') play(); });
    if (typeof document === 'undefined') return;
    const release = () => { if (state === 'user_fold') { state = 'released'; play(); } };
    ['pointerup', 'mouseup', 'touchend'].forEach(name => document.addEventListener(name, release, true));
  }
  function bindButton(button) {
    if (!button) return;
    buttons.push(button); render(button);
    button.addEventListener('click', () => { setEnabled(!enabled); });
  }
  // Browsers only start audio after a user gesture: unlock on the first one.
  if (typeof document !== 'undefined') {
    const unlock = () => { if (enabled) context(); document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', unlock); };
    document.addEventListener('pointerdown', unlock); document.addEventListener('keydown', unlock);
  }
  return { play, attach, setEnabled, bindButton, isEnabled: () => enabled };
})();
