// 3D hero: a laptop showing a flipbook that turns its own pages, with file and tool
// cards floating around it (three.js, loops). The static picture in the container stays
// until the first frame is drawn; no WebGL or "reduce motion" keeps the picture or draws
// one still frame. Rendering stops while the hero is off screen or the tab is hidden.
//
//   <div data-hero3d><img class="hero3d-fallback" …></div>
//   <script type="importmap">{"imports":{"three":"/assets/vendor/three/three.module.min.js"}}</script>
//   <script type="module" src="/assets/hero3d.js"></script>
const box = document.querySelector('[data-hero3d]');
const L = (en, id) => (window.I18N ? window.I18N.pick(en, id) : id);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function webgl() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}
// After the page itself has loaded (the hero never delays the first paint).
const idle = () => new Promise(resolve => {
  const go = () => (window.requestIdleCallback ? requestIdleCallback(resolve, {timeout: 1500}) : setTimeout(resolve, 200));
  document.readyState === 'complete' ? go() : addEventListener('load', go, {once: true});
});

if (box && webgl()) idle().then(start).catch(error => console.warn('hero3d:', error));

// ---------- canvas drawings (textures)
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function round(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function landscape(g, x, y, w, h, kind) {
  const skies = [['#cfe6f5', '#f4f8fb'], ['#f6c99a', '#fbe9d4'], ['#bfe0d0', '#eef6f1']];
  const [top, bottom] = skies[kind % 3];
  const sky = g.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, top); sky.addColorStop(1, bottom);
  g.save(); round(g, x, y, w, h, 6); g.clip();
  g.fillStyle = sky; g.fillRect(x, y, w, h);
  const ridge = (base, amp, color, seed) => {
    g.fillStyle = color; g.beginPath(); g.moveTo(x, y + h);
    for (let i = 0; i <= 12; i++) g.lineTo(x + w * i / 12, y + h * base - amp * h * Math.abs(Math.sin(i * 1.7 + seed)));
    g.lineTo(x + w, y + h); g.fill();
  };
  ridge(0.55, 0.32, kind === 1 ? '#c58a6a' : '#8fa8b8', 1);
  ridge(0.68, 0.22, kind === 1 ? '#8d5a48' : '#5f8a6a', 2.3);
  g.fillStyle = kind === 1 ? '#e8a26e' : '#7fb3c9'; g.fillRect(x, y + h * 0.74, w, h * 0.1);          // lake / sea
  g.fillStyle = kind === 2 ? '#2f6b4a' : '#3d7a52'; ridge(0.92, 0.12, g.fillStyle, 4.1);
  for (let i = 0; i < 9; i++) {                                                                          // trees
    const tx = x + w * (0.05 + i * 0.11), ty = y + h * (0.86 + (i % 3) * 0.03);
    g.fillStyle = '#24563b'; g.beginPath(); g.moveTo(tx, ty - h * 0.12); g.lineTo(tx - w * 0.025, ty); g.lineTo(tx + w * 0.025, ty); g.fill();
  }
  g.restore();
}

