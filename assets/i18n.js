/* Shared ID/EN dictionary for MyFlipbook (phase 1: homepage full, other pages follow).
 *
 * Usage in any page:
 *   <p data-i18n="hero.badge">fallback text</p>
 *   <input data-i18n-ph="search.ph" placeholder="fallback">
 *   <button data-lang-toggle>...</button>   (shows the language in use: EN / ID)
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
      'nav.journals': '🔎 Find Journal & Ebook',
      'nav.note': '✦ AI Summarizer',
      'soon.body': "We're still building this one. Meanwhile, every other MyFlipbook tool is ready to use.",
      'nav.pricing': '★ Pricing',
      'foot.c3': '★ Pricing',
      'acct.pricingTitle': 'Plans & pricing',
      'acct.guest': 'Log in or create an account to subscribe. The free tools need no account.',
      'acct.startFree': 'Start free',
      'nav.free': 'FREE TOOLS',
      'nav.cta': "Let's convert →",
      'hero.badge': '✦ NO SIGN-UP • FILES STAY ON YOUR DEVICE • NO HASSLE',
      'hero.t1': 'Every PDF task,',
      'hero.t2': 'done',
      'hero.t3': 'the chill way.',
      'hero.subA': 'Merge, split, compress, convert, then turn your PDF into an ',
      'hero.subB': 'interactive flipbook',
      'hero.subC': ' you can share anywhere. Not that red clone — this is the elegant cream GenZ edition.',
      'hero.cta1': '▤ Open Flipbook',
      'hero.cta2': '✦ Chat with your PDF',
      'stat.1': '⚡ ~40 tools',
      'stat.2': '🔒 privacy-first',
      'stat.3': '📖 flipbook + animation',
      'stat.4': '🤖 AI summarizer',
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
      'use.title': 'Your allowance (every {h} hours)',
      'use.office': 'Conversions & links',
      'use.ai': 'AI',
      'use.translate': 'Book translation',
      'use.unlimited': 'Unlimited',
      'use.chars': 'characters',
      'use.times': 'times',
      'use.refill': 'refills at',
      'use.full': 'full',
      'ref.title': 'Invite friends, get Pro free',
      'ref.copy': 'Copy link',
      'ref.copied': 'Copied ✓',
      'ref.signups': 'signed up',
      'ref.subscribed': 'subscribed',
      'ref.rewards': 'months earned',
      'ref.rule': 'Share your link. Every {n} friends who sign up through it and subscribe to Pro or Business give you {d} days of Pro free (or more days of your current paid plan).',
      'ref.next': '{x} of {n} friends subscribed — {left} more for the next free month.',
      'auth.signedInAs': 'You are signed in as',
      'auth.continue': 'Continue',
      'auth.switchAccount': 'Use another account',
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
      'auth.verified': 'verified',
      'auth.agree': 'By continuing you agree to the',
      'auth.and': 'and',
      'foot.privacy': 'Privacy Policy',
      'foot.terms': 'Terms of Service',
      'auth.or': 'or',
      'auth.checkTitle': 'Check your email',
      'auth.checkBody': 'We sent a verification link to',
      'auth.checkBody2': 'Open it to activate your account and sign in.',
      'auth.checkSpam': 'Not there? Look in Spam / Promotions.',
      'auth.resend': 'Send the email again',
      'auth.resent': 'If that account still needs verifying, a new link is on its way.',
      'auth.needEmail': 'Type your email first.',
      'auth.verifyFailed': 'That verification link is invalid or expired. Log in to get a new one.',
      'auth.nudgeTitle': 'Keep your books everywhere',
      'auth.nudgeBody': 'Free to try, free to join. Log in to save books in My Library and pick up on any device.',
      'auth.nudgeLater': 'Later',
      'auth.nudgeClose': 'Close',
      'auth.nudgeRegister': 'No account yet? Create one →',
      'auth.upgTitle': 'Free trial ended',
      'auth.upgBody': 'Your 7 days are up. Upgrade to Pro to unlock every tool, download, AI and unlimited sharing. Online payments are still being set up — email cs@myflipbookpro.com for a manual upgrade.',
      'auth.upgPlans': 'See plans →',      'auth.back': '← All tools',
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
      'acct.disabled': 'Online payment is paused for now — coming soon. The free tools work as usual.',
      'acct.draft': 'Rupiah (QRIS, bank transfer, e-wallet) for Indonesia; US dollars (card, PayPal) everywhere else.',
      'acct.colDate': 'Date',
      'acct.colPlan': 'Plan',
      'acct.colAmount': 'Amount',
      'acct.colStatus': 'Status',
      'acct.colInvoice': 'Invoice',
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
      'nav.journals': '🔎 Find Journal & Ebook',
      'nav.note': '✦ AI Summarizer',
      'soon.body': 'Fitur ini masih kami bangun. Sementara itu, semua tool MyFlipbook lainnya siap dipakai.',
      'nav.pricing': '★ Harga',
      'foot.c3': '★ Harga',
      'acct.pricingTitle': 'Paket & harga',
      'acct.guest': 'Masuk atau buat akun untuk berlangganan. Tool gratis tidak perlu akun.',
      'acct.startFree': 'Mulai gratis',
      'nav.free': 'TOOL GRATIS',
      'nav.cta': 'Gas convert →',
      'hero.badge': '✦ TANPA DAFTAR • FILE DI DEVICE AJA • NO RIBET',
      'hero.t1': 'Semua urusan PDF,',
      'hero.t2': 'beres',
      'hero.t3': 'sambil rebahan.',
      'hero.subA': 'Merge, split, kompres, convert, sampai sulap PDF jadi ',
      'hero.subB': 'flipbook interaktif',
      'hero.subC': ' yang bisa dibagikan ke mana aja. Bukan kloningan merah itu — ini versi krem elegan rasa GenZ.',
      'hero.cta1': '▤ Buka Flipbook',
      'hero.cta2': '✦ Chat sama PDF',
      'stat.1': '⚡ ~40 tools',
      'stat.2': '🔒 privasi utama',
      'stat.3': '📖 flipbook + animasi',
      'stat.4': '🤖 AI summarizer',
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
      'use.title': 'Jatah pemakaianmu (setiap {h} jam)',
      'use.office': 'Konversi & link',
      'use.ai': 'AI',
      'use.translate': 'Terjemahan buku',
      'use.unlimited': 'Tanpa batas',
      'use.chars': 'huruf',
      'use.times': 'kali',
      'use.refill': 'terisi lagi',
      'use.full': 'penuh',
      'ref.title': 'Ajak teman, dapat Pro gratis',
      'ref.copy': 'Salin link',
      'ref.copied': 'Tersalin ✓',
      'ref.signups': 'mendaftar',
      'ref.subscribed': 'berlangganan',
      'ref.rewards': 'bulan didapat',
      'ref.rule': 'Bagikan link-mu. Setiap {n} teman yang mendaftar lewat link ini dan berlangganan Pro atau Business memberimu Pro gratis {d} hari (atau tambahan hari untuk paket berbayarmu sekarang).',
      'ref.next': '{x} dari {n} teman sudah berlangganan — {left} lagi untuk bulan gratis berikutnya.',
      'auth.signedInAs': 'Kamu sudah masuk sebagai',
      'auth.continue': 'Lanjut',
      'auth.switchAccount': 'Pakai akun lain',
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
      'auth.verified': 'terverifikasi',
      'auth.agree': 'Dengan melanjutkan, Anda menyetujui',
      'auth.and': 'dan',
      'foot.privacy': 'Kebijakan Privasi',
      'foot.terms': 'Syarat & Ketentuan',
      'auth.or': 'atau',
      'auth.checkTitle': 'Cek emailmu',
      'auth.checkBody': 'Kami mengirim link verifikasi ke',
      'auth.checkBody2': 'Buka link itu untuk mengaktifkan akun dan masuk.',
      'auth.checkSpam': 'Tidak ada? Cek folder Spam / Promosi.',
      'auth.resend': 'Kirim ulang email',
      'auth.resent': 'Bila akun itu belum terverifikasi, link baru sedang dikirim.',
      'auth.needEmail': 'Isi email dulu.',
      'auth.verifyFailed': 'Link verifikasi tidak valid atau kedaluwarsa. Masuk untuk minta link baru.',
      'auth.nudgeTitle': 'Simpan bukumu di mana saja',
      'auth.nudgeBody': 'Gratis dicoba, gratis bergabung. Masuk untuk menyimpan buku di My Library dan melanjutkannya di perangkat lain.',
      'auth.nudgeLater': 'Nanti saja',
      'auth.nudgeClose': 'Tutup',
      'auth.nudgeRegister': 'Belum punya akun? Daftar →',
      'auth.upgTitle': 'Masa coba Free habis',
      'auth.upgBody': 'Masa coba 7 harimu sudah habis. Upgrade ke Pro untuk membuka semua tool, download, AI, dan share tanpa batas. Pembayaran online sedang disiapkan — hubungi cs@myflipbookpro.com untuk upgrade manual.',
      'auth.upgPlans': 'Lihat paket →',
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
      'acct.disabled': 'Pembayaran online sementara dinonaktifkan — segera hadir. Tool gratis tetap bisa dipakai.',
      'acct.draft': 'Rupiah (QRIS, transfer bank, e-wallet) untuk Indonesia; dolar AS (kartu, PayPal) untuk luar negeri.',
      'acct.colDate': 'Tanggal',
      'acct.colPlan': 'Paket',
      'acct.colAmount': 'Nominal',
      'acct.colStatus': 'Status',
      'acct.colInvoice': 'Invoice',
      'status.pending': 'Menunggu',
      'status.paid': 'Lunas',
      'status.failed': 'Gagal',
      'status.expired': 'Kedaluwarsa',
      'tool.pdf-to-flipbook': 'Buka PDF sebagai buku digital dan tambahkan statistik angka animasi di halaman mana pun.',
      'tool.journal-search': 'Cari jurnal & ebook gratis (Indonesia & internasional, open access), lalu jadikan flipbook dalam satu klik.',
      'tool.notebook': 'Upload PDF → ringkasan AI, terjemahan per halaman, dan podcast dua penyiar.',
      'tool.flipbook-animation': 'Coba grafik bergerak, statistik animasi, dan alur interaktif di dalam buku digital.',
      'tool.workflow': 'Buat alur kerja kustom dengan tool favoritmu, otomatiskan tugas, dan pakai ulang kapan saja.',
      'tool.merge-pdf': 'Gabungkan PDF sesuai urutan yang kamu mau dengan tool termudah.',
      'tool.split-pdf': 'Pisahkan satu halaman atau banyak halaman jadi file mandiri.',
      'tool.compress-pdf': 'Perkecil ukuran file dengan kualitas PDF tetap maksimal.',
      'tool.pdf-to-word': 'Word yang tampilannya sama dengan PDF, teksnya bisa diedit langsung di halaman.',
      'tool.pdf-to-ppt': 'Slide tetap berdesain PDF, tiap baris teks jadi kotak teks yang bisa diedit.',
      'tool.pdf-to-excel': 'Tarik tabel ke Excel: sel asli, angka asli, halaman tetap ada sebagai gambar.',
      'tool.word-to-pdf': 'Bikin file DOC/DOCX gampang dibaca dengan mengubah ke PDF.',
      'tool.ppt-to-pdf': 'Bikin slideshow PPT/PPTX gampang dilihat dengan mengubah ke PDF.',
      'tool.excel-to-pdf': 'Bikin spreadsheet EXCEL gampang dibaca dengan mengubah ke PDF.',
      'tool.edit-pdf': 'Edit teks seperti di Word dan pindahkan gambar seperti di PowerPoint — langsung di halaman.',
      'tool.pdf-to-jpg': 'Ubah tiap halaman PDF jadi JPG atau ambil semua gambarnya.',
      'tool.jpg-to-pdf': 'Gambar apa pun jadi PDF: JPG, PNG, WebP, GIF, BMP, SVG, AVIF, TIFF, bahkan HEIC iPhone.',
      'tool.sign-pdf': 'Gambar, ketik, atau upload tanda tangan lalu taruh di mana saja di halaman.',
      'tool.watermark': 'Cap gambar atau teks di PDF dalam sekejap.',
      'tool.rotate-pdf': 'Putar PDF sesukamu. Bisa banyak file sekaligus!',
      'tool.html-to-pdf': 'Ubah halaman web HTML jadi PDF. Tempel URL lalu klik.',
      'tool.protect-pdf': 'Lindungi file PDF dengan password. Enkripsi dokumenmu.',
      'tool.organize-pdf': 'Edit teks seperti Word dan gambar seperti PowerPoint, tambah halaman kosong, gabung, pisah, dan kompres — PDF hasil scan dan foto dokumen juga bisa.',
      'tool.pdf-to-pdfa': 'Ubah PDF ke PDF/A, standar ISO untuk arsip jangka panjang.',
      'tool.repair-pdf': 'Perbaiki PDF rusak dan selamatkan datanya.',
      'tool.page-numbers': 'Tambah nomor halaman ke PDF dengan mudah.',
      'tool.scan-to-pdf': 'Foto dokumen dengan kamera HP dan jadikan PDF yang bersih dan mudah dibaca.',
      'tool.ocr-pdf': 'Ubah PDF hasil scan jadi dokumen yang bisa dicari dan diseleksi.',
      'tool.compare-pdf': 'Temukan perubahan antara dua versi PDF, baris demi baris.',
      'tool.redact-pdf': 'Hitamkan teks dan gambar permanen untuk menghapus info sensitif.',
      'tool.crop-pdf': 'Potong margin PDF atau area tertentu, per halaman atau semuanya.',
      'tool.pdf-forms': 'Isi formulir PDF yang bisa diisi lalu simpan — bisa dikunci.',
      'tool.translate-pdf': 'Terjemahkan PDF dengan AI. Font, layout, dan format tetap terjaga.',
      'tool.pdf-to-md': 'Ubah PDF jadi Markdown. Pas untuk catatan, docs, dan LLM.',
      'tool.utilities': 'Semua alat konversi dan alat PDF kecil di satu tempat: PDF ↔ Word, Excel, PowerPoint, JPG, HTML, Markdown, plus putar, pangkas, nomor halaman, watermark, tanda tangan, sensor, OCR, dan lainnya.',
      'title.pdf-to-flipbook': 'PDF ke Flipbook',
      'title.journal-search': 'Cari Jurnal & Ebook',
      'title.notebook': 'Peringkas AI',
      'title.flipbook-animation': 'Animasi Flipbook',
      'title.workflow': 'Buat alur kerja',
      'title.organize-pdf': 'Edit PDF',
      'title.pdf-to-word': 'PDF ke Word',
      'title.pdf-to-ppt': 'PDF ke PowerPoint',
      'title.pdf-to-excel': 'PDF ke Excel',
      'title.word-to-pdf': 'Word ke PDF',
      'title.ppt-to-pdf': 'PowerPoint ke PDF',
      'title.excel-to-pdf': 'Excel ke PDF',
      'title.pdf-to-jpg': 'PDF ke JPG',
      'title.jpg-to-pdf': 'Gambar ke PDF',
      'title.sign-pdf': 'Tanda Tangan PDF',
      'title.watermark': 'Watermark',
      'title.rotate-pdf': 'Putar PDF',
      'title.html-to-pdf': 'HTML ke PDF',
      'title.protect-pdf': 'Lindungi PDF',
      'title.pdf-to-pdfa': 'PDF ke PDF/A',
      'title.repair-pdf': 'Perbaiki PDF',
      'title.page-numbers': 'Nomor Halaman',
      'title.scan-to-pdf': 'Scan ke PDF',
      'title.ocr-pdf': 'OCR PDF',
      'title.compare-pdf': 'Bandingkan PDF',
      'title.redact-pdf': 'Sensor PDF',
      'title.crop-pdf': 'Pangkas PDF',
      'title.pdf-forms': 'Formulir PDF',
      'title.translate-pdf': 'Terjemahkan PDF',
      'title.pdf-to-md': 'PDF ke Markdown',
      'title.merge-pdf': 'Gabung PDF',
      'title.split-pdf': 'Pisah PDF',
      'title.compress-pdf': 'Kompres PDF',
      'title.edit-pdf': 'Edit PDF',
      'title.utilities': 'Utilitas'
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
  // A tool's name in the site language: I18N.title('merge-pdf', 'Merge PDF').
  function title(id, fallback) {
    var key = 'title.' + id;
    if (get() === 'id' && dict.id[key] != null) return dict.id[key];
    return fallback;
  }
  // English or Indonesian text picked in JS: I18N.pick('Search', 'Cari').
  function pick(en, id) {
    return get() === 'en' ? en : id;
  }
  // Two languages written straight into the page: the element keeps its
  // Indonesian text and carries the English one —
  //   <p data-en="English <b>html</b>">Teks <b>Indonesia</b></p>
  //   data-en-ph / data-en-title / data-en-aria for placeholder, title, aria-label;
  //   <html data-en-doc="English page title"> for the tab title.
  var ATTRS = [['data-en-ph', 'placeholder'], ['data-en-title', 'title'], ['data-en-aria', 'aria-label']];
  function both(root) {
    var en = get() === 'en', i, j, els;
    root = root || document;
    els = root.querySelectorAll('[data-en]');
    for (i = 0; i < els.length; i++) {
      if (!els[i].hasAttribute('data-id-html')) els[i].setAttribute('data-id-html', els[i].innerHTML);
      els[i].innerHTML = en ? els[i].getAttribute('data-en') : els[i].getAttribute('data-id-html');
    }
    for (j = 0; j < ATTRS.length; j++) {
      els = root.querySelectorAll('[' + ATTRS[j][0] + ']');
      for (i = 0; i < els.length; i++) {
        var keep = 'data-id-' + ATTRS[j][1];
        if (!els[i].hasAttribute(keep)) els[i].setAttribute(keep, els[i].getAttribute(ATTRS[j][1]) || '');
        els[i].setAttribute(ATTRS[j][1], en ? els[i].getAttribute(ATTRS[j][0]) : els[i].getAttribute(keep));
      }
    }
    var html = document.documentElement;
    if (root === document && html.hasAttribute('data-en-doc')) {
      if (!html.hasAttribute('data-id-doc')) html.setAttribute('data-id-doc', document.title);
      document.title = en ? html.getAttribute('data-en-doc') : html.getAttribute('data-id-doc');
    }
  }
  function apply() {
    var i, els;
    els = document.querySelectorAll('[data-i18n]');
    for (i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute('data-i18n'));
    els = document.querySelectorAll('[data-i18n-ph]');
    for (i = 0; i < els.length; i++) els[i].setAttribute('placeholder', t(els[i].getAttribute('data-i18n-ph')));
    both(document);
    els = document.querySelectorAll('[data-lang-toggle]');
    // The button shows the language in use; its tooltip says what a click does.
    for (i = 0; i < els.length; i++) {
      els[i].textContent = get() === 'en' ? 'EN' : 'ID';
      els[i].title = get() === 'en' ? 'Switch to Indonesian' : 'Ganti ke bahasa Inggris';
      els[i].setAttribute('aria-label', els[i].title);
    }
    try {
      document.documentElement.lang = get() === 'en' ? 'en' : 'id';
    } catch (e) {}
    // The server answers (errors, emails) in the same language.
    try {
      document.cookie = 'mf_lang=' + get() + '; path=/; max-age=31536000; SameSite=Lax';
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
  window.I18N = { get: get, set: set, t: t, tool: tool, title: title, apply: apply, pick: pick, both: both, KEY: KEY };
})();
