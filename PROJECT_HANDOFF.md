# Handoff — PDF Project & Flipbook

Terakhir diperbarui: 17 September 2026.

Gaya bukaan terbaru: pencahayaan punggung dari template heyzine_dynamic diadaptasi di `assets/export/book-effects.css`; engine PageFlip tetap mengatur transformasi/lipatan dan bayangan bergerak. `FlipbookLayout.motion/decorate` dipakai preview dan ekspor: sampul beserta sisi belakangnya hard, halaman isi soft, durasi 950ms, shadow 0,38, mouse/drag/swipe serta sudut halaman aktif. Reduced motion meniadakan durasi panjang/sudut mengintip. Ukuran sampul tetap sama dengan halaman isi. Ini gaya pada engine proyek, bukan integrasi layanan Heyzine resmi.

Kontrol preview terbaru: **Putar animasi**, **Layar penuh**, dan link **Demo infografis** di bar bawah disembunyikan sementara sesuai screenshot pengguna. Navigasi halaman tetap tampil. Elemen DOM/logika dipertahankan; perubahan ini hanya pada preview, bukan kontrol pembaca hasil ekspor.

Keputusan ukuran terbaru: sampul harus sama besar dengan satu halaman isi, tidak dibesarkan saat buku tertutup. Layout bersama kini menentukan ukuran dari area baca dan rasio, bukan indeks halaman; tinggi preview tidak berubah saat membuka sampul. `showCover:true` tetap menampilkan sampul sendirian. Berlaku untuk preview dan ekspor baru HTML/APK/Windows.

Koreksi screenshot terbaru: tinggi panel preview sekarang mengikuti rasio dan jumlah halaman yang terlihat (`compact:true` pada layout bersama), bukan tetap 75dvh setelah PDF dimuat. Buku landscape dua halaman memiliki tinggi `lebar panel / (2 × rasio halaman)`, sehingga tidak ada letterbox vertikal buatan panel. Fullscreen tetap memakai viewport penuh.

Keputusan terbaru (17 September): panel **Tambahkan animasi** disembunyikan sementara dari `flipbook.html` atas permintaan pengguna. Alur sidebar kini Pilih dokumen → Simpan & ekspor (langkah 02). Kode animasi dan dukungan proyek lama dipertahankan; jangan menampilkan kembali panel tanpa arahan pengguna.

Tampilan baca terbaru: preview dan ekspor HTML/APK/Windows memakai layout adaptif bersama `assets/export/layout.js`. Rasio asli PDF tidak lagi dibatasi 0,5–2. Sampul ditampilkan satu halaman, halaman isi menyesuaikan satu/dua halaman, batas ukuran visual lama dihapus. Ekspor memakai viewport penuh dan kontrol mengambang; preview punya tombol fullscreen. Margin asli PDF tidak dipotong. Ekspor lama perlu dibuat/build ulang. Android meminta immersive mode, dengan perilaku akhir mengikuti versi OS.

## Tujuan produk

Pengguna dapat mengonversi Word, PPT, gambar, dan format lain ke PDF atau sebaliknya. Setelah memperoleh PDF, pengguna ditawari **Download** atau **Jadikan Flipbook**. Di dalam flipbook, pengguna nantinya dapat menambah infografis animasi, audio/video, dan interaksi. Produk direncanakan memakai paket subscription bulanan/tahunan.

Ini adalah arah produk. Jangan menganggap semua format atau fitur sudah diimplementasikan.

## Keputusan diskusi

| Topik | Kesepakatan/status |
|---|---|
| Repo utama | `https://github.com/agebp21/pdf_project` |
| Sumber engine | `https://github.com/agebp21/sarvamaya-flipbook-studio` |
| Integrasi | Flipbook adalah fitur PDF Project |
| Halaman pertama | Sampul depan; pengguna membukanya sebelum masuk isi |
| Batas upload/pratinjau | Batas 50 MB dan 100 halaman sudah dihapus atas permintaan pengguna |
| Subscription | Paket bertingkat; pilihan bulanan dan tahunan |
| Harga | Belum final; Rp59.000/Rp590.000 dan Rp149.000/Rp1.490.000 hanya contoh diskusi |
| Offline dan native | HTML offline dan layanan build APK/EXE lokal diimplementasikan; subscription/distribusi publik belum final |
| Animasi dalam PDF | Elemen tambahan di atas halaman; bukan otomatis memisahkan isi infografis PDF |

## Struktur file

