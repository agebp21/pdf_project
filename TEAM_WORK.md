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

### 17 September 2026 — Word + PPT borongan (pushed)

- Shared pdfContentPages core; Word via docx 9.7.1 (MIT); PPT via PptxGenJS 4.0.1 (MIT); both lazy CDN. Placeholders gone. Node smoke OK both, syntax + HTTP + 13 Python OK. No browser E2E. Committed + pushed.

### 17 September 2026 — Unlock card removed (pushed)

- User: take out Unlock PDF (no password-cracking tool). Removed the catalog card from index.html; converter never had it. HTTP 200. Committed + pushed.

### 17 September 2026 — paket kilat: tabrakan terus koordinasi (diverifikasi, pushed)

- Sesi ini mulai bangun Watermark/Page numbers/Crop bareng user, tapi agen liyo (Codex) ternyata wes nggarap paket sing podo + push disek (1728020: `assets/pdf-edit.js`, hooks converter, `tests/pdf-edit.test.cjs`, FEATURE_CHECKLIST.md).
- Sesi iki: batal bangun ganda, revert 3 entri TOOLS duplikat (duplicates → 0, dadi 17 tools), verifikasi karyane: pdf-edit PASS, export PASS, converter-limits PASS, 16 Python OK. Struktur sesi iki (coming-soon guard, pdfContentPages, OCR, multicol) utuh; caps 300/2000/6 kolom wes dicabut Codex + ono tes-e; guard-ku ditingkatne (charAt).
- File `converter.html` + `server.py` + `index.html` saiki multi-penulis antar sesi — saben sesi wajib cek `git log`/diff + FEATURE_CHECKLIST.md sadurunge nyentuh. `assets/animation-editor.css` kagungane sesi liyo (kebawa commit 10d647e karena `add -A`; isine ora diowahi) — sing neruske monggo.

### 17 September 2026 — dedupe repeats (pushed)

- Decorative display type drawn 3x → notes showed triplicates. dedupeLine in shared core fixes Word/Excel/PPT at once. 7-case mock OK, syntax + HTTP OK. User to reconvert. Committed + pushed.

### 17 September 2026 — borongan guard + multicol (pushed)

- Dead-card guard banner (no more silent wrong tool); multi-col split in core + dynamic Col 1..N in Excel. Splitter mock OK (2/1/PORTFOLIO), syntax + HTTP OK. No real-table E2E. Committed + pushed.

### 17 September 2026 — PDF to Markdown (pushed)

- Core +size/bold (additive; teammate no-truncation kept, limits suite passes). Pure pagesToMarkdown (headings/lists/tables), pdfToMd tool + dispatch + TOOLS entry. Builder mock 9/9, syntax + HTTP + limits/pdf-edit/16-Python OK. FEATURE_CHECKLIST.md touched minimally (counts + row). No browser E2E. Committed + pushed.

### 17 September 2026 — catalog audit (pushed, no code)

- 35 cards vs 14 tools: 18 cards silently fall back to JPG-to-PDF (incl. all 4 security cards). 14 real ones graded strong/half/weak in handoff. Next: coming-soon guard, then build per shelf. Committed + pushed.

### 17 September 2026 — Image to PDF all types (pushed)

- Renamed (id kept for links). Native: JPG/PNG/WebP/GIF/BMP/SVG/AVIF/ICO; TIFF via UTIF 3.1.0 (MIT), HEIC via heic2any 0.0.4 (MIT), both lazy. First-frame rule, white flatten, sizeless-SVG error. UTIF smoke OK, syntax + HTTP OK. No real HEIC/TIFF browser test. Committed + pushed.

### 17 September 2026 — formal Excel Table (pushed)

- PDF Extract is now a real Table (PdfExtract, Medium9, filters). Verified table1.xml in output zip. Smoke + syntax + HTTP OK. Multi-column reconstruction still future. Committed + pushed.

### 17 September 2026 — PPTX→PDF backend (pushed)

- Audited Word (half) + PPT (placeholder). New server endpoint via local LibreOffice; frontend uploads, no more fake PDFs. 13 Python tests OK, syntax + HTTP OK. No real soffice here — user needs LibreOffice installed. Committed + pushed.

### 17 September 2026 — soffice fallback (pushed)

- Installer doesn't add PATH on Windows; server now checks Program Files locations too. Tests patch find_soffice. 13 OK. User must restart server.py. Committed + pushed.

### 17 September 2026 — wrong-tool + leftover Indonesian strings (pushed)

- User ran PDF-to-PowerPoint (still placeholder) instead of PowerPoint-to-PDF. Pointed to the right tool.
- Screenshot exposed leftover Indonesian dynamic strings (button reset, progress, flipbook button, split/organize panels, error throws). All translated to English; TOOLS descs/hints + debug logs stay deferred. Syntax + HTTP OK. No browser E2E. Committed + pushed.

