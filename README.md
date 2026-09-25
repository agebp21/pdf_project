# MyFlipbook (Sarvamaya)

Aplikasi lokal untuk mengolah PDF, membuat flipbook dari sampul depan, dan menambahkan animasi statistik per halaman. Mulai kontribusi AI dari [AGENTS.md](AGENTS.md).

## Jalankan

```powershell
cd E:\PDF_Project
python server.py
```

Buka `http://127.0.0.1:8080/`. Default-nya server hanya menerima koneksi dari PC ini (loopback). Jika port 8080 sudah terpakai oleh server proyek, gunakan yang sudah aktif atau hentikan server tersebut terlebih dahulu. `python server.py --port 8081` juga tersedia.

### Akses dari PC lain di jaringan yang sama

1. Jalankan server mode LAN: `python server.py --host 0.0.0.0` (catat IP yang ditampilkan, mis. `http://192.168.18.16:8080/`).
2. Di PC ini, izinkan port di firewall (PowerShell sebagai Administrator, sekali saja):
   ```powershell
   New-NetFirewallRule -DisplayName "MyFlipbook (8080)" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
   ```
3. Di PC lain (satu WiFi/jaringan), buka `http://<IP-PC-ini>:8080/`.

Catatan: mode LAN hanya untuk jaringan tepercaya (WiFi rumah/kantor). Semua PC di jaringan yang membuka halaman bisa memakai endpoint build/konversi; jangan expose ke internet publik.

HTML, CSS, dan JavaScript tidak membutuhkan build frontend. Python memakai standard library. Flutter dibutuhkan hanya untuk APK/EXE, bukan ekspor HTML atau penyimpanan proyek.

## Akun, paket, dan pembayaran

- Halaman: `login.html` (masuk/daftar) dan `account.html` (paket, checkout, riwayat pembayaran). Tombol Masuk/akun ada di nav semua halaman (`assets/auth.js`).
- Backend: `accounts.py` (stdlib). SQLite di `.data/myflipbook.sqlite3` (diabaikan Git; ubah lewat `MYFLIPBOOK_DB`). Password PBKDF2-SHA256, session cookie HttpOnly + SameSite=Lax, hanya hash token yang disimpan. Login dibatasi 5 gagal / 15 menit per IP+email.
- Paket (ubah di `PLANS` pada `accounts.py`): Free Rp0 (tool browser, preview flipbook, simpan proyek); Pro Rp99.000/bulan atau Rp990.000/tahun (ekspor flipbook HTML offline + build APK, juga ekspor editor animasi); Business Rp149.000/bulan atau Rp1.490.000/tahun (+ build EXE).
- **Paywall ekspor** aktif setiap `python server.py` jalan (lokal maupun hosting); `--no-paywall` untuk pemakaian internal. Server yang menegakkan: template ekspor (`assets/export/index.html`, `viewer.js`, `viewer.css`) hanya diberikan ke akun ber-hak `export`, build APK/EXE dicek per paket. Tombol ekspor diberi label PRO/BUSINESS dan menjelaskan paywall sebelum dialog simpan.
- Pembayaran utama: **Tripay** (QRIS, Virtual Account, e-wallet). Isi `TRIPAY_API_KEY`, `TRIPAY_PRIVATE_KEY`, `TRIPAY_MERCHANT_CODE` (dari dashboard Tripay → Merchant → API; sandbox dulu, `TRIPAY_PRODUCTION=1` untuk live). User memilih metode bayar di halaman akun (daftar channel aktif diambil dari Tripay), lalu diarahkan ke halaman checkout Tripay. Callback `https://<domain>/api/billing/tripay/callback` dikirim otomatis per transaksi; dicek HMAC-SHA256 body mentah + nomor referensi Tripay. Tripay dipakai bila ketiga variabelnya terisi.
- **Dolar (pembeli luar negeri): Lemon Squeezy** (merchant of record, pajak luar negeri diurus Lemon Squeezy). Harga USD: Pro $9.99/bulan atau $99/tahun, Business $19.99/bulan atau $199/tahun (`usd_monthly`/`usd_yearly` dalam sen di `PLANS`). Buat produk langganan dengan 4 variant di dashboard Lemon Squeezy (harga harus sama), isi `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_SIGNING_SECRET`, dan `LEMONSQUEEZY_VARIANT_{PRO,BUSINESS}_{MONTHLY,YEARLY}`. Webhook: URL `https://<domain>/api/billing/lemonsqueezy/webhook`, event minimal `subscription_created` dan `subscription_payment_success`. Pembayaran pertama dicatat dari `subscription_created` (membawa nomor order), perpanjangan otomatis dari `subscription_payment_success` (billing_reason renewal) — tiap invoice memperpanjang paket sekali. Halaman Pricing punya pilihan Rp/$ (default Rupiah untuk browser/zona waktu Indonesia, dolar untuk lainnya).
- Alternatif: **Midtrans Snap**. Isi `MIDTRANS_SERVER_KEY` (sandbox `SB-...`; `MIDTRANS_PRODUCTION=1` untuk live). Di dashboard Midtrans, set *Payment Notification URL* ke `https://<domain>/api/billing/midtrans/notify`. Notifikasi dicek signature SHA-512 + nominal; paket diperpanjang tepat sekali per order.
- Tanpa key, mode lokal memakai **simulasi pembayaran** (tombol di halaman akun) untuk uji alur. Di mode hosting tanpa key, checkout dimatikan (kecuali `MYFLIPBOOK_MOCK_PAYMENTS=1`).
- Mode lokal (tanpa `--public-host`) tidak mewajibkan login, sama seperti sebelumnya.