| File | Peran |
|---|---|
| `index.html` | Katalog tools, termasuk PDF to Flipbook dan demo animasi |
| `converter.html` | UI dan logika converter; tombol Jadikan Flipbook pada output PDF |
| `notebook.html` | Notebook PDF dengan integrasi Gemini yang sudah ada sebelum pengembangan flipbook |
| `flipbook.html` | Upload PDF, pembaca flipbook, kontrol animasi angka |
| `assets/flipbook.js` | Render PDF, engine buku, navigasi sampul/isi, overlay statistik |
| `assets/flipbook.css` | Tampilan pembaca dan overlay |
| `assets/flipbook-transfer.js` | Transfer Blob PDF antarhalaman menggunakan IndexedDB |
| `animation.html` | Demo infografis empat halaman dengan data yang dapat diedit |
| `assets/animation.js` | Grafik, angka, alur proses, putar/jeda/ulang demo |
| `assets/animation.css` | Gaya demo dan komponen layout yang juga dipakai pembaca |
| `assets/vendor/` | Engine flipbook dan PDF.js lokal; sumber dan lisensi dicatat di sini |
| `assets/flipbook-export.js` | Validasi proyek, simpan/impor `.flipbook`, kemas HTML offline |
| `assets/export/` | Pembaca HTML offline bersama untuk ZIP, APK, dan EXE |
| `server.py` | Server loopback, validasi paket, job build Flutter, download hasil/log |
| `native/reader/` | Wrapper Flutter Android/Windows, pubspec dan lockfile |
| `tests/` | Pengujian ekspor JavaScript dan paket build Python |

## Implementasi saat ini

### Alur converter ke flipbook

1. `downloadBlob(blob, filename)` di converter menampilkan **Jadikan Flipbook** jika MIME output mengandung `pdf`.
2. Tombol menyimpan `{blob, name}` ke IndexedDB `pdf-tools-flipbook`, object store `pending`, memakai ID unik.
3. Browser berpindah ke `flipbook.html?source=<id>`.
4. Pembaca mengambil PDF tersebut. Setelah berhasil dibuka, entry transfer dihapus dan query URL dibersihkan.
5. Pengguna juga bisa upload PDF langsung dari `flipbook.html`.

Transfer ini bukan penyimpanan proyek. Pengguna sekarang dapat menyimpan file `.flipbook` (ZIP berisi `source.pdf` dan `project.json`) serta membukanya kembali. Belum ada autosave; refresh tanpa menyimpan tetap kehilangan edit.

### Pembaca PDF

- PDF.js lokal versi 3.11.174; worker lokal. Pembaca memakai `isEvalSupported: false`.
- Semua halaman dirender berurutan menjadi JPEG sebelum buku tampil.
- Halaman tampil sebagai gambar, sehingga teks/link PDF asli belum menjadi elemen yang bisa diedit/diklik.
- Engine `St.PageFlip` disalin dari repo pengguna pada commit `dcc2b6fc6ca27a812e566858ff28d61332c642ec`.
- Pembaca memakai `showCover: true`, `startPage: 0`: halaman pertama tampil sendiri sebagai sampul.
- Navigasi melalui tombol atau interaksi halaman; `useMouseEvents:true` kini mengaktifkan klik/drag/swipe bawaan engine. Perlu QA interaksi pada browser/perangkat nyata.
- Spread isi tampil dua halaman di landscape dan satu halaman di portrait sesuai engine.
- Tidak ada batas ukuran file/jumlah halaman buatan aplikasi. Kapasitas perangkat tetap memengaruhi keberhasilan rendering.

### Animasi

- Demo: grafik batang, angka menghitung naik, dan proses bertahap yang bisa diklik; data demo bisa diedit.
- Pada PDF sendiri: satu overlay statistik per halaman, dengan judul, angka akhir, dan empat pilihan sudut posisi.
- Overlay diputar saat halaman dibuka atau melalui tombol putar ulang.
- Edit bisa disimpan manual dan diekspor bersama buku; belum autosave atau drag-and-drop.
- Editor grafik dan alur proses belum terhubung ke halaman PDF pengguna; keduanya baru di demo.
- Dukungan reduced motion dan penghentian animasi saat tab tersembunyi sudah ada, tetapi perlu QA browser lanjutan.

## Keterbatasan dan perhatian teknis

- Rendering semua halaman sekaligus bisa lama dan boros memori untuk PDF besar. Prioritas teknis berikutnya adalah render sesuai kebutuhan, cache terbatas, progress/cancel, serta pelepasan canvas/URL gambar.
- Ada backend Python lokal untuk build, tetapi belum ada login, billing, paket subscription, katalog akun, atau penyimpanan cloud.
- UI menyediakan simpan/buka proyek, HTML ZIP offline, build APK, dan build Windows ZIP. Build menggunakan Flutter lokal dan satu job aktif. Hasil disimpan di `.build/` yang diabaikan Git.
- Penyimpanan hasil mendukung dialog **Simpan sebagai** untuk memilih nama/folder melalui `showSaveFilePicker`. Proyek/HTML memilih sebelum pengemasan; APK/Windows memilih saat klik hasil build. Browser tanpa API memakai download biasa. Pembatalan tidak memicu fallback download; lokasi `.build/` internal tetap.
- APK memakai signing debug untuk pengujian, belum rilis Play Store. EXE belum ditandatangani; paket Windows menyertakan DLL/data dan membutuhkan WebView2 Runtime pada perangkat pembaca.
- Engine native membaca paket HTML yang sama. Server membangun ulang script dari template tepercaya, hanya mengambil metadata tervalidasi dan gambar JPEG dari ZIP kiriman.
- Server harus dijalankan melalui `python server.py` agar endpoint build tersedia. HTTP statis saja tetap cukup untuk ekspor HTML, tetapi tidak APK/EXE.
- Job status hanya di memori server; restart server menghilangkan endpoint status job lama, sementara file hasil/log masih berada di `.build/<job-id>/`. Belum ada cleanup otomatis.
- Template Windows memakai compatibility define untuk coroutine lama `webview_windows 0.4.0` pada MSVC 14.51. Migrasi dependency diperlukan jika toolchain mendatang menghapus dukungan `/await`.
- Library/font converter dan halaman lama masih sebagian menggunakan CDN. Aset demo/pembaca sudah lokal, tetapi seluruh produk belum memiliki instalasi/cache offline.
- PPT ke PDF dan PDF ke PPT di converter masih placeholder. Banyak kartu katalog juga bukan bukti tool sudah berfungsi.
- Word/PDF dan spreadsheet perlu audit akurasi layout; jangan menjanjikan konversi bolak-balik sempurna.
- PDF terenkripsi/rusak belum memiliki alur khusus untuk memasukkan password; saat gagal muncul pesan kesalahan.
- PDF.js mengikuti versi lama converter. Audit dependency dan lisensi perlu dilakukan sebelum rilis komersial; jangan menganggap distribusi vendor sudah selesai hanya dari catatan sumber.