### 17 September 2026 — download keep-alive fix (pushed)

- User's blob downloads failed mid-flight. Root cause candidate: object URL revoked 60s after render. Now the previous URL is revoked only when replaced or on pagehide; 150MB+ files get an honest warning. Syntax + HTTP OK. Real cause unconfirmed — asked user for file size, app error, disk space, dummy-test result. Committed + pushed.

### 17 September 2026 — seamless marquee

- Problem: running text jumped (single copy animated to -50%). Fix: duplicated track content (2nd copy aria-hidden), track animates 0 → -50% for a seamless loop.
- Checks: diff-check + HTTP 200 only. No visual browser QA. Not committed/pushed.

### 17 September 2026 — push d7ca27d (auto-push rule ON)

- User rule: every OK update pushes straight away. Pushed commit `d7ca27d` to `origin/main` (85 files: redesign, English UI, excel+OCR, marquee, docs). Tree clean after push.

### 17 September 2026 ? idle reminder and automatic Home

- Added shared FlipbookIdle in assets/export/layout.js and scoped overlay CSS in book-effects.css; wired preview flipbook.js and exported viewer.js. Existing layout stays unchanged while active.
- After 170 seconds without pointer/keyboard/wheel activity: 10-second warning. At 180 seconds: return to cover. Activity or Continue reading resets timer. Cover, loading/exporting (preview), and page-turn transitions suppress/reset timer. Visibility changes check elapsed wall time.
- Existing export packaging already includes layout.js and book-effects.css, so new HTML/APK/Windows exports inherit the feature. Existing native artifacts were not rebuilt.
- Passed tests/idle.test.cjs (simulated clock/DOM), actual engine runtime suite (single/last page, portrait/landscape), export suite, 13 Python tests, JS syntax, diff check, HTTP 200. No direct visual browser/device verification. No commit/push in this task.

### 17 September 2026 ? converter startup bug and content truncation removed

- Fixed unknown-tool initialization calling log before its const declaration; malformed hyphenated tool ids also no longer crash. Coming-soon notice remains; missing tools are not implemented by this change.
- Removed converter content caps: DOCX 50k chars, HTML 30k chars, Excel 60 rows/150 chars, shared extraction 300 lines/2k chars/500-char cells, OCR line count, Word paragraphs, PPT notes, Excel editable overflow, and six-column detection. Long Excel rows wrap across PDF pages.
- Preserved OCR quality checks, render-resolution settings, and layout sizing. File-size warnings are informational, not upload limits. Word preview remains a short excerpt, safely inserted with textContent; exported text is complete. Hardware and output-format constraints still apply; this does not promise infinite capacity or layout fidelity.
- Passed converter-limits.test.cjs with simulated dependencies (unknown tool, malformed slug, >50k text, >60 rows, long rows, nine columns, 350 lines and >2k text), existing real pdf-lib converter tests, inline JS syntax, diff check, HTTP 200. qa-converter harness updated for existing revokeObjectURL behavior. No direct browser visual test or giant-file stress test. No commit/push for this change yet.

### 17 September 2026 ? Word/Excel to PDF via LibreOffice

- User chose preserving original Word/Excel layout. converter.html now shares convertOfficeToPdf for DOCX/DOC, XLSX/XLS/CSV, PPTX/PPT. No plain-text fallback; clear missing-server/LibreOffice errors. Existing UI design unchanged. Original upload sent intact, PDF signature checked, download and flipbook handoff retained.
- server.py adds word-to-pdf and excel-to-pdf routes with MIME/extension validation, retains token/loopback controls and streaming uploads. Each conversion has an isolated LibreOffice profile; no fixed file/page/row cap added. CSV delimiter sniffing/UTF-8 options follow official LibreOffice CSV filter docs. Excel honors source print area/page settings. Font availability and Office compatibility can still affect fidelity; existing process timeout remains.
- Passed 16 Python tests, updated converter-limits frontend tests, real pdf-lib converter suite, export suite, inline syntax/py_compile and diff check. Real HTTP LibreOffice tests: DOCX two pages (table/image/header/page break), XLSX four pages (75 rows, two sheets, formula 2850, landscape), CSV one page. All seven rendered PDF pages visually inspected via PyMuPDF PNG; no clipping found in those fixtures. These are document-render checks, not interactive browser QA.
- Updated localhost:8080 server and verified real Word POST through it. Refresh open browser pages to use its new session token. Outputs/fixtures .build/qa-office; new test tests/qa-office.py. README updated; no commit/push yet.

### 17 September 2026 ? Watermark, Page Numbers, Crop

