"""Search pages: Indonesian landing pages for each tool (/kompres-pdf,
/pdf-ke-flipbook, ...), robots.txt, sitemap.xml, and the meta tags (description,
canonical, Open Graph, structured data) added to the app pages when they are
served. Everything is rendered here from plain data so the app pages stay as
they are; the landing pages link straight into the tool (converter.html?tool=…).

Only true claims: tools marked browser=True really run in the browser (the file
is not uploaded); the others go to the server (LibreOffice / AI / translation).
"""
import html
import json
import os
import re
import time

SITE = 'https://myflipbookpro.com'
BRAND = 'MyFlipbook'
OG_IMAGE = SITE + '/assets/img/hero-1671.jpg'
OG_SIZE = (1671, 941)
HOME_TITLE = 'MyFlipbook — Buat Flipbook dari PDF & Alat PDF Lengkap Berbahasa Indonesia'
UPDATED = '2026-10-06'

# slug, link into the app, short name, <title>, meta description, h1, lead,
# steps, why, faq, browser (file never leaves the device), related slugs.
LANDING = {}


def page(slug, link, name, title, description, h1, lead, steps, why, faq, browser=True, related=()):
    LANDING[slug] = dict(slug=slug, link=link, name=name, title=title, description=description, h1=h1, lead=lead,
                         steps=steps, why=why, faq=faq, browser=browser, related=list(related))


PRIVATE = ('File diproses langsung di browser Anda — tidak diunggah ke server kami, jadi aman untuk dokumen kantor, '
           'tugas kuliah, maupun dokumen pribadi.')
SERVER = ('File dikirim lewat koneksi terenkripsi (HTTPS) ke server MyFlipbook untuk dikonversi, lalu langsung '
          'dihapus setelah hasilnya dikirim kembali ke Anda.')
TRIAL = 'Daftar gratis dan coba semua fitur selama 7 hari — tanpa kartu kredit.'

page('pdf-ke-flipbook', 'flipbook.html', 'PDF ke Flipbook',
     'Buat Flipbook dari PDF Gratis — Majalah & E-book Digital | MyFlipbook',
     'Ubah PDF menjadi flipbook interaktif dengan efek bolak-balik halaman seperti buku asli. Bisa dibagikan lewat link, '
     'dibaca dengan suara, diterjemahkan, dan diekspor ke HTML, APK, atau EXE.',
     'Ubah PDF Menjadi Flipbook yang Bisa Dibalik Seperti Buku Asli',
     'Majalah, katalog produk, modul ajar, laporan tahunan, atau e-book — unggah PDF-nya dan dalam hitungan detik '
     'jadi flipbook dengan efek halaman yang realistis, siap dibagikan ke siapa pun.',
     ['Buka PDF to Flipbook, lalu pilih file PDF dari komputer, HP, atau Google Drive.',
      'Atur sampul, tampilan, dan baca hasilnya langsung — bisa layar penuh, stabilo, dan coretan spidol.',
      'Simpan ke My Library, bagikan lewat link, atau ekspor jadi HTML offline, aplikasi Android (APK), atau Windows (EXE).'],
     ['Efek bolak-balik halaman yang halus, terasa seperti membuka buku cetak.',
      'Audio book: halaman dibacakan dengan suara, termasuk setelah diterjemahkan ke Bahasa Indonesia.',
      'Terjemahkan seluruh buku dengan tombol Translate, layout tetap mengikuti kolom aslinya.',
      'Stabilo, catatan, dan spidol untuk belajar atau presentasi.'],
     [('Apakah membuat flipbook di MyFlipbook gratis?', 'Membaca dan membuat flipbook bisa dicoba gratis. Akun baru mendapat masa coba 7 hari untuk semua fitur. Ekspor HTML offline dan aplikasi APK tersedia di paket Pro, aplikasi Windows (EXE) di paket Business.'),
      ('PDF seperti apa yang bisa dijadikan flipbook?', 'Hampir semua PDF: majalah, katalog, buku, modul, jurnal, portofolio, hingga PDF hasil scan. Halaman bergambar tetap bisa distabilo dan dibacakan berkat OCR.'),
      ('Bagaimana cara membagikan flipbook?', 'Simpan ke My Library lalu buat share link. Siapa pun yang punya link bisa membacanya di browser tanpa perlu login.'),
      ('Apakah bisa dibuka tanpa internet?', 'Bisa. Ekspor flipbook ke HTML offline atau jadikan aplikasi Android/Windows supaya bisa dibaca tanpa koneksi.')],
     browser=True, related=['terjemahkan-pdf', 'pdf-jadi-audiobook', 'kompres-pdf', 'gabung-pdf'])