## Pengujian yang sudah dilakukan

- QA 17 September 2026: lihat `QA_REPORT.md` untuk hasil terperinci, lokasi HTML/APK/Windows terbaru, cara mengulang tes, serta batas verifikasi. Engine asli, rendering PDF, alur editor, transformasi PDF dasar, dan unduhan kedua native build lolos. UI browser/perangkat nyata tetap belum diverifikasi. Tampilan produk tidak diubah pada sesi QA.

- Pemeriksaan sintaks JavaScript baru serta skrip inline halaman terkait.
- `git diff --check`.
- HTTP 200 untuk halaman dan aset lokal pada localhost port 8080.
- PDF.js lokal berhasil membaca PDF sumber 88 halaman dan mengambil ukuran halaman pertama. Ini bukan uji render visual seluruh buku.
- Pengujian dengan mock: kontrol animasi, data yang diedit, navigasi, reduced motion, dan penghentian ketika tab tersembunyi.
- Pengujian dengan mock: handoff converter mempertahankan Blob/nama file dan menyembunyikan tombol flipbook untuk output non-PDF.
- Pengujian logika: sampul, spread isi, halaman terakhir, portrait, dan PDF satu halaman.
- Belum ada QA browser otomatis/visual yang tuntas. Alat browser sesi sebelumnya tidak tersedia. Pengguna telah membuka halaman sendiri dan memberikan screenshot.
- Pengujian awal sebagian ad hoc. Suite permanen ekspor kini ada di `tests/export.test.cjs` dan `tests/test_build.py`: round-trip proyek, validasi, kelengkapan aset, escaping metadata, dan perlindungan ekstraksi ZIP.
- `flutter analyze` lolos untuk wrapper native. Build APK percobaan berhasil dan isi paket diverifikasi membawa viewer, tiga JPEG, dan animasi statistik.
- Build Windows release berhasil setelah compatibility define MSVC diterapkan. Hasil berupa ZIP portable yang berisi `sarvamaya_book.exe`, DLL, aset buku, dan animasi. Belum diuji dengan menjalankan aplikasi pada perangkat Android/Windows.
- Uji HTTP layanan build: request tanpa token dan akses `.git`/`.build`/path traversal ditolak.
- `tests/save-location.test.cjs` menguji lokasi/nama, penulisan handle, cleanup kegagalan, cancel tanpa download, streaming hasil build, dan fallback memakai mock. Dialog native browser belum diuji langsung.

## Status Git saat handoff ini ditulis

- Branch `main`, remote `origin` ke repo PDF Project.
- Terakhir: `11669dc` (coming-soon guard + multi-column Excel) sudah di-push; `git status` bersih saat dicek. Aturan sesi ini: setiap update yang oke langsung commit + push.
- Periksa `git status`/`git log` lagi sebelum bekerja; status ini adalah snapshot, bukan status real-time.

## Kandidat pekerjaan selanjutnya

Daftar ini untuk perencanaan, bukan instruksi mengerjakan semuanya sekaligus:

1. QA alur nyata: konversi → flipbook → buka sampul → animasi, termasuk PDF besar dan ponsel.
2. Optimalkan rendering PDF besar tanpa memasang kembali batas yang sudah dicabut pengguna.
3. Autosave/pemulihan edit lebih lanjut; simpan/buka proyek manual sudah ada.
4. Editor elemen animasi grafik/proses pada PDF, posisi dan ukuran yang bisa diatur.
5. QA hasil HTML/APK/Windows pada browser/perangkat nyata dan penyiapan signing rilis.
6. Konversi Word/PPT yang lebih andal sebelum menjual subscription. (Progres 17 Sep: PDF→Word/PPT/Excel rebuilt + PPTX→PDF via LibreOffice; sisa: Word fidelity/format dan 18 kartu mati dibangun per rak.)
7. Login, paket, billing, dan distribusi APK setelah kebutuhan serta layanan pendukung ditetapkan. (Dikonfirmasi: ditunda — benahi dalam dulu.)