// The laptop screen: a reader app with thumbnails, an open book and page controls.
function screenPainter() {
  const [c, g] = canvas(1024, 640);
  const book = {x: 250, y: 70, w: 640, h: 440};
  const spine = book.x + book.w / 2;
  const pageW = book.w / 2;
  let spread = 0;
  const leftPage = (n, x, w) => {
    g.fillStyle = '#ffffff'; g.fillRect(x, book.y, w, book.h);
    if (n === 0) {
      g.fillStyle = '#1C1917'; g.font = 'italic 600 29px Georgia, serif';
      g.fillText(L('Explore', 'Jelajahi'), x + 40, book.y + 150);
      g.fillText(L('New Perspectives', 'Perspektif Baru'), x + 40, book.y + 188, w - 64);
      g.fillStyle = '#78716C'; g.font = '16px sans-serif';
      g.fillText(L('Your documents,', 'Dokumen Anda,'), x + 40, book.y + 236);
      g.fillText(L('now more engaging.', 'kini lebih hidup.'), x + 40, book.y + 258);
      g.fillStyle = '#9CA3AF'; g.fillRect(x + 40, book.y + 282, 46, 2);
    } else {
      g.fillStyle = '#1C1917'; g.font = '600 22px Georgia, serif'; g.fillText(L('Chapter ', 'Bab ') + (n + 1), x + 40, book.y + 70);
      g.fillStyle = '#D6D3CE';
      for (let i = 0; i < 13; i++) g.fillRect(x + 40, book.y + 100 + i * 22, w - 80 - (i % 4 === 3 ? 90 : 0), 7);
    }
  };
  const rightPage = (n, x, w) => { g.fillStyle = '#ffffff'; g.fillRect(x, book.y, w, book.h); landscape(g, x + 14, book.y + 14, w - 28, book.h - 28, n); };
  function draw(t) {          // t: 0..1 page turn (0 = still)
    g.fillStyle = '#f3f4f6'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, 34);
    g.fillStyle = '#9CA3AF'; g.font = '13px sans-serif'; g.fillText('MyFlipbook Pro', 18, 22);
    for (let i = 0; i < 5; i++) {                                                     // thumbnails
      const y = 60 + i * 96;
      g.fillStyle = i === (spread % 5) ? '#1A3C34' : '#E5E7EB'; g.fillRect(28, y - 3, 96, 76);
      g.fillStyle = '#ffffff'; g.fillRect(31, y, 90, 70);
      landscape(g, 36, y + 5, 80, 60, i);
    }
    g.save(); g.shadowColor = 'rgba(0,0,0,.18)'; g.shadowBlur = 24; g.shadowOffsetY = 8;
    g.fillStyle = '#fff'; g.fillRect(book.x, book.y, book.w, book.h); g.restore();
    leftPage(spread, book.x, pageW);
    rightPage(spread, spine, pageW);
    if (t > 0) {                                                                     // the turning page
      const angle = t * Math.PI, width = Math.cos(angle) * pageW;
      if (width > 0) {
        rightPage(spread + 1, spine, pageW);                                         // what is under it
        g.save(); g.beginPath(); g.rect(spine, book.y, width, book.h); g.clip(); rightPage(spread, spine, pageW); g.restore();
      } else {
        leftPage(spread + 1, spine + width, -width);
        rightPage(spread + 1, spine, pageW);
      }
      const shade = g.createLinearGradient(spine, 0, spine + width, 0);
      shade.addColorStop(0, 'rgba(0,0,0,.18)'); shade.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = shade; g.fillRect(Math.min(spine, spine + width), book.y, Math.abs(width), book.h);
    }
    const crease = g.createLinearGradient(spine - 18, 0, spine + 18, 0);
    crease.addColorStop(0, 'rgba(0,0,0,0)'); crease.addColorStop(0.5, 'rgba(0,0,0,.12)'); crease.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = crease; g.fillRect(spine - 18, book.y, 36, book.h);
    const page = 1 + spread * 2;
    g.fillStyle = '#374151'; g.font = '20px sans-serif'; g.textAlign = 'center';
    g.fillText(`‹      ${page} / 12      ›`, spine, 570); g.textAlign = 'left';
    g.strokeStyle = '#6B7280'; g.lineWidth = 2; g.strokeRect(940, 556, 18, 18);
  }
  return {canvas: c, draw, next() { spread = (spread + 1) % 5; }};
}