page('terjemahkan-pdf', 'flipbook.html', 'Terjemahkan PDF',
     'Terjemahkan PDF Inggris ke Bahasa Indonesia, Layout Tetap Rapi | MyFlipbook',
     'Terjemahkan buku, jurnal, atau majalah PDF dari bahasa Inggris ke Bahasa Indonesia. Teks terjemahan ditempatkan '
     'mengikuti kolom aslinya, lengkap dengan stabilo dan audio book.',
     'Terjemahkan PDF Bahasa Inggris ke Bahasa Indonesia',
     'Buka PDF sebagai flipbook, tekan tombol Translate, dan seluruh buku diterjemahkan dengan tata letak yang tetap '
     'mengikuti kolom aslinya — cocok untuk membaca jurnal dan textbook berbahasa Inggris.',
     ['Buka PDF di PDF to Flipbook.',
      'Tekan tombol Translate dan pilih Bahasa Indonesia. Progres terjemahan terlihat di tombolnya.',
      'Baca, stabilo, atau dengarkan versi terjemahannya. Teks yang distabilo juga bisa diterjemahkan sendiri dengan AI.'],
     ['Terjemahan mengikuti kolom asli — teks tidak menumpuk dan tidak melebar.',
      'Bisa beralih kembali ke bahasa asli kapan saja.',
      'Audio book membacakan versi terjemahan, bukan teks Inggrisnya.',
      'Stabilo di edisi terjemahan memakai kata-kata terjemahan.'],
     [('Bahasa apa saja yang didukung?', 'Terjemahan buku penuh saat ini dari bahasa Inggris ke Bahasa Indonesia dan sebaliknya.'),
      ('Apakah PDF hasil scan bisa diterjemahkan?', 'Bisa untuk halaman yang teksnya terbaca oleh OCR. Kualitas hasilnya bergantung pada kejelasan hasil scan.'),
      ('Apakah file asli saya berubah?', 'Tidak. Terjemahan ditampilkan sebagai edisi terpisah di flipbook; file PDF asli tetap utuh.')],
     browser=False, related=['pdf-ke-flipbook', 'ringkas-pdf-ai', 'cari-jurnal-ebook'])

page('pdf-jadi-audiobook', 'flipbook.html', 'PDF jadi Audio Book',
     'Ubah PDF Jadi Audio Book — Dengarkan Buku Dibacakan | MyFlipbook',
     'Dengarkan isi PDF dibacakan halaman demi halaman. Cocok untuk belajar sambil beraktivitas, membaca jurnal, '
     'atau membantu yang lebih nyaman mendengar daripada membaca.',
     'Dengarkan PDF Anda Dibacakan Seperti Audio Book',
     'Buka PDF sebagai flipbook lalu tekan tombol audio: setiap halaman dibacakan dengan suara, dalam bahasa asli '
     'maupun setelah diterjemahkan ke Bahasa Indonesia.',
     ['Buka PDF di PDF to Flipbook.', 'Tekan tombol audio book untuk mulai mendengarkan.',
      'Halaman berganti mengikuti bacaan; jeda dan lanjutkan kapan saja.'],
     ['Judul dan kata dibaca utuh, tidak dieja huruf per huruf.',
      'Halaman bergambar/hasil scan tetap bisa dibacakan berkat OCR.',
      'Bisa dipadukan dengan terjemahan ke Bahasa Indonesia.'],
     [('Apakah perlu memasang aplikasi?', 'Tidak. Semuanya berjalan di browser, di komputer maupun HP.'),
      ('Bahasa apa yang dibacakan?', 'Bahasa sesuai teks yang ditampilkan — bahasa asli PDF, atau Bahasa Indonesia setelah diterjemahkan.')],
     browser=True, related=['pdf-ke-flipbook', 'terjemahkan-pdf', 'ocr-pdf'])

page('ringkas-pdf-ai', 'notebook.html', 'AI Summarizer',
     'Ringkas PDF dengan AI — Rangkuman Jurnal & Dokumen Otomatis | MyFlipbook',
     'Buat ringkasan PDF otomatis dengan AI: rangkuman poin penting, terjemahan, hingga podcast dari dokumen Anda. '
     'Cocok untuk jurnal, skripsi, laporan, dan materi kuliah.',
     'Ringkas PDF dengan AI dalam Hitungan Detik',
     'Unggah jurnal, laporan, atau materi kuliah — AI Summarizer membuat ringkasan poin penting, menjawab pertanyaan '
     'tentang isinya, menerjemahkan, bahkan mengubahnya menjadi podcast.',
     ['Buka AI Summarizer dan tambahkan sumber: PDF, dokumen, atau link.',
      'Pilih jenis hasil: ringkasan, terjemahan, atau podcast.', 'Salin atau simpan hasilnya.'],
     ['Hemat waktu membaca jurnal dan laporan panjang.', 'Bisa menggabungkan beberapa sumber sekaligus.',
      'Ringkasan dalam Bahasa Indonesia.'],
     [('Apakah dokumen saya dipakai untuk melatih AI?', 'Teks dokumen dikirim ke penyedia AI hanya untuk diproses dan hasilnya dikembalikan kepada Anda. Hindari memakai fitur AI untuk dokumen yang sangat rahasia.'),
      ('Apakah gratis?', 'Akun Free mendapat jatah pemakaian AI yang terisi ulang berkala; paket Pro dan Business memberi jatah lebih besar.')],
     browser=False, related=['cari-jurnal-ebook', 'terjemahkan-pdf', 'pdf-ke-word'])