## Hosting

```bash
TRIPAY_API_KEY=DEV-xxx TRIPAY_PRIVATE_KEY=xxx TRIPAY_MERCHANT_CODE=T0000 MYFLIPBOOK_BASE_URL=https://myflipbook.id \
python server.py --host 127.0.0.1 --port 8080 --public-host myflipbook.id --public-host www.myflipbook.id
```

- Jalankan di belakang reverse proxy HTTPS (nginx/Caddy) yang meneruskan `Host` dan `X-Forwarded-For`, mis. nginx: `proxy_pass http://127.0.0.1:8080; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; client_max_body_size 200m;`.
- `--public-host` mengaktifkan mode hosting: cookie `Secure`, token konversi/build hanya untuk user login, Word/Excel/PPT→PDF butuh login (paket Free cukup), APK butuh Pro, EXE butuh Business. `--insecure-cookies` hanya untuk uji tanpa HTTPS.
- Uji callback sandbox dari PC ini: `ngrok http 8080`, lalu jalankan server dengan `--public-host <subdomain>.ngrok-free.app` dan `MYFLIPBOOK_BASE_URL=https://<subdomain>.ngrok-free.app` supaya Tripay bisa memanggil callback.
- Contoh variabel: [.env.example](.env.example). Konversi Office butuh LibreOffice di server; build APK/EXE butuh Flutter (EXE hanya di Windows).
- Batasan saat ini: belum ada reset password via email, verifikasi email, atau halaman admin; server satu proses (ThreadingHTTPServer) cocok untuk skala kecil. Build native tetap satu antrean.

## Buat dan ekspor buku

1. Pilih **PDF to Flipbook**, lalu unggah PDF. Atau klik **Jadikan Flipbook** pada hasil converter yang berupa PDF.
2. Halaman pertama menjadi sampul. Klik **Buka sampul** untuk membaca isi.
3. Pilih halaman tujuan, masukkan judul/angka, pilih posisi, lalu **Terapkan ke halaman**.
4. Isi judul buku di bagian **Simpan & ekspor**.

| Tombol | Hasil dan cara menggunakan |
|---|---|
| Simpan proyek | File `.smflipbook` berisi PDF sumber dan konfigurasi animasi; buka melalui pilihan proyek tersimpan untuk melanjutkan edit |
| Download HTML offline | ZIP berisi `index.html`, gambar, engine, konfigurasi, CSS/JS, dan lisensi; ekstrak semuanya lalu buka `index.html` tanpa server/internet |
| Build APK Android | Server lokal membangun APK Flutter yang menyertakan halaman dan animasi; unduh setelah build selesai |
| Build EXE Windows | ZIP aplikasi portable; ekstrak semua file lalu jalankan `sarvamaya_book.exe`, bersama DLL dan folder `data` |

Proyek disimpan secara manual, belum autosave. File `.smflipbook` adalah bahan edit; ZIP HTML adalah buku untuk dibaca. Jangan menukar kedua format saat impor.

### Pilih lokasi simpan

