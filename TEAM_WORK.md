# Koordinasi tim AI

Gunakan file ini sebagai papan serah-terima. Semua agen membaca `AGENTS.md` dan `PROJECT_HANDOFF.md` sebelum bekerja. Pesan langsung antartim tetap diperlukan bila dua agen aktif bersamaan; file ini bukan mekanisme lock otomatis.

## Cara mengambil pekerjaan

1. Baca permintaan terbaru pengguna dan periksa perubahan lokal.
2. Pilih tugas yang jelas dan terbatas. Catat pemilik serta file yang akan diubah sebelum mulai.
3. Satu file hanya mempunyai satu penulis aktif. Khusus `index.html`, `converter.html`, dan `assets/animation.css`, koordinasikan karena dipakai lintas fitur.
4. Jika perlu menyentuh file milik agen lain, minta pengalihan kepemilikan melalui kanal koordinasi tim. Jangan menimpa diam-diam.
5. Jika memakai worktree/branch terpisah, catat lokasi, nama branch, dan commit untuk integrasi. Jangan membuat perubahan destruktif untuk memperoleh working tree bersih.
6. Selesai mengerjakan berarti hasil sudah diperiksa, keterbatasan ditulis, dan handoff diperbarui. Jangan menandai selesai hanya karena kode sudah ditulis.

## Papan tugas

QA 17 September 2026 selesai untuk pemeriksaan kode/paket; verifikasi UI perangkat masih terbuka. Codex menambah `tests/qa-runtime.cjs`, `qa-editor.cjs`, `qa-converter.cjs`, `qa-artifacts.py`, serta `QA_REPORT.md` dan memperbarui handoff. Build APK/Windows terbaru dan unduhan/asetnya lolos; tidak mengubah tampilan produk. PPT masih placeholder. Detail dan lokasi artefak ada dalam laporan. Belum commit/push.

Status: `tersedia`, `dikerjakan`, `perlu integrasi`, `selesai`, `terhambat`.

| ID | Tugas | Pemilik | File/branch | Status | Bukti atau langkah berikutnya |
|---|---|---|---|---|---|
| DOC-001 | Dokumentasi koordinasi dan handoff | Codex sesi awal | `AGENTS.md`, `PROJECT_HANDOFF.md`, `TEAM_WORK.md` | selesai | Dokumen dibuat berdasarkan kode dan diskusi; belum commit/push |

| EXP-001 | Simpan/buka proyek, ekspor HTML offline, dan build APK/EXE lokal | Codex | `flipbook.html`, `assets/flipbook*`, `assets/export*`, `server.py`, `native/`, `tests/`, dokumentasi | selesai | Round-trip/ZIP, 8 tes Python, Flutter analyze, build APK dan Windows release berhasil; runtime perangkat belum diuji |
| EXP-002 | Lokasi simpan ekspor kustom | Codex | `flipbook.html`, `assets/flipbook.js`, `assets/flipbook-export.js`, `tests/save-location.test.cjs`, dokumentasi | selesai | Dialog save-file pada gesture klik; fallback download; pengujian mock, bukan dialog browser |

## Format pesan untuk agen lain

```text
Tugas/ID:
Tujuan dan kriteria selesai:
Penanggung jawab:
File yang dimiliki:
Ketergantungan/kontrak antarmodul:
Perubahan yang selesai:
Pengujian dan hasil:
Keterbatasan/hal yang belum diuji:
Commit/branch/worktree (atau belum commit):
Status push:
Tindakan yang dibutuhkan dari penerima:
```

## Catatan serah-terima

### 2026-09-17 — QA menyeluruh sampai ekspor (berjalan)

- Instruksi pengguna: cek semua sampai ekspor final tanpa mengubah tampilan.
- Pemilik: Codex, pengujian di `tests/` dan `.build/qa/`; perbaikan hanya jika ada kegagalan terverifikasi.
- Browser CUA tidak tersedia (daftar kosong); Computer Use native pipe juga tidak tersedia setelah retry. Pengujian DOM dilakukan sebagai tes runtime Node dengan engine asli, bukan klaim QA visual browser.

