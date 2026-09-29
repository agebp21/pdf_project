'use strict';
(typeof self!=='undefined'?self:global).FlipbookLayout = {
  motion(reduced) {
    return {useMouseEvents:true,drawShadow:true,maxShadowOpacity:.38,flippingTime:reduced?1:1150,showPageCorners:!reduced,disableFlipByClick:false,mobileScrollSupport:true,swipeDistance:30};
  },
  decorate(pages) {
    pages.forEach((page,index)=>{
      // A hard cover has two faces. Only an even page count has a separate
      // closing back-cover sheet in this engine's cover-first spreads.
      const hard=index<2||(pages.length>=4&&pages.length%2===0&&index>=pages.length-2);
      // Covers keep their board look but bend like paper when turned: a
      // 'hard' page swings as a rigid plate, which reads as stiff.
      page.dataset.density='soft';
      page.classList.add('book-paper');
      if(hard)page.classList.add('book-board');
    });
  },
  // An odd page count ends on a right-hand page with nothing to turn it
  // over onto, so the book could never close. Like a real book, add a blank
  // back cover (engine only; it is not a page of the document).
  withBackCover(pages,className) {
    if(pages.length<3||pages.length%2===0)return pages.slice();
    const back=document.createElement('article');
    back.className=className+' book-back-blank';back.setAttribute('aria-label','Back cover');
    return pages.concat([back]);
  },
  geometry(width,height,ratio,index,count,compact) {
    // Same rule as the editor preview so exports look like what was
    // previewed: a two-page spread from 700px wide, one page on phones held
    // upright. A landscape phone (wider than tall) keeps the spread; the
    // compact editor preview sizes its height from this, so width decides.
    // Depends on the reading area only, never on the current page;
    // showCover keeps the cover alone without enlarging it.
    const single=count===1 || (width<700 && (compact || width<=height));
    return {single,minWidth:single?width+1:1,maxWidth:width,maxHeight:height};
  },
  // A closed book sits centred: the front cover alone would otherwise fill
  // only the right half (and a lone back cover the left half). Opening the
  // cover slides the book to its spread position while the cover turns;
  // closing it turns first, then glides back to the centre.
  centerCover(book, root, reduced) {
    const count = () => book.getPageCount();
    const closedShift = () => {
      if (book.getOrientation() !== 'landscape') return 0;
      const rect = book.getBoundsRect(), index = book.getCurrentPageIndex();
      if (!rect || !rect.pageWidth) return 0;
      if (index === 0) return -rect.pageWidth / 2;
      if (index === count() - 1 && count() % 2 === 0) return rect.pageWidth / 2;
      return 0;
    };
    const apply = x => { root.style.transform = x ? 'translateX(' + x.toFixed(1) + 'px)' : ''; };
    const settle = () => apply(closedShift());
    root.classList.add('book-shift');
    if (reduced) root.classList.add('book-shift-instant');
    book.on('changeState', event => {
      // Leaving a closed cover by button/key/swipe: slide while it opens.
      // (A drag keeps the book still under the finger; it settles on release.)
      if (event.data === 'flipping' && closedShift() !== 0) apply(0);
      if (event.data === 'read') settle();
    });
    book.on('flip', settle); book.on('changeOrientation', settle);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => settle()).observe(root);
    settle();
    return settle;
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
      const layout=this.geometry(w,h,ratio,book.getCurrentPageIndex(),book.getPageCount(),compact);
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
    let panel = null, mode = '';
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
        options.toggle.title = options.visible().length > 1 ? 'Bookmark the left or right page' : (on ? 'Remove the bookmark on this page' : 'Bookmark this page');
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
    function flip(index) {
      marks = marks.indexOf(index) >= 0 ? marks.filter(i => i !== index) : marks.concat([index]);
      persist();
    }
    // One page on screen: mark it. A two-page spread: pick left and/or right.
    function toggle() {
      const visible = options.visible();
      if (visible.length === 1) flip(visible[0]);
      else if (visible.length > 1) show('pick');
    }
    function close() {
      if (!panel) return;
      panel.remove(); panel = null; mode = '';
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape);
      if (options.open) options.open.setAttribute('aria-expanded', 'false');
      if (options.toggle) options.toggle.setAttribute('aria-expanded', 'false');
    }
    function outside(event) {
      if (panel && !panel.contains(event.target) && event.target !== options.open && event.target !== options.toggle) close();
    }
    function escape(event) { if (event.key === 'Escape') close(); }
    function thumb(button, index) {
      const image = pages[index].querySelector('img');
      if (image && image.src) { const img = document.createElement('img'); img.src = image.src; img.alt = ''; button.appendChild(img); }
    }
    function renderPick() {
      const visible = options.visible();
      if (visible.length < 2) { close(); return; }
      const title = document.createElement('p'); title.className = 'book-marks-title'; title.textContent = 'Bookmark a page';
      panel.appendChild(title);
      visible.forEach((index, n) => {
        const on = marks.indexOf(index) >= 0;
        const row = document.createElement('div'); row.className = 'book-mark';
        const pick = document.createElement('button'); pick.type = 'button';
        pick.className = on ? 'book-mark-go book-mark-pick is-marked' : 'book-mark-go book-mark-pick';
        pick.setAttribute('aria-pressed', String(on));
        thumb(pick, index);
        const text = document.createElement('span');
        text.textContent = (n === 0 ? 'Left · ' : 'Right · ') + label(index);
        pick.appendChild(text);
        const state = document.createElement('b'); state.className = 'book-mark-state';
        state.textContent = on ? '🔖 Marked' : '＋ Mark';
        pick.appendChild(state);
        pick.addEventListener('click', () => flip(index));
        row.appendChild(pick); panel.appendChild(row);
      });
    }
    function render() {
      while (panel.firstChild) panel.removeChild(panel.firstChild);
      if (mode === 'pick') { renderPick(); return; }
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
        thumb(go, index);
        const text = document.createElement('span'); text.textContent = label(index); go.appendChild(text);
        go.addEventListener('click', () => { close(); options.goPage(index); });
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'book-mark-remove';
        remove.textContent = '×'; remove.title = 'Remove bookmark'; remove.setAttribute('aria-label', 'Remove bookmark on ' + label(index));
        remove.addEventListener('click', () => { marks = marks.filter(i => i !== index); persist(); });
        row.appendChild(go); row.appendChild(remove); panel.appendChild(row);
      });
    }
    function show(kind) {
      const same = panel && mode === kind;
      close();
      if (same) return;
      mode = kind;
      panel = document.createElement('div'); panel.className = 'book-marks'; panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', kind === 'pick' ? 'Bookmark a page' : 'Bookmarks');
      render(); document.body.appendChild(panel);
      const button = kind === 'pick' ? options.toggle : options.open;
      if (button) button.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape);
    }
    function open() { show('list'); }
    // onclick (not addEventListener): the preview rebinds these buttons for
    // every PDF it opens, and handlers must not pile up.
    if (options.toggle) options.toggle.onclick = toggle;
    if (options.open) options.open.onclick = open;
    refresh();
    return { refresh, close, marks: () => marks.slice() };
  },
};