Tombol **Simpan sebagai…** membuka dialog untuk memilih folder dan nama file. Proyek/HTML meminta lokasi sebelum pengemasan; APK/Windows meminta lokasi saat tombol simpan hasil build diklik. Membatalkan dialog tidak memicu download otomatis. Jika File System Access API tidak tersedia, aplikasi memakai download biasa sesuai pengaturan browser. Folder build internal `.build/` tidak berubah.

Implementasi mengikuti [panduan File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access): pemilih file dipanggil saat klik, sebelum pemrosesan asinkron. Dialog native belum diuji melalui otomasi browser.

## Prasyarat native

- Flutter SDK di PATH, dengan dependensi dikunci melalui `native/reader/pubspec.lock`.
- APK: Android SDK, JDK, dan lisensi Android yang sudah diterima.
- Windows: Windows, Visual Studio dengan toolchain C++, serta SDK Windows.
- Word (DOCX/DOC), Excel (XLSX/XLS/CSV), dan PowerPoint (PPTX/PPT) ke PDF memakai LibreOffice lokal. Jalankan `python server.py`; tanpa LibreOffice, konversi menampilkan pesan yang jelas dan tidak menghasilkan PDF pengganti.
- Layout, tabel, gambar, dan pengaturan cetak diproses oleh LibreOffice. Font yang tidak tersedia atau fitur khusus Microsoft Office dapat tampil berbeda. Excel mengikuti print area, orientasi, dan page breaks dokumen; CSV memakai pengaturan cetak bawaan karena tidak menyimpan layout.
- Build pertama dapat memakai internet untuk mengambil dependensi. Buku yang sudah dikemas tidak membutuhkan internet.
- Windows pembaca memerlukan Microsoft Edge WebView2 Runtime. Runtime ini tidak disertakan di ZIP.
- APK saat ini memakai signing debug bawaan template Flutter untuk pengujian lokal. Belum siap sebagai rilis Play Store. EXE belum ditandatangani dengan sertifikat penerbit.
- Judul buku menentukan application ID Android: buku dengan judul sama memperbarui aplikasi yang sama, judul berbeda mendapat ID berbeda.
- Layanan build menjalankan satu pekerjaan pada satu waktu. Hasil dan log berada di `.build/<job-id>/`, diabaikan Git. Jangan menghapus file saat build berjalan. Belum ada pembersihan otomatis.
- Mode default server untuk lingkungan lokal tepercaya. Untuk publik, pakai mode hosting (`--public-host` di belakang HTTPS, lihat bagian Hosting).

## Pengujian

```powershell
node tests/export.test.cjs
node tests/save-location.test.cjs
node tests/office-export.test.cjs
python -m unittest discover -s tests -p test_*.py
node --check assets/flipbook.js
node --check assets/export/viewer.js
git diff --check
```

Untuk memeriksa wrapper native: jalankan `flutter pub get` lalu `flutter analyze` dari `native/reader`. Bila Flutter meminta dukungan symlink di Windows, layanan build dapat menyiapkan junction direktori plugin lokal tanpa mengubah Developer Mode global.

## Batas kemampuan saat ini

- Tidak ada batas ukuran/halaman buatan aplikasi, tetapi seluruh PDF masih dirender sebelum buku tampil; dokumen besar memakai waktu dan memori lebih banyak.
- Isi PDF menjadi gambar; animasi statistik adalah elemen tambahan di atas gambar tersebut.
- Grafik/proses interaktif masih tersedia sebagai demo, belum editor lengkap untuk PDF pengguna.
- PDF ke Word/PPT mempertahankan tampilan: background halaman tanpa teks + teks editabel di posisi aslinya (Word: frame per baris, PPT: text box). Word juga punya mode teks mengalir + tabel. Teks Type3/outline/scan tetap di gambar (scan dapat teks OCR). Font diganti ke font Office terdekat, jadi lebar baris bisa sedikit beda. Kartu katalog yang belum dibuat tampil "Coming soon" dan tidak bisa diklik.
- Converter lama masih sebagian memakai CDN. Offline yang dimaksud pada fitur ekspor adalah paket buku hasilnya.

Checklist status fitur dan bukti tes: [FEATURE_CHECKLIST.md](FEATURE_CHECKLIST.md).

Detail status dan koordinasi: [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md), [TEAM_WORK.md](TEAM_WORK.md).

### QA konversi Office asli

