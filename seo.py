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

import accounts
import articles

SITE = 'https://myflipbookpro.com'
BRAND = 'MyFlipbook Pro'
CONTACT = 'cs@myflipbookpro.com'
# The business behind the site (shown in every footer and in the Organization schema).
ADDRESS = 'Sarvamaya — Jl. H. Khair No. 59, Ragunan, Ps. Minggu, Jakarta Selatan, DKI Jakarta 12550'
PHONE = '+62 852-8631-2477'
WA_LOCAL = '0852-8631-2477'   # WhatsApp
PHONE_INTL = '6285286312477'           # the footers show the number (owner: no WhatsApp label)
POSTAL = {'@type': 'PostalAddress', 'streetAddress': 'Jl. H. Khair No. 59, Ragunan', 'addressLocality': 'Pasar Minggu, Jakarta Selatan',
          'addressRegion': 'DKI Jakarta', 'postalCode': '12550', 'addressCountry': 'ID'}
OG_IMAGE = SITE + '/assets/img/hero-id-1671.jpg'   # the Indonesian banner (main site language)
OG_SIZE = (1671, 941)
HOME_TITLE = 'Buat Flipbook dari PDF & Alat PDF Gratis | MyFlipbook Pro'
# The titles search engines see on the app pages (their scripts may still switch the tab title).
APP_TITLES = {
    'index.html': HOME_TITLE,
    'converter.html': 'Alat PDF Online Lengkap | MyFlipbook Pro',
    'flipbook.html': 'PDF ke Flipbook Gratis, Bisa Offline | MyFlipbook Pro',
    'journals.html': 'Cari Jurnal Ilmiah & Ebook Open Access | MyFlipbook Pro',
    'notebook.html': 'AI Summarizer: Ringkas PDF & Jurnal | MyFlipbook Pro',
    'workflow.html': 'Alur Kerja PDF Otomatis | MyFlipbook Pro',
    'editor.html': 'Edit PDF Online seperti Word | MyFlipbook Pro',
    'authors.html': 'Profil Penulis & h-index ala Publish or Perish | MyFlipbook Pro',
}
UPDATED = '2026-10-09'

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
TRIAL = 'Daftar gratis — tanpa kartu kredit.'      # no trial mentioned for now (owner, 2026-10-20)
# PDF to flipbook stores nothing on its own, but My Library and share links do (share.py: public, not encrypted).
FLIPBOOK_PRIVACY = ('Tidak, kecuali Anda memilihnya. Flipbook dibuat langsung di browser Anda. File baru tersimpan di server bila '
                    'Anda menyimpannya ke My Library (tersimpan terenkripsi) atau membuat share link (bisa dibuka siapa pun yang '
                    'memegang link-nya, jadi jangan bagikan dokumen rahasia).')

page('pdf-ke-flipbook', 'flipbook.html', 'PDF ke Flipbook',
     'PDF ke Flipbook Gratis, Bisa Offline | MyFlipbook Pro',
     'Ubah PDF menjadi flipbook interaktif dengan efek bolak-balik halaman seperti buku asli. Bisa dibagikan lewat link, '
     'dibaca dengan suara, diterjemahkan, dan diekspor ke HTML, APK, atau EXE.',
     'Ubah File PDF Menjadi Buku Digital yang Bisa Dibalik',
     'Majalah, katalog produk, modul ajar, laporan tahunan, atau e-book — unggah PDF-nya dan dalam hitungan detik '
     'jadi flipbook dengan efek halaman yang realistis, siap dibagikan ke siapa pun.',
     ['Buka PDF to Flipbook, lalu pilih file PDF dari komputer, HP, atau Google Drive.',
      'Atur sampul, tampilan, dan baca hasilnya langsung — bisa layar penuh, stabilo, dan coretan spidol.',
      'Simpan ke My Library, bagikan lewat link, atau ekspor jadi HTML offline, aplikasi Android (APK), atau Windows (EXE).'],
     ['Efek bolak-balik halaman yang halus, terasa seperti membuka buku cetak.',
      'Audio book: halaman dibacakan dengan suara, termasuk setelah diterjemahkan ke Bahasa Indonesia.',
      'Terjemahkan seluruh buku dengan tombol Translate, layout tetap mengikuti kolom aslinya.',
      'Stabilo, catatan, dan spidol untuk belajar atau presentasi.'],
     [('Apakah membuat flipbook di MyFlipbook gratis?', 'Membaca dan membuat flipbook bisa dicoba gratis. Ekspor HTML offline tersedia di paket Medium; aplikasi Android (APK) dan Windows (EXE) di paket Pro.'),
      ('PDF seperti apa yang bisa dijadikan flipbook?', 'Hampir semua PDF: majalah, katalog, buku, modul, jurnal, portofolio, hingga PDF hasil scan. Halaman bergambar tetap bisa distabilo dan dibacakan berkat OCR.'),
      ('Bagaimana cara membagikan flipbook?', 'Simpan ke My Library lalu buat share link. Siapa pun yang punya link bisa membacanya di browser tanpa perlu login.'),
      ('Apakah bisa dibuka tanpa internet?', 'Bisa. Ekspor flipbook ke HTML offline atau jadikan aplikasi Android/Windows supaya bisa dibaca tanpa koneksi.'),
      ('Apakah PDF saya disimpan di server?', FLIPBOOK_PRIVACY)],
     browser=False, related=['terjemahkan-pdf', 'pdf-jadi-audiobook', 'kompres-pdf', 'gabung-pdf'])

page('terjemahkan-pdf', 'flipbook.html', 'Terjemahkan PDF',
     'Terjemahkan PDF ke Indonesia, Layout Tetap | MyFlipbook Pro',
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
     'PDF Jadi Audiobook, Buku Dibacakan | MyFlipbook Pro',
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
     'Ringkas PDF & Jurnal dengan AI | MyFlipbook Pro',
     'Buat ringkasan PDF otomatis dengan AI: rangkuman poin penting per bab, terjemahan, hingga tanya jawab tentang dokumen Anda. '
     'Cocok untuk jurnal, skripsi, laporan, dan materi kuliah.',
     'Ringkas PDF dengan AI dalam Hitungan Detik',
     'Unggah jurnal, laporan, atau materi kuliah — AI Summarizer membuat ringkasan poin penting, menjawab pertanyaan '
     'tentang isinya, menerjemahkan, bahkan menjawab pertanyaan Anda tentang isinya.',
     ['Buka AI Summarizer dan tambahkan sumber: PDF, dokumen, atau link.',
      'Pilih jenis hasil: ringkasan, terjemahan, atau tanya jawab.', 'Salin atau simpan hasilnya.'],
     ['Hemat waktu membaca jurnal dan laporan panjang.', 'Bisa menggabungkan beberapa sumber sekaligus.',
      'Ringkasan dalam Bahasa Indonesia.'],
     [('Apakah dokumen saya dipakai untuk melatih AI?', 'Teks dokumen dikirim ke penyedia AI hanya untuk diproses dan hasilnya dikembalikan kepada Anda. Hindari memakai fitur AI untuk dokumen yang sangat rahasia.'),
      ('Apakah gratis?', 'AI Summarizer termasuk paket Medium dan Pro.')],
     browser=False, related=['cari-jurnal-ebook', 'terjemahkan-pdf', 'pdf-ke-word'])

page('cari-jurnal-ebook', 'journals.html', 'Cari Jurnal & Ebook',
     'Cari Jurnal & Ebook Gratis (Open Access) | MyFlipbook Pro',
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
     'Kompres PDF Online Tanpa Upload | MyFlipbook Pro',
     'Perkecil ukuran file PDF agar mudah dikirim lewat email, WhatsApp, atau diunggah ke portal pendaftaran. Diproses '
     'di browser, file tidak diunggah.',
     'Kompres PDF — Perkecil Ukuran File dengan Mudah',
     'File PDF terlalu besar untuk diunggah ke portal pendaftaran, dikirim lewat WhatsApp, atau dilampirkan di email? '
     'Kecilkan ukurannya dalam beberapa detik.',
     ['Pilih atau seret file PDF ke kotak di atas.',
      'Pilih target ukuran: maks 100 KB, 200 KB, 500 KB, 1 MB, atau kualitas terbaik. MyFlipbook mencari kualitas paling bagus yang masih masuk target.',
      'Unduh PDF yang sudah lebih kecil.'],
     ['Cocok untuk syarat unggah berkas CPNS, beasiswa, dan pendaftaran kampus yang membatasi ukuran file.', PRIVATE, 'Tanpa watermark pada hasil.'],
     [('Apakah kualitas PDF akan turun?', 'Kompresi mengecilkan gambar di dalam PDF; teks tetap tajam. Pilih target yang lebih besar atau "Kualitas terbaik" bila kualitas gambar penting.'),
      ('Bagaimana kalau ukurannya tidak bisa sampai 100 KB?', 'PDF yang sebagian besar berisi teks atau gambar vektor sudah kecil dan tidak bisa dikecilkan lagi. MyFlipbook akan memberi tahu dan tetap memberikan hasil terkecilnya.'),
      ('Apakah file saya diunggah?', 'Tidak. Kompresi berjalan di browser Anda.')],
     related=['gabung-pdf', 'pisah-pdf', 'jpg-ke-pdf', 'pdf-ke-flipbook'])
tool('gabung-pdf', 'merge-pdf', 'Gabung PDF',
     'Gabung PDF Online Jadi Satu File | MyFlipbook Pro',
     'Gabungkan beberapa file PDF menjadi satu dokumen dengan urutan yang bisa diatur. Diproses di browser, file tidak diunggah.',
     'Gabung PDF — Satukan Banyak File Jadi Satu Dokumen',
     'Satukan KTP, ijazah, transkrip, dan dokumen lain menjadi satu PDF rapi — urutannya bisa diatur sebelum digabung.',
     ['Buka alat Gabung PDF dan pilih beberapa file.', 'Atur urutan file.', 'Gabungkan dan unduh hasilnya.'],
     ['Cocok untuk menyatukan berkas lamaran kerja dan pendaftaran.', PRIVATE, 'Tanpa batas jumlah halaman yang wajar.'],
     [('Berapa file yang bisa digabung?', 'Beberapa file sekaligus; batasnya hanya kemampuan memori perangkat Anda.'),
      ('Apakah file saya diunggah?', 'Tidak. Penggabungan berjalan di browser Anda.')],
     related=['pisah-pdf', 'kompres-pdf', 'atur-halaman-pdf', 'jpg-ke-pdf'])
