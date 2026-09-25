/* Shared ID/EN dictionary for MyFlipbook (phase 1: homepage full, other pages follow).
 *
 * Usage in any page:
 *   <p data-i18n="hero.badge">fallback text</p>
 *   <input data-i18n-ph="search.ph" placeholder="fallback">
 *   <button data-lang-toggle>...</button>   (label auto-switches ID<->EN)
 *   I18N.t('key') / I18N.tool('merge-pdf', fallbackDesc) in JS.
 *
 * Language persists in localStorage ('pdf-tools-lang'), default 'en'.
 * Changing language fires a document 'langchange' event for dynamic re-render.
 */
(function () {
  var KEY = 'pdf-tools-lang';
  var dict = {
    en: {
      'meta.title': 'MyFlipbook — Every PDF task, done the chill way',
      'nav.tag': 'SARVAMAYA • LOCAL VIBES',
      'nav.all': '✳ All tools',
      'nav.flip': '▤ Flipbook',
      'nav.note': '✦ Notebook AI',
      'nav.free': 'FREE TOOLS',
      'nav.cta': "Let's convert →",
      'hero.badge': '✦ NO SIGN-UP • FILES STAY ON YOUR DEVICE • NO HASSLE',
      'hero.t1': 'Every PDF task,',
      'hero.t2': 'done',
      'hero.t3': 'the chill way.',
      'hero.subA': 'Merge, split, compress, convert, then turn your PDF into an ',
      'hero.subB': 'interactive flipbook',
      'hero.subC': ' + chat with your docs via AI. Not that red clone — this is the elegant cream GenZ edition.',
      'hero.cta1': '▤ Open Flipbook',
      'hero.cta2': '✦ Chat with your PDF',
      'stat.1': '⚡ ~40 tools',
      'stat.2': '🔒 privacy-first',
      'stat.3': '📖 flipbook + animation',
      'stat.4': '🤖 notebook AI',
      'grid.title': 'Pick your weapon',
      'search.ph': 'Search tools…',
      'grid.sub': 'Click a card → jump straight into the tool. Workflows live at the top.',
      'grid.empty': 'No tools in this category.',
      'feat.1k': "WHY IT'S DIFFERENT?",
      'feat.1t': 'Not just convert.',
      'feat.1d': 'Your PDF can instantly become a digital book + animated stats. Other converters stop at download.',
      'feat.2k': 'PRIVACY',
      'feat.2t': "Files don't wander.",
      'feat.2d': 'Most processing runs in your browser. Great for theses, invoices, & secret docs.',
      'feat.3k': 'GEN-Z APPROVED',
      'feat.3t': 'Not stiff, not dated.',
      'feat.3d': 'Serif type + stickers + jumbo rounded corners. Serious but fun on mobile.',
      'foot.t': 'Ready to go? No overthinking.',
      'foot.s': 'Pick a tool above, drop your file, done. No install. Log in for Pro features.',
      'foot.c1': '▤ Turn into flipbook',
      'foot.c2': 'Compress PDF',
      'foot.note': 'MyFlipbook • Sarvamaya vibes • Made locally, for never-ending tasks ✳',
      'card.open': 'Open tool',
      'card.workflow': 'Create workflow',
      'card.soon': 'SOON →',
      'card.coming': 'Coming soon',
      'auth.login': 'Log in',
      'auth.register': 'Create account',
      'auth.titleLogin': 'Welcome back',
      'auth.titleRegister': 'Create your account',
      'auth.sub': 'One account for your flipbooks, plan and billing.',
      'auth.email': 'Email',
      'auth.password': 'Password',
      'auth.name': 'Name (optional)',
      'auth.pwHint': 'At least 8 characters.',
      'auth.submitLogin': 'Log in →',
      'auth.submitRegister': 'Create account →',
      'auth.toRegister': 'New here? Create an account',
      'auth.toLogin': 'Already have an account? Log in',
      'auth.offline': 'Accounts need the MyFlipbook server (python server.py).',
      'auth.back': '← All tools',
      'acct.title': 'Your account',
      'acct.plan': 'Current plan',
      'acct.until': 'Active until',
      'acct.logout': 'Log out',
      'acct.plans': 'Plans',
      'acct.method': 'Payment method',
      'acct.monthly': 'Monthly',
      'acct.yearly': 'Yearly',
      'acct.save': 'save',
      'acct.perMonth': '/month',
      'acct.perYear': '/year',
      'acct.choose': 'Choose',
      'acct.extend': 'Extend',
      'acct.active': 'Your plan',
      'acct.free': 'Free',
      'acct.orders': 'Payment history',
      'acct.noOrders': 'No payments yet.',
      'acct.mock': 'Local test mode: no payment gateway is configured. Simulate this payment?',
      'acct.mockPay': 'Simulate payment',
      'acct.pending': 'Waiting for payment confirmation…',
      'acct.paidMsg': 'Payment received — your plan is active.',
      'acct.disabled': 'Online payment is not enabled on this server yet.',
      'acct.draft': 'Prices in IDR. Draft pricing — may change.',
      'acct.colDate': 'Date',
      'acct.colPlan': 'Plan',
      'acct.colAmount': 'Amount',
      'acct.colStatus': 'Status',
      'status.pending': 'Pending',
      'status.paid': 'Paid',
      'status.failed': 'Failed',
      'status.expired': 'Expired'
    },
    id: {
      'meta.title': 'MyFlipbook — Semua urusan PDF, beres sambil rebahan',
      'nav.tag': 'SARVAMAYA • VIBES LOKAL',
      'nav.all': '✳ Semua tools',
      'nav.flip': '▤ Flipbook',
      'nav.note': '✦ Notebook AI',
      'nav.free': 'TOOL GRATIS',
      'nav.cta': 'Gas convert →',
      'hero.badge': '✦ TANPA DAFTAR • FILE DI DEVICE AJA • NO RIBET',
      'hero.t1': 'Semua urusan PDF,',
      'hero.t2': 'beres',
      'hero.t3': 'sambil rebahan.',
      'hero.subA': 'Merge, split, kompres, convert, sampai sulap PDF jadi ',
      'hero.subB': 'flipbook interaktif',
      'hero.subC': ' + ngobrol sama dokumen via AI. Bukan kloningan merah itu — ini versi krem elegan rasa GenZ.',
      'hero.cta1': '▤ Buka Flipbook',
      'hero.cta2': '✦ Chat sama PDF',
      'stat.1': '⚡ ~40 tools',
      'stat.2': '🔒 privasi utama',
      'stat.3': '📖 flipbook + animasi',
      'stat.4': '🤖 notebook AI',
      'grid.title': 'Pilih senjatamu',
      'search.ph': 'Cari tools…',
      'grid.sub': 'Klik kartu → langsung ke tool-nya. Workflows ada di paling atas.',
      'grid.empty': 'Tidak ada tool di kategori ini.',
      'feat.1k': 'KENAPA BEDA?',
      'feat.1t': 'Bukan sekadar convert.',
      'feat.1d': 'Hasil PDF bisa langsung jadi buku digital + animasi angka. Converter lain berhenti di download.',
      'feat.2k': 'PRIVASI',
      'feat.2t': 'File nggak kelayapan.',
      'feat.2d': 'Sebagian besar proses jalan di browser-mu. Cocok buat skripsi, invoice, & dokumen rahasia.',
      'feat.3k': 'GEN-Z APPROVED',
      'feat.3t': 'Nggak kaku, nggak jadul.',
      'feat.3d': 'Tipografi serif + stiker + rounded jumbo. Serius tapi tetap fun dibuka di HP.',
      'foot.t': 'Udah siap gas? Jangan overthinking.',
      'foot.s': 'Pilih tool di atas, drop file, beres. Nggak perlu install. Login buat fitur Pro.',
      'foot.c1': '▤ Jadiin flipbook',
      'foot.c2': 'Kompres PDF',
      'foot.note': 'MyFlipbook • Sarvamaya vibes • Dibuat lokal, untuk tugas yang nggak kelar-kelar ✳',
      'card.open': 'Buka tool',
      'card.workflow': 'Create workflow',
      'card.soon': 'SOON →',
      'card.coming': 'Segera hadir',
      'auth.login': 'Masuk',
      'auth.register': 'Daftar',
      'auth.titleLogin': 'Selamat datang lagi',
      'auth.titleRegister': 'Buat akunmu',
      'auth.sub': 'Satu akun untuk flipbook, paket, dan tagihanmu.',
      'auth.email': 'Email',
      'auth.password': 'Password',
      'auth.name': 'Nama (opsional)',
      'auth.pwHint': 'Minimal 8 karakter.',
      'auth.submitLogin': 'Masuk →',
      'auth.submitRegister': 'Buat akun →',
      'auth.toRegister': 'Belum punya akun? Daftar',
      'auth.toLogin': 'Sudah punya akun? Masuk',
      'auth.offline': 'Akun butuh server MyFlipbook (python server.py).',
      'auth.back': '← Semua tool',
      'acct.title': 'Akunmu',
      'acct.plan': 'Paket saat ini',
      'acct.until': 'Aktif sampai',
      'acct.logout': 'Keluar',
      'acct.plans': 'Paket',
      'acct.method': 'Metode bayar',
      'acct.monthly': 'Bulanan',
      'acct.yearly': 'Tahunan',
      'acct.save': 'hemat',
      'acct.perMonth': '/bulan',
      'acct.perYear': '/tahun',
      'acct.choose': 'Pilih',
      'acct.extend': 'Perpanjang',
      'acct.active': 'Paketmu',
      'acct.free': 'Gratis',
      'acct.orders': 'Riwayat pembayaran',
      'acct.noOrders': 'Belum ada pembayaran.',
      'acct.mock': 'Mode uji lokal: gateway pembayaran belum dipasang. Simulasikan pembayaran ini?',
      'acct.mockPay': 'Simulasikan pembayaran',
      'acct.pending': 'Menunggu konfirmasi pembayaran…',
      'acct.paidMsg': 'Pembayaran diterima — paketmu aktif.',
      'acct.disabled': 'Pembayaran online belum diaktifkan di server ini.',
      'acct.draft': 'Harga dalam Rupiah. Harga masih draf dan bisa berubah.',
      'acct.colDate': 'Tanggal',
      'acct.colPlan': 'Paket',
      'acct.colAmount': 'Nominal',
      'acct.colStatus': 'Status',
      'status.pending': 'Menunggu',
      'status.paid': 'Lunas',
      'status.failed': 'Gagal',
      'status.expired': 'Kedaluwarsa',
      'tool.pdf-to-flipbook': 'Buka PDF sebagai buku digital dan tambahkan statistik angka animasi di halaman mana pun.',
      'tool.notebook': 'Ngobrol dengan PDF-mu seperti NotebookLM. Upload → ringkasan otomatis, tanya jawab, podcast & mindmap.',
      'tool.flipbook-animation': 'Coba grafik bergerak, statistik animasi, dan alur interaktif di dalam buku digital.',
      'tool.workflow': 'Buat alur kerja kustom dengan tool favoritmu, otomatiskan tugas, dan pakai ulang kapan saja.',
      'tool.merge-pdf': 'Gabungkan PDF sesuai urutan yang kamu mau dengan tool termudah.',
      'tool.split-pdf': 'Pisahkan satu halaman atau banyak halaman jadi file mandiri.',
      'tool.compress-pdf': 'Perkecil ukuran file dengan kualitas PDF tetap maksimal.',
      'tool.pdf-to-word': 'Word yang tampilannya sama dengan PDF, teksnya bisa diedit langsung di halaman.',
      'tool.pdf-to-ppt': 'Slide tetap berdesain PDF, tiap baris teks jadi text box yang bisa diedit.',
      'tool.pdf-to-excel': 'Tarik tabel ke Excel: sel asli, angka asli, halaman tetap ada sebagai gambar.',
      'tool.word-to-pdf': 'Bikin file DOC/DOCX gampang dibaca dengan mengubah ke PDF.',
      'tool.ppt-to-pdf': 'Bikin slideshow PPT/PPTX gampang dilihat dengan mengubah ke PDF.',
      'tool.excel-to-pdf': 'Bikin spreadsheet EXCEL gampang dibaca dengan mengubah ke PDF.',
      'tool.edit-pdf': 'Tambah teks, gambar, dan anotasi ke dokumen PDF.',
      'tool.pdf-to-jpg': 'Ubah tiap halaman PDF jadi JPG atau ambil semua gambarnya.',
      'tool.jpg-to-pdf': 'Gambar apa pun jadi PDF: JPG, PNG, WebP, GIF, BMP, SVG, AVIF, TIFF, bahkan HEIC iPhone.',
      'tool.sign-pdf': 'Tanda tangani sendiri atau minta tanda tangan elektronik orang lain.',
      'tool.watermark': 'Cap gambar atau teks di PDF dalam sekejap.',
      'tool.rotate-pdf': 'Putar PDF sesukamu. Bisa banyak file sekaligus!',
      'tool.html-to-pdf': 'Ubah halaman web HTML jadi PDF. Tempel URL lalu klik.',
      'tool.protect-pdf': 'Lindungi file PDF dengan password. Enkripsi dokumenmu.',
      'tool.organize-pdf': 'Susun halaman PDF sesukamu. Hapus atau tambah halaman dengan mudah.',
      'tool.pdf-to-pdfa': 'Ubah PDF ke PDF/A, standar ISO untuk arsip jangka panjang.',
      'tool.repair-pdf': 'Perbaiki PDF rusak dan selamatkan datanya.',
      'tool.page-numbers': 'Tambah nomor halaman ke PDF dengan mudah.',
      'tool.scan-to-pdf': 'Pindai dokumen dari HP langsung ke browser.',
      'tool.ocr-pdf': 'Ubah PDF hasil scan jadi dokumen yang bisa dicari dan diseleksi.',
      'tool.compare-pdf': 'Bandingkan dua dokumen bersisian dan temukan bedanya.',
      'tool.redact-pdf': 'Hitamkan teks dan gambar permanen untuk menghapus info sensitif.',
      'tool.crop-pdf': 'Potong margin PDF atau area tertentu, per halaman atau semuanya.',
      'tool.pdf-forms': 'Buat PDF isian interaktif atau isi form yang ada.',
      'tool.ai-summarizer': 'Bikin ringkasan padat dari artikel dalam sekejap.',
      'tool.translate-pdf': 'Terjemahkan PDF dengan AI. Font, layout, dan format tetap terjaga.',
      'tool.pdf-to-md': 'Ubah PDF jadi Markdown. Pas untuk catatan, docs, dan LLM.'
    }
  };

  function get() {
    try {
      return localStorage.getItem(KEY) || 'en';
    } catch (e) {
      return 'en';
    }
  }
  function t(key) {
    var lang = get();
    if (dict[lang] && dict[lang][key] != null) return dict[lang][key];
    if (dict.en[key] != null) return dict.en[key];
    return key;
  }
  function tool(id, fallback) {
    var lang = get();
    var key = 'tool.' + id;
    if (lang === 'id' && dict.id[key] != null) return dict.id[key];
    return fallback;
  }
  function apply() {
    var i, els;
    els = document.querySelectorAll('[data-i18n]');
    for (i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute('data-i18n'));
    els = document.querySelectorAll('[data-i18n-ph]');
    for (i = 0; i < els.length; i++) els[i].setAttribute('placeholder', t(els[i].getAttribute('data-i18n-ph')));
    els = document.querySelectorAll('[data-lang-toggle]');
    for (i = 0; i < els.length; i++) els[i].textContent = get() === 'en' ? 'ID' : 'EN';
    try {
      document.documentElement.lang = get() === 'en' ? 'en' : 'id';
    } catch (e) {}
  }
  function set(lang) {
    try {
      localStorage.setItem(KEY, lang);
    } catch (e) {}
    apply();
    try {
      document.dispatchEvent(new CustomEvent('langchange'));
    } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-lang-toggle]') : null;
    if (b) set(get() === 'en' ? 'id' : 'en');
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
  window.I18N = { get: get, set: set, t: t, tool: tool, apply: apply, KEY: KEY };
})();
