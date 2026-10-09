"""Tutorial articles (/artikel/<slug>) for search: Indonesian how-tos that
answer what people actually type into Google and link into the tools.

Each article is plain data rendered by seo.py. Blocks: ('p', text), ('h2', text),
('ol', [items]), ('ul', [items]), ('tip', text), ('faq', [(question, answer)]),
('cta', landing slug).
Text may hold internal links written as [label](/path). Keep every claim true
to the app (see seo.py's note) — these pages promise what the tools do.
"""

ARTICLES = []


def article(slug, title, description, published, blocks, tool=None, updated=None):
    # updated: the date the content last really changed (sitemap lastmod, dateModified)
    ARTICLES.append(dict(slug=slug, title=title, description=description, published=published, blocks=blocks, tool=tool,
                         updated=updated or published))


article(
    'cara-membuat-flipbook-dari-pdf',
    'Cara Membuat File PDF Menjadi Buku Digital (Flipbook) Gratis',
    'Panduan langkah demi langkah membuat file PDF menjadi buku digital (flipbook) yang bisa dibalik seperti buku asli, '
    'lalu membagikannya lewat link atau menjadikannya aplikasi — gratis, tanpa install.',
    '2026-10-06',
    [
        ('p', 'Ingin membuat file PDF menjadi buku yang halamannya bisa dibalik? Caranya adalah menjadikannya flipbook. '
              'Flipbook adalah dokumen digital yang halamannya bisa dibalik seperti buku atau majalah cetak. Dibanding PDF '
              'biasa, flipbook terasa lebih hidup saat dibaca, sehingga cocok untuk majalah sekolah, katalog produk, '
              'laporan tahunan, modul ajar, portofolio, hingga undangan digital.'),
        ('p', 'Kabar baiknya, Anda tidak perlu memasang software apa pun. Dengan [PDF ke Flipbook](/pdf-ke-flipbook) di '
              'MyFlipbook, semuanya berjalan di browser — di laptop maupun HP.'),
        ('h2', 'Yang perlu disiapkan'),
        ('ul', ['File PDF yang ingin dijadikan flipbook. Bisa juga file Word, Excel, PowerPoint, atau kumpulan gambar — '
                'semuanya akan diubah menjadi halaman buku.',
                'Akun MyFlipbook. Daftar gratis dengan Google atau email; akun baru bisa mencoba semua fitur selama 7 hari.',
                'Browser modern seperti Chrome, Edge, atau Safari versi terbaru.']),
        ('h2', 'Langkah membuat flipbook'),
        ('ol', ['Buka halaman [PDF ke Flipbook](/flipbook.html).',
                'Tambahkan file: pilih dari komputer/HP, ambil dari Google Drive, atau tempel link dokumen.',
                'Tunggu beberapa detik. Halaman pertama muncul lebih dulu, sisanya disiapkan di belakang layar sehingga '
                'Anda bisa langsung membaca.',
                'Atur judul buku dan tampilan, lalu coba balik halamannya. Mode layar penuh membuat pengalaman membaca '
                'terasa seperti memegang buku.',
                'Tekan Save My Library supaya flipbook tersimpan di akun Anda dan bisa dibuka lagi kapan saja tanpa '
                'mengunggah ulang.']),
        ('h2', 'Cara membagikan flipbook'),
        ('p', 'Setelah tersimpan, ada beberapa pilihan untuk membagikannya:'),
        ('ul', ['Share link — siapa pun yang punya link bisa membaca di browser tanpa login. Cocok dikirim lewat '
                'WhatsApp atau ditaruh di bio Instagram. Akun Free mendapat 3 share link gratis.',
                'HTML offline — satu file yang bisa dibuka tanpa internet, misalnya untuk dibagikan lewat flashdisk '
                '(paket Pro).',
                'Aplikasi Android (APK) — flipbook menjadi aplikasi yang bisa dipasang di HP (paket Pro).',
                'Aplikasi Windows (EXE) — untuk dibagikan ke komputer kantor atau sekolah (paket Business).']),
        ('h2', 'Fitur yang membuat flipbook lebih berguna'),
        ('ul', ['Stabilo, catatan, dan spidol untuk menandai bagian penting atau mencoret-coret saat presentasi.',
                'Audio book: halaman bisa dibacakan dengan suara. Lihat [PDF jadi Audio Book](/pdf-jadi-audiobook).',
                'Terjemahan seluruh buku dari bahasa Inggris ke Bahasa Indonesia dengan tombol Translate. Lihat '
                '[Terjemahkan PDF](/terjemahkan-pdf).',
                'PDF hasil scan tetap bisa distabilo dan dibacakan karena teksnya dikenali dengan OCR.']),
        ('h2', 'Tips agar flipbook terlihat bagus'),
        ('ul', ['Gunakan PDF dengan ukuran halaman yang seragam; halaman yang ukurannya berbeda-beda membuat buku '
                'terlihat tidak rata.',
                'Untuk majalah, letakkan sampul sebagai halaman pertama dan pastikan jumlah halaman genap agar halaman '
                'kiri-kanan berpasangan dengan benar.',
                'File yang sangat besar (ratusan MB) sebaiknya [dikompres](/kompres-pdf) lebih dulu supaya cepat dibuka '
                'pembaca, terutama di HP.']),
        ('faq', [
            ('Apakah membuat flipbook harus memasang aplikasi?',
             'Tidak. Flipbook dibuat langsung di browser, di laptop maupun HP. Aplikasi hanya diperlukan jika Anda sendiri ingin membagikan flipbook sebagai APK atau EXE.'),
            ('Apakah pembaca perlu punya akun MyFlipbook?',
             'Tidak. Pembaca cukup membuka share link di browser, tanpa login dan tanpa memasang apa pun.'),
            ('Berapa lama flipbook tersimpan?',
             'Flipbook yang disimpan dengan Save My Library tetap ada di akun Anda sampai Anda menghapusnya atau akun dihapus.'),
        ]),
        ('cta', 'pdf-ke-flipbook'),
    ], tool='pdf-ke-flipbook')