// Curved cover turn. PageFlip folds a page along one straight crease, which
// looks stiff for a cover; this opens/closes the cover as a chain of thin
// vertical strips, the free edge leading so the board bends, shaded by angle.
// The book itself jumps to the spread underneath; the overlay hides the cut.
// Landscape only (portrait/reduced motion fall back to the normal flip).
// ES2018 for old Android WebViews.
(typeof self!=='undefined'?self:global).FlipbookCurl = {
  STRIPS: 36,
  DURATION: 1250,
  // Rotation of each strip (relative to the previous one, as the strips are
  // nested) for a cover turned `theta` (0..PI) about the spine. The spine
  // side turns rigidly with theta; the free edge trails by up to `bend`
  // radians (sign = turn direction), so the board curls mid-turn and lies
  // flat again at both ends. Clamped so no part dips through the book.
  angles(theta, bend, n) {
    const out = [];
    let previous = 0;
    for (let i = 0; i < n; i++) {
      const s = n > 1 ? i / (n - 1) : 0;
      const angle = Math.max(0, Math.min(Math.PI, theta - bend * s * s));
      out.push(angle - previous); previous = angle;
    }
    return out;
  },
  bind(book, root, pages, options) {
    const self = this, opts = options || {};
    let busy = false;
    const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const src = i => { const img = pages[i] && pages[i].querySelector('img'); return img ? (img.currentSrc || img.src) : ''; };
    function ready() {
      return !opts.reduced && !busy && pages.length >= 3 && book.getOrientation() === 'landscape' &&
        ['read', 'fold_corner'].indexOf(book.getState()) >= 0;
    }
    // Right-hand page slot relative to root (where the closed cover sits).
    function slot() {
      const bounds = book.getBoundsRect(), block = root.querySelector('.stf__block') || root;
      const b = block.getBoundingClientRect(), r = root.getBoundingClientRect();
      return { x: b.left - r.left + bounds.left + bounds.pageWidth, y: b.top - r.top + bounds.top, w: bounds.pageWidth, h: bounds.height };
    }
    function build(geo) {
      const stage = document.createElement('div');
      stage.className = 'cover-curl';
      stage.style.left = (geo.x - geo.w) + 'px'; stage.style.top = geo.y + 'px';
      stage.style.width = geo.w * 2 + 'px'; stage.style.height = geo.h + 'px';
      stage.style.perspective = Math.round(geo.w * 6) + 'px';
      const width = geo.w / self.STRIPS, strips = [];
      let parent = stage;
      const face = (url, x, back) => {
        const el = document.createElement('div');
        el.className = back ? 'cover-curl-face cover-curl-back' : 'cover-curl-face';
        el.style.backgroundImage = 'url("' + url + '")';
        el.style.backgroundSize = geo.w + 'px ' + geo.h + 'px';
        el.style.backgroundPosition = (-x) + 'px 0';
        const shade = document.createElement('div'); shade.className = 'cover-curl-shade';
        el.appendChild(shade);
        return el;
      };
      for (let i = 0; i < self.STRIPS; i++) {
        const strip = document.createElement('div');
        strip.className = 'cover-curl-strip';
        strip.style.left = (i === 0 ? geo.w : width) + 'px';
        strip.style.width = (width + 0.7) + 'px'; strip.style.height = geo.h + 'px';
        const front = face(src(0), i * width, false), back = face(src(1), geo.w - (i + 1) * width, true);
        strip.appendChild(front); strip.appendChild(back);
        parent.appendChild(strip); parent = strip;
        strips.push({ el: strip, shades: [front.firstChild, back.firstChild] });
      }
      root.appendChild(stage);
      return { stage, strips };
    }
    function pose(strips, theta, bend) {
      const phis = self.angles(theta, bend, strips.length);
      // Light falls off as the sheet turns away from the viewer. Each strip
      // gets a gradient from its own angle to the next one's, so the bend
      // shades smoothly instead of in steps.
      const dark = [];
      let total = 0;
      phis.forEach(phi => { total += phi; dark.push((1 - Math.abs(Math.cos(total))) * 0.5); });
      dark.push(dark[dark.length - 1]);
      phis.forEach((phi, i) => {
        strips[i].el.style.transform = 'rotateY(' + (-phi).toFixed(4) + 'rad)';
        const a = 'rgba(0,0,0,' + dark[i].toFixed(3) + ')', b = 'rgba(0,0,0,' + dark[i + 1].toFixed(3) + ')';
        strips[i].shades[0].style.background = 'linear-gradient(to right,' + a + ',' + b + ')';
        strips[i].shades[1].style.background = 'linear-gradient(to left,' + a + ',' + b + ')';
      });
    }
    function run(from, to, done, after, halfway) {
      busy = true;
      const view = build(slot()), direction = to > from ? 1 : -1, start = performance.now();
      pose(view.strips, from, 0);
      if (opts.onTurn) opts.onTurn();
      const frame = now => {
        const t = Math.min(1, (now - start) / self.DURATION), e = ease(t);
        // The free edge trails by at most 3/4 of the distance turned so far:
        // more and it would rest on the book and be dragged flat across it.
        const theta = from + (to - from) * e;
        if (halfway && e >= 0.5) { halfway(); halfway = null; }
        pose(view.strips, theta, direction * Math.min(Math.sin(Math.PI * e), 0.75 * Math.abs(theta - from)));
        if (t < 1) { requestAnimationFrame(frame); return; }
        done();
        // Let the book repaint under the overlay, then fade it out so the
        // swap to the real page (with its spine shading) doesn't blink.
        requestAnimationFrame(() => {
          view.stage.style.transition = 'opacity .18s ease-out'; view.stage.style.opacity = '0';
          setTimeout(() => { view.stage.remove(); busy = false; if (after) after(); }, 200);
        });
      };
      requestAnimationFrame(frame);
    }
    function open() {
      if (!ready() || book.getCurrentPageIndex() !== 0) return false;
      pages[1].classList.add('curl-hidden');       // the cover's back face shows it while turning (class: PageFlip rewrites inline styles)
      book.turnToPage(1);                            // spread behind the overlay (and the book slides to centre)
      run(0, Math.PI, () => { pages[1].classList.remove('curl-hidden'); });
      return true;
    }
    function close() {
      if (!ready() || book.getCurrentPageIndex() === 0) return false;
      if (book.getCurrentPageIndex() !== 1) book.turnToPage(1);   // Home from deep pages: close from the first spread
      pages[1].classList.add('curl-hidden');
      // Slide to the closed-cover centre during the second half of the turn,
      // once the cover has left the left page (earlier would drag that page
      // off the stage; afterwards would be a second jerk). centerCover
      // settles on the same value later.
      const slide = () => {
        const bounds = book.getBoundsRect();
        if (!bounds || !bounds.pageWidth) return;
        root.style.transitionDuration = (self.DURATION / 2000).toFixed(2) + 's';
        root.style.transform = 'translateX(' + (-bounds.pageWidth / 2).toFixed(1) + 'px)';
      };
      // Page 2 comes back only once the overlay is gone: PageFlip draws the
      // closed cover a frame later, and until then it would flash on the left.
      run(Math.PI, 0, () => { book.turnToPage(0); },
        () => { pages[1].classList.remove('curl-hidden'); root.style.transitionDuration = ''; }, slide);
      return true;
    }
    // A click on the closed cover opens it with the curl (mouse only: touch
    // swipes/drags keep PageFlip's own turn).
    pages[0].addEventListener('mousedown', event => { if (book.getCurrentPageIndex() === 0 && ready()) event.stopPropagation(); });
    pages[0].addEventListener('click', () => { if (book.getCurrentPageIndex() === 0) open(); });
    return { open, close, busy: () => busy };
  },
};