// A white card's face: an icon and a label (or a list of tools, or a little document).
function cardFace(kind) {
  const tall = kind === 'tools' || kind === 'report' || kind === 'proposal';
  const [c, g] = canvas(256, tall ? 352 : 256);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  const label = (text, y) => { g.fillStyle = '#374151'; g.font = '700 32px sans-serif'; g.textAlign = 'center'; g.fillText(text, 128, y); g.textAlign = 'left'; };
  const doc = (x, y, w, h, color) => {
    g.fillStyle = color; g.beginPath(); g.moveTo(x, y + 10); g.quadraticCurveTo(x, y, x + 10, y);
    g.lineTo(x + w - 26, y); g.lineTo(x + w, y + 26); g.lineTo(x + w, y + h - 10); g.quadraticCurveTo(x + w, y + h, x + w - 10, y + h);
    g.lineTo(x + 10, y + h); g.quadraticCurveTo(x, y + h, x, y + h - 10); g.fill();
    g.fillStyle = 'rgba(255,255,255,.45)'; g.beginPath(); g.moveTo(x + w - 26, y); g.lineTo(x + w - 26, y + 26); g.lineTo(x + w, y + 26); g.fill();
  };
  if (kind === 'pdf') { doc(78, 40, 100, 124, '#DC2626'); g.fillStyle = '#fff'; g.font = '800 34px sans-serif'; g.textAlign = 'center'; g.fillText('PDF', 128, 118); g.textAlign = 'left'; label('PDF', 214); }
  if (kind === 'image') { landscape(g, 70, 52, 116, 96, 2); g.fillStyle = '#FBBF24'; g.beginPath(); g.arc(160, 74, 11, 0, 7); g.fill(); label(L('Image', 'Gambar'), 214); }
  if (kind === 'ppt') { doc(78, 40, 100, 124, '#EA580C'); g.fillStyle = '#fff'; g.font = '800 54px sans-serif'; g.textAlign = 'center'; g.fillText('P', 128, 124); g.textAlign = 'left'; label('PPT', 214); }
  if (kind === 'other') {
    doc(80, 40, 96, 120, '#E5E7EB'); g.fillStyle = '#9CA3AF';
    for (let i = 0; i < 4; i++) g.fillRect(98, 82 + i * 16, 60 - (i === 3 ? 22 : 0), 6);
    label(L('Other files', 'File lain'), 214);
  }
  if (kind === 'tools') {
    const rows = [[L('Merge PDF', 'Gabung PDF'), '⧉'], [L('Split PDF', 'Pisah PDF'), '◫'], [L('Convert PDF', 'Konversi PDF'), '⟳']];
    rows.forEach(([text, icon], i) => {
      const y = 40 + i * 104;
      g.fillStyle = '#1A3C34'; g.font = '34px sans-serif'; g.fillText(icon, 26, y + 52);
      g.fillStyle = '#374151'; g.font = '600 22px sans-serif'; g.fillText(text, 70, y + 48, 150);
      g.fillStyle = '#9CA3AF'; g.fillText('→', 226, y + 48);
      if (i < 2) { g.fillStyle = '#F3F4F6'; g.fillRect(24, y + 86, 208, 2); }
    });
  }
  if (kind === 'report' || kind === 'proposal') {
    g.fillStyle = '#1F2937'; g.font = 'italic 600 24px Georgia, serif';
    g.fillText(kind === 'report' ? L('Annual Report', 'Laporan Tahunan') : L('Business Proposal', 'Proposal Bisnis'), 24, 48);
    g.fillStyle = '#E5E7EB'; for (let i = 0; i < 4; i++) g.fillRect(24, 70 + i * 18, 208 - (i === 3 ? 70 : 0), 6);
    if (kind === 'report') landscape(g, 24, 160, 208, 160, 0);
    else {
      g.fillStyle = '#CBD5E1'; g.fillRect(24, 160, 208, 160);
      g.fillStyle = '#64748B'; g.fillRect(60, 196, 140, 124);
      g.fillStyle = '#E2E8F0'; for (let r = 0; r < 5; r++) for (let k = 0; k < 6; k++) g.fillRect(70 + k * 21, 206 + r * 22, 13, 14);
    }
  }
  return c;
}
function keyboardTexture() {
  const [c, g] = canvas(1024, 700);
  g.fillStyle = '#c9ced4'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#2b2f35';
  for (let r = 0; r < 5; r++) for (let k = 0; k < 14; k++) { round(g, 70 + k * 63, 40 + r * 62, 54, 52, 7); g.fill(); }
  round(g, 260, 360, 504, 52, 7); g.fill();
  g.fillStyle = '#bcc2c9'; round(g, 330, 450, 364, 220, 16); g.fill();                      // trackpad
  return c;
}
function shadowTexture() {
  const [c, g] = canvas(256, 256);
  const r = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  r.addColorStop(0, 'rgba(28,25,23,.32)'); r.addColorStop(1, 'rgba(28,25,23,0)');
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  return c;
}