Suite API: `python -m unittest discover -s tests -p test_*.py`.
Untuk tes integrasi LibreOffice asli, pasang dependensi QA saja:

```powershell
python -m pip install --target .build/qa-python python-docx openpyxl pymupdf pillow
python tests/qa-office.py
```

Fixture dan hasil ada di `.build/qa-office/` (diabaikan Git). Tes memeriksa gambar dan page break Word, 75 baris Excel, dua sheet, hasil rumus, orientasi cetak, CSV, dan membuat PNG untuk pemeriksaan visual.

### Watermark, Page Numbers, Crop

Open the matching card in the converter. All three accept a PDF and a page range (`all` or `1-3,5`); results can be downloaded or sent to Flipbook. Watermark supports text or PNG/JPEG, position/size/opacity. Numbering supports a starting number and position. Crop accepts four margins in mm, relative to the displayed page, including rotated pages. Cropping hides content outside CropBox; it is not permanent redaction. No page/file quota is imposed; memory and format constraints remain.

Tests: `node tests/pdf-edit.test.cjs` and `node tests/pdf-edit-ui.test.cjs` (the QA-only dependencies in `.build/qa-runtime` are required, as described in QA_REPORT.md).

## Editor animasi

Buka `http://127.0.0.1:8080/animation.html`. Impor PDF, dokumen Office (memerlukan LibreOffice/server lokal), atau gambar raster yang didukung browser. Load konten memisahkan teks horizontal yang didukung menjadi elemen editable/animasi dan merender background tanpa teks tersebut. Teks raster, outline, atau rotasi tidak dipisahkan; font pengganti bisa mengubah layout. Tombol Pulihkan teks asli membatalkan ekstraksi halaman. Teks dan tombol tambahan juga tersedia.

Gunakan Preview untuk mencoba animasi, kemudian ekspor HTML ZIP dan ekstrak seluruh isinya sebelum membuka `index.html` secara offline. Dialog lokasi simpan digunakan bila browser mendukungnya; jika tidak, unduhan mengikuti pengaturan browser. Editor ini belum menyediakan simpan/buka proyek yang dapat diedit atau ekspor animasi APK/EXE.

Tes tambahan: `node tests/animation-playback.test.cjs` dan `node tests/animation-editor.test.cjs`. Tes editor memakai fixture `.build/qa-office/layout.docx.pdf` dari `python tests/qa-office.py` dan dependensi QA di `.build/qa-runtime`. Tes DOM bukan pemeriksaan visual browser.

Editor juga memisahkan gambar raster dan grup transparansi yang didukung menjadi elemen gambar animasi. Background satu halaman, grafis tanpa grup, serta logo yang sudah menyatu dalam gambar background tetap utuh; belum ada segmentasi/inpainting. Pada contoh PSJ, ilustrasi bangunan bisa dipisahkan, sedangkan logo di background belum. Tombol link diatur saat Edit dan dibuka lewat Preview/hasil ekspor; alamat domain tanpa skema dinormalisasi menjadi HTTPS.

### OCR dan pemisahan area pada editor

`Load konten` mencoba ekstraksi PDF asli terlebih dahulu, lalu OCR lokal jika tidak ada teks native yang berhasil dipisahkan. `OCR ulang halaman` memproses gambar seluruh halaman (berguna untuk dokumen campuran). Model Inggris, Indonesia, dan Melayu sudah disertakan; file dokumen tidak diunggah ke layanan OCR. Tulisan kecil/dekoratif bisa terlewat atau salah, sehingga teks hasil OCR perlu diperiksa.

`Pisahkan area gambar / logo` memungkinkan drag kotak pada halaman untuk membuat elemen gambar yang bisa dianimasikan. Pengisian bekas teks/area memakai perkiraan dari tepi, bukan rekonstruksi grafis sempurna; pola kompleks bisa meninggalkan artefak. `Pulihkan konten asli halaman` membatalkan ekstraksi. Hasil animasi termasuk OCR/area masuk HTML ZIP; ekspor APK/EXE editor ini belum terhubung ke backend v1.

Tes OCR nyata: `node tests/animation-ocr.test.cjs` (memerlukan tesseract.js 5.1.1 di .build/qa-runtime). Tambahkan path gambar sebagai argumen untuk QA lokal; contoh uji halaman infografis pada sesi ini memakai PSJ halaman 5 dan tidak ikut Git.