- Prior Word/Excel work committed and pushed as 2b350f8 at user's request before starting these features.
- Added assets/pdf-edit.js (uses existing pdf-lib) and wired three catalog tools to converter.html without changing the established theme. Watermark: text or PNG/JPEG, size, position, color, opacity, margins, page range. Page numbers: starting number, font/color/position/margin, consecutive selected pages. Crop: four margins in mm for all/selected pages, respecting displayed rotation and existing CropBox offsets.
- Crop sets CropBox, not permanent redaction; UI explains this. Text uses Helvetica; unsupported scripts get an actionable image-watermark message. No arbitrary page/file quota. Oversized overlays, invalid ranges, and crop removing a whole page are rejected before download.
- Preserved PDF download and Turn into Flipbook flow. Fixed conversion errors being hidden by final UI refresh and cleared stale coming-soon notices when switching tools.
- Passed tests/pdf-edit.test.cjs (real pdf-lib/PDF.js, 4 page rotations, text/image watermark, numbering, crop offsets/ranges, invalid input); tests/pdf-edit-ui.test.cjs (simulated DOM button flow/output/handoff/error visibility); converter-limits, qa-converter, export suite, JS syntax, diff-check, HTTP 200. Rendered 16 fixture output pages using PyMuPDF and inspected the overview for correct placement/cropping. No interactive browser visual QA. Fixture PDFs under .build/qa-edit; not user files.
- New PDF editing feature changes are local, not committed/pushed yet. Catalog converter tool count is now 17 (previously 14).

### 17 September 2026 ? checklist status and publication

- User requested commit/push of Watermark, Page Numbers, Crop and a checklist of what works. Added FEATURE_CHECKLIST.md with tested scope, partial features, unbuilt backlog, evidence, and runtime limitations; linked README and marked early QA_REPORT as historical. Corrected stale PPT-placeholder guidance in AGENTS.md.
- Reran PDF edit core/UI suites, converter limits, real converter transformations, export/save-location/idle, actual engine runtime, editor integration, and 16 Python tests: all passed. Updated qa-editor's ready-message check for the existing English UI; no product changes in this verification pass.
- This publication includes the new PDF tools and their tests from the previous task. Commit/push to origin/main is authorized in this task; use Git history for the resulting hash. Earlier notes saying those changes were uncommitted describe their original handoff time.

### 17 September 2026 — Editor animasi & interaktif gaya Canva (pushed 3a99db7)

- Pemilik: sesi ini. File baru: `assets/editor.css`, `assets/editor.js`. File dimodifikasi: `flipbook.html`, `assets/flipbook.js`, `assets/flipbook-export.js`, `assets/export/viewer.js`, `tests/export.test.cjs`, `tests/qa-editor.cjs`, `tests/qa-runtime.cjs`.
- Format project.json diperluas ke v2: `pages[index].elements[]` per halaman, backward compat v1 (stat overlays tetap berjalan).
- Editor: panel "Tambahkan animasi" (step 02) diganti editor Canva-like. Toggle Edit/Read mode di preview bar. Elemen teks + hotspot (link button) bisa di-drag, resize, rotate. Double-click teks untuk edit inline.
- Inspector sidebar: font size, warna, background, opacity, bold/italic, align, animasi (fadeIn/slideUp/slideDown/slideLeft/slideRight/zoomIn/bounce/pulse + delay + durasi), link (URL eksternal atau goto halaman).
- Ekstraksi teks PDF otomatis via PDF.js `getTextContent()` per halaman atau semua halaman.
- Read mode: elemen dirender sebagai overlay CSS di atas gambar halaman, animasi trigger saat halaman dibuka, link klik berfungsi.
- Ekspor HTML/APK/Windows: `editor.css` ikut dikemas; viewer.js merender elemen + animasi + link di semua output.
- Tes: export.test.cjs PASS (v2 round-trip, validasi overlay), qa-runtime.cjs PASS (7 viewport combo + real PDF), qa-editor.cjs PASS (load PDF, edit mode, project save/restore, HTML export, invalid file recovery), 16 Python tests OK. HTTP 200 flipbook.html, editor.js, editor.css. `node --check` semua file OK.
- Belum diuji: QA visual browser/device (drag, resize, animasi nyata), ekstraksi teks dari PDF asli kompleks, pengujian di APK/Windows build lama.

### 18 September 2026 — Flipbook Animation Editor: halaman tersendiri (pushed 01a4c5d)

- Pemilik: sesi ini. File baru: `assets/animation-editor.js`, `assets/animation-editor.css`. File dimodifikasi: `animation.html`.
- `animation.html` diganti total dari demo statis 4 halaman jadi editor Canva-like sungguhan.
- Kartu "Flipbook Animation" di `index.html` sudah mengarah ke `animation.html` — tidak perlu diubah.
- Fitur: upload PDF → render per halaman → ekstrak teks otomatis (PDF.js) → drag/resize/rotate elemen → inspector (font, warna, bg, opacity, bold, italic, align) → animasi CSS (fadeIn/slideUp/slideDown/slideLeft/slideRight/zoomIn/bounce/pulse + delay + durasi) → link (URL / goto halaman) → Preview mode (animasi diputar) → Export HTML ZIP (PageFlip standalone flipbook).
- `flipbook.html` tidak disentuh sama sekali.
- Tes: node --check OK, HTTP 200 animation.html + animation-editor.js + animation-editor.css, export.test.cjs PASS, qa-editor.cjs PASS, qa-runtime.cjs PASS, 16 Python tests OK.
- Belum diuji: QA visual browser (drag, animasi, link klik, export buka di browser).



