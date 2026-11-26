# Handoff MyFlipbookPro untuk agen lain

**Diperiksa 26 November 2026 (WIB).** Dokumen ini adalah peta awal. Sebelum bekerja, baca juga [AGENTS.md](AGENTS.md), [release/README.md](release/README.md), [DEPLOY.md](DEPLOY.md), dan status terbaru di [TEAM_WORK.md](TEAM_WORK.md). Jika dokumen lama berbeda dengan Git atau layanan yang sedang berjalan, periksa kondisi aktual dahulu.

## Proyek dan lokasi

| Kebutuhan | Lokasi |
|---|---|
| Situs publik | <https://myflipbookpro.com/> |
| Admin | <https://myflipbookpro.com/admin/> |
| Repository GitHub | <https://github.com/agebp21/pdf_project> |
| Checkout kerja terbaru di PC ini | `E:\pdf_project-release` (branch lokal `editor-release-20261029`, mengikuti `origin/v2`) |
| Worktree lain di PC ini | `E:\PDF_Project` (branch `v2`, saat pemeriksaan masih tertinggal; **jangan anggap otomatis terbaru**) |
| Kode live di VPS | `/opt/pdf_project` (**bukan** repository Git; hasil ekstraksi `git archive`) |
| Data dan konfigurasi live | `/opt/pdf_project/.data/` dan `/opt/pdf_project/.env`; tidak masuk paket rilis dan tidak boleh ditimpa |

Folder `E:\Nusantara_Mahayatra_LandingPage` adalah proyek **numa**, bukan MyFlipbookPro. Jangan menjalankan perintah Git MyFlipbookPro dari sana. VPS yang sama juga menjalankan proyek lain; jangan menyentuh layanan, Nginx, database, atau berkas proyek lain.

## Kondisi saat diperiksa

- `origin/main`: `da33e6e` — kode yang terakhir dirilis. Kartu beranda **Artikel & Tutorial** menuju `/artikel`.
- `origin/v2`: `5a72318` — kode yang sama ditambah commit dokumentasi deploy. Selisih dokumentasi dari `main` bukan fitur yang belum live.
- Checkout `E:\pdf_project-release` bersih dan berada di `5a72318` saat laporan dibuat.
- Layanan `myflipbook` dan `myflipbook-admin` aktif; beranda HTTPS merespons 200.
- Nilai commit dan status ini dapat berubah. Mulailah dengan `git fetch origin`, `git ls-remote origin refs/heads/main refs/heads/v2`, `git status --short --branch`, lalu baca log terbaru di `DEPLOY.md`.

## Bagian kode utama

- `server.py`: server situs, API publik, autentikasi, AI, dan rute statis.
- `admin_server.py` dan `admin/`: server serta antarmuka admin.
- `index.html`, `flipbook.html`, `notebook.html`, `editor.html`, `converter.html`: halaman produk.
- `assets/`: JavaScript, CSS, gambar, dan pustaka vendor. Jangan mengedit vendor tanpa prosedur pembaruan dependensi.
- `seo.py` dan `articles.py`: landing page, artikel/tutorial, metadata, robots, dan sitemap.
- `accounts.py`, `pricing.py`, `home_samples.py`: paket/kuota, harga/promo, dan sampel PDF beranda.
- `tests/`: pengujian Python dan JavaScript. `PROJECT_HANDOFF.md` berisi sejarah yang lebih panjang, tetapi beberapa bagian lama mungkin sudah tidak berlaku.

## Alur kerja agen di PC lain

1. Gunakan checkout Git yang bersih. Di PC baru, clone repository lalu ambil `v2`. Di PC ini, cek `E:\pdf_project-release` terlebih dahulu; jangan mengubah worktree `E:\PDF_Project` tanpa mengecek statusnya.
2. Ambil perubahan terbaru dari `origin/v2` dan periksa diff serta pekerjaan agen lain sebelum mengedit. Jangan reset atau membuang perubahan yang bukan milik sendiri.
3. Jalankan lokal dari root repo: `python server.py --port 8081`, lalu buka `http://127.0.0.1:8081/`. Port 8080 mungkin sudah dipakai. Untuk admin, baca opsi lokal pada `admin_server.py` dan `README.md`; gunakan data uji terpisah, bukan `.data` produksi.
4. Uji perubahan yang relevan dengan `node tests/<nama>.test.cjs`, `python -m unittest discover -s tests -p test_<nama>.py`, pemeriksaan browser desktop/HP, dan `git diff --check`. Jalankan suite lengkap sesuai [release/README.md](release/README.md) sebelum handoff; catat kegagalan lama dan kegagalan baru secara terpisah.
5. Commit dengan penjelasan perubahan dan hasil tes yang sebenarnya. Sinkronkan lagi `origin/v2`, lalu push ke `v2`. **Agen PC lain berhenti di sini**; jangan push ke `main` atau menyentuh VPS. Beri tahu pemilik commit yang siap dirilis.

