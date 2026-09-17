# Sarvamaya native reader

Template Flutter untuk membungkus paket HTML flipbook yang sama pada Android dan Windows. `server.py` menyalin template ke `.build/native-workspace`, mengganti `assets/book`, lalu menjalankan build. Jangan menaruh dokumen pengguna ke template yang dilacak Git ini.

- Android: `webview_flutter`, memuat `assets/book/index.html` melalui `loadFlutterAsset`.
- Windows: `webview_windows`, memuat `data/flutter_assets/assets/book/index.html` di sebelah executable.
- Semua halaman dan animasi berada di aset lokal. Tidak ada koneksi layanan AI atau konten online di pembaca ekspor.
- APK memakai signing debug untuk pengujian. Signing rilis dan publikasi store belum disiapkan.
- Windows memerlukan WebView2 Runtime; paket ZIP harus mempertahankan seluruh DLL dan folder data.
- MSVC 14.51 memerlukan compatibility define untuk coroutine lama plugin `webview_windows 0.4.0`; pengaturan ada di `windows/CMakeLists.txt`, bukan patch pada vendor.

Gunakan **Build APK Android** atau **Build EXE Windows** pada PDF Project setelah menjalankan `python server.py`. Menjalankan template langsung tanpa injeksi aset hanya menampilkan pesan belum ada buku.

Dokumentasi API yang digunakan:

- https://pub.dev/packages/webview_flutter
- https://pub.dev/packages/webview_windows

Periksa analisis kode dengan `flutter analyze`. Rincian operasional dan batas kemampuan ada di [README proyek](../../README.md).