### 18 September 2026 - takeover animation continuation (Codex)

User requested continuation of Antigravity animation work. Preserve existing uncommitted animation.html, animation-editor.css/js changes. Scope: repair multi-format import, preview/links, zone placement, export runtime and save handling; add regression tests. Own these files and new animation playback assets for this task. No parallel agent work.

### 18 September 2026 - Animation continuation completed locally (Codex)

- Files: animation.html; assets/animation-editor.js/css; new assets/animation-playback.js/css; assets/export/viewer.js; local pdf-lib and vendor source/license; two animation tests; AGENTS.md, README.md, FEATURE_CHECKLIST.md, PROJECT_HANDOFF.md, TEAM_WORK.md.
- Preserved Antigravity changes and repaired screenshot-related CSS conflicts, import PDF/Office/images, preview/link playback, PDF zone positioning, and v2 HTML export/save cancellation.
- Validation: both animation suites, export/save-location, engine/runtime and existing editor suites passed; 16 Python tests passed; JS syntax/diff clean, related HTTP assets 200. Tests exercise actual PDF.js/pdf-lib/PageFlip inside simulated DOM.
- Limits: no direct browser/device visual check (CUA surfaces unavailable); PDF zones are highlights; animation editor project save/load and APK/EXE export are not wired. Normal reader remains compatible. No commit/push in this task.

### 18 September 2026 - Follow-up: controls reported nonfunctional

User reports editor controls still do not work. Exact browser failure is not yet reproduced; CUA still exposes no browsers. Added persistent canvas action/error feedback so scrolled sidebar cannot hide extraction/export errors, visible PDF zone outlines and explicit scan/image limitation. Fixed stale inspector selection after replacing document, clear-zones from Preview, and clicking Preview again to replay. Files: animation.html, assets/animation-editor.js/css, tests/animation-editor.test.cjs. Extended real-PDF/simulated-DOM regression passed including image zero-text feedback, custom text selection, replay and clear preservation; JS syntax and diff check passed. User clarification requested on Add Text behavior; do not treat the user's full reported issue as resolved. Not committed/pushed.

### 18 September 2026 - Preview effect visibility

Screenshot confirmed PDF zones in Preview but their default 600ms fade on faint rectangles was barely observable; original PDF pixels never moved. New PDF zones default to 1400ms looping pulse. Shared playback adds a strong animated amber emphasis for PDF zones (two passes for entrance effects, looping for pulse), cancels both handles on replay/destroy, and retains reduced-motion behavior. Preview reports current page/active effects/empty or reduced-motion state; load-all summary no longer leaves the last page extraction message over the current page. This is animated highlighting, not extraction/animation of original PDF objects. Tests: animation-editor, animation-playback (new emphasis/cancellation assertions), export suite, syntax and diff checks passed. No actual browser visual verification. Files: animation-editor.js, animation-playback.js, playback test, handoff/team notes. Local only, no commit/push.

### 18 September 2026 - Actual editable text extraction replaces highlights

User clarified that PDF text must be extracted, not highlighted. Load content now rerenders page graphics through a scoped canvas context proxy, suppressing only fillText/strokeText calls matching horizontal PDF text items. Those items become editable draggable text elements with captured color, approximate size/family and normal animations; updated backgrounds and text elements are exported together. Unmatched raster/outline/rotated text remains in the original page. Restore resets background and removes extracted elements; re-extraction retains edits/animations via source coordinates. No vendor edits. Exact embedded font/layout fidelity is not guaranteed; browser/device visual QA and the user's 88-page file remain unverified.

Touched animation-editor.js/css, animation-playback.js/css, animation.html, animation-editor.test.cjs, README/checklist and handoff/team notes. Passed real PDF.js render/extraction test with browser-like disableFontFace:false, editable inspector/content, replacement background URL, exported text and restoration; playback/export/runtime suites passed. Earlier highlight-only notes are superseded for newly extracted text. Local changes, no commit/push.

### 18 September 2026 - Duplicate layered text follow-up

User screenshot still shows double text. Reproduced one cause with a real PDF drawing identical text twice with shadow offset. Extraction now matches nearest baseline, prefers fill paint over stroke, and consolidates overlapping identical text runs (shadow/faux bold) into one foreground editable element after suppressing both original paints. Regression checks exactly one extracted element and every background pixel is white in the synthetic two-layer PDF. Animation editor/playback/export suites and syntax/diff checks pass. The user's 88-page PDF has not been supplied; requested its local path. Do not claim the screenshot-specific issue fully resolved: arbitrary vector outlines/raster duplicates remain outside canvas text suppression. Files: animation-editor.js, animation-editor.test.cjs, handoff/team notes. Local only, no commit/push.