### 17 September 2026 — navigasi tengah dan Home

Navigasi preview dipusatkan, tombol Home kembali langsung ke sampul. Home juga disertakan pada template ekspor HTML/APK/Windows; paket native lama harus dibuild ulang untuk mendapat perubahan. Tombol dinonaktifkan di sampul, saat membuka PDF, dan selama pembalikan halaman. Tes engine asli/editor untuk Home dan ekspor HTML lolos; tampilan browser belum diperiksa langsung. File: flipbook.html, assets/flipbook.css/js, assets/export/index.html dan viewer.js, serta tes QA. Belum commit/push.

## Perbandingan vs iLovePDF & usulan roadmap (17 September 2026)

Usulan pengguna dari perbandingan visual iLovePDF vs Sarvamaya. Disimpan sebagai backlog, bukan klaim fitur sudah rilis.

### Keunggulan Sarvamaya saat ini (perlu verifikasi kode)

- PDF to Flipbook: ada (`flipbook.html`, transfer dari converter via IndexedDB).
- Animasi Flipbook: ada sebagai demo (`animation.html`) + overlay statistik per halaman di pembaca; panel editor di `flipbook.html` disembunyikan sementara atas permintaan pengguna.
- Notebook PDF: ada (`notebook.html`, chat/ringkas/podcast/mindmap ala NotebookLM, 100% klaim browser — perlu QA lanjutan).
- Create a Workflow: BELUM ada builder asli. Kartu `Create a workflow` di `index.html` saat ini hanya link ke `converter.html?tool=merge-pdf`. Jangan diklaim sebagai pipeline otomatis sebelum diimplementasikan.

### Usulan tambahan (backlog, belum diimplementasikan)

A. AI dokumen lanjut:
- Chat multi-PDF (5–10 dokumen, cross-doc analysis).
- Audio/Podcast from PDF (narasi natural / dua pembicara).
- PDF Mind Map Generator interaktif.

B. Kreatif/media/visual:
- PDF to Video / Presentation Reel (MP4 + transisi + musik).
- Embed 3D/AR/audio/QR multimedia ke PDF.
- High-Res Poster Tiling (split A0/A1 ke A4/A3 untuk print rumahan).

C. Finansial/legal/lokal:
- Integrasi e-Meterai + tanda tangan tersertifikasi.
- Smart Bank Statement to Excel (mutasi bank lokal rapi).
- Bilingual Translator side-by-side dengan layout terjaga.

D. Keamanan & teknis:
- Client-Side / Local Processing Mode (Wasm, zero-upload privacy).
- Flatten PDF (kunci form/anotasi/layer).
- Remove Blank Pages otomatis (hasil scan).

### Quick-win roadmap usulan

1. Ekosistem flipbook dulu (USP utama): Export HTML5 / Embed Link / QR Code Share.
2. Workflow Builder beneran: simpan resep rutin (misal Batch Resize + Watermark + Protect).
3. e-Meterai / Digital Signature Indonesia untuk segmen bisnis/instansi/UMKM.

### 17 September 2026 — redesign cream elegant GenZ (beda dari iLovePDF)

Permintaan pengguna: UI jangan mirip iLovePDF, bikin elegan + GenZ. Pilihan: vibe clean cream elegant, scope semua halaman, nama tetap PDF Tools.
- `index.html`: hero serif Fraunces + Jakarta Sans, nav pill sticky, marquee strip, kartu rounded 22px border ink + shadow chunky, featured Flipbook/Notebook/Animasi, footer dark. Logika tools/filter/href dipertahankan.
- `converter.html`: tema krem, sidebar/workspace/dropzone/CTA diselaraskan; ID dan logika convert tidak diubah.
- `notebook.html`: nav + header diselaraskan ke tema krem; grid editor tidak diubah.
- Baru `assets/theme-cream.css`: override tema untuk `flipbook.html` + `animation.html` tanpa mengubah layout engine; kedua halaman me-link file ini.
- `flipbook.html`: copy heading dibuat playful; struktur/preview/kontrol tetap.
- Verifikasi: `git diff --check` lolos, `node --check` flipbook/viewer lolos, HTTP 200 untuk /, converter, flipbook, notebook, animation, theme-cream.css. Belum QA visual browser/device. Belum commit/push.

### 17 September 2026 — English copy

User request: use English. Homepage hero/cards/footer plus converter/notebook/flipbook static shell translated to English. Cream GenZ theme unchanged. Deep converter option/hint strings inside `converter.html` script still partly Indonesian — follow-up if full English catalog is wanted. Verified diff-check + HTTP 200. No visual browser QA. Not committed/pushed.

### 17 September 2026 — business direction (paid later)