tool('pisah-pdf', 'split-pdf', 'Pisah PDF',
     'Pisah PDF, Ambil Halaman Tertentu | MyFlipbook Pro',
     'Pisahkan PDF atau ambil halaman tertentu saja cukup dengan klik halamannya. Diproses di browser, file tidak diunggah.',
     'Pisah PDF — Ambil Halaman yang Anda Butuhkan',
     'Butuh hanya beberapa halaman dari PDF yang tebal? Klik halaman yang ingin diambil, lalu simpan sebagai PDF baru.',
     ['Buka alat Pisah PDF dan pilih file.', 'Klik halaman yang ingin diambil.', 'Unduh halaman terpilih sebagai PDF baru.'],
     ['Pilih halaman cukup dengan klik pratinjau.', PRIVATE, 'File asli tetap utuh.'],
     [('Apakah bisa memisahkan per halaman?', 'Bisa, pilih halaman yang diinginkan lalu simpan.'),
      ('Apakah file saya diunggah?', 'Tidak. Pemisahan berjalan di browser Anda.')],
     related=['gabung-pdf', 'atur-halaman-pdf', 'kompres-pdf'])
tool('pdf-ke-word', 'pdf-to-word', 'PDF ke Word',
     'PDF ke Word Online, Bisa Diedit | MyFlipbook Pro',
     'Ubah PDF menjadi file Word (.docx) yang bisa diedit. Diproses di browser, file tidak diunggah.',
     'Ubah PDF ke Word yang Bisa Diedit',
     'Perlu mengedit isi PDF? Ubah menjadi dokumen Word (.docx), lalu sunting di Microsoft Word atau Google Docs.',
     ['Buka alat PDF ke Word dan pilih file.', 'Tunggu proses konversi.', 'Unduh file .docx dan edit sesukanya.'],
     ['Teks bisa langsung diedit.', PRIVATE, 'Untuk PDF hasil scan, jalankan OCR PDF terlebih dahulu.'],
     [('Apakah format tetap sama?', 'Teks dan paragraf dipertahankan sebisa mungkin; tata letak yang sangat rumit mungkin perlu dirapikan sedikit.'),
      ('Apakah PDF hasil scan bisa?', 'Gunakan OCR PDF dahulu agar teksnya terbaca.')],
     related=['word-ke-pdf', 'ocr-pdf', 'pdf-ke-excel', 'pdf-ke-ppt'])
tool('word-ke-pdf', 'word-to-pdf', 'Word ke PDF',
     'Word ke PDF Online — Ubah DOCX Jadi PDF | MyFlipbook Pro',
     'Ubah dokumen Word (.doc/.docx) menjadi PDF dengan format yang rapi dan konsisten di semua perangkat.',
     'Ubah Word ke PDF dengan Format Rapi',
     'Kirim CV, surat, atau tugas dalam format PDF supaya tampilannya sama di semua perangkat.',
     ['Buka alat Word ke PDF dan pilih file .doc/.docx.', 'Tunggu konversi selesai.', 'Unduh PDF-nya.'],
     ['Format, font, dan tabel tetap rapi.', SERVER, 'Cocok untuk CV, surat lamaran, dan tugas.'],
     [('Perlu login?', 'Ya, konversi dokumen Office memerlukan akun (daftar gratis).'),
      ('Apakah file saya disimpan?', 'Tidak, file dihapus setelah hasilnya dikirim kembali.')],
     browser=False, related=['pdf-ke-word', 'excel-ke-pdf', 'ppt-ke-pdf', 'gabung-pdf'])
tool('jpg-ke-pdf', 'jpg-to-pdf', 'JPG ke PDF',
     'JPG ke PDF Online, Foto Jadi PDF | MyFlipbook Pro',
     'Ubah foto JPG/PNG menjadi satu file PDF, misalnya foto dokumen, KTP, atau tugas tulisan tangan. Diproses di browser.',
     'Ubah Foto JPG ke PDF',
     'Foto dokumen, KTP, atau tugas tulisan tangan? Satukan beberapa gambar menjadi satu PDF yang rapi.',
     ['Buka alat JPG ke PDF dan pilih gambar.', 'Atur urutan, orientasi, ukuran halaman (A4, Letter, atau sesuai gambar), dan margin.', 'Unduh PDF-nya.'],
     ['Mendukung JPG, PNG, WebP, HEIC (foto iPhone), TIFF, dan lainnya.', PRIVATE, 'Banyak gambar sekaligus jadi satu PDF.'],
     [('Bisa dari HP?', 'Bisa, langsung dari browser HP.'), ('Apakah gambar saya diunggah?', 'Tidak. Konversi berjalan di browser Anda.')],
     related=['pdf-ke-jpg', 'gabung-pdf', 'kompres-pdf'])
tool('pdf-ke-jpg', 'pdf-to-jpg', 'PDF ke JPG',
     'PDF ke JPG Online, Halaman Jadi Gambar | MyFlipbook Pro',
     'Ubah setiap halaman PDF menjadi gambar JPG berkualitas tinggi. Diproses di browser, file tidak diunggah.',
     'Ubah Halaman PDF Menjadi Gambar JPG',
     'Ambil halaman PDF sebagai gambar untuk diunggah ke media sosial, presentasi, atau dikirim lewat chat.',
     ['Buka alat PDF ke JPG dan pilih file.', 'Pilih halaman dan kualitas gambar.', 'Unduh gambar JPG.'],
     ['Kualitas gambar tinggi.', PRIVATE],
     [('Apakah semua halaman bisa diubah?', 'Bisa, semua atau sebagian halaman.')],
     related=['jpg-ke-pdf', 'pisah-pdf', 'kompres-pdf'])
tool('pdf-ke-excel', 'pdf-to-excel', 'PDF ke Excel',
     'PDF ke Excel Online — Ambil Tabel dari PDF | MyFlipbook Pro',
     'Ambil tabel dari PDF dan ubah menjadi file Excel yang bisa diolah. Diproses di browser, file tidak diunggah.',
     'Ubah Tabel PDF ke Excel',
     'Laporan keuangan atau data tabel dalam PDF? Ubah ke Excel supaya bisa langsung dihitung dan diolah.',
     ['Buka alat PDF ke Excel dan pilih file.', 'Tunggu tabel dikenali.', 'Unduh file Excel.'],
     ['Tabel dipindahkan ke baris dan kolom.', PRIVATE],
     [('Bagaimana dengan PDF hasil scan?', 'Jalankan OCR PDF dahulu agar angka dan teksnya terbaca.')],
     related=['excel-ke-pdf', 'pdf-ke-word', 'ocr-pdf'])
tool('excel-ke-pdf', 'excel-to-pdf', 'Excel ke PDF',
     'Excel ke PDF Online — Ubah XLSX Jadi PDF | MyFlipbook Pro',
     'Ubah spreadsheet Excel (.xls/.xlsx/.csv) menjadi PDF yang rapi untuk laporan dan lampiran.',
     'Ubah Excel ke PDF',
     'Kirim laporan, anggaran, atau rekap nilai dalam bentuk PDF yang rapi dan tidak bisa berubah tanpa sengaja.',
     ['Buka alat Excel ke PDF dan pilih file.', 'Tunggu konversi.', 'Unduh PDF-nya.'],
     ['Mendukung .xls, .xlsx, dan .csv.', SERVER],
     [('Perlu login?', 'Ya, konversi dokumen Office memerlukan akun (daftar gratis).')],
     browser=False, related=['pdf-ke-excel', 'word-ke-pdf', 'ppt-ke-pdf'])
tool('pdf-ke-ppt', 'pdf-to-ppt', 'PDF ke PowerPoint',
     'PDF ke PPT Online, Jadi Slide PowerPoint | MyFlipbook Pro',
     'Ubah PDF menjadi slide PowerPoint (.pptx) untuk presentasi. Diproses di browser, file tidak diunggah.',
     'Ubah PDF ke Slide PowerPoint',
     'Punya materi dalam PDF dan perlu dipresentasikan? Ubah menjadi slide PowerPoint.',
     ['Buka alat PDF ke PPT dan pilih file.', 'Tunggu konversi.', 'Unduh file .pptx.'],
     ['Setiap halaman jadi satu slide.', PRIVATE],
     [('Apakah bisa diedit di Google Slides?', 'Bisa, file .pptx bisa dibuka di PowerPoint maupun Google Slides.')],
     related=['ppt-ke-pdf', 'pdf-ke-word', 'pdf-ke-flipbook'])
tool('ppt-ke-pdf', 'ppt-to-pdf', 'PowerPoint ke PDF',
     'PPT ke PDF Online, Slide Jadi PDF | MyFlipbook Pro',
     'Ubah presentasi PowerPoint (.ppt/.pptx) menjadi PDF yang mudah dibagikan.',
     'Ubah PowerPoint ke PDF',
     'Bagikan materi presentasi sebagai PDF supaya tampil sama di semua perangkat — atau lanjutkan jadi flipbook.',
     ['Buka alat PPT ke PDF dan pilih file.', 'Tunggu konversi.', 'Unduh PDF-nya.'],
     ['Tampilan slide tetap rapi.', SERVER],
     [('Perlu login?', 'Ya, konversi dokumen Office memerlukan akun (daftar gratis).')],
     browser=False, related=['pdf-ke-ppt', 'pdf-ke-flipbook', 'word-ke-pdf'])
