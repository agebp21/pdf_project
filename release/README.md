# Mengantre rilis MyFlipbook (untuk semua agen AI, di PC mana pun)

Sejak 31 Oktober 2026 (keputusan owner) hanya sesi **Claude di PC owner** yang commit ke `v2`,
push `v2`/`main`, dan men-deploy myflipbookpro.com. Agen lain — Codex, AI di PC lain, siapa pun —
menyerahkan pekerjaannya lewat GitHub dengan alur ini. Tidak perlu akses ke PC owner atau VPS.

## Alur

1. Ambil kode terbaru dan buat branch dari `origin/v2`:

   ```bash
   git fetch origin
   git switch -c agent/<nama-agen>-<topik> origin/v2      # contoh: agent/codex-notebook-quiz
   ```

2. Kerjakan dan uji di branch itu. Minimal: `node` untuk `tests/*.test.cjs` + `tests/qa-*.cjs`
   yang relevan, dan `python -m unittest discover -s tests`. Catat hasilnya apa adanya, termasuk
   tes yang gagal atau tidak bisa dijalankan.
3. Tambahkan satu file `release/<nama-branch-tanpa-agent/>.md` (contoh
   `release/codex-notebook-quiz.md`) berisi:

   ```markdown
   # <judul singkat>
   - Agen / PC: <nama agen, PC mana>
   - Dasar: origin/v2 @ <hash saat branch dibuat>
   - Ringkasan untuk owner: <apa yang berubah, dalam bahasa sederhana>
   - File utama: <daftar>
   - Tes: <perintah + hasil>
   - Perlu diperhatikan saat deploy: <migrasi DB, isi .env baru, restart admin, dll. — tanpa isi kunci>
   ```

4. Commit, lalu sebelum push perbarui dari `v2` lagi supaya bersih digabung:

   ```bash
   git fetch origin && git rebase origin/v2
   git push -u origin agent/<nama-agen>-<topik>
   ```

5. Selesai. Jangan push ke `v2`/`main`, jangan merge sendiri, jangan menyentuh VPS. Bila owner
   ingin, boleh juga membuka Pull Request di GitHub dari branch itu ke `v2` (tidak wajib).

## Yang dilakukan Claude (penerima)

`git fetch` → `git branch -r --list 'origin/agent/*'` → baca `release/*.md` di tiap branch →
tinjau diff, jalankan tes penuh → gabungkan ke `v2` (file `release/<…>.md` dipindah ke catatan
DEPLOY.md lalu dihapus) → deploy sesuai DEPLOY.md → hapus branch yang sudah dirilis.

## Aturan yang tetap berlaku

- Kunci, password, isi `.env` tidak pernah ditulis di repo atau chat.
- Teks tampilan: Bahasa Indonesia baku + Inggris, bukan Jawa.
- Jangan menimpa atau menghapus pekerjaan agen lain; satu branch per topik.
