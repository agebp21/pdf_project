/* Optional, browser-local guided tour. Never uploads files or activates paid tools. */
(() => {
  'use strict';
  const key = 'mf-flipbook-guide-show';
  if (!document.getElementById('add-file')) return;
  const en = () => window.I18N && I18N.get() === 'en';
  const text = (id, english) => en() ? english : id;
  const steps = [
    ['#add-file', 'Tambah sumber', 'Add source', 'Klik Tambah sumber, lalu unggah dokumen, tempel tautan, atau pilih Google Drive. Pilih file untuk membuat buku. Anda dapat mencoba tombolnya saat panduan terbuka.', 'Click Add source, then upload a document, paste a link, or choose Google Drive. Select a file to make your book. You can try the button while the guide is open.'],
    ['#reader-stage', 'Pratinjau buku', 'Preview your book', 'Setelah dokumen selesai dimuat, buka sampul dan balik halaman dengan klik, usap, atau tombol panah. Langkah berikutnya tetap dapat dilihat tanpa membuka dokumen.', 'Once the document loads, open the cover and turn pages with a click, swipe, or arrow buttons. You can continue the guide without opening a document.'],
    ['.controls', 'Piranti membaca', 'Reading tools', 'Gunakan zoom, penanda, catatan, stabilo, dan layar penuh. Audio tersedia jika teks dokumen dapat dibaca. Beberapa tombol aktif setelah buku dimuat.', 'Use zoom, bookmarks, notes, highlighter, and full screen. Audio is available when the document has readable text. Some buttons activate after a book loads.'],
    ['#save-library', 'Simpan buku', 'Save your book', 'Setelah buku terbuka, gunakan Simpan ke Perpustakaan Saya untuk menyimpan buku. Jika belum ada buku, tombol ini membuka perpustakaan. Ketersediaan penyimpanan mengikuti paket akun.', 'With a book open, use Save My Library to save it. Without an open book, this button opens your library. Storage availability depends on your account plan.'],
    ['#export-fields', 'Bagikan atau ekspor', 'Share or export', 'Simpan proyek untuk dibuka kembali, atau pilih HTML, APK, dan EXE sesuai paket. Tombol Bagikan di bagian atas membuat tautan baca. Panduan ini tidak memulai ekspor atau pembayaran.', 'Save a project to reopen later, or choose HTML, APK, and EXE according to your plan. Share at the top creates a reading link. This guide does not start exports or payments.']
  ];
  let index = 0, popup, focus, observer, previousFocus, frame;
  let showOnOpen = true;
  try { showOnOpen = localStorage.getItem(key) !== 'false'; } catch (_) {}
  const blocked = () => [...document.querySelectorAll('[role="dialog"]')].some(el => {
    if (el === popup) return false;
    for (let node = el; node; node = node.parentElement) {
      if (node.hidden || getComputedStyle(node).display === 'none' || getComputedStyle(node).visibility === 'hidden') return false;
    }
    return true;
  });
  function position() {
    frame = null;
    if (!popup) return;
    const hidden = blocked() || !!document.fullscreenElement;
    popup.hidden = focus.hidden = hidden;
    if (hidden) return;
    const target = document.querySelector(steps[index][0]);
    const rect = target?.getBoundingClientRect();
    const available = rect && rect.width && rect.height && rect.bottom > 0 && rect.top < innerHeight;
    focus.hidden = !available;
    if (available) Object.assign(focus.style, {left: Math.max(0, rect.left - 3) + 'px', top: Math.max(0, rect.top - 3) + 'px', width: Math.min(rect.width + 6, innerWidth) + 'px', height: Math.min(rect.height + 6, innerHeight) + 'px'});
    const width = popup.offsetWidth, height = popup.offsetHeight;
    let left = available ? rect.right + 12 : (innerWidth - width) / 2;
    let top = available ? rect.top : 24;
    if (left + width > innerWidth - 12) {
      left = available ? rect.left : left;
      top = available && rect.bottom + 12 + height < innerHeight ? rect.bottom + 12 : Math.max(12, (available ? rect.top : 24) - height - 12);
    }
    popup.style.left = Math.max(12, Math.min(left, innerWidth - width - 12)) + 'px';
    popup.style.top = Math.max(12, Math.min(top, innerHeight - height - 12)) + 'px';
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(position); };
  function close() {
    if (!popup) return;
    observer?.disconnect();
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, true);
    document.removeEventListener('keydown', keys);
    popup.remove(); focus.remove(); popup = focus = null;
    if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true});
  }
  function keys(event) { if (event.key === 'Escape' && popup && !blocked()) { event.preventDefault(); close(); } }
  function paint(shouldFocus = true) {
    if (!popup) return;
    const step = steps[index];
    popup.replaceChildren();
    const progress = document.createElement('div'); progress.className = 'fg-progress'; progress.textContent = text('Langkah', 'Step') + ` ${index + 1} / ${steps.length}`;
    const heading = document.createElement('h2'); heading.id = 'fg-title'; heading.textContent = text(step[1], step[2]);
    const track = document.createElement('div'); track.className = 'fg-track'; track.setAttribute('aria-hidden', 'true');
    steps.forEach((_, n) => { const bar = document.createElement('span'); if(n <= index) bar.className = 'fg-done'; track.append(bar); });
    const body = document.createElement('p'); body.id = 'fg-body'; body.textContent = text(step[3], step[4]);
    const actions = document.createElement('div'); actions.className = 'fg-actions';
    const button = (label, action) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = action; actions.append(b); return b; };
    const back = button(text('Sebelumnya', 'Previous'), () => { index--; paint(); }); back.disabled = index === 0;
    button(text('Lewati', 'Skip'), close);
    const next = button(index === steps.length - 1 ? text('Selesai', 'Finish') : text('Berikutnya', 'Next'), () => { if (index === steps.length - 1) close(); else { index++; paint(); } });
    const preference = document.createElement('label'); preference.className = 'fg-preference';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = showOnOpen;
    checkbox.onchange = () => {
      showOnOpen = checkbox.checked;
      try { localStorage.setItem(key, String(showOnOpen)); } catch (_) {}
    };
    const preferenceText = document.createElement('span');
    preferenceText.textContent = text('Tampilkan tutorial saat membuka Flipbook', 'Show tutorial when opening Flipbook');
    preference.append(checkbox, preferenceText);
    popup.append(progress, track, heading, body, actions, preference);
    if (shouldFocus) {
      document.querySelector(step[0])?.scrollIntoView({block: 'nearest', inline: 'nearest'});
      next.focus({preventScroll: true});
    }
    schedule();
  }
  function start() {
    if (popup) return;
    previousFocus = document.activeElement; index = 0;
    focus = document.createElement('div'); focus.className = 'fg-focus'; focus.setAttribute('aria-hidden', 'true');
    popup = document.createElement('section'); popup.className = 'fg-popup'; popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-modal', 'false'); popup.setAttribute('aria-labelledby', 'fg-title'); popup.setAttribute('aria-describedby', 'fg-body');
    document.body.append(focus, popup);
    observer = new MutationObserver(changes => {
      if (changes.some(change => change.target !== focus && !popup?.contains(change.target))) schedule();
    });
    observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class']});
    window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true); document.addEventListener('keydown', keys);
    paint();
  }
  document.addEventListener('langchange', () => paint(false));
  if (showOnOpen) start();
})();