User confirmed: product goes paid (subscription) later. User DB + login are wanted but DEFERRED — fix the inside first.
- Current truth: no user DB, no login, no billing. `server.py` only has a local build token for APK/EXE jobs. Subscription prices/quotas not final (old discussion examples Rp59.000/Rp590.000, Rp149.000/Rp1.490.000 were examples only).
- Deferred plan (do NOT build yet without go-ahead): choose auth/DB stack, password hashing, sessions, tiers/quotas, billing provider, privacy story for local-first files. Keep `.env`/credentials out of git when that phase starts.
- Immediate focus per user: polish interiors first (converter/flipbook/notebook internals) before auth/billing.

### 17 September 2026 — interiors quick pass (English)

Choice: all-interiors quick pass. Static shells of `flipbook.html` (sidebar, export panel, empty states), `notebook.html` (sources, auto-generate, AI mode, studio, welcome, chat), `animation.html` (hero) translated to English; `lang` set to `en`. Reader-facing JS strings in `assets/flipbook.js` (cover/page status, load states, errors) and `assets/export/viewer.js` (cover label, alt text, missing-image hint) translated. Export-file internals (`flipbook-export.js` package strings, converter tool-option/hint/error strings) left for a follow-up pass.
- Verified: `node --check` flipbook/viewer/animation OK, `node tests/export.test.cjs` PASS, 8 Python build tests OK, HTTP 200 all pages. No browser/device visual QA. Not committed/pushed.

### 17 September 2026 — pdf-to-excel quick fix (real user doc)

User tested PDF to Excel on an image/design-heavy portfolio: one giant truncated text cell per page, spaced display type (`P O R T F O L I O`), repeated decor words. Root cause: `pdfToExcel` dumped all `getTextContent()` items into one cell per page — no line structure, no scan guard.
- Fix in `converter.html`: group items into visual lines by Y position, sort left-to-right, rejoin single-char display type, output `Page/Line/Text` rows (cap 300 lines/page, 2000 chars/cell), throw a clear error when no text is extractable, and append a `README` sheet warning when text is thin (design/scan PDF, OCR roadmap).
- Verified: inline-script `node --check` OK, heuristic mock test OK (`PORTFOLIO` rejoin + normal line), HTTP 200 converter. No real-file end-to-end (no OCR path yet). Not committed/pushed.

### 17 September 2026 — OCR for pdf-to-excel (Tesseract.js)

User asked for real OCR. Implemented in `converter.html` (`pdfToExcel` only):
- New dependency: Tesseract.js **v5.1.1**, Apache-2.0, upstream `https://github.com/naptha/tesseract.js`, loaded lazily from `https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js` (CDN URL verified HTTP 200). Loads ONLY when a page has zero embedded text, so normal converts stay fast. Like other converter libs, it needs internet; offline story still applies to export packages only.
- Flow: page without text → render to canvas (max ~1600px) → `recognize(canvas, 'eng+ind')` with % progress → lines go to Excel with `Source=OCR` (vs `Text`). Columns now `Page/Line/Source/Text`. OCR failures fall back to empty-page counting, never crash the convert. README sheet reports text/OCR/empty counts.
- Verified: inline-script `node --check` OK, Tesseract CDN reachable, HTTP 200 converter. NOT verified: real-file OCR end-to-end in a browser (needs CDN + time per page), big-doc OCR speed, PDF-to-Word OCR (still old path). Not committed/pushed.

### 17 September 2026 — OCR quality gate (artwork pages)

User's real result: OCR hallucinated garbage rows (`4 = >. Nin A`, `| a. ©)`) on full-artwork display-type pages (39/42/45), while embedded-text pages (41/44) were fine. Cause: Tesseract reads document text, not decorative display type — it guesses symbols instead of staying silent.
- Fix in `converter.html` (`ocrPageToLines`): drop lines with <3 letters or <40% alphanumeric, then reject the whole page unless mean word confidence ≥50 and ≥40% of kept lines look word-like. Rejected pages count as empty (honest blank, noted in README) instead of fake rows.
- Verified: gate mock test OK (garbage page → 0 rows, normal paragraph → 3 rows), inline `node --check` OK, HTTP 200. NOT verified: real-file reconvert in browser (user to retest). Not committed/pushed.

### 17 September 2026 — OCR gate v2 (poster case)

User showed the real page: a full-artwork Telkomsel Awards poster (no table at all). Honest expectation set: no tool turns poster artwork into a meaningful spreadsheet; best case is a few display words (`Telkomsel/AWARDS/2021/26th ANNIVERSARY`) tagged OCR.
- Fix: line filter counts digits too (≥3 alnum chars, ≥40% alnum ratio) so years like `2021` survive; page-level confidence/wordish gate unchanged.
- Verified: gate mock v2 OK (poster → 4 lines incl `2021`, garbage → 0, normal → 2), inline `node --check` OK, HTTP 200. NOT verified: real browser reconvert. Pushed per auto-push rule.

### 17 September 2026 — pages-as-images in Excel (ExcelJS)