// Reader zoom: double-tap / pinch / one-finger pan on touch, Ctrl+wheel and
// drag on desktop, a 🔍 button, keys + - 0. Zooms the stage around the
// finger or cursor and keeps the page covering the view. While zoomed the
// gestures never reach PageFlip, so panning can't turn a page.
// ES2018 for old Android WebViews.
(typeof self!=='undefined'?self:global).FlipbookZoom = {
  MAX: 4,
  STEPS: [1, 2, 3],
  // Keep the zoomed book covering the view: no panning past its edges into
  // the background; an axis where it is smaller than the view is centred.
  // box = the book inside the stage at 100% ({x, y, w, h}); default: the whole stage.
  clamp(scale, x, y, width, height, box) {
    const b = box || { x: 0, y: 0, w: width, h: height };
    const axis = (pos, view, start, size) => (size * scale <= view
      ? (view - size * scale) / 2 - start * scale
      : Math.min(0 - start * scale, Math.max(view - (start + size) * scale, pos)));
    return { x: axis(x, width, b.x, b.w), y: axis(y, height, b.y, b.h) };
  },
  // Pan so the content point under (px, py) stays there when scale changes.
  anchor(from, to, x, y, px, py) {
    return { x: px - (px - x) / from * to, y: py - (py - y) / from * to };
  },
  /* surface: element receiving gestures; target: element that scales;
     options: {button, chip, hint, onChange(scale), content(): the book's
     on-screen rect (client coordinates) so panning stops at its edges} */
  bind(surface, target, options) {
    const self = this, opts = options || {};
    let scale = 1, x = 0, y = 0, gesture = null, lastTap = null, drag = null;
    target.style.transformOrigin = '0 0';
    function apply(smooth) {
      if (scale <= 1.01) { scale = 1; x = 0; y = 0; }
      const box = self.clamp(scale, x, y, target.clientWidth, target.clientHeight, content());
      x = box.x; y = box.y;
      target.style.transition = smooth ? 'transform .28s ease-out' : '';
      target.style.transform = scale > 1 ? 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + scale.toFixed(3) + ')' : '';
      document.body.classList.toggle('is-zoomed', scale > 1);
      const percent = Math.round(scale * 100) + '%';
      if (opts.button) {
        opts.button.textContent = scale > 1 ? '🔍 ' + percent : '🔍';
        opts.button.setAttribute('aria-label', scale > 1 ? 'Zoom ' + percent + ', press to zoom more or reset' : 'Zoom in');
      }
      if (opts.chip) { opts.chip.hidden = scale <= 1; const label = opts.chip.querySelector('span'); if (label) label.textContent = percent; }
      if (opts.onChange) opts.onChange(scale);
    }
    function zoomTo(next, px, py, smooth) {
      next = Math.max(1, Math.min(self.MAX, next));
      const moved = self.anchor(scale, next, x, y, px, py);
      scale = next; x = moved.x; y = moved.y; apply(smooth);
    }
    // The book's rect inside the stage at 100% (undoing the current zoom).
    function content() {
      const rect = opts.content && opts.content();
      if (!rect || !rect.width) return null;
      const stage = target.getBoundingClientRect(), current = scale > 1 && target.style.transform ? scale : 1;
      return { x: (rect.left - stage.left) / current, y: (rect.top - stage.top) / current, w: rect.width / current, h: rect.height / current };
    }
    const center = () => ({ x: target.clientWidth / 2, y: target.clientHeight / 2 });
    // Viewport point relative to the untransformed stage.
    function point(clientX, clientY) {
      const box = surface.getBoundingClientRect();
      return { x: clientX - box.left - target.offsetLeft, y: clientY - box.top - target.offsetTop };
    }
    const block = event => { event.stopPropagation(); if (event.cancelable) event.preventDefault(); };
    const distance = (a, b) => Math.sqrt(Math.pow(a.clientX - b.clientX, 2) + Math.pow(a.clientY - b.clientY, 2));
    const middle = (a, b) => point((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    const capture = { capture: true, passive: false };
    surface.addEventListener('touchstart', event => {
      const touches = event.touches;
      if (touches.length >= 2) {
        block(event);
        gesture = { type: 'pinch', start: distance(touches[0], touches[1]), scale: scale, mid: middle(touches[0], touches[1]), x: x, y: y };
        return;
      }
      const p = point(touches[0].clientX, touches[0].clientY), now = Date.now();
      // Second tap of a double-tap: keep it away from PageFlip entirely.
      if (lastTap && now - lastTap.time < 320 && Math.abs(p.x - lastTap.x) < 32 && Math.abs(p.y - lastTap.y) < 32) {
        block(event); gesture = { type: 'double', x: p.x, y: p.y }; return;
      }
      if (scale > 1) { block(event); gesture = { type: 'pan', from: p, x: x, y: y, moved: false, time: now }; return; }
      gesture = { type: 'tap', from: p, moved: false, time: now };   // passes on: a swipe still turns the page
    }, capture);
    surface.addEventListener('touchmove', event => {
      if (!gesture) return;
      const touches = event.touches;
      if (gesture.type === 'pinch' && touches.length >= 2) {
        block(event);
        const next = Math.max(1, Math.min(self.MAX, gesture.scale * distance(touches[0], touches[1]) / gesture.start));
        const mid = middle(touches[0], touches[1]);
        // The content point first pinched follows the fingers.
        scale = next;
        x = mid.x - (gesture.mid.x - gesture.x) / gesture.scale * next;
        y = mid.y - (gesture.mid.y - gesture.y) / gesture.scale * next;
        apply(false); return;
      }
      if (gesture.type === 'pan' || gesture.type === 'double') {
        block(event);
        if (gesture.type === 'pan') {
          const p = point(touches[0].clientX, touches[0].clientY);
          if (Math.abs(p.x - gesture.from.x) + Math.abs(p.y - gesture.from.y) > 8) gesture.moved = true;
          x = gesture.x + p.x - gesture.from.x; y = gesture.y + p.y - gesture.from.y; apply(false);
        }
        return;
      }
      if (gesture.type === 'tap') {
        const p = point(touches[0].clientX, touches[0].clientY);
        if (Math.abs(p.x - gesture.from.x) + Math.abs(p.y - gesture.from.y) > 10) gesture.moved = true;
      }
    }, capture);
    surface.addEventListener('touchend', event => {
      if (!gesture) return;
      const kind = gesture.type;
      if (kind === 'pinch') {
        block(event);
        if (event.touches.length === 1 && scale > 1) {
          const p = point(event.touches[0].clientX, event.touches[0].clientY);
          gesture = { type: 'pan', from: p, x: x, y: y, moved: true, time: Date.now() }; return;
        }
        if (event.touches.length === 0) { gesture = null; lastTap = null; if (scale < 1.08) { scale = 1; apply(true); } }
        return;
      }
      if (kind === 'double') {
        block(event);
        const at = gesture; gesture = null; lastTap = null;
        if (scale > 1) { scale = 1; apply(true); } else zoomTo(2.5, at.x, at.y, true);
        return;
      }
      // A still tap while zoomed may be a link: let its click happen.
      if (kind === 'pan') { event.stopPropagation(); if (gesture.moved && event.cancelable) event.preventDefault(); }
      const quick = !gesture.moved && Date.now() - gesture.time < 300;
      lastTap = quick ? { time: Date.now(), x: gesture.from.x, y: gesture.from.y } : null;
      if (event.touches.length === 0) gesture = null;
    }, capture);
    surface.addEventListener('touchcancel', () => { gesture = null; }, capture);
    // Desktop: Ctrl+wheel (and trackpad pinch) zooms at the cursor, the wheel pans when zoomed.
    surface.addEventListener('wheel', event => {
      if (event.ctrlKey) {
        block(event);
        const p = point(event.clientX, event.clientY);
        zoomTo(scale * Math.exp(-event.deltaY * 0.0025), p.x, p.y, false);
      } else if (scale > 1) {
        block(event); x -= event.deltaX; y -= event.deltaY; apply(false);
      }
    }, capture);
    surface.addEventListener('mousedown', event => {
      if (scale <= 1 || event.button !== 0) return;
      block(event); drag = { from: { x: event.clientX, y: event.clientY }, x: x, y: y, moved: false };
      document.body.classList.add('is-panning');
    }, true);
    window.addEventListener('mousemove', event => {
      if (!drag) return;
      if (Math.abs(event.clientX - drag.from.x) + Math.abs(event.clientY - drag.from.y) > 4) drag.moved = true;
      x = drag.x + event.clientX - drag.from.x; y = drag.y + event.clientY - drag.from.y; apply(false);
    });
    let dragged = false;
    window.addEventListener('mouseup', () => { if (drag) { dragged = drag.moved; drag = null; document.body.classList.remove('is-panning'); } });
    // A drag that panned is not a click (links, cover).
    surface.addEventListener('click', event => { if (dragged) { dragged = false; block(event); } }, true);
    surface.addEventListener('dblclick', event => { if (scale > 1) { block(event); reset(); } }, true);
    function reset() { if (scale > 1) { scale = 1; apply(true); } }
    function step() {
      const next = self.STEPS.filter(value => value > scale + 0.01)[0];
      const c = center();
      if (next) zoomTo(next, c.x, c.y, true); else reset();
    }
    if (opts.button) opts.button.onclick = step;
    if (opts.chip) { const button = opts.chip.querySelector('button'); if (button) button.onclick = reset; }
    document.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((event.target && event.target.tagName) || '')) return;   // typing a note
      const c = center();
      if (event.key === '+' || event.key === '=') zoomTo(scale * 1.5, c.x, c.y, true);
      else if (event.key === '-') zoomTo(scale / 1.5, c.x, c.y, true);
      else if (event.key === '0') reset();
    });
    addEventListener('resize', reset);
    // One-time tip on touch devices.
    if (opts.hint && matchMedia('(hover: none)').matches) {
      let seen = false;
      try { seen = localStorage.getItem('mf-zoom-hint') === '1'; localStorage.setItem('mf-zoom-hint', '1'); } catch (e) {}
      if (!seen) { opts.hint.hidden = false; setTimeout(() => { opts.hint.hidden = true; }, 4000); }
    }
    apply(false);
    return { reset, step, scale: () => scale };
  },
};