page('cari-jurnal-ebook', 'journals.html', 'Cari Jurnal & Ebook',
     'Cari Jurnal Ilmiah & Ebook Gratis (Open Access) | MyFlipbook',
     'Cari jurnal ilmiah (OpenAlex) dan ebook berlisensi terbuka (OAPEN, Internet Archive) dalam satu tempat, lalu '
     'langsung baca sebagai flipbook atau ringkas dengan AI.',
     'Cari Jurnal Ilmiah & Ebook Open Access dalam Satu Tempat',
     'Ketik topik penelitian Anda dan temukan jurnal dari OpenAlex serta ebook berlisensi terbuka — lalu baca langsung '
     'sebagai flipbook atau ringkas dengan AI untuk referensi tugas dan skripsi.',
     ['Buka Find Journal & Ebook dan ketik kata kunci topik.', 'Pilih hasil yang relevan.',
      'Baca sebagai flipbook, ringkas dengan AI, atau simpan ke My Library.'],
     ['Jurnal dari OpenAlex; ebook dari OAPEN Library dan Internet Archive (hanya lisensi Creative Commons / domain publik).', 'Cocok untuk mencari referensi skripsi, tesis, dan tugas.',
      'Terhubung langsung dengan AI Summarizer dan flipbook.'],
     [('Apakah jurnalnya gratis?', 'Artikel open access yang punya PDF publik bisa langsung dibaca dan dijadikan flipbook. Artikel tertutup tetap bisa dibuka di situs penerbitnya. Ebook yang ditampilkan hanya yang berlisensi terbuka.'),
      ('Bisa untuk referensi skripsi?', 'Bisa. Tetap periksa kredibilitas sumber dan tulis sitasinya sesuai pedoman kampus Anda.')],
     browser=False, related=['ringkas-pdf-ai', 'terjemahkan-pdf', 'pdf-ke-flipbook'])


def tool(slug, tool_id, name, title, description, h1, lead, steps, why, faq, browser=True, related=()):
    page(slug, f'converter.html?tool={tool_id}', name, title, description, h1, lead, steps, why, faq, browser, related)


tool('kompres-pdf', 'compress-pdf', 'Kompres PDF',
     'Kompres PDF Online — Perkecil Ukuran File PDF Tanpa Upload | MyFlipbook',
     'Perkecil ukuran file PDF agar mudah dikirim lewat email, WhatsApp, atau diunggah ke portal pendaftaran. Diproses '
     'di browser, file tidak diunggah.',
     'Kompres PDF — Perkecil Ukuran File dengan Mudah',
     'File PDF terlalu besar untuk diunggah ke portal pendaftaran, dikirim lewat WhatsApp, atau dilampirkan di email? '
     'Kecilkan ukurannya dalam beberapa detik.',
     ['Buka alat Kompres PDF dan pilih file.', 'Pilih tingkat kompresi: ringan (kualitas terbaik), seimbang, atau kuat (paling kecil).', 'Unduh PDF yang sudah lebih kecil.'],
     ['Cocok untuk syarat unggah berkas CPNS, beasiswa, dan pendaftaran kampus.', PRIVATE, 'Tanpa watermark pada hasil.'],
     [('Apakah kualitas PDF akan turun?', 'Kompresi mengecilkan gambar di dalam PDF. Pilih tingkat kompresi ringan bila kualitas gambar penting.'),
      ('Apakah file saya diunggah?', 'Tidak. Kompresi berjalan di browser Anda.')],
     related=['gabung-pdf', 'pisah-pdf', 'jpg-ke-pdf', 'pdf-ke-flipbook'])
tool('gabung-pdf', 'merge-pdf', 'Gabung PDF',
     'Gabung PDF Online — Satukan Beberapa File PDF Jadi Satu | MyFlipbook',
     'Gabungkan beberapa file PDF menjadi satu dokumen dengan urutan yang bisa diatur. Diproses di browser, file tidak diunggah.',
     'Gabung PDF — Satukan Banyak File Jadi Satu Dokumen',
     'Satukan KTP, ijazah, transkrip, dan dokumen lain menjadi satu PDF rapi — urutannya bisa diatur sebelum digabung.',
     ['Buka alat Gabung PDF dan pilih beberapa file.', 'Atur urutan file.', 'Gabungkan dan unduh hasilnya.'],
     ['Cocok untuk menyatukan berkas lamaran kerja dan pendaftaran.', PRIVATE, 'Tanpa batas jumlah halaman yang wajar.'],
     [('Berapa file yang bisa digabung?', 'Beberapa file sekaligus; batasnya hanya kemampuan memori perangkat Anda.'),
      ('Apakah file saya diunggah?', 'Tidak. Penggabungan berjalan di browser Anda.')],
     related=['pisah-pdf', 'kompres-pdf', 'atur-halaman-pdf', 'jpg-ke-pdf'])
tool('pisah-pdf', 'split-pdf', 'Pisah PDF',
     'Pisah PDF Online — Ambil Halaman Tertentu dari PDF | MyFlipbook',
     'Pisahkan PDF atau ambil halaman tertentu saja cukup dengan klik halamannya. Diproses di browser, file tidak diunggah.',
     'Pisah PDF — Ambil Halaman yang Anda Butuhkan',
     'Butuh hanya beberapa halaman dari PDF yang tebal? Klik halaman yang ingin diambil, lalu simpan sebagai PDF baru.',
     ['Buka alat Pisah PDF dan pilih file.', 'Klik halaman yang ingin diambil.', 'Unduh halaman terpilih sebagai PDF baru.'],
     ['Pilih halaman cukup dengan klik pratinjau.', PRIVATE, 'File asli tetap utuh.'],
     [('Apakah bisa memisahkan per halaman?', 'Bisa, pilih halaman yang diinginkan lalu simpan.'),
      ('Apakah file saya diunggah?', 'Tidak. Pemisahan berjalan di browser Anda.')],
     related=['gabung-pdf', 'atur-halaman-pdf', 'kompres-pdf'])