### 18 September 2026 - Verified duplicate-text fix against user's Downloads PDF

Located Downloads/PSJ 2026-2030.pdf (88 pages), matching the screenshot. Cover has repeated normal text plus per-glyph Type3 outlines. Type3 font ascent/descent contains non-finite values; now use finite fallback metrics. Added render-task-scoped adapter for pinned PDF.js 3.11.174: match Type3 glyphs to a co-located normal text run, suppress their painting while retaining glyph advancement/clipping/state, restore temporary glyph operator lists in finally. No vendor source modified. This adapter accesses _intentStates/render-task graphics and must be revalidated before upgrading PDF.js. Standalone Type3 text without a matching normal-text run is preserved.

Tested first two pages of the actual file via PDF.js/editor/export runtime. Generated background confirms cover title/subtitle/date text removed and original logo/building artwork preserved; lower building region retains 40,688 bright pixels vs 41,109 before JPEG rerender, subtitle residual gray text pixels are zero. Full 88-page extraction and interactive browser visual QA not performed. Private input and generated evidence stay outside Git (.build/qa-animation). Added synthetic Type3 path glyph duplicate to animation-editor regression; asserts exactly one editable element per text and pixel-white background after both paint paths removed. Animation editor/playback/export suites and JS syntax pass. Files: animation-editor.js, animation-editor.test.cjs, handoff/team notes. No commit/push.

### 18 September 2026 - PDF image/group extraction and link buttons

User confirmed graphics should be separated from PDF, not uploaded independently. Added extraction of axis-aligned raster image paints and top-level composited transparency groups into PNG-backed editable image elements. Full-page images (>=80% area), rotated/group-internal paints and active soft-mask paints remain in the background; this is an extraction heuristic, not an upload quota. Extracted PNGs retain alpha, can be moved/resized/rotated/animated/linked, and embed into HTML offline export. Restore content returns originals. Ungrouped vectors and graphics baked into page-wide images are not independently extracted. Complex clipping/stack order requires more QA.

Tested the user's PSJ cover directly: one building illustration group extracted and its PNG visually inspected. Top logo belongs to the full-page background raster, so it remains inseparable by this method. No automatic segmentation/inpainting implemented. First-two-page editor/export test passed, not all 88 pages.

Links: new hotspot opens URL settings, invalid/empty destination reports feedback in Preview, bare hostnames normalize to HTTPS, external targets use native anchors with noopener/noreferrer, pointer/mouse/touch propagation prevents page-flip interference. Edit selects; Preview follows links. Page links retained. Tests assert extracted image in actual Office-PDF fixture and offline reader, self-contained PNG export, URL anchor/normalization and existing playback; engine/export/editor suites, JS syntax/diff checks pass. No live browser navigation QA. Files: animation.html, editor/playback JS/CSS, two tests, docs. Local only; no commit/push.

### 18 September 2026 - Image-only infographics extraction feedback

User screenshot matches PSJ page 5. Read-only PDF inspection confirms pages 4 and 5 each contain one raster image and zero PDF text objects. This is not a stalled text extraction; OCR/segmentation is not implemented. Added per-page extraction outcomes, removed repeated load hint after a completed empty extraction, restored correct page status on navigation, and summarized empty/failed pages after load-all. Clear/import reset outcomes. Manual elements remain available. Do not claim raster text/logo extraction works.

Actual PSJ page 5 -> cover extraction -> page 5 navigation passed in PDF.js/JSDOM; image-only status explains OCR requirement, next-page extraction works, no stuck controls or runtime errors. Added regression assertions to animation-editor test; suite, JS syntax/diff checks pass. Read-only render of pages 4/5 confirms screenshot. No interactive browser QA. Files: animation-editor.js, animation-editor.test.cjs, handoff/team notes. Local changes, no commit/push.

### 18 September 2026 - OCR fallback for every readable document/page, manual graphics regions

User wants an extraction path even for image-only documents. Added assets/animation-ocr.js with local Tesseract.js/core 5.1.1 and tessdata_fast 4.1.0 eng/ind/msa (licenses/sources included, ~21MB). Native extraction falls back to OCR when no native text is captured; explicit OCR button handles mixed pages. Two passes (original + dark-letter contrast) merge overlapping results, confidence-filter words, and turn recognized lines into editable animatable text. Original preserved; background approximated from unioned word masks with border interpolation. Matching OCR edits survive reload. OCR worker released after batch. No server/dependency changes required at runtime, no document uploads/CDN.

