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

### 25 September 2026 - Banner hero dari background.png

User menaruh `background.png` (1671x941, teks tertanam) untuk mengganti header homepage. Hero lama (judul + ikon) diganti `<picture>`: `assets/img/hero-1671|900.webp/jpg` (88 KB webp dari PNG 1,3 MB) dan potongan kiri khusus HP `hero-mobile.*` (<=640px) agar teks terbaca. H1 tersembunyi untuk SEO/screen reader, `#horde` tetap ada (hidden) karena dipakai JS. Catatan untuk desain: gambar bertuliskan "PDDF TO FLIPBOOK" (typo) dan "100% Free"/"FREE" padahal ekspor/APK/EXE berbayar; teks gambar tidak ikut i18n. `background.png` asli tidak di-commit.

### 25 September 2026 - Typo banner diperbaiki

"PDDF" -> "PDF" di tagline banner: D kedua dihapus dengan menggeser teks mulai F 20px ke kiri pada pita y 204-224 (font/warna/spasi asli, latar hampir putih rata; perubahan hanya di bbox (257,204)-(660,224)). Disimpan `background-fixed.png` (asli tidak ditimpa, keduanya tidak di-commit); semua `assets/img/hero-*` dibuat ulang dari versi ini.

### 25 September 2026 - Bar kategori merah PDF