// ---------- the scene
async function start() {
  const THREE = await import('three');
  const {RoomEnvironment} = await import('/assets/vendor/three/RoomEnvironment.js');
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, powerPreference: 'low-power'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.className = 'hero3d-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  box.append(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(3, 6, 5); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe8efe6, 0.6));
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const look = new THREE.Vector3(0.1, 1.55, 0);           // moved by fit() so the set sits in the box
  const LIFT = 0.95;                                        // the camera looks down a little

  const texture = (source, srgb = true) => { const t = new THREE.CanvasTexture(source); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  // A flat rounded slab (depth along z) whose front face shows `map` across its whole size.
  function slab(w, h, depth, radius, material, front) {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + radius, y); s.lineTo(x + w - radius, y); s.quadraticCurveTo(x + w, y, x + w, y + radius);
    s.lineTo(x + w, y + h - radius); s.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    s.lineTo(x + radius, y + h); s.quadraticCurveTo(x, y + h, x, y + h - radius);
    s.lineTo(x, y + radius); s.quadraticCurveTo(x, y, x + radius, y);
    const geometry = new THREE.ExtrudeGeometry(s, {depth, bevelEnabled: true, bevelThickness: depth * 0.3, bevelSize: Math.min(radius * 0.4, depth * 0.5), bevelSegments: 3, curveSegments: 8});
    geometry.translate(0, 0, -depth / 2);
    if (front) {                        // shape coordinates → 0..1 so the picture fills the face
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - x) / w, (uv.getY(i) - y) / h);
    }
    return new THREE.Mesh(geometry, front ? [front, material] : material);
  }

  // Laptop
  const metal = new THREE.MeshStandardMaterial({color: 0xd5dae0, metalness: 0.75, roughness: 0.32});
  const laptop = new THREE.Group();
  const base = slab(3.3, 2.25, 0.07, 0.12, metal); base.rotation.x = -Math.PI / 2; laptop.add(base);
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.98), new THREE.MeshStandardMaterial({map: texture(keyboardTexture()), metalness: 0.4, roughness: 0.55}));
  keys.rotation.x = -Math.PI / 2; keys.position.set(0, 0.066, 0.02); laptop.add(keys);
  const hinge = new THREE.Group(); hinge.position.set(0, 0.06, -1.1); hinge.rotation.x = -0.32; laptop.add(hinge);
  const lid = slab(3.3, 2.15, 0.05, 0.12, metal); lid.position.set(0, 1.075, -0.02); hinge.add(lid);
  const bezel = new THREE.Mesh(new THREE.PlaneGeometry(3.22, 2.07), new THREE.MeshStandardMaterial({color: 0x15171a, roughness: 0.25, metalness: 0.2}));
  bezel.position.set(0, 1.075, 0.026); hinge.add(bezel);
  const screen = screenPainter(); screen.draw(0);
  const screenMap = texture(screen.canvas);
  const display = new THREE.Mesh(new THREE.PlaneGeometry(3.06, 1.91), new THREE.MeshBasicMaterial({map: screenMap, toneMapped: false}));
  display.position.set(0, 1.09, 0.028); hinge.add(display);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.6), new THREE.MeshBasicMaterial({map: texture(shadowTexture()), transparent: true, depthWrite: false}));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.02;
  const stage = new THREE.Group(); stage.add(laptop, shadow); stage.rotation.y = -0.38; scene.add(stage);

  // Floating cards
  const white = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.6, metalness: 0, emissive: 0xf4f4f2, emissiveIntensity: 0.35});
  // Spaced so no two cards meet on screen at any size (top arc, one card left, two stacked right).
  const layout = [
    ['pdf', [-1.75, 2.8, 0.1], 0.74], ['image', [-0.6, 3.1, -0.2], 0.68], ['ppt', [0.55, 3.05, -0.2], 0.68], ['other', [1.65, 2.8, -0.1], 0.64],
    ['report', [-2.7, 1.35, 0.6], 0.82], ['proposal', [2.9, 1.95, 0.4], 0.78], ['tools', [2.8, 0.4, 1.3], 0.9],
  ];
  const cards = layout.map(([kind, at, size], i) => {
    const face = cardFace(kind), aspect = face.height / face.width;
    // The face is unlit (crisp white paper, like a screen-printed card); the edges catch the light.
    const card = slab(size, size * aspect, 0.035, 0.08, white, new THREE.MeshBasicMaterial({map: texture(face), toneMapped: false}));
    card.position.set(...at);
    card.userData = {kind, home: new THREE.Vector3(...at), phase: i * 1.3, tilt: (i % 2 ? 1 : -1) * 0.12};
    scene.add(card);
    return card;
  });
  // Card faces and the screen follow the site's language.
  document.addEventListener('langchange', () => {
    cards.forEach(card => { const map = card.material[0].map; map.image = cardFace(card.userData.kind); map.needsUpdate = true; });
    screen.draw(0); screenMap.needsUpdate = true; render(clock.getElapsedTime());
  });

  // Pointer parallax (only while the pointer is over the hero).
  const aim = {x: 0, y: 0}, eased = {x: 0, y: 0};
  box.addEventListener('pointermove', event => {
    const r = box.getBoundingClientRect();
    aim.x = ((event.clientX - r.left) / r.width - 0.5) * 2; aim.y = ((event.clientY - r.top) / r.height - 0.5) * 2;
  });
  box.addEventListener('pointerleave', () => { aim.x = aim.y = 0; });

  function resize() {
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Narrow boxes (phones) draw the cards in a little; then the camera is placed to fit.
    camera.userData.spread = camera.aspect < 1 ? 0.72 : 0.9;
    camera.updateProjectionMatrix();
    fit();
  }
  new ResizeObserver(() => { resize(); render(clock.getElapsedTime()); }).observe(box);

  // Measure the set (laptop and cards at rest) on screen and place the camera so it fills the
  // box without touching the edges, leaving the bottom strip for the pills.
  const FRAME = {left: -0.94, right: 0.94, top: 0.92, bottom: -0.62};
  function extents(distance) {
    camera.position.set(0, look.y + LIFT, distance); camera.lookAt(look); camera.updateMatrixWorld();
    const out = {left: 1e9, right: -1e9, top: -1e9, bottom: 1e9}, v = new THREE.Vector3();
    for (const object of [laptop, ...cards]) {        // not the soft shadow: it may run past the edges
      const b = new THREE.Box3().setFromObject(object);
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera);
        out.left = Math.min(out.left, v.x); out.right = Math.max(out.right, v.x); out.top = Math.max(out.top, v.y); out.bottom = Math.min(out.bottom, v.y);
      }
    }
    return out;
  }
  function fit() {
    const spread = camera.userData.spread;
    cards.forEach(card => { card.position.copy(card.userData.home).setX(card.userData.home.x * spread); card.rotation.set(0, 0, card.userData.tilt); });
    stage.rotation.y = -0.38; laptop.position.y = 0;
    let distance = 9;
    for (let round = 0; round < 3; round++) {
      let near = 4, far = 60;
      for (let i = 0; i < 30; i++) {
        const mid = (near + far) / 2, e = extents(mid);
        const fits = e.left >= FRAME.left && e.right <= FRAME.right && e.top <= FRAME.top && e.bottom >= FRAME.bottom;
        if (fits) far = mid; else near = mid;
      }
      distance = far * 1.03;                         // room for the bobbing and the parallax
      const e = extents(distance), offset = (e.top + e.bottom) / 2 - (FRAME.top + FRAME.bottom) / 2;
      look.y += offset * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));   // centre the set in the frame
    }
    camera.userData.distance = distance;
  }

  const clock = new THREE.Clock();
  const TURN_EVERY = 4.2, TURN_TIME = 1.1;
  let lastTurn = 0;
  function render(t) {
    eased.x += (aim.x - eased.x) * 0.05; eased.y += (aim.y - eased.y) * 0.05;
    const d = camera.userData.distance || 8.4, spread = camera.userData.spread || 0.9;
    camera.position.set(eased.x * 0.9, look.y + LIFT - eased.y * 0.5, d);
    camera.lookAt(look);
    stage.rotation.y = -0.38 + Math.sin(t * 0.35) * 0.1;
    laptop.position.y = Math.sin(t * 0.8) * 0.04;
    cards.forEach(card => {
      const {home, phase, tilt} = card.userData;
      card.position.set(home.x * spread, home.y + Math.sin(t * 0.9 + phase) * 0.09, home.z);
      card.rotation.set(Math.sin(t * 0.6 + phase) * 0.05, -0.25 * Math.sign(home.x) + Math.sin(t * 0.5 + phase) * 0.08, tilt + Math.sin(t * 0.7 + phase) * 0.03);
    });
    // The page turn: drawn on the screen canvas only while it moves.
    if (!reduced) {
      const since = t - lastTurn;
      if (since > TURN_EVERY) {
        const p = Math.min(1, (since - TURN_EVERY) / TURN_TIME);
        screen.draw(p < 1 ? p * p * (3 - 2 * p) : 0);
        if (p >= 1) { screen.next(); screen.draw(0); lastTurn = t; }
        screenMap.needsUpdate = true;
      }
    }
    renderer.render(scene, camera);
  }

  resize();
  render(0);
  box.classList.add('hero3d-ready');                  // CSS fades the canvas in, the picture out
  if (reduced) return;                                // one still frame
  let visible = true, running = false;
  const loop = () => {
    if (!visible || document.hidden) { running = false; return; }
    render(clock.getElapsedTime());
    requestAnimationFrame(loop);
  };
  const wake = () => { if (!running && visible && !document.hidden) { running = true; requestAnimationFrame(loop); } };
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; wake(); }).observe(box);
  document.addEventListener('visibilitychange', wake);
  wake();
}
