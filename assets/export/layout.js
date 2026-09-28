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
  let ctx = null, enabled = true, style = 'paper';
  const cache = {};
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
  // A real page turn has three parts: tiny crinkles while the sheet lifts
  // and bends, an air "swoosh" while it swings over, and a soft slap when it
  // lands. Rendered sample by sample (deterministic per seed) and cached.
  const STYLES = {
    paper: { dur: 0.62, crinkle: 0.6, grain: [2500, 7000], swoosh: 0.45, sweep: [700, 2600, 900], flap: 0.35, thump: 110 },
    crisp: { dur: 0.52, crinkle: 1.0, grain: [3500, 9500], swoosh: 0.3, sweep: [1200, 4200, 1500], flap: 0.5, thump: 150 },
    thick: { dur: 0.74, crinkle: 0.3, grain: [1500, 4500], swoosh: 0.65, sweep: [400, 1500, 600], flap: 0.6, thump: 80 },
  };
  function random(seed) {
    let x = (seed >>> 0) || 1;
    return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  }
  // Smooth rise/fall between a and b with its peak at m (0 outside).
  function hump(t, a, m, b) {
    if (t <= a || t >= b) return 0;
    const v = t < m ? Math.sin((t - a) / (m - a) * Math.PI / 2) : Math.cos((t - m) / (b - m) * Math.PI / 2);
    return v * v;
  }
  function synth(name, rate, seed) {
    const st = STYLES[name] || STYLES.paper, T = st.dur, n = Math.floor(rate * T);
    const out = new Float32Array(n), rnd = random(seed);
    // Swoosh: noise through a state-variable bandpass whose centre sweeps.
    let low = 0, band = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate, p = Math.min(1, t / (T * 0.8));
      const f = p < 0.5 ? st.sweep[0] + (st.sweep[1] - st.sweep[0]) * p * 2 : st.sweep[1] + (st.sweep[2] - st.sweep[1]) * (p - 0.5) * 2;
      const k = 2 * Math.sin(Math.PI * Math.min(f, rate / 6) / rate);
      low += k * band; band += k * ((rnd() * 2 - 1) - low - 0.9 * band);
      out[i] += band * st.swoosh * hump(t, 0, T * 0.3, T * 0.82);
    }
    // Crinkle: sparse micro-bursts (random clicks), densest while the sheet bends.
    for (let t = 0; t < T * 0.75;) {
      const shape = hump(t, 0.01, T * 0.25, T * 0.75);
      t += -Math.log(1 - rnd()) / (60 + 320 * shape * st.crinkle);
      const at = Math.floor(t * rate), len = Math.floor(rate * (0.0015 + rnd() * 0.004));
      const amp = (0.25 + rnd() * 0.75) * st.crinkle * (0.15 + shape);
      const fc = st.grain[0] + rnd() * (st.grain[1] - st.grain[0]), a = Math.exp(-2 * Math.PI * fc / rate);
      let lp = 0;
      for (let j = 0; j < len && at + j < n; j++) {
        const x = (rnd() * 2 - 1) * Math.exp(-j / (len * 0.35));
        lp = lp * a + x * (1 - a);
        out[at + j] += (x - lp) * amp * 0.6;
      }
    }
    // Landing: low thump plus a short, dull slap.
    const land = Math.floor(T * 0.78 * rate);
    let dull = 0;
    for (let j = 0; j < rate * 0.09 && land + j < n; j++) {
      const t = j / rate;
      dull += ((rnd() * 2 - 1) - dull) * 0.25;
      out[land + j] += (Math.sin(2 * Math.PI * st.thump * t) * Math.exp(-t / 0.018) * 0.7 + dull * Math.exp(-t / 0.012) * 1.2) * st.flap;
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
    const gain = peak ? 0.6 / peak : 0;
    for (let i = 0; i < n; i++) out[i] *= gain * Math.min(1, i / (rate * 0.005), (n - i) / (rate * 0.02));
    return out;
  }
  // Three pre-rendered variations per style and sample rate, picked at random.
  function buffers(c) {
    const key = style + '@' + c.sampleRate;
    if (!cache[key]) {
      cache[key] = [11, 23, 37].map(seed => {
        const data = synth(style, c.sampleRate, seed + style.length * 101);
        const buffer = c.createBuffer(1, data.length, c.sampleRate);
        buffer.getChannelData(0).set(data);
        return buffer;
      });
    }
    return cache[key];
  }
  // `target` lets tests render the sound offline (OfflineAudioContext).
  function play(target) {
    if (!enabled) return false;
    const c = target || context();
    if (!c) return false;
    const list = buffers(c), source = c.createBufferSource();
    source.buffer = list[Math.floor(Math.random() * list.length)];
    source.playbackRate.value = 0.94 + Math.random() * 0.12;
    const gain = c.createGain();
    gain.gain.value = 0.9;
    let last = gain;
    // The sheet travels from the right-hand page to the left.
    if (c.createStereoPanner) {
      const pan = c.createStereoPanner(), t = c.currentTime;
      pan.pan.setValueAtTime(0.45, t);
      pan.pan.linearRampToValueAtTime(-0.45, t + STYLES[style].dur);
      gain.connect(pan); last = pan;
    }
    source.connect(gain); last.connect(c.destination);
    source.start();
    return true;
  }
  function setStyle(name) { if (STYLES[name]) style = name; }
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
  return { play, attach, setEnabled, bindButton, setStyle, synth, styles: Object.keys(STYLES), isEnabled: () => enabled };
})();