article(
    'cara-kompres-pdf-200kb',
    'Cara Kompres PDF Jadi di Bawah 200 KB untuk CPNS, Beasiswa & Pendaftaran',
    'Banyak portal pendaftaran membatasi ukuran berkas 200 KB–1 MB. Begini cara mengecilkan PDF tanpa mengunggahnya ke '
    'server, plus trik saat hasilnya masih terlalu besar.',
    '2026-10-06',
    [
        ('p', 'Portal pendaftaran CPNS, beasiswa, PPDB, atau lamaran kerja sering membatasi ukuran berkas — biasanya '
              '200 KB, 500 KB, atau 1 MB per file. Masalahnya, hasil scan dari HP atau mesin fotokopi bisa berukuran '
              'beberapa MB.'),
        ('p', 'Dengan [Kompres PDF](/kompres-pdf) di MyFlipbook, file diproses langsung di browser Anda dan tidak '
              'diunggah ke server — aman untuk KTP, ijazah, dan transkrip.'),
        ('h2', 'Langkah kompres PDF'),
        ('ol', ['Buka alat [Kompres PDF](/converter.html?tool=compress-pdf).',
                'Pilih file PDF Anda.',
                'Pilih tingkat kompresi: Ringan (kualitas terbaik), Seimbang, atau Kuat (ukuran paling kecil).',
                'Unduh hasilnya dan periksa ukurannya. Jika masih di atas batas, coba tingkat yang lebih kuat.']),
        ('h2', 'Kalau masih di atas 200 KB'),
        ('p', 'Ukuran akhir sangat bergantung pada isi dokumen. Dokumen berisi banyak foto berwarna akan lebih sulit '
              'dikecilkan dibanding dokumen teks. Beberapa trik yang biasanya berhasil:'),
        ('ul', ['Scan ulang dengan resolusi 150–200 dpi. Untuk dokumen teks, resolusi ini sudah cukup tajam dibaca '
                'dan ukurannya jauh lebih kecil daripada 600 dpi.',
                'Gunakan mode hitam-putih/abu-abu saat scan bila dokumen tidak wajib berwarna.',
                'Potong margin kosong dengan [Potong PDF](/potong-pdf) atau [Pisah PDF](/pisah-pdf) bila hanya '
                'sebagian halaman yang diminta.',
                'Jika berkas terdiri dari beberapa foto, ubah dulu dengan [JPG ke PDF](/jpg-ke-pdf) lalu kompres '
                'hasilnya.']),
        ('h2', 'Pastikan tetap terbaca'),
        ('p', 'Setelah dikompres, buka kembali file-nya dan perbesar ke 100%. Pastikan NIK, nama, nilai, dan stempel masih '
              'jelas. Berkas yang ukurannya kecil tetapi buram bisa membuat Anda gugur di tahap administrasi.'),
        ('tip', 'Simpan file asli (sebelum dikompres) di folder terpisah. Jika portal meminta ukuran berbeda, Anda bisa '
                'mengompres ulang dari file asli, bukan dari file yang sudah dikompres.'),
        ('faq', [
            ('Apakah kompres PDF mengurangi kualitas?',
             'Ya, kompresi terutama mengecilkan gambar di dalam PDF. Pilih tingkat Ringan bila kualitas gambar penting, dan Kuat bila yang terpenting ukuran file.'),
            ('Apakah dokumen saya aman?',
             'Kompresi berjalan di browser Anda, jadi file KTP, ijazah, atau transkrip tidak dikirim ke server MyFlipbook.'),
            ('Bisakah kompres PDF dari HP?',
             'Bisa. Buka alat Kompres PDF di browser HP dan pilih file dari penyimpanan atau Google Drive.'),
        ]),
        ('cta', 'kompres-pdf'),
    ], tool='kompres-pdf')

article(
    'cara-menggabungkan-pdf',
    'Cara Menggabungkan Banyak File PDF Jadi Satu untuk Berkas Lamaran',
    'Satukan KTP, ijazah, transkrip, dan sertifikat menjadi satu PDF rapi dengan urutan yang Anda tentukan — tanpa '
    'mengunggah dokumen pribadi ke server.',
    '2026-10-06',
    [
        ('p', 'Banyak lowongan kerja dan pendaftaran meminta semua dokumen dikirim dalam satu file PDF. Menggabungkan '
              'file satu per satu di aplikasi desktop cukup merepotkan, apalagi kalau sedang memakai HP.'),
        ('p', 'Alat [Gabung PDF](/gabung-pdf) menyatukan beberapa file dalam beberapa detik. Prosesnya berjalan di '
              'browser, jadi dokumen pribadi Anda tidak dikirim ke mana pun.'),
        ('h2', 'Langkah menggabungkan PDF'),
        ('ol', ['Buka alat [Gabung PDF](/converter.html?tool=merge-pdf).',
                'Pilih semua file yang ingin digabung sekaligus.',
                'Atur urutannya — misalnya surat lamaran, CV, KTP, ijazah, transkrip, lalu sertifikat.',
                'Gabungkan dan unduh hasilnya.']),
        ('h2', 'Urutan berkas lamaran yang umum'),
        ('ol', ['Surat lamaran', 'Daftar riwayat hidup (CV)', 'KTP', 'Ijazah dan transkrip nilai',
                'Sertifikat pendukung (kursus, organisasi, bahasa)', 'Surat keterangan lain yang diminta']),
        ('p', 'Selalu ikuti urutan yang diminta panitia jika ada. Urutan yang rapi memudahkan HRD dan memberi kesan '
              'teliti.'),
        ('h2', 'Kalau ada dokumen berupa foto'),
        ('p', 'Foto KTP atau ijazah dari kamera HP bisa diubah dulu dengan [JPG ke PDF](/jpg-ke-pdf), lalu ikut '
              'digabungkan. Jika hasil gabungan terlalu besar, kecilkan dengan [Kompres PDF](/kompres-pdf).'),
        ('h2', 'Merapikan halaman setelah digabung'),
        ('ul', ['Halaman miring atau terbalik: gunakan [Putar PDF](/putar-pdf).',
                'Urutan ada yang salah atau ada halaman yang tidak perlu: gunakan [Atur Halaman PDF](/atur-halaman-pdf).',
                'Perlu nomor halaman: gunakan [Nomor Halaman PDF](/nomor-halaman-pdf).']),
        ('faq', [
            ('Berapa banyak file yang bisa digabung?',
             'Beberapa file sekaligus; batasnya hanya memori perangkat Anda. Untuk puluhan file besar, gabungkan bertahap.'),
            ('Apakah urutan bisa diubah setelah digabung?',
             'Bisa. Buka hasilnya di Atur Halaman PDF lalu seret halaman ke urutan yang benar.'),
            ('Apakah file asli ikut berubah?',
             'Tidak. Hasil gabungan disimpan sebagai file baru; file asli tetap utuh.'),
        ]),
        ('cta', 'gabung-pdf'),
    ], tool='gabung-pdf')

article(
    'cara-menerjemahkan-jurnal-bahasa-inggris',
    'Cara Menerjemahkan Jurnal Bahasa Inggris ke Bahasa Indonesia Tanpa Merusak Layout',
    'Terjemahkan jurnal, textbook, atau majalah berbahasa Inggris ke Bahasa Indonesia langsung di halaman aslinya — '
    'kolom tetap rapi, bisa distabilo dan dibacakan.',
    '2026-10-06',
    [
        ('p', 'Menyalin teks jurnal ke situs penerjemah paragraf demi paragraf sangat melelahkan. Tabel, kolom, dan '
              'urutan teks sering berantakan, dan Anda kehilangan konteks halaman aslinya.'),
        ('p', 'Fitur [Terjemahkan PDF](/terjemahkan-pdf) di MyFlipbook menerjemahkan seluruh buku dan menempatkan teks '
              'terjemahan mengikuti kolom aslinya, sehingga Anda tetap membaca jurnal dalam bentuk yang sama.'),
        ('h2', 'Langkah menerjemahkan jurnal'),
        ('ol', ['Buka jurnal di [PDF ke Flipbook](/flipbook.html).',
                'Tekan tombol Translate dan pilih Bahasa Indonesia. Progres terjemahan terlihat langsung di tombolnya.',
                'Baca hasilnya. Anda bisa kembali ke bahasa asli kapan saja untuk membandingkan istilah.']),
        ('h2', 'Hanya perlu menerjemahkan satu bagian?'),
        ('p', 'Untuk kalimat atau paragraf tertentu, stabilo bagian tersebut lalu pilih terjemahan AI di toolbar stabilo. '
              'Hasilnya disimpan sebagai catatan di samping teks — praktis untuk menyusun kutipan.'),
        ('h2', 'Belajar lebih cepat dari jurnal berbahasa Inggris'),
        ('ul', ['Dengarkan versi terjemahannya dengan audio book sambil membaca.',
                'Stabilo di edisi terjemahan memakai kata-kata terjemahan, jadi catatan Anda tetap berbahasa Indonesia.',
                'Butuh gambaran cepat dulu? Buat ringkasan dengan [AI Summarizer](/ringkas-pdf-ai).']),
        ('h2', 'Catatan penting untuk tugas akademik'),
        ('ul', ['Terjemahan mesin membantu memahami isi, tetapi istilah teknis tetap perlu diperiksa.',
                'Saat mengutip, rujuk sumber aslinya (jurnal berbahasa Inggris), bukan hasil terjemahan.',
                'PDF hasil scan bisa diterjemahkan selama teksnya terbaca oleh OCR; hasil scan yang buram akan memengaruhi '
                'kualitas terjemahan.']),
        ('faq', [
            ('Apakah terjemahannya bisa dipakai langsung untuk skripsi?',
             'Gunakan terjemahan untuk memahami isi. Untuk dikutip, tulis ulang dengan bahasa Anda sendiri dan rujuk jurnal aslinya.'),
            ('Bahasa apa yang didukung?',
             'Terjemahan seluruh buku saat ini dari bahasa Inggris ke Bahasa Indonesia dan sebaliknya.'),
            ('Apakah file PDF asli berubah?',
             'Tidak. Terjemahan ditampilkan sebagai edisi terpisah di flipbook; PDF asli tetap seperti semula.'),
        ]),
        ('cta', 'terjemahkan-pdf'),
    ], tool='terjemahkan-pdf')

