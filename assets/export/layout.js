'use strict';
(typeof self!=='undefined'?self:global).FlipbookLayout = {
  motion(reduced) {
    // No corner fold on mouse hover: it got in the way of highlighting and
    // clicking; pages still turn by buttons, swipe, drag and corner click.
    return {useMouseEvents:true,drawShadow:true,maxShadowOpacity:.38,flippingTime:reduced?1:1150,showPageCorners:false,disableFlipByClick:false,mobileScrollSupport:true,swipeDistance:30};
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
  WIDE: 1.15,
  geometry(width,height,ratio,index,count,compact) {
    // Same rule as the editor preview so exports look like what was
    // previewed: a two-page spread from 700px wide, one page on phones held
    // upright. A landscape phone (wider than tall) keeps the spread; the
    // compact editor preview sizes its height from this, so width decides.
    // Depends on the reading area only, never on the current page;
    // showCover keeps the cover alone without enlarging it.
    // Landscape pages (slides) side by side get tiny: one page at a time
    // when that makes the page clearly bigger (always in the compact preview).
    const spread=Math.min(height,width/(2*ratio)), alone=Math.min(height,width/ratio);
    const wide=ratio>this.WIDE && (compact || alone>=spread*1.4);
    const single=count===1 || wide || (width<700 && (compact || width<=height));
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
          const pages=book.getPageCount()===1||w<700||ratio>this.WIDE?1:2;
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
    // Mark/unmark one page from elsewhere (a note does this). Returns true
    // when it changed anything.
    function set(index, on) {
      const has = marks.indexOf(index) >= 0;
      if (on === has || index < 0 || index >= pages.length) return false;
      marks = on ? marks.concat([index]) : marks.filter(i => i !== index);
      persist();
      return true;
    }
    return { refresh, close, set, marks: () => marks.slice() };
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
          // Timed by animation frames, like the turn itself.
          const fadeStart = performance.now();
          const fade = now => {
            if (now - fadeStart < 200) { requestAnimationFrame(fade); return; }
            view.stage.remove(); busy = false; if (after) after();
          };
          requestAnimationFrame(fade);
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
  // One zoom step: + (or a double-tap) zooms to 200%, the next press goes
  // back to 100%. Pinch / Ctrl+wheel still zoom freely up to MAX.
  ZOOMED: 2,
  up(scale) { return scale > 1.01 ? 1 : this.ZOOMED; },
  down() { return 1; },
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
     options: {button (🔍: 200% / back to 100%), zoomOut, level, zoomIn
     (optional − 100% + control), chip, hint,
     onChange(scale), content(): the book's on-screen rect (client
     coordinates) so panning stops at its edges} */
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
        opts.button.setAttribute('aria-label', scale > 1 ? 'Zoom ' + percent + ', press to go back to 100%' : 'Zoom in to ' + Math.round(self.ZOOMED * 100) + '%');
        opts.button.classList.toggle('is-zoomed', scale > 1);
      }
      if (opts.chip) { opts.chip.hidden = scale <= 1; const label = opts.chip.querySelector('span'); if (label) label.textContent = percent; }
      if (opts.level) {
        opts.level.textContent = percent;
        opts.level.setAttribute('aria-label', 'Zoom ' + percent + (scale > 1 ? ', press to go back to 100%' : ''));
        opts.level.classList.toggle('is-zoomed', scale > 1);
      }
      if (opts.zoomOut) opts.zoomOut.disabled = scale <= 1;
      if (opts.zoomIn) {
        opts.zoomIn.textContent = scale > 1 ? '↺' : '+';
        opts.zoomIn.setAttribute('aria-label', scale > 1 ? 'Back to 100%' : 'Zoom in to ' + Math.round(self.ZOOMED * 100) + '%');
      }
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
    // One finger / the mouse belongs to the highlighter while it is on.
    const highlighting = () => document.body.classList.contains('is-highlighting');
    surface.addEventListener('touchstart', event => {
      const touches = event.touches;
      if (highlighting() && touches.length < 2) { gesture = null; lastTap = null; return; }
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
        if (scale > 1) { scale = 1; apply(true); } else zoomTo(self.ZOOMED, at.x, at.y, true);
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
      if (scale <= 1 || event.button !== 0 || highlighting()) return;
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
    // 🔍: zoom to 200%, press again for 100%.
    function step() { const c = center(); zoomTo(self.up(scale), c.x, c.y, true); }
    if (opts.button) opts.button.onclick = step;
    const toward = next => { const c = center(); zoomTo(next, c.x, c.y, true); };
    if (opts.zoomIn) opts.zoomIn.onclick = () => toward(self.up(scale));
    if (opts.zoomOut) opts.zoomOut.onclick = () => toward(self.down(scale));
    if (opts.level) opts.level.onclick = reset;
    if (opts.chip) { const button = opts.chip.querySelector('button'); if (button) button.onclick = reset; }
    document.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((event.target && event.target.tagName) || '')) return;   // typing a note
      const c = center();
      if (event.key === '+' || event.key === '=') zoomTo(self.up(scale), c.x, c.y, true);
      else if (event.key === '-') zoomTo(self.down(scale), c.x, c.y, true);
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

// Reader notes, like the index tabs of an agenda book: every note on a page
// is a coloured, numbered tab stacked down the page's outer edge. Tap a tab
// to read the note beside it (edit / delete from there); the ＋ tab adds a
// new one. Notes are kept per book on this device, listed in one panel and
// can be downloaded as text. The first note on a page bookmarks it.
// ES2018 for old Android WebViews.
(typeof self!=='undefined'?self:global).FlipbookNotes = {
  MAX: 5000,
  PER_PAGE: 8,
  COLORS: ['#fde68a', '#fbcfe8', '#bbf7d0', '#bfdbfe', '#fed7aa', '#ddd6fe'],
  // Keyboard shortcuts must not fire while the reader is typing.
  typing(event) {
    const target = event && event.target;
    return !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '') || target.isContentEditable === true);
  },
  key(title, pageCount, ratio) {
    return FlipbookBookmarks.key(title, pageCount, ratio).replace('mf-bookmarks:', 'mf-notes:');
  },
  // {page: {items: [{text, updated}], marked}}; the older one-note-per-page
  // format ({text, updated, marked}) becomes a page with one item.
  load(key) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '{}'), out = {}, max = this.MAX;
      const clean = n => {
        if (!n || typeof n.text !== 'string' || !n.text.trim()) return null;
        const note = {text: n.text.slice(0, max), updated: Number(n.updated) || 0};
        if (typeof n.color === 'string' && /^#[0-9a-f]{6}$/i.test(n.color)) note.color = n.color;
        // q: the highlighted text a summary note stands for (links it to its highlight).
        if (typeof n.q === 'string' && n.q.trim()) {
          note.q = n.q.slice(0, max);
          if (note.text === this.SUMMARIZING) note.text = '\u201c' + note.q + '\u201d';   // closed mid-summary: back to the quote
        }
        return note;
      };
      Object.keys(raw || {}).forEach(k => {
        if (!/^\d+$/.test(k) || !raw[k]) return;
        const entry = raw[k];
        const items = (Array.isArray(entry.items) ? entry.items.map(clean) : [clean(entry)]).filter(Boolean).slice(0, this.PER_PAGE);
        if (items.length) out[k] = {items, marked: entry.marked === true};
      });
      return out;
    } catch (e) { return {}; }
  },
  save(key, notes) { try { localStorage.setItem(key, JSON.stringify(notes)); return true; } catch (e) { return false; } },
  // Shown while the AI summary of a highlight is on its way.
  SUMMARIZING: '\u2728 Summarizing\u2026',
  /* options: {key, title, pages (elements), goPage(i), open (button),
     bookmark(index, on) → true when it changed the page's bookmark,
     blank: false → no ✎ / ＋ tab at all (notes come from highlights),
     onRemove(index, said): the reader deleted a quote note ("said" = the
     quoted text) → its highlight goes too} */
  bind(options) {
    const self = this, pages = options.pages;
    let notes = self.load(options.key), editor = null, reader = null, list = null, editing = null, timer = 0, saved = true;
    const label = i => (i === 0 ? 'Cover' : 'Page ' + (i + 1));
    const count = () => Object.keys(notes).reduce((sum, k) => sum + notes[k].items.length, 0);
    const stop = event => event.stopPropagation();
    const guard = el => ['pointerdown', 'mousedown', 'touchstart'].forEach(name => el.addEventListener(name, stop));
    function button(text, className, onclick) {
      const b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = text; b.onclick = onclick;
      return b;
    }
    // The tab stack on one page: numbered note tabs, then ＋.
    function tabs(index) {
      const page = pages[index];
      let stack = page.querySelector('.book-note-stack');
      if (!stack) { stack = document.createElement('div'); stack.className = 'book-note-stack'; guard(stack); page.appendChild(stack); }
      while (stack.firstChild) stack.removeChild(stack.firstChild);
      const items = notes[index] ? notes[index].items : [];
      items.forEach((note, n) => {
        const tab = button(String(n + 1), 'book-note-tab has-note', event => { event.preventDefault(); event.stopPropagation(); read(index, n, tab); });
        tab.style.setProperty('--tab', note.color || self.COLORS[n % self.COLORS.length]);
        tab.title = label(index) + ' · note ' + (n + 1) + ': ' + note.text.replace(/\s+/g, ' ').slice(0, 80);
        tab.setAttribute('aria-label', 'Note ' + (n + 1) + ' on ' + label(index));
        if (reader && reader.page === index && reader.item === n) tab.classList.add('is-open');
        stack.appendChild(tab);
      });
      if (items.length < self.PER_PAGE && options.blank !== false) {
        const add = button(items.length ? '＋' : '✎', 'book-note-tab book-note-add', event => { event.preventDefault(); event.stopPropagation(); edit(index, -1); });
        add.title = items.length ? 'Add another note on ' + label(index) : 'Write a note on ' + label(index);
        add.setAttribute('aria-label', add.title);
        stack.appendChild(add);
      }
    }
    function refresh() {
      pages.forEach((page, index) => tabs(index));
      if (options.open) {
        options.open.textContent = '📝 ' + count();
        options.open.title = 'My notes (' + count() + ')';
        options.open.setAttribute('aria-label', 'My notes, ' + count());
      }
      if (list) renderList();
    }
    // Save one note (item -1 = a new note). Empty text removes it.
    // color: set a note's colour (a quote takes its highlight's); editing keeps it.
    function store(index, item, text, color, q) {
      const entry = notes[index] || {items: [], marked: false};
      const had = entry.items.length;
      if (text.trim()) {
        const note = {text: text.slice(0, self.MAX), updated: Date.now()};
        const old = item >= 0 && item < entry.items.length ? entry.items[item] : null;
        const before = old ? old.color : undefined;
        if (color || before) note.color = color || before;
        if (q || (old && old.q)) note.q = (q || old.q).slice(0, self.MAX);   // editing keeps the link to the highlight
        if (item >= 0 && item < entry.items.length) entry.items[item] = note;
        else { entry.items.push(note); item = entry.items.length - 1; }
      } else if (item >= 0 && item < entry.items.length) entry.items.splice(item, 1);
      // The first note on a page bookmarks it; removing the last note removes
      // that bookmark again (only if a note added it).
      if (!had && entry.items.length) entry.marked = !!(options.bookmark && options.bookmark(index, true));
      if (had && !entry.items.length && entry.marked && options.bookmark) options.bookmark(index, false);
      if (entry.items.length) notes[index] = entry; else delete notes[index];
      saved = self.save(options.key, notes);
      refresh();
      return item;
    }
    function panel(className, title) {
      const box = document.createElement('div');
      box.className = 'book-marks ' + className; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', title);
      guard(box);
      const head = document.createElement('p'); head.className = 'book-marks-title'; head.textContent = title;
      box.appendChild(head);
      return box;
    }
    // Reading a note: a card beside its tab.
    function closeReader() {
      if (!reader) return;
      const page = reader.page;
      reader.box.remove(); reader = null;
      document.removeEventListener('pointerdown', outsideReader, true);
      tabs(page);
    }
    function outsideReader(event) { if (reader && !reader.box.contains(event.target) && !(event.target.closest && event.target.closest('.book-note-stack'))) closeReader(); }
    function read(index, item, tab) {
      if (reader && reader.page === index && reader.item === item) { closeReader(); return; }
      closeReader(); closeEditor(); closeList();
      const note = notes[index] && notes[index].items[item];
      if (!note) return;
      const box = document.createElement('div');
      box.className = 'book-note-card'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', label(index) + ' note ' + (item + 1));
      box.style.setProperty('--tab', note.color || self.COLORS[item % self.COLORS.length]);
      guard(box);
      const head = document.createElement('p'); head.className = 'book-note-card-title'; head.textContent = label(index) + ' · note ' + (item + 1);
      const body = document.createElement('div'); body.className = 'book-note-card-text'; body.textContent = note.text;
      const row = document.createElement('div'); row.className = 'book-note-actions';
      row.appendChild(button('🗑 Delete', 'book-note-delete', () => { closeReader(); remove(index, item); }));
      row.appendChild(button('✎ Edit', 'book-note-done', () => { closeReader(); edit(index, item); }));
      box.appendChild(head); box.appendChild(body); box.appendChild(row);
      document.body.appendChild(box);
      reader = {page: index, item, box};
      tabs(index);
      // Beside its tab, on the page side, kept on screen. The tab is measured
      // after the stack is redrawn (the clicked one may have been replaced).
      const current = pages[index].querySelectorAll('.book-note-stack .book-note-tab.has-note')[item] || tab;
      const t = current.getBoundingClientRect();
      // The reader may resize the card (corner handle); its last size is kept.
      let size = null;
      try { size = JSON.parse(localStorage.getItem('mf-note-card') || 'null'); } catch (e) {}
      const width = Math.min(size && size.w > 200 ? size.w : 320, window.innerWidth - 24);
      box.style.width = width + 'px';
      if (size && size.h > 120) box.style.height = Math.min(size.h, window.innerHeight - 24) + 'px';
      const onRight = t.width ? t.left + t.width / 2 > window.innerWidth / 2 : true;
      let left = t.width ? (onRight ? t.left - width - 8 : t.right + 8) : window.innerWidth - width - 24;
      left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
      box.style.left = left + 'px';
      box.style.top = Math.max(12, Math.min(t.height ? t.top : 80, window.innerHeight - box.offsetHeight - 12)) + 'px';
      // ◢ grip: drag (mouse or finger) to make the card wider / longer.
      const grip = document.createElement('span');
      grip.className = 'book-note-grip'; grip.title = 'Drag to resize'; grip.setAttribute('aria-hidden', 'true');
      box.appendChild(grip);
      grip.addEventListener('pointerdown', event => {
        event.preventDefault(); event.stopPropagation();
        const from = {x: event.clientX, y: event.clientY, w: box.offsetWidth, h: box.offsetHeight};
        try { grip.setPointerCapture(event.pointerId); } catch (e) {}
        const move = e => {
          const r = box.getBoundingClientRect();
          box.style.width = Math.max(220, Math.min(window.innerWidth - r.left - 8, from.w + e.clientX - from.x)) + 'px';
          box.style.height = Math.max(130, Math.min(window.innerHeight - r.top - 8, from.h + e.clientY - from.y)) + 'px';
        };
        const up = () => {
          grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
          try { localStorage.setItem('mf-note-card', JSON.stringify({w: box.offsetWidth, h: box.offsetHeight})); } catch (e) {}
        };
        grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
      });
      document.addEventListener('pointerdown', outsideReader, true);
    }
    // Writing a note (item -1 = new).
    function closeEditor() {
      if (!editor) return;
      clearTimeout(timer);
      store(editing.page, editing.item, editor.querySelector('textarea').value);
      editor.remove(); editor = null; editing = null;
      document.removeEventListener('pointerdown', outsideEditor, true);
    }
    function outsideEditor(event) { if (editor && !editor.contains(event.target) && !(event.target.closest && event.target.closest('.book-note-stack'))) closeEditor(); }
    function edit(index, item) {
      closeReader(); closeList();
      if (editor) closeEditor();
      const note = item >= 0 && notes[index] ? notes[index].items[item] : null;
      editing = {page: index, item: note ? item : -1};
      editor = panel('book-note-editor', label(index) + ' · ' + (note ? 'note ' + (item + 1) : 'new note'));
      const area = document.createElement('textarea');
      area.maxLength = self.MAX; area.rows = 6; area.placeholder = 'Write your note for this page…';
      area.value = note ? note.text : '';
      const status = document.createElement('p'); status.className = 'book-note-status';
      const say = () => { status.textContent = saved ? 'Saved on this device · ' + area.value.length + ' / ' + self.MAX : 'This browser could not save the note.'; };
      area.addEventListener('input', () => {
        status.textContent = 'Saving…';
        clearTimeout(timer);
        timer = setTimeout(() => {
          // A new note gets its number on the first save; later saves update it.
          if (!editor) return;
          editing.item = store(editing.page, editing.item, area.value);
          if (!area.value.trim()) editing.item = -1;
          say();
        }, 400);
      });
      area.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeEditor(); } });
      const row = document.createElement('div'); row.className = 'book-note-actions';
      row.appendChild(button('Delete', 'book-note-delete', () => {
        // Saved text of this note (autosave may have given a new one a number).
        const page = editing.page, item = editing.item;
        const had = item >= 0 && notes[page] && notes[page].items[item] ? notes[page].items[item] : null;
        area.value = ''; closeEditor();
        removed(page, had);
      }));
      row.appendChild(button('Done', 'book-note-done', closeEditor));
      editor.appendChild(area); editor.appendChild(status); editor.appendChild(row);
      document.body.appendChild(editor);
      say();
      document.addEventListener('pointerdown', outsideEditor, true);
      try { area.focus({preventScroll: true}); } catch (e) { area.focus(); }
    }
    function text() {
      const lines = [(options.title || 'Book') + ' — my notes', ''];
      Object.keys(notes).map(Number).sort((a, b) => a - b).forEach(i => {
        notes[i].items.forEach((note, n) => { lines.push('[' + label(i) + (notes[i].items.length > 1 ? ' · note ' + (n + 1) : '') + ']', note.text, ''); });
      });
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
        empty.textContent = options.blank === false ? 'No notes yet. Highlight text 🖍 and it becomes a note on the page edge.' : 'No notes yet. Tap ✎ on the edge of a page to write one.';
        list.appendChild(empty); return;
      }
      keys.forEach(index => notes[index].items.forEach((note, n) => {
        const row = document.createElement('div'); row.className = 'book-mark';
        const go = document.createElement('button'); go.type = 'button'; go.className = 'book-mark-go book-note-row';
        const name = document.createElement('b'); name.textContent = label(index) + (notes[index].items.length > 1 ? ' · ' + (n + 1) : '');
        const snippet = document.createElement('span'); snippet.textContent = note.text;
        go.appendChild(name); go.appendChild(snippet);
        go.onclick = () => { closeList(); options.goPage(index); };
        row.appendChild(go);
        row.appendChild(button('✎', 'book-mark-remove', () => { closeList(); options.goPage(index); edit(index, n); }));
        list.appendChild(row);
      }));
      list.appendChild(button('⬇ Download notes (.txt)', 'book-note-download', download));
    }
    function openList() {
      closeEditor(); closeReader();
      list = panel('book-note-list', 'My notes');
      renderList();
      document.body.appendChild(list);
      if (options.open) options.open.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outsideList, true);
    }
    // onclick: the preview rebinds this button for every PDF it opens.
    if (options.open) options.open.onclick = () => { if (list) closeList(); else openList(); };
    refresh();
    // The reader deleted a note: a quote (“…” at its start) or a summary
    // (its hidden quote) takes its highlight along.
    function removed(index, note) {
      if (!note || !options.onRemove) return;
      const m = /^\u201c([^\u201d]*)\u201d/.exec(note.text || '');
      if (note.q || m) options.onRemove(index, note.q || m[1]);
    }
    function remove(index, item) {
      const note = notes[index] && notes[index].items[item];
      if (!note) return;
      store(index, item, '');
      removed(index, note);
    }
    // Highlighted text becomes a quoted note on its page ("…"). A longer
    // highlight over an earlier quote replaces that quote; text already in a
    // note adds nothing.
    const QUOTE = /^\u201c([\s\S]*)\u201d$/;
    function flash(index, item) {
      const stack = pages[index] && pages[index].querySelector('.book-note-stack');
      const tab = stack && stack.querySelectorAll('.book-note-tab.has-note')[item];
      if (!tab) return;
      stack.classList.add('has-new'); tab.classList.add('is-new');
      setTimeout(() => { stack.classList.remove('has-new'); tab.classList.remove('is-new'); }, 1800);
    }
    function quote(index, said, color) {
      said = FlipbookHighlights.tidy(said);
      if (!said) return -1;
      const items = notes[index] ? notes[index].items : [];
      // Already noted (re-highlighting in another colour recolours the quote).
      if (items.some(note => note.q === said || note.text.indexOf(said) >= 0)) { if (color) tint(index, said, color); return -1; }
      const older = [];
      items.forEach((note, i) => { const m = QUOTE.exec(note.text); if (m && said.indexOf(m[1]) >= 0) older.push(i); });
      let item;
      if (older.length) {
        for (let k = older.length - 1; k > 0; k--) store(index, older[k], '');
        item = store(index, older[0], '\u201c' + said + '\u201d', color);
      } else {
        if (items.length >= self.PER_PAGE) return -1;
        item = store(index, -1, '\u201c' + said + '\u201d', color);
      }
      flash(index, item);
      return item;
    }
    // Erasing a highlight removes its quote or summary note, unless the reader
    // has written in a quote.
    function unquote(index, said) {
      said = FlipbookHighlights.tidy(said);
      const items = notes[index] ? notes[index].items : [];
      const i = items.findIndex(note => note.q === said || note.text === '\u201c' + said + '\u201d');
      if (said && i >= 0) store(index, i, '');
    }
    // A highlight changed colour: its quote / summary note follows.
    function tint(index, said, color) {
      said = FlipbookHighlights.tidy(said);
      const items = notes[index] ? notes[index].items : [];
      const i = items.findIndex(note => note.q === said || note.text.indexOf('\u201c' + said + '\u201d') === 0);
      if (!said || i < 0 || items[i].color === color) return;
      items[i].color = color;
      saved = self.save(options.key, notes);
      refresh();
    }
    // Highlight in summary mode: a note that shows "Summarizing…" at once and
    // then the AI summary of the highlighted text (fn(text) → Promise<summary>).
    // It stays linked to its highlight. If the summary fails the note becomes
    // the plain quote, and the returned promise rejects with the reason.
    function summary(index, said, color, fn) {
      said = FlipbookHighlights.tidy(said);
      if (!said) return Promise.resolve(-1);
      let items = notes[index] ? notes[index].items : [];
      if (items.some(note => note.q === said)) { if (color) tint(index, said, color); return Promise.resolve(-1); }
      let item = items.findIndex(note => note.text === '\u201c' + said + '\u201d');
      if (item < 0 && items.length >= self.PER_PAGE) return Promise.resolve(-1);
      item = store(index, item, self.SUMMARIZING, color, said);
      flash(index, item);
      const settle = text => {
        items = notes[index] ? notes[index].items : [];
        const i = items.findIndex(note => note.q === said && note.text === self.SUMMARIZING);
        if (i >= 0) store(index, i, text);       // gone or edited meanwhile: leave it
        return i;
      };
      return Promise.resolve().then(() => fn(said)).then(text => {
        // "- " list lines become "\u2022 " like quoted lists; a list gets its own heading line.
        text = FlipbookHighlights.tidy(String(text || '').replace(/^\s*[-*]\s+/gm, '\u2022 '));
        if (!text) throw new Error('No summary came back.');
        return settle((/^\u2022 /.test(text) ? '\u2728 Summary\n' : '\u2728 ') + text);
      }, cause => { settle('\u201c' + said + '\u201d'); throw cause; });
    }
    return {refresh, text, quote, unquote, tint, summary, editing: () => !!editing, close() { closeEditor(); closeReader(); closeList(); }, notes: () => JSON.parse(JSON.stringify(notes))};
  },
};