Added manual drag-rectangle extraction for arbitrary graphics/logo areas, producing PNG overlay plus approximate background repair. This provides a route for flattened graphics but is NOT automatic semantic segmentation and does not reconstruct obscured artwork perfectly. Low-confidence/decorative text may remain unrecognized. Languages currently English/Indonesian/Malay. All supported input documents can be processed, not a guarantee every pixel/text/font is recovered.

Validation: actual PSJ page 5 -> real OCR -> 54 editable lines -> HTML ZIP passed in PDF.js/JSDOM; real OCR module test (54 lines/123 word boxes), synthetic raster OCR and pixel-removal test, native editor/manual-region/playback/export tests passed. Inspected repaired raster: decorative label/outline remnants and interpolation artefacts are still possible; UI explains review/restore. Syntax checks and local engine/model HTTP 200. No direct browser/device UI check or 88-page OCR stress test.

User also asked export status: editor HTML v2 is implemented/tested; server/native build manifest accepts v1 only, so editor APK/EXE remain unwired. Do not call these working animation exports. No commit/push performed by this session; other sessions committed frontend changes during work, and index.html changes were left untouched. New OCR assets/tests remain untracked until explicitly committed with their dependencies. Updated README/checklist/vendor source.

### 18 September 2026 - Ordinary PDF flipbook export verification and save fixes

User clarified the broken exports concern flipbook.html, not animation editor. Kept animation work untouched. Built/downloaded real ordinary v1 exports using PSJ 2026-2030.pdf, all 88 pages: .build/qa/PSJ-88-HTML.zip (13,848,524 bytes), PSJ-88.apk (59,388,600), PSJ-88-Windows.zip (25,270,671). Each archive has exactly 88 page images and matching manifest. EXE MZ signature/packaged support files and APK assets verified. API job IDs: APK 419132c6ad4c4cbeb3ec7fb9d6f0da69; EXE c15d16a91b6c40b9b02ccf6b838df3c6. Private sample/export artifacts are ignored, not committed.

Fixed exposed-but-blocked save picker: SecurityError/NotSupportedError now fall back to normal download; AbortError remains cancellation with no download. Native builds refresh capability/session token immediately before submission, preventing stale-token failures after server restart. Detailed failures now appear in export-status near controls rather than generic failure with detail only below reader. Exact original user symptom remains unconfirmed (clarification asked); don't claim it was conclusively one of these causes.

Tests: save-location regressions; qa-editor DOM flow now includes native APK/EXE submit/status/save mocks with fresh-token assertions; actual PSJ 88-page PDF load/project/HTML flow passed; real localhost Flutter builds/downloads for both targets passed; archive integrity assertions passed; export suite, 16 Python tests, JS syntax and diff checks passed. No actual Android install or Windows app/browser UI launch verified; build success is not device-runtime QA. Files touched: assets/flipbook.js, assets/flipbook-export.js, tests/qa-editor.cjs, tests/save-location.test.cjs, handoff/team notes. No commit/push by this session.

### 22 September 2026 - server --host 0.0.0.0 untuk akses LAN

Tujuan: PC lain membuka app dari server PC ini. Yang dikerjakan: flag `--host` di `server.py` (default loopback tidak berubah), `trusted()` menerima IP/hostname mesin sendiri dengan port cocok + tolak nama asing/port salah (anti DNS-rebinding dipertahankan), pesan error converter pakai `location.host` dinamis, 5 tes baru `LanHostTests`, README ada panduan firewall. File milik sesi lain tidak disentuh (hanya append docs ini + handoff + README). Hasil: 21 Python OK, node --check OK, E2E LAN nyata 200 via 192.168.18.16. Belum: uji browser dari PC lain beneran, belum commit/push. Koordinasi: sesi lain yang pegang converter/server harap perhatikan `trusted()` baru bila menambah endpoint.

### 25 September 2026 - MyFlipbook: rebrand, coming soon, Office layout, login + billing

Permintaan user: ganti nama jadi MyFlipbook, beresi PDF ke Word/Excel/PPT + bisa dijadikan flipbook, login + billing (rencana hosting), sisanya coming soon, lalu push.
- Commit awal `9ec0a29` menyimpan kerja sesi lama yang belum di-commit (OCR editor, mode LAN) setelah suite tes lolos.
- Rebrand: judul, nav, i18n, server, metadata dokumen. Key IndexedDB/localStorage `pdf-tools-*` tidak diganti agar data pengguna tidak hilang.
- Coming soon: 12 kartu (workflow, edit, sign, protect, PDF/A, repair, scan, compare, redact, forms, AI summarizer, translate) abu-abu dan tidak bisa diklik; converter `?tool=` yang belum ada menampilkan status coming soon tanpa area upload.
- `assets/pdf-layout.js`: render halaman tanpa teks (proxy canvas, vendor tidak diubah) + run teks berposisi. Word (keep look/flowing+tabel), PPT (text box), Excel (sheet Data dulu, angka asli). Hasil Office menawarkan "Turn source PDF into Flipbook".
- Akun: `accounts.py` (SQLite, PBKDF2, session hash, throttle login, order idempotent, Midtrans Snap + signature, provider simulasi/nonaktif). `server.py`: `/api/auth/*`, `/api/billing/*`, `--public-host`, gating entitlement, dan tidak lagi bisa bind port dobel di Windows. UI: `login.html`, `account.html`, `assets/auth.js` (chip nav di semua halaman), i18n EN/ID.
- Verifikasi: 34 tes Python (21 lama + 13 akun/Midtrans/hosting), semua suite Node termasuk `office-export.test.cjs` baru; output Word/PPT dirender LibreOffice dan dicek visual; alur UI akun diuji di Chromium (Playwright) desktop + lebar 390px tanpa error JS.
- Belum: uji Midtrans sandbox dengan key asli, reset password/verifikasi email, admin, uji Word/PowerPoint asli (bukan LibreOffice), deploy nyata.

