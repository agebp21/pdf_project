'use strict';
// Document templates for the PDF editor (editor.html): skripsi, journal article, report.
// Each is a cover / title page (fixed text blocks) and a typed body that flows over pages,
// its headings set as Heading 1 / 2 (so Insert → Table of contents finds them).
// EditorTemplates.make(id, [W, H]) -> {name, margin, cover: [elements], body: {text, html}}.
(() => {
  const H1 = t => `<span style="font-weight:bold;font-size:2em">${t}</span>`;
  const H2 = t => `<span style="font-weight:bold;font-size:1.5em">${t}</span>`;
  const NOTE = t => `<span style="color:#78716c">${t}</span>`;
  const LIST = [
    {id: 'skripsi', name: ['Thesis (skripsi)', 'Skripsi'], hint: ['Cover, foreword, chapters I–V, references', 'Sampul, kata pengantar, BAB I–V, daftar pustaka']},
    {id: 'jurnal', name: ['Journal article', 'Artikel jurnal'], hint: ['Title, authors, abstract, IMRaD sections', 'Judul, penulis, abstrak, bagian IMRaD']},
    {id: 'laporan', name: ['Report', 'Laporan'], hint: ['Cover, foreword, implementation, results', 'Sampul, kata pengantar, pelaksanaan, hasil']},
  ];
  // A centred text block on the cover: y and size in points, on a page H points tall.
  function line(W, H, margin, y, text, size, opts = {}) {
    return { type: 'text', x: margin / W, y: y / H, w: (W - 2 * margin) / W, h: size * 1.5 / H, text, fontSize: size / H,
      family: opts.family || 'serif', bold: !!opts.bold, italic: !!opts.italic, color: opts.color || '#1c1917', align: opts.align || 'center', lineHeight: opts.lineHeight || 1.4 };
  }
  function logo(W, H, y, size) {
    return { type: 'ellipse', x: (W - size) / 2 / W, y: y / H, w: size / W, h: size / H, fill: '#f3f1ec', stroke: '#a8a29e', strokeWidth: 1 / H, rotation: 0 };
  }
  const body = paras => ({ html: paras.join('<br>') });
  const blank = '[Tulis di sini]';

  function make(id, size) {
    const [W, H] = size || [595.28, 841.89];
    if (id === 'skripsi') {
      const m = 85;                                                     // 3 cm
      return { name: 'skripsi.pdf', margin: m, family: 'serif', lineHeight: 1.5, cover: [
        line(W, H, m, 110, 'JUDUL SKRIPSI DITULIS DENGAN HURUF KAPITAL, TIDAK LEBIH DARI DUA PULUH KATA', 14, { bold: true }),
        line(W, H, m, 205, 'SKRIPSI', 14, { bold: true }),
        line(W, H, m, 235, 'Diajukan untuk memenuhi sebagian persyaratan\nmemperoleh gelar Sarjana', 12),
        logo(W, H, 320, 120),
        line(W, H, m, 373, 'LOGO', 10, { color: '#a8a29e' }),
        line(W, H, m, 490, 'Disusun oleh:\nNAMA MAHASISWA\nNIM 0000000000', 12),
        line(W, H, m, 650, 'PROGRAM STUDI ...\nFAKULTAS ...\nUNIVERSITAS ...\n' + new Date().getFullYear(), 12, { bold: true }),
      ], body: body([
        H1('KATA PENGANTAR'), blank, '',
        H1('ABSTRAK'), blank, 'Kata kunci: ...', '',
        NOTE('Daftar isi: Sisipkan → Daftar isi (dibuat otomatis dari judul-judul bab).'), '',
        H1('BAB I PENDAHULUAN'), H2('1.1 Latar Belakang'), blank, H2('1.2 Rumusan Masalah'), blank, H2('1.3 Tujuan Penelitian'), blank, H2('1.4 Manfaat Penelitian'), blank, '',
        H1('BAB II TINJAUAN PUSTAKA'), H2('2.1 Landasan Teori'), blank, H2('2.2 Penelitian Terdahulu'), blank, H2('2.3 Kerangka Pemikiran'), blank, '',
        H1('BAB III METODE PENELITIAN'), H2('3.1 Jenis Penelitian'), blank, H2('3.2 Populasi dan Sampel'), blank, H2('3.3 Teknik Pengumpulan Data'), blank, H2('3.4 Teknik Analisis Data'), blank, '',
        H1('BAB IV HASIL DAN PEMBAHASAN'), H2('4.1 Hasil Penelitian'), blank, H2('4.2 Pembahasan'), blank, '',
        H1('BAB V PENUTUP'), H2('5.1 Kesimpulan'), blank, H2('5.2 Saran'), blank, '',
        H1('DAFTAR PUSTAKA'), 'Nama, A. (Tahun). Judul buku. Kota: Penerbit.',
      ]) };
    }
    if (id === 'jurnal') {
      const m = 71;                                                     // 2.5 cm
      return { name: 'artikel-jurnal.pdf', margin: m, family: 'serif', lineHeight: 1.3, cover: [
        line(W, H, m, 90, 'Judul Artikel Ditulis Singkat dan Jelas, Maksimal Lima Belas Kata', 16, { bold: true }),
        line(W, H, m, 160, 'Penulis Pertama¹, Penulis Kedua²', 11),
        line(W, H, m, 185, '¹Program Studi ..., Universitas ...  ²Program Studi ..., Universitas ...\nemail: penulis@kampus.ac.id', 9, { italic: true }),
        line(W, H, m, 250, 'Abstrak', 11, { bold: true }),
        line(W, H, m, 272, 'Abstrak ditulis dalam satu paragraf (150–250 kata): latar belakang singkat, tujuan, metode, hasil utama, dan kesimpulan penelitian.', 10, { align: 'justify' }),
        line(W, H, m, 360, 'Kata kunci: kata kunci 1; kata kunci 2; kata kunci 3', 10, { italic: true, align: 'left' }),
        line(W, H, m, 410, 'Abstract', 11, { bold: true, italic: true }),
        line(W, H, m, 432, 'The abstract in English, one paragraph (150–250 words).', 10, { italic: true, align: 'justify' }),
        line(W, H, m, 500, 'Keywords: keyword 1; keyword 2; keyword 3', 10, { italic: true, align: 'left' }),
      ], body: body([
        H1('1. PENDAHULUAN'), blank, '',
        H1('2. METODE PENELITIAN'), blank, '',
        H1('3. HASIL DAN PEMBAHASAN'), H2('3.1 Hasil'), blank, H2('3.2 Pembahasan'), blank, '',
        H1('4. KESIMPULAN'), blank, '',
        H1('UCAPAN TERIMA KASIH'), blank, '',
        H1('DAFTAR PUSTAKA'), 'Nama, A., & Nama, B. (Tahun). Judul artikel. Nama Jurnal, Volume(Nomor), halaman. https://doi.org/...',
      ]) };
    }
    const m = 71;
    return { name: 'laporan.pdf', margin: m, family: 'sans', lineHeight: 1.5, cover: [
      line(W, H, m, 150, 'LAPORAN KEGIATAN', 22, { bold: true, family: 'sans' }),
      line(W, H, m, 200, 'Nama Kegiatan atau Judul Laporan', 16, { family: 'sans' }),
      logo(W, H, 300, 130),
      line(W, H, m, 358, 'LOGO', 10, { color: '#a8a29e', family: 'sans' }),
      line(W, H, m, 520, 'Disusun oleh:\nNama Penyusun / Tim\nJabatan', 12, { family: 'sans' }),
      line(W, H, m, 690, 'NAMA INSTANSI / ORGANISASI\nKota, ' + new Date().getFullYear(), 12, { bold: true, family: 'sans' }),
    ], body: body([
      H1('KATA PENGANTAR'), blank, '',
      NOTE('Daftar isi: Sisipkan → Daftar isi (dibuat otomatis dari judul-judul bab).'), '',
      H1('BAB I PENDAHULUAN'), H2('1.1 Latar Belakang'), blank, H2('1.2 Tujuan Kegiatan'), blank, H2('1.3 Ruang Lingkup'), blank, '',
      H1('BAB II PELAKSANAAN KEGIATAN'), H2('2.1 Waktu dan Tempat'), blank, H2('2.2 Peserta'), blank, H2('2.3 Rangkaian Kegiatan'), blank, '',
      H1('BAB III HASIL KEGIATAN'), blank, '',
      H1('BAB IV PENUTUP'), H2('4.1 Kesimpulan'), blank, H2('4.2 Rekomendasi'), blank, '',
      H1('LAMPIRAN'), blank,
    ]) };
  }
  globalThis.EditorTemplates = { LIST, make };
})();