// Reader highlights ("stabilo"): in highlighter mode, dragging over a page
// marks the words under the finger, snapped to the PDF's words line by line
// (pdf-words.js); on pages without text (scans) it draws a free box. Tap a
// highlight to recolour or delete it. Kept per book on this device.
// ES2018 for old Android WebViews.
(typeof self!=='undefined'?self:global).FlipbookHighlights = {
  // Line icons (inline SVG: the same on every device, unlike emoji).
  ICONS: {
    // Highlighter pen.
    brush: '<svg class="book-hl-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><g transform="rotate(45 12 12)"><path d="M10 1.5h4a1.5 1.5 0 0 1 1.5 1.5v11h-7V3A1.5 1.5 0 0 1 10 1.5z"/><path d="M8.5 14h7l-1.2 3h-4.6z" fill="currentColor"/><path d="M10.2 17h3.6l-.9 4.4-2.7-1.2z"/></g></svg>',
    eraser: '<svg class="book-hl-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 21H8a2 2 0 0 1-1.4-.6l-4-4a2 2 0 0 1 0-2.8l10-10a2 2 0 0 1 2.8 0l6 6a2 2 0 0 1 0 2.8L12.8 21"/><path d="m5.1 11.1 8.8 8.8"/></svg>',
    // Sparkles: highlights become a short AI summary note.
    summary: '<svg class="book-hl-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/><path d="M5 3.5l.6 1.4L7 5.5l-1.4.6L5 7.5l-.6-1.4L3 5.5l1.4-.6z"/></svg>'
  },
  // Mouse cursor while highlighting: a small highlighter pen (tip in the chosen
  // colour) or the eraser, white-outlined so it shows on any page.
  // Hotspot = where the tool touches the page.
  cursor(kind, color) {
    // [path, fill] parts; the pen (body + tip in the chosen colour) is tilted so its tip is bottom-left.
    const parts = kind === 'eraser'
      ? [['M21 21H8a2 2 0 0 1-1.4-.6l-4-4a2 2 0 0 1 0-2.8l10-10a2 2 0 0 1 2.8 0l6 6a2 2 0 0 1 0 2.8L12.8 21', '#fda4af'], ['m5.1 11.1 8.8 8.8', 'none']]
      : [['M10 1.5h4a1.5 1.5 0 0 1 1.5 1.5v11h-7V3A1.5 1.5 0 0 1 10 1.5z', color || '#ffd43b'], ['M8.5 14h7l-1.2 3h-4.6z', '#57534e'], ['M10.2 17h3.6l-.9 4.4-2.7-1.2z', color || '#ffd43b']];
    const turn = kind === 'eraser' ? '' : ' transform="rotate(45 12 12)"';
    const draw = (stroke, width, filled) => '<g' + turn + '>' + parts.map(part => '<path d="' + part[0] + '" fill="' + (filled ? part[1] : 'none') +
      '" stroke="' + stroke + '" stroke-width="' + width + '" stroke-linecap="round" stroke-linejoin="round"/>').join('') + '</g>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="-1 -1 26 26">' + draw('#fff', 5, false) + draw('#1c1917', 1.8, true) + '</svg>';
    const hotspot = kind === 'eraser' ? '3 14' : '5 15';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") ' + hotspot + ', ' + (kind === 'eraser' ? 'crosshair' : 'text');
  },
  COLORS: {y: '#ffd43b', g: '#69db7c', p: '#f783ac', b: '#4dabf7'},
  NAMES: {y: 'Yellow', g: 'Green', p: 'Pink', b: 'Blue'},
  key(title, pageCount, ratio) {
    return FlipbookBookmarks.key(title, pageCount, ratio).replace('mf-bookmarks:', 'mf-highlights:');
  },
  // Stored lines [y, h, x0, w0, ...] (1/10000) → fractions; text (optional):
  // the same lines as strings, words joined by single spaces.
  lines(raw, text) {
    return (raw || []).map((l, n) => {
      const said = text && typeof text[n] === 'string' ? text[n].split(' ') : null, words = [];
      for (let i = 2; i + 1 < l.length; i += 2) {
        const word = {x: l[i] / 1e4, w: l[i + 1] / 1e4};
        if (said && typeof said[(i - 2) / 2] === 'string') word.t = said[(i - 2) / 2];
        words.push(word);
      }
      return {y: l[0] / 1e4, h: l[1] / 1e4, words};
    }).filter(l => l.words.length);
  },
  // The word at/near point p. strict: null when p is not on text (so a
  // drag that starts in a margin draws a box instead).
  locate(lines, p, strict) {
    // Nearest line by height, but a line beside the point (another column at
    // about the same height) loses to the line the point is actually over.
    let best = -1, distance = Infinity, score = Infinity;
    lines.forEach((l, i) => {
      const d = p.y < l.y ? l.y - p.y : p.y > l.y + l.h ? p.y - (l.y + l.h) : 0;
      const left = l.words[0].x, right = l.words[l.words.length - 1].x + l.words[l.words.length - 1].w;
      const side = p.x < left ? left - p.x : p.x > right ? p.x - right : 0;
      if (d + side * 0.5 < score) { score = d + side * 0.5; distance = d; best = i; }
    });
    if (best < 0) return null;
    const line = lines[best], first = line.words[0], last = line.words[line.words.length - 1];
    if (strict && (distance > Math.max(line.h * 0.6, 0.008) || p.x < first.x - 0.02 || p.x > last.x + last.w + 0.02)) return null;
    let word = 0, gap = Infinity;
    line.words.forEach((w, j) => {
      const d = p.x < w.x ? w.x - p.x : p.x > w.x + w.w ? p.x - (w.x + w.w) : 0;
      if (d < gap) { gap = d; word = j; }
    });
    return {line: best, word};
  },
  // A line's pieces split at wide gaps (columns side by side):
  // [{from, to (word indexes), x, w}].
  pieces(line) {
    const out = [];
    line.words.forEach((w, i) => {
      const last = out[out.length - 1];
      if (last && w.x - (last.x + last.w) <= line.h * 2.5) { last.to = i; last.w = w.x + w.w - last.x; }
      else out.push({from: i, to: i, x: w.x, w: w.w});
    });
    return out;
  },
  // Rectangles [x, y, w, h] covering the words from a to b in reading order,
  // one per line piece; null when a is not on text. Only the column(s) the
  // drag starts and ends in are taken: text in a column beside it, even
  // between those lines, stays out.
  select(lines, a, b) {
    let s = this.locate(lines, a, true);
    if (!s) return null;
    let e = this.locate(lines, b, false);
    if (e.line < s.line || (e.line === s.line && e.word < s.word)) { const t = s; s = e; e = t; }
    const pieceOf = (at) => this.pieces(lines[at.line]).find(p => at.word >= p.from && at.word <= p.to);
    const ps = pieceOf(s), pe = pieceOf(e);
    const left = Math.min(ps.x, pe.x), right = Math.max(ps.x + ps.w, pe.x + pe.w);
    const inColumn = p => {
      const shared = Math.min(p.x + p.w, right) - Math.max(p.x, left);
      return shared > 0.5 * Math.min(p.w, right - left);
    };
    const rects = [], r = v => Math.round(v * 10000) / 10000;
    for (let li = s.line; li <= e.line; li++) {
      const line = lines[li], from = li === s.line ? s.word : 0, to = li === e.line ? e.word : line.words.length - 1;
      this.pieces(line).forEach(p => {
        const lo = Math.max(p.from, from), hi = Math.min(p.to, to);
        if (lo > hi || !inColumn(p)) return;
        const x = line.words[lo].x, w = line.words[hi].x + line.words[hi].w - x;
        rects.push([r(x), r(line.y), r(w), r(line.h)]);
      });
    }
    return rects;
  },
  // The words a highlight covers, in reading order ('' on pages without text).
  // Lines run on with a space, but a line that starts a bullet or numbered
  // item starts a new line (bullets shown as "• "), so lists stay lists.
  quote(lines, rects) {
    let out = '';
    lines.forEach(line => {
      const mid = line.y + line.h / 2;
      const picked = line.words.filter(w => w.t && rects.some(q => mid >= q[1] && mid <= q[1] + q[3] &&
        w.x + w.w / 2 >= q[0] && w.x + w.w / 2 <= q[0] + q[2]));
      if (!picked.length) return;
      let said = picked.map(w => w.t).join(' ');
      const item = this.item(said);
      if (item) said = item;
      out += !out ? said : (item ? '\n' : ' ') + said;
    });
    return out.trim();
  },
  // "• text" when a line starts a list item (•, ●, ▪, ➢, -, *, Wingdings/Symbol
  // bullets, or 1. 2) a. b)), else null.
  item(line) {
    const bullet = /^\s*(?:[\u2022\u25cf\u25e6\u25aa\u25a0\u25a1\u25c6\u25c7\u27a2\u27a4\u25ba\u25b6\u2713\u2714\u2756\u00b7*\u2013\u2014-]|[\uf000-\uf0ff])\s*(\S.*)$/.exec(line);
    if (bullet) return '\u2022 ' + bullet[1];
    const numbered = /^\s*((?:\d{1,2}|[a-zA-Z]|[ivxIVX]{1,4})[.)])\s+(\S.*)$/.exec(line);
    return numbered ? numbered[1] + ' ' + numbered[2] : null;
  },
  // One spelling for a quote: spaces collapsed, line breaks (list items) kept.
  tidy(text) { return String(text || '').replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim(); },
  // How much of the smaller rectangle two rectangles share (0..1).
  overlap(p, q) {
    const w = Math.min(p[0] + p[2], q[0] + q[2]) - Math.max(p[0], q[0]);
    const h = Math.min(p[1] + p[3], q[1] + q[3]) - Math.max(p[1], q[1]);
    if (w <= 0 || h <= 0) return 0;
    return (w * h) / Math.max(1e-9, Math.min(p[2] * p[3], q[2] * q[3]));
  },
  // Join rectangles that overlap (same line pieces, boxes) into one each.
  merge(rects) {
    const out = rects.map(q => q.slice());
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < out.length && !changed; i++) {
        for (let j = i + 1; j < out.length; j++) {
          if (this.overlap(out[i], out[j]) > 0.25) {
            const a = out[i], b = out[j], x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
            out[i] = [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y].map(v => Math.round(v * 10000) / 10000);
            out.splice(j, 1); changed = true; break;
          }
        }
      }
    }
    return out;
  },
  // A new highlight never stacks on an old one: overlapping highlights are
  // merged into it and take its colour.
  add(list, rects, color) {
    const touching = h => h.r.some(q => rects.some(n => this.overlap(q, n) > 0.25));
    const joined = list.filter(touching).reduce((all, h) => all.concat(h.r), rects.slice());
    return list.filter(h => !touching(h)).concat([{c: color, r: this.merge(joined)}]);
  },
  // Remove every highlight that touches the region (a box or a point).
  erase(list, region) {
    const hits = h => h.r.some(q => region[0] <= q[0] + q[2] && region[0] + region[2] >= q[0] && region[1] <= q[1] + q[3] && region[1] + region[3] >= q[1]);
    return list.filter(h => !hits(h));
  },
  box(a, b) {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    const r = v => Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000;
    return w > 0.006 && h > 0.006 ? [[r(x), r(y), r(w), r(h)]] : null;
  },
  load(key) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '{}'), out = {}, colors = this.COLORS;
      const unit = v => typeof v === 'number' && v >= 0 && v <= 1;
      Object.keys(raw || {}).forEach(k => {
        if (!/^\d+$/.test(k) || !Array.isArray(raw[k])) return;
        const list = raw[k].filter(h => h && colors[h.c] && Array.isArray(h.r) && h.r.length && h.r.every(q => Array.isArray(q) && q.length === 4 && q.every(unit)));
        if (list.length) out[k] = list.map(h => ({c: h.c, r: h.r}));
      });
      return out;
    } catch (e) { return {}; }
  },
  save(key, store) { try { localStorage.setItem(key, JSON.stringify(store)); return true; } catch (e) { return false; } },
  /* options: {key, pages (elements), words ({page: lines}), button,
     onQuote/onUnquote/onRecolor (notes), summarize: true + onSummary(index,
     said, color) → Promise (Summarize tool; only where a server can make
     summaries)} */
  bind(options) {
    const self = this, pages = options.pages, words = options.words || {};
    let store = self.load(options.key), mode = false, selected = null, drag = null, erasing = false, summarizing = false, notice = '', noticeTimer = 0;
    let color = 'y';
    try { const saved = localStorage.getItem('mf-highlight-color'); if (self.COLORS[saved]) color = saved; } catch (e) {}
    const lineCache = {};
    const texts = options.text || {};
    const linesOf = index => (lineCache[index] || (lineCache[index] = self.lines(words[String(index)], texts[String(index)])));
    const said = (index, h) => self.quote(linesOf(index), h.r);
    // Colour bar shown in highlighter mode.
    const bar = document.createElement('div');
    bar.className = 'book-hl-bar'; bar.hidden = true; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Highlighter');
    ['pointerdown', 'mousedown', 'touchstart'].forEach(name => bar.addEventListener(name, event => event.stopPropagation()));
    const swatches = {};
    Object.keys(self.COLORS).forEach(c => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'book-hl-swatch';
      b.style.background = self.COLORS[c]; b.title = self.NAMES[c]; b.setAttribute('aria-label', self.NAMES[c]);
      b.onclick = () => {
        color = c; erasing = false;
        try { localStorage.setItem('mf-highlight-color', c); } catch (e) {}
        if (selected) {
          const h = store[selected.page][selected.index];
          h.c = c; persist(selected.page);
          if (options.onRecolor) options.onRecolor(selected.page, said(selected.page, h), self.COLORS[c]);
        }
        paintBar();
      };
      swatches[c] = b; bar.appendChild(b);
    });
    const hint = document.createElement('span'); hint.className = 'book-hl-hint';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'book-hl-delete'; remove.textContent = 'Delete';
    remove.onclick = () => {
      if (!selected) return;
      const page = selected.page;
      store[page].splice(selected.index, 1);
      if (!store[page].length) delete store[page];
      selected = null; persist(page); paintBar();
    };
    // Eraser: drag over (or tap) highlights to remove them.
    const eraser = document.createElement('button'); eraser.type = 'button'; eraser.className = 'book-hl-eraser';
    eraser.innerHTML = self.ICONS.eraser; eraser.title = 'Eraser: drag over highlights to remove them'; eraser.setAttribute('aria-label', 'Eraser');
    eraser.onclick = () => {
      erasing = !erasing;
      if (selected) { const page = selected.page; selected = null; render(page); }
      paintBar();
    };
    // Highlighter pen: back to highlighting (the colour dots pick its colour).
    const brush = document.createElement('button'); brush.type = 'button'; brush.className = 'book-hl-brush';
    brush.innerHTML = self.ICONS.brush; brush.title = 'Highlighter: drag over text'; brush.setAttribute('aria-label', 'Highlighter');
    brush.onclick = () => { erasing = false; summarizing = false; paintBar(); };
    const tools = document.createElement('div'); tools.className = 'book-hl-tools';
    tools.appendChild(brush); tools.appendChild(eraser);
    // Summarize: new highlights become a short AI summary note instead of the quote.
    const summarize = document.createElement('button'); summarize.type = 'button'; summarize.className = 'book-hl-summary';
    summarize.innerHTML = self.ICONS.summary; summarize.title = 'Summarize: highlighted text becomes a short summary note';
    summarize.setAttribute('aria-label', 'Summarize highlights');
    summarize.onclick = () => {
      summarizing = !summarizing; erasing = false;
      if (selected) { const page = selected.page; selected = null; render(page); }
      paintBar();
    };
    if (options.summarize && options.onSummary) tools.appendChild(summarize);
    bar.insertBefore(tools, bar.firstChild);
    const done = document.createElement('button'); done.type = 'button'; done.className = 'book-hl-done'; done.textContent = 'Done';
    done.onclick = () => setMode(false);
    bar.appendChild(hint); bar.appendChild(remove); bar.appendChild(done);
    document.body.appendChild(bar);
    // With a toolbar button the bar pops up just above it (below it when
    // there is no room above); without one it stays a rail on the left.
    if (options.button) bar.classList.add('is-popup');
    function placeBar() {
      if (!mode || !options.button) return;
      const r = options.button.getBoundingClientRect(), width = bar.offsetWidth, height = bar.offsetHeight;
      const middle = r.left + r.width / 2;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, middle - width / 2));
      const below = r.top - height - 12 < 8;
      bar.classList.toggle('is-below', below);
      bar.style.left = left + 'px';
      bar.style.top = (below ? r.bottom + 12 : r.top - height - 12) + 'px';
      bar.style.setProperty('--hl-arrow', (middle - left) + 'px');
    }
    function paintBar() {
      Object.keys(swatches).forEach(c => swatches[c].setAttribute('aria-pressed', String(!erasing && (selected ? store[selected.page][selected.index].c === c : c === color))));
      eraser.setAttribute('aria-pressed', String(erasing));
      brush.setAttribute('aria-pressed', String(!erasing && !summarizing));
      summarize.setAttribute('aria-pressed', String(summarizing && !erasing));
      brush.style.setProperty('--hl-color', self.COLORS[selected ? store[selected.page][selected.index].c : color]);
      document.body.style.setProperty('--hl-cursor', self.cursor(erasing ? 'eraser' : 'brush', self.COLORS[color]));
      document.body.classList.toggle('is-erasing', mode && erasing);
      remove.hidden = !selected;
      hint.textContent = notice || (erasing ? 'Drag over highlights to erase them' : selected ? 'Pick a colour or delete'
        : summarizing ? 'Drag over text: its note becomes a short summary' : 'Drag over text to highlight');
      bar.title = hint.textContent;
      placeBar();
    }
    function render(index) {
      const page = pages[index];
      if (!page) return;
      let layer = page.querySelector('.book-highlights');
      if (!layer) { layer = document.createElement('div'); layer.className = 'book-highlights'; page.appendChild(layer); }
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      (store[index] || []).forEach((h, i) => h.r.forEach(q => {
        const mark = document.createElement('div');
        mark.className = 'book-hl' + (selected && selected.page === index && selected.index === i ? ' is-selected' : '');
        mark.style.left = q[0] * 100 + '%'; mark.style.top = q[1] * 100 + '%';
        mark.style.width = q[2] * 100 + '%'; mark.style.height = q[3] * 100 + '%';
        mark.style.background = self.COLORS[h.c];
        layer.appendChild(mark);
      }));
    }
    function persist(index) { self.save(options.key, store); render(index); }
    function preview(index, rects) {
      const page = pages[index];
      let layer = page.querySelector('.book-hl-preview');
      if (!layer) { layer = document.createElement('div'); layer.className = 'book-highlights book-hl-preview'; page.appendChild(layer); }
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      (rects || []).forEach(q => {
        const mark = document.createElement('div'); mark.className = erasing ? 'book-hl is-eraser' : 'book-hl is-preview';
        mark.style.left = q[0] * 100 + '%'; mark.style.top = q[1] * 100 + '%'; mark.style.width = q[2] * 100 + '%'; mark.style.height = q[3] * 100 + '%';
        if (!erasing) mark.style.background = self.COLORS[color];
        layer.appendChild(mark);
      });
    }
    function point(event, page) {
      const t = event.touches && event.touches.length ? event.touches[0] : event.changedTouches && event.changedTouches.length ? event.changedTouches[0] : event;
      const box = page.getBoundingClientRect();
      return {x: (t.clientX - box.left) / box.width, y: (t.clientY - box.top) / box.height};
    }
    const rectsFor = (index, a, b) => self.select(linesOf(index), a, b) || self.box(a, b);
    function move(event) {
      if (!drag) return;
      if (event.cancelable) event.preventDefault();
      drag.b = point(event, pages[drag.page]);
      if (Math.abs(drag.b.x - drag.a.x) + Math.abs(drag.b.y - drag.a.y) > 0.008) drag.moved = true;
      if (drag.moved) preview(drag.page, erasing ? self.box(drag.a, drag.b) : rectsFor(drag.page, drag.a, drag.b));
    }
    function up(event) {
      if (!drag) return;
      window.removeEventListener('mousemove', move, true); window.removeEventListener('mouseup', up, true);
      window.removeEventListener('touchmove', move, true); window.removeEventListener('touchend', up, true);
      const index = drag.page, a = drag.a, b = drag.moved ? drag.b : a;
      preview(index, null);
      if (event && event.cancelable) event.preventDefault();
      if (erasing) {
        const region = (drag.moved && self.box(a, b)) ? self.box(a, b)[0] : [a.x, a.y, 0, 0];
        const old = store[index] || [], left = self.erase(old, region);
        if (left.length !== old.length) {
          if (left.length) store[index] = left; else delete store[index];
          persist(index);
          if (options.onUnquote) old.filter(h => left.indexOf(h) < 0).forEach(h => options.onUnquote(index, said(index, h)));
        }
      } else if (!drag.moved) {
        // Tap: select the highlight under the finger (or clear the selection).
        const hit = (store[index] || []).findIndex(h => h.r.some(q => a.x >= q[0] && a.x <= q[0] + q[2] && a.y >= q[1] && a.y <= q[1] + q[3]));
        const previous = selected;
        selected = hit >= 0 ? {page: index, index: hit} : null;
        if (previous) render(previous.page);
        render(index);
      } else {
        const rects = rectsFor(index, a, b);
        if (rects && rects.length) {
          store[index] = self.add(store[index] || [], rects, color);
          const previous = selected; selected = null;
          if (previous) render(previous.page);
          persist(index);
          // The highlighted text goes straight into a note on the page edge
          // (in summary mode: a short AI summary of it).
          const made = store[index][store[index].length - 1];
          if (summarizing && options.summarize && options.onSummary) {
            Promise.resolve(options.onSummary(index, said(index, made), self.COLORS[made.c])).catch(cause => {
              notice = 'Summary failed: ' + ((cause && cause.message) || 'try again') + ' (kept the quote)';
              clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice = ''; paintBar(); }, 6000);
              paintBar();
            });
          } else if (options.onQuote) options.onQuote(index, said(index, made), self.COLORS[made.c]);
        }
      }
      drag = null; paintBar();
    }
    function down(event, index) {
      if (!mode || (event.touches && event.touches.length > 1)) return;   // two fingers: let pinch zoom work
      event.stopPropagation(); if (event.cancelable) event.preventDefault();
      drag = {page: index, a: point(event, pages[index]), moved: false};
      drag.b = drag.a;
      // Capture phase: the page stops mousemove from bubbling (no corner
      // fold under the highlighter), so listen before it gets there.
      window.addEventListener('mousemove', move, true); window.addEventListener('mouseup', up, true);
      window.addEventListener('touchmove', move, {passive: false, capture: true}); window.addEventListener('touchend', up, true);
    }
    pages.forEach((page, index) => {
      // Property handlers: rebinding replaces them instead of stacking.
      page.onmousedown = event => down(event, index);
      page.ontouchstart = event => down(event, index);
      // No page-corner fold animation under the highlighter.
      page.onmousemove = event => { if (mode) event.stopPropagation(); };
      render(index);
    });
    function escape(event) { if (event.key === 'Escape') setMode(false); }
    function setMode(on) {
      mode = on;
      document.body.classList.toggle('is-highlighting', on);
      bar.hidden = !on;
      window[on ? 'addEventListener' : 'removeEventListener']('resize', placeBar);
      window[on ? 'addEventListener' : 'removeEventListener']('scroll', placeBar, true);
      if (options.button) { options.button.setAttribute('aria-pressed', String(on)); options.button.classList.toggle('is-on', on); }
      if (on) document.addEventListener('keydown', escape);
      else {
        document.removeEventListener('keydown', escape);
        if (selected) { const page = selected.page; selected = null; render(page); }
        erasing = false; summarizing = false;
      }
      paintBar();
    }
    if (options.button) {
      options.button.innerHTML = self.ICONS.brush;
      options.button.title = 'Highlighter';
      options.button.setAttribute('aria-label', 'Highlighter');
      options.button.onclick = () => setMode(!mode);
    }
    paintBar();
    return {
      active: () => mode, setMode,
      // A quote note was deleted: remove the highlight it came from.
      forget(index, quote) {
        const list = store[index] || [], text = self.tidy(quote);
        if (!text) return 0;
        const left = list.filter(h => said(index, h) !== text);
        if (left.length === list.length) return 0;
        if (selected && selected.page === index) selected = null;
        if (left.length) store[index] = left; else delete store[index];
        persist(index); paintBar();
        return list.length - left.length;
      },
      close() { setMode(false); bar.remove(); },
      bar: () => bar,
      store: () => JSON.parse(JSON.stringify(store)),
    };
  },
};


