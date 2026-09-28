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

// Clickable links on pages (table of contents, cross references, URLs).
// Coordinates are fractions of the page box; internal links flip to their
// page with the normal animation. ES2018 for old Android WebViews.
(typeof self!=='undefined'?self:global).FlipbookLinks = {
  mount(page, links, goPage) {
    const old = page.querySelector('.book-links');
    if (old) old.remove();
    if (!links || !links.length) return;
    const layer = document.createElement('div');
    layer.className = 'book-links';
    links.forEach(link => {
      const a = document.createElement('a');
      a.className = 'book-link';
      a.style.left = link.x * 100 + '%'; a.style.top = link.y * 100 + '%';
      a.style.width = link.w * 100 + '%'; a.style.height = link.h * 100 + '%';
      if (typeof link.url === 'string') {
        a.href = link.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.title = link.url;
      } else {
        a.href = '#'; a.title = 'Go to page ' + (link.page + 1);
        a.setAttribute('aria-label', 'Go to page ' + (link.page + 1));
        a.addEventListener('click', event => { event.preventDefault(); goPage(link.page); });
      }
      // Keep PageFlip from starting a page drag when a link is pressed.
      ['pointerdown', 'mousedown', 'touchstart'].forEach(name => a.addEventListener(name, event => event.stopPropagation()));
      layer.appendChild(a);
    });
    page.appendChild(layer);
  },
};

// Reader bookmarks: a ribbon on marked pages and a list to jump back to
// them, kept per book on this device. ES2018 for old Android WebViews.
(typeof self!=='undefined'?self:global).FlipbookBookmarks = {
  // Stable per-book key: title + page count (+ ratio) hashed.
  key(title, pageCount, ratio) {
    let hash = 5381;
    const text = String(title) + '|' + pageCount + '|' + Math.round((ratio || 1) * 1000);
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
    return 'mf-bookmarks:' + hash.toString(36);
  },
  load(key) {
    try { const list = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(list) ? list.filter(Number.isInteger) : []; } catch (e) { return []; }
  },
  save(key, list) { try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) {} },
  /* options: {key, pages (elements), visible(): indexes on screen, goPage(i), toggle (button), open (button)} */
  bind(options) {
    const self = this, pages = options.pages;
    let marks = self.load(options.key).filter(i => i >= 0 && i < pages.length).sort((a, b) => a - b);
    let panel = null;
    const label = i => (i === 0 ? 'Cover' : 'Page ' + (i + 1));
    function ribbons() {
      pages.forEach((page, index) => {
        const existing = page.querySelector('.book-ribbon');
        if (marks.indexOf(index) >= 0 && !existing) {
          const ribbon = document.createElement('span');
          ribbon.className = 'book-ribbon'; ribbon.setAttribute('aria-hidden', 'true');
          page.appendChild(ribbon);
        } else if (marks.indexOf(index) < 0 && existing) existing.remove();
      });
    }
    function refresh() {
      const on = options.visible().some(i => marks.indexOf(i) >= 0);
      if (options.toggle) {
        options.toggle.textContent = on ? '🔖 Marked' : '🔖 Mark';
        options.toggle.setAttribute('aria-pressed', String(on));
        options.toggle.title = on ? 'Remove the bookmark on this page' : 'Bookmark this page';
      }
      if (options.open) {
        options.open.textContent = '☰ ' + marks.length;
        options.open.title = 'Bookmarks (' + marks.length + ')';
        options.open.setAttribute('aria-label', 'Bookmarks, ' + marks.length);
      }
      ribbons();
      if (panel) render();
    }
    function persist() { marks.sort((a, b) => a - b); self.save(options.key, marks); refresh(); }
    function toggle() {
      const visible = options.visible(), marked = visible.filter(i => marks.indexOf(i) >= 0);
      if (marked.length) marks = marks.filter(i => marked.indexOf(i) < 0);
      else if (visible.length) marks.push(visible[0]);
      persist();
    }
    function close() {
      if (!panel) return;
      panel.remove(); panel = null;
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape);
      if (options.open) options.open.setAttribute('aria-expanded', 'false');
    }
    function outside(event) { if (panel && !panel.contains(event.target) && event.target !== options.open) close(); }
    function escape(event) { if (event.key === 'Escape') close(); }
    function render() {
      while (panel.firstChild) panel.removeChild(panel.firstChild);
      const title = document.createElement('p'); title.className = 'book-marks-title'; title.textContent = 'Bookmarks';
      panel.appendChild(title);
      if (!marks.length) {
        const empty = document.createElement('p'); empty.className = 'book-marks-empty';
        empty.textContent = 'No bookmarks yet. Press 🔖 Mark to keep your place.';
        panel.appendChild(empty); return;
      }
      marks.forEach(index => {
        const row = document.createElement('div'); row.className = 'book-mark';
        const go = document.createElement('button'); go.type = 'button'; go.className = 'book-mark-go';
        const image = pages[index].querySelector('img');
        if (image && image.src) { const thumb = document.createElement('img'); thumb.src = image.src; thumb.alt = ''; go.appendChild(thumb); }
        const text = document.createElement('span'); text.textContent = label(index); go.appendChild(text);
        go.addEventListener('click', () => { close(); options.goPage(index); });
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'book-mark-remove';
        remove.textContent = '×'; remove.title = 'Remove bookmark'; remove.setAttribute('aria-label', 'Remove bookmark on ' + label(index));
        remove.addEventListener('click', () => { marks = marks.filter(i => i !== index); persist(); });
        row.appendChild(go); row.appendChild(remove); panel.appendChild(row);
      });
    }
    function open() {
      if (panel) { close(); return; }
      panel = document.createElement('div'); panel.className = 'book-marks'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Bookmarks');
      render(); document.body.appendChild(panel);
      if (options.open) options.open.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape);
    }
    // onclick (not addEventListener): the preview rebinds these buttons for
    // every PDF it opens, and handlers must not pile up.
    if (options.toggle) options.toggle.onclick = toggle;
    if (options.open) options.open.onclick = open;
    refresh();
    return { refresh, close, marks: () => marks.slice() };
  },
};