### 2026-09-17 — Bukaan berdimensi bergaya template Heyzine

- Shared `layout.js`: konfigurasi gerakan dan density sampul/halaman untuk preview serta ekspor. `book-effects.css`: cahaya/bayangan punggung diadaptasi dari template repo sumber, tanpa mengubah vendor.
- Klik/drag/swipe engine aktif, durasi 950ms dan shadow 0,38; reduced motion tetap dihormati. Sampul tidak dibesarkan dan panel yang disembunyikan tetap tersembunyi.
- Paket HTML/native menyertakan CSS efek. Tes konfigurasi/density dan kelengkapan paket; belum QA visual/perangkat. Belum commit/push.

### 2026-09-17 — Sembunyikan kontrol tambahan preview

- `flipbook.html`: sembunyikan Putar animasi, Layar penuh, dan Demo infografis di bar bawah sesuai screenshot pengguna. Panah navigasi tetap tersedia.
- Elemen DOM dipertahankan agar handler JavaScript tidak rusak. Kontrol hasil ekspor tidak diubah.
- Pemeriksaan HTML yang disajikan dan diff; belum QA browser. Belum commit/push.

### 2026-09-17 — Ukuran sampul konsisten

- Permintaan pengguna: sampul sama ukuran dengan halaman isi, jangan diperbesar.
- `assets/export/layout.js`: indeks sampul/halaman terakhir tidak lagi mengubah mode satu/dua halaman atau tinggi compact; hanya ukuran area baca dan buku satu halaman yang menentukan.
- `showCover` tetap aktif. Shared layout mencakup preview dan semua ekspor baru. Tes kesamaan geometri sampul/isi/halaman terakhir ditambahkan ke suite ekspor; belum QA visual. Belum commit/push.

### 2026-09-17 — Hilangkan ruang vertikal panel preview

- Screenshot pengguna menunjukkan panel masih tinggi tetap sehingga buku landscape memiliki ruang besar atas/bawah.
- `assets/export/layout.js` mendapat opsi compact; `assets/flipbook.js` mengaktifkannya untuk preview. Tinggi mengikuti lebar dan rasio spread, berganti sesuai sampul/isi dan resize. Fullscreen memakai tinggi viewport.
- Tidak mengubah gambar PDF, isi halaman, atau paket native. Pengujian logika compact dan sintaks; belum verifikasi visual browser. Belum commit/push.

### 2026-09-17 — Area baca penuh untuk semua keluaran

- Preview dan template HTML bersama (termasuk APK/Windows) memakai seluruh area baca, rasio asli, layout responsif satu/dua halaman, dan sampul tunggal.
- `assets/export/layout.js` ikut dalam paket HTML dan aset native yang dibentuk server. Kontrol ekspor mengambang; fullscreen tersedia di browser yang mendukung.
- Tidak menghilangkan margin putih asli di PDF atau memotong isi untuk menyamakan rasio layar. Hasil ekspor lama perlu dibuat ulang.
- Kode native Android meminta immersive mode. Perubahan lokal belum commit/push; validasi sintaks, geometri, paket ekspor, Python, dan analisis Flutter dilakukan; belum QA visual perangkat.

### 2026-09-17 — Sembunyikan editor animasi sementara

- Permintaan pengguna: take out panel Tambahkan animasi yang ditunjukkan di screenshot.
- `flipbook.html`: panel disembunyikan termasuk pada layout mobile; penjelasan sidebar disesuaikan dan Simpan & ekspor menjadi langkah 02.
- Logika/elemen DOM dipertahankan agar pembukaan dan ekspor proyek lama tetap kompatibel. Tidak ada perubahan engine atau format proyek.
- Pemeriksaan: diff dan HTML yang disajikan localhost. Belum QA browser. Belum commit/push.

### 2026-09-16 — Codex sesi awal