// Read aloud: speaks the text of the pages on screen, then turns the page
// and goes on until the end of the book. Voices come from the browser /
// Windows (Web Speech API) or, in the Android app, from Android's
// text-to-speech through the MyFlipbook channel (WebView has no voices).
// ES2018 for old Android WebViews.
(typeof self!=='undefined'?self:global).FlipbookSpeech = {
  MAX: 220,
  // Words of a page in reading order: {t, line, word, box: [x, y, w, h]}
  // (fractions of the page; no box when only the text is known).
  words(raw, text) {
    if (raw && raw.length && typeof FlipbookHighlights !== 'undefined') {
      const out = [];
      FlipbookHighlights.lines(raw, text).forEach((line, li) => line.words.forEach((w, wi) => {
        if (w.t) out.push({t: w.t, line: li, word: wi, box: [w.x, line.y, w.w, line.h]});
      }));
      if (out.length) return out;
    }
    const out = [];
    (Array.isArray(text) ? text : [String(text || '')]).forEach((line, li) =>
      String(line || '').split(/\s+/).forEach((t, wi) => { if (t) out.push({t, line: li, word: wi, box: null}); }));
    return out;
  },
  // Words → pieces of whole sentences of at most MAX characters (browsers
  // cut long utterances short): {text, boxes: one rectangle per line}.
  // Table-of-contents dot leaders are not read.
  pieces(words) {
    const out = [], max = this.MAX;
    let cur = [], length = 0;
    const flush = () => {
      if (!cur.length) return;
      const lines = {};
      cur.forEach(w => {
        if (!w.box) return;
        const b = w.box, l = lines[w.line];
        if (!l) lines[w.line] = b.slice();
        else { const right = Math.max(l[0] + l[2], b[0] + b[2]); l[0] = Math.min(l[0], b[0]); l[2] = right - l[0]; }
      });
      out.push({text: this.say(cur.map(w => w.t).join(' ')), boxes: Object.keys(lines).map(k => lines[k]), first: cur[0]});
      cur = []; length = 0;
    };
    words.forEach(w => {
      const t = w.t.replace(/\.{3,}|\u2026{2,}|_{3,}/g, '');
      if (!t) return;
      if (length && length + 1 + t.length > max) flush();
      cur.push({t, line: w.line, word: w.word, box: w.box}); length += (length ? 1 : 0) + t.length;
      if (/[.!?]["'\u201d)]*$/.test(t) && length > max / 3) flush();   // end of a sentence
    });
    flush();
    return out;
  },
  // Text as it should be spoken. Voices spell out words in capitals
  // ("NUSANTARA" → N-U-S-…): capitals that can be pronounced become normal
  // words; acronyms (PDF, UMKM, DPRD, BUMN, JKT2A, and AI in a sentence)
  // stay spelled. A heading in capitals reads like a sentence.
  say(text) {
    const tokens = String(text || '').split(' ');
    const letters = tokens.join('').replace(/[^A-Za-z]/g, '');
    const shouting = letters.length >= 8 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.8;
    return tokens.map(token => this.sayWord(token, shouting)).join(' ');
  },
  sayWord(token, shouting) {
    const core = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (!/^[A-Z]{2,}$/.test(core)) return token;             // not all capitals (or has digits: JKT2A)
    // Common consonant clusters count as one sound (STRATEGI, BANGKIT, EKSPOR).
    const sounds = core.replace(/STR|SPR|NTR|MPR|MBR|NGK|NGG|KSP|KST|NG|NY|KH|SY/g, 'C');
    const acronym = !/[AEIOU]/.test(core) ||                   // PDF, DPR, MPR
      /[^AEIOUC]{3}/.test(sounds.replace(/C/g, 'B')) ||       // UMKM
      (core.length <= 4 && /[^AEIOU]{2}$/.test(core) && !/(NG|KS|LM|ST|RT|NT|NK|RS|RK)$/.test(core));   // BUMN (not TEKS, FILM, YANG)
    if (acronym) return token;
    if (core.length <= 3 && !shouting) return token;          // AI, DKI inside a normal sentence
    return token.replace(core, core.charAt(0) + core.slice(1).toLowerCase());
  },
  // Running headers / footers and page numbers, which reading aloud skips:
  // lines near the top or bottom edge that repeat on several pages (digits
  // ignored, so "Volume 7 ... 10-18" matches "... 11-18"), or that are only a
  // page number. Returns {"page:line": true} (line = index in lines()).
  furniture(positions, text) {
    const skip = {}, groups = {}, pages = Object.keys(positions || {});
    if (typeof FlipbookHighlights === 'undefined') return skip;
    pages.forEach(page => {
      FlipbookHighlights.lines(positions[page], (text || {})[page]).forEach((line, li) => {
        if (!(line.y < 0.12 || line.y + line.h > 0.88)) return;          // only the page edges
        const said = line.words.map(w => w.t || '').join(' ').trim();
        if (!said) return;
        if (/^((page|halaman|hal\.?|p\.)\s*)?[\divxlcdm]+([\s.\-–|\/]+(of|dari)?\s*[\divxlcdm]+)?\.?$/i.test(said)) { skip[page + ':' + li] = true; return; }
        const key = said.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
        if (key.replace(/[#\W]/g, '').length < 3) return;
        (groups[key] = groups[key] || []).push(page + ':' + li);
      });
    });
    const enough = pages.length <= 4 ? 2 : 3;
    Object.keys(groups).forEach(key => {
      const where = groups[key], onPages = {};
      where.forEach(at => { onPages[at.split(':')[0]] = true; });
      if (Object.keys(onPages).length >= enough) where.forEach(at => { skip[at] = true; });
    });
    return skip;
  },
  // A page's text lines → the text of its pieces.
  chunks(lines) {
    return this.pieces(this.words(null, Array.isArray(lines) ? lines : [String(lines || '')])).map(piece => piece.text);
  },
  // Indonesian or English, from common short words.
  // Indonesian, Malay or English, from common short words; Malay and
  // Indonesian share most of them, so words used by only one decide.
  lang(text) {
    const words = String(text || '').toLowerCase().match(/[a-z]+/g) || [];
    const malayic = {yang: 1, dan: 1, di: 1, ke: 1, dari: 1, untuk: 1, dengan: 1, ini: 1, itu: 1, pada: 1, dalam: 1, tidak: 1, akan: 1, sebagai: 1, kami: 1, juga: 1, atau: 1, oleh: 1};
    const en = {the: 1, and: 1, of: 1, to: 1, is: 1, in: 1, for: 1, with: 1, that: 1, this: 1, are: 1, on: 1, be: 1, it: 1, as: 1, we: 1};
    const id = {adalah: 1, karena: 1, saja: 1, bisa: 1, yaitu: 1, pemerintah: 1, kalian: 1, sudah: 1, belum: 1, sangat: 1, sekolah: 1, uang: 1, mobil: 1, kantor: 1};
    // Only words Indonesian (almost) never uses; Malay must clearly win.
    const ms = {iaitu: 1, kerana: 1, sahaja: 1, berbeza: 1, kakitangan: 1, mesyuarat: 1, percuma: 1, sila: 1, wang: 1, sebarang: 1};
    let a = 0, b = 0, i = 0, m = 0;
    words.forEach(w => { if (malayic[w] || id[w] || ms[w]) a++; if (en[w]) b++; if (id[w]) i++; if (ms[w]) m++; });
    if (b > a) return 'en-US';
    return m >= 3 && m > 2 * i ? 'ms-MY' : 'id-ID';
  },
  NAMES: {id: 'Indonesian', ms: 'Malay', en: 'English'},
  // The voice engine here: {speak(text, lang, done(ok)), stop()} or null.
  engine() {
    const root = typeof window !== 'undefined' ? window : {};
    const app = root.MyFlipbook && root.MyFlipbook.postMessage ? root.MyFlipbook : null;
    if (app) {
      // Android app: the Flutter side speaks and calls back FlipbookSpeechNative({id, event}).
      const pending = {};
      let seq = 0;
      root.FlipbookSpeechNative = message => {
        const done = message && pending[message.id];
        if (!done) return;
        delete pending[message.id];
        done(message.event === 'end');
      };
      return {
        speak(text, lang, done, gender) { const id = ++seq; pending[id] = done; app.postMessage('tts:' + JSON.stringify({op: 'speak', id, text, lang, gender: gender || 'female'})); },
        stop() { Object.keys(pending).forEach(k => { delete pending[k]; }); app.postMessage('tts:' + JSON.stringify({op: 'stop'})); }
      };
    }
    const synth = root.speechSynthesis, Utterance = root.SpeechSynthesisUtterance;
    if (!synth || !Utterance) return null;
    let current = null, keep = 0, guard = 0;
    const clearTimers = () => { clearInterval(keep); clearTimeout(guard); keep = guard = 0; };
    // A woman's voice in the book's language: Google's (Chrome: "Google Bahasa
    // Indonesia" is a woman's voice), then Edge's natural ones (Gadis), then
    // any not known to be a man's (Windows' Indonesian "Andika" is last).
    // English: Google US English / UK English Female (Chrome), Aria/Jenny
    // (Edge), Zira/Hazel/Susan (Windows). Malay: Yasmin (Edge), else an
    // Indonesian voice (close enough, far better than an English one).
    const male = v => /\b(ardi|andika|osman|male|pria|laki|david|mark|george|guy|ryan|christopher|eric|james|daniel)\b/i.test(v.name) && !/female/i.test(v.name);
    const woman = /gadis|yasmin|female|wanita|perempuan|zira|aria|jenny|hazel|susan|libby|sonia|samantha|karen|natasha|michelle/i;
    const pick = (code, gender) => {
      const all = synth.getVoices() || [];
      const fits = all.filter(v => { const l = String(v.lang || '').replace('_', '-').toLowerCase(); return l.indexOf(code) === 0 || (code === 'id' && l.indexOf('in-') === 0); });
      if (gender === 'male') {
        // A man's voice if there is one (Edge: Ardi; Windows: Andika; Chrome: Google UK English Male).
        const men = fits.filter(male);
        return men.filter(v => /natural|online/i.test(v.name))[0] || men.filter(v => /google/i.test(v.name))[0] || men[0] || null;
      }
      return fits.filter(v => /google/i.test(v.name) && !male(v))[0] ||
        fits.filter(v => woman.test(v.name))[0] ||
        fits.filter(v => /natural|online/i.test(v.name) && !male(v))[0] ||
        fits.filter(v => !male(v))[0] || fits[0] || null;
    };
    const voice = (lang, gender) => {
      const code = lang.slice(0, 2).toLowerCase();
      return pick(code, gender) || (code === 'ms' ? pick('id', gender) : null);
    };
    return {
      speak(text, lang, done, gender) {
        const u = new Utterance(text);
        // No man's voice here: the woman's voice, lower (two hosts still sound apart).
        let v = gender === 'male' ? voice(lang, 'male') : null;
        if (gender === 'male' && !v) u.pitch = 0.7;
        v = v || voice(lang);
        u.lang = v && v.lang ? String(v.lang).replace('_', '-') : lang;
        if (v) u.voice = v;
        let finished = false;
        const end = ok => { if (!finished) { finished = true; clearTimers(); done(ok); } };
        u.onend = () => end(true);
        u.onerror = event => end(event && (event.error === 'interrupted' || event.error === 'canceled'));
        current = u;                                     // keep a reference: Chrome drops events of collected utterances
        if (synth.speaking || synth.pending) synth.cancel();   // never two pieces at once
        clearTimers();
        synth.speak(u);
        // Chrome: Google's online voices fall silent after ~15 s unless nudged,
        // and now and then never fire onend; keep them going, and move on
        // once nothing is speaking any more.
        if (v && v.localService === false) keep = setInterval(() => { if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); } }, 10000);
        const check = () => { if (finished) return; if (synth.speaking || synth.pending) { guard = setTimeout(check, 3000); return; } end(true); };
        guard = setTimeout(check, 8000 + text.length * 150);
      },
      stop() { current = null; clearTimers(); synth.cancel(); },
      // false when this device lists voices but none in that language.
      has(lang) { const all = synth.getVoices() || []; return !all.length || !!voice(lang); }
    };
  },
  /* options: {text: {page: [lines]}, words: {page: [positions]} (same as
     highlights), pages (elements: reading marks, click a word to read
     from there), visible(): page indices on screen, next(): turns the
     page, false at the end of the book, busy(): another tool owns clicks
     (highlighter), button, notice(message) (no voice in the book's
     language), engine (tests)} */
  bind(options) {
    const self = this, text = options.text || {}, positions = options.words || {}, pages = options.pages || [];
    const engine = options.engine || self.engine();
    const all = Object.keys(text).map(k => (text[k] || []).join(' ')).join(' ');
    const lang = self.lang(all.slice(0, 20000));
    let on = false, speaking = false, run = 0, shown = '', wait = 0, marked = null;
    const button = options.button, cache = {};
    // Headers, footers and page numbers are not read.
    const furniture = self.furniture(positions, text);
    const wordsOf = index => cache[index] || (cache[index] = self.words(positions[String(index)], text[String(index)])
      .filter(w => !(w.box && furniture[index + ':' + w.line])));
    function paint() {
      if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('is-reading', on);
      if (!button) return;
      button.textContent = on ? '⏹ Stop' : '🎧 Listen';
      button.title = on ? 'Stop reading aloud · click a word on the page to read from there' : 'Read aloud: click a word to start there (turns the pages for you)';
      button.setAttribute('aria-pressed', String(on));
      button.classList.toggle('is-on', on);
    }
    // The piece being read, marked on its page.
    function mark(index, piece) {
      if (marked) { marked.remove(); marked = null; }
      const page = pages[index];
      if (!page || !piece || !piece.boxes.length) return;
      marked = document.createElement('div');
      marked.className = 'book-reading';
      piece.boxes.forEach(b => {
        const m = document.createElement('span');
        m.style.left = b[0] * 100 + '%'; m.style.top = b[1] * 100 + '%';
        m.style.width = b[2] * 100 + '%'; m.style.height = b[3] * 100 + '%';
        marked.appendChild(m);
      });
      page.appendChild(marked);
    }
    function stop() {
      on = false; speaking = false; run++; clearTimeout(wait);
      if (engine) engine.stop();
      mark(-1, null);
      paint();
    }
    function turn(mine, tries) {
      if (!on || mine !== run) return;
      mark(-1, null);
      if (!options.next()) { stop(); return; }            // the end of the book
      // The new pages are read when the viewer calls pageChanged(). If the
      // book was busy and didn't turn, try again (then give up cleanly).
      wait = setTimeout(() => {
        if (!on || mine !== run) return;
        if (options.visible().join(',') !== shown) { read(null); return; }   // turned without telling us
        if ((tries || 0) < 3) turn(mine, (tries || 0) + 1);
        else { stop(); if (options.notice) options.notice('Reading stopped: the page could not be turned.'); }
      }, 3000);
    }
    // Read the pages on screen, or from a word: from = {page, line, word}.
    function read(from) {
      const mine = ++run;
      clearTimeout(wait);
      engine.stop();
      const shownPages = options.visible();
      shown = shownPages.join(',');
      const queue = [];
      shownPages.forEach(index => {
        if (from && index < from.page) return;
        let words = wordsOf(index);
        if (from && index === from.page) words = words.filter(w => w.line > from.line || (w.line === from.line && w.word >= from.word));
        self.pieces(words).forEach(piece => queue.push({page: index, piece}));
      });
      // A page without text (a picture): a short pause, then on.
      if (!queue.length) { mark(-1, null); wait = setTimeout(() => turn(mine), 1500); return; }
      let fails = 0;
      const step = () => {
        if (!on || mine !== run) return;
        if (!queue.length) { turn(mine); return; }
        const next = queue.shift();
        mark(next.page, next.piece);
        engine.speak(next.piece.text, lang, ok => {
          if (!on || mine !== run) return;
          if (ok) { fails = 0; step(); return; }
          // A voice hiccup (network, engine busy): this piece once more, then
          // skip it; only several failures in a row stop the reading.
          if (++fails >= 4) { stop(); if (options.notice) options.notice('Reading stopped: the voice is not responding.'); return; }
          if (!next.retried) { next.retried = true; queue.unshift(next); }
          setTimeout(step, 400);
        });
      };
      step();
    }
    // Listen: ready, but silent until the reader clicks a word (no voice
    // starting on its own on top of anything else).
    function arm() {
      if (!engine) return;
      if (options.onStart) options.onStart();
      on = true; speaking = false; run++; engine.stop(); mark(-1, null); paint();
      if (options.notice) options.notice('Click (or tap) a word on the page: reading starts there.');
    }
    function start(from) {
      if (!engine) return;
      if (options.onStart) options.onStart();
      const first = !speaking;
      on = true; speaking = true; paint(); read(from);
      if (first && engine.has && !engine.has(lang) && options.notice) {
        options.notice('No ' + (self.NAMES[lang.slice(0, 2)] || lang) + ' voice on this device: reading with the default voice.' +
          ' Windows: Settings \u203a Time & language \u203a Speech \u203a Add voices.');
      }
    }
    // While reading, a click (or tap) on a word reads on from that word.
    function wordAt(index, clientX, clientY) {
      const raw = positions[String(index)], page = pages[index];
      if (!raw || !page || typeof FlipbookHighlights === 'undefined') return null;
      const r = page.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const hit = FlipbookHighlights.locate(FlipbookHighlights.lines(raw, text[String(index)]), {x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height}, true);
      return hit ? {page: index, line: hit.line, word: hit.word} : null;
    }
    const listening = () => on && !(options.busy && options.busy());
    const handlers = pages.map((page, index) => {
      const down = event => {
        if (!listening() || event.button > 0) return;
        const at = wordAt(index, event.clientX, event.clientY);
        if (!at) return;                                  // margins still turn the page
        event.stopPropagation(); if (event.cancelable) event.preventDefault();
        start(at);
      };
      // Touch: a quick still tap (a swipe still turns the page).
      let touch = null;
      const touchStart = event => { touch = listening() && event.touches.length === 1 ? {x: event.touches[0].clientX, y: event.touches[0].clientY, time: Date.now()} : null; };
      const touchEnd = event => {
        if (!touch || !listening()) return;
        const t = event.changedTouches && event.changedTouches[0], from = touch; touch = null;
        if (!t || Math.abs(t.clientX - from.x) + Math.abs(t.clientY - from.y) > 12 || Date.now() - from.time > 400) return;
        const at = wordAt(index, t.clientX, t.clientY);
        if (at) start(at);
      };
      page.addEventListener('mousedown', down, true);
      page.addEventListener('touchstart', touchStart, {capture: true, passive: true});
      page.addEventListener('touchend', touchEnd, true);
      return () => { page.removeEventListener('mousedown', down, true); page.removeEventListener('touchstart', touchStart, true); page.removeEventListener('touchend', touchEnd, true); };
    });
    if (button) {
      // Books without any text (scans) have nothing to read.
      button.hidden = !engine || !all.trim();
      button.onclick = () => { if (on) stop(); else arm(); };
    }
    paint();
    return {
      active: () => on, speaking: () => speaking, arm, start: () => start(null), stop, lang: () => lang,
      readFrom: (index, line, word) => start({page: index, line, word}),
      // The viewer calls this after every page turn (by the reader or by us).
      pageChanged() { if (on && speaking && options.visible().join(',') !== shown) read(null); },
      close() { stop(); handlers.forEach(off => off()); }
    };
  },
};

// Podcast: two hosts talk the book through (a script written with AI in the
// editor, stored in the book as podcast.lines [{s: 'A'|'B', t}]). Played
// with the device's voices — host A a woman, host B a man — with the
// transcript on screen; tap a line to play from there. ES2018.
(typeof self!=='undefined'?self:global).FlipbookPodcast = {
  HOSTS: ['Rina', 'Bima'],
  // "RINA: text" lines → [{s, t}]; the first name found is host A, the second host B.
  parse(text, hosts) {
    const names = [], lines = [];
    String(text || '').split(/\r?\n/).forEach(raw => {
      const m = /^\s*([A-Za-z][A-Za-z .'-]{0,30}?)\s*:\s*(.+)$/.exec(raw);
      if (m) {
        const who = m[1].trim().toLowerCase();
        if (names.indexOf(who) < 0 && names.length < 2) names.push(who);
        const index = names.indexOf(who);
        if (index >= 0) { lines.push({s: index ? 'B' : 'A', t: m[2].trim()}); return; }
      }
      if (lines.length && raw.trim()) lines[lines.length - 1].t += ' ' + raw.trim();   // a wrapped line
    });
    return {lines: lines.filter(l => l.t).slice(0, 400), hosts: names.length ? names.map((n, i) => n.replace(/\b\w/g, c => c.toUpperCase())).concat(this.HOSTS.slice(names.length)).slice(0, 2) : (hosts || this.HOSTS).slice()};
  },
  format(podcast) {
    const hosts = (podcast && podcast.hosts) || this.HOSTS;
    return ((podcast && podcast.lines) || []).map(l => hosts[l.s === 'B' ? 1 : 0].toUpperCase() + ': ' + l.t).join('\n');
  },
  /* options: {podcast (object, or a function returning it), button,
     engine (tests), onStart() (stop other reading), title} */
  bind(options) {
    const self = this, engine = options.engine || FlipbookSpeech.engine();
    const get = () => (typeof options.podcast === 'function' ? options.podcast() : options.podcast) || null;
    let panel = null, list = null, play = null, on = false, run = 0, at = 0;
    const button = options.button;
    function usable() { const p = get(); return !!(engine && p && p.lines && p.lines.length); }
    function paint() {
      if (button) {
        button.hidden = !usable();
        button.textContent = '🎙 Podcast';
        button.title = 'Listen to two hosts talk about this book';
        button.classList.toggle('is-on', !!panel);
        button.setAttribute('aria-expanded', String(!!panel));
      }
      if (play) { play.textContent = on ? '⏸ Pause' : '▶ Play'; play.setAttribute('aria-label', on ? 'Pause' : 'Play'); }
      if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('is-podcast', on);
      if (list) Array.prototype.forEach.call(list.children, (row, i) => row.classList.toggle('is-now', i === at && (on || at > 0)));
    }
    function stop() { on = false; run++; if (engine) engine.stop(); paint(); }
    function speakFrom(index) {
      const p = get();
      if (!p || !engine) return;
      if (options.onStart) options.onStart();
      const mine = ++run, lang = p.lang || 'id-ID';
      on = true; at = index;
      const step = () => {
        if (!on || mine !== run) return;
        if (at >= p.lines.length) { on = false; at = 0; paint(); return; }
        paint();
        const row = list && list.children[at];
        if (row && row.scrollIntoView) row.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        const line = p.lines[at];
        engine.speak(FlipbookSpeech.say(line.t), lang, ok => {
          if (!on || mine !== run) return;
          if (!ok) { stop(); return; }
          at++; step();
        }, line.s === 'B' ? 'male' : 'female');
      };
      engine.stop();
      step();
    }
    function close() {
      stop(); at = 0;
      if (panel) { panel.remove(); panel = null; list = null; play = null; }
      paint();
    }
    function open() {
      const p = get();
      if (!p) return;
      const hosts = p.hosts || self.HOSTS;
      panel = document.createElement('div');
      panel.className = 'book-marks book-podcast'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Podcast');
      ['pointerdown', 'mousedown', 'touchstart'].forEach(name => panel.addEventListener(name, event => event.stopPropagation()));
      const head = document.createElement('div'); head.className = 'book-podcast-head';
      const title = document.createElement('p'); title.className = 'book-marks-title'; title.textContent = '🎙 ' + hosts[0] + ' & ' + hosts[1];
      play = document.createElement('button'); play.type = 'button'; play.className = 'book-podcast-play';
      play.onclick = () => { if (on) stop(); else speakFrom(at); };
      const shut = document.createElement('button'); shut.type = 'button'; shut.className = 'book-podcast-close'; shut.textContent = '✕';
      shut.setAttribute('aria-label', 'Close podcast'); shut.onclick = close;
      head.appendChild(title); head.appendChild(play); head.appendChild(shut);
      list = document.createElement('ol'); list.className = 'book-podcast-lines';
      p.lines.forEach((line, i) => {
        const row = document.createElement('li');
        row.className = 'book-podcast-line is-' + (line.s === 'B' ? 'b' : 'a');
        const who = document.createElement('b'); who.textContent = hosts[line.s === 'B' ? 1 : 0];
        const said = document.createElement('span'); said.textContent = line.t;
        row.appendChild(who); row.appendChild(said);
        row.onclick = () => speakFrom(i);
        list.appendChild(row);
      });
      panel.appendChild(head); panel.appendChild(list);
      document.body.appendChild(panel);
      paint();
    }
    if (button) button.onclick = () => { if (panel) close(); else { open(); speakFrom(0); } };
    paint();
    return {active: () => on, stop, close, refresh() { if (panel && !usable()) close(); paint(); }, open, playFrom: speakFrom};
  },
};

// Translation: the book's text translated with AI in the editor (stored as
// translations {lang: {page: text}}), shown beside the book for the pages on
// screen and following the page turns. ES2018.
// Translated editions ("ID | EN"): the same book with every page's text in
// another language, layout unchanged (pictures made by assets/pdf-translate.js).
// The button shows the languages, the one on screen in bold; a press moves to
// the next. ES2018 for old Android WebViews.
(typeof self!=='undefined'?self:global).FlipbookEditions = {
  CODES: {'id-ID': 'ID', 'en-US': 'EN', 'ms-MY': 'MS'},
  NAMES: {'id-ID': 'Indonesian', 'en-US': 'English', 'ms-MY': 'Malay'},
  /* options: {button, original (lang), ready() → [langs with pictures],
     offer: [langs that can still be made] (editor), apply(lang) swaps the pages,
     make(lang, progress(text)) → Promise (editor: translate the book),
     confirm(lang) → Promise<boolean> before making, onError(message)} */
  bind(options) {
    const self = this, button = options.button;
    let current = options.original, busy = false;
    const ready = () => (options.ready ? options.ready() : []).filter(l => l !== options.original);
    const list = () => {
      const out = [options.original];
      ready().concat(options.offer || []).forEach(l => { if (self.CODES[l] && out.indexOf(l) < 0) out.push(l); });
      return out;
    };
    function paint(text) {
      if (!button) return;
      const langs = list();
      button.hidden = !options.original || langs.length < 2;
      while (button.firstChild) button.removeChild(button.firstChild);
      if (text) { button.textContent = text; return; }
      langs.forEach((l, i) => {
        if (i) button.appendChild(document.createTextNode(' | '));
        const code = document.createElement('span'); code.textContent = self.CODES[l];
        if (l === current) code.className = 'is-current';
        button.appendChild(code);
      });
      const next = langs[(langs.indexOf(current) + 1) % langs.length];
      button.title = 'Book language: ' + self.NAMES[current] + ' · press for ' + self.NAMES[next];
      button.setAttribute('aria-label', button.title);
      button.classList.toggle('is-translated', current !== options.original);
    }
    function show(lang) { current = lang; if (options.apply) options.apply(lang); paint(); }
    async function press() {
      if (busy) return;
      const langs = list(), next = langs[(langs.indexOf(current) + 1) % langs.length];
      if (next === options.original || ready().indexOf(next) >= 0 || !options.make) { show(next); return; }
      if (options.confirm && !(await options.confirm(next))) return;
      busy = true;
      try {
        await options.make(next, text => paint(text));
        show(next);
      } catch (cause) {
        paint();
        if (cause && cause.message !== 'cancelled' && options.onError) options.onError(cause.message);
      } finally { busy = false; paint(); }
    }
    if (button) button.onclick = press;
    paint();
    return {
      current: () => current, busy: () => busy,
      show, refresh() { paint(); },
      // Back to the book's own language (a new PDF, a closed edition).
      reset() { current = options.original; paint(); }
    };
  },
};

(typeof self!=='undefined'?self:global).FlipbookTranslate = {
  NAMES: {'id-ID': 'Bahasa Indonesia', 'en-US': 'English', 'ms-MY': 'Bahasa Melayu'},
  /* options: {translations (object, or a function returning it),
     visible(): page indices on screen, button,
     translate(pages {index: text}, lang) → Promise<{index: translation}>
       (optional: pages are then translated when they come on screen),
     text(index): the page's text (with translate), save(lang, pages) to keep results,
     preferred(): the language to start with} */
  bind(options) {
    const self = this;
    const get = () => (typeof options.translations === 'function' ? options.translations() : options.translations) || {};
    const langs = () => Object.keys(get()).filter(l => self.NAMES[l] && Object.keys(get()[l] || {}).length);
    const live = typeof options.translate === 'function';
    const choices = () => live ? Object.keys(self.NAMES) : langs();
    let panel = null, body = null, pick = null, lang = null, failed = '';
    const pending = {};          // "lang:index" being translated
    let asked = {};              // "lang:index" asked since the page / language changed (no endless retries)
    const button = options.button;
    function paint() {
      if (!button) return;
      button.hidden = !live && !langs().length;
      button.textContent = '🌐 Translate';
      button.title = live ? 'Translate the pages on screen' : 'Translation of the pages on screen';
      button.classList.toggle('is-on', !!panel);
      button.setAttribute('aria-expanded', String(!!panel));
    }
    function note(text) { const p = document.createElement('p'); p.className = 'book-marks-empty'; p.textContent = text; body.appendChild(p); }
    // Pages on screen that still need a translation into lang.
    function request(lang) {
      if (!live) return;
      const have = get()[lang] || {}, want = {};
      options.visible().forEach(index => {
        const text = String((options.text && options.text(index)) || '').trim();
        if (text && !have[String(index)] && !pending[lang + ':' + index] && !asked[lang + ':' + index]) want[index] = text;
      });
      const indices = Object.keys(want);
      if (!indices.length) return;
      indices.forEach(i => { pending[lang + ':' + i] = true; asked[lang + ':' + i] = true; });
      failed = '';
      Promise.resolve().then(() => options.translate(want, lang)).then(done => {
        if (options.save) options.save(lang, done || {});
      }, cause => { failed = (cause && cause.message) || 'The translation failed.'; })
        .then(() => { indices.forEach(i => { delete pending[lang + ':' + i]; }); fill(); paint(); });
    }
    function fill() {
      if (!panel) return;
      const all = choices();
      if (!all.length) { close(); return; }
      if (all.indexOf(lang) < 0) lang = all.indexOf(options.preferred && options.preferred()) >= 0 ? options.preferred() : all[0];
      if (pick) {
        while (pick.firstChild) pick.removeChild(pick.firstChild);
        all.forEach(l => { const o = document.createElement('option'); o.value = l; o.textContent = self.NAMES[l]; pick.appendChild(o); });
        pick.value = lang; pick.hidden = all.length < 2;
      }
      while (body.firstChild) body.removeChild(body.firstChild);
      const pages = get()[lang] || {};
      let any = false, waiting = false;
      options.visible().forEach(index => {
        const text = pages[String(index)];
        const head = document.createElement('p'); head.className = 'book-translate-page';
        head.textContent = index === 0 ? 'Cover' : 'Page ' + (index + 1);
        if (!text) {
          if (live && pending[lang + ':' + index]) { body.appendChild(head); note('Translating…'); waiting = true; any = true; }
          else if (live && !String((options.text && options.text(index)) || '').trim()) { body.appendChild(head); note('This page has no text to translate.'); any = true; }
          else if (live && asked[lang + ':' + index] && !failed) { body.appendChild(head); note('No translation came back for this page. Turn the page or pick the language again to retry.'); any = true; }
          return;
        }
        any = true;
        body.appendChild(head);
        text.split(/\n+/).forEach(para => {
          if (!para.trim()) return;
          const p = document.createElement('p'); p.textContent = para.trim(); body.appendChild(p);
        });
      });
      if (failed && !waiting) note('⚠ ' + failed);
      else if (!any) note(live ? 'Translating…' : 'No translation for the pages on screen.');
      body.scrollTop = 0;
      if (!waiting && !failed) request(lang);
    }
    function close() { if (panel) { panel.remove(); panel = body = pick = null; } paint(); }
    function open() {
      panel = document.createElement('div');
      panel.className = 'book-translate'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Translation');
      ['pointerdown', 'mousedown', 'touchstart', 'wheel'].forEach(name => panel.addEventListener(name, event => event.stopPropagation()));
      const head = document.createElement('div'); head.className = 'book-translate-head';
      const title = document.createElement('p'); title.className = 'book-marks-title'; title.textContent = '🌐 Translation';
      pick = document.createElement('select'); pick.setAttribute('aria-label', 'Language');
      pick.onchange = () => { lang = pick.value; failed = ''; asked = {}; fill(); };
      const shut = document.createElement('button'); shut.type = 'button'; shut.className = 'book-podcast-close'; shut.textContent = '✕';
      shut.setAttribute('aria-label', 'Close translation'); shut.onclick = close;
      head.appendChild(title); head.appendChild(pick); head.appendChild(shut);
      body = document.createElement('div'); body.className = 'book-translate-body';
      panel.appendChild(head); panel.appendChild(body);
      document.body.appendChild(panel);
      failed = ''; asked = {};
      fill(); paint();
    }
    if (button) button.onclick = () => { if (panel) close(); else open(); };
    paint();
    return {
      open, close, active: () => !!panel,
      pageChanged() { failed = ''; asked = {}; fill(); },
      refresh() { if (panel) fill(); paint(); }
    };
  },
};

// Summary: an overview and key points of the book (written with AI in the
// editor, stored as summary {lang, text}), in a panel beside the book. ES2018.
(typeof self!=='undefined'?self:global).FlipbookSummary = {
  // Text → blocks: {kind: 'head' | 'para' | 'list', text | items}.
  blocks(text) {
    const out = [];
    String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
      const item = /^[-•*]\s+(.+)$/.exec(line);
      if (item) {
        const last = out[out.length - 1];
        if (last && last.kind === 'list') last.items.push(item[1]); else out.push({kind: 'list', items: [item[1]]});
      } else if (line.length <= 40 && !/[.!?]$/.test(line)) out.push({kind: 'head', text: line.replace(/:$/, '')});
      else out.push({kind: 'para', text: line});
    });
    return out;
  },
  /* options: {summary (object, or a function returning it), button} */
  bind(options) {
    const self = this;
    const get = () => (typeof options.summary === 'function' ? options.summary() : options.summary) || null;
    let panel = null, body = null;
    const button = options.button;
    function paint() {
      if (!button) return;
      const s = get();
      button.hidden = !(s && s.text && s.text.trim());
      button.textContent = '📋 Summary';
      button.title = 'Summary of this book';
      button.classList.toggle('is-on', !!panel);
      button.setAttribute('aria-expanded', String(!!panel));
    }
    function fill() {
      const s = get();
      if (!panel) return;
      if (!s) { close(); return; }
      while (body.firstChild) body.removeChild(body.firstChild);
      self.blocks(s.text).forEach(block => {
        if (block.kind === 'list') {
          const ul = document.createElement('ul');
          block.items.forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
          body.appendChild(ul);
        } else {
          const el = document.createElement('p');
          if (block.kind === 'head') el.className = 'book-translate-page';
          el.textContent = block.text; body.appendChild(el);
        }
      });
    }
    function close() { if (panel) { panel.remove(); panel = body = null; } paint(); }
    function open() {
      panel = document.createElement('div');
      panel.className = 'book-translate book-summary'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Summary');
      ['pointerdown', 'mousedown', 'touchstart', 'wheel'].forEach(name => panel.addEventListener(name, event => event.stopPropagation()));
      const head = document.createElement('div'); head.className = 'book-translate-head';
      const title = document.createElement('p'); title.className = 'book-marks-title'; title.textContent = '📋 Summary';
      const shut = document.createElement('button'); shut.type = 'button'; shut.className = 'book-podcast-close'; shut.textContent = '✕';
      shut.setAttribute('aria-label', 'Close summary'); shut.onclick = close;
      head.appendChild(title); head.appendChild(shut);
      body = document.createElement('div'); body.className = 'book-translate-body';
      panel.appendChild(head); panel.appendChild(body);
      document.body.appendChild(panel);
      fill(); paint();
    }
    if (button) button.onclick = () => { if (panel) close(); else open(); };
    paint();
    return {open, close, active: () => !!panel, refresh() { if (panel) fill(); paint(); }};
  },
};