tool('ocr-pdf', 'ocr-pdf', 'OCR PDF',
     'OCR PDF Online, Hasil Scan Bisa Dicari | MyFlipbook Pro',
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
     'Putar PDF Online — Rotasi Halaman PDF | MyFlipbook Pro',
     'Putar halaman PDF yang miring atau terbalik, satu per satu atau sekaligus. Diproses di browser.',
     'Putar Halaman PDF', 'Halaman hasil scan terbalik atau miring? Putar halaman yang perlu saja, lalu simpan.',
     ['Buka alat Putar PDF dan pilih file.', 'Putar halaman yang diinginkan.', 'Unduh hasilnya.'], [PRIVATE],
     [('Bisa memutar satu halaman saja?', 'Bisa, per halaman atau semua halaman sekaligus.')],
     related=['atur-halaman-pdf', 'potong-pdf', 'pisah-pdf'])
tool('potong-pdf', 'crop-pdf', 'Potong PDF',
     'Crop PDF Online — Potong Margin Halaman PDF | MyFlipbook Pro',
     'Potong (crop) margin atau area tertentu pada halaman PDF. Diproses di browser.',
     'Potong (Crop) Halaman PDF', 'Buang margin kosong atau ambil bagian tertentu dari halaman PDF.',
     ['Buka alat Crop PDF dan pilih file.', 'Atur area potong.', 'Unduh hasilnya.'], [PRIVATE],
     [('Apakah isi di luar area hilang?', 'Area di luar potongan disembunyikan dari tampilan halaman.')],
     related=['putar-pdf', 'atur-halaman-pdf', 'kompres-pdf'])
tool('atur-halaman-pdf', 'organize-pdf', 'Atur Halaman PDF',
     'Atur Halaman PDF: Urutkan & Hapus | MyFlipbook Pro',
     'Urutkan ulang, hapus, atau pindahkan halaman PDF dengan seret-lepas. Diproses di browser.',
     'Atur Ulang Halaman PDF', 'Urutan halaman salah atau ada halaman yang tidak perlu? Atur dengan seret-lepas.',
     ['Buka alat Atur PDF dan pilih file.', 'Seret halaman ke urutan baru atau hapus yang tidak perlu.', 'Unduh hasilnya.'],
     [PRIVATE], [('Apakah file asli berubah?', 'Tidak, hasilnya disimpan sebagai file baru.')],
     related=['pisah-pdf', 'gabung-pdf', 'putar-pdf'])
tool('nomor-halaman-pdf', 'page-numbers', 'Nomor Halaman PDF',
     'Tambah Nomor Halaman PDF Online | MyFlipbook Pro',
     'Tambahkan nomor halaman ke PDF dengan posisi yang bisa diatur — cocok untuk skripsi, makalah, dan laporan.',
     'Tambahkan Nomor Halaman ke PDF', 'Skripsi, makalah, atau laporan perlu nomor halaman? Tambahkan dalam beberapa klik.',
     ['Buka alat Nomor Halaman dan pilih file.', 'Pilih posisi dan format nomor.', 'Unduh hasilnya.'], [PRIVATE],
     [('Posisinya bisa diatur?', 'Bisa, di pojok atas atau bawah, kiri atau kanan.')],
     related=['watermark-pdf', 'gabung-pdf', 'atur-halaman-pdf'])
tool('watermark-pdf', 'watermark', 'Watermark PDF',
     'Tambah Watermark ke PDF Online | MyFlipbook Pro',
     'Tambahkan watermark teks ke PDF untuk menandai dokumen sebagai rahasia, draf, atau milik Anda. Diproses di browser.',
     'Tambahkan Watermark ke PDF', 'Tandai dokumen dengan teks seperti "RAHASIA", "DRAF", atau nama Anda sebelum dibagikan.',
     ['Buka alat Watermark dan pilih file.', 'Tulis teks watermark dan atur tampilannya.', 'Unduh hasilnya.'], [PRIVATE],
     [('Apakah file asli berubah?', 'Tidak, hasil ber-watermark disimpan sebagai file baru.')],
     related=['nomor-halaman-pdf', 'kompres-pdf', 'pdf-ke-flipbook'])

tool('tanda-tangan-pdf', 'sign-pdf', 'Tanda Tangan PDF',
     'Tanda Tangan PDF Online Gratis | MyFlipbook Pro',
     'Tanda tangani PDF langsung di browser: gambar tanda tangan, ketik nama, atau upload gambar, lalu taruh di halaman. '
     'File tidak diunggah ke server.',
     'Tanda Tangan PDF Tanpa Print dan Scan',
     'Surat perjanjian, formulir, atau dokumen kantor yang perlu ditandatangani? Tidak perlu mencetak lalu memindai ulang — '
     'tanda tangani PDF langsung di HP atau laptop.',
     ['Buka alat Tanda Tangan PDF dan pilih file.',
      'Buat tanda tangan: gambar dengan jari/mouse, ketik nama, atau upload gambar tanda tangan (PNG/JPG).',
      'Klik halaman tempat tanda tangan, geser dan atur ukurannya, lalu unduh PDF yang sudah ditandatangani.'],
     ['Bisa memasang tanda tangan di beberapa halaman sekaligus.', PRIVATE,
      'PNG berlatar transparan menghasilkan tanda tangan yang paling rapi.'],
     [('Apakah ini tanda tangan elektronik tersertifikasi?', 'Bukan. Alat ini menempelkan gambar tanda tangan Anda di halaman, seperti tanda tangan basah yang dipindai. Untuk dokumen yang wajib memakai tanda tangan elektronik tersertifikasi, gunakan layanan penyelenggara sertifikasi elektronik resmi.'),
      ('Apakah bisa dari HP?', 'Bisa. Tanda tangan bisa digambar langsung dengan jari di layar HP.'),
      ('Apakah file saya diunggah?', 'Tidak. Semua proses berjalan di browser Anda.')],
     related=['isi-formulir-pdf', 'gabung-pdf', 'kompres-pdf', 'scan-ke-pdf'])
tool('scan-ke-pdf', 'scan-to-pdf', 'Scan ke PDF',
     'Scan Dokumen ke PDF dengan Kamera HP | MyFlipbook Pro',
     'Foto dokumen dengan kamera HP dan jadikan PDF yang bersih: latar kertas diputihkan, tulisan lebih tegas. Langsung di '
     'browser, tanpa memasang aplikasi.',
     'Scan Dokumen ke PDF Langsung dari Kamera HP',
     'Tidak punya mesin scanner? Foto dokumen dengan HP — MyFlipbook merapikan fotonya menjadi PDF yang bersih dan mudah dibaca.',
     ['Buka Scan ke PDF di browser HP dan tekan tombol Foto dokumen.',
      'Ambil satu foto untuk setiap halaman (atau pilih foto dari galeri).',
      'Pilih tampilan Dokumen, Abu-abu, atau Warna asli, lalu unduh PDF-nya.'],
     ['Mode Dokumen memutihkan latar kertas dan menegaskan tulisan.', 'Ukuran A4 mengikuti orientasi foto, atau sama dengan ukuran foto.', PRIVATE],
     [('Apakah perlu aplikasi scanner?', 'Tidak. Cukup browser di HP; kamera terbuka langsung dari halaman ini.'),
      ('Apakah tepi kertas dipotong otomatis?', 'Belum. Ambil foto tegak lurus dari atas dan isi bingkai dengan kertas agar hasilnya rapi.'),
      ('Bagaimana membuat PDF-nya bisa dicari teksnya?', 'Setelah jadi, jalankan OCR PDF agar teks di hasil scan bisa dicari dan disalin.')],
     related=['jpg-ke-pdf', 'ocr-pdf', 'kompres-pdf', 'gabung-pdf'])
tool('isi-formulir-pdf', 'pdf-forms', 'Isi Formulir PDF',
     'Isi Formulir PDF Online, Ketik Langsung | MyFlipbook Pro',
     'Isi kolom formulir PDF (teks, centang, pilihan) langsung di browser, lalu simpan. Bisa dikunci agar isian tidak '
     'bisa diubah lagi.',
     'Isi Formulir PDF Tanpa Mencetak',
     'Formulir pendaftaran atau administrasi dalam bentuk PDF isian? Ketik jawabannya langsung, simpan, lalu kirim.',
     ['Buka alat Isi Formulir PDF dan pilih file formulir.',
      'Isi setiap kolom yang ditemukan: teks, centang, atau pilihan.',
      'Centang Kunci isian bila perlu, lalu unduh PDF yang sudah terisi.'],
     ['Membaca kolom teks, kotak centang, dropdown, dan pilihan ganda.', 'Opsi kunci (flatten) agar isian tidak bisa diubah.', PRIVATE],
     [('Bagaimana kalau PDF saya tidak punya kolom isian?', 'Gunakan Edit PDF untuk menambahkan teks di atas halaman.'),
      ('Apakah semua formulir didukung?', 'Formulir PDF standar (AcroForm) didukung. Formulir XFA belum, dan kolom formulir hanya bisa diisi huruf Latin.')],
     related=['tanda-tangan-pdf', 'gabung-pdf', 'kompres-pdf'])
