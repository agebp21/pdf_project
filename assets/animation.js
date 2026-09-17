'use strict';
(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const duration = 3000;
  let elapsed = 0, lastTime = null, frame = 0, running = false, book;
  let values = [78, 62, 91], labels = ['Surya', 'Angin', 'Air'], total = 1250;
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const ease = (value) => 1 - Math.pow(1 - clamp(value), 3);
  function paint() {
    $$('.bar').forEach((bar, i) => {
      bar.style.height = values[i] + '%';
      bar.style.transform = `scaleY(${ease((elapsed - i * 180) / 1700)})`;
      $$('.bar-value')[i].textContent = Math.round(values[i] * ease((elapsed - i * 180) / 1700)) + '%';
    });
    $$('.process-step').forEach((step, i) => {
      const progress = ease((elapsed - i * 550) / 750);
      step.style.opacity = String(0.15 + progress * 0.85);
      step.style.transform = `translateY(${(1 - progress) * 15}px)`;
    });
    $$('.connector').forEach((line, i) => { line.style.transform = `scaleY(${ease((elapsed - 450 - i * 550) / 500)})`; });
    const progress = ease(elapsed / 2400);
    $('#counter').textContent = Math.round(total * progress).toLocaleString('id-ID');
    $('.ring-fill').style.strokeDashoffset = String(540.36 * (1 - progress));
    $('.sun').style.transform = `translate(-50%,-50%) rotate(${progress * 65}deg)`;
    $('#progress').style.width = clamp(elapsed / duration) * 100 + '%';
  }
  function setStatus() {
    $('#toggle').textContent = running ? 'Jeda' : elapsed >= duration ? 'Putar' : 'Lanjutkan';
    $('#motion-status').textContent = running ? 'Animasi berjalan' : elapsed >= duration ? 'Animasi selesai' : 'Animasi dijeda';
  }
  function tick(time) {
    if (!running) return;
    if (lastTime !== null) elapsed = Math.min(duration, elapsed + (time - lastTime) * Number($('#speed').value));
    lastTime = time;
    paint();
    if (elapsed < duration) frame = requestAnimationFrame(tick);
    else { running = false; setStatus(); }
  }
  function pause() { running = false; cancelAnimationFrame(frame); lastTime = null; setStatus(); }
  function play(restart = false, automatic = false) {
    pause();
    if (restart || elapsed >= duration) elapsed = 0;
    if (automatic && reducedMotion.matches) { elapsed = duration; paint(); setStatus(); return; }
    running = true; lastTime = null; paint(); setStatus(); frame = requestAnimationFrame(tick);
  }
  function updatePage() {
    const index = book.getCurrentPageIndex();
    const end = Math.min(4, index + (book.getOrientation() === 'landscape' ? 2 : 1));
    $('#page-status').textContent = `Halaman ${index + 1}${end > index + 1 ? '–' + end : ''} / 4`;
    $('#prev').disabled = index === 0;
    $('#next').disabled = end === 4;
    $$('.page').forEach((page, i) => { page.inert = i < index || i >= end; page.setAttribute('aria-hidden', String(page.inert)); });
  }
  $('#toggle').addEventListener('click', () => running ? pause() : play());
  $('#replay').addEventListener('click', () => play(true));
  $('#editor').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!$('#editor').reportValidity()) return;
    labels = [0, 1, 2].map(i => $('#label-' + i).value.trim() || 'Kategori ' + (i + 1));
    values = [0, 1, 2].map(i => Number($('#value-' + i).value));
    total = Number($('#stat').value);
    $('#chart-title').textContent = $('#book-title').value.trim() || 'Grafik energi';
    $$('.chart-label').forEach((label, i) => { label.textContent = labels[i]; label.setAttribute('aria-label', `${labels[i]}: ${values[i]} persen. Lihat detail`); });
    $('#chart-detail').textContent = 'Klik nama kategori untuk melihat nilainya.';
    $('#feedback').textContent = 'Data diterapkan. Grafik ada di halaman 2, statistik di halaman 4.';
    if (book) { book.turnToPage(1); updatePage(); }
    play(true);
  });
  $$('.chart-label').forEach(button => button.addEventListener('click', () => {
    const i = Number(button.dataset.detail);
    $('#chart-detail').textContent = `${labels[i]}: ${values[i]}% potensi pemanfaatan pada data contoh ini.`;
  }));
  const details = ['Amati: kumpulkan informasi dan pilih kebutuhan yang ingin diselesaikan.', 'Rancang: tentukan tujuan, langkah kerja, dan ukuran keberhasilannya.', 'Wujudkan: jalankan rencana, evaluasi hasil, lalu perbaiki secara bertahap.'];
  $$('.process-step').forEach(button => button.addEventListener('click', () => { $('#process-detail').textContent = details[Number(button.dataset.step)]; }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  try {
    book = new St.PageFlip($('#book'), {width:380, height:520, size:'stretch', minWidth:240, maxWidth:440, minHeight:328, maxHeight:603, showCover:false, usePortrait:true, autoSize:true, drawShadow:true, maxShadowOpacity:0.15, flippingTime:reducedMotion.matches ? 1 : 650, useMouseEvents:false, mobileScrollSupport:true, showPageCorners:false});
    book.on('flip', updatePage);
    book.on('changeOrientation', updatePage);
    book.on('changeState', event => {
      const idle = event.data === 'read';
      $('#prev').disabled = $('#next').disabled = !idle;
      if (idle) { updatePage(); play(true, true); } else pause();
    });
    book.loadFromHTML($$('.page'));
    $('#prev').addEventListener('click', () => book.flipPrev());
    $('#next').addEventListener('click', () => book.flipNext());
    updatePage(); play(true, true);
  } catch (error) {
    pause(); $('#error').hidden = false;
    $('#error').textContent = 'Buku gagal dimuat. Pastikan folder assets ikut disimpan, lalu muat ulang halaman.';
    $('#prev').disabled = $('#next').disabled = true;
    console.error(error);
  }
})();
