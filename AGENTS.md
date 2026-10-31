# Panduan tim AI — PDF Project

**Status terbaru25Oktober:** baca [HANDOFF_2026-10-25.md](HANDOFF_2026-10-25.md) terlebih dahulu; laporan23Oktober dan status live lama di dokumen lain bersifat historis.

## Mulai di sini

1. Baca file ini, **laporan terbaru [HANDOFF_2026-10-23.md](HANDOFF_2026-10-23.md)** (status live, keputusan owner, jebakan teknis), dan [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md).
2. Jalankan `git status --short` dan lihat diff sebelum mengedit. Perubahan lokal bisa merupakan pekerjaan pengguna atau agen lain; jangan ditimpa atau dibuang.
3. Cocokkan tugas terbaru pengguna dengan status aktual kode. Catatan handoff adalah konteks, bukan pengganti pemeriksaan kode.
4. Untuk koordinasi beberapa AI, gunakan [TEAM_WORK.md](TEAM_WORK.md). Dokumen ini tidak otomatis memerintahkan spawning agen atau pengerjaan seluruh backlog.
5. **Status terkini dan siapa mengerjakan apa: bagian "📌 Status terkini" di paling atas [TEAM_WORK.md](TEAM_WORK.md).** Perbarui bagian itu setiap selesai bekerja.
6. **Rilis hanya oleh Claude (keputusan owner, 31 Oktober 2026).** Commit ke `v2`, push `v2`/`main`, dan deploy ke myflipbookpro.com dikerjakan oleh sesi Claude di PC owner saja. Agen lain — termasuk AI di PC lain — tetap boleh mengerjakan kode lewat GitHub dengan alur di [release/README.md](release/README.md): `git fetch`, branch `agent/<nama>-<topik>` dari `origin/v2` terbaru, commit + tes di sana, tambahkan `release/<nama-branch>.md` (ringkasan, tes, catatan), lalu push branch itu. Jangan push ke `v2`/`main` dan jangan menyentuh VPS. Claude mengambil branch `origin/agent/*`, meninjau, menjalankan tes, menggabungkan, men-deploy, dan mencatat di DEPLOY.md.
7. **Sebelum menyentuh VPS / situs live (myflipbookpro.com): baca [DEPLOY.md](DEPLOY.md)** — satu prosedur deploy untuk semua agen, dan catat setiap deploy di "Log deploy". Yang di-deploy hanya commit yang sudah di-push; jangan pernah men-deploy file yang belum di-commit.
8. Kunci, password, dan isi `.env` tidak pernah ditulis di repo atau chat.

## Arah produk dan keputusan pengguna

- Satu aplikasi: konversi dokumen → hasil PDF → **Jadikan Flipbook** → tambah animasi/interaksi.
- Flipbook menyatu dalam PDF Project. `animation.html` sekarang editor animasi tersendiri dalam aplikasi yang sama; pembaca biasa tetap di `flipbook.html`. Lihat handoff terbaru untuk batas ekspor masing-masing.
- Gunakan engine flipbook dari `https://github.com/agebp21/sarvamaya-flipbook-studio`; sumber salinan ada di `assets/vendor/SOURCE.md`.
- Buku dimulai dari halaman pertama PDF sebagai sampul depan. Buka sampul dahulu, lalu tampilkan isi.
- Pengguna sudah meminta penghapusan batas 50 MB dan 100 halaman. Jangan memasang kembali batas ukuran/halaman tanpa arahan baru. Tangani dokumen besar lewat pengelolaan memori dan pemuatan bertahap.
- Nama produk: **MyFlipbook** (dulu PDF Tools). Key penyimpanan internal `pdf-tools-*` sengaja dipertahankan.
- Paket v2 (keputusan owner 19 Okt 2026): Basic (gratis) = preview + simpan proyek; Medium (Rp89.500/bln, Rp859.200/thn — tahunan hemat 20%) = AI ringkasan & terjemahan + ekspor HTML + My Library 50; Pro (Rp179.000/bln, Rp1.718.400/thn) = + APK & EXE, My Library 200 (podcast dihapus 20 Okt). Basic setelah uji coba 7 hari: semua alat PDF kecuali AI. Kuota hasil ringkasan per bulan (`accounts.SUMMARY_WORDS`: Medium 35.000 kata, Pro 60.000) = pedoman internal, TIDAK ditampilkan ke member; habis → pesan + tombol Upgrade ke Pro. Masa coba tidak disebut di teks publik (keputusan owner 20 Okt). Jangan membuka template `assets/export/{index.html,viewer.js,viewer.css}` untuk publik.
- Subscription sudah ada: `accounts.py` + `login.html`/`account.html`, Midtrans Snap. Harga di `PLANS` masih draf; jangan dianggap final. Mode hosting via `--public-host` (lihat README).
- Notebook PDF dan Flipbook Animation juga "Coming soon" (keputusan user 25 Sep): `server.py` `SOON_PAGES` menampilkan `coming-soon.html` saat paywall aktif; `--no-paywall` membuka halaman aslinya untuk internal.
- **Situs sudah live untuk publik (bukan trial):** jangan menampilkan alat tes / dummy, atau instruksi developer (python server.py, localhost, F12, "project server") di tampilan. Pesan error ditulis untuk pengguna umum.
- **Teks tampilan (UI, pesan error, artikel, email) wajib Bahasa Indonesia baku + Inggris — BUKAN bahasa Jawa**, meskipun owner chat pakai Jawa campur. 7 Okt sudah ada teks Jawa yang lolos ke popup login ("nang endi wae", "Mengko") dan menu Organize; sudah diperbaiki.
- Tool katalog yang belum dibuat tampil "Coming soon" (daftar `SOON` di `index.html`); hapus id dari daftar itu ketika tool-nya jadi.
- Ekspor HTML offline, simpan/buka proyek, dan build APK/EXE lokal sudah memiliki implementasi; lihat handoff untuk bukti pengujian dan batas rilis.