tool('sensor-pdf', 'redact-pdf', 'Sensor PDF (Redact)',
     'Sensor PDF Permanen (Redact) Online | MyFlipbook Pro',
     'Hitamkan NIK, nomor rekening, atau data pribadi di PDF secara permanen — teks di bawah kotak benar-benar dihapus, '
     'bukan sekadar ditutupi.',
     'Sensor Data Pribadi di PDF Secara Permanen',
     'Mau membagikan dokumen tapi ada NIK, alamat, atau nomor rekening? Hitamkan bagian itu — dan pastikan teks di '
     'baliknya benar-benar hilang.',
     ['Buka alat Sensor PDF dan pilih file.',
      'Seret kotak di area yang mau disensor, atau ketik teks (misalnya NIK) lalu tandai semua kemunculannya.',
      'Unduh PDF yang sudah disensor.'],
     ['Benar-benar permanen: halaman yang disensor diubah menjadi gambar, sehingga teks di bawah kotak tidak bisa disalin atau dicari.',
      PRIVATE, 'Cari teks sekaligus di semua halaman.'],
     [('Apa bedanya dengan menutup pakai kotak hitam biasa?', 'Kotak biasa hanya menutupi tampilan — teks di bawahnya masih bisa disalin. Di sini halaman yang disensor dibuat ulang sebagai gambar, jadi teksnya hilang.'),
      ('Apakah teks lain di halaman itu masih bisa dipilih?', 'Tidak. Seluruh halaman yang diberi kotak menjadi gambar; halaman lain tetap seperti semula.')],
     related=['tanda-tangan-pdf', 'kompres-pdf', 'watermark-pdf'])
tool('bandingkan-pdf', 'compare-pdf', 'Bandingkan PDF',
     'Bandingkan Dua PDF, Temukan Perubahan | MyFlipbook Pro',
     'Bandingkan dua versi PDF dan lihat baris yang dihapus (merah) dan ditambah (hijau) lengkap dengan nomor halamannya. '
     'Cocok untuk kontrak dan revisi dokumen.',
     'Bandingkan Dua Versi PDF, Lihat Bedanya',
     'Revisi kontrak, draf skripsi, atau penawaran harga — temukan apa saja yang berubah tanpa membaca ulang seluruh dokumen.',
     ['Buka alat Bandingkan PDF.', 'Pilih dua file: versi lama dulu, lalu versi baru.',
      'Lihat laporan perubahan dan unduh sebagai file HTML bila perlu.'],
     ['Baris yang dihapus ditandai merah, yang ditambah hijau, lengkap dengan nomor halaman.', PRIVATE],
     [('Apakah perubahan gambar ikut dibandingkan?', 'Belum. Yang dibandingkan adalah teksnya, baris demi baris.'),
      ('Bagaimana dengan PDF hasil scan?', 'Jalankan OCR PDF dulu pada kedua file agar teksnya bisa dibandingkan.')],
     related=['pdf-ke-word', 'ocr-pdf', 'gabung-pdf'])


def esc(text):
    return html.escape(str(text), quote=True)


STYLE = '''
:root{--ink:#1C1917;--muted:#6B635B;--pine:#1A3C34;--tang:#FF5C28;--hair:#E8E2D4;--paper:#fff;--bg:#FBFAF7}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 'Plus Jakarta Sans',system-ui,sans-serif}
a{color:var(--pine)}.wrap{max-width:980px;margin:0 auto;padding:0 18px}
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
.list{display:grid;gap:12px}.list a{display:block;background:var(--paper);border:1px solid var(--hair);border-radius:16px;
  padding:16px 18px;text-decoration:none;color:var(--ink)}.list a:hover{border-color:var(--pine)}
.list b{display:block;font:700 18px/1.35 'Fraunces',Georgia,serif;margin-bottom:4px}.list span{color:var(--muted);font-size:14.5px}
article p,article li{font-size:17px}article h2{margin-top:30px}article ol,article ul{padding-left:22px;display:grid;gap:6px}
.crumb{font-size:13.5px;color:var(--muted);margin-top:24px}.crumb a{color:var(--muted)}.date{color:var(--muted);font-size:14px;margin:0 0 18px}
.tip{background:#F1F6EA;border:1px solid #D8E6C6;border-radius:14px;padding:14px 16px;margin:18px 0}
.table{overflow-x:auto;margin:16px 0 6px;border:1px solid #E8E2D4;border-radius:14px;background:#fff}
.table table{border-collapse:collapse;width:100%;min-width:640px;font-size:13px}
.table th,.table td{padding:10px 12px;border-bottom:1px solid #EFEAE0;text-align:left;vertical-align:top}
.table thead th{background:#F7F3EA;font-weight:700}.table tbody th{font-weight:700;width:22%}
.table tr:last-child th,.table tr:last-child td{border-bottom:0}
.box{background:var(--pine);color:#FFF7EA;border-radius:18px;padding:22px;margin:30px 0}.box h2{color:#FFF7EA;margin:0 0 8px}
.box p{margin:0 0 14px;color:#E8EFE6}
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
<link rel="icon" type="image/png" href="/assets/img/favicon.png?v=pro">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png?v=pro">
{PWA_HEAD}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>{STYLE}</style>
<script>try{{if(!localStorage.getItem('pdf-tools-lang'))localStorage.setItem('pdf-tools-lang','id')}}catch(e){{}}</script>
<script src="/assets/i18n.js"></script>
<script defer src="/assets/site-header.js"></script>
<script src="/assets/auth.js" defer></script>
{extra}
</head>'''


def ld(data):
    return '<script type="application/ld+json">' + json.dumps(data, ensure_ascii=False).replace('</', '<\\/') + '</script>'


# ---------- Tools right on their landing pages (no second page to open). Each entry: the box's
# HTML, its scripts (deferred, so the page still renders first) and its CSS.
WIDGET_CSS = '''
.qc{background:var(--paper);border:1.5px solid var(--ink);border-radius:20px;padding:18px;margin:6px 0 18px;box-shadow:6px 6px 0 var(--ink);max-width:720px}
.qc-drop{display:flex;flex-direction:column;align-items:center;gap:4px;border:2px dashed #C9CFC2;border-radius:16px;padding:22px 14px;text-align:center;cursor:pointer;background:#FBFAF7}
.qc-drop.qc-drag{border-color:var(--tang);background:#FFF7ED}.qc-drop b{font-size:16px}.qc-drop span{font-size:13.5px;color:var(--muted)}
.qc-input{position:absolute;width:1px;height:1px;opacity:0}
.hero .qc p{margin:0;max-width:none;font-size:14px;color:var(--muted)}
.hero .qc .qc-label{font-size:13px;font-weight:700;margin:16px 0 8px}
.qc-presets{display:flex;flex-wrap:wrap;gap:8px}
.qc-preset{border:1.5px solid var(--hair);background:#fff;border-radius:999px;padding:9px 14px;font:700 14px 'Plus Jakarta Sans',system-ui,sans-serif;cursor:pointer;color:var(--ink)}
.qc-preset[aria-pressed=true]{background:var(--pine);border-color:var(--pine);color:#fff}
.hero .qc .qc-file{font-weight:600;color:var(--ink);margin:14px 0 0;overflow-wrap:anywhere}.qc-file:empty{display:none}
.qc-bar{height:8px;border-radius:999px;background:#E7E0D2;overflow:hidden;margin-top:12px}.qc-bar span{display:block;height:100%;width:0;background:linear-gradient(90deg,#FF7A45,#FF5C28);transition:width .2s}
.hero .qc .qc-status{margin:10px 0 0}.qc-status:empty{display:none}.hero .qc .qc-status.qc-error{color:#9A5B00}
.qc-result{margin-top:12px}.hero .qc .qc-sizes{font:700 20px/1.3 'Fraunces',Georgia,serif;color:var(--ink);margin:0 0 12px}
.qc-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.qc-again{border:1.5px solid var(--hair);background:#fff;border-radius:14px;padding:13px 18px;font:700 14px 'Plus Jakarta Sans',system-ui,sans-serif;cursor:pointer}
.alt{display:inline-block;margin-top:6px;font-size:14px;font-weight:600}
[hidden]{display:none!important}
'''
WIDGETS = {
    'kompres-pdf': dict(
        html='''<div class="qc" id="quick-compress">
<label class="qc-drop"><input class="qc-input" type="file" accept=".pdf,application/pdf"><b>📄 Pilih PDF atau seret ke sini</b>
<span>Diproses di browser Anda — file tidak diunggah</span></label>
<p class="qc-label">Target ukuran</p>
<div class="qc-presets" role="group" aria-label="Target ukuran">
<button type="button" class="qc-preset" data-target="102400" aria-pressed="false">Maks 100 KB</button>
<button type="button" class="qc-preset" data-target="204800" aria-pressed="false">Maks 200 KB</button>
<button type="button" class="qc-preset" data-target="512000" aria-pressed="true">Maks 500 KB</button>
<button type="button" class="qc-preset" data-target="1048576" aria-pressed="false">Maks 1 MB</button>
<button type="button" class="qc-preset" data-target="0" aria-pressed="false">Kualitas terbaik</button>
</div>
<p class="qc-file"></p>
<div class="qc-bar" hidden><span></span></div>
<p class="qc-status" role="status"></p>
<div class="qc-result" hidden><p class="qc-sizes"></p>
<div class="qc-actions"><a class="cta qc-download" href="#">⬇ Unduh PDF</a><button type="button" class="qc-again">Kompres file lain</button></div></div>
</div>''',
        scripts=['/assets/vendor/pdf-lib.min.js', '/assets/pdf-compress.js', '/assets/landing-compress.js']),
}


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
    guides = [a for a in articles.ARTICLES if a['tool'] == slug]
    guide_html = (f'<section><h2>Panduan terkait</h2><div class="list">{"".join(article_card(a) for a in guides)}</div></section>'
                  if guides else '')
    widget = WIDGETS.get(slug)
    extra = ''.join(ld(d) for d in data)
    if widget:
        extra += f'<style>{WIDGET_CSS}</style>' + ''.join(f'<script src="{src}" defer></script>' for src in widget['scripts'])
        # The tool itself, then the full tool page as an alternative.
        start = (widget['html'] + f'\n<a class="alt" href="/{esc(p["link"])}">Butuh lebih banyak pilihan? Buka {esc(p["name"])} lengkap →</a>')
    else:
        start = f'<a class="cta" href="/{esc(p["link"])}">Mulai {esc(p["name"])} sekarang →</a>'
    return head(p['title'], p['description'], path, extra) + f'''
<body><div class="wrap">
{TOP}
<main>
<div class="hero"><h1>{esc(p['h1'])}</h1><p>{esc(p['lead'])}</p>
{start}
<div class="note">{esc(TRIAL)}{(' ' + esc(privacy)) if privacy else ''}</div></div>
<section><h2>Cara memakai {esc(p['name'])}</h2><div class="card"><ol class="steps">{''.join(f'<li>{esc(s)}</li>' for s in p['steps'])}</ol></div></section>
<section><h2>Kenapa memakai MyFlipbook?</h2><div class="card"><ul class="why">{''.join(f'<li>{esc(w)}</li>' for w in p['why'])}</ul></div></section>
<section><h2>Pertanyaan yang sering diajukan</h2><div class="card">{''.join(f'<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in p['faq'])}</div></section>
{guide_html}
<section><h2>Alat terkait</h2><div class="grid">{related}</div></section>
<section><h2>Semua alat MyFlipbook</h2><div class="grid">{all_tools_links(slug)}</div></section>
</main>
{FOOT}
</div></body></html>'''