// Reader notes: a small tab on the outer edge of every page opens a note
// for that page; notes are kept per book on this device (like bookmarks),
// listed in one panel to jump back, and can be downloaded as a text file.
// ES2018 for old Android WebViews.
(typeof self!=='undefined'?self:global).FlipbookNotes = {
  MAX: 5000,
  // Keyboard shortcuts must not fire while the reader is typing.
  typing(event) {
    const target = event && event.target;
    return !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '') || target.isContentEditable === true);
  },
  key(title, pageCount, ratio) {
    return FlipbookBookmarks.key(title, pageCount, ratio).replace('mf-bookmarks:', 'mf-notes:');
  },
  load(key) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '{}'), out = {};
      Object.keys(raw || {}).forEach(k => {
        const note = raw[k];
        if (/^\d+$/.test(k) && note && typeof note.text === 'string' && note.text.trim()) out[k] = {text: note.text.slice(0, this.MAX), updated: Number(note.updated) || 0};
      });
      return out;
    } catch (e) { return {}; }
  },
  save(key, notes) { try { localStorage.setItem(key, JSON.stringify(notes)); return true; } catch (e) { return false; } },
  /* options: {key, title, pages (elements), goPage(i), open (button)} */
  bind(options) {
    const self = this, pages = options.pages;
    let notes = self.load(options.key), editor = null, list = null, editing = -1, timer = 0, saved = true;
    const label = i => (i === 0 ? 'Cover' : 'Page ' + (i + 1));
    const count = () => Object.keys(notes).length;
    const stop = event => event.stopPropagation();
    function tabs() {
      pages.forEach((page, index) => {
        let tab = page.querySelector('.book-note-tab');
        if (!tab) {
          tab = document.createElement('button'); tab.type = 'button'; tab.className = 'book-note-tab';
          // Keep PageFlip from starting a page turn when the tab is pressed.
          ['pointerdown', 'mousedown', 'touchstart'].forEach(name => tab.addEventListener(name, stop));
          tab.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); edit(index); });
          page.appendChild(tab);
        }
        const has = !!notes[index];
        tab.classList.toggle('has-note', has);
        tab.textContent = has ? '📝' : '✎';
        tab.title = has ? 'Your note on ' + label(index) : 'Write a note on ' + label(index);
        tab.setAttribute('aria-label', tab.title);
      });
    }
    function refresh() {
      tabs();
      if (options.open) {
        options.open.textContent = '📝 ' + count();
        options.open.title = 'My notes (' + count() + ')';
        options.open.setAttribute('aria-label', 'My notes, ' + count());
      }
      if (list) renderList();
    }
    function store(index, text) {
      if (text.trim()) notes[index] = {text: text.slice(0, self.MAX), updated: Date.now()};
      else delete notes[index];
      saved = self.save(options.key, notes);
      refresh();
    }
    function panel(className, title) {
      const box = document.createElement('div');
      box.className = 'book-marks ' + className; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', title);
      ['pointerdown', 'mousedown', 'touchstart'].forEach(name => box.addEventListener(name, stop));
      const head = document.createElement('p'); head.className = 'book-marks-title'; head.textContent = title;
      box.appendChild(head);
      return box;
    }
    function button(text, className, onclick) {
      const b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = text; b.onclick = onclick;
      return b;
    }
    function closeEditor() {
      if (!editor) return;
      clearTimeout(timer);
      store(editing, editor.querySelector('textarea').value);
      editor.remove(); editor = null; editing = -1;
      document.removeEventListener('pointerdown', outsideEditor, true);
    }
    function outsideEditor(event) { if (editor && !editor.contains(event.target) && !(event.target.classList && event.target.classList.contains('book-note-tab'))) closeEditor(); }
    function edit(index) {
      closeList();
      if (editor) { const same = editing === index; closeEditor(); if (same) return; }
      editing = index;
      editor = panel('book-note-editor', 'Note · ' + label(index));
      const area = document.createElement('textarea');
      area.maxLength = self.MAX; area.rows = 6; area.placeholder = 'Write your note for this page…';
      area.value = notes[index] ? notes[index].text : '';
      const status = document.createElement('p'); status.className = 'book-note-status';
      const say = () => { status.textContent = saved ? 'Saved on this device · ' + area.value.length + ' / ' + self.MAX : 'This browser could not save the note.'; };
      area.addEventListener('input', () => {
        status.textContent = 'Saving…';
        clearTimeout(timer);
        timer = setTimeout(() => { store(index, area.value); say(); }, 400);
      });
      area.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeEditor(); } });
      const row = document.createElement('div'); row.className = 'book-note-actions';
      row.appendChild(button('Delete', 'book-note-delete', () => { area.value = ''; closeEditor(); }));
      row.appendChild(button('Done', 'book-note-done', closeEditor));
      editor.appendChild(area); editor.appendChild(status); editor.appendChild(row);
      document.body.appendChild(editor);
      say();
      document.addEventListener('pointerdown', outsideEditor, true);
      try { area.focus({preventScroll: true}); } catch (e) { area.focus(); }
    }
    function text() {
      const lines = [(options.title || 'Book') + ' — my notes', ''];
      Object.keys(notes).map(Number).sort((a, b) => a - b).forEach(i => { lines.push('[' + label(i) + ']', notes[i].text, ''); });
      return lines.join('\n');
    }
    function download() {
      const blob = new Blob([text()], {type: 'text/plain;charset=utf-8'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = String(options.title || 'book').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) + ' - notes.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    function closeList() {
      if (!list) return;
      list.remove(); list = null;
      document.removeEventListener('pointerdown', outsideList, true);
      if (options.open) options.open.setAttribute('aria-expanded', 'false');
    }
    function outsideList(event) { if (list && !list.contains(event.target) && event.target !== options.open) closeList(); }
    function renderList() {
      while (list.childNodes.length > 1) list.removeChild(list.lastChild);
      const keys = Object.keys(notes).map(Number).sort((a, b) => a - b);
      if (!keys.length) {
        const empty = document.createElement('p'); empty.className = 'book-marks-empty';
        empty.textContent = 'No notes yet. Tap ✎ on the edge of a page to write one.';
        list.appendChild(empty); return;
      }
      keys.forEach(index => {
        const row = document.createElement('div'); row.className = 'book-mark';
        const go = document.createElement('button'); go.type = 'button'; go.className = 'book-mark-go book-note-row';
        const name = document.createElement('b'); name.textContent = label(index);
        const snippet = document.createElement('span'); snippet.textContent = notes[index].text.replace(/\s+/g, ' ').slice(0, 90);
        go.appendChild(name); go.appendChild(snippet);
        go.onclick = () => { closeList(); options.goPage(index); };
        row.appendChild(go);
        row.appendChild(button('✎', 'book-mark-remove', () => { closeList(); options.goPage(index); edit(index); }));
        list.appendChild(row);
      });
      list.appendChild(button('⬇ Download notes (.txt)', 'book-note-download', download));
    }
    function openList() {
      if (editor) closeEditor();
      list = panel('book-note-list', 'My notes');
      renderList();
      document.body.appendChild(list);
      if (options.open) options.open.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outsideList, true);
    }
    // onclick: the preview rebinds this button for every PDF it opens.
    if (options.open) options.open.onclick = () => { if (list) closeList(); else openList(); };
    refresh();
    return {refresh, text, editing: () => editing >= 0, close() { closeEditor(); closeList(); }, notes: () => JSON.parse(JSON.stringify(notes))};
  },
};
