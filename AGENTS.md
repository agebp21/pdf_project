# Panduan tim AI — PDF Project

## Mulai di sini

1. Baca file ini dan [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md).
2. Jalankan `git status --short` dan lihat diff sebelum mengedit. Perubahan lokal bisa merupakan pekerjaan pengguna atau agen lain; jangan ditimpa atau dibuang.
3. Cocokkan tugas terbaru pengguna dengan status aktual kode. Catatan handoff adalah konteks, bukan pengganti pemeriksaan kode.
4. Untuk koordinasi beberapa AI, gunakan [TEAM_WORK.md](TEAM_WORK.md). Dokumen ini tidak otomatis memerintahkan spawning agen atau pengerjaan seluruh backlog.

## Arah produk dan keputusan pengguna

- Satu aplikasi: konversi dokumen → hasil PDF → **Jadikan Flipbook** → tambah animasi/interaksi.
- Flipbook menyatu dalam PDF Project. `animation.html` sekarang editor animasi tersendiri dalam aplikasi yang sama; pembaca biasa tetap di `flipbook.html`. Lihat handoff terbaru untuk batas ekspor masing-masing.
- Gunakan engine flipbook dari `https://github.com/agebp21/sarvamaya-flipbook-studio`; sumber salinan ada di `assets/vendor/SOURCE.md`.
- Buku dimulai dari halaman pertama PDF sebagai sampul depan. Buka sampul dahulu, lalu tampilkan isi.
- Pengguna sudah meminta penghapusan batas 50 MB dan 100 halaman. Jangan memasang kembali batas ukuran/halaman tanpa arahan baru. Tangani dokumen besar lewat pengelolaan memori dan pemuatan bertahap.
- Rencana subscription: paket bertingkat dengan pembayaran bulanan/tahunan; tahunan lebih hemat dibanding 12 kali pembayaran bulanan. Harga dan kuota belum final.
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
