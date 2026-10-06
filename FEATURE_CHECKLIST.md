# Checklist fitur PDF Project

Diperbarui: 29 September 2026. Status berdasarkan kode dan bukti tes, bukan hanya keberadaan kartu menu.

**Arti centang:** fungsi yang disebut sudah lolos pengujian dalam lingkup di kolom bukti. Bukan jaminan semua dokumen, browser, atau perangkat sudah teruji. Katalog berisi 34 kartu: 18 tool converter, 3 halaman langsung (flipbook/notebook/demo), dan 13 fitur katalog belum dibuat.

## Sudah teruji

| Status | Fitur | Bukti dan cakupan |
|---|---|---|
| [x] | Compress PDF | 29 Sep: foto/scan di dalam PDF diperkecil + di-encode ulang JPEG (Light ≤2400px q.85, Balanced ≤1700px q.72, Strong ≤1150px q.58); teks/vektor tidak disentuh; mask transparansi dipertahankan; gambar hanya diganti bila lebih kecil; file tidak pernah membesar. Chromium nyata: PDF foto 660 KB → 246/122/44 KB, render identik. `pdf-compress.test.cjs`. PDF teks murni hampir tidak mengecil (dilaporkan jujur). CMYK/JPX/JBIG2/indexed dibiarkan. |
| [x] | Image to PDF | 29 Sep, Chromium nyata: JPG, PNG (alpha→putih), WebP, GIF (frame 1), BMP, ICO, TIFF multi-halaman (semua halaman), SVG (dengan ukuran & viewBox saja), AVIF, HEIC, JPEG EXIF miring (tegak benar). Orientasi Auto per gambar, A4/Letter/Same as image (tanpa margin), margin Normal/None/Wide, gambar di tengah, foto JPEG 0.92 & grafis lossless (PNG), nama file dari gambar pertama. TIFF/HEIC butuh internet (decoder dimuat dari CDN). |
| [x] | PDF to JPG | 29 Sep, Chromium nyata: 12 halaman → ZIP `nama-page-01..12.jpg` (urut benar), halaman landscape & berotasi 90° benar, 1 halaman → file .jpg langsung, opsi PNG lossless, latar putih, poster A0 @3x otomatis diperkecil ke batas canvas (60 MP) dan diberi tahu, PDF berpassword → pesan jelas. |
| [x] | HTML to PDF | 29 Sep: dicetak Edge/Chrome headless di server (tata letak, warna/gradien, flex, tabel, gambar data:, kertas A4/Letter/A3/Legal + margin; @page halaman tetap menang). Mode lokal: gambar online + JS jalan. Mode hosting: JS mati (CSP), semua jaringan lewat proxy mati → tidak bisa SSRF; file lokal tidak terbaca (halaman disajikan dari loopback + CSP). Diuji `HtmlToPdfTests` (4 tes, termasuk cetak asli) + UI Chromium. Tanpa Edge/Chrome → fallback teks saja, dengan pemberitahuan. Folder `_files` dari "Save page, complete" tidak ikut (satu file). |
| [x] | PowerPoint to PDF | 29 Sep, UI Chromium + LibreOffice asli: PPTX 4 slide 16:9 (latar gelap, bullet, shape rounded, tabel, grafik batang, foto, notes) → PDF 4 halaman 720×405, visual cocok; PPT lama (hasil simpan LibreOffice) juga 4 halaman. ~3-4 detik. Karakter `·` bisa berubah karena substitusi font. |
| [x] | OCR PDF (searchable) | 29 Sep: halaman asli TIDAK dirender ulang (ukuran, kualitas, ukuran file tetap); lapisan teks tak terlihat (Tr 3) per kata, direntang tepat ke kotak kata (Tz) dan ikut rotasi halaman; halaman yang sudah punya teks dilewati. Chromium + Tesseract nyata (ind): scan A4 ~200 dpi + halaman berotasi 90° terbaca benar ("Pendapatan … 24 persen", "3.414"), posisi kata cocok (±1 pt), tampilan identik. `pdf-ocr-layer.test.cjs`. Huruf di luar WinAnsi (mis. aksara non-Latin) tidak dimasukkan. Butuh internet pertama kali (engine + data bahasa). |
| [x] | OCR ekstraksi (PDF→Word/Excel/PPT) | Tesseract Inggris/Indonesia + filter kualitas; scan bersih terbaca akurat (uji OCR PDF di atas). Scan buram/poster belum diuji. |
| [x] | PDF to Excel | 29 Sep, dokumen uji sulit (LibreOffice PDF: tabel 5 kolom rapat + sel gabungan, angka format Indonesia, bullet bertingkat, foto, footer): kolom terpisah benar (jarak kolom kini relatif ukuran huruf, dulu 50 pt tetap sehingga tabel rapat tergabung), bullet tetap menempel teksnya, 1.250.000/(3.200)/1.000,50/12,8%/-100% jadi angka asli dengan format tampilan (#,##0 / 0.0% / "Rp "), kode 007 tetap teks, 2,2% tanpa galat pembulatan. Sheet gambar halaman tetap ada. |
| [x] | PDF to Word | 29 Sep, dokumen uji sulit, dibuka ulang di LibreOffice: mode "Keep original look" hampir identik (teks editable di posisi aslinya; di sel tabel sempit teks bisa menempel garis karena metrik font pengganti); mode "Flowing" menghasilkan judul, paragraf, bullet dan tabel Word asli 5 kolom. Belum diuji di Microsoft Word asli. |
| [x] | PDF to PowerPoint | 29 Sep, dokumen uji sulit dibuka ulang di LibreOffice: slide seukuran halaman, tampilan cocok, teks editable. Gambar/vektor belum jadi objek terpisah. Belum diuji di PowerPoint asli. |
| [x] | Merge PDF | PDF asli digabung; hasil dibuka ulang dan jumlah halaman diperiksa. |
| [x] | Split / extract PDF | Rentang halaman dan ZIP per halaman lolos pemeriksaan isi. |
| [x] | Rotate PDF | Rotasi output diverifikasi pada struktur PDF. |
| [x] | Organize PDF | Urutan pilihan dan rotasi output diuji melalui fungsi sebenarnya. |
| [x] | Watermark | Teks dan PNG, opacity, posisi, rentang halaman; hasil PDF dirender dan diperiksa. JPEG didukung kode, belum mendapat fixture terpisah. |
| [x] | Page Numbers | Nomor awal/posisi, termasuk halaman berotasi 0/90/180/270 derajat. |
| [x] | Crop PDF | Margin mm, rentang, offset CropBox, halaman berotasi; crop yang menghabiskan halaman ditolak. Crop menyembunyikan area, bukan redaksi permanen. |
| [x] | DOCX ke PDF melalui LibreOffice | Tes HTTP nyata: header, tabel, gambar, page break, 2 halaman. Seluruh halaman hasil dirender dan diperiksa. DOC lama didukung, belum diuji dengan dokumen nyata. |
| [x] | XLSX/CSV ke PDF melalui LibreOffice | Tes nyata: 75 baris, 2 sheet, hasil rumus, landscape, CSV UTF-8; hasil dirender. XLS lama didukung, belum mendapat fixture nyata. |
| [x] | PDF ke flipbook | PDF.js asli merender PDF uji; engine PageFlip asli diuji dalam DOM simulasi. |
| [x] | Cover, navigasi, Home | Cover seukuran satu halaman; maju/mundur hingga akhir; Home kembali ke cover; single page, portrait/landscape, layar sempit diuji. |
| [x] | Pengingat idle | Peringatan pada 170 detik, kembali ke cover pada 180 detik; interaksi mengulang timer. Jam dan DOM disimulasikan. |
| [x] | Simpan / buka proyek `.flipbook` | PDF sumber dan metadata melewati round-trip; editor membuka ulang proyek. |
| [x] | Ekspor HTML ZIP | Editor menghasilkan ZIP dengan halaman, viewer, engine, CSS, metadata, dan aset lokal. Kelengkapan paket diuji. |
| [x] | Handoff converter ke flipbook | Hasil PDF menawarkan tombol flipbook; penyimpanan/pengambilan Blob diuji dengan IndexedDB simulasi. |
| [x] | Lokasi simpan kustom | Pemilihan tujuan, cancel, error tulis, streaming, fallback diuji dengan API simulasi. Dialog OS asli belum diuji. |
| [x] | PDF to Markdown | Judul/daftar/tabel terdeteksi dari font dan kolom; mock builder OK; browser E2E belum. |
| [x] | Validasi / error | Range salah, crop kosong, watermark terlalu besar, input PDF rusak, tool tak tersedia; pesan error tetap terlihat. |
| [x] | Penghapusan pemotongan konten | Batas buatan teks/baris/kolom sudah dihapus. Tes ekstraksi >300 baris, teks panjang, dan >6 kolom lolos. Memori, format output, print area, dan timeout proses Office tetap berlaku. |
| [x] | Share link flipbook | 6 Okt: Pro/Business upload HTML tersegel → `/s/<id>` publik (buku main di browser + tombol ⬇ Download, `?dl=1` attachment); gate 401/402/403, tolak non-buku 400/413, 404, kuota paket, hapus hanya pemilik. `tests/test_share.py` + E2E HTTP server lokal. Tombol Share 1-klik di editor belum diuji di browser asli. |
| [x] | Sign PDF | 6 Okt (`assets/pdf-extra.js`): tanda tangan digambar / upload PNG-JPEG / ketik nama, ditaruh dengan klik + geser + ubah ukuran di pratinjau, banyak halaman. `tests/pdf-extra.test.cjs`: posisi dicek raster (termasuk halaman diputar 90°) + E2E Chromium (gambar di pad → klik halaman → unduh). |
| [x] | Redact PDF (permanen) | 6 Okt: seret kotak atau cari teks (semua halaman); halaman berkotak dirender jadi gambar + kotak hitam, jadi teks di bawahnya benar-benar hilang. Tes: PDF.js tidak menemukan teks lagi di halaman itu, halaman lain utuh, piksel kotak hitam + E2E. Halaman hasil scan: kotak manual. |
| [x] | PDF Forms (isi formulir) | 6 Okt: kolom AcroForm (teks, centang, dropdown, radio, list) dibaca + diisi, opsi kunci (flatten). Tes isi/flatten + E2E. XFA belum; huruf non-Latin ditolak jujur (font formulir). Membuat formulir baru belum. |
| [x] | Scan to PDF | 6 Okt: kamera HP (`capture`) / galeri, mode Dokumen (abu-abu, kertas diputihkan) / Abu-abu / Warna, A4 mengikuti orientasi foto atau ukuran foto 150 dpi. Tes enhance + ukuran halaman + E2E. Deteksi tepi/crop otomatis belum. |
| [x] | Compare PDF | 6 Okt: teks dua PDF per baris (PDF.js) dibandingkan dengan diff Myers, laporan merah/hijau dengan nomor halaman + unduh HTML. Tes diff + PDF nyata + escape + E2E. Perbandingan visual (gambar/tata letak) belum. |

## Sudah ada, belum boleh dianggap tuntas

| Fitur | Yang berjalan / bukti | Yang masih perlu diuji atau diperbaiki |
|---|---|---|
| Notebook PDF | Halaman dan fungsi ringkasan/chat ada, sebagian memakai Gemini. | QA menyeluruh, akurasi jawaban, koneksi API, penyimpanan kunci, serta kesiapan produksi. |
| Editor animasi (`animation.html`) | Ekstraksi native teks/gambar/grup; OCR lokal otomatis untuk halaman raster; area gambar/logo manual; elemen editable dan HTML ZIP offline. OCR PSJ halaman 5 teruji, 54 baris. | OCR Inggris/Indonesia/Melayu dan perbaikan background bersifat perkiraan. Pemisahan semua grafis secara otomatis belum tersedia. APK/EXE editor belum terhubung; browser/device QA belum lengkap. |
| Build APK / Windows EXE | 25 Sep: dibangun ulang lewat layanan build HTTP asli dan DIJALANKAN: EXE di Windows 11 (WebView2) dan APK di emulator Android (System WebView 66) — buku tampil, tombol, keyboard, swipe cepat, nama app = judul buku. `viewer-compat.test.cjs` menjaga reader tetap ES2018 + fallback CSS. | Belum di HP fisik; APK masih signing debug, EXE belum ditandatangani. |
| Offline HTML | Paket diekstrak dan dibuka via file:// di Chromium dengan jaringan mati: halaman, navigasi, tanpa request gagal. | Browser lain (Safari/Firefox) belum. |

## Belum dibuat

- [ ] Edit PDF umum (teks/gambar/shape).
- [ ] Protect PDF.
- [ ] PDF/A.
- [ ] Repair PDF.
- [ ] AI Summarizer sebagai tool terpisah.
- [ ] Translate PDF.
- [x] Workflow tahap 1 (`workflow.html`): gabung PDF + langkah Rotate, Keep/Remove pages, Watermark teks, Page numbers, Crop, Optimize; template; resep disimpan di browser; hasil -> download / Flipbook. Tahap berikut: langkah konversi (Word/Excel/PPT/Gambar -> PDF), OCR, export flipbook.
- [x] Paywall ekspor flipbook: Free hanya preview + simpan proyek; ekspor HTML/APK butuh Pro (Rp99.000), EXE butuh Business. Ditegakkan server (template ekspor 401/402) + UI; diuji `PaywallTests` dan alur Chromium Free→ditolak, Pro→ZIP lengkap terunduh.
- [x] Akun/login, paket, pembayaran Tripay (utama) / Midtrans Snap (+ simulasi lokal), kontrol akses mode hosting — `tests/test_accounts.py` (14 tes; Tripay: signature transaksi, pilihan channel, callback HMAC/referensi/event) + alur UI Chromium (daftar → pilih paket → bayar simulasi → plan aktif). Belum: reset password via email, verifikasi email, halaman admin, uji Tripay sandbox dengan key asli (request ke sandbox sudah tercapai: key palsu dijawab "Invalid API Key").
- [ ] Autosave proyek dan editor animasi lengkap.
- [ ] QA performa dokumen besar serta rilis aplikasi bertanda tangan.

Unlock PDF sengaja dihapus atas permintaan pengguna; bukan backlog.

## Bukti pengujian dan cara ulang

Tes ulang pada pembaruan checklist ini: seluruh perintah berikut lolos. Dependensi QA berada di `.build/qa-runtime` (lihat [QA_REPORT.md](QA_REPORT.md)); folder tersebut tidak ikut Git.

```powershell
node tests/pdf-edit.test.cjs
node tests/pdf-edit-ui.test.cjs
node tests/converter-limits.test.cjs
node tests/qa-converter.cjs
node tests/export.test.cjs
node tests/save-location.test.cjs
node tests/idle.test.cjs
node tests/qa-runtime.cjs
node tests/qa-editor.cjs
python -m unittest discover -s tests -p test_*.py
```

Suite Python: 16 tes. Tes integrasi Office asli (`python tests/qa-office.py`) dan pemeriksaan PNG hasil PDF telah lolos pada sesi implementasi sebelumnya di hari yang sama; tidak diulang hanya untuk commit ini. `qa-editor` diperbarui agar mengenali pesan siap dalam UI Inggris yang sekarang digunakan.

**Batas verifikasi:** pengujian DOM simulasi bukan klik langsung di browser. Hasil PDF contoh telah diperiksa secara visual, tetapi UI browser, dialog simpan native, APK/EXE di perangkat nyata, dan semua kemungkinan dokumen belum mendapat QA lengkap.