## Akses dan pembaruan live

Keputusan pembagian kerja pada [AGENTS.md](AGENTS.md) dan [release/README.md](release/README.md): **PC owner/petugas rilis yang berwenang** menangani VPS dan pemindahan `main`. Instruksi pemilik yang eksplisit dapat mengubah tugas pada sesi tertentu; jangan menganggap akses Git otomatis berarti izin rilis.

Untuk petugas rilis yang berwenang:

1. Baca [DEPLOY.md](DEPLOY.md) secara utuh, terutama prosedur update dan log deploy. Cek `origin/main..origin/v2`, commit yang akan dirilis, hasil tes, serta perubahan data atau konfigurasi.
2. Rilis **hanya commit yang sudah di-push**. Buat arsip dari hash commit yang dipilih dengan `git archive`; jangan mengirim working tree atau `.env`.
3. Akses VPS melalui SSH key yang telah diberikan pemilik. Lokasi server, akun, dan contoh `ssh`/`scp` ada di `DEPLOY.md`. Jangan menebak password atau menyalin private key ke repo/chat.
4. Backup kode VPS dengan nama unik **sebelum** ekstraksi arsip. Pertahankan `/opt/pdf_project/.data/`, `.env`, dan hasil build. Jika ada migrasi database, backup database secara terpisah dan uji rencana rollback sebelum menjalankannya.
5. Ekstrak arsip ke `/opt/pdf_project`. Restart `myflipbook`; restart `myflipbook-admin` juga bila admin/backend terkait berubah. Periksa status layanan, log, endpoint publik/admin, dan alur fitur yang diubah.
6. Setelah live terverifikasi, samakan `main` dengan hash kode live, catat hash/backup/tes di `DEPLOY.md` dan `TEAM_WORK.md`, lalu push dokumentasi ke `v2`.

Saat laporan dibuat, layanan utama memakai `myflipbook.service` di port internal 8080 dan admin memakai `myflipbook-admin.service` di port internal 8091; HTTPS di depan keduanya melalui Nginx. Untuk membaca tanpa mengubah, petugas berwenang dapat memakai `systemctl is-active myflipbook myflipbook-admin` dan endpoint publik seperti `/`, `/api/capabilities`, `/admin/api/session`.

## Data dan keamanan

- Jangan commit, mengirim ke chat, atau mencetak isi `.env`, SSH private key, password admin, database member, dan file pengguna.
- `.data/home-samples/` menyimpan sampel PDF serta label ID/EN; `.data/pricing.json` dan `.data/ai-quotas.json` menyimpan pengaturan admin. Pertahankan semuanya saat rilis.
- Build APK/EXE dan sebagian pekerjaan terjemahan bergantung pada PC build; statusnya dapat berbeda dari status web. Lihat `DEPLOY.md`.
- Harga/paket dan klaim di artikel lama dapat tertinggal dari produk sekarang. Periksa kode serta tampilan live sebelum memperbarui konten SEO atau menyebut fitur sebagai aktif.

## Pemeriksaan cepat setelah rilis

```text
https://myflipbookpro.com/
https://myflipbookpro.com/api/capabilities
https://myflipbookpro.com/artikel
https://myflipbookpro.com/sitemap.xml
https://myflipbookpro.com/admin/api/session
```

Respons halaman/API perlu diperiksa bersama isi dan fungsi fitur yang diubah; status HTTP 200 saja tidak membuktikan semuanya bekerja. Untuk kesalahan, lihat log `journalctl` dari layanan yang relevan tanpa menampilkan rahasia.
