"""English for the server's user-facing messages.

The server code writes its messages in Indonesian. When a page is shown in
English (assets/i18n.js sets the cookie mf_lang=en), server.py passes every
JSON "error" through english() before sending it. Messages with a varying part
(numbers, names, causes) are matched by PATTERNS. Anything not listed is
returned unchanged, so a missing entry shows Indonesian rather than nothing.
"""
import re

EXACT = {
    # --- book data checks
    'Versi buku tidak valid.': 'Invalid book version.',
    'Judul atau jumlah halaman tidak valid.': 'Invalid title or page count.',
    'Rasio halaman tidak valid.': 'Invalid page ratio.',
    'Animasi tidak valid.': 'Invalid animation.',
    'Halaman animasi tidak valid.': 'Invalid animation page.',
    'Nilai animasi tidak valid.': 'Invalid animation value.',
    'Data teks halaman tidak valid.': 'Invalid page text data.',
    'Halaman teks tidak valid.': 'Invalid text page.',
    'Posisi teks tidak valid.': 'Invalid text position.',
    'Isi teks halaman tidak valid.': 'Invalid page text.',
    'Data podcast tidak valid.': 'Invalid podcast data.',
    'Baris podcast tidak valid.': 'Invalid podcast line.',
    'Data terjemahan tidak valid.': 'Invalid translation data.',
    'Bahasa terjemahan tidak valid.': 'Invalid translation language.',
    'Halaman terjemahan tidak valid.': 'Invalid translation page.',
    'Data ringkasan tidak valid.': 'Invalid summary data.',
    'Tautan tidak valid.': 'Invalid link.',
    'Halaman tautan tidak valid.': 'Invalid link page.',
    'Posisi tautan tidak valid.': 'Invalid link position.',
    'Tujuan tautan tidak valid.': 'Invalid link target.',
    'Entry ZIP duplikat.': 'Duplicate ZIP entry.',
    'Metadata buku terlalu besar.': 'Book metadata is too large.',
    'Gambar halaman tidak lengkap.': 'Page images are incomplete.',
    'Teks buku tidak valid.': 'Invalid book text.',
    'Teks buku kosong atau terlalu besar.': 'The book text is empty or too large.',
    'Buku ini hampir tidak punya teks (hasil scan?). Jalankan OCR dulu.': 'This book has almost no text (a scan?). Run OCR first.',
    'Paket buku kosong.': 'The book package is empty.',
    'Data edisi terjemahan tidak valid.': 'Invalid translated edition data.',
    'Bahasa edisi terjemahan tidak valid.': 'Invalid translated edition language.',
    'Halaman edisi terjemahan tidak valid.': 'Invalid translated edition page.',
    # --- AI
    'PC penerjemah sedang offline. Coba lagi nanti.': 'The translation PC is offline. Try again later.',
    'PC penerjemah tidak menjawab. Coba lagi.': 'The translation PC did not answer. Try again.',
    'Terjemahan sudah tidak ditunggu.': 'That translation is no longer awaited.',
    'Akun tidak ditemukan.': 'Account not found.',
    'Kode referral tidak bisa dibuat.': 'The referral code could not be made.',
    'Dari jaringan ini sudah ada akun MyFlipbook. Masuk dengan akun yang sudah ada, atau hubungi kami bila jaringan ini dipakai bersama.':
        'There is already a MyFlipbook account from this network. Sign in with that account, or contact us if this network is shared.',
    'Kunci worker tidak valid.': 'The worker key is not valid.',
    'Build ini tidak sedang berjalan.': 'This build is not running.',
    'Ukuran hasil build tidak valid.': 'The size of the build result is not valid.',
    'Upload hasil build tidak lengkap.': 'The build result upload was incomplete.',
    'Antrean build sedang penuh. Coba lagi beberapa menit lagi.': 'The build queue is full. Try again in a few minutes.',
    'Pembayaran online sementara dinonaktifkan. Coba lagi nanti.': 'Online payment is paused for now. Please try again later.',
    'AI tidak menghasilkan ringkasan. Coba lagi.': 'The AI did not produce a summary. Try again.',
    'Teks yang distabilo kosong.': 'The highlighted text is empty.',
    'Fitur AI belum aktif di server ini (pembayaran belum disiapkan).': 'AI features are not turned on on this server yet (payments are not set up).',
    'AI belum diatur di server (SUMOPOD_API_KEY di .env).': 'AI is not set up on the server (SUMOPOD_API_KEY in .env).',
    'Layanan AI tidak bisa dihubungi. Cek koneksi internet server.': "The AI service could not be reached. Check the server's internet connection.",
    'AI tidak mengembalikan terjemahan yang valid. Coba lagi.': 'The AI did not return a valid translation. Try again.',
    'Teks kosong atau terlalu panjang.': 'The text is empty or too long.',
    'Teks kosong atau terlalu besar.': 'The text is empty or too large.',
    'Bahasa tujuan tidak didukung.': 'That target language is not supported.',
    'Bahasa tujuan tidak didukung penerjemah gratis.': "The free translator doesn't support that language.",
    'Penerjemah gratis belum dipasang di server (pip install argostranslate, lalu python free_translate.py --install).': 'The free translator is not installed on the server (pip install argostranslate, then python free_translate.py --install).',
    'Halaman tidak valid (maks 40 per permintaan).': 'Invalid pages (max 40 per request).',
    'Halaman tidak valid.': 'Invalid page.',
    'Halaman ini tidak punya teks.': 'This page has no text.',
    'Terlalu banyak teks dalam satu permintaan.': 'Too much text in one request.',
    # --- builds / conversions
    'Kompiler .NET (csc.exe) tidak ditemukan.': 'The .NET compiler (csc.exe) was not found.',
    'Pembuka EXE gagal dikompilasi. Unduh log build untuk rinciannya.': 'The EXE launcher failed to compile. Download the build log for details.',
    'Nama EXE pembaca terlalu panjang.': 'The reader EXE name is too long.',
    'Nama plugin tidak valid.': 'Invalid plugin name.',
    'Microsoft Edge / Google Chrome tidak ditemukan di komputer ini.': 'Microsoft Edge / Google Chrome was not found on this computer.',
    'File HTML kosong.': 'The HTML file is empty.',
    'Halaman HTML terlalu lama dicetak (lebih dari 90 detik).': 'The HTML page took too long to print (over 90 seconds).',
    'Browser gagal mencetak HTML ini ke PDF.': 'The browser could not print this HTML to PDF.',
    'Halaman web terlalu lama dimuat (lebih dari 90 detik).': 'The web page took too long to load (over 90 seconds).',
    'Halaman web ini gagal dicetak ke PDF.': 'This web page could not be printed to PDF.',
    'File Office tidak valid (arsip ZIP tidak terbaca).': 'Invalid Office file (its ZIP archive cannot be read).',
    'File Office lama tidak valid.': 'Invalid old-format Office file.',
    'Konversi kehabisan waktu (file terlalu besar/rumit?).': 'The conversion timed out (file too large or complex?).',
    'LibreOffice gagal mengonversi file ini.': 'LibreOffice could not convert this file.',
    'LibreOffice tidak menghasilkan PDF yang valid.': 'LibreOffice did not produce a valid PDF.',
    'Lokasi aset build tidak valid.': 'Invalid build asset location.',
    'Flutter belum terpasang.': 'Flutter is not installed.',
    'Dependensi Flutter gagal disiapkan. Unduh log build untuk rinciannya.': 'Flutter dependencies could not be set up. Download the build log for details.',
    'Build gagal. Unduh log build untuk rinciannya.': 'The build failed. Download the build log for details.',
    'EXE hasil build tidak ditemukan.': 'The built EXE was not found.',
    'Build tidak ditemukan.': 'Build not found.',
    'Hasil belum tersedia.': 'The result is not ready yet.',
    'Kirim file .html / .htm.': 'Send an .html / .htm file.',
    'Ukuran file HTML tidak valid (maksimal 20 MB).': 'Invalid HTML file size (max 20 MB).',
    'Ekstensi file harus .html atau .htm.': 'The file extension must be .html or .htm.',
    'Tipe file tidak sesuai dengan alat konversi.': "The file type doesn't match the conversion tool.",
    'File presentasi kosong.': 'The presentation file is empty.',
    'Ukuran upload tidak valid.': 'Invalid upload size.',
    'Ekstensi file tidak cocok dengan tipe konten.': "The file extension doesn't match its content type.",
    'Sesi build tidak valid. Refresh halaman.': 'Invalid build session. Refresh the page.',
    'Permintaan build tidak valid.': 'Invalid build request.',
    'Flutter tidak tersedia.': 'Flutter is not available.',
    'Masih ada build berjalan. Tunggu hingga selesai.': 'A build is still running. Wait until it finishes.',
    # --- links / search
    'Alamat link tidak ditemukan.': 'The link address was not found.',
    'Link ke alamat jaringan internal tidak diizinkan.': 'Links to internal network addresses are not allowed.',
    'Tempel link yang diawali http:// atau https://.': 'Paste a link that starts with http:// or https://.',
    'Link mengarah ke alamat yang tidak didukung.': 'The link points to an unsupported address.',
    'File dari link terlalu besar (maksimal 60 MB).': 'The file at the link is too large (max 60 MB).',
    'Tempel link dulu.': 'Paste a link first.',
    'Batas pencarian harian tercapai. Coba lagi besok, atau pasang OPENALEX_API_KEY di server.': 'Daily search limit reached. Try again tomorrow, or set OPENALEX_API_KEY on the server.',
    'Layanan pencarian tidak bisa dihubungi. Cek koneksi internet server.': "The search service could not be reached. Check the server's internet connection.",
    'Buku tidak dikenal.': 'Unknown book.',
    'Tulis kata kunci 2-200 karakter.': 'Type keywords of 2-200 characters.',
    'Buku ini tidak punya berkas PDF.': 'This book has no PDF file.',
    # --- requests
    'Permintaan harus JSON.': 'The request must be JSON.',
    'Permintaan terlalu besar.': 'The request is too large.',
    'JSON tidak valid.': 'Invalid JSON.',
    'Permintaan tidak valid.': 'Invalid request.',
    'Ukuran file tidak valid atau terlalu besar.': 'Invalid or too large file size.',
    'Upload tidak lengkap.': 'The upload is incomplete.',
    'Tidak ditemukan.': 'Not found.',
    'Akses hanya dari localhost proyek.': "Access only from the project's localhost.",
    'Akses ditolak.': 'Access denied.',
    # --- accounts / Google
    'Silakan masuk dulu untuk memakai My Library.': 'Please log in to use My Library.',
    'Silakan masuk dulu.': 'Please log in first.',
    'Login Google belum diatur di server (GOOGLE_CLIENT_ID).': 'Google sign-in is not set up on the server (GOOGLE_CLIENT_ID).',
    'Token Google tidak valid.': 'Invalid Google token.',
    'Login Google ditolak. Coba lagi.': 'Google sign-in was refused. Try again.',
    'Google tidak bisa dihubungi. Cek koneksi internet server.': "Google could not be reached. Check the server's internet connection.",
    'Login Google ditolak (token bukan untuk aplikasi ini atau email belum diverifikasi Google).': "Google sign-in was refused (the token isn't for this app, or Google hasn't verified the email).",
    'Format email tidak valid.': 'Invalid email format.',
    'Password minimal 8 karakter.': 'The password needs at least 8 characters.',
    'Email sudah terdaftar. Silakan masuk.': 'This email is already registered. Please log in.',
    'Link verifikasi tidak valid.': 'Invalid verification link.',
    'Link verifikasi tidak valid atau sudah kedaluwarsa. Minta kirim ulang dari halaman masuk.': 'The verification link is invalid or expired. Ask for a new one on the login page.',
    'Terlalu sering. Coba lagi 15 menit lagi.': 'Too often. Try again in 15 minutes.',
    'Akun Google tidak valid.': 'Invalid Google account.',
    'Terlalu banyak percobaan. Coba lagi 15 menit lagi.': 'Too many attempts. Try again in 15 minutes.',
    'Email atau password salah.': 'Wrong email or password.',
    'Email belum diverifikasi. Buka link di email dari MyFlipbook, atau kirim ulang emailnya.': "Email not verified yet. Open the link in the email from MyFlipbook, or send the email again.",
    # --- payments
    'Pembayaran belum diaktifkan di server ini.': 'Payments are not turned on on this server.',
    'Gateway pembayaran menolak permintaan.': 'The payment gateway refused the request.',
    'Gateway pembayaran tidak bisa dihubungi. Coba lagi sebentar.': 'The payment gateway could not be reached. Try again shortly.',
    'Pilih metode pembayaran.': 'Choose a payment method.',
    'Event callback tidak dikenal.': 'Unknown callback event.',
    'Signature callback tidak valid.': 'Invalid callback signature.',
    'Paket ini belum disiapkan untuk pembayaran dolar.': "This plan isn't set up for dollar payments yet.",
    'Lemon Squeezy tidak mengembalikan halaman checkout.': 'Lemon Squeezy did not return a checkout page.',
    'Signature webhook tidak valid.': 'Invalid webhook signature.',
    'Gateway pembayaran menolak transaksi.': 'The payment gateway refused the transaction.',
    'Status pembayaran tidak bisa dicek.': 'The payment status could not be checked.',
    'Signature notifikasi tidak valid.': 'Invalid notification signature.',
    'Mata uang tidak didukung.': 'Currency not supported.',
    'Invoice hanya tersedia untuk pembayaran yang sudah lunas.': 'Invoices are only available for completed payments.',
    'Paket atau periode tidak valid.': 'Invalid plan or period.',
    'Order tidak ditemukan.': 'Order not found.',
    'Nominal pembayaran tidak cocok dengan order.': "The payment amount doesn't match the order.",
    'Simulasi pembayaran tidak aktif.': 'Payment simulation is off.',
    'Webhook gateway tidak aktif.': 'Gateway webhook is off.',
    'Langganan tidak dikenal.': 'Unknown subscription.',
    'Callback gateway tidak aktif.': 'Gateway callback is off.',
    'Referensi transaksi tidak cocok.': "The transaction reference doesn't match.",
    'Notifikasi gateway tidak aktif.': 'Gateway notifications are off.',
    # --- My Library
    'File arsip rusak.': 'The library file is damaged.',
    'File arsip rusak atau diubah.': 'The library file is damaged or was changed.',
    'Proyek tidak lengkap.': 'The project is incomplete.',
    'Data proyek terlalu besar.': 'The project data is too large.',
    'PDF proyek tidak valid.': "The project's PDF is invalid.",
    'File proyek tidak valid.': 'Invalid project file.',
    'Buku tidak ditemukan.': 'Book not found.',
    'File arsip tidak ditemukan.': 'Library file not found.',
    'Buku tidak ditemukan di arsipmu.': 'Book not found in your library.',
    'Proyek terlalu besar untuk arsip (maksimal 300 MB).': 'The project is too large for the library (max 300 MB).',
    'Sampul harus JPEG (maksimal 2 MB).': 'The cover must be a JPEG (max 2 MB).',
    'Jenis ekspor tidak dikenal.': 'Unknown export type.',
    'File ekspor terlalu besar untuk arsip.': 'The export file is too large for the library.',
    'Ekspor tidak ditemukan.': 'Export not found.',
    'Masa coba gratis 7 harimu sudah habis. Upgrade ke Pro untuk memakai fitur ini.':
        'Your 7-day free trial has ended. Upgrade to Pro to use this feature.',
    'Jatah 3 share gratis habis. Upgrade ke Pro untuk share tanpa batas.':
        'Your 3 free shares are used up. Upgrade to Pro for unlimited sharing.',
    # --- Share link
    'Silakan masuk dulu untuk membagikan buku.': 'Please sign in to share a book.',
    'Batas tautan berbagi paket ini sudah penuh. Hapus tautan lama atau upgrade paket.':
        "This plan's share-link limit is full. Delete old links or upgrade your plan.",
    'Ruang berbagi paket ini sudah penuh. Hapus tautan lama atau upgrade paket.':
        "This plan's share space is full. Delete old links or upgrade your plan.",
    'File share bukan buku flipbook yang valid.': 'The shared file is not a valid flipbook.',
    'Tautan berbagi tidak ditemukan.': 'Share link not found.',
}

