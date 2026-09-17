# PDF Tools / Sarvamaya Flipbook

Aplikasi lokal untuk mengolah PDF, membuat flipbook dari sampul depan, dan menambahkan animasi statistik per halaman. Mulai kontribusi AI dari [AGENTS.md](AGENTS.md).

## Jalankan

```powershell
cd E:\PDF_Project
python server.py
```

Buka `http://127.0.0.1:8080/`. Server hanya menerima koneksi loopback. Jika port 8080 sudah terpakai oleh server proyek, gunakan yang sudah aktif atau hentikan server tersebut terlebih dahulu. `python server.py --port 8081` juga tersedia.

HTML, CSS, dan JavaScript tidak membutuhkan build frontend. Python memakai standard library. Flutter dibutuhkan hanya untuk APK/EXE, bukan ekspor HTML atau penyimpanan proyek.

## Buat dan ekspor buku

1. Pilih **PDF to Flipbook**, lalu unggah PDF. Atau klik **Jadikan Flipbook** pada hasil converter yang berupa PDF.
2. Halaman pertama menjadi sampul. Klik **Buka sampul** untuk membaca isi.
3. Pilih halaman tujuan, masukkan judul/angka, pilih posisi, lalu **Terapkan ke halaman**.
4. Isi judul buku di bagian **Simpan & ekspor**.

| Tombol | Hasil dan cara menggunakan |
|---|---|
| Simpan proyek | File `.flipbook` berisi PDF sumber dan konfigurasi animasi; buka melalui pilihan proyek tersimpan untuk melanjutkan edit |
| Download HTML offline | ZIP berisi `index.html`, gambar, engine, konfigurasi, CSS/JS, dan lisensi; ekstrak semuanya lalu buka `index.html` tanpa server/internet |
| Build APK Android | Server lokal membangun APK Flutter yang menyertakan halaman dan animasi; unduh setelah build selesai |
| Build EXE Windows | ZIP aplikasi portable; ekstrak semua file lalu jalankan `sarvamaya_book.exe`, bersama DLL dan folder `data` |

Proyek disimpan secara manual, belum autosave. File `.flipbook` adalah bahan edit; ZIP HTML adalah buku untuk dibaca. Jangan menukar kedua format saat impor.

### Pilih lokasi simpan

Tombol **Simpan sebagai…** membuka dialog untuk memilih folder dan nama file. Proyek/HTML meminta lokasi sebelum pengemasan; APK/Windows meminta lokasi saat tombol simpan hasil build diklik. Membatalkan dialog tidak memicu download otomatis. Jika File System Access API tidak tersedia, aplikasi memakai download biasa sesuai pengaturan browser. Folder build internal `.build/` tidak berubah.

Implementasi mengikuti [panduan File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access): pemilih file dipanggil saat klik, sebelum pemrosesan asinkron. Dialog native belum diuji melalui otomasi browser.

## Prasyarat native

- Flutter SDK di PATH, dengan dependensi dikunci melalui `native/reader/pubspec.lock`.
- APK: Android SDK, JDK, dan lisensi Android yang sudah diterima.
- Windows: Windows, Visual Studio dengan toolchain C++, serta SDK Windows.
- PPTX/PPT to PDF: LibreOffice terpasang (`soffice` di PATH) + jalan via `python server.py`. Tanpa LibreOffice, tool ini menolak dengan pesan install — tidak ada lagi PDF placeholder.- Build pertama dapat memakai internet untuk mengambil dependensi. Buku yang sudah dikemas tidak membutuhkan internet.
- Windows pembaca memerlukan Microsoft Edge WebView2 Runtime. Runtime ini tidak disertakan di ZIP.
- APK saat ini memakai signing debug bawaan template Flutter untuk pengujian lokal. Belum siap sebagai rilis Play Store. EXE belum ditandatangani dengan sertifikat penerbit.
- Judul buku menentukan application ID Android: buku dengan judul sama memperbarui aplikasi yang sama, judul berbeda mendapat ID berbeda.
- Layanan build menjalankan satu pekerjaan pada satu waktu. Hasil dan log berada di `.build/<job-id>/`, diabaikan Git. Jangan menghapus file saat build berjalan. Belum ada pembersihan otomatis.
- Server ini untuk lingkungan lokal tepercaya, bukan backend subscription publik.

## Pengujian

```powershell
node tests/export.test.cjs
node tests/save-location.test.cjs
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
- PPT masih placeholder dan tidak melakukan konversi dokumen asli. Jangan menganggap semua kartu katalog sudah diimplementasikan.
- Converter lama masih sebagian memakai CDN. Offline yang dimaksud pada fitur ekspor adalah paket buku hasilnya.

Detail status dan koordinasi: [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md), [TEAM_WORK.md](TEAM_WORK.md).