tool('pdf-ke-word', 'pdf-to-word', 'PDF ke Word',
     'PDF ke Word Online — Ubah PDF Jadi Dokumen Word yang Bisa Diedit | MyFlipbook',
     'Ubah PDF menjadi file Word (.docx) yang bisa diedit. Diproses di browser, file tidak diunggah.',
     'Ubah PDF ke Word yang Bisa Diedit',
     'Perlu mengedit isi PDF? Ubah menjadi dokumen Word (.docx), lalu sunting di Microsoft Word atau Google Docs.',
     ['Buka alat PDF ke Word dan pilih file.', 'Tunggu proses konversi.', 'Unduh file .docx dan edit sesukanya.'],
     ['Teks bisa langsung diedit.', PRIVATE, 'Untuk PDF hasil scan, jalankan OCR PDF terlebih dahulu.'],
     [('Apakah format tetap sama?', 'Teks dan paragraf dipertahankan sebisa mungkin; tata letak yang sangat rumit mungkin perlu dirapikan sedikit.'),
      ('Apakah PDF hasil scan bisa?', 'Gunakan OCR PDF dahulu agar teksnya terbaca.')],
     related=['word-ke-pdf', 'ocr-pdf', 'pdf-ke-excel', 'pdf-ke-ppt'])
tool('word-ke-pdf', 'word-to-pdf', 'Word ke PDF',
     'Word ke PDF Online — Ubah DOCX Jadi PDF | MyFlipbook',
     'Ubah dokumen Word (.doc/.docx) menjadi PDF dengan format yang rapi dan konsisten di semua perangkat.',
     'Ubah Word ke PDF dengan Format Rapi',
     'Kirim CV, surat, atau tugas dalam format PDF supaya tampilannya sama di semua perangkat.',
     ['Buka alat Word ke PDF dan pilih file .doc/.docx.', 'Tunggu konversi selesai.', 'Unduh PDF-nya.'],
     ['Format, font, dan tabel tetap rapi.', SERVER, 'Cocok untuk CV, surat lamaran, dan tugas.'],
     [('Perlu login?', 'Ya, konversi dokumen Office memerlukan akun (daftar gratis).'),
      ('Apakah file saya disimpan?', 'Tidak, file dihapus setelah hasilnya dikirim kembali.')],
     browser=False, related=['pdf-ke-word', 'excel-ke-pdf', 'ppt-ke-pdf', 'gabung-pdf'])
tool('jpg-ke-pdf', 'jpg-to-pdf', 'JPG ke PDF',
     'JPG ke PDF Online — Ubah Foto & Gambar Jadi PDF | MyFlipbook',
     'Ubah foto JPG/PNG menjadi satu file PDF, misalnya foto dokumen, KTP, atau tugas tulisan tangan. Diproses di browser.',
     'Ubah Foto JPG ke PDF',
     'Foto dokumen, KTP, atau tugas tulisan tangan? Satukan beberapa gambar menjadi satu PDF yang rapi.',
     ['Buka alat JPG ke PDF dan pilih gambar.', 'Atur urutan, orientasi, ukuran halaman (A4, Letter, atau sesuai gambar), dan margin.', 'Unduh PDF-nya.'],
     ['Mendukung JPG, PNG, WebP, HEIC (foto iPhone), TIFF, dan lainnya.', PRIVATE, 'Banyak gambar sekaligus jadi satu PDF.'],
     [('Bisa dari HP?', 'Bisa, langsung dari browser HP.'), ('Apakah gambar saya diunggah?', 'Tidak. Konversi berjalan di browser Anda.')],
     related=['pdf-ke-jpg', 'gabung-pdf', 'kompres-pdf'])
tool('pdf-ke-jpg', 'pdf-to-jpg', 'PDF ke JPG',
     'PDF ke JPG Online — Simpan Halaman PDF Jadi Gambar | MyFlipbook',
     'Ubah setiap halaman PDF menjadi gambar JPG berkualitas tinggi. Diproses di browser, file tidak diunggah.',
     'Ubah Halaman PDF Menjadi Gambar JPG',
     'Ambil halaman PDF sebagai gambar untuk diunggah ke media sosial, presentasi, atau dikirim lewat chat.',
     ['Buka alat PDF ke JPG dan pilih file.', 'Pilih halaman dan kualitas gambar.', 'Unduh gambar JPG.'],
     ['Kualitas gambar tinggi.', PRIVATE],
     [('Apakah semua halaman bisa diubah?', 'Bisa, semua atau sebagian halaman.')],
     related=['jpg-ke-pdf', 'pisah-pdf', 'kompres-pdf'])