## Aturan perubahan

- Workspace: `E:\PDF_Project`. Repo proyek: `https://github.com/agebp21/pdf_project`, branch awal `main`.
- Ada repo induk di `E:\`. Selalu jalankan Git dari root PDF Project; jangan mengubah `.git` atau proyek di luar folder ini.
- Pertahankan frontend HTML/CSS/JavaScript statis, server lokal Python standard library untuk build, dan wrapper Flutter di `native/reader`.
- Jangan mengubah library vendor secara manual. Catat versi, sumber, dan lisensi bila mengganti dependency.
- `.venv`, file `.env`, kredensial, dan dokumen pribadi untuk pengujian tidak boleh ikut commit.
- Jangan menyebut placeholder sebagai konversi yang sudah berfungsi. Audit kode aktual dan `FEATURE_CHECKLIST.md` sebelum membuat klaim; catatan historis tentang placeholder PPT sudah digantikan implementasi baru.
- Judul/nama file/teks pengguna harus dimasukkan dengan `textContent` atau mekanisme aman; jangan interpolasi ke `innerHTML` tanpa sanitasi.
- Jangan mereset, membersihkan, atau menimpa perubahan agen lain. Saat konflik, koordinasikan kepemilikan file terlebih dahulu.
- Jangan menganggap daftar tugas sebagai izin deploy atau push baru. Ikuti instruksi pengguna dan kewenangan sesi yang sedang berjalan.

## Menjalankan lokal

Dari root proyek:

```powershell
python server.py
```

Jika server sudah berjalan, gunakan server itu. Halaman utama: `http://127.0.0.1:8080/`.

## Pemeriksaan sebelum handoff

- Jalankan `node --check` pada JavaScript yang diubah dan `git diff --check`.
- Periksa respons HTTP halaman/aset terkait. Jalankan `node tests/export.test.cjs` dan `python -m unittest discover -s tests -p test_*.py` untuk perubahan ekspor. Frontend tidak punya package manager; wrapper Flutter memiliki pubspec dan lockfile.
- Untuk perubahan flipbook, verifikasi sampul, halaman isi, halaman terakhir, PDF satu halaman, dan mode portrait/landscape sesuai lingkup perubahan.
- Untuk perubahan konversi, pastikan output PDF diteruskan utuh ke flipbook; hasil non-PDF tidak menawarkan tombol tersebut.
- Nyatakan dengan tepat apa yang diuji. Pemeriksaan sintaks, HTTP, dan pengujian dengan mock bukan pengujian UI browser.
- Ikuti batasan alat dan skill sesi terkait penggunaan browser; jangan mengklaim visual sudah diverifikasi bila belum.

## Akhir setiap pekerjaan

Perbarui `PROJECT_HANDOFF.md` bila status fitur atau keputusan berubah. Tambahkan ringkasan di `TEAM_WORK.md`: file yang disentuh, hasil, pengujian, keterbatasan, dan status commit/push. Sampaikan hasil kepada pengguna dalam bahasa Indonesia yang santai dan jelas.
