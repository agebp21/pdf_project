# Panduan: menghubungkan AI lain ke API pemantauan MyFlipbook Pro

Untuk pemilik situs. Langkah demi langkah agar AI lain (ChatGPT, Claude, atau alur otomatis)
bisa membaca angka trafik dan pemakaian MyFlipbook Pro untuk pemantauan dan audit.
Rincian teknis API ada di [MONITORING_API.md](MONITORING_API.md).

## Yang perlu diketahui dulu

- **Alamat API:** `https://myflipbookpro.com/admin/api/...`
- **Kunci:** file `E:\pdf_project\.data\monitor-api-key.txt` (satu baris, diawali `mfa_`).
  Salinannya di VPS: `/root/myflipbook-monitor-api-key.txt`. Nama kuncinya `audit-ai`.
- **Yang bisa dibaca:** ringkasan (member, paket, order, pendapatan, buku), trafik per hari,
  status server, laporan CSV. **Tidak bisa:** daftar/email member, upload, daftar pengunjung,
  laporan PDF, dan tidak bisa mengubah apa pun.
- **Batas:** 60 permintaan per menit per kunci.

### Aturan keamanan (wajib)

1. Kunci hanya dimasukkan ke **kolom rahasia** (Authentication, Credentials, environment
   variable). Jangan ditempel di kotak chat AI, di dokumen, atau di grup WhatsApp.
2. **Satu AI / satu layanan = satu kunci.** Minta kunci baru untuk setiap AI, agar bisa dicabut
   sendiri-sendiri.
3. Kunci bocor atau tidak dipakai lagi → cabut segera (lihat bagian terakhir).

## Langkah 1 — Uji kunci di komputer sendiri

Buka **PowerShell**, jalankan:

```powershell
$k = (Get-Content E:\pdf_project\.data\monitor-api-key.txt).Trim()
Invoke-RestMethod https://myflipbookpro.com/admin/api/overview -Headers @{Authorization = "Bearer $k"}
```

Berhasil bila muncul angka seperti `members`, `paid`, `orders`, `visits`.
Pesan `401` = kunci salah/dicabut; `429` = terlalu sering, tunggu satu menit.

## Langkah 2 — Pilih cara menghubungkan

### Cara A — ChatGPT (Custom GPT dengan Actions)

Butuh akun ChatGPT Plus/Team.

1. Buka https://chatgpt.com/gpts/editor → **Create** → tab **Configure**.
2. Isi **Name**: `Auditor MyFlipbook`.
3. Isi **Instructions** (salin):

   > Kamu auditor trafik dan pemakaian MyFlipbook Pro. Ambil data hanya lewat Actions.
   > Saat diminta laporan: panggil `getOverview` dan `getVisits` (days=7, atau sesuai
   > permintaan). Sajikan dalam Bahasa Indonesia: pengunjung dan tampilan halaman per hari,
   > member baru, pemakaian fitur (konversi, AI, terjemahan, buku disimpan), order dan
   > pendapatan, serta hal tidak biasa (trafik turun/naik tajam, lonjakan dari satu negara atau
   > penyedia internet, disk server hampir penuh lewat `getServer`). Jangan mengarang angka.

4. Di bagian **Actions** → **Create new action**.
5. **Authentication** → **API Key** → **Auth Type: Bearer** → tempel isi file kunci → Save.
6. **Schema** → tempel seluruh teks di bawah ini:

```yaml
openapi: 3.1.0
info:
  title: MyFlipbook Pro monitoring
  version: "1.0"
  description: Read-only traffic and usage numbers of myflipbookpro.com.
servers:
  - url: https://myflipbookpro.com/admin
paths:
  /api/overview:
    get:
      operationId: getOverview
      summary: Members, plans, orders, revenue, books and the last 30 days of visits.
      responses:
        "200": { description: Overview numbers }
  /api/visits:
    get:
      operationId: getVisits
      summary: Traffic and feature use per day, top pages, referrers, devices and places.
      parameters:
        - name: days
          in: query
          required: false
          description: How many days back, 1 to 365 (default 30).
          schema: { type: integer, minimum: 1, maximum: 365, default: 30 }
      responses:
        "200": { description: Visit statistics }
  /api/server:
    get:
      operationId: getServer
      summary: Which settings are filled in (never their values), disk and database sizes.
      responses:
        "200": { description: Server status }
  /api/report.csv:
    get:
      operationId: getDailyReport
      summary: One CSV row per day (visitors, views, new members, conversions, AI, translation, books).
      parameters:
        - name: days
          in: query
          required: false
          schema: { type: integer, minimum: 1, maximum: 365, default: 30 }
      responses:
        "200": { description: CSV report }
```