tool('pdf-ke-excel', 'pdf-to-excel', 'PDF ke Excel',
     'PDF ke Excel Online — Ambil Tabel dari PDF | MyFlipbook',
     'Ambil tabel dari PDF dan ubah menjadi file Excel yang bisa diolah. Diproses di browser, file tidak diunggah.',
     'Ubah Tabel PDF ke Excel',
     'Laporan keuangan atau data tabel dalam PDF? Ubah ke Excel supaya bisa langsung dihitung dan diolah.',
     ['Buka alat PDF ke Excel dan pilih file.', 'Tunggu tabel dikenali.', 'Unduh file Excel.'],
     ['Tabel dipindahkan ke baris dan kolom.', PRIVATE],
     [('Bagaimana dengan PDF hasil scan?', 'Jalankan OCR PDF dahulu agar angka dan teksnya terbaca.')],
     related=['excel-ke-pdf', 'pdf-ke-word', 'ocr-pdf'])
tool('excel-ke-pdf', 'excel-to-pdf', 'Excel ke PDF',
     'Excel ke PDF Online — Ubah XLSX Jadi PDF | MyFlipbook',
     'Ubah spreadsheet Excel (.xls/.xlsx/.csv) menjadi PDF yang rapi untuk laporan dan lampiran.',
     'Ubah Excel ke PDF',
     'Kirim laporan, anggaran, atau rekap nilai dalam bentuk PDF yang rapi dan tidak bisa berubah tanpa sengaja.',
     ['Buka alat Excel ke PDF dan pilih file.', 'Tunggu konversi.', 'Unduh PDF-nya.'],
     ['Mendukung .xls, .xlsx, dan .csv.', SERVER],
     [('Perlu login?', 'Ya, konversi dokumen Office memerlukan akun (daftar gratis).')],
     browser=False, related=['pdf-ke-excel', 'word-ke-pdf', 'ppt-ke-pdf'])
tool('pdf-ke-ppt', 'pdf-to-ppt', 'PDF ke PowerPoint',
     'PDF ke PPT Online — Ubah PDF Jadi Slide PowerPoint | MyFlipbook',
     'Ubah PDF menjadi slide PowerPoint (.pptx) untuk presentasi. Diproses di browser, file tidak diunggah.',
     'Ubah PDF ke Slide PowerPoint',
     'Punya materi dalam PDF dan perlu dipresentasikan? Ubah menjadi slide PowerPoint.',
     ['Buka alat PDF ke PPT dan pilih file.', 'Tunggu konversi.', 'Unduh file .pptx.'],
     ['Setiap halaman jadi satu slide.', PRIVATE],
     [('Apakah bisa diedit di Google Slides?', 'Bisa, file .pptx bisa dibuka di PowerPoint maupun Google Slides.')],
     related=['ppt-ke-pdf', 'pdf-ke-word', 'pdf-ke-flipbook'])
tool('ppt-ke-pdf', 'ppt-to-pdf', 'PowerPoint ke PDF',
     'PPT ke PDF Online — Ubah Slide PowerPoint Jadi PDF | MyFlipbook',
     'Ubah presentasi PowerPoint (.ppt/.pptx) menjadi PDF yang mudah dibagikan.',
     'Ubah PowerPoint ke PDF',
     'Bagikan materi presentasi sebagai PDF supaya tampil sama di semua perangkat — atau lanjutkan jadi flipbook.',
     ['Buka alat PPT ke PDF dan pilih file.', 'Tunggu konversi.', 'Unduh PDF-nya.'],
     ['Tampilan slide tetap rapi.', SERVER],
     [('Perlu login?', 'Ya, konversi dokumen Office memerlukan akun (daftar gratis).')],
     browser=False, related=['pdf-ke-ppt', 'pdf-ke-flipbook', 'word-ke-pdf'])
tool('ocr-pdf', 'ocr-pdf', 'OCR PDF',
     'OCR PDF Online — Jadikan PDF Hasil Scan Bisa Dicari & Disalin | MyFlipbook',
     'Kenali teks pada PDF hasil scan atau foto agar bisa dicari, disalin, dan dikonversi. Mendukung Bahasa Indonesia. '
     'Diproses di browser.',
     'OCR PDF — Ubah Hasil Scan Jadi Teks',
     'PDF hasil scan tidak bisa dicari atau disalin? OCR mengenali teks di dalamnya sehingga dokumen bisa dicari, disalin, '
     'dan diubah ke Word.',
     ['Buka alat OCR PDF dan pilih file hasil scan.', 'Pilih bahasa dokumen.', 'Unduh PDF yang teksnya bisa dicari.'],
     ['Mendukung Bahasa Indonesia dan Inggris.', PRIVATE],
     [('Seberapa akurat?', 'Sangat bergantung pada kejelasan hasil scan. Scan yang tegak dan terang memberi hasil terbaik.')],
     related=['pdf-ke-word', 'pdf-ke-excel', 'terjemahkan-pdf'])
tool('putar-pdf', 'rotate-pdf', 'Putar PDF',
     'Putar PDF Online — Rotasi Halaman PDF | MyFlipbook',
     'Putar halaman PDF yang miring atau terbalik, satu per satu atau sekaligus. Diproses di browser.',
     'Putar Halaman PDF', 'Halaman hasil scan terbalik atau miring? Putar halaman yang perlu saja, lalu simpan.',
     ['Buka alat Putar PDF dan pilih file.', 'Putar halaman yang diinginkan.', 'Unduh hasilnya.'], [PRIVATE],
     [('Bisa memutar satu halaman saja?', 'Bisa, per halaman atau semua halaman sekaligus.')],
     related=['atur-halaman-pdf', 'potong-pdf', 'pisah-pdf'])