TOP = '<header data-site-header></header>'          # assets/site-header.js: the same header as every page
FOOT = (f'<footer>© {time.strftime("%Y")} {BRAND} — dikelola oleh Sarvamaya. <a href="/artikel">Artikel</a> · '
        '<a href="/privacy.html">Kebijakan Privasi</a> · <a href="/terms.html">Syarat &amp; Ketentuan</a> · '
        '<a href="mailto:cs@myflipbookpro.com">cs@myflipbookpro.com</a> · <a href="/">Beranda</a>'
        f'<br>📍 {esc(ADDRESS)} · 📞 <a href="tel:+{PHONE_INTL}">{WA_LOCAL}</a></footer>')
ARTICLES = {a['slug']: a for a in articles.ARTICLES}
MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
LINK = re.compile(r'\[([^\]]+)\]\((/[^)\s]*)\)')


def rich(text):
    """Escaped text with [label](/path) turned into internal links."""
    return LINK.sub(lambda m: f'<a href="{m[2]}">{m[1]}</a>', esc(text))


def tanggal(day):
    y, m, d = (int(x) for x in day.split('-'))
    return f'{d} {MONTHS[m - 1]} {y}'


def article_card(a):
    return f'<a href="/artikel/{a["slug"]}"><b>{esc(a["title"])}</b><span>{esc(a["description"])}</span></a>'


