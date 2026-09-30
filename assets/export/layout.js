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
      const clean = n => (n && typeof n.text === 'string' && n.text.trim() ? {text: n.text.slice(0, max), updated: Number(n.updated) || 0} : null);
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
  /* options: {key, title, pages (elements), goPage(i), open (button),
     bookmark(index, on) → true when it changed the page's bookmark} */
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
        tab.style.setProperty('--tab', self.COLORS[n % self.COLORS.length]);
        tab.title = label(index) + ' · note ' + (n + 1) + ': ' + note.text.replace(/\s+/g, ' ').slice(0, 80);
        tab.setAttribute('aria-label', 'Note ' + (n + 1) + ' on ' + label(index));
        if (reader && reader.page === index && reader.item === n) tab.classList.add('is-open');
        stack.appendChild(tab);
      });
      if (items.length < self.PER_PAGE) {
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
    function store(index, item, text) {
      const entry = notes[index] || {items: [], marked: false};
      const had = entry.items.length;
      if (text.trim()) {
        const note = {text: text.slice(0, self.MAX), updated: Date.now()};
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
      box.style.setProperty('--tab', self.COLORS[item % self.COLORS.length]);
      guard(box);
      const head = document.createElement('p'); head.className = 'book-note-card-title'; head.textContent = label(index) + ' · note ' + (item + 1);
      const body = document.createElement('div'); body.className = 'book-note-card-text'; body.textContent = note.text;
      const row = document.createElement('div'); row.className = 'book-note-actions';
      row.appendChild(button('🗑 Delete', 'book-note-delete', () => { closeReader(); store(index, item, ''); }));
      row.appendChild(button('✎ Edit', 'book-note-done', () => { closeReader(); edit(index, item); }));
      box.appendChild(head); box.appendChild(body); box.appendChild(row);
      document.body.appendChild(box);
      // Beside the tab, on the page side, kept on screen.
      const t = tab.getBoundingClientRect(), width = Math.min(300, window.innerWidth - 24);
      const onRight = t.left + t.width / 2 > window.innerWidth / 2;
      let left = onRight ? t.left - width - 8 : t.right + 8;
      left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
      box.style.width = width + 'px'; box.style.left = left + 'px';
      box.style.top = Math.max(12, Math.min(t.top, window.innerHeight - box.offsetHeight - 12)) + 'px';
      reader = {page: index, item, box};
      tabs(index);
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
        empty.textContent = 'No notes yet. Tap ✎ on the edge of a page to write one.';
        list.appendChild(empty); return;
      }
      keys.forEach(index => notes[index].items.forEach((note, n) => {
        const row = document.createElement('div'); row.className = 'book-mark';
        const go = document.createElement('button'); go.type = 'button'; go.className = 'book-mark-go book-note-row';
        const name = document.createElement('b'); name.textContent = label(index) + (notes[index].items.length > 1 ? ' · ' + (n + 1) : '');
        const snippet = document.createElement('span'); snippet.textContent = note.text.replace(/\s+/g, ' ').slice(0, 90);
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
    return {refresh, text, editing: () => !!editing, close() { closeEditor(); closeReader(); closeList(); }, notes: () => JSON.parse(JSON.stringify(notes))};
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
    brush: '<svg class="book-hl-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.6 17.9 3.9 15"/><path d="M18.4 2.6a1 1 0 1 1 3 3l-4 4a.5.5 0 0 0 0 .7l.9.9a2.4 2.4 0 0 1 0 3.4l-.9.9a.5.5 0 0 1-.7 0L8.4 7.3a.5.5 0 0 1 0-.7l.9-.9a2.4 2.4 0 0 1 3.4 0l.9.9a.5.5 0 0 0 .7 0z"/><path d="M9 8c-1.8 2.7-4 3.5-6.6 3.9a.5.5 0 0 0-.3.8l7.3 8.9a1 1 0 0 0 1.2.2C12.7 20.4 16 16.8 16 15"/></svg>',
    eraser: '<svg class="book-hl-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 21H8a2 2 0 0 1-1.4-.6l-4-4a2 2 0 0 1 0-2.8l10-10a2 2 0 0 1 2.8 0l6 6a2 2 0 0 1 0 2.8L12.8 21"/><path d="m5.1 11.1 8.8 8.8"/></svg>'
  },
  COLORS: {y: '#ffd43b', g: '#69db7c', p: '#f783ac', b: '#4dabf7'},
  NAMES: {y: 'Yellow', g: 'Green', p: 'Pink', b: 'Blue'},
  key(title, pageCount, ratio) {
    return FlipbookBookmarks.key(title, pageCount, ratio).replace('mf-bookmarks:', 'mf-highlights:');
  },
  // Stored lines [y, h, x0, w0, ...] (1/10000) → fractions.
  lines(raw) {
    return (raw || []).map(l => {
      const words = [];
      for (let i = 2; i + 1 < l.length; i += 2) words.push({x: l[i] / 1e4, w: l[i + 1] / 1e4});
      return {y: l[0] / 1e4, h: l[1] / 1e4, words};
    }).filter(l => l.words.length);
  },
  // The word at/near point p. strict: null when p is not on text (so a
  // drag that starts in a margin draws a box instead).
  locate(lines, p, strict) {
    let best = -1, distance = Infinity;
    lines.forEach((l, i) => {
      const d = p.y < l.y ? l.y - p.y : p.y > l.y + l.h ? p.y - (l.y + l.h) : 0;
      if (d < distance) { distance = d; best = i; }
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
  // Rectangles [x, y, w, h] covering the words from a to b in reading order,
  // one per line (split at wide column gaps); null when a is not on text.
  select(lines, a, b) {
    let s = this.locate(lines, a, true);
    if (!s) return null;
    let e = this.locate(lines, b, false);
    if (e.line < s.line || (e.line === s.line && e.word < s.word)) { const t = s; s = e; e = t; }
    const rects = [], r = v => Math.round(v * 10000) / 10000;
    for (let li = s.line; li <= e.line; li++) {
      const line = lines[li], from = li === s.line ? s.word : 0, to = li === e.line ? e.word : line.words.length - 1;
      let seg = null;
      for (let wi = from; wi <= to; wi++) {
        const w = line.words[wi];
        if (seg && w.x - (seg.x + seg.w) > line.h * 2.5) { rects.push([r(seg.x), r(line.y), r(seg.w), r(line.h)]); seg = null; }
        if (!seg) seg = {x: w.x, w: w.w}; else seg.w = w.x + w.w - seg.x;
      }
      if (seg) rects.push([r(seg.x), r(line.y), r(seg.w), r(line.h)]);
    }
    return rects;
  },
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
  /* options: {key, pages (elements), words ({page: lines}), button} */
  bind(options) {
    const self = this, pages = options.pages, words = options.words || {};
    let store = self.load(options.key), mode = false, selected = null, drag = null, erasing = false;
    let color = 'y';
    try { const saved = localStorage.getItem('mf-highlight-color'); if (self.COLORS[saved]) color = saved; } catch (e) {}
    const lineCache = {};
    const linesOf = index => (lineCache[index] || (lineCache[index] = self.lines(words[String(index)])));
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
        if (selected) { store[selected.page][selected.index].c = c; persist(selected.page); }
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
    // Brush: back to highlighting (the colour dots pick its colour).
    const brush = document.createElement('button'); brush.type = 'button'; brush.className = 'book-hl-brush';
    brush.innerHTML = self.ICONS.brush; brush.title = 'Brush: drag over text to highlight'; brush.setAttribute('aria-label', 'Brush');
    brush.onclick = () => { erasing = false; paintBar(); };
    const tools = document.createElement('div'); tools.className = 'book-hl-tools';
    tools.appendChild(brush); tools.appendChild(eraser);
    bar.insertBefore(tools, bar.firstChild);
    const done = document.createElement('button'); done.type = 'button'; done.className = 'book-hl-done'; done.textContent = 'Done';
    done.onclick = () => setMode(false);
    bar.appendChild(hint); bar.appendChild(remove); bar.appendChild(done);
    document.body.appendChild(bar);
    function paintBar() {
      Object.keys(swatches).forEach(c => swatches[c].setAttribute('aria-pressed', String(!erasing && (selected ? store[selected.page][selected.index].c === c : c === color))));
      eraser.setAttribute('aria-pressed', String(erasing));
      brush.setAttribute('aria-pressed', String(!erasing));
      brush.style.setProperty('--hl-color', self.COLORS[selected ? store[selected.page][selected.index].c : color]);
      document.body.classList.toggle('is-erasing', mode && erasing);
      remove.hidden = !selected;
      hint.textContent = erasing ? 'Drag over highlights to erase them' : selected ? 'Pick a colour or delete' : 'Drag over text to highlight';
      bar.title = hint.textContent;
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
        const before = (store[index] || []).length, left = self.erase(store[index] || [], region);
        if (left.length !== before) {
          if (left.length) store[index] = left; else delete store[index];
          persist(index);
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
      if (options.button) { options.button.setAttribute('aria-pressed', String(on)); options.button.classList.toggle('is-on', on); }
      if (on) document.addEventListener('keydown', escape);
      else {
        document.removeEventListener('keydown', escape);
        if (selected) { const page = selected.page; selected = null; render(page); }
        erasing = false;
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
      close() { setMode(false); bar.remove(); },
      store: () => JSON.parse(JSON.stringify(store)),
    };
  },
};

// Magnifier ("kaca pembesar"): a round lens with a handle, dragged over the
// book. It shows the page images under it, magnified from their full
// resolution. Tap the glass: 2x -> 3x -> 4x; wheel over it: any level.
(typeof self!=='undefined'?self:global).FlipbookLoupe = {
  LEVELS: [2, 3, 4],
  MIN: 1.5,
  MAX: 6,
  // Where an object-fit:contain image actually sits inside its box.
  fit(naturalWidth, naturalHeight, box) {
    if (!naturalWidth || !naturalHeight || !box.width || !box.height) return null;
    const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
    const width = naturalWidth * scale, height = naturalHeight * scale;
    return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width: width, height: height };
  },
  // One CSS background layer showing `rect` (client coords) magnified by
  // `zoom` inside a lens of radius r centred on (x, y).
  layer(rect, x, y, r, zoom) {
    return {
      size: (rect.width * zoom).toFixed(1) + 'px ' + (rect.height * zoom).toFixed(1) + 'px',
      position: (r - (x - rect.left) * zoom).toFixed(1) + 'px ' + (r - (y - rect.top) * zoom).toFixed(1) + 'px'
    };
  },
  touches(rect, x, y, r) {
    return rect.width > 0 && rect.left < x + r && rect.left + rect.width > x - r && rect.top < y + r && rect.top + rect.height > y - r;
  },
  next(zoom) {
    const levels = this.LEVELS;
    for (let i = 0; i < levels.length; i++) if (levels[i] > zoom + 0.05) return levels[i];
    return levels[0];
  },
  /* options: {pages: page elements (each holding an <img>), button} */
  bind(options) {
    const self = this, pages = options.pages || [];
    let on = false, zoom = self.LEVELS[0], x = 0, y = 0, r = 90, frame = 0, drag = null;
    const make = (tag, className, parent) => { const n = document.createElement(tag); n.className = className; if (parent) parent.appendChild(n); return n; };
    const lens = make('div', 'book-loupe');
    lens.hidden = true;
    lens.setAttribute('role', 'img'); lens.setAttribute('aria-label', 'Magnifier');
    const handle = make('div', 'book-loupe-handle', lens);
    const glass = make('div', 'book-loupe-glass', lens);
    const level = make('span', 'book-loupe-level', lens);
    const close = make('button', 'book-loupe-close', lens);
    close.type = 'button'; close.textContent = '✕'; close.title = 'Close magnifier'; close.setAttribute('aria-label', 'Close magnifier');
    document.body.appendChild(lens);
    function place() {
      const width = window.innerWidth, height = window.innerHeight;
      r = Math.round(Math.max(60, Math.min(110, Math.min(width, height) * 0.2)));
      x = Math.max(8, Math.min(width - 8, x)); y = Math.max(8, Math.min(height - 8, y));
      lens.style.width = lens.style.height = 2 * r + 'px';
      lens.style.left = (x - r) + 'px'; lens.style.top = (y - r) + 'px';
      handle.style.height = Math.round(r * 0.95) + 'px';
      handle.style.transform = 'rotate(-45deg) translateY(' + (r - 2) + 'px)';
      level.textContent = (Math.round(zoom * 10) / 10) + '×';
    }
    function paint() {
      const images = [], sizes = [], positions = [];
      for (let i = pages.length - 1; i >= 0; i--) {
        const page = pages[i], box = page.getBoundingClientRect();
        if (!self.touches(box, x, y, r)) continue;
        const img = page.querySelector('img');
        const shown = img && img.complete && img.naturalWidth ? self.fit(img.naturalWidth, img.naturalHeight, img.getBoundingClientRect()) : null;
        if (shown && self.touches(shown, x, y, r)) {
          const part = self.layer(shown, x, y, r, zoom);
          images.push('url("' + (img.currentSrc || img.src).replace(/"/g, '%22') + '")'); sizes.push(part.size); positions.push(part.position);
        }
        // The white sheet behind the image.
        const sheet = self.layer(box, x, y, r, zoom);
        images.push('linear-gradient(#fff,#fff)'); sizes.push(sheet.size); positions.push(sheet.position);
      }
      glass.style.backgroundImage = images.join(',') || 'none';
      glass.style.backgroundSize = sizes.join(',');
      glass.style.backgroundPosition = positions.join(',');
    }
    // Pages turn and zoom under the lens: repaint every frame while it is out.
    function loop() { paint(); frame = requestAnimationFrame(loop); }
    function escape(event) { if (event.key === 'Escape') set(false); }
    function set(next) {
      on = next;
      lens.hidden = !on;
      document.body.classList.toggle('is-magnifying', on);
      if (options.button) { options.button.setAttribute('aria-pressed', String(on)); options.button.classList.toggle('is-on', on); }
      cancelAnimationFrame(frame);
      if (on) {
        // Start over the middle of the book (or the screen).
        const shown = pages.map(p => p.getBoundingClientRect()).filter(b => b.width > 0);
        if (shown.length) {
          const left = Math.min.apply(null, shown.map(b => b.left)), right = Math.max.apply(null, shown.map(b => b.left + b.width));
          const top = Math.min.apply(null, shown.map(b => b.top)), bottom = Math.max.apply(null, shown.map(b => b.top + b.height));
          x = (left + right) / 2; y = (top + bottom) / 2;
        } else { x = window.innerWidth / 2; y = window.innerHeight / 2; }
        place(); loop();
        document.addEventListener('keydown', escape);
      } else document.removeEventListener('keydown', escape);
    }
    // Nothing on the lens reaches the book underneath (no page turns).
    ['mousedown', 'touchstart', 'click', 'dblclick'].forEach(name => lens.addEventListener(name, event => event.stopPropagation()));
    lens.addEventListener('pointerdown', event => {
      if (event.target === close || (event.button !== undefined && event.button > 0)) return;
      event.stopPropagation(); if (event.cancelable) event.preventDefault();
      drag = { id: event.pointerId, dx: event.clientX - x, dy: event.clientY - y, sx: event.clientX, sy: event.clientY, moved: false, glass: event.target === glass || event.target === level };
      try { lens.setPointerCapture(event.pointerId); } catch (e) {}
    });
    lens.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      event.stopPropagation(); if (event.cancelable) event.preventDefault();
      if (Math.abs(event.clientX - drag.sx) + Math.abs(event.clientY - drag.sy) > 6) drag.moved = true;
      x = event.clientX - drag.dx; y = event.clientY - drag.dy; place();
    });
    function release(event) {
      if (!drag || event.pointerId !== drag.id) return;
      event.stopPropagation();
      if (!drag.moved && drag.glass && event.type === 'pointerup') { zoom = self.next(zoom); place(); }
      drag = null;
    }
    lens.addEventListener('pointerup', release);
    lens.addEventListener('pointercancel', release);
    lens.addEventListener('wheel', event => {
      event.stopPropagation(); if (event.cancelable) event.preventDefault();
      zoom = Math.max(self.MIN, Math.min(self.MAX, zoom * Math.exp(-event.deltaY * 0.002))); place();
    }, { passive: false });
    close.onclick = event => { event.stopPropagation(); set(false); };
    function resize() { if (on) place(); }
    window.addEventListener('resize', resize);
    if (options.button) {
      options.button.textContent = '🔎';
      options.button.title = 'Magnifier (drag it over the page)';
      options.button.setAttribute('aria-label', 'Magnifier');
      options.button.setAttribute('aria-pressed', 'false');
      options.button.onclick = () => set(!on);
    }
    return {
      active: () => on, set,
      zoom: () => zoom,
      close() { set(false); window.removeEventListener('resize', resize); lens.remove(); }
    };
  },
};