User clarified: images must stay images — every PDF page viewable in Excel, content untouched. Implemented in `converter.html` (`pdfToExcel`):
- New dependency: ExcelJS **4.4.0**, MIT, upstream `https://github.com/exceljs/exceljs`, lazy-loaded from `https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js` (CDN verified HTTP 200, ~948KB, loads only when this tool runs). SheetJS can't embed images, so ExcelJS now builds the whole workbook; SheetJS stays for Excel-to-PDF.
- Output sheets: `Pages (Images)` (each page rendered JPEG ≤1200px, labeled, row heights fitted), `PDF Extract` (searchable text/OCR), conditional `README`. Also fixed: embedded-text rows were mislabeled `OCR`, now correctly `Text`.
- Verified: ExcelJS API smoke test in Node OK (valid PK zip with image + text sheets), inline `node --check` OK, HTTP 200. NOT verified: real-file browser run (needs CDN + render time for 50+ pages), large-file memory. Pushed per auto-push rule.

### 17 September 2026 — editable text under page images

User: images work, but text can't be edited (expected — JPEG pixels aren't editable). Fix in `converter.html`: under each page image, the `Pages (Images)` sheet now adds merged, wrapped, editable cells with that page's text lines (`[Text|line N]` / `[OCR|line N]`); artwork-only pages get an empty editable placeholder row instead. Editing cells never alters the picture above (noted in sheet + README).
- Verified: ExcelJS mergeCells smoke OK, inline `node --check` OK, HTTP 200. NOT verified: real-file browser run. Pushed per auto-push rule.

### 17 September 2026 — side-by-side layout (image left, text right)

User screenshot showed them clicking text inside the picture trying to edit it (understandable — editable cells were hidden below tall images). Fix: `Pages (Images)` now puts the picture in A–H and editable text cells in J–M on the SAME rows — visible without scrolling. Overflow past 20 lines continues full-width below; artwork pages get a full-width note row. README updated.
- Verified: smoke OK (13-col + J:M merge), inline `node --check` OK, HTTP 200. NOT verified: real-file browser run. Pushed per auto-push rule.

### 17 September 2026 — Word + PPT borongan (shared core)

User: PDF must become Word, Excel, PPT — all real. Implemented in `converter.html`:
- Shared `pdfContentPages()` core (text lines + OCR gate + page images in ONE pdf.js pass; also speeds up Excel). `pdfToExcel` refactored onto it — output unchanged.
- PDF→Word v2 via docx **9.7.1** (MIT, dolanmiu/docx, jsDelivr IIFE, lazy-load): real `.docx` with Page headings, embedded page images, editable paragraphs (OCR lines gray italic). Old HTML-`.doc` path gone.
- PDF→PPT v2 via PptxGenJS **4.0.1** (MIT, gitbrent/pptxgenjs, jsDelivr min bundle, lazy-load): real `.pptx`, one slide per page, contain-fit image (nothing cropped), editable text in speaker notes. Placeholder gone — no more fake PDFs.
- Safe DOM previews for `.docx`/`.pptx`; generic preview branch de-XSSed (filenames via textContent).
- Verified: Node smoke OK for both libs (valid PK outputs), inline `node --check` OK, HTTP 200, 13 Python tests OK. NOT verified: real-file browser runs (CDN + render time). Pushed per auto-push rule.

### 17 September 2026 — dedupe decorative repeats (core)

User's PPT notes showed `TV PROGRAM x3`, `GRAPHIC PACKAGE x3`, `TELKOMSEL AWARDS 2021 x3`: design PDFs draw display type multiple times (shadows/outlines), and raw extraction repeats it. Added `dedupeLine()` in the shared core (consecutive-word + whole-line exact-repeat collapse) — fixes Word, Excel, and PPT notes at once.
- Verified: 7-case mock OK (repeats collapse, prose untouched), inline `node --check` OK, HTTP 200. NOT verified: real-file browser reconvert (user to retest). Pushed per auto-push rule.

### 17 September 2026 — borongan: coming-soon guard + multi-column tables

User said "gas kabeh". Two items shipped in `converter.html`:
- Coming-soon guard: unknown `?tool=` ids (the 18 dead cards) no longer silently open the wrong tool — a banner names the requested tool and says it isn't built yet (roadmap, not swapped). Sidebar still offers the 14 working tools.
- Multi-column tables: shared core splits visual lines at wide X gutters (`cellsOf`, gap>50, no column cap, spaced-type legacy path protected). Excel `PDF Extract` table gains dynamic `Col 1..N` when columns exist, prose keeps one `Text` column. Word/PPT/notes/side-cells still use the joined line.
- Verified: splitter mock OK (table→2 cells, prose→1, spaced→PORTFOLIO), inline `node --check` OK, HTTP 200. NOT verified: real bank-statement/table PDF end-to-end. Pushed per auto-push rule.

### 17 September 2026 — PDF to Markdown (penting → gas)

User confirmed Markdown matters (AI food, notes, blogs). Implemented in `converter.html`:
- Core lines now carry `size` (max font) + `bold` (majority chars) — additive only, teammate's no-truncation semantics kept (verified `converter-limits` still passes).
- Pure `pagesToMarkdown()`: median body size → `#`/`##`/`###` thresholds, bold lines `**`, bullets/numbered normalized, consecutive same-shape multi-col lines → real Markdown tables (first line = header). Titles `#`, per-page `## Page N`. New `pdfToMd` tool + dispatch + TOOLS entry (index card goes live automatically).
- FEATURE_CHECKLIST.md synced (18 tools, Markdown row, backlog 13) — file owner Codex, touched minimally; see TEAM_WORK.
- Verified: builder mock OK (9/9 constructs incl. table), inline `node --check` OK, HTTP 200, converter-limits + pdf-edit + 16 Python OK. NOT verified: real-file browser run. Pushed per auto-push rule.