article(
    'cara-mengubah-pdf-ke-word',
    'Cara Mengubah PDF ke Word agar Bisa Diedit, Termasuk PDF Hasil Scan',
    'Ubah PDF menjadi dokumen Word (.docx) yang bisa disunting. Untuk PDF hasil scan, kenali teksnya dulu dengan OCR '
    'agar tidak sekadar menjadi gambar.',
    '2026-10-06',
    [
        ('p', 'PDF dibuat untuk dibaca, bukan disunting. Saat perlu merevisi surat, mengutip laporan, atau memperbaiki '
              'tugas lama, cara termudah adalah mengubahnya menjadi file Word.'),
        ('h2', 'Langkah mengubah PDF ke Word'),
        ('ol', ['Buka alat [PDF ke Word](/converter.html?tool=pdf-to-word).',
                'Pilih file PDF Anda. Konversi berjalan di browser, jadi file tidak diunggah ke server.',
                'Unduh file .docx, lalu buka di Microsoft Word atau Google Docs dan sunting seperlunya.']),
        ('h2', 'Kalau PDF-nya hasil scan'),
        ('p', 'PDF hasil scan sebenarnya berisi gambar halaman, bukan teks. Jika langsung diubah ke Word, Anda hanya '
              'mendapat gambar yang tidak bisa diedit. Solusinya:'),
        ('ol', ['Jalankan [OCR PDF](/ocr-pdf) lebih dulu dan pilih bahasa dokumen (Indonesia, Inggris, atau keduanya).',
                'Ubah PDF hasil OCR ke Word.',
                'Periksa ulang angka dan nama — OCR bisa keliru pada scan yang miring atau buram.']),
        ('h2', 'Apakah format akan sama persis?'),
        ('p', 'Teks dan paragraf dipertahankan sebisa mungkin. Tata letak yang sangat rumit — seperti majalah dengan '
              'banyak kolom dan gambar bertumpuk — biasanya perlu dirapikan sedikit setelah dikonversi.'),
        ('h2', 'Konversi lain yang sering dibutuhkan'),
        ('ul', ['Tabel di PDF ke spreadsheet: [PDF ke Excel](/pdf-ke-excel).',
                'Materi PDF ke slide presentasi: [PDF ke PowerPoint](/pdf-ke-ppt).',
                'Setelah selesai diedit, kembalikan ke PDF: [Word ke PDF](/word-ke-pdf).']),
        ('faq', [
            ('Apakah PDF ke Word gratis?',
             'Akun baru bisa mencoba semua alat selama 7 hari. Konversinya berjalan di browser Anda.'),
            ('Mengapa hasil Word saya hanya berisi gambar?',
             'Kemungkinan PDF-nya hasil scan. Jalankan OCR PDF dulu agar teksnya dikenali, lalu ubah lagi ke Word.'),
            ('Apakah bisa dibuka di Google Docs?',
             'Bisa. File .docx dapat diunggah ke Google Drive lalu dibuka dengan Google Docs.'),
        ]),
        ('cta', 'pdf-ke-word'),
    ], tool='pdf-ke-word')

article(
    'cara-membuat-katalog-produk-digital',
    'Cara Membuat Katalog Produk Digital (Flipbook) untuk UMKM',
    'Ubah katalog PDF menjadi flipbook yang bisa dibagikan lewat WhatsApp, dipasang di bio Instagram, atau dijadikan '
    'aplikasi untuk tim sales.',
    '2026-10-06',
    [
        ('p', 'Mengirim puluhan foto produk satu per satu ke calon pembeli itu melelahkan, dan foto mudah tenggelam di '
              'chat. Katalog digital menyatukan semua produk dalam satu tautan yang rapi dan enak dibolak-balik.'),
        ('h2', '1. Siapkan katalog dalam bentuk PDF'),
        ('p', 'Buat katalog di Canva, PowerPoint, atau Word, lalu simpan sebagai PDF. Isi yang biasanya dicari pembeli:'),
        ('ul', ['Foto produk yang terang dan seragam ukurannya.', 'Nama, varian, dan harga (atau kisaran harga).',
                'Cara pemesanan, nomor WhatsApp, dan lokasi/area pengiriman.',
                'Halaman sampul dengan logo dan nama usaha.']),
        ('p', 'Jika katalog Anda masih berupa kumpulan foto, gabungkan dengan [JPG ke PDF](/jpg-ke-pdf). File '
              'PowerPoint juga bisa langsung dijadikan flipbook.'),
        ('h2', '2. Jadikan flipbook'),
        ('ol', ['Buka [PDF ke Flipbook](/flipbook.html) dan tambahkan file katalog.',
                'Beri judul, misalnya "Katalog Ramadan 2026 — Nama Toko".',
                'Tekan Save My Library agar katalog tersimpan di akun Anda.']),
        ('h2', '3. Bagikan ke pembeli'),
        ('ul', ['Buat share link lalu kirim lewat WhatsApp, pasang di bio Instagram/TikTok, atau tempel di marketplace.',
                'Untuk tim sales yang sering presentasi tanpa sinyal, ekspor ke HTML offline atau aplikasi Android '
                '(paket Pro).',
                'Untuk komputer kasir atau showroom, gunakan aplikasi Windows (paket Business).']),
        ('h2', 'Tips katalog yang menjual'),
        ('ul', ['Satu halaman, satu fokus: jangan menumpuk terlalu banyak produk di satu halaman.',
                'Taruh produk terlaris di halaman-halaman awal.',
                'Perbarui katalog setiap ada perubahan harga, lalu bagikan ulang tautannya.',
                'Ukuran file besar? [Kompres PDF](/kompres-pdf) dulu agar katalog cepat terbuka di HP pembeli.']),
        ('faq', [
            ('Apakah pembeli harus mengunduh katalog?',
             'Tidak. Dengan share link, pembeli langsung membaca katalog di browser HP tanpa mengunduh apa pun.'),
            ('Bagaimana kalau harga berubah?',
             'Perbarui file katalog, simpan lagi, lalu bagikan tautan terbaru ke pelanggan.'),
            ('Bisa dibuka tanpa internet?',
             'Bisa, bila diekspor ke HTML offline atau aplikasi Android (paket Pro) maupun Windows (paket Business).'),
        ]),
        ('cta', 'pdf-ke-flipbook'),
    ], tool='pdf-ke-flipbook')

