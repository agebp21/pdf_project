# Checklist fitur PDF Project

Diperbarui: 25 September 2026. Status berdasarkan kode dan bukti tes, bukan hanya keberadaan kartu menu.

**Arti centang:** fungsi yang disebut sudah lolos pengujian dalam lingkup di kolom bukti. Bukan jaminan semua dokumen, browser, atau perangkat sudah teruji. Katalog berisi 34 kartu: 18 tool converter, 3 halaman langsung (flipbook/notebook/demo), dan 13 fitur katalog belum dibuat.

## Sudah teruji

| Status | Fitur | Bukti dan cakupan |
|---|---|---|
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

## Sudah ada, belum boleh dianggap tuntas

| Fitur | Yang berjalan / bukti | Yang masih perlu diuji atau diperbaiki |
|---|---|---|
| Compress PDF | PDF hasil valid; jumlah halaman tetap. | Level memakai operasi simpan serupa; pengurangan ukuran tidak dijamin. |
| Image to PDF | Jalur berbagai format tersedia; smoke test UTIF pernah lolos. | Pengujian browser lengkap per format, terutama HEIC/TIFF. GIF/TIFF multipage memakai frame pertama. |
| PDF to JPG | Implementasi render halaman dan ZIP tersedia. | Tes end-to-end jalur converter dengan dokumen nyata; bukan hanya rendering PDF di flipbook. |
| PDF to Word | Mode "keep look": background tanpa teks + frame teks editabel per baris, satu section per halaman seukuran PDF. Mode flowing: heading, paragraf, tabel Word asli. Scan: gambar + OCR. `office-export.test.cjs` (library asli) + render LibreOffice fixture 2 halaman: tampilan cocok, teks sekali (tidak dobel). | Uji di MS Word asli dan dokumen desain berat; Type3/outline text tetap gambar; lebar font pengganti bisa beda. |
| PDF to Excel | Sheet Data (tabel Excel, kolom terpisah) di depan; angka ID/EN, Rp, %, negatif jadi angka asli; kode berawalan 0 / >15 digit tetap teks. Sheet gambar halaman kedua. | Akurasi tabel rumit, file besar, OCR nyata. "1.250" dibaca ribuan (format Indonesia). |
| PDF to PowerPoint | Ukuran slide mengikuti PDF; background tanpa teks + tiap baris jadi text box editabel; notes berisi teks/OCR. Dirender LibreOffice: cocok dengan PDF. | Uji di PowerPoint asli; gambar/vektor belum jadi objek terpisah. |
| PowerPoint to PDF | Backend LibreOffice tersedia, tes API dengan stub lolos. | Fixture PPT/PPTX nyata pada jalur terbaru belum diuji dalam sesi ini. |
| HTML to PDF | Ekstraksi teks tanpa batas 30.000 karakter sebelumnya. | Belum mempertahankan layout/CSS halaman web. |
| OCR ekstraksi | Tesseract Inggris/Indonesia dan filter kualitas tersedia. | Akurasi scan/poster, waktu proses, file besar. Bukan OCR PDF searchable. |
| Notebook PDF | Halaman dan fungsi ringkasan/chat ada, sebagian memakai Gemini. | QA menyeluruh, akurasi jawaban, koneksi API, penyimpanan kunci, serta kesiapan produksi. |
| Editor animasi (`animation.html`) | Ekstraksi native teks/gambar/grup; OCR lokal otomatis untuk halaman raster; area gambar/logo manual; elemen editable dan HTML ZIP offline. OCR PSJ halaman 5 teruji, 54 baris. | OCR Inggris/Indonesia/Melayu dan perbaikan background bersifat perkiraan. Pemisahan semua grafis secara otomatis belum tersedia. APK/EXE editor belum terhubung; browser/device QA belum lengkap. |
| Build APK / Windows EXE | Build dan unduhan paket berhasil pada sesi sebelumnya; isi aset diverifikasi. | Paket lama mendahului beberapa update terbaru; rebuild dan uji runtime perangkat diperlukan. APK signing debug; EXE belum ditandatangani dan memerlukan WebView2. |
| Offline HTML | Semua aset pembaca sudah dikemas lokal. | Buka paket melalui browser nyata tanpa jaringan belum diverifikasi langsung. |

## Belum dibuat

- [ ] Edit PDF umum (teks/gambar/shape).
- [ ] Sign PDF.
- [ ] Protect PDF.
- [ ] PDF/A.
- [ ] Repair PDF.
- [ ] Scan to PDF.
- [ ] OCR menjadi PDF searchable.
- [ ] Compare PDF.
- [ ] Redact permanen.
- [ ] PDF Forms.
- [ ] AI Summarizer sebagai tool terpisah.
- [ ] Translate PDF.
- [ ] Workflow (kartu tampil "Coming soon", tidak bisa diklik).
- [x] Akun/login, paket, pembayaran Midtrans Snap (+ simulasi lokal), kontrol akses mode hosting — `tests/test_accounts.py` (13 tes) + alur UI Chromium (daftar → pilih paket → bayar simulasi → plan aktif). Belum: reset password via email, verifikasi email, halaman admin, uji Midtrans sandbox dengan key asli.
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