Bar filter kategori homepage jadi pita merah PDF full-width (#E5252A) tepat di bawah banner: teks putih, aktif = pil putih teks merah, hover putih transparan, focus ring putih. `.showcase.hero-image` diberi z-index 1 supaya lapisan dekoratif fixed (body::before) tidak memudarkan merahnya. Dicek 1440 & 390: tanpa overflow.

### 25 September 2026 - Suara kertas + lipatan buku melengkung

- `FlipbookSound` (di `assets/export/layout.js`, jadi ikut preview + HTML/EXE/APK/editor animasi tanpa ubah daftar file): suara kertas disintesis Web Audio (noise bandpass menyapu + ketukan kecil, variasi acak), tanpa file audio/lisensi, offline. `attach(book)`: bunyi saat state `flipping` (tombol/keyboard/swipe) dan saat drag (`user_fold`) dilepas — PageFlip tidak memancarkan `flipping` untuk drag. Tombol 🔊 Sound / 🔇 Muted (localStorage `mf-flip-sound`). Tes `tests/flip-sound.test.cjs`; Chromium: open cover/next/drag masing-masing 1 bunyi, muted diam; contoh suara `.build/flip-sound-preview.wav`.
- BUG LAMA diperbaiki: `book-effects.css` memakai `.stf__item--left/--right`, padahal PageFlip memberi class terpisah `--left`/`--right`, jadi efek spine/sampul tidak pernah aktif. Selector kini `[class~="--left"]` (aman untuk WebView lama). Lipatan dibuat melengkung: bayangan makin gelap ke jilid, highlight tipis di puncak lengkung, bayangan tipis di tepi luar.

### 28 September 2026 - Suara kertas lebih natural

Sintesis diganti: gelombang dihitung per-sample (seed deterministik, 3 variasi di-cache per gaya/sample-rate) dengan 3 bagian — crinkle (burst mikro acak, paling rapat saat kertas melengkung), swoosh (noise SVF bandpass yang menyapu), landing (thump rendah + slap). Stereo pan kanan->kiri. Gaya: paper (default), crisp, thick (`FlipbookSound.setStyle`). Contoh WAV: `.build/flip-sound-samples/`. Tes flip-sound (1 source per flip) + compat ES2018 + Chromium lolos.

### 28 September 2026 - Tautan antar-halaman / daftar isi interaktif

`assets/pdf-links.js` (`PdfLinks.extract`): (1) anotasi Link PDF -> hotspot ke halaman tujuan (dest string/explicit) atau URL http(s)/mailto; (2) daftar isi teks biasa di 15 halaman pertama (>=3 baris berakhiran nomor, nomor naik per kolom) -> tujuan = halaman pertama sesudah TOC yang memuat judul entri, lalu median offset, lalu nomor cetak. Koordinat pecahan kotak halaman (letterbox halaman beda ukuran sudah dihitung). `FlipbookLinks.mount` di layout.js (preview + HTML/EXE/APK), klik -> `book.flip(target)` + suara; dilewati bila halaman sudah terlihat; diizinkan saat state `fold_corner` (hover pojok). Data `links` divalidasi di `flipbook-export.validate` dan `server.validate_links` (URL hanya http(s)/mailto). Tes: `tests/pdf-links.test.cjs` + fixtures `tests/fixtures/toc-{links,text}.pdf`, test_build link validation; Chromium 10/10 lompatan benar di preview + buku offline; APK/EXE dibangun dan berisi links.

### 28 September 2026 - Bookmark pembaca

`FlipbookBookmarks` (layout.js, ikut preview + HTML/EXE/APK): tombol 🔖 Mark/Marked (spread -> halaman kiri), pita merah di halaman bertanda, tombol ☰ N membuka daftar (thumbnail, lompat dengan animasi, hapus ×, Esc/klik luar menutup). Disimpan localStorage per buku (`mf-bookmarks:<hash judul|halaman|rasio>`); onclick (bukan addEventListener) agar preview tidak menumpuk handler saat membuka PDF lain. Di viewer bind SETELAH `loadFromHTML` (sebelumnya PageFlip belum punya halaman -> reader gagal total; tertangkap E2E). Tes: `tests/bookmarks.test.cjs` (jsdom), Chromium preview + reader offline (tandai, reload tetap ada, lompat). Catatan: runner suite sebelumnya menganggap lulus bila ada satu baris PASS, sehingga `qa-runtime` yang gagal (ekspektasi `links:{}`) lolos di commit TOC; kini diperbaiki dan semua suite dicek dengan exit code.

### 28 September 2026 - Sampul di tengah + buka sampul halus

User (mengganti keputusan 25 Sep "sampul di kanan"): sampul awal di tengah, saat dibuka geser halus, jangan kaku. `FlipbookLayout.centerCover(book, root, reduced)`: saat tertutup (index 0) root translateX(-pageWidth/2); sampul belakang sendirian (jumlah halaman genap) +pageWidth/2; saat state `flipping` dari sampul -> geser ke 0 bersamaan animasi buka (transition 1.15s cubic-bezier); menutup: flip dulu lalu geser; drag tidak menggeser (settle saat lepas); portrait tidak pernah digeser; ResizeObserver. Sampul density `soft` (menekuk seperti kertas) tetapi class `book-board` tetap; flippingTime 950->1150ms. Dicek Chromium preview + reader offline: offset tengah 0px di sampul, spread, sampul belakang, HP miring; drag sampul tetap jalan. Tes export.test (centerCover + decorate) diperbarui.

### 28 September 2026 - Buka sampul melengkung (FlipbookCurl)

PageFlip melipat halaman lurus satu garis -> terkesan kaku. `FlipbookCurl` (layout.js): overlay 3D 36 strip vertikal berantai (transform-origin kiri, preserve-3d), sudut per strip = theta/n + bend*profil (tepi bebas mendahului; jumlah sudut = theta), bend = ±2.4*sin(pi*e), ease in-out 1.25 s; front = gambar sampul, back = halaman 2 (rotateY 180); bayangan gradien per strip dari sudut strip ke strip berikutnya (tanpa pita/tangga). Buka: turnToPage(1) di belakang overlay (+ centerCover geser), halaman 2 disembunyikan pakai class `curl-hidden` (PageFlip menulis ulang inline style). Tutup: ← di spread pertama / Home (dari halaman dalam: lompat ke spread 1 dulu) lalu turnToPage(0). Klik sampul (mouse) membuka dengan curl; swipe/drag tetap PageFlip. Klik saat animasi diabaikan. Hanya landscape; portrait/reduced motion pakai flip biasa. Dicek Chromium preview + reader offline (keyboard). Tes: export.test (angles).

### 28 September 2026 - Bookmark halaman kiri/kanan

Sebelumnya 🔖 Mark di spread dua halaman selalu menandai halaman kiri. Sekarang: satu halaman tampil (cover/portrait) -> langsung toggle; dua halaman -> popup "Bookmark a page" berisi Left/Right (thumbnail + status), bisa menandai salah satu atau keduanya, popup tetap terbuka, ikut berganti saat buku di-flip dan tertutup kalau tinggal satu halaman. Tes: bookmarks.test.

### 28 September 2026 - Ujung buka sampul tidak patah lagi

Model sudut FlipbookCurl lama membagi putaran rata ke semua strip bersarang, jadi di akhir (theta=PI) sampul berbentuk setengah tabung lalu diganti halaman datar -> terlihat patah. Model baru: orientasi strip = clamp(theta - bend*s^2, 0..PI) (sisi spine berputar kaku, tepi bebas tertinggal, rata di awal & akhir, tidak menembus buku), bend = ±1.15*sin(pi*e); bayangan per strip dari orientasinya; overlay fade-out 0.18 s. Tes export.test diganti (rata di kedua ujung, spine kaku, tepi tertinggal, clamp).

### 28 September 2026 - Glitch kiri saat kembali ke Home

Saat menutup sampul, bagian kiri tampak tergeser/terpotong. Perbaikan FlipbookCurl: (1) tepi bebas tertinggal maksimal 0.75x jarak putar (sebelumnya menempel & terseret datar di atas buku), (2) perspektif w*6 (dulu w*3.2, lembar terangkat tampak membesar), (3) geser ke tengah saat menutup baru mulai di setengah animasi dengan durasi sisa animasi (kalau di awal halaman kiri terseret keluar stage; kalau setelahnya ada hentakan kedua), (4) halaman 2 baru ditampilkan lagi setelah overlay hilang. Dicek per frame (Home dari 6-7): tidak ada kedip.

### 28 September 2026 - APK/EXE siap dites

- APK ditandatangani key rilis MyFlipbook sendiri (CN=MyFlipbook, O=MyFlipbook, C=ID), dibuat otomatis sekali oleh server.py via keytool (JAVA_HOME / Android Studio jbr / PATH) di `.data/android-release.jks` + `.data/android-signing.json` (password acak; `.data/` di-gitignore). Key lama tidak pernah ditimpa. **BACKUP kedua file itu**: kalau hilang, aplikasi buku yang sudah terpasang tidak bisa di-update (harus uninstall). Tanpa keytool -> fallback debug key (dicatat di log build). build.gradle.kts membaca env MYFLIPBOOK_KEYSTORE / _KEY_PASSWORD / _KEY_ALIAS.
- Paket Android: `id.myflipbook.<slug>_<hash6>` (stabil per judul), `--build-number` = menit epoch -> build ulang buku yang sama terpasang sebagai update.
- EXE diberi nama judul buku (`<Judul>.exe`, karakter terlarang dibuang, CON/PRN dll -> MyFlipbook); Runner.rc: CompanyName MyFlipbook, ProductName/FileDescription = judul. HOW-TO-OPEN menyebut nama exe + langkah SmartScreen.
- Belum: sertifikat code signing Windows (berbayar) & verifikasi developer Android (akun Google, dilakukan owner).

### 29 September 2026 - APK landscape + tombol tutup

- APK Android dikunci landscape (main.dart setPreferredOrientations landscapeLeft/Right + manifest `sensorLandscape`).
- Aturan layout: 1 halaman hanya kalau lebar < 700 **dan** layar tegak (lebar <= tinggi); HP landscape tetap spread 2 halaman. Editor preview (compact) tetap pakai lebar saja.
- Tombol ✕ (#close, pojok kanan atas) hanya muncul di aplikasi: Android lewat JavaScriptChannel `MyFlipbook` -> SystemNavigator.pop(); Windows lewat `chrome.webview.postMessage` -> webMessage -> exit(0). Tombol Fullscreen disembunyikan di Android (sudah immersive). Dicek: EXE benar-benar tertutup saat ✕ diklik; APK dibuild OK (belum dicek di HP).

### 29 September 2026 - Save-as langsung + progress bar export

- Semua export (project, HTML, APK, EXE) membuka dialog Simpan sebagai **saat tombol diklik** (FlipbookExport.chooseSave), lalu jalan sampai selesai dan menulis ke lokasi itu. Batal di dialog = export tidak jalan. Tanpa File System Access API -> download biasa. Setelah build ada link "Simpan salinan lagi…".
- Progress bar (#export-progress) untuk semua export. Project: ZIP 0-90%, simpan. HTML: halaman 0-55%, ZIP 55-92%, simpan. APK/EXE: kemas 0-12%, upload (XHR, FlipbookExport.upload) 12-20%, build 20-90% dari `job.progress` server (0.05 siapkan, 0.1 pub get, 0.2/0.25 signing, 0.3 compile, 1 selesai) + perkiraan waktu saat compile (tau 45 dtk APK / 20 dtk EXE), unduh-simpan dengan progres Content-Length 90-100%.
- saveRemote(url, name, handle, onProgress) tidak lagi membuka dialog sendiri.

### 29 September 2026 - Zoom di reader (HTML/APK/EXE)

- `FlipbookZoom` (layout.js): double-tap (250% di titik tap / balik 100%), pinch sampai 400%, geser 1 jari saat zoom; desktop Ctrl+wheel/trackpad pinch di kursor, drag, wheel menggeser saat zoom, dblclick reset; tombol 🔍 (200% -> 300% -> 100%); tombol +/-/0; chip "250% · Reset"; tips sekali di perangkat sentuh (localStorage `mf-zoom-hint`).
- Yang di-zoom `#stage` (transform-origin 0 0), `main{overflow:hidden}`. Geser dibatasi ke tepi buku (opsi `content()` = bounds PageFlip), bukan ke stage.
- Saat zoom, gestur di-capture di `main` (stopPropagation) jadi PageFlip tidak ikut -> geser tidak membalik halaman. Tap diam saat zoom tetap boleh click (link TOC). Balik halaman / flip -> zoom reset.
- Perangkat sentuh: `disableFlipByClick` = true (ditulis SETELAH motion(), yang menyetel false) -> tap tengah halaman tidak membalik; swipe & tap pojok tetap membalik.
- Layar pendek (max-height 500px): footer lebih ringkas supaya 1 baris di HP landscape.

### 29 September 2026 - Pesan "masih di dalam ZIP"

index.html reader punya kotak #extract-help (style inline) yang cuma tampil kalau viewer.css tidak termuat, yaitu saat index.html dibuka langsung dari dalam ZIP tanpa diekstrak (kasus laporan user: halaman polos tanpa buku). viewer.css menyembunyikannya.

### 29 September 2026 - Buku halaman ganjil bisa ditutup

Jumlah halaman ganjil berakhir di halaman kanan tanpa lembar balik, jadi buku tidak bisa ditutup. `FlipbookLayout.withBackCover(pages, className)` menambah sampul belakang kosong (`.book-back-blank`, krem) hanya untuk PageFlip (reader + preview); halaman dokumen, export, bookmark, link tidak berubah. Status menampilkan "Back cover"; tombol → berhenti di lembar terakhir PageFlip.

### 29 September 2026 - Workflow tahap 1

- `workflow.html` (baru, di allowlist PAGES server.py) + mesin `assets/workflow.js` (`Workflow.run(inputs, steps, onProgress)`, `STEPS`, `TEMPLATES`, `recipes` di localStorage `mf-workflows`). Semua di browser: PDF input digabung berurutan, lalu langkah: rotate, keep, remove, watermark (teks, via PDFEdit), page-numbers, crop, compress (object streams; jujur: hasil kecil untuk PDF gambar).
- UI: upload + urutkan file, template (Ready to send / Draft for review / Scanned pages tidy-up), tambah/urut/hapus langkah dengan opsi, simpan/pakai/hapus resep, progress + checklist per langkah, error menyebut langkah yang gagal, download + preview + "Turn into Flipbook".
- Kartu "Create a workflow" di index.html sekarang link ke workflow.html (badge New!, keluar dari SOON).
- Tes: tests/workflow.test.cjs. Tahap berikut (tunggu user): langkah konversi (Word/Excel/PPT/Gambar -> PDF), OCR, export flipbook otomatis.

### 29 September 2026 - Compress PDF beneran

`assets/pdf-compress.js` (`PDFCompress.compress(bytes, level, {onProgress, recode})`): gambar DCTDecode dan FlateDecode 8-bit (RGB/Gray/ICC N=1|3, predictor PNG didekode) diperkecil ke sisi maks per level lalu JPEG ulang via canvas; SMask target dilewati & referensi SMask disalin; ganti hanya kalau <95% ukuran lama; hasil tidak pernah lebih besar dari asli. Dipakai converter (Compress PDF, label Light/Balanced/Strong + ringkasan jujur) dan langkah workflow "Compress" (opsi level). Fixture: tests/fixtures/photo.jpg, photo-small.png (alpha), tiny.jpg.

### 29 September 2026 - Image to PDF dirapikan

`loadDrawables(file)` mengembalikan semua halaman TIFF; foto (jpg/webp/heic/avif/tiff) JPEG 0.92, grafis (png/gif/bmp/ico/svg) lossless PNG. Opsi baru: orientasi Auto (default), ukuran "Same as image" benar-benar seukuran gambar (96 dpi, tanpa margin), margin Normal/None/Wide; gambar dipusatkan; nama file dari gambar pertama. Diuji 12 format di Chromium (termasuk HEIC via pillow-heif, AVIF, EXIF orientation 6).

### 29 September 2026 - PDF to JPG dirapikan

Nama file dipad nol (`<nama>-page-01.jpg`) supaya urut, opsi Format JPG/PNG, latar putih eksplisit, halaman sangat besar diperkecil ke batas 12000 px / 60 MP (dilaporkan), PDF berpassword/rusak diberi pesan jelas, deskripsi tidak lagi mengklaim "ambil semua gambar" (fitur itu tidak ada).

### 29 September 2026 - HTML to PDF dengan layout asli

`server.py`: `find_chromium()` (env MYFLIPBOOK_CHROME, PATH, Edge/Chrome default Windows), `prepare_html()` (sisip @page + print-color-adjust di awal head), `html_to_pdf()` (halaman disajikan server loopback sekali pakai dengan CSP ketat; headless Edge `--print-to-pdf`; hosting: CSP script-src none + `--proxy-server=http://127.0.0.1:9 --proxy-bypass-list=<-loopback>;127.0.0.1:PORT`). JANGAN pakai `--blink-settings=scriptEnabled=false`: bikin print-to-pdf gagal. Route `/api/convert/html-to-pdf` (text/html, .html/.htm, maks 20 MB, header X-Page-Size/X-Margin), capabilities `html`. Client: opsi Paper/Margin, fallback teks dengan pemberitahuan.

### 29 September 2026 - OCR PDF searchable beneran

`assets/pdf-ocr-layer.js` (`PDFOcrLayer.addWords(lib, doc, page, font, words, toPdf)`): teks Tr 3 + Tz + Tm per kata, koordinat via pdf.js `viewport.convertToPdfPoint` (ikut rotasi/offset MediaBox). `ocrSearchablePdf` sekarang pakai pdf-lib di atas PDF asli (dulu jsPDF: semua halaman jadi JPEG dan ukuran kertas 2x), Tesseract worker sekali untuk semua halaman, render ~290 dpi, lewati halaman yang sudah punya teks (>=20 karakter).

### 29 September 2026 - PDF ke Excel/Word/PPT diuji dokumen sulit

`cellsOf`: ambang kolom = max(6 pt, 0.8 x ukuran huruf) (dulu 50 pt tetap -> tabel rapat tergabung); bullet tunggal di sel pertama digabung ke teks. `excelValue`: persen dibulatkan (toPrecision 15). `excelFormat` baru: numFmt #,##0 / 0.0% / "Rp "#,##0 / "$" untuk angka hasil parsing di sheet Data. Word/PPT tidak diubah; dicek visual lewat LibreOffice.

### 29 September 2026 - Catatan pembaca per halaman

`FlipbookNotes` (layout.js): tab `.book-note-tab` di tepi luar tiap halaman (kanan untuk halaman kanan/tunggal, kiri untuk `--left`), ✎ samar / 📝 kuning bila ada isi; editor (autosave 400 ms, maks 5000 karakter, Esc/Done/klik di luar menyimpan, Delete mengosongkan); tombol `#notes` "📝 N" membuka daftar (lompat ke halaman, edit, Download .txt). Simpan per buku di localStorage `mf-notes:<hash>` (key sama dengan bookmark). `FlipbookNotes.typing(event)` dipakai viewer (panah) dan zoom (+/-/0) supaya mengetik tidak membalik/zoom; idle tidak kembali ke sampul saat editor terbuka. Aktif di preview + HTML/APK/EXE. Layar pendek: panel di atas & ringkas. Tes: notes.test.cjs.

### 29 September 2026 - Catatan otomatis mem-bookmark

Catatan baru memanggil `options.bookmark(index, true)` (viewer/preview: `marks.set`); flag `marked` di data catatan mencatat apakah catatan yang menambah bookmark itu. Hapus catatan -> hapus bookmark hanya bila `marked`. `FlipbookBookmarks.bind` sekarang mengembalikan `set(index, on)`. Tab catatan pakai `onclick` (diganti tiap bind) supaya bind ulang tidak memakai handler lama.

### 29 September 2026 - Stabilo (highlighter) pembaca

- `assets/pdf-words.js` (`PdfWords.extract(pdf)`): posisi kata per halaman dari teks PDF saat dibuka di editor -> `words` di model buku: `{page: [[y, h, x0, w0, x1, w1, ...], ...]}` integer 1/10000 kotak halaman (letterbox via `PdfLinks.toBox`), maks 400 baris x 300 kata. Divalidasi `validWords` (flipbook-export.js) dan `validate_words` (server.py); batas book.json server naik ke 16 MB. Uji toc-links: 12 halaman = 2,3 KB.
- `FlipbookHighlights` (layout.js): tombol `#highlight` 🖍 -> mode stabilo (body.is-highlighting), bar warna vertikal di kiri (kuning/hijau/pink/biru, Done, Delete). Seret di teks -> menempel ke kata per baris (dipotong di celah kolom > 2,5x tinggi baris); mulai di luar teks / halaman scan -> kotak bebas. Tap stabilo -> pilih, ganti warna / hapus. Simpan `mf-highlights:<hash>` (+ warna `mf-highlight-color`). Handler halaman pakai properti on* (bind ulang tidak menumpuk); gerak seret didengar di window fase capture karena halaman menghentikan mousemove (tanpa efek lipat pojok). Zoom mengalah untuk 1 jari/mouse saat stabilo aktif; pinch tetap zoom. Idle tidak aktif saat mode stabilo.
- Tes: highlights.test.cjs, test_build (validate_words), export.test (validWords).

### 29 September 2026 - Tanpa lipatan pojok saat hover

`FlipbookLayout.motion`: `showPageCorners:false` (dulu `!reduced`). Permintaan user: lipatan pojok muncul saat hover dan mengganggu stabilo. Halaman tetap bisa dibalik lewat tombol, swipe, seret dari pojok, klik pojok.

### 30 September 2026 - Stabilo tidak menumpuk + penghapus

`FlipbookHighlights.add(list, rects, color)`: highlight baru yang tumpang tindih (>25% luas persegi terkecil, `overlap`) dengan yang lama digabung jadi satu (`merge`, warna baru). `erase(list, region)`: tombol 🧽 di rel warna; seret/tap menghapus highlight yang tersentuh (pratinjau kotak putus-putus merah, body.is-erasing). Memilih warna mematikan penghapus.

### 30 September 2026 - Catatan gaya tab agenda

`FlipbookNotes` ditulis ulang: data `{page: {items: [{text, updated}], marked}}` (maks 8 per halaman; format lama 1 catatan/halaman dimigrasi jadi item 1). Tiap catatan = tab bernomor berwarna di `.book-note-stack` tepi luar halaman (lekukan via ::before/::after radial-gradient, var --tab); tab ＋ / ✎ menambah. Tap tab -> `.book-note-card` fixed di samping tab (Delete / Edit); editor lama dipakai untuk tulis/edit (autosave; catatan baru dapat nomor saat simpan pertama). Bookmark otomatis saat catatan pertama, dilepas saat catatan terakhir dihapus (bila catatan yang menambahkan). Daftar & .txt per catatan.

### 30 September 2026 - Add file (upload / link / Google Drive)

- Editor: tombol "＋ Add file" (id `#add-file`) membuka `#add-dialog`: kotak link, tombol Upload file / Link-site / Google Drive, area drop. `#pdf-file` tetap ada (hidden, multiple, accept PDF/Office/gambar). `openSources(files)`: semua gambar -> satu PDF (pdf-lib dimuat lazy dari assets/vendor, canvas JPEG 0.92, maks 3000 px, SVG lewat <img>); PDF langsung; Office -> /api/convert/*-to-pdf.
- Server: `POST /api/fetch-source {url}` (token; butuh login di hosting seperti office) -> `fetch_source`: Google Drive/Docs/Sheets/Slides -> link unduh/ekspor PDF (`google_drive_url`); PDF/Office/gambar apa adanya (X-Filename); halaman web -> `print_url_to_pdf` (Edge/Chrome headless); maks 60 MB; mode hosting: `check_public_host` untuk host & setiap redirect (tolak loopback/privat/link-local). Drive tidak publik -> pesan jelas. Belum diuji dengan file Drive publik asli.
- Juga: fade kurva sampul pakai requestAnimationFrame (bukan setTimeout). qa-editor/qa-runtime/qa-converter diperbarui (sempat gagal sejak curl/progress/compress; sekarang ikut dijalankan).

### 30 September 2026 - Export satu file terenkripsi (HTML/APK/EXE)

- `assets/export/book-seal.js` (browser) + `book_seal.py` (server): ChaCha20 RFC 8439 (vektor RFC diuji di keduanya, interop Python->JS diuji). Payload `<script type="application/json" id="book-payload">{v,k,n,d,p[]}`: data buku (nonce index -1) dan tiap halaman JPEG (nonce index i) dienkripsi, base64. `BookSeal.open()` mendekripsi data segera, halaman di latar (FLIPBOOK_PAGE_URL(index, cb) -> blob URL; 4 halaman pertama langsung). Kunci ada di file: melindungi dari salin biasa, bukan dari reverse engineering.
- `singleHtml` / `single_html`: template index.html + CSS inline + skrip inline [book-seal, `BookSeal.open();`, page-flip, layout, viewer]; CSP disesuaikan (inline). PENTING: skrip yang di-inline tidak boleh berisi `</script` atau `<!--` (dicek, lempar error) — pakai `<\/script` / `<!--` di book-seal.js.
- Editor: export HTML = `<Judul>.html` (FlipbookExport.packageSingleHtml, titleFile). Nama file semua export mengikuti judul (titleFile). Build: server `unpack_book` menghasilkan satu index.html tersegel (tanpa folder pages; pubspec tanpa assets/book/pages/).
- EXE: `native/launcher/Launcher.cs` (C# 5, dikompilasi per build dengan csc.exe .NET Framework 4 bawaan Windows, ikon app) + ZIP folder Release ditempel + trailer 120 byte (MFBOOK01, offset, panjang, id sha256[:32], nama exe pembaca). Jalan pertama mengekstrak ke `%LOCALAPPDATA%\MyFlipbook\Books\<id>` (atomic via folder sementara + .ready), lalu menjalankan sarvamaya_book.exe. ZIP unduhan berisi `<Judul>.exe` + HOW-TO-OPEN.txt. Header unduhan build pakai nama buku (filename*=UTF-8).
- Diuji: single HTML dibuka via file:// (Chromium), APK hanya berisi assets/book/index.html terenkripsi, EXE satu file jalan (0,6 dtk pertama, 0,3 dtk berikutnya) dan menampilkan buku.

### 30 September 2026 - Midtrans jadi gateway rupiah (Tripay maintenance)

- Pilihan provider IDR: Midtrans bila MIDTRANS_SERVER_KEY ada (default); Tripay bila Midtrans kosong atau MYFLIPBOOK_IDR_PROVIDER=tripay.
- `server.load_env(ROOT/.env)` saat server start (KEY=VALUE, tidak menimpa env sistem, nilai kosong dilewati). `.env` lokal sudah dibuat berisi kolom Midtrans kosong (gitignored).
- `MidtransProvider.status(order_id)` (GET api[.sandbox].midtrans.com/v2/<id>/status, Basic server key) + `Accounts.refresh_pending(user_id)` dipanggil di GET /api/billing/orders: order pending <=48 jam (maks 3) disettle langsung dari status Midtrans -> bekerja walau notifikasi tidak bisa sampai (server lokal). Nominal tidak cocok -> order failed. Notifikasi bertanda tangan tetap jalur utama: set Payment Notification URL https://<domain>/api/billing/midtrans/notify di dashboard.

### 30 September 2026 - Arsipku (arsip pribadi member)

- `library.py`: tabel `library_books` + `library_exports` di SQLite akun; file di `.data/library/<user_id>/<book_id>/` (project.bin, cover.bin, exports/<id>.bin) terenkripsi: SHAKE-256 keystream per 1 MB + HMAC-SHA256 (encrypt-then-MAC), kunci master `MYFLIPBOOK_LIBRARY_KEY` atau `.data/library.key` (dibuat sekali). **BACKUP library.key bersama database** — hilang = arsip tidak bisa dibuka. 50 MB ~0,3 dtk.
- Kuota `LIMITS`: free 3 buku/100 MB, pro 50/5 GB, business tanpa batas/50 GB (turun paket tidak menghapus, hanya menolak simpanan baru). Satu ekspor terbaru per jenis (html/apk/exe) per buku.
- API (login): GET /api/library, GET /api/library/<id>/(cover|project), GET /api/library/<id>/exports/<eid>, POST /api/library/save (zip, X-Book-Id), POST /api/library/<id>/(cover|export|delete). Build APK/EXE: header X-Library-Book -> hasil disimpan server ke arsip.
- Editor: simpan otomatis saat buku dibuka (+ sampul 480px) dan saat ekspor/simpan proyek; status `#archive-status`; `flipbook.html?library=<id>` membuka dari arsip. Halaman `library.html` (Arsipku) + link di Akun. Tes: tests/test_library.py.

### 30 September 2026 - Logo baru MyFlipBook

Sumber: `assets/img/logo-source.jpg` (= "flipbook logo.jpeg" dari owner). Diturunkan (latar putih -> transparan, color-to-alpha): `assets/img/logo.png` (nav, 120 px tinggi), `logo-icon.png` (512), `favicon.png` (64), `apple-touch-icon.png` (180, latar putih); ikon Android `mipmap-*/ic_launcher.png` (48-192, latar putih) dan Windows `app_icon.ico` (16-256, juga dipakai launcher EXE satu file). Semua halaman: `.clay-brand-logo` / `.brand img` menggantikan kotak "MF"; `<link rel="icon">` + apple-touch-icon. Logo berteks hitam: jangan dipakai di latar gelap.

### 30 September 2026 - Logo diganti versi HIJAU (+ banner beranda)

Owner: logo harus hijau, bukan biru. Sumber baru `assets/img/logo-source.png` (= "Logo Warna - MyFlipBook.png", sudah transparan; `logo-source.jpg` biru dihapus). Semua turunan dibuat ulang dari situ: `logo.png` (nav, 120 px), `logo-icon.png`, `favicon.png`, `apple-touch-icon.png`, Android `mipmap-*/ic_launcher.png`, Windows `app_icon.ico`. Banner beranda (`hero-1671`/`hero-900`/`hero-mobile`, .jpg + .webp): logo buku-terbuka lama di kiri atas dihapus, diganti logo hijau; tagline asli "PDF TO FLIPBOOK & MORE" dipertahankan (pikselnya dipindah, rata kiri dengan wordmark). Semua referensi gambar logo/hero di 10 halaman diberi `?v=green` agar cache browser tidak menampilkan versi lama.

### 30 September 2026 - Kaca pembesar (loupe) di reader

Tombol 🔎 (`#loupe`) di reader ekspor (`assets/export/index.html` -> HTML/APK/EXE) dan pratinjau editor (`flipbook.html`). Modul `FlipbookLoupe` di `assets/export/layout.js` (ES2018): lensa bulat + gagang, `position:fixed`, digeser mouse/sentuh (pointer events + setPointerCapture, tidak membalik halaman). Isi lensa = gambar halaman di bawahnya (resolusi asli, dihitung dari `object-fit:contain` via `fit()`), sebagai background CSS berlapis (+ lembar putih per halaman), digambar ulang tiap frame selama aktif (ikut flip/zoom). Tap kaca: 2x -> 3x -> 4x; scroll di atas kaca: 1.5x-6x; ✕ / Esc menutup. Idle-home tidak jalan selama lensa aktif. Stabilo/catatan tidak ikut terbesar (hanya gambar halaman). CSS di `book-effects.css`. Tes: `tests/loupe.test.cjs`; dicek Chromium desktop + mobile (drag mouse, drag sentuh via CDP: lensa pindah, halaman tetap).

### 30 September 2026 - Ikon kuas + penghapus di stabilo

Rel stabilo sekarang diawali pasangan alat: **kuas** (`.book-hl-brush`, mewarnai; latar tombol = warna stabilo terpilih lewat `--hl-color`) dan **penghapus** (`.book-hl-eraser`, merah saat aktif), dipisah garis dari titik-titik warna. Tombol toolbar `#highlight` juga ikon kuas. Ikon = SVG inline (`FlipbookHighlights.ICONS`, gaya garis Lucide, lisensi ISC) — bukan emoji, supaya sama di semua perangkat. Emoji 🖍/🧽 dihapus.

### 30 September 2026 - Kursor kuas / penghapus saat stabilo

Di mode stabilo, kursor mouse di atas halaman = ikon kuas (bulu kuas berwarna sesuai warna stabilo terpilih), di mode hapus = ikon penghapus; dulu `text`/`crosshair`. SVG data-URI dibuat `FlipbookHighlights.cursor(kind, color)` (garis putih tebal di bawah supaya terlihat di halaman gelap; hotspot kuas `4 22`, penghapus `5 20`), dipasang lewat variabel `--hl-cursor` di `body` pada setiap `paintBar()`; CSS punya fallback `text`/`crosshair`. CSP reader sudah mengizinkan `data:` gambar. Layar sentuh tidak punya kursor (tidak berubah).

### 30 September 2026 - Kursor + ikon: pulpen stabilo kecil (bukan kuas)

Owner: jangan kuas, pakai pulpen stabilo kecil; penghapus juga dikecilkan. Ikon tombol stabilo (toolbar + rel) dan kursor sekarang pulpen stabilo (badan + leher + ujung, digambar tegak lalu `rotate(45 12 12)` sehingga ujung di kiri bawah). Kursor 20x20 px (dulu 32): badan + ujung berwarna stabilo terpilih, leher abu gelap, garis luar putih; hotspot pulpen `5 15`, penghapus `3 14`. Nama internal (`ICONS.brush`, `.book-hl-brush`) tetap supaya selector/tes tidak berubah; label/tooltip sekarang "Highlighter".

### 30 September 2026 - Pilihan stabilo jadi popup di atas tombolnya

Owner: pilihan warna stabilo di atas ikonnya, jangan di pinggir. Kalau `FlipbookHighlights.bind` diberi `button`, bar (`.book-hl-bar.is-popup`) sekarang popup horizontal tepat di atas tombol stabilo (pulpen/penghapus | titik warna | Delete | Done) dengan panah ke tombol (`--hl-arrow`); posisi dihitung `placeBar()` (ditempel ke tepi layar 8 px, pindah ke bawah tombol `.is-below` bila di atas tidak muat), ikut resize/scroll selama mode aktif. Tanpa tombol tetap rel kiri seperti dulu. Dicek Chromium 1000x640, HP 390x780, landscape 800x390.

### 30 September 2026 - Dialog Add file: tombol "Link / site" dihapus

Owner: tombol Link / site di-takeout, tombol sisanya (Upload file, Google Drive) di tengah (`.add-sources{justify-content:center}`). Menambah dari link tetap bisa lewat kolom "Paste a link" di atas (PDF, web page, Office, Drive) — tombol lama hanya memfokuskan kolom itu.

### 30 September 2026 - Dialog Add file dikecilkan

Owner: ukuran dialog lebih kecil. `.add-card` lebar maks 520 px (dulu 700), padding/judul (19 px)/kolom link (tombol → 32 px)/tombol sumber (13 px)/kotak drop (12 px) diperkecil sekitar seperempat; versi HP (≤520 px) ikut. Hanya CSS `assets/theme-cream.css`.

### 30 September 2026 - Stabilo langsung jadi catatan (kutipan) di tab pinggir halaman

Owner: teks yang di-stabilo langsung dibuat catatan di tab pinggir halaman. Alur:
- `pdf-words.js`: `extract(pdf, {withText:true})` -> `{words, text}`; `text` = per halaman, per baris, string kata-kata dipisah satu spasi (kata ke-i = `split(' ')[i]`, sejajar dengan `words`). Field model/proyek/ekspor baru `text` (divalidasi `validText` di flipbook-export.js dan `validate_text` di server.py: halaman harus ada di `words`, baris ≤ jumlah baris words, string ≤ 4000). Proyek/buku lama tanpa `text` tetap jalan (stabilo tanpa catatan).
- `FlipbookHighlights`: `lines(raw, text)` menempelkan teks kata; `quote(lines, rects)` = kata-kata di bawah stabilo; bind options `text`, `onQuote(index, said)` (setelah stabilo baru/gabungan), `onUnquote` (saat dihapus).
- `FlipbookNotes`: `quote(index, said)` membuat tab catatan `“…”` (auto-bookmark seperti catatan biasa, tab berdenyut `.is-new` walau mode stabilo meredupkan tab); teks yang sudah ada di catatan tidak ditambah; stabilo yang diperpanjang mengganti kutipan lamanya (tidak dobel). `unquote` menghapus kutipan saat stabilonya dihapus, kecuali pembaca sudah mengedit catatannya. Maks 8 catatan/halaman tetap berlaku.
- Halaman scan tanpa lapisan teks: stabilo kotak bebas, tanpa catatan (pakai OCR dulu).
Tes: `tests/highlight-notes.test.cjs`, export/test_build/qa-runtime diperbarui. E2E Chromium: editor (toc-text.pdf, "Daftar Isi" -> tab catatan + bookmark) dan HTML satu-file tersegel (catatan terbentuk; teks tidak terbaca polos di file).

### 30 September 2026 - Tab ✎ kosong di pinggir halaman dihapus

Owner: ikon ✎ di pinggir halaman di-takeout (catatan sekarang lahir dari stabilo). `FlipbookNotes.bind` opsi baru `blank: false` (dipakai reader ekspor + pratinjau editor): halaman tanpa catatan tidak punya tab sama sekali; halaman yang sudah punya catatan tetap punya ＋ untuk menambah catatan sendiri. Pesan daftar catatan kosong: "Highlight text 🖍 and it becomes a note on the page edge." Default modul (tanpa opsi) tidak berubah. Catatan: halaman scan tanpa teks sekarang tidak bisa diberi catatan dari pinggir halaman (stabilo kotak di sana tidak membuat catatan).

### 30 September 2026 - Hapus catatan kutipan = stabilonya ikut hilang (dua arah)

Owner: stabilo dihapus -> catatan hilang (sudah ada), dan tombol Delete catatan -> stabilonya ikut hilang (baru). `FlipbookNotes` opsi `onRemove(index, said)` dipanggil hanya saat pembaca menekan Delete (kartu 🗑 atau Delete di editor catatan) pada catatan yang diawali kutipan `“…”` (termasuk kutipan yang sudah diberi komentar); `said` = teks di dalam kutipan. `FlipbookHighlights.bind(...).forget(index, said)` menghapus stabilo di halaman itu yang kata-katanya persis sama. Penghapusan internal (kutipan diganti karena stabilo diperpanjang, unquote dari penghapus) tidak memicu `onRemove`, jadi tidak ada loop. Arah sebaliknya tetap: menghapus stabilo menghapus kutipan yang belum diedit; kutipan yang sudah diberi komentar tetap disimpan. Tes: `tests/highlight-notes.test.cjs`; E2E editor (toc-text.pdf: stabilo "Daftar Isi" -> Delete catatan -> stabilo 0, tab 0, 📝 0).

### 30 September 2026 - Zoom reader: kontrol − 100% + di toolbar

Owner: zoom pakai persentase. Tombol 🔍 tunggal + chip "200% Reset" di atas diganti kontrol toolbar `#zoom-ctl`: `#zoom-out` (−) | `#zoom-level` (persentase, klik = kembali 100%, hijau tua saat > 100%) | `#zoom-in` (+). Level: `FlipbookZoom.LEVELS` 100/125/150/200/250/300/400% (`up()`/`down()`), − nonaktif di 100%, + nonaktif di 400%; tombol keyboard +/−/0 ikut level yang sama. Double-tap/pinch/Ctrl+wheel/geser tetap, persentasenya ikut tampil. Opsi lama `button`/`chip` di `FlipbookZoom.bind` masih didukung (tidak dipakai reader). CSS di `viewer.css`. Catatan: di lebar ~1000 px toolbar reader jadi 2 baris (Fullscreen turun).

### 30 September 2026 - Zoom cuma satu langkah (200%), kedua kali balik 100%

Owner: zoom sekali saja, yang kedua balik ke 100%. `FlipbookZoom.ZOOMED = 2`; `up(scale)` = 200% dari 100%, selain itu balik 100% (tombol + berubah jadi ↺ saat zoom); `down()` selalu 100%; double-tap juga ke 200% (dulu 250%) dan double-tap kedua balik 100%; tombol keyboard +/− sama. `LEVELS` bertingkat dihapus. Pinch / Ctrl+wheel masih bebas sampai 400% (persentase tetap tampil).

### 30 September 2026 - Tab catatan berwarna sesuai stabilonya + link bisa di-stabilo

Owner: warna catatan di pinggir = warna stabilonya (stabilo hijau -> catatan hijau, ganti pink -> catatan berikutnya pink, dst.). Catatan menyimpan `color` opsional (hex, divalidasi di `FlipbookNotes.load`); `quote(index, said, color)` memberi warna, `tint(index, said, color)` mengikuti saat warna stabilo diganti (pilih stabilo -> klik warna, atau stabilo ulang dengan warna lain). Edit catatan mempertahankan warnanya. Catatan lama tanpa `color` tetap warna urut nomor. Highlights bind: `onQuote(index, said, color)`, `onRecolor(index, said, color)`.
Bug lama ikut diperbaiki: teks yang juga link (daftar isi) tidak bisa di-stabilo karena `.book-link` menahan mousedown; sekarang `body.is-highlighting .book-link{pointer-events:none}`. Tes: `tests/highlight-notes.test.cjs`; E2E editor toc-text.pdf: 4 baris daftar isi dengan kuning/hijau/pink/biru -> tab 1-4 berwarna sama.

### 30 September 2026 - Tombol Google Drive: buka Drive + panduan 3 langkah

Owner: tombol Google Drive belum terasa jalan (dulu hanya ganti placeholder + fokus kolom). Sekarang klik -> `drive.google.com/drive/my-drive` terbuka di tab baru dan dialog menampilkan `#add-drive-help` (1. cari file, 2. Share -> Anyone with the link, 3. Copy link -> paste -> →); ditutup/direset saat dialog dibuka lagi. Pengambilan file tetap lewat `/api/fetch-source` (link publik; file privat -> pesan error yang sudah ada). Pilihan owner: TIDAK memakai Google Picker (butuh Google Cloud API key + OAuth client + domain https). Belum diverifikasi dengan file Drive publik sungguhan.

### 30 September 2026 - Daftar "My notes": teks penuh + word wrap, scroll ke bawah

Owner: daftar catatan dirapikan. Sebelumnya cuplikan 90 karakter satu baris (`nowrap`) sehingga panel scroll ke samping dan tombol ✎ keluar layar. Sekarang daftar menampilkan teks catatan penuh, dibungkus (`white-space:pre-wrap; overflow-wrap:anywhere`), `.book-note-list{overflow-x:hidden}`, tombol ✎ tetap di kanan atas tiap catatan; panel hanya scroll ke bawah (max-height 60vh). Dicek Chromium 1000x640 dan 390x780: scrollWidth = clientWidth.

### 30 September 2026 - Tab ＋ di pinggir halaman juga dihapus

Owner: tanda ＋ tidak usah. Dengan `blank: false` (reader + editor) sekarang tidak ada tab tambah sama sekali (✎ maupun ＋); catatan hanya lahir dari stabilo dan bisa diedit/dihapus dari tabnya atau daftar My notes. Konsekuensi: menulis catatan bebas tanpa stabilo tidak bisa lagi dari pinggir halaman (edit kutipan tetap bisa untuk menambah komentar).

### 30 September 2026 - Halaman landscape satu per satu (2x lebih besar) + bug tombol di HP

Owner: kertas landscape (slide 16:9) terlalu kecil. `FlipbookLayout.geometry`: dokumen dengan rasio > `WIDE` (1.15) tampil satu halaman per layar bila itu membuat halaman >= 1.4x lebih besar dari spread (selalu di pratinjau editor/compact; tinggi pratinjau ikut `bind`). Portrait tidak berubah; layar sangat lebar / HP miring yang pendek tetap spread bila satu halaman tidak lebih besar. Hasil: editor 16:9 ~434x245 -> 869x489 px; reader laptop 1280x720 -> 1156x650. Tes geometry lama "wide pages still spread" diganti.
Bug lama ditemukan saat tes & diperbaiki: di perangkat sentuh viewer memasang `disableFlipByClick` (tap di tengah halaman tidak membalik), tapi PageFlip juga menerapkannya ke `flipNext/flipPrev/flip(page)`, sehingga tombol ← →, link daftar isi dan lompat bookmark TIDAK membalik halaman di HP/tablet/APK (hanya swipe yang jalan). `viewer.js` sekarang membungkus panggilan itu dengan `turn()` yang mematikan opsi sesaat. Dicek Chromium mode mobile: HP miring/tegak, buku portrait & landscape: tombol → jalan; tap di tengah halaman tetap tidak membalik. Editor tidak memakai opsi itu (tidak terdampak).

### 30 September 2026 - Zoom cukup satu tombol 🔍; kaca pembesar dihapus

Owner: tidak usah kaca pembesar; klik ikon di bawah -> zoom, klik lagi -> normal. Reader: kontrol − 100% + diganti satu tombol `#zoom` (🔍 -> "🔍 200%" hijau tua `.is-zoomed` -> klik lagi 🔍 100%), `FlipbookZoom` opsi `button` sekarang toggle lewat `up()`; `STEPS` dihapus (opsi zoomOut/level/zoomIn masih didukung modul tapi tidak dipakai). Kaca pembesar dihapus total: modul `FlipbookLoupe`, tombol `#loupe` (reader + editor), CSS `.book-loupe*`, `tests/loupe.test.cjs`. Double-tap/pinch/Ctrl+wheel tetap.

### 30 September 2026 - APK ikut putar HP (tegak = 1 halaman, miring = 2 halaman)

Owner: di HP tegak otomatis satu halaman, dimiringkan otomatis landscape. APK tidak lagi dikunci landscape: `AndroidManifest.xml` `screenOrientation="fullUser"` (ikut kunci rotasi pengguna) dan `main.dart` `setPreferredOrientations([portraitUp, landscapeLeft, landscapeRight])`. `configChanges` sudah berisi orientation|screenSize, jadi WebView tidak dimuat ulang; reader memilih tata letak dari bentuk layar (`FlipbookLayout.geometry`: lebar < 700 dan tegak -> satu halaman). Belum dites di HP sungguhan (perlu build APK baru).

### 30 September 2026 - Dibacakan (read aloud) + auto balik halaman; idle mati saat membaca

Owner: fitur suara membaca isi buku, pindah halaman otomatis; saat aktif idle 3 menit dimatikan. Modul `FlipbookSpeech` (layout.js, ES2018): tombol `#speak` (🎧 Listen / ⏹ Stop) di reader ekspor dan pratinjau editor; membaca teks halaman yang tampil (field `text`, urut kiri-kanan) dipotong per kalimat ≤ 220 karakter (dot leader daftar isi dibuang), lalu `next()` membalik halaman dan `pageChanged()` (dipanggil viewer di event flip / state read) membaca halaman baru; balik manual saat membaca -> langsung membaca halaman baru; halaman tanpa teks dilewati setelah jeda 1,5 dtk; berhenti di akhir buku. Bahasa ditebak dari kata umum (id-ID / en-US). Tombol disembunyikan bila buku tanpa teks atau tak ada mesin suara. `FlipbookIdle` tidak jalan saat membaca.
Mesin suara: browser/HTML/EXE (WebView2) = Web Speech API, pilih suara yang cocok bahasa (utamakan "Google ..." / "Natural"); bila perangkat tak punya suara bahasa itu muncul pemberitahuan (reader: #zoom-hint 6 dtk; editor: #load-status). APK: WebView Android tak punya suara -> jembatan: JS `MyFlipbook.postMessage('tts:{op,id,text,lang}')` -> Dart `MethodChannel('myflipbook/tts')` -> `MainActivity.kt` (Android `TextToSpeech`, QUEUE_FLUSH, UtteranceProgressListener) -> "done" {id, ok} -> Dart `runJavaScript('window.FlipbookSpeechNative(...)')`. Manifest menambah query `android.intent.action.TTS_SERVICE` (Android 11+). Sengaja TIDAK memakai plugin flutter_tts (bagian Windows-nya butuh NuGet dan bisa merusak build EXE).
Verifikasi: tests/speech.test.cjs; E2E Edge dengan suara sungguhan (PC ini hanya punya suara en-GB lokal): toc-text.pdf dibaca hal 2 -> 3 -> otomatis 4-5 -> 6-7, Stop jalan. APK debug dikompilasi (flutter analyze bersih, assembleDebug sukses) di salinan workspace; BELUM dites di HP. PC ini tidak punya suara Indonesia (Windows: Settings > Time & language > Speech > Add voices); Chrome biasa (bukan headless) punya "Google Bahasa Indonesia".

### 30 September 2026 - Suara bacaan: perempuan, Bahasa Indonesia

Owner: pakai suara Google perempuan logat Indonesia. Web Speech (`FlipbookSpeech.engine`): untuk id-ID urutan pilihan = nama "Google" (Chrome: "Google Bahasa Indonesia", suara perempuan) -> Gadis/female/wanita (Edge: "Microsoft Gadis Online (Natural)") -> natural/online bukan laki-laki -> suara Indonesia apa pun bukan laki-laki (Ardi/Andika dihindari) -> Andika; kode bahasa lama Android "in" dikenali. APK (`MainActivity.kt woman()`): suara Google TTS Indonesia `dfz` lalu `idc` (perempuan; `idd`/`ide` laki-laki), yang terpasang/offline dulu, baru yang butuh jaringan; bahasa lain tetap default. Catatan: Windows (EXE/WebView2) hanya punya suara Indonesia "Andika" (laki-laki) — suara Google tidak tersedia di sana. Nama suara dfz/idc = perempuan berdasarkan daftar Google TTS; belum dicek di HP sungguhan. Tes: speech.test.cjs (daftar suara palsu Chrome/Edge/Windows); APK debug dikompilasi ulang sukses.

### 30 September 2026 - Dibacakan mulai dari kata yang diklik + tanda yang sedang dibaca

Owner: suara diarahkan lewat kursor: posisi kursor = mulai dibaca. Saat 🎧 Listen aktif (`body.is-reading`), kursor di halaman = ikon speaker (SVG data-URI di book-effects.css); klik kata (mouse: mousedown ditahan agar PageFlip tidak membalik; sentuh: tap diam < 400 ms, swipe tetap membalik) -> `FlipbookHighlights.locate` (strict) mencari kata -> dibaca dari kata itu lalu lanjut halaman berikut. Klik di margin tetap ke PageFlip; saat stabilo aktif (`busy()`) klik milik stabilo. Potongan yang sedang dibaca ditandai di halaman (`.book-reading` span per baris, biru tipis + garis bawah). `FlipbookSpeech` sekarang memotong per kata (`words(raw, text)` -> `pieces(words)` dengan kotak per baris; `chunks(lines)` tetap ada), bind options baru `words`, `pages`, `busy`; API `readFrom(page, line, word)`. Tes: speech.test.cjs (klik kata, tanda, margin, busy, close melepas listener); E2E Edge editor toc-text.pdf: klik kata ke-4 "1." -> dibaca "1. Lorem ipsum …", 2 tanda.

### 1 Oktober 2026 - Suara: kata berhuruf kapital tidak dieja lagi

Owner: kata kapital dibaca huruf per huruf (mesin suara menganggapnya singkatan). `FlipbookSpeech.say()` / `sayWord()` mengubah teks yang diucapkan saja (tanda/teks buku tidak berubah): kata kapital yang bisa diucapkan (NUSANTARA, PROGRAM, STRATEGI, FILM, TEKS, YANG) -> huruf awal kapital; singkatan tetap (tanpa vokal: PDF/DPRD/MPR; 3 konsonan beruntun setelah gugus umum STR/NG/NGK/...: UMKM; ≤4 huruf berakhiran 2 konsonan tak lazim: BUMN; ada angka: JKT2A; ≤3 huruf di kalimat biasa: AI/DKI). Judul yang > 80% kapital dibaca seperti kalimat (DAN, DI juga jadi kata). Dipakai di `pieces()` (semua bacaan). Tes di speech.test.cjs. Heuristik — bisa salah untuk singkatan yang kebetulan bisa diucapkan (mis. "NASA" -> "Nasa", tetap wajar).

### 1 Oktober 2026 - Suara bacaan juga Bahasa Inggris dan Melayu (perempuan)

Owner: sekalian versi Inggris dan Malaysia. `FlipbookSpeech.lang()` sekarang id-ID / ms-MY / en-US: kata umum Melayu-Indonesia vs Inggris, lalu kata khas (ms: ialah, iaitu, kerana, sahaja, boleh, kerajaan, anda, ...; id: adalah, karena, saja, bisa, yaitu, pemerintah, ...). Pilihan suara web (utamakan perempuan): "Google" bukan Male (Chrome: Google US English, Google Bahasa Indonesia) -> nama perempuan (Gadis, Yasmin, Aria, Jenny, Zira, Hazel, Susan, ...) -> natural/online bukan laki-laki -> bukan laki-laki -> apa saja; Melayu tanpa suara Melayu (Chrome tidak punya) -> suara Indonesia; `u.lang` mengikuti suara yang dipakai. Pemberitahuan "No <bahasa> voice" per bahasa. APK (`MainActivity.kt`): ms tidak terpasang -> id-ID -> default; suara perempuan Google TTS per bahasa (id dfz/idc; en-US tpc/iob/iog/tpf/sfg; nama Malay mfc/msa/msb = tebakan, belum dicek di HP). Tes speech.test.cjs; Edge di PC ini memilih Hazel (perempuan) untuk Inggris; APK debug dikompilasi sukses.

### 1 Oktober 2026 - Podcast "Ngobrol Buku" (2 penyiar, naskah AI Claude via Sumopod)

Owner memilih Claude untuk naskah (dibandingkan dengan Gemini pada storyline NTT: Claude lebih santai & setia dokumen). Alur:
- Server `POST /api/podcast/script` (gate seperti ekspor: paket Pro/Business saat paywall; token sesi `X-Build-Token`): body {title, text: {page: [lines]}, lang, hosts}; teks diurutkan per halaman, dipotong 120.000 karakter; < 40 kata -> 400 (scan, OCR dulu). `podcast_script()` memanggil Sumopod (OpenAI-compatible) `SUMOPOD_BASE_URL/chat/completions` dengan `PODCAST_MODEL` (default claude-sonnet-5), prompt: RINA (perempuan) & BIMA (laki-laki), 650-750 kata, hanya fakta dokumen, angka ditulis sebagai kata; balasan kosong dicoba ulang sekali; markdown ** dibuang; hasil {lines:[{s:'A'|'B',t}], hosts, lang, model}. Error -> 502 dengan pesan jelas (key belum diatur / ditolak / tidak terhubung). Key hanya di `.env` server (SUMOPOD_API_KEY, SUMOPOD_BASE_URL, PODCAST_MODEL, PODCAST_MODEL_2).
- Data buku: field opsional `podcast` {lines, hosts, lang} divalidasi (`validPodcast` di flipbook-export.js, `validate_podcast` di server.py; maks 400 baris × 2000 karakter), ikut proyek/Arsipku/semua ekspor (tersegel).
- Editor (panel ekspor): "🎙 Buat podcast (AI)" -> naskah di textarea (format "RINA: …"), bisa diedit (disimpan otomatis, `FlipbookPodcast.parse`), ▶ Dengar, Hapus podcast; buat ulang minta konfirmasi.
- Reader + pratinjau: tombol `#podcast` (🎙 Podcast, tersembunyi tanpa naskah) -> panel transkrip (`.book-podcast`): ▶/⏸, ✕, baris yang sedang diucapkan ditandai & di-scroll, klik baris = putar dari situ. Suara perangkat: penyiar A perempuan, B laki-laki (`engine.speak(..., gender)`: web pilih suara laki-laki (Ardi/Andika/Google UK Male) atau suara perempuan dengan pitch 0.7; APK Kotlin `men` id idd/ide, en iol/iom/tpd, else pitch 0.75). Podcast menghentikan 🎧 Listen dan sebaliknya; idle mati saat podcast diputar. Teks diucapkan lewat `FlipbookSpeech.say` (kapital tidak dieja).
Tes: tests/podcast.test.cjs, tests/test_podcast.py (AI palsu, tanpa biaya); APK debug dikompilasi. E2E asli belum selesai: Sumopod membalas 401 "Key is blocked" (kemungkinan credit limit key habis) -> owner perlu cek/naikkan limit di dashboard Sumopod. Suara AI natural (Azure Gadis/Ardi, MP3 di buku) = tahap berikutnya, belum dibuat.

### 1 Oktober 2026 - Podcast dites dengan AI sungguhan + perbaikan deteksi Melayu

Key Sumopod aktif lagi. E2E (Edge, server --no-paywall): storyline NTT -> "Buat podcast" 30 dtk, 35 giliran bahasa Indonesia; diputar di pratinjau editor dan di HTML satu-file tersegel (teks naskah tidak terbaca polos di file); Bima memakai pitch 0.7 karena PC ini tak punya suara laki-laki. Naskah contoh disalin ke Downloads ("Naskah Podcast NTT - dari editor.txt").
Bug diperbaiki: dokumen NTT terdeteksi Melayu sehingga naskah berbahasa Melayu. `FlipbookSpeech.lang` kini memakai penanda Melayu yang hampir tak dipakai bahasa Indonesia (iaitu, kerana, sahaja, berbeza, kakitangan, mesyuarat, percuma, sila, wang, sebarang) dan memilih ms-MY hanya bila ≥ 3 penanda dan > 2× penanda Indonesia. Server 8080 direstart agar /api/podcast/script aktif.

### 1 Oktober 2026 - Podcast dinamai judul buku

Owner: salam pembuka harus menyebut judul buku, bukan "Ngobrol Buku dari MyFlipbook". `podcast_prompt(lang, hosts, title)`: nama podcast = judul buku (kolom Book title); kalimat pertama Rina "Halo, selamat datang di podcast <judul>!", dilarang menyebut "Ngobrol Buku"/"MyFlipbook"; penutup menyebut judul lagi. Petunjuk di editor: isi Book title dulu. Dicek dengan AI sungguhan (NTT, 28 giliran). Suara natural + Bima laki-laki: suara perangkat tidak cukup (PC/Chrome tanpa suara laki-laki Indonesia) -> perlu TTS neural (MP3 di buku); key Sumopod hanya melihat 2 model yang dicentang, jadi belum diketahui apakah Sumopod punya model TTS.

### 1 Oktober 2026 - Listen menunggu kata diklik (tidak bunyi sendiri / menumpuk)

Owner: setelah klik 🎧 Listen jangan langsung bersuara, tunggu kata diklik, supaya tidak numpuk. `FlipbookSpeech`: tombol Listen sekarang `arm()` = mode baca aktif (kursor speaker, tombol ⏹ Stop, petunjuk "Click (or tap) a word on the page: reading starts there." lewat `notice`), diam; klik/tap kata -> `start(at)` membaca dari kata itu lalu lanjut + balik halaman seperti biasa; balik halaman manual saat hanya "armed" tidak memulai suara (`pageChanged` butuh `speaking`). API: `arm()`, `speaking()`, `start()` (programatik = dari atas). Web engine: `synth.cancel()` bila masih ada suara/antrian sebelum potongan baru (tidak pernah dua suara). E2E Edge: setelah Listen 0 ucapan; klik kata -> membaca; klik kata lain -> pindah, pending kosong.

### 1 Oktober 2026 - Terjemahan buku (AI) + panel 🌐 Translate

Owner: buku bahasa Inggris -> fitur translate. Editor (panel ekspor): "🌐 Terjemahkan (AI)" + pilihan tujuan (→ Indonesia / English / Melayu; default: buku Inggris -> Indonesia, lainnya -> English). Teks tiap halaman (baris PDF digabung jadi paragraf: `paragraphs()`), dikirim per ~8.000 karakter / 12 halaman ke server `POST /api/translate` {pages, target, title} (gate Pro/Business + token; maks 40 halaman / 30.000 karakter per permintaan) -> `translate_pages()` (AI via Sumopod, model `TRANSLATE_MODEL` atau `PODCAST_MODEL`; balasan JSON {halaman: terjemahan}, blok ```json dibersihkan, hanya halaman yang diminta, coba ulang sekali). Tombol jadi "⏹ Berhenti" saat berjalan; halaman yang sudah jadi disimpan, klik lagi = lanjutkan; "Terjemahkan ulang" minta konfirmasi; "Hapus terjemahan" per bahasa. Data buku: `translations` {lang: {page: text}} divalidasi (`validTranslations` / `validate_translations`), ikut proyek/Arsipku/semua ekspor (tersegel).
Reader + pratinjau: tombol `#translate` (🌐 Translate, tersembunyi tanpa terjemahan) -> panel kanan (`.book-translate`; bottom sheet di HP ≤640px) berisi terjemahan halaman yang tampil, ikut balik halaman, pilihan bahasa bila > 1. Server: helper `ai_chat()` dipakai bersama podcast. Tes: tests/translate.test.cjs, TranslateTests di tests/test_podcast.py; E2E AI sungguhan: cerita Inggris 1 halaman -> Indonesia 11 dtk ("The Little Library" -> "Perpustakaan Kecil").

### 1 Oktober 2026 - Ringkasan buku (AI) + panel 📋 Summary

Owner: fasilitas ringkasan (model teks Sumopod cukup; tak perlu TTS). Server `POST /api/summary` {title, text: {page: [lines]}, lang} (gate Pro/Business + token; helper `book_text()` dipakai bersama podcast) -> `summarize_book()`: model `SUMMARY_MODEL` atau `PODCAST_MODEL`; format "Intisari" (2-4 kalimat) + "Poin penting" (5-8 butir "- "), judul bagian ikut bahasa (en: Overview / Key points; ms: Intisari / Perkara penting), setia isi, markdown ** dibuang, jawaban < 30 kata dicoba ulang; buku > 72.000 karakter diringkas per bagian 60.000 karakter (maks 12) lalu digabung. Data buku `summary` {lang, text} divalidasi (`validSummary` / `validate_summary`), ikut proyek/Arsipku/ekspor (tersegel).
Editor: "📝 Buat ringkasan (AI)" + bahasa (Bahasa buku / Indonesia / English / Melayu), textarea bisa diedit (tersimpan otomatis), "Hapus ringkasan". Reader + pratinjau: tombol `#summary` (📋 Summary, tersembunyi tanpa ringkasan) -> panel kanan (gaya panel terjemahan; `FlipbookSummary.blocks()` = judul / paragraf / daftar butir, semua textContent). Tes: translate.test.cjs (panel + validasi), SummaryTests di test_podcast.py (satu panggilan, bagian-bagian, route). E2E AI: storyline NTT diringkas 10 dtk.

### 1 Oktober 2026 - Podcast buku tebal membahas SELURUH buku (bukan hanya bab 1)

Owner: podcast novel "Perahu Kertas" hanya membahas bab 1. Sebab: `podcast_script` memotong teks ke 120.000 karakter pertama. Sekarang buku > `PODCAST_MAX_SOURCE` diubah dulu jadi catatan per bagian oleh `book_notes()` (bagian ≥ 60.000 karakter, maks `BOOK_PARTS` = 24 bagian — bagian membesar untuk buku sangat tebal; 4 panggilan AI paralel via ThreadPoolExecutor; model catatan `SUMMARY_MODEL` bila diisi, else `PODCAST_MODEL`), lalu naskah ditulis dari catatan itu dengan instruksi membahas awal-tengah-akhir secara seimbang dan panjang 1000-1200 kata (~8 menit). `summarize_book` memakai `book_notes()` yang sama (dulu maks 12 bagian dan catatan dipotong). Tes: `test_long_book_covers_every_part` (10 bab ~300 rb karakter: semua bab sampai ke AI, naskah dari catatan bab 1-10). Perkiraan biaya novel ±400 halaman dengan Claude: ±Rp8.000-10.000 per podcast (lebih murah bila SUMMARY_MODEL = Gemini Flash). Belum dites dengan novel sungguhan.

### 1 Oktober 2026 - Tata letak tombol AI di editor dirapikan

Owner: baris Terjemahkan/Ringkasan berantakan di panel sempit. Sekarang pilihan bahasa di atas (`label.ai-lang`: "Terjemahkan ke" / "Bahasa ringkasan" + select tinggi 34px), tombol lebar penuh di bawahnya (sama seperti tombol podcast). Opsi "Bahasa buku" -> "Ikut buku". Bug lama: `.podcast-tools{display:flex}` mengalahkan atribut hidden sehingga "▶ Dengar / Hapus podcast" tampil tanpa podcast; ditambah `.podcast-tools[hidden]{display:none}`. Dicek Chromium 1280 dan 390 px.

### 1 Oktober 2026 - Kartu catatan: posisi di samping tab + bisa diperbesar

Owner: kartu catatan muncul di pojok kiri atas layar, dan minta bisa dilebarkan/ditarik ke bawah. Bug: `read()` mengukur tab yang diklik setelah `closeReader()`/`tabs()` menggambar ulang tumpukan tab (elemen lama terlepas -> rect 0,0). Sekarang tab diukur setelah digambar ulang (`querySelectorAll('.book-note-tab.has-note')[item]`), fallback ke kanan layar bila tak terukur. Kartu kini flex kolom (min 220×130, maks layar), teks scroll di dalam; gagang ◢ `.book-note-grip` di pojok kanan bawah (pointer events + setPointerCapture: mouse dan jari) mengubah lebar/tinggi; ukuran terakhir disimpan di localStorage `mf-note-card` dan dipakai saat kartu dibuka lagi (default lebar 320). E2E Chromium: klik tab 1 lalu tab 2 -> kartu di samping tab 2; tarik gagang 320×130 -> 440×310, dibuka lagi tetap 440×310.

### 1 Oktober 2026 - Zoom 🔍 juga di pratinjau editor (web)

Owner: di web fitur zoom hilang. Sebab: di editor satu-satunya zoom dulu kaca pembesar 🔎 (dihapus atas permintaan owner); tombol 🔍 baru hanya dipasang di reader ekspor. Sekarang editor punya `#zoom` (setelah →): `FlipbookZoom.bind($('#reader-stage'), zoomBox, {button, content})` dipasang sekali; `zoomBox` (`#pdf-zoom`, 100%×100%) membungkus `#pdf-book` sehingga transform zoom tidak bentrok dengan transform buku (centerCover/curl) dan tetap satu wrapper saat PDF lain dibuka. Klik 🔍 = 200%, klik lagi = 100%; double-tap/pinch/Ctrl+wheel/geser seperti reader; reset saat flip, ←/→/Home, dan buka PDF baru. CSS di theme-cream.css. E2E Chromium: 🔍 -> 200% -> 100%, reset setelah balik halaman, PDF kedua tetap 1 wrapper.

### 1 Oktober 2026 - Cari Jurnal (seperti SINTA, beri link) + "Jadikan Flipbook"

Owner: search engine jurnal seperti SINTA (memberi link), Indonesia + internasional (Google Scholar/Scopus). Halaman baru `journals.html` (di PAGES; chip "🔎 Journals / Cari Jurnal" di nav beranda, i18n `nav.journals`): kata kunci + filter (hanya open access [default], penulis dari Indonesia, bahasa id/en/ms, rentang tahun, urutan relevan/kutipan/terbaru), hasil 20 per halaman + "Muat lebih banyak", URL ?q=… bisa dibagikan. Kartu: judul (link), penulis, tahun, jurnal, badge OA/tertutup, lisensi, kutipan, bahasa, abstrak (3 baris + Selengkapnya), tombol 🔗 Buka artikel, 📄 PDF dan 📖 Jadikan Flipbook (hanya bila ada PDF open access) -> `flipbook.html?link=<pdf>&title=<judul>` (editor mengisi dialog Add file → link, `/api/fetch-source`, judul buku = judul artikel). Link "Cari juga di: Google Scholar · Scopus · Garuda" (hanya tautan pencarian; Google Scholar tak punya API dan melarang scraping, Scopus API butuh langganan institusi).
Server `GET /api/journals?q=&page=&oa=&from=&to=&lang=&id=&sort=` -> `journal_search()` memakai OpenAlex `/works` dengan filter `title_and_abstract.search` (pencarian full text terlalu melebar), `type:article|review`, OA, tahun, bahasa, `institutions.country_code:id`; abstrak dibangun dari inverted index (`abstract_text`), cache 30 menit (maks 300 entri). OpenAlex sekarang berbatas: tanpa key ±$0,10/hari ≈ 100 pencarian (header X-RateLimit-*); 429 -> pesan jelas. `.env` opsional: OPENALEX_API_KEY, OPENALEX_MAILTO. Tes: tests/test_journals.py; E2E: "filsafat jawa" 173 hasil, artikel UNIMED -> flipbook 11 halaman.

### 1 Oktober 2026 - Cari Jurnal: kata persis (tanpa stemming) + penulis tanpa duplikat

Uji "immersive" (owner): pencarian ber-stemming juga menemukan "immersed/immersion" (fisika, kimia, "water immersion"). Sekarang filter `title_and_abstract.search.exact` (nama OpenAlex untuk tanpa stemming; `.no_stem` ditolak 400). Hasil: internasional 38.977 artikel OA (VR imersif di pendidikan, metaverse, presence — Computers & Education, IEEE Access, Nature Rev. Neurosci.), penulis Indonesia 2.160 (AR/VR pendidikan, teknologi imersif pariwisata, metaverse), 12-17 dari 20 teratas bisa jadi flipbook. Nama penulis yang diulang OpenAlex dibuang (`dict.fromkeys`).

### 1 Oktober 2026 - Kartu "Journal Search" di beranda

Owner: menu kartu jurnal belum ada (hanya chip nav, dan chip itu tersembunyi di HP). Ditambah tool `journal-search` di daftar `tools` index.html (🔎, badge New!, kategori Workflows + PDF Intelligence, href journals.html, feat) dan di baris pertama ikon hero (HORDE_ROWS), deskripsi Indonesia `tool.journal-search` di i18n.js. Dicek desktop 1280 & HP 390: kartu dan ikon hero tampil, terjemahan ID jalan.

### 1 Oktober 2026 - Listen tidak lagi berhenti sendiri

Owner: Listen tiba-tiba diam padahal tombol masih ⏹ Stop. Tiga penyebab, semua diperbaiki di `FlipbookSpeech`:
1. Web engine: suara Google online di Chrome diam setelah ±15 dtk dan kadang tak mengirim `onend` -> kini untuk suara non-lokal (`localService === false`) ada nudge `pause()/resume()` tiap 10 dtk, dan watchdog (8 dtk + 150 ms/karakter, lalu cek tiap 3 dtk): bila tak ada yang bersuara lagi, potongan dianggap selesai. Timer dibersihkan saat stop/potongan baru.
2. Potongan gagal (jaringan/mesin sibuk) dulu langsung `stop()`; kini dicoba sekali lagi lalu dilewati, baru berhenti (dengan pemberitahuan) setelah 4 gagal berturut-turut.
3. Halaman yang tidak jadi berbalik (buku sibuk) dulu ditunggu selamanya; kini dicek tiap 3 dtk: bila halaman sudah berganti tanpa event -> baca; bila belum -> `next()` lagi (maks 3x), lalu berhenti dengan pemberitahuan.
Tes: speech.test.cjs (hiccup, halaman tak berbalik, suara tanpa onend). E2E Edge 45 dtk: membaca terus, 2-3 -> 4-5 -> 6-7. APK (Kotlin onError -> ok=false) ikut mekanisme coba-ulang yang sama.

### 1 Oktober 2026 - Listen melewati header/footer & nomor halaman; HTTPS jurnal lewat sertifikat OS

Owner: header jurnal (JUPITER, ISSN, Volume…) dan nomor halaman jangan dibaca. `FlipbookSpeech.furniture(words, text)`: baris di tepi atas (<12%) / bawah (>88%) halaman yang (a) hanya nomor halaman (angka/romawi, "Halaman 3", "3 / 10") atau (b) teksnya berulang di ≥ 3 halaman (≥ 2 bila buku ≤ 4 halaman), dengan angka dianggap sama -> dilewati saat Listen (`wordsOf` memfilter). Teks buku, stabilo, terjemahan tidak berubah. Uji artikel JUPITER UNIPMA 7 hlm: nomor halaman, baris ISSN/judul jurnal, Volume, e-mail dilewati di tiap halaman; bacaan mulai dari isi.
Ditemukan saat uji: "Jadikan Flipbook" gagal untuk e-journal.unipma.ac.id karena rantai sertifikat tak lengkap (Python: "unable to get local issuer certificate"; curl/browser OK). server.py kini memakai `truststore` bila terpasang (`truststore.inject_into_ssl()`: verifikasi HTTPS memakai penyimpanan sertifikat OS, yang mengambil intermediate yang hilang; verifikasi tetap aktif). Dependensi opsional baru: `pip install truststore` (sudah dipasang di PC ini, versi 0.10.4); tanpa itu perilaku lama.

### 1 Oktober 2026 - Catatan dari stabilo: daftar bullet tetap daftar

Owner: bullet item di catatan pinggir jangan digabung jadi kalimat. `FlipbookHighlights.quote()` kini menyambung baris dengan spasi, KECUALI baris yang diawali butir daftar (`item()`: •, ●, ▪, ■, ◆, ➢, ➤, ►, ✓, ·, -, –, *, bullet font Wingdings/Symbol U+F000–F0FF, atau nomor 1. 2) a. b) i.) -> baris baru; bullet distandarkan jadi "• ". `FlipbookHighlights.tidy()` (rapikan spasi, pertahankan baris baru) dipakai bersama oleh notes.quote/unquote/tint dan highlights.forget agar kutipan tetap cocok. Kartu dan daftar My notes sudah `pre-wrap`. Tes di highlight-notes.test.cjs; E2E NTT "Creative Direction": "Visual Style: • Premium … • Immersive" tampil per baris.

### 1 Oktober 2026 - Podcast, Ringkasan, Terjemahan pindah ke Notebook PDF

Owner: fitur podcast, ringkasan, translate masuk kartu Notebook PDF, jangan jadi satu di flipbook. 
- `notebook.html` ditulis ulang (prototipe lama: Tailwind CDN, kunci Gemini ditempel pengguna, model lama — ada di git sebelum commit ini, terakhir b7379ea). Halaman baru bergaya clay: upload/seret PDF (atau `notebook.html?link=<pdf>&title=` lewat /api/fetch-source), teks dibaca dengan PdfWords (withText), info halaman/kata/bahasa; tiga kartu: 📝 Ringkasan (bahasa: ikut dokumen/ID/EN/MS, salin, unduh .txt), 🌐 Terjemahan (tujuan default: Inggris->Indonesia, lainnya->English; per ~8.000 karakter/12 halaman, ⏹ Berhenti/Lanjutkan, navigasi ← halaman →, unduh .txt), 🎙 Podcast (naskah AI bisa diedit, 🎙 Putar = panel FlipbookPodcast dengan suara perangkat, unduh .txt); "📖 Jadikan Flipbook" (FlipbookTransfer -> flipbook.html?source=). Memakai endpoint server yang sama (/api/summary, /api/translate, /api/podcast/script; Pro/Business). Hasil tidak disimpan server.
- Editor flipbook: kotak Buat podcast / Terjemahkan / Buat ringkasan dan kodenya dihapus. Proyek lama yang sudah membawa podcast/translations/summary tetap memutarnya di pratinjau dan ekspor (tombol muncul hanya bila datanya ada).
- Notebook dirilis: dihapus dari `SOON_PAGES` (server) dan set SOON (index); chip nav "✦ Notebook AI" jadi tautan; deskripsi kartu EN/ID diperbarui. test_accounts disesuaikan. E2E (server --no-paywall, PDF NTT 11 hlm): ringkasan, terjemahan English 11 hlm, podcast 39 giliran — dijalankan berurutan cepat, semua selesai ±30 dtk; Jadikan Flipbook -> editor 11 halaman; editor tanpa tombol AI.

### 1 Oktober 2026 - Login Google + verifikasi email

Owner: login pakai Google + verifikasi; akun belum terverifikasi TIDAK boleh login; nama pengirim email "MyFlipbook"; akun pengirim/Google Cloud: sarvamayahybrid@gmail.com.
- accounts.py: kolom `users.verified` (migrasi DEFAULT 1 -> akun lama tetap terverifikasi) dan `users.google_sub` (unique), tabel `email_tokens` (hash, 48 jam, satu token aktif per akun). `register_unverified()` (daftar ulang sebelum verifikasi = ganti password + link baru), `verify_email()` (sekali pakai -> sesi), `resend_verification()` (throttle 5/15 menit, tak membocorkan email terdaftar), `google_login(sub, email, name)` (akun Google sama -> email sama: ditautkan + verified -> akun baru verified). `login()` -> 403 bila belum verified. `public_user` menambah `verified`, `google`.
- server.py: `CONFIG['verify_email']` (aktif saat server dijalankan; `--no-email-verify` untuk internal/tes; nonaktif saat diimpor tes lama). `POST /api/auth/register` -> 201 {verify, email, outbox} tanpa sesi + email link `/api/auth/verify?token=` (GET: sesi + 302 ke account.html?verified=1, gagal -> login.html?verify=failed). `POST /api/auth/resend`, `POST /api/auth/google` {credential}: ID token Google diperiksa via oauth2.googleapis.com/tokeninfo (aud = GOOGLE_CLIENT_ID, iss Google, exp, email_verified). `/api/auth/me` mengembalikan `googleClientId`. `send_mail()` SMTP (587 STARTTLS / 465 SSL), From = "MyFlipbook <MAIL_FROM>", teks + HTML; tanpa SMTP_HOST -> .data/outbox/*.eml + console.
- login.html: tombol GIS "Lanjutkan dengan Google" (hanya bila client id ada), layar "Cek emailmu" + Kirim ulang, tombol kirim ulang saat login 403, pesan link gagal; i18n EN/ID. account.html: notice "Email terverifikasi".
- .env (tidak di git): MAIL_FROM, MAIL_FROM_NAME, SMTP_HOST (kosong), SMTP_PORT, SMTP_USER, SMTP_PASS (kosong), GOOGLE_CLIENT_ID (kosong) — owner perlu mengisi App Password Gmail dan Client ID. Catatan: Google Sign-In hanya jalan di origin terdaftar (https atau http://localhost); http://192.168.18.16:8080 (IP LAN) tidak bisa didaftarkan Google.
Tes: tests/test_verify.py (alur daftar->email->verify, akun lama, Google: tautan/baru/ditolak/503); UI login dites Chromium dengan API tiruan.

### 1 Oktober 2026 - Judul putih di atas halaman dihapus dari buku ekspor

Owner: teks putih nama file di tengah atas buku hasil ekspor dibuang. Template reader `assets/export/index.html`: `<h1 id="title">` dihapus dari `<header>` (tinggal merek kecil "MYFLIPBOOK"); `viewer.js` hanya mengisi `document.title` (judul tab/jendela). Berlaku untuk HTML, APK, EXE berikutnya.

### 1 Oktober 2026 - Split PDF: semua halaman tampil (thumbnail asli) + baca dulu sebelum centang

Owner: halaman PDF harus tampil semua agar bisa dibaca dulu lalu dicentang. converter.html (split-pdf): mode baru default & pertama "☑️ Pilih halaman" (menggantikan "Pick manually"); grid `#splitGrid` tampil untuk semua mode setelah PDF dipilih, berisi thumbnail asli pdf.js (digambar malas lewat IntersectionObserver, root grid, margin 300px; aman ganti PDF di tengah); klik gambar -> penampil besar `#splitViewer` (← → / panah keyboard, Esc, "Pilih halaman ini"); centang halaman otomatis pindah ke mode Pilih halaman; awalnya tidak ada yang dicentang (tombol: "Centang halaman dulu" / "Ambil N halaman terpilih →"); mode rentang menandai halaman yang terkena rentang di grid. E2E Chromium (PDF NTT 11 hlm): 11 thumbnail, penampil 1280×720, pilih hal 3, 4 (lewat penampil) dan 8 -> PDF hasil 3 halaman benar. qa-converter tetap lulus.

### 1 Oktober 2026 - PDF -> PowerPoint: foto jadi gambar terpisah, gaya campuran sebaris, titik dua tidak hilang

Owner minta PDF to PPT dikembangkan. Temuan uji (ntt.pdf, storyboard.pdf) + perbaikan di `assets/pdf-layout.js` dan `converter.html`:
- Foto sebelumnya ikut gambar latar satu slide penuh (tidak bisa dipindah/diganti). Sekarang `PdfLayout.layoutPage(page, {images:true})` (hanya dipakai PDF->PPT) menyalin tiap gambar yang digambar pdf.js (drawImage 9 argumen, tidak diputar, >= 24 pt, globalAlpha 1, source-over) beserta piksel di bawahnya. Setelah render, gambar hanya diangkat bila halaman jadi masih menampilkannya utuh (beda piksel > 48 di <= 3% piksel padat) — gambar yang tertutup bentuk lain atau di-clip (bulat/segitiga) tetap di latar, jadi slide selalu sama dengan halaman. Tempatnya di latar diisi kembali dengan apa yang ada di bawahnya. Hasil `layout.images = [{x,y,w,h,type:'jpeg'|'png',b64}]` (pt; png bila ada transparansi di dalam gambar). Di PPT: `slide.addImage` di atas latar, di bawah teks, altText "Picture N".
- Gaya campuran sebaris ("**Objective**: ...") dulu jadi satu gaya (bold = AND). `mergeRuns` kini juga mengisi `line.parts = [{text,bold,italic,color,font}]` (potongan sama gaya digabung, spasi dirapikan sama dengan `line.text`). PPT memakai array teks PptxGenJS bila parts > 1; Word mode tata letak memakai satu TextRun per part (perbaikan yang sama, sisanya tidak berubah).
- Titik dua hilang ("Objective:" -> "Objective"): glyph ":" yang menempel di ujung run sebelumnya dicocokkan ke run itu, sehingga ":" tidak masuk teks maupun latar. `match()` kini memilih run yang mulainya paling dekat di kiri glyph.
- PptxGenJS 4.0.1 menulis `<a:pPr>` sebelum tiap run dalam satu paragraf (XML tidak valid, PowerPoint minta repair). `fixPptxParagraphs()` (JSZip) membuang pPr selain yang pertama, lalu zip dikompres DEFLATE (ntt 373 KB -> 59 KB).
- Catatan: "teks reguler tampil tebal" pada pratinjau LibreOffice bukan bug — XML benar (b hanya di OpenSans-BoldItalic); LibreOffice di mesin ini tidak punya font Open Sans. PowerPoint di komputer tanpa font itu juga akan mengganti font.
Hasil: storyboard 13 slide, foto Raja Ampat/Bromo/Toba dll jadi gambar terpisah; ntt 11 slide, "Objective:" bold + ":" reguler. Round-trip LibreOffice -> tampilan sama dengan PDF.
Tes: tests/office-export.test.cjs — mergeRuns parts; PDF buatan pdf-lib (gambar bebas / tertutup kotak / di-clip segitiga + "Objective" bold + ": Hero video" reguler): tepat 1 gambar diangkat di posisi benar, titik dua ada, parts benar, layout Word tanpa `images`, slide punya 2 `<p:pic>` dan paragraf campuran hanya 1 `<a:pPr>`. Shim tes: drawImage canvas DOM -> canvas native, `w.JSZip`.

### 1 Oktober 2026 - Journal & Ebook Search: tab Ebook (OAPEN + Internet Archive)

Owner: kartu "Journal Search" ditambah pencarian ebook. Kartu beranda kini "Journal & Ebook Search" (index.html + i18n `tool.journal-search`, chip nav "Jurnal & Ebook").
- journals.html: tab **📄 Jurnal | 📚 Ebook** (`?type=ebook` di URL, tautan bisa dibagikan). Tab Ebook: filter Bahasa (id/en/ms) + Sumber (Semua/OAPEN/Internet Archive); kartu buku dengan sampul, sumber, lisensi, bahasa, jumlah halaman, abstrak; tombol "📖 Jadikan Flipbook" (-> flipbook.html?link=&title=, sama seperti jurnal), "📄 PDF", "🔗 Halaman buku". PDF > 60 MB (FETCH_MAX_BYTES) -> pesan, hanya unduh.
- Sumber (gratis & legal, tanpa key): **OAPEN Library** (buku akademik open access, lisensi diperiksa OAPEN) dan **Internet Archive** (hanya `licenseurl:*` CC/domain publik, tanpa `access-restricted-item` = buku pinjaman tidak tampil, harus ada PDF). Lisensi IA adalah klaim pengunggah -> badge kuning "menurut pengunggah" + catatan di halaman. Google Books tidak dipakai (kuota tanpa key = 0); DOAB tidak dipakai (lambat, tanpa PDF langsung); Gutendex tidak menjawab saat dites.
- server.py: `GET /api/ebooks?q=&page=&lang=&src=all|oapen|archive` -> `ebook_search()` (kedua sumber paralel, hasil diselang-seling, satu sumber gagal -> tetap jalan + `errors`; cache 30 menit bareng JOURNAL_CACHE). Kata kunci dibersihkan dari sintaks pencarian (`ebook_terms`). OAPEN `expand=metadata` saja (dengan bitstreams 24 dtk vs ~4 dtk); OAPEN mengabaikan filter bahasa -> disaring di server. `GET /api/ebooks/pdf?src=&id=` -> `ebook_pdf()` mencari PDF saat tombol diklik (OAPEN `/rest/handle/{handle}?expand=bitstreams` ~2 dtk; IA `/metadata/{id}/files` ~0.6 dtk, urutan Text PDF > Additional Text PDF > Image Container PDF). Id divalidasi (OAPEN `20.500.12657/<angka>`, IA `[A-Za-z0-9._-]`) -> 400 bila aneh.
Tes: tests/test_ebooks.py (query bersih, expand metadata, filter IA, selang-seling, filter bahasa OAPEN, satu sumber mati, dua-duanya mati, lookup PDF OAPEN/IA, id ditolak, route 400/200/404). E2E Chromium (sumber asli): tab Jurnal tetap jalan; tab Ebook "immersive learning" 20 buku ~4 dtk; "kitab pararaton" (Indonesia) -> Jadikan Flipbook -> 59 halaman terbuka, judul terisi.

### 1 Oktober 2026 - "Add file" -> "Add source" + Google Drive Picker beneran

Owner: tombol "＋ Add file" diganti "＋ Add source"; tombol Google Drive belum berfungsi (sebelumnya hanya membuka tab Drive + panduan tempel link share).
- Modul baru `assets/drive-picker.js` (`DrivePicker.preload/pick/download`): Google Identity Services token client dengan scope **drive.file** (aplikasi hanya dapat file yang dipilih pembaca, tanpa verifikasi Google), Google Picker (DocsView PDF/Office/gambar/Google Docs-Sheets-Slides + tab Upload), unduhan di browser lewat Drive API v3: Google Docs/Sheets/Slides -> `files/{id}/export?mimeType=application/pdf`, lainnya `?alt=media`. Token dipakai ulang sampai kedaluwarsa (401 -> login lagi berikutnya). Ekspor terlalu besar (403) -> pesan jelas. Jenis file pakai mimeType Drive (unduhan sering application/octet-stream).
- flipbook.js: saat dialog Add source dibuka -> `loadDriveConfig()` (dari `/api/capabilities`.drive) + preload skrip Google, agar pop-up login muncul langsung dari klik. Klik Drive: bila dikonfigurasi -> `fromDrive()` -> `openSources([file])`, judul buku = nama file; bila belum -> perilaku lama (buka Drive + langkah tempel link).
- server.py: `drive_picker_config()` -> `{clientId, apiKey, appId}` hanya bila GOOGLE_CLIENT_ID **dan** GOOGLE_API_KEY terisi; appId = nomor project (awalan angka client id) kecuali GOOGLE_APP_ID diisi. Ditambahkan ke `/api/capabilities` sebagai `drive`.
- .env: baris kosong `GOOGLE_API_KEY=` ditambahkan (tidak di git).
**Owner perlu (Google Cloud, project yang sama dengan Login Google):** aktifkan **Google Picker API** + **Google Drive API**; buat **API key** (batasi: HTTP referrer domain MyFlipbook + API Picker) -> `GOOGLE_API_KEY`; OAuth client (GOOGLE_CLIENT_ID) dengan Authorized JavaScript origins (http://localhost:8080 / domain https); layar persetujuan OAuth tambahkan scope `drive.file`. Restart server. Catatan: seperti Login Google, tidak jalan dari IP LAN (http://192.168...).
Tes: tests/drive-picker.test.cjs (skrip sekali, scope drive.file, token dipakai ulang, Docs -> PDF, PDF apa adanya, batal, ekspor terlalu besar, 401 login ulang), tests/test_drive.py (config + /api/capabilities). E2E Chromium (skrip Google di-stub): tombol "＋ Add source"; tanpa key -> tab Drive + panduan; dengan key -> Picker -> Slides diekspor PDF -> 11 halaman terbuka, judul "Storyboard NTT".

### 1 Oktober 2026 - Bug: login Google "sukses" tapi tetap "Log in" (cookie g_state) + badge Terverifikasi

Owner: setelah login Google halaman masih "Log in" dan tidak ada tanda verified. Akun `sarvamayahybrid@gmail.com` sebenarnya terbuat (verified=1, google) dan sesi tersimpan. Penyebab: tombol Google Identity Services memasang cookie `g_state={"i_l":0,...}` di situs kita; `SimpleCookie` Python membuang **seluruh** header Cookie (tanpa error) bila ada satu cookie yang tidak disukainya, sehingga `mf_session` tak terbaca dan semua orang yang pernah membuka halaman login dengan tombol Google tampak keluar.
- server.py `session_token()`: header Cookie dibaca manual (split `;`), hanya `mf_session` dengan format token `[A-Za-z0-9_-]{20,200}`; import SimpleCookie/CookieError dihapus.
- account.html: badge permanen di samping email — "✓ Terverifikasi · Google" / "✓ Terverifikasi" / "Belum terverifikasi" (ID/EN). assets/auth.js: chip nav diawali "✓" untuk akun terverifikasi + title email · terverifikasi (i18n `auth.verified`).
Tes: tests/test_verify.py `test_google_cookie_does_not_sign_out` (g_state di depan/belakang, cookie lain ber-spasi; token rusak/pendek -> tidak login) — gagal tanpa perbaikan, lulus dengan perbaikan. E2E Chromium (DB tes terpisah via MYFLIPBOOK_DB): cookie g_state + mf_session -> akun terbaca, badge "✓ Verified", chip "✓ Tes UI".
Status kunci Google (.env): GOOGLE_CLIENT_ID + GOOGLE_API_KEY terisi, tombol Google & Drive Picker muncul; SMTP_HOST/SMTP_PASS (App Password Gmail) masih kosong -> email verifikasi masih ke .data/outbox.

### 1 Oktober 2026 - Halaman/skrip tidak lagi tersangkut versi lama (Cache-Control: no-cache)

Owner: setelah login (agungbp.online lewat Google, DB: verified=1 + google) badge Terverifikasi tidak muncul — browser masih memakai account.html/auth.js lama dari cache (file statis tanpa Cache-Control, browser bebas menyimpan). server.py `end_headers()`: `/`, `.html`, `.js`, `.css`, `.json` kini `Cache-Control: no-cache` (browser selalu cek versi baru; 304 bila tidak berubah — sudah dicek), kecuali respons yang sudah punya Cache-Control (API tetap `no-store`, template ekspor tetap `no-store`); gambar tidak berubah. Catatan Google: app OAuth masih "Testing" -> hanya test user (Audience) yang bisa login; agungbp.online ditambahkan owner sebagai test user. Publish app saat siap umum (scope email/profile/openid/drive.file non-sensitive).

### 1 Oktober 2026 - Dialog konfirmasi MyFlipbook sendiri (di tengah layar)

Owner: kotak konfirmasi bawaan browser ("localhost:8080 says", muncul di atas) diganti dialog versi MyFlipbook, di tengah. Modul baru `assets/mf-dialog.js`: `await MFDialog.confirm({title, message, ok, cancel, danger, icon})` -> true/false, `await MFDialog.alert({title, message})`. Kartu krem bulat di tengah + latar redup blur, ikon (🗑️ untuk bahaya), tombol hijau / merah (danger), "Batal" default bila `<html lang="id">`. Esc / klik di luar = batal; aksi berbahaya mulai fokus di "Batal" (Enter tidak langsung menghapus); Tab tetap di dalam kotak; fokus kembali ke tombol asal; teks selalu teks (bukan HTML). Dipakai di library.html (hapus buku dari Arsipku), notebook.html (terjemahkan ulang, buat ulang podcast), workflow.html (hapus workflow). Tidak ada lagi `confirm()` bawaan di halaman situs.
Tes: tests/mf-dialog.test.cjs (OK/Batal/Esc/klik luar, fokus danger, Tab, teks bukan HTML, alert, halaman sudah pindah). Screenshot Chromium: kartu tepat di tengah (desktop 1100×700 dan HP 390×760).

### 1 Oktober 2026 - Kebijakan Privasi + Syarat & Ketentuan (untuk Google Publish & payment gateway)

Owner: Google tidak mengizinkan "Publish app" sebelum Branding lengkap (home page + privacy policy + authorized domain, harus domain https asli). Halaman disiapkan sekarang; tinggal isi link setelah domain dibeli.
- `privacy.html` + `terms.html` (dua bahasa dalam satu halaman, ikut bahasa situs; tombol ID/EN; `?lang=id|en` juga mengatur bahasa situs), gaya `assets/legal.css`, pengalih bahasa `assets/legal.js`. Ditambahkan ke PAGES di server.py.
- Isi Kebijakan Privasi sesuai kode: data akun (password hash PBKDF2-SHA256), alat PDF mayoritas di browser, server untuk konversi Office/link/build (file sementara dihapus; build maks 7 hari), Arsipku terenkripsi, AI (teks ke Sumopod -> Anthropic Claude / Google Gemini), pencarian (OpenAlex/OAPEN/Internet Archive), pembayaran (Tripay/Midtrans rupiah, Lemon Squeezy USD; tidak simpan kartu), IP untuk keamanan login, Google Sign-In + Drive `drive.file` + pernyataan Google API Services User Data Policy / Limited Use, cookie mf_session/g_state + localStorage preferensi, hak UU PDP No. 27/2022 (hapus akun via email), tabel pihak ketiga.
- Syarat & Ketentuan: layanan, akun, konten tetap milik pengguna + izin proses terbatas, larangan (hak cipta, DRM, konten ilegal, penyalahgunaan), lisensi jurnal/ebook (klaim pengunggah IA), AI bisa keliru, pembayaran (Rupiah per periode tanpa perpanjangan otomatis -> kembali Free; USD Lemon Squeezy langganan otomatis; refund "hubungi kami, ditinjau" — kebijakan refund belum diputuskan owner), "as is", batas tanggung jawab 12 bulan pembayaran, hukum RI.
- Tautan: footer beranda (i18n `foot.privacy`/`foot.terms`) + catatan di login "Dengan melanjutkan, Anda menyetujui …" (`auth.agree`/`auth.and`).
- server.py `prune_builds()`: folder build `<32 hex>` yang selesai dan berumur > 7 hari dihapus (dipanggil tiap build baru; build berjalan & folder lain tidak disentuh) — supaya janji "7 hari" di kebijakan benar. Saat build berikutnya, 17 folder build lama (> 7 hari) akan terhapus; kunci APK ada di .data/ (aman).
**Owner perlu cek:** nama badan hukum/alamat Sarvamaya (sekarang hanya "Sarvamaya" + email), keputusan refund, dan sebaiknya ditinjau ahli hukum. Setelah domain: Branding -> App home page `https://domain`, Privacy `https://domain/privacy.html`, Terms `https://domain/terms.html`, Authorized domains -> Publish app.
Tes: tests/test_legal.py (prune 7 hari: lama terhapus, baru/berjalan/folder lain aman; halaman tersaji + isi kunci + link di index/login). Chromium: judul ID/EN, toggle bahasa, HP 390 px tanpa scroll samping.

### 1 Oktober 2026 - Stabilo: tombol ✨ Ringkas (highlight -> ringkasan AI di note tepi halaman)

Owner: di sebelah stabilo ditambah tombol ringkasan; teks yang distabilo jadi ringkasan di note tepi halaman.
- layout.js FlipbookHighlights: tool baru `.book-hl-summary` (ikon sparkles, ungu saat aktif) di samping highlighter & eraser, hanya bila `options.summarize && options.onSummary` (di buku offline tanpa server tidak muncul). Mode: highlight baru -> `onSummary(index, said, color)` bukan `onQuote`; hint "Drag over text: its note becomes a short summary"; gagal -> hint "Summary failed: … (kept the quote)" 6 detik. Brush mematikan mode ringkas; keluar mode stabilo mematikannya.
- FlipbookNotes: field tersembunyi `q` (teks yang distabilo) pada note ringkasan, disimpan/dimuat (load: note yang tertinggal "✨ Summarizing…" kembali jadi kutipan). `summary(index, said, color, fn)`: note "✨ Summarizing…" langsung, lalu "✨ <ringkasan>" (daftar "- " -> "• " dengan judul "✨ Summary"); bila AI gagal -> kutipan biasa + promise reject. Tetap tertaut ke stabilonya: hapus stabilo -> note hilang (`unquote` cek q), hapus note -> stabilo hilang (`removed` pakai q), ganti warna ikut (`tint`), stabilo ulang tidak meminta dua kali; editan pembaca selama menunggu tidak ditimpa.
- flipbook.js (editor/preview di server): `highlightSummary(text)` -> POST `/api/highlight-summary` (X-Build-Token). viewer.js (ekspor offline/APK) tidak diberi summarizer -> tombol tidak muncul.
- server.py: `summarize_highlight(text)` (maks 6000 karakter masuk, bahasa sama dengan teks, maks 2 kalimat / 2-4 butir, tanpa "Ringkasan:"/markdown, keluar maks 800) + route `/api/highlight-summary` (gate 'export' + build token, 64 KB). **max_tokens=2000**: Gemini 3.8 Flash memakai ~400 token untuk "berpikir" sebelum menjawab — dengan 400 ringkasan terpotong (dicek: finish=length, reasoning 387 dari 396). Catatan: summarize_book/book_notes memakai max_tokens 3000-4000 dengan model yang sama, layak diawasi.
Tes: tests/highlight-summary.test.cjs, tests/test_highlight_summary.py. E2E Chromium dengan AI asli (ntt.pdf hal 2): Summarizing… -> API 200 -> "✨ Summary\n• Hero video dimulai setelah Activation Ceremony selesai.\n• Visual menampilkan energi aktivasi …", note di tepi halaman warna stabilo.

### 1 Oktober 2026 - Ringkasan stabilo lebih panjang (ikut panjang teks)

Owner: "ringkasane sitik banget". `summarize_highlight()`: dulu maks 2 kalimat / 2-4 butir, keluaran maks 800 karakter. Sekarang target `highlight_summary_words()` = ±separuh jumlah kata yang distabilo (min 40, maks 300 kata), prompt meminta SEMUA poin utama, nama, angka, istilah penting dipertahankan (butir "- " bila beberapa poin, paragraf bila tidak), "jangan lebih pendek dari itu bila isinya cukup"; max_tokens 4000 (Gemini berpikir dulu); keluaran maks `HIGHLIGHT_SUMMARY_MAX` 3000 karakter dipotong di akhir kalimat/baris terakhir (note muat 5000). Uji nyata (ntt hal 2, 79 kata): sebelumnya 3 butir pendek & "fondasi konektivitas…" hilang; sekarang 53 kata, semua poin masuk.

### 1 Oktober 2026 - Drive Picker: pesan error asli dari Google

Owner: Add source -> Google Drive masih error padahal email sudah jadi test user. Pemeriksaan: OAuth client origins benar (`http://localhost:8080`, `http://127.0.0.1:8080`, Client ID cocok dengan .env), API key lolos cek referrer localhost dan dibatasi ke Picker (Drive API diblok untuk key = benar, unduhan memakai token OAuth). Sebelumnya setiap 403 saat ekspor Google Docs/Slides ditampilkan sebagai "terlalu besar" — menyesatkan. `assets/drive-picker.js` `download()`: membaca JSON error Google; `accessNotConfigured`/`SERVICE_DISABLED` -> "Google Drive API is not turned on … Enable"; `exportSizeLimitExceeded` -> terlalu besar; lainnya -> "refused the download (kode: pesan Google)". Tes drive-picker.test.cjs diperbarui. Penyebab pasti di sisi owner menunggu screenshot error (dugaan utama: Google Drive API belum di-Enable di project).

### 1 Oktober 2026 - Stabilo tidak lagi ikut menyeleksi kolom teks di sampingnya

Owner (screenshot panduan logo): stabilo paragraf kiri ikut menandai kolom kanan ("klinik mata untuk kesehatan mata.", kutipan Lorem ipsum). Penyebab: `FlipbookHighlights.select()` mengambil semua baris dari baris awal sampai baris akhir menurut urutan tinggi, termasuk baris kolom lain yang tingginya di antaranya (dan potongan kolom lain di baris yang sama).
- `pieces(line)`: baris dipecah per potongan kolom (jarak > 2.5× tinggi baris, sama seperti sebelumnya).
- `select()`: hanya potongan yang sekolom (tumpang tindih > 50%) dengan rentang horizontal potongan awal & akhir seretan; seret dari satu kolom ke kolom lain tetap mengambil keduanya.
- `locate()`: memilih baris terdekat dengan memperhitungkan jarak samping (dy + 0.5·dx), sehingga ujung seretan di atas kolom kiri tidak tersangkut baris kolom kanan yang setinggi.
Tes: highlights.test.cjs (kasus dua kolom selang-seling: kiri saja, ujung sejajar baris kanan, kanan saja, lintas kolom; ekspektasi lama yang memasukkan kata kolom samping diganti). E2E Chromium dengan PDF dua kolom buatan pdf-lib: note hanya berisi paragraf kiri.

### 1 Oktober 2026 - "Arsipku" diganti "My Library"

Owner: Arsipku jadi My Library. Semua teks yang terlihat pengguna diganti (editor: "☁ Tersimpan di My Library", tautan "📚 My Library"; halaman library.html judul/tab/hapus/konfirmasi/"Masuk dulu untuk melihat My Library-mu"; nav account.html & journals.html; pesan kuota library.py; pesan login server.py; privacy.html & terms.html ID/EN) plus komentar kode. Nama file/route tetap (`library.html`, `/api/library/*`, `library.py`), jadi tautan lama tetap jalan. Catatan: entri lama di handoff ini masih menyebut "Arsipku" = fitur yang sama.

### 1 Oktober 2026 - Ringkasan stabilo berupa kalimat (tanpa butir)

Owner: ringkasan di note pakai kalimat, jangan bullet. `summarize_highlight()`: prompt meminta PARAGRAF kalimat utuh, tanpa butir/penomoran walau teks asli berupa daftar (poin digabung jadi kalimat); jaga-jaga: baris yang masih diawali "- • * 1." dibersihkan dan digabung jadi satu paragraf (titik ditambahkan bila perlu). Contoh nyata (ntt hal 2, 79 kata): 55 kata, 2 kalimat runtut, semua poin masuk. Format "✨ Summary" + "•" di klien praktis tidak terpakai lagi (tetap aman bila muncul).

### 1 Oktober 2026 - Tombol My Library di editor jadi tombol penuh di tengah

Owner: link "📚 My Library" (pojok kanan baris status) dibuat di tengah dan sama dengan tombol lain. flipbook.html: status My Library (`#archive-status`) baris sendiri rata tengah (disembunyikan saat kosong), lalu `<a class="secondary archive-link">📚 My Library</a>` selebar panel seperti "Save project as…" (pill putih bergaris, hover terangkat). CSS di assets/theme-cream.css (`.archive-line`, `.archive-link`). Dicek Chromium: posisi & lebar sama persis dengan #save-project (75 px / 237 px), radius 999px.
Catatan QA: setelah perubahan ini satu kali `python -m unittest discover -s tests` melaporkan FAILED (failures=1) tanpa detail tersimpan; 10 kali ulang berikutnya semua OK (89/89). Perubahan ini hanya HTML/CSS, jadi kemungkinan ada tes Python yang flaky (bergantung waktu/port). Bila muncul lagi, simpan output lengkapnya.

### 1 Oktober 2026 - Tombol bahasa menampilkan bahasa yang dipakai (EN/ID)

Owner: tombol bahasa harusnya "EN" (sebelumnya menampilkan bahasa tujuan: halaman Inggris -> "ID"). assets/i18n.js `apply()`: label = bahasa yang sedang dipakai (EN / ID); tooltip + aria-label menjelaskan aksi klik ("Ganti ke Bahasa Indonesia" / "Switch to English"). Label awal di HTML (index, account, login, coming-soon, privacy, terms) diganti "EN" (bahasa default) agar tidak berkedip. Dicek Chromium di 4 halaman: Inggris -> "EN", klik -> halaman Indonesia & "ID".

### 1 Oktober 2026 - Mode EN benar-benar Inggris semua (audit + perbaikan)

Owner: saat EN masih ada teks campuran Indonesia. Audit otomatis (Playwright, 31 halaman/tool dalam mode EN: teks terlihat, placeholder, tooltip, aria, opsi, judul tab; kata dicek dengan wordfreq id vs en) menemukan 204 teks; sisa setelah perbaikan 80 = halaman Animation (coming soon, tidak terlihat pengguna, belum diterjemahkan) + salah tangkap (Rina/Bima, Rupiah, API) + elemen tersembunyi.
- assets/i18n.js: teks dua bahasa langsung di HTML — elemen menyimpan teks Indonesia dan membawa `data-en="…"` (HTML), `data-en-ph` / `data-en-title` / `data-en-aria`, `<html data-en-doc>` untuk judul tab; `I18N.pick(en, id)` untuk teks dari JS; cookie `mf_lang` (en/id) diset agar server tahu bahasanya. Tooltip tombol bahasa kini sesuai bahasa halaman ("Switch to Indonesian" / "Ganti ke bahasa Inggris").
- Halaman: journals.html, library.html, notebook.html kini memuat i18n.js + tombol bahasa, semua teks statis & dinamis dua bahasa (re-render saat ganti bahasa); converter.html (deskripsi/hint Merge/Split/Rotate/Organize, opsi Split/Rotate/Organize/JPG/PDF-to-JPG, tombol, pesan hasil & error; isian Rotate menerima "all" dan "semua"); flipbook.js (status My Library, ekspor, build, simpan; editor tanpa tombol bahasa, ikut pilihan situs); privacy/terms footer; login: tombol Google diberi `locale` dari pilihan bahasa.
- Server: `messages_en.py` (156 pesan tetap + pola untuk pesan dinamis: kode HTTP, nama sumber, kuota My Library, sebab error; pesan gabungan diterjemahkan per kalimat). `send_json` menerjemahkan `error`/`errors` bila cookie `mf_lang=en`; tanpa cookie (klien lain, tes) tetap Indonesia. Perintah/istilah teknis (python server.py, SUMOPOD_API_KEY, OPENALEX_API_KEY, csc.exe, HTTP xxx, nama tool) sengaja tidak diterjemahkan (permintaan owner).
- Batas: teks tombol "Masuk dengan Google" digambar Google di iframe-nya sendiri; parameter `hl=en` (juga en-US/en_US/en-GB, sudah dicoba) diabaikan — Google memilih bahasanya dari lokasi/akun. Hanya bisa diganti dengan tombol buatan sendiri (alur OAuth berbeda) — belum dikerjakan. Email verifikasi masih bahasa Indonesia.
Tes: tests/test_messages_en.py (setiap pesan Indonesia di server.py/accounts.py/library.py wajib punya terjemahan — pesan baru tanpa terjemahan membuat tes gagal; pola; cookie mf_lang). Chromium: journals/library/notebook/converter split ID -> EN berganti; error server EN "Type keywords of 2-200 characters." vs ID.

### 1 Oktober 2026 - 🌐 Translate kembali di toolbar flipbook (terjemahan halaman saat dibutuhkan)

Owner: terjemahan pindah ke toolbar bawah flipbook. `FlipbookTranslate.bind` (layout.js) mendapat mode live: opsi `translate(pages {index: text}, lang) -> Promise<{index: terjemahan}>`, `text(index)`, `save(lang, pages)`, `preferred()`. Dengan `translate` tombol 🌐 Translate selalu tampil; panel menerjemahkan halaman yang sedang tampil saat dibuka / saat halaman berganti / saat bahasa diganti (Indonesia, English, Melayu — default: Inggris bila dokumen berbahasa Indonesia, sebaliknya Indonesia); "Translating…" selama menunggu; halaman tanpa teks diberi tahu; gagal -> "⚠ alasan"; tiap halaman diminta sekali per buka/halaman/bahasa (`asked`), jadi halaman yang dilewati AI tidak diminta terus-menerus. Tanpa `translate` (buku ekspor offline) perilaku lama: hanya menampilkan terjemahan yang tersimpan.
- flipbook.js: `translatePages()` -> POST /api/translate (gate 'export'/Pro, X-Build-Token); `pageParagraphs()` menggabung baris PDF jadi paragraf; hasil disimpan ke `bookTranslations` -> ikut `model()` -> ikut ekspor HTML/APK/EXE dan bisa dibaca offline.
- theme-cream.css: `.controls button:empty{display:none}` — tombol bookmark/daftar/notes/stabilo yang belum berlabel sebelum PDF dibuka tidak lagi tampil sebagai pil kosong (terlihat di screenshot owner).
- Notebook PDF masih punya kartu Terjemahan (terjemahan seluruh dokumen + unduh .txt); belum dihapus — tanya owner.
Tes: translate.test.cjs (mode live: hanya halaman tampil, disimpan, ikut halaman, halaman tanpa teks, gagal, tanpa ulang tanpa henti). E2E Chromium + AI asli (ntt.pdf): panel hal 2 -> Inggris; ganti ke hal 3 -> diterjemahkan otomatis.

### 2 Oktober 2026 - Edisi terjemahan "ID | EN": seluruh buku diterjemahkan di tempat (tampilan tetap)

Owner: terjemahan seperti tombol ID/EN di web — seluruh buku, tanpa mengubah bentuk & isi. Prototipe (NTT hal 2-4, storyboard hal 2/6) disetujui, lalu dijadikan fitur.
- Mesin baru `assets/pdf-translate.js` (`PdfTranslate.book/blocks/rooms`): per halaman PdfLayout (latar tanpa teks + baris teks) -> baris dikelompokkan jadi blok paragraf (bullet, baris "Label:" bold, baris tabel [sel pendek sejajar], baris sengaja dipotong [":" / lebih pendek], teks rata tengah tetap terpisah) -> blok beberapa halaman dikirim bersama ke `/api/translate` (maks 40 blok / 9000 karakter per panggilan, kunci angka; istilah lebih konsisten) -> terjemahan digambar ulang di kotak aslinya (wrap, melebar ke ruang kosong kanan untuk blok 1 baris, turun sampai blok berikut, font dikecilkan sampai 60% bila perlu, label bold dipertahankan, rata tengah). Halaman tanpa teks memakai gambar asli. Gagal sementara dicoba ulang sekali (bukan untuk budget/paket).
- `FlipbookEditions` (layout.js): tombol `#edition` "ID | EN" (bahasa yang tampil tebal+garis bawah, klik ke bahasa berikutnya). Editor: edisi yang belum ada -> MFDialog konfirmasi (jumlah halaman, perkiraan menit, AI/Pro) -> progres "🌐 n / N" di tombol -> gambar halaman diganti; balik ke bahasa asli tanpa AI lagi. Bahasa asli dideteksi `FlipbookSpeech.lang` (ditawarkan: Indonesia->English, lainnya->Indonesia).
- Format buku: `lang` + `versions: {lang: [indeks halaman]}` (JS `validVersions`/`versionImages`, Python `validate_versions`/`version_images`). Gambar terjemahan menyusul halaman asli di setiap paket (asli 1..N, lalu per bahasa urut nama, halaman urut). Proyek .smflipbook menyimpan `versions/<lang>/<hal>.jpg` (dibuka ulang tanpa AI); My Library ikut (archiveBook setelah menerjemahkan). Ekspor HTML (sealed) & APK/EXE (`unpack_book` membaca pageCount + gambar edisi) membawa edisinya; reader offline (`viewer.js`) punya tombol ID | EN yang sama.
- Batas: font didekati (Arial/Times/…); teks di dalam gambar tidak ikut; PDF scan perlu OCR; Listen & stabilo tetap memakai teks/posisi asli (di halaman terjemahan posisi stabilo bisa tidak pas); ukuran ekspor bertambah (NTT 11 hal: HTML 2 MB).
- **Kredit Sumopod habis** saat uji: "Budget has been exceeded… Max budget: 2.0" (429). Uji AI asli pertama berhasil (11 hal, 4 panggilan, 30 dtk); sisa uji (ekspor, proyek, reader) memakai AI tiruan. Owner perlu menaikkan budget key di Sumopod.
Tes: tests/pdf-translate.test.cjs (blok, ruang, tombol, format), tests/test_editions.py (manifest + unpack_book 3+2 gambar, gambar kurang ditolak). E2E Chromium: terjemahkan -> balik -> ekspor HTML 2 MB -> simpan & buka proyek (0 panggilan AI) -> reader offline ganti ke EN.

### 2 Oktober 2026 - Edisi ID | EN memakai penerjemah gratis (Argos Translate), AI hanya untuk fitur lain

Owner: terjemahan seluruh buku pakai yang gratis; AI nanti untuk terjemahan yang terkait stabilo. (Konteks: buku 600 halaman dengan AI menghabiskan banyak kredit; key Sumopod "podcast" sempat habis di $2, owner menaikkan limit ke $5.)
- `free_translate.py` (baru): Argos Translate 1.11 (OpenNMT/CTranslate2, CPU, offline) model id<->en (`pip install argostranslate` lalu `python free_translate.py --install`, ±100 MB model; dependensi besar: torch, stanza, spacy). Penjaga: teks yang sudah berbahasa tujuan dibiarkan (wordfreq); nama/istilah (2+ kata kapital, kode berangka/huruf besar seperti JKT2A) di-mask `Z{n}Q` lalu dikembalikan, bila mask hilang potongan diterjemahkan ulang tanpa mask; dipecah di ": " (label/tema per potongan). Lock thread (model tidak thread-safe).
- server.py: `POST /api/translate-free` (validasi sama dengan /api/translate, gate 'export' + build token, 503 bila Argos/model belum terpasang, target hanya id-ID/en-US). editor `translateBook` memakai `translateFree`; panel 🌐 Translate per halaman tetap AI. Dialog konfirmasi: "mesin penerjemah gratis (tanpa kredit AI)".
- pdf-translate.js: judul rata tengah — garis yang berbagi pusat dengan selisih kiri > 0.4× ukuran font, atau pusatnya di tengah halaman (±4%), blok tengah boleh melebar simetris sampai 70% halaman ("Dari mereka, / para pembaca …" -> "From them, the readers..." satu baris di tengah).
- Kinerja (CPU kantor): NTT 11 hal 6-8 dtk; novel Perahu Kertas 40 hal 41 dtk (±1 dtk/hal -> 600 hal ±10-11 menit), 0 kredit AI. Kualitas: lebih kaku dari AI tapi layak (contoh hal xi novel); kesalahan kecil kata tunggal ("Corporate" -> "Corporation").
Tes: tests/test_editions.py (penjaga dengan mesin tiruan, mask hilang -> tanpa mask, route 200/400/503). 97 tes Python + JS lulus.

### 2 Oktober 2026 - Edisi ID | EN: halaman berganti langsung, bisa dihentikan & dilanjutkan

Owner: saat "🌐 44 / 600" buku belum berubah (halaman baru diganti setelah seluruh buku selesai). Sekarang: `PdfTranslate.book` punya `onPage(index, blob)`; editor mengganti gambar halaman itu seketika. Tombol saat berjalan: "🌐 n / N · Berhenti" (EN "· Stop"); klik = berhenti (`FlipbookEditions` opsi `cancel`). Berhenti/gagal: tampilan kembali ke asli, halaman yang sudah jadi disimpan (`bookChecked[lang]`, `bookVersions[lang]`, My Library ikut disimpan), klik berikutnya -> dialog "Lanjutkan terjemahan? x dari N halaman sudah selesai" dan hanya halaman sisa yang diproses. Edisi dianggap siap (`bookComplete`) hanya bila seluruh buku selesai (atau dimuat dari proyek). Membuka PDF lain menghentikan proses.
E2E: Perahu Kertas 456 hal — 15 dtk: 10 halaman sudah berganti; Stop -> kembali asli; klik lagi -> "Lanjutkan…"; NTT sampai selesai.

### 2 Oktober 2026 - Edisi ID | EN mulai dari halaman yang sedang dibaca

Owner: "harus nunggu 600 dulu?" — halaman sudah berganti satu per satu (sebelumnya), tapi urut dari halaman 1. Sekarang `translateBook` mengurutkan halaman: dari halaman yang sedang tampil ke belakang dulu, lalu halaman sebelumnya. E2E Perahu Kertas: membaca hal 18–19 -> yang pertama berganti 18, 19, 20, 21…

### 2 Oktober 2026 - "Listen" jadi "Audio book"; audio book membaca edisi terjemahan dalam bahasanya

Owner: Listen diganti nama Audio book; saat edisi terjemahan tampil audio book masih membaca bahasa asli (harusnya bahasa terjemahan).
- layout.js FlipbookSpeech: label "🎧 Audio book" (tooltip ikut). Opsi baru `edition()` -> null atau {lang, pages: {index: [[x,y,w,h,text]]}}: halaman edisi dibaca dari teks terjemahannya per blok (dipecah ±220 karakter per kalimat), dengan suara bahasa edisi (`engine.speak(text, lang)` per potongan), blok yang dibaca ditandai, klik/tap pada blok membaca dari situ; halaman yang tidak ada di edisi tetap dibaca asli dengan bahasa asli. `editionChanged()` dipanggil saat ID | EN diganti -> membaca lanjut dalam bahasa baru. Peringatan "tidak ada suara bahasa X" memakai bahasa edisi.
- pdf-translate.js: `draw()` mencatat yang ditulis per blok + kotaknya (`canvas.said`), `onPage(index, blob, said)`.
- Format buku: `versionText: {lang: {page: [[x,y,w,h,text]]}}` (JS `validVersionText`, Python `validate_version_text`: hanya bahasa/halaman yang ada di versions, kotak 0..1, teks ≤4000, ≤300 blok/hal). Editor menyimpannya (`bookVersionText`, ikut model/proyek/My Library/ekspor); reader offline (viewer.js) & editor memberi `edition()` dan memanggil `editionChanged()`.
- Catatan: edisi yang dibuat sebelum perubahan ini belum punya versionText -> audio book tetap membaca bahasa asli sampai edisi dibuat ulang.
Tes: tests/speech-edition.test.cjs, tambahan format di pdf-translate.test.cjs & test_editions.py, speech.test.cjs (label). E2E Chromium dengan suara tiruan: edisi EN dibaca en-US dari teks terjemahan mulai blok yang diklik; kembali ke ID dibaca id-ID.


## 2026-10-02 — Audio book ngikuti terjemahan sing lagi mlaku / edisi lawas
Laporan: habis diterjemahkan ke ID, audio book tetap membaca English.
- flipbook.js: `liveLang` di-set selama `translateBook` jalan; `edition()` memakai edisi yang tampil, atau `liveLang` kalau terjemahan sedang berjalan (halaman yang sudah ganti bahasa langsung dibaca dalam bahasa baru). Tiap halaman yang tampil berganti -> `speech.editionChanged()`. Stop/gagal -> `liveLang=null`, kembali asli + `editionChanged()`.
- `fillVersionText(lang)`: edisi lama tanpa versionText (dibuat sebelum fitur audio book edisi) -> saat edisi dipilih, teks halaman diterjemahkan ulang lewat /api/translate-free (blok tanpa kotak, per paragraf) lalu dibaca bahasa edisi; disimpan ke My Library.
- Masih mungkin English: perangkat tanpa suara Indonesia (muncul notice di status). Chrome: Google Bahasa Indonesia; Edge: Gadis.
E2E (suara tiruan, english8.pdf): baca EN -> terjemahkan ke ID -> saat 4/8 audio book sudah id-ID; setelah selesai id-ID. Tes: semua JS + 97 Python OK.


## 2026-10-02 — Swara flip: siji rekaman asli, sintesis dibuang
- Sumber: "Paper slide.mp4" (Downloads user) -> ffmpeg: buang hening awal, potong 0.6 s, fade-out 0.1 s, mono, limiter -> assets/sounds/paper-flip.mp3 (8 KB, 96k).
- layout.js FlipbookSound: synth/STYLES/setStyle (paper/crisp/thick) DIHAPUS. MP3 di-embed base64 (konstanta MP3) supaya semua ekspor offline (HTML/ZIP/APK/EXE) ikut tanpa file tambahan. Decode sekali (decodeAudioData callback + promise), flip pertama sebelum decode selesai diputar begitu siap. playbackRate 0.96–1.04, pan kanan->kiri. API: play, attach, setEnabled, bindButton, isEnabled.
- Ganti swara: timpa assets/sounds/paper-flip.mp3 lalu embed ulang base64 ke konstanta MP3 (tes flip-sound.test.cjs memastikan isinya sama persis).
Tes: flip-sound.test.cjs (rekaman ter-embed = file mp3, tanpa styles), Chromium asli: buffer 0.60 s mono diputar. Semua JS + Python OK.

- 2026-10-02: volume swara flip diturunkan (gain 0.9 -> 0.35, kira-kira -8 dB) atas permintaan user (terlalu keras). Atur di layout.js FlipbookSound.play `gain.gain.value`.


## 2026-10-02 — Terjemahan buku: lanjut setelah Stop, angka progres, judul huruf renggang
Laporan (Routledge Companion to Aesthetics, 600 hal): "54 / 600" tapi hal 2–3 tetap English, audio book membaca Indonesia.
- flipbook.js translateBook: saat dilanjutkan setelah Stop, halaman yang sudah jadi langsung ditampilkan terjemahannya lagi (dulu tetap asli sampai selesai 600) + `speech.editionChanged()`.
- Angka progres sekarang = halaman SELESAI diterjemahkan (stage read diabaikan); dulu = halaman yang baru dibaca, jadi "54" padahal belum ada yang tampil.
- pdf-layout.js `spacedWords()`: judul huruf renggang ("T H E R O U T L E D G E") dari pdf.js disatukan lagi jadi kata. Font dengan kode private-use: glyph spasi kata ikut dilukis -> dicari glyph yang jumlahnya pas dan pemetaan huruf konsisten; font biasa: celah lebih lebar dari biasanya = spasi. Diekspor `PdfLayout.spacedWords`.
Tes: tests/pdf-layout-spaced.test.cjs. E2E Routledge: hal 2–3 jadi Indonesia, Stop -> asli, Lanjutkan -> langsung Indonesia lagi. Judul huruf kapital tetap English (Argos menganggap nama) — wajar.

- 2026-10-02 (lanjutan): audio book mengeja judul huruf renggang ("T H E ..."). pdf-words.js: halaman yang punya teks huruf renggang (`PdfLayout.looksSpaced`) dirender sekali lewat `PdfLayout.layoutPage` -> `layout.spaced {indeks item: kata}` -> teks/posisi kata pakai kata utuh. Jadi audio book, stabilo/catatan, pencarian ikut membaca "THE ROUTLEDGE COMPANION TO". Teks diekstrak ulang tiap PDF/proyek dibuka, jadi buku lama ikut beres setelah dibuka ulang (ekspor lama perlu diekspor ulang).

- 2026-10-02 (lanjutan 2): judul HURUF KAPITAL dieja suara Indonesia (dianggap singkatan). layout.js `FlipbookSpeech.speakable(text)`: kata kapital >=4 huruf -> "Routledge", kata pendek ikut kalau kalimatnya judul kapital semua; singkatan pendek di teks biasa (PDF, USA) tetap. Dipakai di setiap `engine.speak` audio book (asli & edisi terjemahan). Tes di speech-edition.test.cjs. (Python suite sempat 1x error flaky, rerun 2x OK.)


## 2026-10-02 — Tombol "🌐 Translate" (buku penuh) + Translate AI pindah ke stabilo
- FlipbookEditions: tombol dulu "ID | EN", sekarang "🌐 Translate"; saat edisi terjemahan tampil "🌐 Translate · ID" (span.is-current tebal, tombol ungu muda). Fungsi sama (penerjemah gratis, buku penuh, toggle balik).
- Translate AI per halaman (#translate di toolbar) TIDAK lagi dibuat di editor: FlipbookTranslate di-bind tanpa `translate`, jadi tombol hanya muncul kalau proyek lama membawa bookTranslations (viewer ekspor juga sama).
- Highlighter: alat baru 🌐 `.book-hl-translate` (ikon globe, sebelah ✨ Ringkas, eksklusif dengan Ringkas). Opsi `translate: true, onTranslate(index, said, color)`. Hanya teks yang distabilo dikirim ke /api/translate (AI): Inggris -> Indonesia, selain itu -> Inggris (`highlightTranslate` di flipbook.js). Catatan: "🌐 Translating…" lalu "🌐 <terjemahan>", tersambung ke stabilonya (warna/hapus ikut). Gagal -> kutipan + pesan "Translation failed: …". FlipbookNotes: `translation()`, `TRANSLATING`; `summary`/`translation` lewat `aiNote()`.
Tes: tests/highlight-translate.test.cjs (baru), pdf-translate.test.cjs (label). E2E Chromium: toolbar "… 🎧 Audio book | 🌐 Translate | 🔊 Sound", stabilo kalimat English -> catatan "🌐 perahu-perahu pulang dan menghitung bintang-bintang…".

- 2026-10-02: tombol 🌐 Translate saat menerjemahkan diberi progress bar (FlipbookEditions.paint: teks "x / y" -> class is-busy + CSS var --edition-progress; book-effects.css gradient hijau dari kiri). Tes di pdf-translate.test.cjs.


## 2026-10-02 — Buka cover kurang kaku
FlipbookCurl (cover melengkung): DURATION 1250 -> 1600 ms; easing cubic in-out -> sine in-out (dulu pelan lalu "nyentak" di tengah); lengkungan mulai lebih dekat ke punggung (s^1.6, dulu s^2) dan lebih besar (1.25·sin, tetap dibatasi 0.75·sudut); perspektif lebih dekat (w·3.5, dulu w·6) jadi sampul terasa terangkat; strip overlap 1.6 px (sambungan putih). .book-shift (geser buku saat buka/tutup) 1.6 s dengan kurva sine supaya seirama. Tes qa-runtime/qa-editor: waktu pump disesuaikan (2000/2200 ms).
Catatan: di Chromium headless kadang tampak garis putih tipis di bagian bawah sampul saat hampir tegak — cek di browser asli.


## 2026-10-02 — "Notebook PDF" -> "AI Summarizer"
Nama fitur notebook.html diganti "AI Summarizer": judul tab + h1 notebook.html, kartu alat di index.html (id tetap "notebook"), nav chip (i18n nav.note "✦ AI Summarizer"), stat.4, privacy.html (ID+EN), komentar flipbook.js. Kartu placeholder "AI Summarizer" (id ai-summarizer, segera hadir) yang dulu ada di bawah DIHAPUS (permintaan user, biar tidak dobel) + entri SOON + i18n tool.ai-summarizer. test_accounts.py menyesuaikan.

- 2026-10-02: fitur jurnal diganti nama "Find Journal & Ebook" (sama di ID & EN): kartu index.html, nav chip (i18n nav.journals), tombol di notebook.html, judul tab + h1 journals.html (satu nama untuk tab Jurnal & Ebook; dulu heading ganti "Cari Jurnal"/"Cari Ebook").

- 2026-10-02: halaman buku tidak lagi jadi biru saat terseleksi (dobel-klik, Ctrl+A, tekan lama di HP). book-effects.css: .book-paper/.cover-curl/.stf__parent user-select:none, ::selection transparan, gambar tidak bisa di-drag, tap highlight mati; textarea/input catatan tetap bisa diseleksi.


## 2026-10-02 — Swara flip kertas DIHAPUS
Permintaan user: tanpa audio efek kertas. Dihapus: modul FlipbookSound (layout.js, termasuk MP3 base64), tombol #sound (flipbook.html + export index.html), panggilan attach/bindButton/play (flipbook.js, viewer.js; FlipbookCurl tanpa onTurn), assets/sounds/paper-flip.mp3, tests/flip-sound.test.cjs. localStorage mf-flip-sound di browser lama tidak dipakai lagi (tidak apa-apa). E2E: toolbar "← | Home | Open cover → | 🔍 | 🔖 Mark | ☰ | 📝 | 🖍 | 🎧 Audio book | 🌐 Translate", flip & Home tanpa error.

- 2026-10-02: tombol "⛶ Full screen" sekarang di toolbar buku editor (sesudah 🌐 Translate); dulu #fullscreen ada di .playback yang tersembunyi. Saat aktif "✕ Exit full screen" (aria-pressed), Esc/tombol keluar; fallback .reading-fullscreen kalau Fullscreen API tidak ada. Viewer ekspor sudah punya tombol Fullscreen sendiri.

- 2026-10-02: fullscreen editor — toolbar stabilo/catatan/dialog dulu tidak muncul (yang full screen cuma .preview, panel-panel itu ditempel di body). Sekarang document.documentElement yang full screen + .preview.reading-fullscreen mengisi layar; header situs (.topbar) disembunyikan & body overflow hidden saat itu; Esc/keluar fullscreen browser melepas class. E2E: bar stabilo visible, stabilo jalan, dialog Translate visible.
- Catatan tes: test_library.test_archive_flow_encryption_quota_and_ownership kadang gagal saat seluruh suite jalan (1 dari ~4 run), selalu lulus kalau dijalankan sendiri (15x). Kemungkinan interferensi antar-tes (server/waktu bersama), bukan regresi; perlu diselidiki kapan-kapan.


## 2026-10-02 — Spidol (marker) untuk corat-coret di halaman
Highlighter bar: alat baru ✏ `.book-hl-pen` (sesudah stabilo, sebelum penghapus). Mode `drawing`: seret = garis bebas, tap = titik; warna dari bulatan warna yang sama tapi tinta lebih pekat (`FlipbookHighlights.INK` y/g/p/b). Disimpan per buku di localStorage `<key highlight>:ink` = {page: [{c, p:[x,y,…] 0..1]}] (maks 1500 titik/garis, 300 garis/hal; `loadInk` membuang data rusak). Digambar sebagai SVG `.book-ink-layer` (path dihaluskan `inkPath`, 3px non-scaling, z-index 4), live stroke `.book-ink-live`. Penghapus juga menghapus garis yang disentuh (`eraseInk`). Spidol tidak membuat stabilo/catatan. Berlaku di editor + viewer ekspor (FlipbookHighlights sama). API `highlights.ink()`.
Tes: tests/highlight-pen.test.cjs. E2E Chromium fullscreen: gambar lingkaran pink + garis biru, 2 path.

- 2026-10-02: buka PDF -> progress bar MERAH di kotak status kiri (#load-status.is-loading, CSS var --load-progress) + persen di teks; tahap halaman 0–60 %, link 60–75 %, teks 75–100 %; `loading(null)` saat siap/gagal. Tidak ada bar di tengah halaman (permintaan user).


## 2026-10-02 — Teks dari halaman gambar (OCR) untuk stabilo & audio book
Halaman yang cuma gambar (scan, iklan majalah) sekarang dibaca teksnya otomatis di belakang setelah PDF terbuka, mulai dari halaman yang sedang dibaca. Gambar TIDAK diubah, file PDF tidak disentuh.
- assets/pdf-ocr-words.js (baru): Tesseract.js 5.1.1 (jsDelivr, dimuat hanya kalau ada halaman gambar; perlu internet pertama kali), `needs(words, i)` (< 8 kata), `start(langs)` -> worker.page(pdfPage, bookRatio) render 2200px -> `toLines` ke format PdfWords (posisi via PdfLinks.toBox). Saring: kata conf < 55, baris rata-rata < 62, huruf/angka tunggal kecuali yakin (>= 88) atau a/I/&/$/%, halaman < 3 kata -> kosong.
- flipbook.js `readPictures(version)`: OCR eng+ind, progress bar merah di kotak status ("Reading text in pictures (OCR) x / n"), isi bookWords/bookText, `highlights.refreshText(i)` + `speech.refreshText()` (layout.js: cache dibuang, furniture & bahasa dihitung ulang, tombol Audio book muncul kalau sebelumnya tidak ada teks). Selesai -> pesan jumlah halaman; My Library di-update. Proyek: teks OCR ikut disimpan (model words/text) dan dipakai lagi saat dibuka (tidak OCR ulang).
- Bug yang sempat masuk lalu diperbaiki sebelum commit: `all` di FlipbookSpeech jadi fungsi (`all()`).
Tes: tests/pdf-ocr-words.test.cjs. E2E majalah Grand Designs (212 hal, 29 halaman gambar): audio book membaca iklan hal 2–3 "Over 50 Styles Up To 40% OFF … templeandwebster.com.au/grand". Judul tipis putih di atas foto ("LOVE YOUR WALLS") bisa terlewat OCR.
Belum: terjemahan buku penuh untuk halaman gambar (PdfTranslate memakai teks PDF; halaman gambar dilewati).