article(
    'cara-merangkum-jurnal-dengan-ai',
    'Cara Merangkum Jurnal dan Skripsi dengan AI dalam Hitungan Detik',
    'Pakai AI untuk merangkum jurnal, laporan, dan materi kuliah: poin penting, terjemahan per halaman, hingga '
    'podcast dua pembawa acara.',
    '2026-10-06',
    [
        ('p', 'Saat menyusun tinjauan pustaka, Anda mungkin perlu membaca puluhan jurnal. Ringkasan AI membantu '
              'menyaring mana yang relevan sebelum dibaca lengkap.'),
        ('h2', 'Langkah merangkum dengan AI Summarizer'),
        ('ol', ['Buka [AI Summarizer](/notebook.html).',
                'Tambahkan sumber: unggah PDF atau tempel link dokumen.',
                'Buat ringkasan. Biasanya selesai dalam 15–60 detik; dokumen panjang bisa lebih lama.',
                'Salin hasilnya ke catatan Anda.']),
        ('h2', 'Bukan hanya ringkasan'),
        ('ul', ['Terjemahan per halaman untuk jurnal berbahasa Inggris.',
                'Podcast dengan dua pembawa acara — cocok untuk "mendengarkan" materi sambil di perjalanan.']),
        ('h2', 'Cara memakai ringkasan AI dengan benar'),
        ('ul', ['Gunakan ringkasan untuk memilah bacaan, lalu baca bagian penting di sumber aslinya.',
                'Periksa angka, nama metode, dan kesimpulan langsung di jurnal — AI bisa keliru.',
                'Kutip jurnal aslinya, bukan ringkasan AI.',
                'Hindari mengunggah dokumen yang sangat rahasia: teks dokumen dikirim ke penyedia AI untuk diproses.']),
        ('h2', 'Belum punya jurnalnya?'),
        ('p', 'Cari jurnal dan ebook open access lewat [Cari Jurnal & Ebook](/cari-jurnal-ebook), lalu langsung '
              'ringkas atau baca sebagai flipbook. Untuk jurnal berbahasa Inggris, baca juga '
              '[cara menerjemahkannya tanpa merusak layout](/artikel/cara-menerjemahkan-jurnal-bahasa-inggris).'),
        ('tip', 'Akun Free mendapat jatah pemakaian AI yang terisi ulang berkala. Jika jatah habis, halaman akan '
                'memberi tahu kapan jatah terisi lagi.'),
        ('faq', [
            ('Berapa lama membuat ringkasan?',
             'Biasanya 15–60 detik. Dokumen yang sangat panjang bisa memerlukan waktu lebih lama.'),
            ('Apakah ringkasan AI selalu benar?',
             'Tidak selalu. Gunakan ringkasan sebagai panduan awal dan periksa angka serta kesimpulan di sumber aslinya.'),
            ('Apakah bisa merangkum dari link?',
             'Bisa. Selain mengunggah PDF, Anda dapat menempelkan link dokumen sebagai sumber.'),
        ]),
        ('cta', 'ringkas-pdf-ai'),
    ], tool='ringkas-pdf-ai')

article(
    'cara-mencari-jurnal-open-access',
    'Cara Mencari Jurnal Ilmiah & Ebook Gratis yang Legal (Open Access)',
    'Temukan jurnal dan buku akademik yang memang bebas dibaca — tanpa situs bajakan — lalu baca sebagai flipbook atau '
    'ringkas dengan AI.',
    '2026-10-06',
    [
        ('p', 'Jutaan artikel ilmiah dan buku akademik bisa dibaca gratis secara legal karena diterbitkan dengan akses '
              'terbuka (open access). Masalahnya, mencarinya tersebar di banyak situs.'),
        ('p', '[Cari Jurnal & Ebook](/cari-jurnal-ebook) di MyFlipbook mengumpulkan pencarian dari beberapa sumber '
              'terbuka dalam satu tempat.'),
        ('h2', 'Sumber yang dipakai'),
        ('ul', ['Jurnal: OpenAlex, katalog terbuka berisi ratusan juta karya ilmiah dari seluruh dunia. Artikel open '
                'access yang punya PDF publik bisa langsung dijadikan flipbook; artikel tertutup tetap bisa dibuka di '
                'situs penerbitnya.',
                'Ebook: OAPEN Library (buku akademik open access) dan Internet Archive — hanya buku berlisensi Creative '
                'Commons atau domain publik.']),
        ('h2', 'Langkah mencari'),
        ('ol', ['Buka [Find Journal & Ebook](/journals.html).',
                'Ketik kata kunci. Kata kunci bahasa Inggris biasanya memberi hasil lebih banyak, misalnya '
                '"digital marketing SME" atau "stunting nutrition".',
                'Pilih hasil yang relevan, lalu baca sebagai flipbook, ringkas dengan AI, atau simpan ke My Library.']),
        ('h2', 'Tips mencari referensi skripsi'),
        ('ul', ['Gunakan kombinasi kata kunci topik + metode, misalnya "customer loyalty SEM-PLS".',
                'Utamakan artikel 5–10 tahun terakhir, kecuali teori dasar.',
                'Catat DOI setiap artikel untuk daftar pustaka.',
                'Hormati lisensinya: CC-BY wajib mencantumkan penulis dan sumber; NC berarti tidak untuk komersial.']),
        ('faq', [
            ('Apa itu open access?',
             'Open access berarti artikel atau buku diterbitkan agar bebas dibaca siapa pun secara legal, biasanya dengan lisensi Creative Commons.'),
            ('Mengapa ada artikel yang tidak bisa dijadikan flipbook?',
             'Artikel tertutup tidak punya PDF publik. Anda tetap bisa membukanya di situs penerbit untuk melihat abstrak atau opsi aksesnya.'),
            ('Apakah ada jurnal berbahasa Indonesia?',
             'Ada. Katalog OpenAlex juga memuat jurnal Indonesia; coba gunakan kata kunci berbahasa Indonesia maupun Inggris.'),
        ]),
        ('cta', 'cari-jurnal-ebook'),
    ], tool='cari-jurnal-ebook')