- PDF Project sudah mendapat pembaca flipbook dengan engine dari repo pengguna, transfer hasil converter, serta demo animasi.
- Keputusan terbaru: tanpa batas 50 MB/100 halaman; buku dibuka dari sampul halaman pertama.
- Reader menerima animasi statistik per halaman; grafik/proses masih contoh demo.
- Perubahan fitur dan dokumentasi masih berada di working tree. Jangan menghapusnya karena belum commit.
- Pengujian terbatas pada sintaks, HTTP, parsing PDF, serta logika dengan mock; belum QA browser tuntas.
- Lihat `PROJECT_HANDOFF.md` untuk rincian, keterbatasan, dan kandidat langkah selanjutnya.

### 2026-09-16 — EXP-001 / ekspor offline dan aplikasi native

- Frontend: tombol simpan/buka proyek `.flipbook`, ekspor HTML ZIP, serta build APK/EXE dengan status dan link hasil/log. Snapshot mencakup judul, halaman, rasio, dan overlay statistik.
- Pembaca offline di `assets/export/` dipakai pada HTML, Android, dan Windows; semua aset lokal, dibuka dari sampul.
- Server lama `http.server` diganti `server.py` pada localhost port 8080. Server bind loopback, memeriksa Host/Origin/token, membatasi static serving pada halaman aplikasi/aset, dan menserialkan build.
- `server.py` tidak mengeksekusi script dari ZIP kiriman; HTML/JS native selalu dibuat ulang dari template lokal dan metadata tervalidasi.
- Flutter tersedia di `C:\src\flutter`, Android SDK di `C:\android\sdk`, Visual Studio 2026 tersedia. Junction direktori plugin menangani kebutuhan symlink lokal tanpa mengubah Developer Mode global.
- Build APK berhasil. Build Windows awal gagal pada coroutine lama plugin, lalu berhasil setelah define kompatibilitas MSVC diterapkan di CMake proyek. Vendor tidak diubah.
- Pemeriksaan: `node tests/export.test.cjs`, 8 tes Python, `flutter analyze`, sintaks JS/Python, build kedua target, isi aset/animasi dalam hasil build. Belum menjalankan hasil pada perangkat nyata atau QA UI browser.
- APK memakai signing debug untuk pengujian. Windows memerlukan WebView2 dan seluruh folder ZIP, EXE belum ditandatangani. Hasil/log tersimpan lokal di `.build/` dan tidak masuk Git.
- Semua perubahan masih belum commit/push. Jangan hapus kerja lokal dari sesi sebelumnya.

### 2026-09-16 — EXP-002 / lokasi simpan kustom

- Proyek, HTML, APK, dan Windows ZIP dapat disimpan dengan nama/folder pilihan melalui dialog browser yang mendukung File System Access API.
- APK/Windows ditulis sebagai stream setelah pemilihan lokasi; build internal tetap di `.build/`.
- Browser tanpa API memakai download biasa. Cancel menghentikan penyimpanan tanpa download otomatis; kegagalan tulis ditampilkan kepada pengguna.
- Tes baru mencakup handle tujuan, nama, cancel, kegagalan tulis, streaming, serta fallback. Belum pengujian dialog native browser. Belum commit/push.

### 17 September 2026 — navigasi tengah dan Home

Navigasi preview dipusatkan, tombol Home kembali langsung ke sampul. Home juga disertakan pada template ekspor HTML/APK/Windows; paket native lama harus dibuild ulang untuk mendapat perubahan. Tombol dinonaktifkan di sampul, saat membuka PDF, dan selama pembalikan halaman. Tes engine asli/editor untuk Home dan ekspor HTML lolos; tampilan browser belum diperiksa langsung. File: flipbook.html, assets/flipbook.css/js, assets/export/index.html dan viewer.js, serta tes QA. Belum commit/push.

### 17 September 2026 — backlog perbandingan iLovePDF

- Permintaan pengguna: masukkan analisis perbandingan + roadmap ke .md.
- `PROJECT_HANDOFF.md`: tambah seksi Perbandingan vs iLovePDF & usulan roadmap (keunggulan saat ini + backlog A/B/C/D + quick-win).
- Koreksi jujur: Workflow Builder belum ada — kartu di `index.html` hanya link ke `converter.html?tool=merge-pdf`. Flipbook/animasi/notebook ada tapi perlu QA lanjutan; panel animasi masih hidden.
- Belum commit/push. Belum ada perubahan kode produk.