tool('potong-pdf', 'crop-pdf', 'Potong PDF',
     'Crop PDF Online — Potong Margin Halaman PDF | MyFlipbook',
     'Potong (crop) margin atau area tertentu pada halaman PDF. Diproses di browser.',
     'Potong (Crop) Halaman PDF', 'Buang margin kosong atau ambil bagian tertentu dari halaman PDF.',
     ['Buka alat Crop PDF dan pilih file.', 'Atur area potong.', 'Unduh hasilnya.'], [PRIVATE],
     [('Apakah isi di luar area hilang?', 'Area di luar potongan disembunyikan dari tampilan halaman.')],
     related=['putar-pdf', 'atur-halaman-pdf', 'kompres-pdf'])
tool('atur-halaman-pdf', 'organize-pdf', 'Atur Halaman PDF',
     'Atur Halaman PDF — Urutkan, Hapus & Pindah Halaman | MyFlipbook',
     'Urutkan ulang, hapus, atau pindahkan halaman PDF dengan seret-lepas. Diproses di browser.',
     'Atur Ulang Halaman PDF', 'Urutan halaman salah atau ada halaman yang tidak perlu? Atur dengan seret-lepas.',
     ['Buka alat Atur PDF dan pilih file.', 'Seret halaman ke urutan baru atau hapus yang tidak perlu.', 'Unduh hasilnya.'],
     [PRIVATE], [('Apakah file asli berubah?', 'Tidak, hasilnya disimpan sebagai file baru.')],
     related=['pisah-pdf', 'gabung-pdf', 'putar-pdf'])
tool('nomor-halaman-pdf', 'page-numbers', 'Nomor Halaman PDF',
     'Tambah Nomor Halaman PDF Online | MyFlipbook',
     'Tambahkan nomor halaman ke PDF dengan posisi yang bisa diatur — cocok untuk skripsi, makalah, dan laporan.',
     'Tambahkan Nomor Halaman ke PDF', 'Skripsi, makalah, atau laporan perlu nomor halaman? Tambahkan dalam beberapa klik.',
     ['Buka alat Nomor Halaman dan pilih file.', 'Pilih posisi dan format nomor.', 'Unduh hasilnya.'], [PRIVATE],
     [('Posisinya bisa diatur?', 'Bisa, di pojok atas atau bawah, kiri atau kanan.')],
     related=['watermark-pdf', 'gabung-pdf', 'atur-halaman-pdf'])
tool('watermark-pdf', 'watermark', 'Watermark PDF',
     'Tambah Watermark ke PDF Online | MyFlipbook',
     'Tambahkan watermark teks ke PDF untuk menandai dokumen sebagai rahasia, draf, atau milik Anda. Diproses di browser.',
     'Tambahkan Watermark ke PDF', 'Tandai dokumen dengan teks seperti "RAHASIA", "DRAF", atau nama Anda sebelum dibagikan.',
     ['Buka alat Watermark dan pilih file.', 'Tulis teks watermark dan atur tampilannya.', 'Unduh hasilnya.'], [PRIVATE],
     [('Apakah file asli berubah?', 'Tidak, hasil ber-watermark disimpan sebagai file baru.')],
     related=['nomor-halaman-pdf', 'kompres-pdf', 'pdf-ke-flipbook'])


def esc(text):
    return html.escape(str(text), quote=True)


STYLE = '''
:root{--ink:#1C1917;--muted:#6B635B;--pine:#1A3C34;--tang:#FF5C28;--hair:#E8E2D4;--paper:#fff;--bg:#FBFAF7}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 'Plus Jakarta Sans',system-ui,sans-serif}
a{color:var(--pine)}.wrap{max-width:980px;margin:0 auto;padding:0 18px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 0}
header img{height:34px;width:auto;display:block}header nav{display:flex;gap:14px;flex-wrap:wrap;font-size:14px}
header nav a{text-decoration:none;color:var(--ink);font-weight:600}
.hero{padding:42px 0 26px}.hero h1{font:700 clamp(30px,5vw,48px)/1.12 'Fraunces',Georgia,serif;margin:0 0 14px;letter-spacing:-.5px}
.hero p{font-size:18px;color:var(--muted);max-width:720px;margin:0 0 22px}
.cta{display:inline-block;background:linear-gradient(180deg,#FF7A45,#FF5C28);color:#fff;text-decoration:none;font-weight:700;
  padding:14px 24px;border-radius:14px;border:1px solid #E04E1F;box-shadow:0 10px 22px rgba(255,92,40,.3)}
.cta:hover{transform:translateY(-2px)}.note{font-size:14px;color:var(--muted);margin-top:10px}
section{padding:22px 0}h2{font:700 26px/1.25 'Fraunces',Georgia,serif;margin:0 0 14px}
.card{background:var(--paper);border:1px solid var(--hair);border-radius:18px;padding:20px 22px;box-shadow:0 10px 26px rgba(28,25,23,.06)}
ol.steps{counter-reset:s;list-style:none;padding:0;margin:0;display:grid;gap:12px}
ol.steps li{counter-increment:s;position:relative;padding-left:46px}
ol.steps li::before{content:counter(s);position:absolute;left:0;top:-2px;width:32px;height:32px;border-radius:50%;background:var(--pine);
  color:#FFF7EA;display:grid;place-items:center;font-weight:700}
ul.why{margin:0;padding-left:20px;display:grid;gap:8px}
details{border-bottom:1px solid var(--hair);padding:12px 0}details:last-child{border-bottom:0}
summary{font-weight:700;cursor:pointer}details p{margin:8px 0 0;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
@media(max-width:520px){header nav{gap:10px;font-size:13px;justify-content:flex-end}header img{height:28px}}
.grid a{display:block;background:var(--paper);border:1px solid var(--hair);border-radius:14px;padding:12px 14px;text-decoration:none;
  color:var(--ink);font-weight:600}.grid a:hover{border-color:var(--pine)}
footer{border-top:1px solid var(--hair);margin-top:30px;padding:22px 0 40px;font-size:14px;color:var(--muted)}
footer a{color:var(--muted)}
'''