article(
    'cara-mengubah-foto-jadi-pdf-di-hp',
    'Cara Mengubah Foto Jadi PDF di HP (JPG, PNG, HEIC iPhone)',
    'Ubah foto dokumen, KTP, atau tugas tulisan tangan menjadi satu file PDF langsung dari browser HP — tanpa aplikasi '
    'tambahan.',
    '2026-10-06',
    [
        ('p', 'Guru meminta tugas dikumpulkan dalam PDF, padahal Anda hanya punya foto di galeri HP? Tidak perlu '
              'memasang aplikasi. [JPG ke PDF](/jpg-ke-pdf) bekerja langsung di browser HP.'),
        ('h2', 'Langkah mengubah foto ke PDF'),
        ('ol', ['Buka [JPG ke PDF](/converter.html?tool=jpg-to-pdf) di browser HP.',
                'Pilih foto dari galeri. Bisa banyak foto sekaligus.',
                'Atur urutan, orientasi (tegak/mendatar), ukuran halaman (A4, Letter, atau sama dengan foto), dan margin.',
                'Unduh PDF-nya.']),
        ('h2', 'Format foto yang didukung'),
        ('p', 'JPG, PNG, WebP, HEIC (format foto iPhone), TIFF, GIF, BMP, dan lainnya. Foto HEIC dari iPhone diubah '
              'otomatis tanpa perlu diganti formatnya dulu. Semua diproses di HP Anda — foto tidak diunggah ke server.'),
        ('h2', 'Tips agar hasil foto rapi'),
        ('ul', ['Foto dokumen di atas alas gelap dengan cahaya merata, dan hindari bayangan tangan.',
                'Ambil foto tegak lurus dari atas agar tulisan tidak miring.',
                'Pilih ukuran A4 bila PDF akan dicetak; pilih "sama dengan foto" bila hanya untuk dilihat di layar.',
                'Ukuran PDF terlalu besar untuk diunggah? Kecilkan dengan [Kompres PDF](/kompres-pdf).']),
        ('h2', 'Kebalikannya: PDF ke foto'),
        ('p', 'Perlu mengunggah halaman PDF ke Instagram atau status WhatsApp? Gunakan [PDF ke JPG](/pdf-ke-jpg).'),
        ('faq', [
            ('Apakah perlu aplikasi tambahan?',
             'Tidak. Semuanya berjalan di browser HP, termasuk untuk foto HEIC dari iPhone.'),
            ('Apakah foto saya diunggah?',
             'Tidak. Konversi berjalan di HP Anda; foto tidak dikirim ke server.'),
            ('Bisa menggabungkan banyak foto jadi satu PDF?',
             'Bisa. Pilih beberapa foto sekaligus, atur urutannya, lalu unduh sebagai satu PDF.'),
        ]),
        ('cta', 'jpg-ke-pdf'),
    ], tool='jpg-ke-pdf')

article(
    'cara-membuat-ebook-jadi-aplikasi-android',
    'Cara Mengubah E-book PDF Jadi Aplikasi Android (APK) Tanpa Coding',
    'Jadikan e-book, modul ajar, atau katalog sebagai aplikasi Android yang bisa dipasang dan dibaca tanpa internet — '
    'tanpa menulis satu baris kode pun.',
    '2026-10-06',
    [
        ('p', 'Sekolah, penerbit indie, dan lembaga pelatihan sering ingin materi mereka bisa dibaca di HP tanpa koneksi '
              'internet. Membuat aplikasi sendiri biasanya butuh programmer. Dengan MyFlipbook, e-book PDF Anda bisa '
              'dijadikan aplikasi Android langsung dari browser.'),
        ('h2', 'Kapan e-book sebaiknya dijadikan aplikasi?'),
        ('ul', ['Modul ajar untuk siswa di daerah dengan sinyal terbatas.',
                'Buku saku atau SOP untuk karyawan lapangan.',
                'Katalog untuk tim sales yang presentasi di lokasi pelanggan.',
                'E-book berbayar yang ingin dibagikan dalam bentuk aplikasi.']),
        ('h2', 'Langkah membuat aplikasi Android'),
        ('ol', ['Buka e-book di [PDF ke Flipbook](/flipbook.html) dan pastikan tampilannya sudah sesuai.',
                'Isi judul buku — judul ini dipakai sebagai nama aplikasi.',
                'Di panel Save & export, pilih Build Android APK.',
                'Tunggu proses build selesai (beberapa menit), lalu unduh file APK-nya.',
                'Bagikan file APK ke pembaca untuk dipasang di HP Android mereka.']),
        ('h2', 'Pilihan lain untuk dibaca tanpa internet'),
        ('ul', ['HTML offline: satu file yang bisa dibuka di browser apa pun tanpa internet (paket Pro).',
                'Aplikasi Windows (EXE): untuk komputer laboratorium atau kantor (paket Business).',
                'Share link: jika pembaca punya internet, cukup kirim link — tidak perlu memasang apa pun.']),
        ('h2', 'Hal yang perlu diperhatikan'),
        ('ul', ['Fitur Build Android APK tersedia di paket Pro.',
                'HP pembaca mungkin meminta izin memasang aplikasi dari luar Play Store; itu normal untuk file APK yang '
                'dibagikan langsung.',
                'Pastikan Anda memegang hak atas isi e-book yang dijadikan aplikasi.']),
        ('faq', [
            ('Apakah perlu bisa coding?',
             'Tidak. Cukup buka e-book sebagai flipbook dan pilih Build Android APK.'),
            ('Apakah aplikasinya bisa dibuka tanpa internet?',
             'Bisa. Isi buku dibawa di dalam aplikasi sehingga bisa dibaca tanpa koneksi.'),
            ('Bisakah aplikasi dibagikan lewat WhatsApp?',
             'Bisa, kirim file APK-nya. Penerima mungkin perlu mengizinkan pemasangan aplikasi dari luar Play Store.'),
        ]),
        ('cta', 'pdf-ke-flipbook'),
    ], tool='pdf-ke-flipbook')