def article_html(slug):
    a = ARTICLES[slug]
    path = f'/artikel/{slug}'
    body = []
    for kind, value in a['blocks']:
        if kind == 'p':
            body.append(f'<p>{rich(value)}</p>')
        elif kind == 'h2':
            body.append(f'<h2>{esc(value)}</h2>')
        elif kind in ('ol', 'ul'):
            body.append(f'<{kind}>' + ''.join(f'<li>{rich(i)}</li>' for i in value) + f'</{kind}>')
        elif kind == 'tip':
            body.append(f'<div class="tip"><b>Tips:</b> {rich(value)}</div>')
        elif kind == 'table':
            cols = ''.join(f'<th scope="col">{esc(c)}</th>' for c in value['head'])
            rows = ''.join('<tr><th scope="row">' + esc(r[0]) + '</th>' + ''.join(f'<td>{esc(c)}</td>' for c in r[1:]) + '</tr>'
                           for r in value['rows'])
            sources = ' · '.join(f'<a href="{esc(u)}" rel="nofollow noopener" target="_blank">{esc(n)}</a>' for n, u in value.get('sources', []))
            body.append(f'<div class="table"><table><thead><tr>{cols}</tr></thead><tbody>{rows}</tbody></table></div>'
                        f'<p class="date">{esc(value.get("note", ""))}{"<br>Sumber: " + sources if sources else ""}</p>')
        elif kind == 'faq':
            body.append('<h2>Pertanyaan umum</h2><div class="card">' + ''.join(
                f'<details><summary>{esc(q)}</summary><p>{rich(ans)}</p></details>' for q, ans in value) + '</div>')
        elif kind == 'cta':
            t = LANDING[value]
            body.append(f'<div class="box"><h2>Coba {esc(t["name"])} sekarang</h2><p>{esc(TRIAL)}</p>'
                        f'<a class="cta" href="/{esc(t["link"])}">Buka {esc(t["name"])} →</a></div>')
    others = [x for x in articles.ARTICLES if x['slug'] != slug][:5]
    data = [
        {'@context': 'https://schema.org', '@type': 'BlogPosting', 'headline': a['title'], 'description': a['description'],
         'datePublished': a['published'], 'dateModified': a['updated'], 'inLanguage': 'id', 'image': OG_IMAGE,
         'mainEntityOfPage': SITE + path, 'author': {'@type': 'Organization', 'name': BRAND, 'url': SITE + '/'},
         'publisher': {'@type': 'Organization', 'name': BRAND, 'logo': {'@type': 'ImageObject', 'url': SITE + '/assets/img/logo.png'}}},
        {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': BRAND, 'item': SITE + '/'},
            {'@type': 'ListItem', 'position': 2, 'name': 'Artikel', 'item': SITE + '/artikel'},
            {'@type': 'ListItem', 'position': 3, 'name': a['title'], 'item': SITE + path}]},
    ]
    faq = [qa for kind, value in a['blocks'] if kind == 'faq' for qa in value]
    if faq:
        data.append({'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': [
            {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': ans}} for q, ans in faq]})
    title = a['title'] + ' | ' + BRAND
    page = head(title if len(title) <= 60 else a['title'], a['description'], path, ''.join(ld(d) for d in data)).replace(
        '<meta property="og:type" content="website">', '<meta property="og:type" content="article">')
    return page + f'''
<body><div class="wrap">
{TOP}
<main><article>
<p class="crumb"><a href="/">Beranda</a> › <a href="/artikel">Artikel</a></p>
<div class="hero" style="padding:14px 0 6px"><h1>{esc(a['title'])}</h1></div>
<p class="date">Diperbarui {tanggal(a['updated'])} · Tim {BRAND}</p>
{''.join(body)}
</article>
<section><h2>Artikel lainnya</h2><div class="list">{''.join(article_card(x) for x in others)}</div></section>
<section><h2>Semua alat MyFlipbook</h2><div class="grid">{all_tools_links()}</div></section>
</main>
{FOOT}
</div></body></html>'''


HARGA_FAQ_EN = {
    'Bagaimana cara membayar?': ('How do I pay?', 'Log in, choose a plan, then pay by QRIS, bank transfer (virtual account) or e-wallet. The plan turns on as soon as the payment goes through.'),
}


def harga_html():
    faq = [('Bagaimana cara membayar?', 'Masuk ke akun, pilih paket, lalu bayar lewat QRIS, transfer bank (virtual account), atau e-wallet. Paket aktif otomatis setelah pembayaran berhasil.')]
    data = [{'@context': 'https://schema.org', '@type': 'Product', 'name': f'{BRAND} {p["name"]}', 'description': PLAN_DESC.get(k, ''),
             'brand': BRAND, 'offers': {'@type': 'Offer', 'price': str(p['monthly']), 'priceCurrency': 'IDR', 'url': SITE + '/harga'}}
            for k, p in accounts.PLANS.items() if p['monthly']]
    data.append({'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': [
        {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in faq]})
    return head(f'Harga Paket | {BRAND}', 'Harga paket MyFlipbook Pro dalam Rupiah: Basic (gratis), Medium, dan Pro. Ekspor flipbook offline, '
                'aplikasi Android dan Windows, share link, dan semua alat PDF.', '/harga', ''.join(ld(d) for d in data)) + f'''
<body><div class="wrap">
{TOP}
<main>
<style>{PRICE_STYLE}</style>
<div class="hero">{plan_section('h1')}</div>
<section>{both('Pertanyaan yang sering diajukan', 'Frequently asked questions', 'h2')}<div class="card">{''.join(f'<details>{both(esc(q), HARGA_FAQ_EN.get(q, ("", ""))[0] or q, "summary")}{both(esc(a), HARGA_FAQ_EN.get(q, ("", ""))[1] or a, "p")}</details>' for q, a in faq)}</div></section>
</main>
{FOOT}
</div></body></html>'''


# ---------- Segment pages (/untuk/<slug>): one page per kind of reader, in the words they search with.
# tools: landing slugs (cards); guides: article slugs; claims must match what the product does.
SEGMENTS_UPDATED = '2026-10-15'      # when the segment pages last changed (sitemap lastmod)
SEGMENTS = {
    'akademisi': dict(
        name='Akademisi', title='Alat Baca & Terjemah Jurnal untuk Akademisi | MyFlipbook Pro',
        description='Untuk dosen, peneliti, dan mahasiswa: cari jurnal open access, terjemahkan jurnal berbahasa Inggris dengan '
                    'layout tetap, ringkas dengan AI, lalu baca sebagai buku lengkap dengan stabilo dan catatan.',
        h1='Baca, Terjemahkan, dan Pahami Jurnal Lebih Cepat',
        lead='Satu tempat untuk mahasiswa, dosen, dan peneliti: dari mencari jurnal open access sampai membacanya dengan nyaman '
             'dalam Bahasa Indonesia, tanpa berpindah-pindah aplikasi.',
        pains=['Jurnal berbahasa Inggris memakan waktu lama untuk dipahami.',
               'Terjemahan biasa merusak susunan kolom, tabel, dan gambar.',
               'Puluhan PDF tercecer, catatan tersebar di mana-mana.'],
        tools=['cari-jurnal-ebook', 'terjemahkan-pdf', 'ringkas-pdf-ai', 'pdf-ke-flipbook', 'gabung-pdf', 'ocr-pdf'],
        steps=['Cari jurnal open access di Cari Jurnal, lalu klik "Jadikan Flipbook".',
               'Terjemahkan ke Bahasa Indonesia; teks mengikuti kolom aslinya.',
               'Ringkas dengan AI Summarizer, lalu tandai bagian penting dengan stabilo dan catatan.'],
        guides=['cara-menerjemahkan-jurnal-bahasa-inggris', 'cara-merangkum-jurnal-dengan-ai', 'cara-mencari-jurnal-open-access',
                'cara-membaca-jurnal-dengan-cepat', 'cara-menggabungkan-jurnal-jadi-buku-referensi'],
        faq=[('Apakah jurnal berbayar bisa dibuka?', 'Tidak. Cari Jurnal hanya menjadikan flipbook artikel open access yang PDF-nya tersedia untuk umum. Artikel tertutup tetap bisa dibuka di situs penerbitnya.'),
             ('Apakah AI Summarizer gratis?', 'AI Summarizer termasuk paket Medium dan Pro.'),
             ('Bisakah dipakai untuk buku ajar?', 'Bisa. Ubah buku ajar PDF menjadi flipbook dan bagikan lewat share link, atau ekspor ke HTML offline (paket Medium) agar mahasiswa bisa membacanya tanpa internet.')]),
    'pembaca': dict(
        name='Pembaca Buku', title='Baca Ebook PDF Seperti Buku di HP | MyFlipbook Pro',
        description='Baca ebook dan buku PDF dengan nyaman seperti buku asli, dengarkan dibacakan, terjemahkan seluruh buku ke '
                    'Bahasa Indonesia, dan temukan ebook serta majalah gratis yang legal.',
        h1='Baca Ebook PDF dengan Nyaman, Seperti Buku Asli',
        lead='Halaman yang bisa dibalik, suara yang membacakan, dan terjemahan seluruh buku. Membaca PDF di HP maupun laptop jadi '
             'tidak melelahkan lagi.',
        pains=['Membaca PDF di HP harus terus zoom dan geser.',
               'Buku berbahasa Inggris sulit dinikmati.',
               'Tidak sempat membaca, tapi ingin tetap "membaca" sambil beraktivitas.'],
        tools=['pdf-ke-flipbook', 'pdf-jadi-audiobook', 'terjemahkan-pdf', 'cari-jurnal-ebook', 'kompres-pdf', 'jpg-ke-pdf'],
        steps=['Buka PDF ke Flipbook, lalu tambahkan ebook dari HP, laptop, atau Google Drive.',
               'Baca dengan efek membalik halaman; tandai dengan stabilo dan catatan.',
               'Tekan Audio book untuk mendengarkan, atau Translate untuk membaca dalam Bahasa Indonesia.'],
        guides=['cara-membuat-flipbook-dari-pdf', 'cara-membaca-jurnal-pdf-lebih-nyaman', 'cara-mencari-jurnal-open-access'],
        faq=[('Apakah bisa dibaca tanpa internet?', 'Bisa, dengan mengekspor flipbook ke HTML offline (paket Medium) atau aplikasi Android (paket Pro).'),
             ('Di mana mencari ebook gratis?', 'Buka Cari Jurnal & Ebook, tab Ebook atau Majalah. Isinya buku dan majalah berlisensi bebas yang legal, langsung bisa dijadikan flipbook.'),
             ('Apakah buku saya diunggah ke server?', 'Tidak, kecuali Anda memilih menyimpannya ke My Library (tersimpan terenkripsi) atau membuat share link.')]),
    'penulis': dict(
        name='Penulis & Penerbit', title='Terbitkan Ebook Jadi Flipbook & Aplikasi | MyFlipbook Pro',
        description='Untuk penulis dan penerbit indie: terbitkan ebook sebagai flipbook dengan share link, jadikan aplikasi Android '
                    'atau Windows, tambahkan watermark dan audio book, tanpa coding.',
        h1='Terbitkan Ebook Sendiri, dari Flipbook sampai Aplikasi',
        lead='Naskah PDF Anda jadi flipbook yang bisa dibagikan lewat link, dibaca offline, didengarkan, bahkan dipasang sebagai '
             'aplikasi di HP pembaca.',
        pains=['Ingin menerbitkan sendiri tanpa repot membuat website atau aplikasi.',
               'Khawatir naskah disebar tanpa izin.',
               'Ingin karya bisa dinikmati pembaca yang lebih suka mendengar.'],
        tools=['pdf-ke-flipbook', 'watermark-pdf', 'pdf-jadi-audiobook', 'kompres-pdf', 'word-ke-pdf', 'tanda-tangan-pdf'],
        steps=['Ubah naskah Word atau PDF menjadi flipbook, lalu atur sampul dan judulnya.',
               'Tambahkan watermark nama atau penerbit bila perlu.',
               'Bagikan lewat share link, ekspor HTML offline, atau build aplikasi Android dan Windows (Pro).'],
        guides=['cara-membuat-ebook-jadi-aplikasi-android', 'cara-membuat-flipbook-dari-pdf', 'cara-membuat-e-modul-flipbook-untuk-guru',
                'alternatif-heyzine-fliphtml5-bahasa-indonesia'],
        faq=[('Berapa banyak share link yang bisa dibuat?', 'Basic 3 share link, Medium 20, dan Pro 100.'),
             ('Apakah share link bisa dibuka siapa saja?', 'Ya, siapa pun yang memegang link bisa membacanya tanpa login. Jangan membagikan naskah rahasia lewat share link.'),
             ('Apakah perlu bisa coding untuk membuat aplikasi?', 'Tidak. Aplikasi Android dan Windows (paket Pro) dibuat otomatis dari flipbook Anda.')]),
}


def segment_html(slug):
    g = SEGMENTS[slug]
    path = f'/untuk/{slug}'
    tools = ''.join(f'<a class="seg-tool" href="/{t}"><b>{esc(LANDING[t]["name"])}</b><span>{esc(LANDING[t]["description"][:110])}…</span></a>'
                    for t in g['tools'] if t in LANDING)
    guides = [ARTICLES[a] for a in g['guides'] if a in ARTICLES]
    others = ' · '.join(f'<a href="/untuk/{k}">{esc(v["name"])}</a>' for k, v in SEGMENTS.items() if k != slug)
    data = [{'@context': 'https://schema.org', '@type': 'WebPage', 'name': g['h1'], 'description': g['description'],
             'url': SITE + path, 'inLanguage': 'id', 'isPartOf': {'@type': 'WebSite', 'name': BRAND, 'url': SITE + '/'}},
            {'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': [
                {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in g['faq']]},
            {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
                {'@type': 'ListItem', 'position': 1, 'name': BRAND, 'item': SITE + '/'},
                {'@type': 'ListItem', 'position': 2, 'name': 'Untuk ' + g['name'], 'item': SITE + path}]}]
    style = (STYLE_SEGMENT if 'seg-tool' not in STYLE else '')
    return head(g['title'], g['description'], path, ''.join(ld(d) for d in data) + f'<style>{style}</style>') + f'''
<body><div class="wrap">
{TOP}
<main>
<div class="hero"><p class="note" style="margin:0 0 6px">Untuk {esc(g['name'])}</p><h1>{esc(g['h1'])}</h1><p>{esc(g['lead'])}</p>
<a class="cta" href="/{esc(LANDING[g['tools'][0]]['link'])}">Mulai sekarang →</a>
<div class="note">{esc(TRIAL)}</div></div>
<section><h2>Masalah yang sering dihadapi</h2><div class="card"><ul class="why">{''.join(f'<li>{esc(x)}</li>' for x in g['pains'])}</ul></div></section>
<section><h2>Alat yang paling sering dipakai</h2><div class="seg-tools">{tools}</div></section>
<section><h2>Alur kerjanya</h2><div class="card"><ol class="steps">{''.join(f'<li>{esc(x)}</li>' for x in g['steps'])}</ol></div></section>
{f'<section><h2>Panduan terkait</h2><div class="list">{"".join(article_card(a) for a in guides)}</div></section>' if guides else ''}
<section><h2>Pertanyaan yang sering diajukan</h2><div class="card">{''.join(f'<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in g['faq'])}</div></section>
<section><h2>Paket</h2><div class="card"><p>Mulai gratis. Fitur lanjutan ada di paket Medium dan Pro. <a href="/harga">Lihat harga →</a></p></div></section>
<p class="note">Juga untuk: {others}</p>
</main>
{FOOT}
</div></body></html>'''


STYLE_SEGMENT = '''.seg-tools{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.seg-tool{display:flex;flex-direction:column;gap:4px;padding:16px;border:1.5px solid #E8E2D4;border-radius:16px;background:#fff;text-decoration:none;color:inherit}
.seg-tool:hover{border-color:#1A3C34}.seg-tool b{font-size:15px}.seg-tool span{font-size:12.5px;color:#78716C;line-height:1.5}'''


def articles_index():
    title = 'Artikel & Tutorial PDF, Flipbook, dan AI | MyFlipbook'
    description = ('Panduan praktis berbahasa Indonesia: membuat flipbook, kompres dan gabung PDF untuk pendaftaran, '
                   'menerjemahkan jurnal, merangkum dengan AI, dan lainnya.')
    data = {'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': title, 'url': SITE + '/artikel', 'inLanguage': 'id',
            'hasPart': [{'@type': 'BlogPosting', 'headline': a['title'], 'url': f'{SITE}/artikel/{a["slug"]}'} for a in articles.ARTICLES]}
    return head(title, description, '/artikel', ld(data)) + f'''
<body><div class="wrap">
{TOP}
<main>
<div class="hero"><h1>Artikel &amp; Tutorial</h1><p>{esc(description)}</p></div>
<div class="list">{''.join(article_card(a) for a in articles.ARTICLES)}</div>
<section><h2>Semua alat MyFlipbook</h2><div class="grid">{all_tools_links()}</div></section>
</main>
{FOOT}
</div></body></html>'''


# Meta tags for the app pages (served with these added before </head>).
APP_META = {
    'index.html': ('MyFlipbook adalah alat PDF lengkap berbahasa Indonesia: buat flipbook dari PDF, kompres, gabung, pisah, '
                   'ubah PDF ke Word/Excel/PPT, OCR, terjemahkan, dan ringkas dengan AI.', '/'),
    'converter.html': ('Semua alat PDF dalam satu tempat: kompres, gabung, pisah, putar, OCR, PDF ke Word/Excel/PPT/JPG, '
                       'dan sebaliknya. Sebagian besar berjalan langsung di browser.', '/converter.html'),
    'flipbook.html': (LANDING['pdf-ke-flipbook']['description'], '/pdf-ke-flipbook'),   # canonical: the landing page
    'journals.html': (LANDING['cari-jurnal-ebook']['description'], '/journals.html'),
    'notebook.html': (LANDING['ringkas-pdf-ai']['description'], '/notebook.html'),
    'workflow.html': ('Buat alur kerja PDF sendiri: gabungkan beberapa alat menjadi satu langkah otomatis.', '/workflow.html'),
    'editor.html': ('Edit PDF langsung di halaman: klik teks lalu ketik seperti di Word, pindahkan dan ganti gambar seperti di PowerPoint. '
                    'Bisa untuk PDF hasil scan (OCR).', '/editor.html'),
    'authors.html': ('Cari penulis ilmiah dan lihat metrik sitasinya seperti Publish or Perish: h-index, g-index, i10-index, '
                     'sitasi per tahun, lalu ekspor daftar karyanya ke BibTeX, RIS, CSV, atau APA.', '/authors.html'),
    'privacy.html': (None, '/privacy.html'),
    'terms.html': (None, '/terms.html'),
}
NOINDEX = {'login.html', 'account.html', 'library.html', 'coming-soon.html', 'animation.html'}
# Working app pages: thin for search and competing with their Indonesian landing pages.
# Kept out of the index (links still followed) and out of the sitemap.
APP_NOINDEX = {'converter.html', 'editor.html', 'notebook.html', 'journals.html', 'workflow.html', 'authors.html'}


def verification():
    """Search Console / Bing ownership tags (GOOGLE_SITE_VERIFICATION, BING_SITE_VERIFICATION in .env)."""
    out = ''
    for env, name in (('GOOGLE_SITE_VERIFICATION', 'google-site-verification'), ('BING_SITE_VERIFICATION', 'msvalidate.01')):
        for code in os.environ.get(env, '').split(','):
            if code.strip():
                out += f'<meta name="{name}" content="{esc(code.strip())}">'
    return out


# Installable web app (owner, 2026-10-23): "Add to Home Screen" opens the site without the
# browser's bars (iPhone Safari never lets a page hide them otherwise). Every page carries it.
PWA_HEAD = ('<link rel="manifest" href="/assets/manifest.json"><meta name="theme-color" content="#1A3C34">'
            '<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">'
            '<meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="MyFlipbook">')


def app_head(page_name):
    """Tags added to an app page's <head> (bytes): the web-app tags, plus search tags where it has them."""
    return PWA_HEAD.encode('utf-8') + _page_tags(page_name)


def _page_tags(page_name):
    if page_name in NOINDEX:
        return b'<meta name="robots" content="noindex">'
    if page_name in APP_NOINDEX:
        return b'<meta name="robots" content="noindex, follow">'
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
            {'@type': 'Organization', 'name': BRAND, 'alternateName': 'MyFlipbookPro', 'url': SITE + '/',
             'logo': SITE + '/assets/img/logo.png', 'email': CONTACT, 'telephone': PHONE, 'address': POSTAL,
             'contactPoint': {'@type': 'ContactPoint', 'contactType': 'customer support', 'email': CONTACT, 'telephone': PHONE, 'availableLanguage': ['id', 'en']}},
            {'@type': 'WebSite', 'name': BRAND, 'url': SITE + '/', 'inLanguage': ['id', 'en']}]}))
    return ''.join(tags).encode('utf-8')


def footer_links():
    """Plain links to every landing page (the home page's tool grid is built by script)."""
    links = ' <span style="color:#D6CFBF">·</span> '.join(
        [f'<a href="/{s}" style="color:#78716C">{esc(p["name"])}</a>' for s, p in LANDING.items()]
        + [f'<a href="/untuk/{k}" style="color:#78716C">Untuk {esc(v["name"])}</a>' for k, v in SEGMENTS.items()]
        + ['<a href="/artikel" style="color:#78716C">Artikel &amp; tutorial</a>'])
    return f'<nav aria-label="Alat PDF" style="text-align:center;font-size:11px;font-weight:600;margin-top:10px;line-height:2">{links}</nav>'.encode('utf-8')


# ---------- Prices: built from accounts.PLANS (the prices checkout charges), never typed twice.
PLAN_DESC = {'basic': 'Untuk mencoba dan kebutuhan PDF sehari-hari.',
             'medium': 'Untuk guru, dosen, mahasiswa, dan penulis.',
             'pro': 'Untuk penerbit, UMKM, sekolah, dan instansi.'}
PLAN_DESC_EN = {'basic': 'For trying out and everyday PDF tasks.',
                'medium': 'For teachers, lecturers, students and writers.',
                'pro': 'For publishers, small businesses, schools and institutions.'}
POPULAR = 'medium'
USD_RATE = 16_500          # rupiah per US$, only for the English "≈ US$" hint (checkout charges rupiah)

def both(id_text, en_text, tag='span', attrs=''):
    """An element in Indonesian with its English (assets/i18n.js swaps them by the visitor's language)."""
    return f'<{tag}{attrs} data-en="{esc(en_text)}">{id_text}</{tag}>'


def rupiah(n):
    return 'Rp' + f'{n:,}'.replace(',', '.')


def plan_cards():
    """The plans as cards: each price twice (monthly / yearly), the switch above shows one."""
    out = []
    check = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
    for key, p in accounts.PLANS.items():
        hot = key == POPULAR
        head = (f'<div class="plan{" hot" if hot else ""}" data-plan="{key}"><div class="ph"><h3>{esc(p["name"])}</h3>'
                + (both('Paling populer', 'Most popular', 'span', ' class="badge"') if hot else '') + '</div>'
                + both(esc(PLAN_DESC.get(key, '')), PLAN_DESC_EN.get(key, ''), 'p', ' class="pd"'))
        feats = '<ul>' + ''.join(f'<li>{check}' + both(esc(f), e) + '</li>' for f, e in zip(p['features']['id'], p['features']['en'])) + '</ul>'
        if not p['monthly']:
            price = (both('Gratis', 'Free', 'span', ' class="big"') + '</div>'
                     + both('Tanpa biaya langganan.', 'No subscription fee.', 'p', ' class="pn"'))
            out.append(f'{head}<div class="pp">{price}{feats}<a class="pc" href="/account.html#plans">'
                       + both('Coba gratis →', 'Try free →') + '</a></div>')
            continue
        per_month = round(p['yearly'] / 12 / 100) * 100
        save = round(100 - p['yearly'] * 100 / (p['monthly'] * 12))
        usd = lambda idr: f'≈ US${idr // USD_RATE} · '
        monthly = (f'<div class="pm"><div class="pp"><span class="big">{rupiah(p["monthly"])}</span>' + both('/bulan', '/month', 'span', ' class="per"') + '</div>'
                   + both(f'atau {rupiah(per_month)}/bulan jika bayar tahunan', f'{usd(p["monthly"])}or {rupiah(per_month)}/month billed yearly', 'p', ' class="pn"') + '</div>')
        yearly = (f'<div class="pyr"><div class="pp"><span class="big">{rupiah(per_month)}</span>' + both('/bulan', '/month', 'span', ' class="per"') + '</div>'
                  + both(f'ditagih {rupiah(p["yearly"])}/tahun · hemat {save}%', f'{usd(per_month)}billed {rupiah(p["yearly"])}/year · save {save}%', 'p', ' class="pn"') + '</div>')
        cta = both(f'Pilih {p["name"]} →', f'Choose {p["name"]} →')
        out.append(f'{head}{monthly}{yearly}{feats}'
                   f'<a class="pc pm" href="/account.html?cycle=monthly#plans">{cta}</a><a class="pc pyr" href="/account.html?cycle=yearly#plans">{cta}</a></div>')
    return ''.join(out)


def savings():
    """The yearly saving of each paid plan, in percent."""
    return [round(100 - p['yearly'] * 100 / (p['monthly'] * 12)) for p in accounts.PLANS.values() if p['monthly']]


def plan_section(heading='h2'):
    """Heading, the Monthly / Yearly and IN / EN switches, the cards and the footnote (CSS only:
    the checked radio shows its prices; IN / EN are assets/i18n.js's data-lang-set)."""
    cuts = savings() or [0]
    top, same = max(cuts), len(set(cuts)) == 1          # "hemat 20%" when every plan saves the same, else "hemat s.d."
    save_id, save_en = (f'hemat {top}%', f'save {top}%') if same else (f'hemat s.d. {top}%', f'save up to {top}%')
    return ('<div class="prices"><input type="radio" name="cycle" id="cyc-m" class="cyc" checked><input type="radio" name="cycle" id="cyc-y" class="cyc">'
            '<div class="ptop"><div>' + both('Paket &amp; Harga', 'Plans & Pricing', heading, ' class="ptitle"')
            + both('Pilih paket sesuai kebutuhan. Upgrade atau berhenti kapan saja.', 'Pick the plan that fits. Upgrade or cancel anytime.', 'p', ' class="psub"')
            + '</div><div class="switches"><div class="cycle" role="group" aria-label="Periode pembayaran" data-en-aria="Billing period">'
            + both('Bulanan', 'Monthly', 'label', ' for="cyc-m"')
            + '<label for="cyc-y">' + both('Tahunan', 'Yearly') + both(save_id, save_en, 'b') + '</label></div>'
            '<div class="cycle langs" role="group" aria-label="Bahasa" data-en-aria="Language">'
            '<button type="button" data-lang-set="id" aria-label="Bahasa Indonesia">IN</button><button type="button" data-lang-set="en" aria-label="English">EN</button></div>'
            f'</div></div><div class="plans3">{plan_cards()}</div>{PICK_SCRIPT}'
            + both('Semua harga dalam Rupiah. Paket tahunan dibayar di muka; '
                   'bisa berhenti kapan saja dan akses tetap aktif sampai masa langganan habis.',
                   'All prices in Indonesian Rupiah (IDR); your card issuer converts automatically. '
                   'Yearly plans are paid upfront; cancel anytime and keep access until the period ends.', 'p', ' class="pfoot"')
            + '</div>')


# The highlight goes to the plan clicked; a signed-in Medium / Pro member sees Pro highlighted
# (the next step up), as on the account page.
PICK_SCRIPT = ('<script>(function(){function pick(g,c){g.querySelectorAll(".plan").forEach(function(x){x.classList.toggle("hot",x===c)})}'
               'document.querySelectorAll(".plans3").forEach(function(g){g.addEventListener("click",function(e){var c=e.target.closest(".plan");if(c)pick(g,c)})});'
               'addEventListener("load",function(){if(!window.MFAuth||!MFAuth.me)return;MFAuth.me().then(function(me){var u=me&&me.user;if(!u)return;'
               'document.querySelectorAll(".plans3").forEach(function(g){'
               # the member's own plan: its buttons say so (and lead to the account page)
               'var mine=g.querySelector(".plan[data-plan="+u.plan+"]");if(mine)mine.querySelectorAll(".pc").forEach(function(a){'
               'a.classList.add("cur");a.href="/account.html#plans";a.setAttribute("aria-current","true");'
               'a.innerHTML="<span data-en=\\"Your current plan\\">Paket Anda saat ini</span>";if(window.I18N&&I18N.apply)I18N.apply()});'
               'if(u.plan!=="basic"){var c=g.querySelector(".plan[data-plan=pro]");if(c)pick(g,c)}})})["catch"](function(){})})})()</script>')


# The design's values (Paket & Harga-html/Main.dc.html).
PRICE_STYLE = """.prices{display:flex;flex-direction:column;gap:28px;color:#1C1A17;font-family:'Plus Jakarta Sans',sans-serif}
.prices .ptop{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap}
.prices .ptitle{margin:0;font-family:'Fraunces',serif;font-weight:800;font-size:40px;letter-spacing:-.5px;line-height:1.1}
.prices .psub{margin:8px 0 0;font-size:15px;color:#5F5A52}
.prices .switches{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.cyc{position:absolute;opacity:0;pointer-events:none}
.prices .cycle{display:flex;padding:4px;gap:4px;background:#fff;border:1px solid #E5E0D8;border-radius:999px}
.prices .cycle label,.prices .cycle button{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 18px;border:0;border-radius:999px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;background:transparent;color:#1C1A17}
.prices .cycle label:hover,.prices .cycle button:hover{color:#5F5A52}
.prices .cycle b{font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;background:#FDECEC;color:#B00808}
#cyc-m:checked~.ptop label[for=cyc-m],#cyc-y:checked~.ptop label[for=cyc-y],.prices .cycle button[aria-pressed=true]{background:#1C1A17;color:#fff}
#cyc-y:checked~.ptop label[for=cyc-y] b{background:#fff}
#cyc-m:focus-visible~.ptop label[for=cyc-m],#cyc-y:focus-visible~.ptop label[for=cyc-y]{outline:2px solid #D40B0B;outline-offset:2px}
.plans3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;align-items:stretch}
.plans3 .plan{display:flex;flex-direction:column;min-height:500px;padding:32px 28px 28px;background:#fff;border:1px solid #E5E0D8;border-radius:20px;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.plans3 .plan:not(.hot){margin:1px}
.plans3 .plan.hot{border:2px solid #D40B0B;box-shadow:0 12px 32px rgba(28,26,23,.10)}
.plans3 .ph{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:30px}
.plans3 h3{margin:0;font-size:22px;font-weight:600}
.plans3 .badge{font-size:12px;font-weight:700;padding:6px 10px;border-radius:999px;background:#FDECEC;color:#B00808;white-space:nowrap}
.plans3 .pd{margin:8px 0 0;font-size:14px;line-height:1.45;color:#5F5A52;min-height:40px}
.plans3 .pp{display:flex;align-items:baseline;gap:6px;margin-top:20px}
.plans3 .big{font-size:38px;font-weight:800;letter-spacing:-1px;line-height:1.1}
.plans3 .per{font-size:15px;color:#5F5A52}
.plans3 .pn{margin:6px 0 0;font-size:13px;line-height:1.45;color:#5F5A52;min-height:38px}
.plans3 ul{list-style:none;margin:18px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}
.plans3 li{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.45}
.plans3 li svg{flex:none;margin-top:1px;color:#1C1A17}.plans3 .plan.hot li svg{color:#D40B0B}
.plans3 .pc{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;margin-top:auto;border-radius:999px;font-size:15px;font-weight:700;color:#fff;background:#1C1A17;text-decoration:none;transition:transform .15s,box-shadow .15s}
.plans3 .plan>ul{margin-bottom:28px}
.plans3 .plan.hot .pc{background:#D40B0B}
.plans3 .pc:hover{transform:translateY(-2px);box-shadow:0 10px 22px rgba(28,26,23,.18);color:#fff}
.plans3 .pc.cur,.plans3 .plan.hot .pc.cur{background:#F3F0EA;color:#78716C;box-shadow:none;transform:none}
.plans3 div.pyr,.plans3 a.pyr{display:none}
#cyc-y:checked~.plans3 div.pm,#cyc-y:checked~.plans3 a.pm{display:none}
#cyc-y:checked~.plans3 div.pyr{display:block}
#cyc-y:checked~.plans3 a.pyr{display:flex}
.prices .pfoot{margin:0;font-size:13px;line-height:1.5;color:#5F5A52}
@media (max-width:900px){.plans3{grid-template-columns:1fr}.plans3 .plan{min-height:0}.prices .ptitle{font-size:32px}}"""


def home_pricing():
    """Price section for the home page (products, descriptions and rupiah prices, as payment providers require)."""
    return (f'<section id="harga" class="max-w-[1440px] mx-auto px-4 pb-6"><style>{PRICE_STYLE}</style>'
            + plan_section() +
            '<p class="text-[12px] text-[#78716C] mt-3">' + both('Lihat detail paket &amp; pertanyaan umum →', 'See plan details & FAQ →', 'a', ' href="/harga" style="color:#1A3C34;font-weight:700"') + '</p>'
            '</section>').encode('utf-8')


def static_grid():
    """The home page's tool cards as plain HTML, so the page has its content without JavaScript
    (the page script rebuilds the grid with filters and icons when it runs)."""
    return ''.join(f'<a href="/{s}" class="card p-5 flex flex-col min-h-[170px]"><h3 class="text-[15px] font-extrabold leading-tight serif">'
                   f'{esc(p["name"])}</h3><p class="mt-3 text-[12.5px] leading-relaxed text-[#78716C]">{esc(p["description"])}</p></a>'
                   for s, p in LANDING.items()).encode('utf-8')


def add_head(page_name, body):
    extra = app_head(page_name)
    if not extra:
        return body
    i = body.find(b'</head>')
    body = body[:i] + extra + body[i:] if i >= 0 else body
    if page_name in APP_TITLES:
        # The title search engines see (a page's script may still switch it to the visitor's language).
        title = esc(APP_TITLES[page_name]).encode()
        body = re.sub(rb'(<title[^>]*>)[^<]*(</title>)', lambda m: m[1] + title + m[2], body, count=1)
    if page_name == 'index.html':
        body = body.replace(b'<div id="grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"></div>',
                            b'<div id="grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">' + static_grid() + b'</div>', 1)
        i = body.find(b'<footer')
        body = body[:i] + home_pricing() + body[i:] if i >= 0 else body
        i = body.rfind(b'</footer>')
        body = body[:i] + footer_links() + body[i:] if i >= 0 else body
    return body


def robots():
    return ('User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin/\nDisallow: /s/\n'
            'Disallow: /account.html\nDisallow: /library.html\nDisallow: /login.html\n\n'
            f'Sitemap: {SITE}/sitemap.xml\n')


def sitemap():
    urls = [('/', '1.0')] + [('/' + s, '0.9') for s in LANDING] + [
        ('/harga', '0.8')] + [(f'/untuk/{k}', '0.9') for k in SEGMENTS] + [('/privacy.html', '0.2'), ('/terms.html', '0.2'), ('/artikel', '0.8')]
    rows = ''.join(f'<url><loc>{esc(SITE + u)}</loc><lastmod>{SEGMENTS_UPDATED if u.startswith("/untuk/") else UPDATED}</lastmod>'
                   f'<priority>{pr}</priority></url>' for u, pr in urls)
    rows += ''.join(f'<url><loc>{SITE}/artikel/{a["slug"]}</loc><lastmod>{a["updated"]}</lastmod><priority>0.8</priority></url>'
                    for a in articles.ARTICLES)
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
    if slug.startswith('untuk/') and slug[6:] in SEGMENTS and path == '/' + slug:
        if slug not in CACHE:
            CACHE[slug] = segment_html(slug[6:]).encode('utf-8')
        return CACHE[slug], 'text/html; charset=utf-8'
    if path == '/harga':
        if 'harga' not in CACHE:
            CACHE['harga'] = harga_html().encode('utf-8')
        return CACHE['harga'], 'text/html; charset=utf-8'
    if path in ('/artikel', '/artikel/'):
        if 'artikel' not in CACHE:
            CACHE['artikel'] = articles_index().encode('utf-8')
        return CACHE['artikel'], 'text/html; charset=utf-8'
    if slug.startswith('artikel/') and slug[8:] in ARTICLES and path == '/' + slug:
        if slug not in CACHE:
            CACHE[slug] = article_html(slug[8:]).encode('utf-8')
        return CACHE[slug], 'text/html; charset=utf-8'
    return None