### 25 September 2026 - Tripay sebagai gateway utama

User pilih Tripay (verifikasi lebih cepat dari Midtrans). `accounts.TripayProvider`: closed payment `POST /transaction/create` (form, Bearer api key, signature HMAC-SHA256 merchant_code+merchant_ref+amount), channel aktif dari `/merchant/payment-channel` (cache 10 menit, fallback QRIS/VA), callback `/api/billing/tripay/callback` diverifikasi HMAC body mentah + event `payment_status` + referensi tersimpan, balas `{"success": true}`. Halaman akun menampilkan pilihan metode bayar. Midtrans tetap tersedia. Tes: 35 Python (Tripay 1 tes end-to-end dengan opener palsu); UI Chromium dengan key palsu ke sandbox Tripay asli → pesan "Tripay: Invalid API Key" tampil rapi. Belum: key sandbox asli + callback via ngrok. REFUND belum mencabut paket (hanya dicatat).

### 25 September 2026 - Paywall ekspor flipbook, Pro Rp99.000

User: ekspor flipbook jangan gratis, harus Pro/Business; Pro Rp99.000 (tahunan diset Rp990.000, pola 10x bulanan — konfirmasi ke user). Entitlement baru `export` (Pro, Business). `server.py`: `CONFIG['paywall']` (on saat dijalankan, `--no-paywall` untuk internal, off saat diimport tes), template ekspor dilindungi 401/402 + no-store, build APK/EXE dicek per paket juga di mode lokal, Office tetap gratis lokal. UI flipbook: label PRO/BUSINESS + pesan paywall sebelum dialog simpan (pakai capabilities yang dimuat saat halaman dibuka agar dialog tetap dalam gesture klik). Editor animasi: cek yang sama. Tes: 36 Python, editor/qa-editor/save-location/export Node lolos; Chromium: Free ditolak (template 402), setelah bayar simulasi Pro → ZIP lengkap. Simpan proyek `.sm-flipbook` tetap gratis.

### 25 September 2026 - Ekstensi proyek .smflipbook

Chrome menolak `showSaveFilePicker` dengan accept `.sm-flipbook` (TypeError: invalid characters) sehingga "Save project as" gagal. Ekstensi baru `.smflipbook` (permintaan user); file `.sm-flipbook` lama tetap bisa dibuka. `chooseSave` hanya mengirim filter ekstensi yang valid dan mengulang tanpa filter bila TypeError. `qa-editor.cjs` kini membaca aset dari disk + capabilities lokal (tidak tergantung/terkena paywall server 8080). Diverifikasi di Chromium: `.smflipbook` lolos validasi.

### 25 September 2026 - Notebook PDF & Flipbook Animation jadi coming soon

User: "narasi pdf" (= Notebook PDF: ringkasan/podcast) dan animasi diberi coming soon. Katalog + tile abu-abu, chip nav "Notebook AI · Soon", link animasi di flipbook.html dihapus, hero tidak lagi menjanjikan chat AI. `notebook.html`/`animation.html` diganti `coming-soon.html` oleh server saat paywall aktif (kode asli tetap ada; `--no-paywall` untuk internal). Tes: 37 Python (baru: halaman coming soon + bypass internal), animation-editor/qa-runtime/qa-editor/office-export lolos; dicek di Chromium.

### 25 September 2026 - QA menyeluruh + perbaikan native/responsive