article(
    'cara-membuat-e-modul-flipbook-untuk-guru',
    'Cara Membuat E-Modul Flipbook untuk Guru (Bisa Dibaca Offline)',
    'Panduan untuk guru dan dosen: ubah modul ajar PDF menjadi e-modul flipbook yang bisa dibagikan ke siswa lewat '
    'link, dibacakan dengan suara, dan dibuka tanpa internet.',
    '2026-10-07',
    [
        ('p', 'E-modul flipbook membuat materi terasa seperti buku sungguhan: halaman bisa dibalik, gambar tampil penuh, dan '
              'siswa betah membaca lebih lama dibanding PDF biasa. Banyak sekolah dan kampus kini meminta guru menyiapkan '
              'bahan ajar digital seperti ini.'),
        ('p', 'Kabar baiknya, Anda tidak perlu keahlian desain atau software berat. Siapkan modul dalam bentuk PDF, lalu '
              'jadikan flipbook dengan [PDF ke Flipbook](/pdf-ke-flipbook) di MyFlipbook — antarmukanya berbahasa Indonesia.'),
        ('h2', '1. Siapkan modul ajar'),
        ('ul', ['Susun modul di Word, PowerPoint, atau Canva: sampul, capaian pembelajaran, materi, contoh soal, rangkuman, '
                'dan evaluasi.',
                'Simpan sebagai PDF. File Word dan PowerPoint juga bisa langsung dijadikan flipbook.',
                'Gunakan huruf yang cukup besar (minimal 12 pt) agar nyaman dibaca di HP siswa.',
                'Jika materinya berupa foto atau hasil scan, satukan dulu dengan [JPG ke PDF](/jpg-ke-pdf) atau '
                '[Scan ke PDF](/scan-ke-pdf).']),
        ('h2', '2. Jadikan e-modul flipbook'),
        ('ol', ['Buka [PDF ke Flipbook](/flipbook.html) dan tambahkan file modul dari komputer, HP, atau Google Drive.',
                'Isi judul, misalnya "E-Modul Biologi Kelas X — Sel".',
                'Coba balik halamannya dan periksa tampilannya di layar penuh.',
                'Tekan Save My Library agar e-modul tersimpan di akun Anda.']),
        ('h2', '3. Bagikan ke siswa'),
        ('ul', ['Share link — kirim lewat grup WhatsApp kelas atau tempel di Google Classroom/LMS. Siswa membuka di browser '
                'tanpa login.',
                'HTML offline — satu file yang bisa disalin ke flashdisk atau komputer lab dan dibuka tanpa internet (paket Pro).',
                'Aplikasi Android (APK) — e-modul dipasang di HP siswa dan dibaca tanpa kuota (paket Pro). Lihat '
                '[cara membuat aplikasi Android dari e-book](/artikel/cara-membuat-ebook-jadi-aplikasi-android).',
                'Aplikasi Windows (EXE) — untuk komputer laboratorium sekolah (paket Business).']),
        ('h2', 'Fitur yang membantu siswa belajar'),
        ('ul', ['Audio book: halaman bisa dibacakan dengan suara — membantu siswa yang lebih mudah belajar dengan mendengar.',
                'Stabilo dan catatan untuk menandai bagian penting.',
                'Materi berbahasa Inggris bisa diterjemahkan ke Bahasa Indonesia dengan tombol Translate.',
                'Halaman hasil scan tetap bisa distabilo dan dibacakan karena teksnya dikenali dengan OCR.']),
        ('tip', 'Untuk satu sekolah atau satu jurusan, paket Business memungkinkan e-modul dijadikan aplikasi Windows untuk '
                'komputer lab selain aplikasi Android.'),
        ('faq', [
            ('Apakah siswa perlu membuat akun?', 'Tidak. Siswa cukup membuka share link di browser, atau memasang aplikasi/membuka file offline yang Anda bagikan.'),
            ('Apakah e-modul bisa dibuka tanpa internet?', 'Bisa, bila diekspor ke HTML offline atau aplikasi Android (paket Pro) maupun Windows (paket Business).'),
            ('Berapa ukuran PDF yang ideal?', 'Usahakan di bawah 30–50 MB agar cepat dibuka di HP. File besar bisa dikecilkan dulu dengan Kompres PDF.'),
        ]),
        ('cta', 'pdf-ke-flipbook'),
    ], tool='pdf-ke-flipbook')

article(
    'flipbook-untuk-pembelajaran',
    'Flipbook untuk Pembelajaran: Ide dan Tips agar Siswa Betah Membaca',
    'Ide memakai flipbook di kelas — e-modul, buku cerita, LKPD, portofolio, majalah sekolah — plus tips desain agar '
    'materi enak dibaca di HP.',
    '2026-10-07',
    [
        ('p', 'Flipbook bukan sekadar PDF yang bisa dibalik. Dengan tampilan seperti buku, materi terasa lebih menarik — '
              'terutama untuk siswa yang terbiasa membaca di HP. Berikut ide pemakaian dan tips agar flipbook benar-benar '
              'membantu pembelajaran.'),
        ('h2', 'Ide flipbook di sekolah'),
        ('ul', ['E-modul dan bahan ajar per bab — lihat [cara membuat e-modul flipbook](/artikel/cara-membuat-e-modul-flipbook-untuk-guru).',
                'Buku cerita bergambar untuk literasi SD, lengkap dengan audio yang membacakan halaman.',
                'LKPD (lembar kerja) yang dibaca di layar, dengan jawaban ditulis di buku tulis atau formulir terpisah.',
                'Portofolio karya siswa atau laporan proyek P5.',
                'Majalah atau buletin sekolah yang dibagikan ke orang tua lewat link.',
                'Kumpulan soal latihan dan pembahasan menjelang ujian.']),
        ('h2', 'Tips desain agar enak dibaca'),
        ('ul', ['Satu halaman, satu gagasan. Pecah teks panjang menjadi poin-poin dan beri judul kecil.',
                'Pakai ukuran halaman seragam (misalnya A4 tegak) agar buku terlihat rapi saat dibalik.',
                'Beri banyak gambar, diagram, dan contoh — flipbook menampilkan gambar dengan jelas.',
                'Letakkan sampul di halaman pertama dan usahakan jumlah halaman genap agar pasangan halaman kiri-kanan pas.',
                'Cek tampilan di HP sebelum dibagikan; sebagian besar siswa membaca dari HP.']),
        ('h2', 'Membuat siswa aktif, bukan sekadar membaca'),
        ('ul', ['Minta siswa menstabilo kalimat kunci dan menulis catatan di flipbook.',
                'Gunakan audio book untuk siswa yang kesulitan membaca atau untuk latihan menyimak.',
                'Untuk materi berbahasa Inggris, siswa bisa membandingkan teks asli dengan terjemahan Bahasa Indonesia.',
                'Akhiri tiap bab dengan pertanyaan refleksi atau tautan ke kuis.']),
        ('h2', 'Cara cepat membuatnya'),
        ('p', 'Siapkan materi sebagai PDF (atau Word/PowerPoint), lalu buka [PDF ke Flipbook](/pdf-ke-flipbook). Dalam '
              'hitungan detik flipbook siap dibagikan lewat share link, atau diekspor menjadi file offline dan aplikasi.'),
        ('faq', [
            ('Apakah flipbook bisa dibuka di HP siswa yang sederhana?', 'Bisa dibuka di browser HP. Untuk HP dengan memori terbatas, kecilkan dulu ukuran PDF dengan Kompres PDF.'),
            ('Apakah bisa dipakai di Google Classroom?', 'Bisa. Tempelkan share link flipbook sebagai materi atau tugas.'),
        ]),
        ('cta', 'pdf-ke-flipbook'),
    ], tool='pdf-ke-flipbook')

