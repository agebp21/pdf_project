# Pemeriksaan ekspor — 17 September 2026

Hasil: pipeline flipbook dan kedua build native lolos pemeriksaan kode/paket di bawah. Tampilan produk, HTML, CSS, dan engine tidak diubah dalam pekerjaan QA ini. Ini belum merupakan persetujuan rilis produk: UI browser dan aplikasi pada perangkat belum diuji langsung karena koneksi alat browser/desktop tidak tersedia.

## Lolos

- Suite ekspor: round-trip `.flipbook`, validasi metadata, escaping data script, kelengkapan aset offline.
- Suite lokasi simpan: tujuan/nama, pembatalan, kegagalan tulis, streaming unduhan, dan fallback download (API dialog disimulasikan).
- Delapan tes Python untuk layanan build, validasi paket, dan pembatasan akses.
- PageFlip asli dalam DOM simulasi: 1, 2, 3, 4, 5, dan 8 halaman; portrait, landscape, persegi, rasio ekstrem, viewport 390/1200 px; maju/mundur sampai akhir; sampul tetap seukuran satu halaman.
- PDF.js asli merender PDF uji 8 halaman menjadi JPEG. Editor memuat PDF, menyimpan/membuka proyek, menghasilkan HTML, mempertahankan buku sebelumnya ketika input tidak valid, dan meneruskan Blob melalui IndexedDB simulasi. Kontrol yang diminta tersembunyi tetap tersembunyi.
- Converter dengan pdf-lib asli: merge, extract range, split ZIP, compress, rotate, organize; tombol flipbook hanya tersedia untuk hasil PDF. File hasil dibaca kembali dan jumlah halaman/rotasi diperiksa.
- Build APK dan Windows release berhasil dari HTML uji terbaru. Unduhan HTTP identik dengan artefak di disk. Semua delapan JPEG, metadata, engine, viewer, layout, dan efek buku dalam paket native cocok dengan sumber HTML.
- `git diff --check` lolos (hanya peringatan normalisasi LF/CRLF).

## Hasil uji lokal

Semua menggunakan dokumen sintetis, bukan dokumen pengguna:

- HTML: `.build/qa/qa-from-editor-HTML.zip`
- Proyek: `.build/qa/qa-final.flipbook`
- PDF sumber: `.build/qa/qa-landscape.pdf`
- APK: `.build/74d9c431bd9848f091e2ae9331107bbb/flipbook.apk`
- Windows: `.build/e0d12fc95cb94df8aab1a66324142437/flipbook-windows.zip`
- Log build ada di masing-masing folder hasil.

APK masih menggunakan signing debug. Windows ZIP harus diekstrak lengkap dan memerlukan WebView2. Build berhasil tidak membuktikan aplikasi sudah berjalan pada perangkat.

## Belum terverifikasi / keterbatasan yang ditemukan

- Klik/swipe, penampilan 3D, dialog folder asli, fullscreen, dan menjalankan HTML/APK/EXE secara offline pada browser/perangkat nyata belum diuji.
- PPT → PDF dan PDF → PPT masih placeholder, bukan konversi dokumen asli.
- Word → PDF saat ini mengekstrak teks (maksimal 50.000 karakter), tidak mempertahankan layout/gambar. PDF → Word menghasilkan dokumen HTML `.doc` berbasis ekstraksi teks; PDF scan memerlukan OCR yang belum tersedia.
- Opsi level kompresi memakai operasi penyimpanan pdf-lib yang sama; pengurangan ukuran tidak dijamin.
- JPG, Word, Excel, dan HTML conversion belum mendapat pengujian end-to-end lengkap pada sesi ini; katalog belum boleh dianggap seluruhnya siap jual. Dependensi converter masih dari CDN.
- Kinerja dokumen besar, PDF campuran ukuran halaman, OCR, dan distribusi/signing produksi perlu pengujian terpisah.

## Menjalankan ulang

Server localhost harus berjalan untuk tes editor dan artefak. Dependensi hanya dipasang di `.build/`, tidak menambah build system frontend:

```powershell
npm install --prefix .build/qa-runtime jsdom @napi-rs/canvas fake-indexeddb pdf-lib@1.17.1 --no-audit --no-fund
node tests/export.test.cjs
node tests/save-location.test.cjs
python -m unittest discover -s tests -p test_*.py
node tests/qa-runtime.cjs
node tests/qa-editor.cjs
node tests/qa-converter.cjs
python tests/qa-artifacts.py
```

Tes artefak membutuhkan job berhasil pada server yang masih berjalan serta `.build/qa/apk-job.json` dan `exe-job.json`. Job tidak dipersistenkan lintas restart server; setelah restart perlu build baru dan memperbarui kedua file ID tersebut.