PATTERNS = [
    (r'Layanan AI menolak permintaan \((\d+)\)\. ?(.*)', r'The AI service refused the request (\1). \2'),
    (r'Gambar halaman (\d+) bukan JPEG\.', r'Page image \1 is not a JPEG.'),
    (r'Layanan pencarian menolak permintaan \((\d+)\)\.', r'The search service refused the request (\1).'),
    (r'([^.]+) menolak permintaan \((\d+)\)\.', r'\1 refused the request (\2).'),       # "OAPEN …", one source
    (r'([^.]+) tidak bisa dihubungi\.', r'\1 could not be reached.'),
    (r'Email gagal dikirim: (.*)', r'The email could not be sent: \1'),
    (r'Link tidak bisa dibuka \(HTTP (\d+)\)\.', r'The link could not be opened (HTTP \1).'),
    (r'Link tidak bisa dibuka: (.*)', r'The link could not be opened: \1'),
    (r'Arsip penuh: paket (.+) menyimpan (\d+) buku\. Hapus buku lama di My Library atau upgrade paket\.',
     r'Library full: the \1 plan keeps \2 books. Delete old books in My Library or upgrade your plan.'),
    (r'Ruang arsip paket (.+) penuh \((\d+) MB\)\. Hapus buku lama di My Library atau upgrade paket\.',
     r'The \1 plan library space is full (\2 MB). Delete old books in My Library or upgrade your plan.'),
]
_PATTERNS = [(re.compile(p, re.S), r) for p, r in PATTERNS]


def english(text):
    """English for one server message (unchanged when it isn't known)."""
    if not isinstance(text, str):
        return text
    if text in EXACT:
        return EXACT[text]
    for pattern, replacement in _PATTERNS:
        match = pattern.fullmatch(text)
        if match:
            return match.expand(replacement)
    # Several messages joined ("OAPEN tidak bisa dihubungi. Internet Archive …"): one by one.
    parts = re.split(r'(?<=\.) (?=[A-Z])', text)
    if len(parts) > 1:
        done = [english(part) for part in parts]
        if done != parts:
            return ' '.join(done)
    return text