article(
    'alternatif-heyzine-fliphtml5-bahasa-indonesia',
    'Alternatif Heyzine dan FlipHTML5 Berbahasa Indonesia',
    'Mencari pembuat flipbook selain Heyzine atau FlipHTML5? Ini kriteria memilih yang sesuai kebutuhan sekolah, UMKM, '
    'dan kantor di Indonesia — dan apa yang ditawarkan MyFlipbook.',
    '2026-10-07',
    [
        ('p', 'Heyzine, FlipHTML5, AnyFlip, Flipsnack, dan Issuu adalah nama-nama yang sering muncul saat mencari pembuat '
              'flipbook. Semuanya layanan yang mapan. Namun kebutuhan tiap orang berbeda — guru di daerah dengan sinyal '
              'terbatas, UMKM yang berjualan lewat WhatsApp, atau kantor yang dokumennya rahasia — sehingga wajar mencari '
              'alternatif yang lebih pas.'),
        ('h2', 'Kriteria memilih pembuat flipbook'),
        ('ul', ['Bahasa antarmuka — apakah Anda dan pembaca nyaman memakai antarmuka berbahasa Inggris?',
                'Bisa dibaca offline — penting untuk sekolah dan presentasi di lokasi tanpa sinyal.',
                'Batas di paket gratis — jumlah flipbook, jumlah halaman, watermark, dan iklan.',
                'Cara membagikan — link, file offline, atau aplikasi yang bisa dipasang.',
                'Fitur membaca — stabilo, catatan, suara, terjemahan.',
                'Privasi — di mana dokumen disimpan dan siapa yang bisa membukanya.',
                'Harga dan cara bayar — mata uang dan metode pembayaran yang mudah di Indonesia.']),
        ('h2', 'Perbandingan singkat'),
        ('table', {
            'head': ['', 'MyFlipbook Pro', 'Heyzine', 'FlipHTML5', 'AnyFlip'],
            'rows': [
                ['Paket gratis', '3 share link, coba semua fitur 7 hari', '5 flipbook, halaman tanpa batas, tanpa iklan',
                 '5 unggahan per hari, ada iklan dan watermark', '150 unggahan per bulan, ada iklan'],
                ['Unduh untuk dibaca offline', 'HTML offline (paket Pro)', 'Mulai paket Standard',
                 'Paket berbayar (Pro ke atas)', 'Paket Pro, 5 kali per bulan'],
                ['Jadi aplikasi Android (APK)', 'Ya (paket Pro)', 'Tidak disebut', 'Ya (paket berbayar)', 'Tidak disebut'],
                ['Jadi aplikasi Windows (EXE)', 'Ya (paket Business)', 'Tidak disebut', 'Ya (paket berbayar)', 'Tidak disebut'],
                ['Terjemahkan seluruh buku di dalam flipbook', 'Ya, layout mengikuti kolom asli', 'Tidak disebut',
                 'Tidak disebut', 'Tidak disebut'],
                ['Audio book (halaman dibacakan)', 'Ya', 'Tidak disebut', 'Tidak disebut', 'Tidak disebut'],
            ],
            'note': ('Dicek 9 Oktober 2026 dari halaman harga resmi dan profil Capterra masing-masing layanan. "Tidak disebut" '
                     'artinya fitur itu tidak tercantum di sumber yang kami cek, bukan pasti tidak ada. Fitur dan harga bisa '
                     'berubah, jadi periksa halaman resminya sebelum memutuskan.'),
            'sources': [('Heyzine', 'https://heyzine.com/'), ('FlipHTML5', 'https://fliphtml5.com/'),
                        ('AnyFlip', 'https://anyflip.com/'),
                        ('Capterra: Heyzine', 'https://www.capterra.co.uk/software/209819/heyzine'),
                        ('Capterra: FlipHTML5', 'https://www.capterra.com/p/202617/FlipHTML5/pricing/'),
                        ('Capterra: AnyFlip', 'https://www.capterra.com/p/210554/AnyFlip/pricing/')],
        }),
        ('h2', 'Yang ditawarkan MyFlipbook'),
        ('ul', ['Antarmuka dan panduan berbahasa Indonesia.',
                'PDF, Word, PowerPoint, dan gambar langsung jadi flipbook — dari komputer, HP, Google Drive, atau link.',
                'Share link untuk dibaca di browser tanpa login (3 link gratis di akun Free).',
                'Ekspor offline: HTML (paket Pro), aplikasi Android/APK (paket Pro), dan aplikasi Windows/EXE (paket Business).',
                'Audio book, stabilo, catatan, dan spidol di dalam flipbook.',
                'Terjemahan seluruh buku dari bahasa Inggris ke Bahasa Indonesia dengan tata letak tetap mengikuti kolom asli.',
                'Alat PDF lengkap di satu tempat: kompres, gabung, pisah, tanda tangan, sensor, OCR, dan lainnya.',
                'Proyek di My Library disimpan terenkripsi.']),
        ('h2', 'Kapan MyFlipbook cocok?'),
        ('ul', ['Guru yang membuat e-modul dan perlu versi offline untuk siswa — lihat '
                '[cara membuat e-modul flipbook](/artikel/cara-membuat-e-modul-flipbook-untuk-guru).',
                'UMKM yang membagikan katalog lewat WhatsApp — lihat '
                '[cara membuat katalog produk digital](/artikel/cara-membuat-katalog-produk-digital).',
                'Mahasiswa dan peneliti yang membaca jurnal berbahasa Inggris — lihat '
                '[cara menerjemahkan jurnal](/artikel/cara-menerjemahkan-jurnal-bahasa-inggris).']),
        ('h2', 'Coba sebelum memutuskan'),
        ('p', 'Akun baru bisa mencoba semua fitur selama 7 hari. Ambil satu PDF yang biasa Anda pakai, jadikan flipbook di '
              'beberapa layanan, lalu bandingkan sendiri hasil dan kemudahannya.'),
        ('faq', [
            ('Apakah flipbook dari layanan lain bisa dipindahkan ke MyFlipbook?', 'Cukup unggah ulang file PDF aslinya ke PDF ke Flipbook; flipbook baru siap dalam hitungan detik.'),
            ('Apakah MyFlipbook gratis?', 'Membaca dan membuat flipbook bisa dicoba gratis; akun baru mendapat masa coba 7 hari untuk semua fitur. Ekspor offline dan aplikasi tersedia di paket berbayar.'),
        ]),
        ('cta', 'pdf-ke-flipbook'),
    ], tool='pdf-ke-flipbook', updated='2026-10-09')

article(
    'cara-membaca-jurnal-pdf-lebih-nyaman',
    'Cara Membaca Jurnal PDF Lebih Nyaman: Jadikan Seperti Buku',
    'Jurnal dan e-book PDF melelahkan dibaca di HP? Ubah jadi flipbook yang bisa dibalik, distabilo, diberi catatan, '
    'dibacakan, dan diterjemahkan — semua tersimpan di satu tempat.',
    '2026-10-07',
    [
        ('p', 'Membaca jurnal PDF di HP sering bikin pusing: harus zoom dan geser ke kanan-kiri, catatan tercecer di aplikasi '
              'lain, dan besok lupa sampai halaman berapa. Padahal mahasiswa bisa membaca puluhan artikel dalam satu semester.'),
        ('p', 'Dengan [PDF ke Flipbook](/pdf-ke-flipbook), jurnal tampil seperti buku yang halamannya bisa dibalik, lengkap '
              'dengan alat untuk belajar.'),
        ('h2', 'Langkahnya'),
        ('ol', ['Buka [PDF ke Flipbook](/flipbook.html) dan tambahkan jurnal dari HP, laptop, Google Drive, atau link.',
                'Baca dalam mode layar penuh; balik halaman seperti membaca buku.',
                'Tekan Save My Library agar jurnal tersimpan di akun dan bisa dibuka lagi kapan saja tanpa mengunggah ulang.']),
        ('h2', 'Alat yang membuat belajar lebih ringan'),
        ('ul', ['Stabilo untuk menandai kalimat penting — dan ringkas bagian yang distabilo dengan AI menjadi catatan singkat.',
                'Catatan per halaman yang bisa ditambah, diedit, dan diekspor sebagai teks untuk bahan tinjauan pustaka.',
                'Bookmark untuk menandai halaman penting dan langsung melompat ke sana.',
                'Audio book: halaman dibacakan dengan suara, cocok untuk mengulang materi sambil di perjalanan.',
                'Terjemahan seluruh jurnal berbahasa Inggris ke Bahasa Indonesia, tata letaknya tetap mengikuti kolom asli.',
                'Spidol untuk mencoret-coret diagram atau rumus.']),
        ('h2', 'Jurnal hasil scan?'),
        ('p', 'Halaman bergambar atau hasil scan tetap bisa distabilo dan dibacakan karena teksnya dikenali dengan OCR. Untuk '
              'menyalin teksnya ke Word, gunakan [OCR PDF](/ocr-pdf) lalu [PDF ke Word](/pdf-ke-word).'),
        ('faq', [
            ('Apakah stabilo dan catatan saya tersimpan?', 'Ya, stabilo, catatan, dan bookmark tersimpan untuk setiap buku sehingga bisa dilanjutkan saat dibuka lagi di perangkat yang sama.'),
            ('Apakah jurnal saya bisa dilihat orang lain?', 'Tidak. Jurnal di My Library disimpan terenkripsi di akun Anda; hanya terbuka untuk orang lain bila Anda sendiri membuat share link.'),
            ('Berapa jurnal yang bisa saya simpan?', 'Sesuai kuota paket Anda. Jurnal yang sudah tidak dipakai bisa dihapus dari My Library.'),
        ]),
        ('cta', 'pdf-ke-flipbook'),
    ], tool='pdf-ke-flipbook')