### 17 September 2026 — rencana 18 kartu mati (per rak, barnet dikonfirmasi user)

Cepat (browser-only, pdf-lib/jsPDF): Watermark (stempel teks/gambar + opacity), Page numbers (footer angka), Crop (CropBox margin), PDF to Markdown (pakai inti ekstraksi + cells → MD), AI Summarizer (wiring ulang mesin notebook), Unlock (hapus password yang diketahui via pdf-lib; tanpa password = cracking, tidak dikerjakan).
Sedang (browser, butuh riset): Edit PDF (overlay teks/gambar/shape, bukan reflow), Sign (tanda tangan gambar; tersertifikasi butuh PKI/backend), Forms (isi form — pdf-lib; bikin form lebih berat), OCR PDF searchable (Tesseract boxes + teks transparan di atas gambar), Scan (kamera HP via getUserMedia + jalur image→PDF; scanner TWAIN butuh backend), Compare (render dua PDF + diff piksel/teks).
Backend (server lokal, pola soffice): Protect (pdf-lib tidak bisa enkripsi — butuh qpdf/PyPDF), PDF/A (Ghostscript), Repair (qpdf/gs rebuild; klaim jujur terbatas), Redact permanen (rasterize+rebuild atau backend — overlay tok menipu dan berbahaya), Translate (butuh API MT + biaya; layout dijaga seadanya), Workflow (terakhir — merangkai tool yang sudah jadi + resep localStorage).

### 17 September 2026 — full catalog audit (18 cards don't exist)

Scripted check (`audit-ids.py`): index catalog has 35 cards, converter implements 14 tools. **18 cards have no converter entry and no direct page — clicking them silently opens JPG to PDF** (`active='jpg-to-pdf'` fallback, no notice): workflow, edit-pdf, sign-pdf, watermark, unlock-pdf, protect-pdf, pdf-to-pdfa, repair-pdf, page-numbers, scan-to-pdf, ocr-pdf, compare-pdf, redact-pdf, crop-pdf, pdf-forms, ai-summarizer, translate-pdf, pdf-to-md. Entire PDF Security shelf is dead.
- The 14 real ones: jpg/pdf-to-jpg/merge/split/rotate/organize strong; pdf-to-word/pdf-to-excel/pdf-to-ppt rebuilt strong; word-to-pdf plain-text only (mammoth raw, 50k cap; `.doc` input will fail); excel-to-pdf 60-row text dump; html-to-pdf innerText only; compress levels barely differ (known QA note); ppt-to-pdf needs server+LibreOffice.
- Recommended next: honest "coming soon" guard for missing ids, then build one shelf at a time. No code changed in this audit. Pushed per auto-push rule.

### 17 September 2026 — Image to PDF for all image types

User: rename JPG→PDF so it covers every image type. Done in `converter.html` (+ index card); tool id `jpg-to-pdf` kept so old `?tool=` links keep working.
- Native via `<img>`: JPG/JPEG/PNG/WebP/GIF/BMP/SVG/AVIF/ICO. Special decoders lazy-loaded: TIFF via UTIF.js **3.1.0** (MIT, photopea/UTIF.js, jsDelivr), iPhone HEIC/HEIF via heic2any **0.0.4** (MIT, alexcorvi/heic2any, jsDelivr). Animated GIF / multi-page TIFF: first frame only (logged). Transparency flattened to white (was black). Sizeless SVGs rejected with a clear message.
- Verified: UTIF encode→decode round-trip smoke OK (exact API used); inline `node --check` OK; HTTP 200. NOT verified: real HEIC file end-to-end (no sample here), real TIFF in browser. Pushed per auto-push rule.

### 17 September 2026 — formal Excel Table (user: "ditambahi table")

User wants real editable tables in Excel. Fix: `PDF Extract` sheet is now a formal Excel Table (`PdfExtract`, style TableStyleMedium9, banded rows, filter buttons on Page/Line/Source/Text) via `ws.addTable` — sortable, filterable, editable cells. Side-by-side editable cells on `Pages (Images)` stay as-is.
- Verified: output unzipped and `xl/tables/table1.xml` contains `PdfExtract` (real table object, not just styled cells); inline `node --check` OK; HTTP 200. NOT verified: real-file browser run; true multi-column table reconstruction (X-split) still future work. Pushed per auto-push rule.

### 17 September 2026 — audit Word/PowerPoint + real PPTX→PDF backend