- Semua tool converter (19) diuji lewat UI Chromium + isi output dicek (PyMuPDF/openpyxl). PDF→Word/PPT/Excel dibuka di MS Word/PowerPoint/Excel asli via COM: tampilan cocok, 15 frame / 12 text box / tabel Excel, SUM angka jalan.
- APK di emulator (WebView 66) awalnya layar kosong: `globalThis` + `?.` + `100dvh`/`inset`/flex-gap tidak didukung. Reader (viewer.js, layout.js, animation-playback.js, CSS) dibuat ES2018 + fallback CSS; tes baru `tests/viewer-compat.test.cjs` (acorn, ES2018 + API terlarang + CSS). Setelah itu APK: buku tampil, tombol & swipe cepat jalan. EXE diuji jalan di Windows.
- Nama app native = judul buku (label Android, judul jendela Windows; escape XML/aapt + universal character name C++), header reader "MYFLIPBOOK", tombol reader Inggris, Replay disembunyikan bila buku tanpa animasi.
- Responsive: audit 360/390/768/1024/1440 (overflow, elemen keluar layar, tap target <28px). Perbaikan: nav homepage (chip tengah ≥1024, ikon ★ Pricing di HP, CTA ≥640), ikon hero satu baris wrap di HP, select Word layout, tap target debug/test/login switch.
- Tes: 38 Python + 13 suite Node lolos. Akun uji @test.id dihapus dari DB lokal.

### 25 September 2026 - Export mengikuti susunan halaman preview

User: hasil flipbook harus sesuai preview. `FlipbookLayout.geometry` dulu memakai aturan tambahan (lebar/tinggi < rasio x 1,5 -> satu halaman) sehingga PDF landscape tampil satu halaman di ekspor tapi dua halaman di preview. Aturan kini sama dengan preview: spread dua halaman bila lebar area >= 700px, satu halaman di HP; berlaku untuk HTML, EXE, APK. Diverifikasi Chromium: portrait & landscape di 1280x800, 1440x900, 390x844 -> status preview == ekspor. Tes export/qa-runtime/qa-editor/idle/viewer-compat lolos.

### 25 September 2026 - Buku ekspor pas di semua ukuran layar

User: tampilan landscape seperti preview (sampul sendiri di kanan) sudah benar, dan harus sesuai dimensi media. Diukur 2 bentuk PDF x 7 layar (1366x768, 1920x1080, 1440x900, 1024x768, 768x1024, 390x844, 844x390): buku selalu di dalam layar dan dibesarkan sampai salah satu sisi. Perbaikan: area buku kini berhenti di atas bar kontrol (tinggi bar diukur, bar bisa 2 baris di HP) sehingga halaman tidak pernah tertutup tombol (sebelumnya 62px di desktop, 16px di HP miring); judul overlay hanya muncul di perangkat ber-mouse (di layar sentuh hover "nyangkut" dan menutupi halaman). Semua kombinasi: overlap 0.

### 25 September 2026 - Petunjuk dalam paket berbahasa Inggris

User: petunjuk pakai bahasa Inggris. `BUKA-APLIKASI.txt` (ZIP Windows) dan `BUKA-BUKU.txt` (ZIP HTML, flipbook + editor animasi) diganti `HOW-TO-OPEN.txt` berbahasa Inggris (`server.WINDOWS_HOW_TO`, `FlipbookExport.HOW_TO_OPEN`). Build Windows tetap ZIP (keputusan user). Diverifikasi di build EXE nyata; tes export/save/editor/runtime + 38 Python lolos.

### 25 September 2026 - Pembayaran dolar lewat Lemon Squeezy

User ingin pembeli luar negeri. Tripay hanya IDR (dicek di dokumentasi). User pilih Lemon Squeezy + harga Pro $9.99/$99, Business $19.99/$199. `accounts.LemonSqueezyProvider` (checkout JSON:API, webhook HMAC X-Signature), `Accounts(provider, usd_provider)`, kolom `orders.currency` (migrasi otomatis), tabel `subscriptions`. Awal dari `subscription_created`, renewal dari `subscription_payment_success` (renewal, per invoice `LS-<id>`, idempotent). Checkout yang gagal sebelum sampai gateway tidak lagi meninggalkan baris "failed". Pricing: toggle Rp/$ + deteksi zona waktu/bahasa, metode Tripay hanya untuk IDR. Tes: 40 Python (2 baru: alur USD lengkap dengan opener palsu, simulasi USD); Chromium: default USD (New York) / IDR (Jakarta), checkout Business $199 simulasi -> paket aktif. Belum: akun + key Lemon Squeezy asli.

### 25 September 2026 - Invoice PDF di riwayat pembayaran

`invoice.py` (writer PDF stdlib: Helvetica/WinAnsi, Flate) + `Accounts.paid_order` + route `GET /api/billing/orders/<id>/invoice.pdf` (401 tanpa login, 404 bila belum lunas/bukan milik user). INVOICE untuk Tripay/Midtrans, RECEIPT untuk Lemon Squeezy (merchant of record), tanda TEST untuk simulasi. Penjual dari `MYFLIPBOOK_INVOICE_SELLER`. UI: kolom Invoice + tombol ⬇ PDF. Tes: `test_invoice_pdf_for_own_paid_orders`; Chromium: beli simulasi -> klik PDF -> file valid, dirender dan dicek.