### 17 September 2026 — redesign UI cream GenZ

- Pemilik: sesi ini. File: `index.html`, `converter.html`, `notebook.html`, `flipbook.html`, `animation.html`, baru `assets/theme-cream.css`.
- Hasil: tema krem elegan (Fraunces + Jakarta Sans, pine/tang, kartu chunky, marquee) agar beda dari iLovePDF. Fungsionalitas dipertahankan; layout flipbook engine tidak diubah.
- Uji: diff-check, node --check flipbook/viewer, HTTP 200 semua halaman + css baru. Belum QA visual browser. Belum commit/push.

### 17 September 2026 — business direction + interiors pass

- User confirmed paid direction (deferred): user DB + login later, polish interiors now. No auth code written; `server.py` still local-build-token only.
- Interiors quick pass: English shells for flipbook/notebook/animation + reader JS strings (`flipbook.js`, `viewer.js`). Export internals + converter option strings deferred.
- Tests: export suite PASS, 8 Python tests OK, node --check OK, HTTP 200 all pages. No visual browser QA. Not committed/pushed.

### 17 September 2026 — pdf-to-excel fix

- Cause: one-cell-per-page text dump, no line structure, no scan guard. Fixed with Y-grouped lines, single-char rejoin, Page/Line/Text rows, empty-text error, thin-text README sheet.
- File: `converter.html` (`pdfToExcel` only). Checks: inline syntax OK, heuristic mock OK, HTTP 200. No real-file E2E. Not committed/pushed.

### 17 September 2026 — OCR (Tesseract.js v5.1.1)

- Lazy-load CDN only for text-less pages; `eng+ind`; Source column Text/OCR; README counts. Dep: Apache-2.0, naptha/tesseract.js, jsDelivr pinned.
- Checks: syntax OK, CDN 200, HTTP 200. No browser E2E (needs real file + time). pdfToWord still old path. Not committed/pushed.

### 17 September 2026 — OCR quality gate

- Problem: garbage OCR rows on full-artwork pages. Fix: line filter (<3 letters or <40% alnum dropped) + page gate (conf ≥50, ≥40% word-like) else honest empty.
- Checks: gate mock OK (0 vs 3 rows), syntax OK, HTTP 200. User to reconvert real file. Not committed/pushed.

### 17 September 2026 — OCR gate v2 (poster, pushed)

- Real page = full-artwork poster, no table. Line filter now counts digits (keeps `2021`); page gate unchanged. Mock v2 OK (4/0/2), syntax OK, HTTP 200. Committed + pushed.

### 17 September 2026 — pages-as-images Excel (pushed)

- User wants pages kept as images in Excel. ExcelJS 4.4.0 (MIT, jsDelivr, lazy-load) builds workbook: `Pages (Images)` JPEGs + `PDF Extract` + conditional `README`. Fixed Text/OCR mislabel.
- Checks: ExcelJS Node smoke OK (valid xlsx), syntax OK, HTTP 200. No real-file browser run. Committed + pushed.

### 17 September 2026 — editable text cells (pushed)

- Image text isn't editable (pixels). Added merged wrapped editable cells under each page image with that page's lines; placeholder row for artwork pages. Smoke + syntax + HTTP OK. No browser E2E. Committed + pushed.

### 17 September 2026 — side-by-side layout (pushed)

- Users clicked picture text trying to edit (editable cells were below, hidden). Now A–H picture + J–M editable text same rows; overflow full-width below. Smoke + syntax + HTTP OK. No browser E2E. Committed + pushed.

### 17 September 2026 — seamless marquee

- Problem: running text jumped (single copy animated to -50%). Fix: duplicated track content (2nd copy aria-hidden), track animates 0 → -50% for a seamless loop.
- Checks: diff-check + HTTP 200 only. No visual browser QA. Not committed/pushed.

### 17 September 2026 — push d7ca27d (auto-push rule ON)

- User rule: every OK update pushes straight away. Pushed commit `d7ca27d` to `origin/main` (85 files: redesign, English UI, excel+OCR, marquee, docs). Tree clean after push.