article(
    'cara-menggabungkan-jurnal-jadi-buku-referensi',
    'Cara Menggabungkan Banyak Jurnal Jadi Satu Buku Referensi Skripsi',
    'Satukan jurnal-jurnal referensi skripsi menjadi satu buku flipbook: urut per bab, diberi bookmark dan catatan, '
    'siap dibaca kapan saja.',
    '2026-10-07',
    [
        ('p', 'Saat menyusun skripsi atau tesis, folder "Referensi" biasanya penuh puluhan file PDF dengan nama acak. Mencari '
              'kembali kutipan yang pernah dibaca jadi membuang waktu. Solusinya: kumpulkan jurnal per bab menjadi satu buku.'),
        ('h2', '1. Kelompokkan jurnal per bab'),
        ('p', 'Misalnya Bab 2 (landasan teori), Bab 3 (metode), dan jurnal pembanding hasil penelitian. Beri nama file yang '
              'jelas, misalnya "Bab2-01-Kotler-2020.pdf", agar urutannya rapi.'),
        ('h2', '2. Gabungkan jadi satu PDF'),
        ('ol', ['Buka [Gabung PDF](/converter.html?tool=merge-pdf) dan pilih jurnal satu bab.',
                'Atur urutannya, lalu gabungkan.',
                'Halaman yang tidak perlu (misalnya daftar pustaka panjang) bisa dibuang dengan [Atur Halaman PDF](/atur-halaman-pdf).',
                'Bila ukurannya besar, kecilkan dengan [Kompres PDF](/kompres-pdf) agar ringan dibuka di HP.']),
        ('h2', '3. Jadikan buku referensi'),
        ('ol', ['Buka hasil gabungan di [PDF ke Flipbook](/flipbook.html) dan beri judul, misalnya "Referensi Bab 2".',
                'Pasang bookmark di halaman pertama setiap jurnal agar mudah berpindah antarartikel.',
                'Stabilo kalimat yang akan dikutip dan tulis catatan — catatan bisa diekspor sebagai teks.',
                'Simpan ke My Library.']),
        ('h2', 'Belum punya cukup referensi?'),
        ('p', 'Cari jurnal dan ebook open access lewat [Cari Jurnal & Ebook](/cari-jurnal-ebook), ringkas dengan '
              '[AI Summarizer](/ringkas-pdf-ai) untuk memilah yang relevan, lalu terjemahkan jurnal berbahasa Inggris dengan '
              '[Terjemahkan PDF](/terjemahkan-pdf).'),
        ('tip', 'Buku referensi ini untuk belajar pribadi. Tetap tulis sitasi dari jurnal aslinya (penulis, tahun, judul, DOI), '
                'dan jangan menyebarkan ulang jurnal berbayar.'),
        ('faq', [
            ('Apakah urutan jurnal bisa diubah setelah digabung?', 'Bisa, dengan Atur Halaman PDF; lalu buat flipbook ulang dari hasilnya.'),
            ('Apakah ada batas jumlah file yang digabung?', 'Tidak ada batas jumlah khusus; batasnya kemampuan memori perangkat. Untuk puluhan jurnal besar, gabungkan per bab.'),
        ]),
        ('cta', 'gabung-pdf'),
    ], tool='gabung-pdf')

article(
    'cara-membaca-jurnal-dengan-cepat',
    'Cara Membaca Jurnal dengan Cepat untuk Skripsi',
    'Strategi membaca jurnal secara efisien: pilah dulu dengan abstrak dan ringkasan AI, baca bagian yang perlu, '
    'stabilo dan catat untuk tinjauan pustaka.',
    '2026-10-07',
    [
        ('p', 'Membaca jurnal dari halaman pertama sampai terakhir satu per satu bisa memakan berjam-jam. Peneliti '
              'berpengalaman membaca secara bertahap: memilah dulu, baru membaca mendalam yang benar-benar relevan.'),
        ('h2', 'Tahap 1: Pilah dalam 5 menit'),
        ('ol', ['Baca judul dan abstrak — apakah topiknya sesuai skripsi Anda?',
                'Lompat ke kesimpulan untuk melihat temuan utamanya.',
                'Lihat tabel dan gambar hasil.',
                'Belum yakin? Buat ringkasan dengan [AI Summarizer](/ringkas-pdf-ai) — biasanya selesai dalam 15–60 detik.']),
        ('h2', 'Tahap 2: Baca bagian yang dibutuhkan'),
        ('ul', ['Untuk landasan teori: bagian pendahuluan dan tinjauan pustaka jurnal tersebut.',
                'Untuk metode: bagian metode (sampel, variabel, alat analisis).',
                'Untuk pembahasan: hasil dan diskusi, lalu bandingkan dengan penelitian Anda.']),
        ('h2', 'Tahap 3: Tandai dan catat'),
        ('p', 'Buka jurnal sebagai flipbook — lihat [cara membaca jurnal PDF lebih nyaman](/artikel/cara-membaca-jurnal-pdf-lebih-nyaman):'),
        ('ul', ['Stabilo kalimat yang akan dikutip; bagian yang distabilo bisa diringkas AI menjadi catatan.',
                'Tulis catatan per halaman: poin penting, kritik, dan kaitannya dengan skripsi Anda.',
                'Ekspor catatan sebagai teks untuk mulai menulis tinjauan pustaka.']),
        ('h2', 'Jurnal berbahasa Inggris'),
        ('p', 'Terjemahkan seluruh jurnal ke Bahasa Indonesia dengan tombol Translate di flipbook untuk memahami isi lebih '
              'cepat, lalu periksa istilah teknis di teks aslinya. Panduan lengkap: '
              '[cara menerjemahkan jurnal bahasa Inggris](/artikel/cara-menerjemahkan-jurnal-bahasa-inggris).'),
        ('tip', 'Ringkasan dan terjemahan AI membantu memahami, tetapi kutipan dan angka harus selalu dicek di jurnal aslinya.'),
        ('faq', [
            ('Berapa jurnal ideal untuk skripsi S1?', 'Ikuti pedoman kampus Anda. Yang penting relevan dan cukup baru; mulai dengan memilah 30–50 abstrak lalu baca mendalam yang paling sesuai.'),
            ('Di mana mencari jurnal gratis yang legal?', 'Coba Cari Jurnal & Ebook di MyFlipbook, yang mengambil dari sumber open access seperti OpenAlex dan OAPEN.'),
        ]),
        ('cta', 'ringkas-pdf-ai'),
    ], tool='ringkas-pdf-ai')
