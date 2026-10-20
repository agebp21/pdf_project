'use strict';
// "Kompres PDF" right on its landing page (/kompres-pdf): pick a PDF and a target size,
// the browser compresses it (PDFCompress.compressTo) — nothing is uploaded. Guests can
// try it; taking the file needs an account, as in the converter.
(() => {
  const box = document.getElementById('quick-compress');
  if (!box || !window.PDFCompress) return;
  const $ = selector => box.querySelector(selector);
  const KB = 1024;
  const size = bytes => bytes >= 1024 * KB ? (bytes / (1024 * KB)).toLocaleString('id-ID', {maximumFractionDigits: 1}) + ' MB'
    : Math.max(1, Math.round(bytes / KB)) + ' KB';
  let file = null, bytes = null, target = Number($('.qc-preset[aria-pressed=true]').dataset.target), result = null, busy = false, url = '';

  function status(text, error) {
    $('.qc-status').textContent = text || '';
    $('.qc-status').classList.toggle('qc-error', !!error);
  }
  function bar(fraction) {
    $('.qc-bar').hidden = fraction == null;
    $('.qc-bar span').style.width = Math.round((fraction || 0) * 100) + '%';
  }
  async function run() {
    if (!bytes || busy) return;
    busy = true; result = null; $('.qc-result').hidden = true; bar(0);
    status(target ? `Mengecilkan ke maks ${size(target)}…` : 'Mengompres dengan kualitas terbaik…');
    try {
      const options = {onProgress: (message, fraction) => bar(fraction)};
      result = target ? await PDFCompress.compressTo(bytes.slice(), target, options)
                      : Object.assign(await PDFCompress.compress(bytes.slice(), 'low', options), {reached: true});
      show();
    } catch (cause) {
      status(cause.message && /could not be read/.test(cause.message) ? 'PDF ini tidak bisa dibaca (rusak atau dikunci kata sandi).' : 'Kompresi gagal: ' + cause.message, true);
    } finally { busy = false; bar(null); }
  }
  function show() {
    const before = bytes.byteLength, after = result.bytes.byteLength, saved = Math.round((1 - after / before) * 100);
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(new Blob([result.bytes], {type: 'application/pdf'}));
    const link = $('.qc-download');
    link.href = url; link.download = file.name.replace(/\.pdf$/i, '') + '-kecil.pdf';
    $('.qc-sizes').textContent = after < before ? `${size(before)} → ${size(after)} (hemat ${saved}%)` : `${size(before)} — sudah kecil`;
    status(result.reached
      ? (after < before ? 'Selesai. File siap diunduh.' : 'File ini sudah di bawah target, tidak perlu dikecilkan.')
      : `Belum bisa sampai ${size(target)}: PDF ini sebagian besar teks atau gambar vektor yang tidak bisa dikecilkan lagi. Ini hasil terkecilnya.`, !result.reached);
    $('.qc-result').hidden = false;
  }
  function choose(list) {
    const picked = [...list].find(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!picked) { status('Pilih file PDF.', true); return; }
    file = picked;
    $('.qc-file').textContent = `${file.name} · ${size(file.size)}`;
    file.arrayBuffer().then(buffer => { bytes = new Uint8Array(buffer); run(); });
  }
  $('.qc-input').addEventListener('change', event => { choose(event.target.files); event.target.value = ''; });
  const drop = $('.qc-drop');
  ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('qc-drag'); }));
  ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('qc-drag'); }));
  drop.addEventListener('drop', event => choose(event.dataTransfer.files));
  box.querySelectorAll('.qc-preset').forEach(button => button.addEventListener('click', () => {
    if (busy) return;
    box.querySelectorAll('.qc-preset').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    target = Number(button.dataset.target);
    run();
  }));
  // Taking the file needs an account (and a running trial or plan), like every tool.
  let granted = false;
  $('.qc-download').addEventListener('click', event => {
    if (granted || !window.MFAuth) { granted = false; return; }
    event.preventDefault();
    const take = () => { granted = true; $('.qc-download').click(); };
    window.MFAuth.me().then(data => {
      if (data.user || data.offline) {
        take();
      } else window.MFAuth.loginPopup(take);
    });
  });
  $('.qc-again').addEventListener('click', () => $('.qc-input').click());
})();