def all_tools_links(skip=''):
    return ''.join(f'<a href="/{s}">{esc(p["name"])}</a>' for s, p in LANDING.items() if s != skip)


def head(title, description, path, extra=''):
    url = SITE + path
    return f'''<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{esc(url)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="{BRAND}">
<meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{esc(url)}"><meta property="og:image" content="{OG_IMAGE}"><meta property="og:image:width" content="{OG_SIZE[0]}"><meta property="og:image:height" content="{OG_SIZE[1]}"><meta property="og:locale" content="id_ID">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{esc(title)}"><meta name="twitter:description" content="{esc(description)}">
<link rel="icon" type="image/png" href="/assets/img/favicon.png?v=green">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png?v=green">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>{STYLE}</style>
<script>try{{if(!localStorage.getItem('pdf-tools-lang'))localStorage.setItem('pdf-tools-lang','id')}}catch(e){{}}</script>
<script src="/assets/i18n.js"></script>
<script src="/assets/auth.js" defer></script>
{extra}
</head>'''


def ld(data):
    return '<script type="application/ld+json">' + json.dumps(data, ensure_ascii=False).replace('</', '<\\/') + '</script>'


def landing_html(slug):
    p = LANDING[slug]
    path = '/' + slug
    data = [
        {'@context': 'https://schema.org', '@type': 'WebApplication', 'name': f"{p['name']} — {BRAND}", 'url': SITE + path,
         'description': p['description'], 'applicationCategory': 'BusinessApplication', 'operatingSystem': 'Web, Android, Windows',
         'inLanguage': 'id', 'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'IDR'}},
        {'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': [
            {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in p['faq']]},
        {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': BRAND, 'item': SITE + '/'},
            {'@type': 'ListItem', 'position': 2, 'name': p['name'], 'item': SITE + path}]},
    ]
    related = ''.join(f'<a href="/{s}">{esc(LANDING[s]["name"])}</a>' for s in p['related'] if s in LANDING)
    privacy = PRIVATE if p['browser'] and PRIVATE not in p['why'] else ''
    return head(p['title'], p['description'], path, ''.join(ld(d) for d in data)) + f'''
<body><div class="wrap">
<header><a href="/" aria-label="{BRAND}"><img src="/assets/img/logo.png?v=green" alt="{BRAND}" width="128" height="34"></a>
<nav><a href="/pdf-ke-flipbook">PDF ke Flipbook</a><a href="/converter.html">Semua alat PDF</a><a href="/login.html">Masuk</a></nav></header>
<main>
<div class="hero"><h1>{esc(p['h1'])}</h1><p>{esc(p['lead'])}</p>
<a class="cta" href="/{esc(p['link'])}">Mulai {esc(p['name'])} sekarang →</a>
<div class="note">{esc(TRIAL)}{(' ' + esc(privacy)) if privacy else ''}</div></div>
<section><h2>Cara memakai {esc(p['name'])}</h2><div class="card"><ol class="steps">{''.join(f'<li>{esc(s)}</li>' for s in p['steps'])}</ol></div></section>
<section><h2>Kenapa memakai MyFlipbook?</h2><div class="card"><ul class="why">{''.join(f'<li>{esc(w)}</li>' for w in p['why'])}</ul></div></section>
<section><h2>Pertanyaan yang sering diajukan</h2><div class="card">{''.join(f'<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in p['faq'])}</div></section>
<section><h2>Alat terkait</h2><div class="grid">{related}</div></section>
<section><h2>Semua alat MyFlipbook</h2><div class="grid">{all_tools_links(slug)}</div></section>
</main>
<footer>© {time.strftime('%Y')} {BRAND} — dikelola oleh Sarvamaya. <a href="/privacy.html">Kebijakan Privasi</a> · <a href="/terms.html">Syarat &amp; Ketentuan</a> · <a href="/">Beranda</a></footer>
</div></body></html>'''


# Meta tags for the app pages (served with these added before </head>).
APP_META = {
    'index.html': ('MyFlipbook adalah alat PDF lengkap berbahasa Indonesia: buat flipbook dari PDF, kompres, gabung, pisah, '
                   'ubah PDF ke Word/Excel/PPT, OCR, terjemahkan, dan ringkas dengan AI.', '/'),
    'converter.html': ('Semua alat PDF dalam satu tempat: kompres, gabung, pisah, putar, OCR, PDF ke Word/Excel/PPT/JPG, '
                       'dan sebaliknya. Sebagian besar berjalan langsung di browser.', '/converter.html'),
    'flipbook.html': (LANDING['pdf-ke-flipbook']['description'], '/flipbook.html'),
    'journals.html': (LANDING['cari-jurnal-ebook']['description'], '/journals.html'),
    'notebook.html': (LANDING['ringkas-pdf-ai']['description'], '/notebook.html'),
    'workflow.html': ('Buat alur kerja PDF sendiri: gabungkan beberapa alat menjadi satu langkah otomatis.', '/workflow.html'),
    'privacy.html': (None, '/privacy.html'),
    'terms.html': (None, '/terms.html'),
}
NOINDEX = {'login.html', 'account.html', 'library.html', 'coming-soon.html', 'animation.html'}


def verification():
    """Search Console / Bing ownership tags (GOOGLE_SITE_VERIFICATION, BING_SITE_VERIFICATION in .env)."""
    out = ''
    for env, name in (('GOOGLE_SITE_VERIFICATION', 'google-site-verification'), ('BING_SITE_VERIFICATION', 'msvalidate.01')):
        for code in os.environ.get(env, '').split(','):
            if code.strip():
                out += f'<meta name="{name}" content="{esc(code.strip())}">'
    return out


def app_head(page_name):
    """Tags added to an app page's <head> (bytes), or b'' when it has none."""
    if page_name in NOINDEX:
        return b'<meta name="robots" content="noindex">'
    if page_name not in APP_META:
        return b''
    description, path = APP_META[page_name]
    tags = [f'<link rel="canonical" href="{SITE}{path}">', f'<meta property="og:site_name" content="{BRAND}">',
            f'<meta property="og:url" content="{SITE}{path}">', f'<meta property="og:image" content="{OG_IMAGE}">',
            '<meta property="og:type" content="website">', '<meta name="twitter:card" content="summary_large_image">',
            f'<meta property="og:image:width" content="{OG_SIZE[0]}">', f'<meta property="og:image:height" content="{OG_SIZE[1]}">']
    if description:
        tags += [f'<meta name="description" content="{esc(description)}">', f'<meta property="og:description" content="{esc(description)}">']
    if page_name == 'index.html':
        tags.append(verification())
        tags.append(f'<meta property="og:title" content="{esc(HOME_TITLE)}">')
        tags.append(ld({'@context': 'https://schema.org', '@graph': [
            {'@type': 'Organization', 'name': BRAND, 'url': SITE + '/', 'logo': SITE + '/assets/img/logo.png'},
            {'@type': 'WebSite', 'name': BRAND, 'url': SITE + '/', 'inLanguage': ['id', 'en']}]}))
    return ''.join(tags).encode('utf-8')


def footer_links():
    """Plain links to every landing page (the home page's tool grid is built by script)."""
    links = ' <span style="color:#D6CFBF">·</span> '.join(
        f'<a href="/{s}" style="color:#78716C">{esc(p["name"])}</a>' for s, p in LANDING.items())
    return f'<nav aria-label="Alat PDF" style="text-align:center;font-size:11px;font-weight:600;margin-top:10px;line-height:2">{links}</nav>'.encode('utf-8')


def add_head(page_name, body):
    extra = app_head(page_name)
    if not extra:
        return body
    i = body.find(b'</head>')
    body = body[:i] + extra + body[i:] if i >= 0 else body
    if page_name == 'index.html':
        # The title search engines see (the page's script still switches it to the visitor's language).
        body = re.sub(rb'(<title[^>]*>)[^<]*(</title>)', lambda m: m[1] + esc(HOME_TITLE).encode() + m[2], body, count=1)
        i = body.rfind(b'</footer>')
        body = body[:i] + footer_links() + body[i:] if i >= 0 else body
    return body


def robots():
    return ('User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin/\nDisallow: /s/\n'
            'Disallow: /account.html\nDisallow: /library.html\nDisallow: /login.html\n\n'
            f'Sitemap: {SITE}/sitemap.xml\n')


def sitemap():
    urls = [('/', '1.0')] + [('/' + s, '0.9') for s in LANDING] + [
        (APP_META[p][1], '0.7') for p in ('converter.html', 'flipbook.html', 'journals.html', 'notebook.html', 'workflow.html')] + [
        ('/privacy.html', '0.2'), ('/terms.html', '0.2')]
    rows = ''.join(f'<url><loc>{esc(SITE + u)}</loc><lastmod>{UPDATED}</lastmod><priority>{pr}</priority></url>' for u, pr in urls)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{rows}</urlset>\n'


CACHE = {}


def respond(path):
    """(bytes, content type) for /robots.txt, /sitemap.xml and the landing pages; None otherwise."""
    slug = path.strip('/')
    if path == '/robots.txt':
        return robots().encode(), 'text/plain; charset=utf-8'
    if path == '/sitemap.xml':
        return sitemap().encode(), 'application/xml; charset=utf-8'
    if slug in LANDING and path == '/' + slug:
        if slug not in CACHE:
            CACHE[slug] = landing_html(slug).encode('utf-8')
        return CACHE[slug], 'text/html; charset=utf-8'
    return None