7. **Privacy policy** (diminta ChatGPT untuk Actions): `https://myflipbookpro.com/privacy.html`.
8. Klik **Test** pada `getOverview` → harus muncul angka. Simpan GPT sebagai **Only me**
   (jangan dibagikan publik — siapa pun yang memakai GPT itu bisa membaca angka situs).
9. Pakai: ketik misalnya *"Buat laporan trafik 7 hari terakhir."*

### Cara B — Claude (Claude Code atau agen yang bisa menjalankan perintah)

1. Simpan kunci sebagai environment variable (sekali, lalu buka ulang terminal):

   ```powershell
   [Environment]::SetEnvironmentVariable('MYFLIPBOOK_MONITOR_KEY', (Get-Content E:\pdf_project\.data\monitor-api-key.txt).Trim(), 'User')
   ```

2. Beri perintah ke Claude:

   > Baca `E:\pdf_project\MONITORING_API.md`. Ambil data dengan kunci di environment variable
   > `MYFLIPBOOK_MONITOR_KEY` (jangan tampilkan kuncinya), lalu buat audit trafik 7 hari dan
   > tandai hal yang tidak biasa.

### Cara C — Laporan otomatis setiap hari di Windows (tanpa langganan AI)

Menyimpan laporan CSV setiap pagi ke folder, yang bisa diberikan ke AI apa pun.

1. Buat file `E:\pdf_project\.data\laporan-harian.ps1` berisi:

   ```powershell
   $k = (Get-Content E:\pdf_project\.data\monitor-api-key.txt).Trim()
   $out = "E:\pdf_project\.data\laporan"
   New-Item -ItemType Directory -Force $out | Out-Null
   $day = Get-Date -Format 'yyyy-MM-dd'
   Invoke-WebRequest "https://myflipbookpro.com/admin/api/report.csv?days=30" -Headers @{Authorization = "Bearer $k"} -OutFile "$out\laporan-$day.csv"
   Invoke-RestMethod "https://myflipbookpro.com/admin/api/overview" -Headers @{Authorization = "Bearer $k"} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 "$out\ringkasan-$day.json"
   ```

2. Jadwalkan setiap hari jam 07:00 (PowerShell, sekali):

   ```powershell
   schtasks /Create /TN "MyFlipbook laporan harian" /SC DAILY /ST 07:00 /TR "powershell -NoProfile -ExecutionPolicy Bypass -File E:\pdf_project\.data\laporan-harian.ps1"
   ```

3. Hasilnya di `E:\pdf_project\.data\laporan\`. Unggah file CSV/JSON itu ke AI mana pun untuk
   diaudit (file ini berisi angka, bukan kunci).

### Cara D — n8n / Make / Zapier (kirim ke WhatsApp, Telegram, atau email)

1. Buat **Credential** jenis *Header Auth*: nama `Authorization`, nilai `Bearer ` + isi kunci.
2. Alur: **Schedule** (setiap hari 07:00) → **HTTP Request** GET
   `https://myflipbookpro.com/admin/api/visits?days=1` dengan credential tadi → **AI**
   (ringkas dalam Bahasa Indonesia) → **Telegram / Email / WhatsApp**.

## Langkah 3 — Kelola kunci

Minta ke agen yang memegang akses VPS, atau jalankan sendiri di VPS (`cd /opt/pdf_project`):

| Tujuan | Perintah |
|---|---|
| Kunci baru untuk AI lain | `python3 admin_server.py --new-api-key nama-ai > /root/kunci-nama-ai.txt && chmod 600 /root/kunci-nama-ai.txt` |
| Lihat semua kunci (nama, dibuat, terakhir dipakai, jumlah pakai) | `python3 admin_server.py --list-api-keys` |
| Cabut kunci | `python3 admin_server.py --revoke-api-key nama-ai` |

Kunci yang dicabut langsung berhenti bekerja. Semua pembuatan dan pencabutan tercatat di
`.data/admin.log`. Kolom "terakhir dipakai" dan "jumlah pakai" membantu melihat apakah ada
yang memakai kunci di luar jadwal.
