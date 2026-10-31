# Alur kerja dan rilis MyFlipbook (untuk semua agen AI, di PC mana pun)

Keputusan owner, 31 Oktober 2026:

- **PC lain (Codex, AI lain):** kerjakan dan **uji di lokal dulu**, baru commit dan push ke
  `v2` di GitHub.
- **PC owner (sesi Claude):** satu-satunya yang **men-deploy ke VPS** (myflipbookpro.com) dan
  memindahkan `main`. `main` selalu sama dengan yang sedang live.

## Untuk agen di PC lain

1. Mulai dari yang terbaru: `git fetch origin && git switch v2 && git pull --rebase origin v2`.
2. Kerjakan, lalu **uji di lokal** sebelum commit:
   - jalankan situs lokal (`python server.py --port <port>`; lihat README) dan coba
     perubahannya di browser, termasuk ukuran HP;
   - `node` untuk `tests/*.test.cjs` + `tests/qa-*.cjs` yang relevan, dan
     `python -m unittest discover -s tests`.
3. Commit dengan pesan yang jelas. Di badan pesan tulis **tes yang dijalankan dan hasilnya**
   apa adanya (termasuk yang gagal atau tidak bisa dijalankan), dan bila ada: hal yang perlu
   diperhatikan saat deploy (migrasi DB, variabel `.env` baru — tanpa isi kunci, perlu restart
   admin, dll.).
4. Sebelum push: `git pull --rebase origin v2`, uji ulang bila ada yang berubah, lalu
   `git push origin v2`.
5. Selesai. **Jangan men-deploy, jangan menyentuh VPS, jangan push ke `main`.** Bila ingin
   perubahan segera live, beri tahu owner; PC owner yang men-deploy.

Pekerjaan besar atau eksperimen boleh di branch sendiri (`agent/<nama>-<topik>`) dulu, lalu
digabung ke `v2` setelah lulus uji lokal.

## Untuk PC owner (sesi Claude) saat men-deploy

`git fetch` → tinjau commit baru di `origin/v2` sejak yang live (`git log origin/main..origin/v2`)
→ jalankan tes penuh pada `git archive` dari commit yang akan dirilis → deploy sesuai DEPLOY.md
(nama backup unik) → `main` disamakan dengan commit itu → catat di DEPLOY.md.

## Aturan yang tetap berlaku

- Kunci, password, isi `.env` tidak pernah ditulis di repo atau chat.
- Teks tampilan: Bahasa Indonesia baku + Inggris, bukan Jawa.
- Jangan menimpa atau menghapus pekerjaan agen lain.