Honest audit of `converter.html`: Word to PDF works but strips to plain text (mammoth raw, 50k chars, no layout/images); PDF to Word emits editable HTML `.doc` (not real `.docx`, no layout/images); Excel to PDF dumps 60 rows as text lines; PPT to PDF and PDF to PPT were placeholders producing fake PDFs. User picked the backend path for PPTX→PDF.
- Implemented: `POST /api/convert/pptx-to-pdf` in `server.py` (loopback + token, `.pptx`/`.ppt` + magic validation, streams upload to temp, `soffice --headless --convert-to pdf`, PDF download response, always cleans temp; `office` flag added to `/api/capabilities`). Frontend `pptToPdf` uploads to the server, shows clear install/run-server errors, and no longer emits fake PDFs (also fixed user-filename innerHTML → textContent). PDF→PPT still placeholder (follow-up).
- Prereq: LibreOffice installed (`soffice` in PATH) + `python server.py`. README updated.
- Verified: 13 Python tests OK (8 old + 5 new: token/type/magic/503/success-stub), `py_compile` OK, inline `node --check` OK, HTTP 200. NOT verified: real soffice end-to-end (no LibreOffice on this machine). Pushed per auto-push rule.

### 17 September 2026 — soffice PATH fallback (Windows)

User installed LibreOffice but server still reported `office:false`: the Windows installer does not add `soffice` to PATH. Added `find_soffice()` checking `PATH` plus `ProgramFiles`/`ProgramFiles(x86)` `LibreOffice/program/soffice.exe`; used by capabilities + converter. Tests updated to patch `find_soffice`.
- Verified: `find_soffice()` locates the real install here, 13 tests OK. User must restart `server.py` (server code changed). Pushed per auto-push rule.

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

### 18 September 2026 - Animation editor continuation and layout repair

- Preserved Antigravity's uncommitted editor redesign. Removed conflicting global theme stylesheet; added scoped header, sidebar, inspector grids and mobile sizing. No normal flipbook layout changes.
- Fixed Office uploads to use the server token and raw document body; browser-supported raster images become actual PDFs through locally bundled pdf-lib 1.17.1 (MIT). Import failures retain the previous book. No file/page quota added.
- PDF zone bounds now use PDF.js viewport transforms; reloading matching zones retains assigned animation/link. Zones highlight existing PDF areas, not separately animated original text/artwork.
- Added shared animation-playback.js/css for editor preview and v2 HTML exports. Rotation and opacity survive animation; safe links support URL/page navigation; reduced motion is respected. Offline viewer retains v1 compatibility and aligns overlays on mixed aspect pages.
- Export includes local runtime assets/licenses and selects save location before packaging; cancelling the picker does not trigger a fallback download. Animation editor exports HTML ZIP only; its editable project persistence and APK/EXE integration remain future work.
- Passed animation-editor.test.cjs (real PDF.js rendering, Office request contract, image-to-PDF, zone reload, preview/page links, actual ZIP and PageFlip viewer, cancellation/error recovery), animation-playback.test.cjs, qa-runtime.cjs (seven page/viewport cases), qa-editor.cjs, export.test.cjs, save-location.test.cjs, and all 16 Python tests. JS syntax and diff checks passed; seven related localhost assets returned HTTP 200.
- New tests use ignored .build/qa-runtime dependencies. Run python tests/qa-office.py first to generate .build/qa-office/layout.docx.pdf for the animation-editor fixture; this requires LibreOffice and the existing Office QA dependencies.
- No interactive browser visual QA: CUA reports no enabled browsers/apps. DOM/layout assertions are not visual verification. Changes remain local, not committed or pushed.

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

### 22 September 2026 - Server mode LAN (--host) untuk akses PC lain

User mau PC lain membuka app dari server di PC ini. `server.py` sebelumnya bind 127.0.0.1 saja dan `trusted()` menolak Host non-loopback. Perubahan (file: `server.py`, `converter.html`, `tests/test_build.py`):
- Flag baru `--host` (default tetap `127.0.0.1`; isi `0.0.0.0` untuk mode LAN). Pesan startup menampilkan IP LAN yang terdeteksi.
- `trusted()` ditulis ulang: port Host harus sama dengan port server, nama host harus salah satu alamat mesin sendiri (loopback, IP LAN, hostname) via helper `local_addresses()`; cek Origin dipertahankan. Proteksi DNS-rebinding tetap ada untuk nama asing.
- Pesan error converter yang tadinya hardcoded `http://localhost:8080` kini memakai `location.host` dinamis.
- Batasan jujur: di jaringan LAN, siapa pun yang membuka halaman bisa memakai endpoint build/konversi (token sesi terbaca via capabilities oleh host tepercaya). Mode LAN hanya untuk jaringan tepercaya; jangan expose ke internet publik. Perlu aturan firewall inbound port 8080 di PC server (lihat README).

Validation: 21 Python tests OK (16 lama + 5 baru `LanHostTests`: Host IP LAN diterima, port salah/nama asing/Origin mismatch ditolak 403); `node --check` pada inline script converter yang diubah; end-to-end nyata `python server.py --host 0.0.0.0` lalu GET `/api/capabilities` via IP LAN 192.168.18.16 → HTTP 200. Default loopback tidak berubah perilaku (tes lama tetap hijau). README diperbarui dengan langkah firewall. Belum diuji dari browser PC lain yang sebenarnya; belum commit/push.

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
