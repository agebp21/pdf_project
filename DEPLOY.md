# Deploy & Update myflipbookpro.com — prosedur siji kanggo kabeh agen AI

> Wajib diwaca sakdurunge ndemek VPS. Salah login = ke-ban fail2ban.
> Saben deploy **kudu** dicatet nang "Log deploy" nang ngisor, ben agen liyane ngerti kode live iku commit endi.

## 1. Login VPS (ojo salah!)

- **IP:** `38.103.170.218`, user `root`, **mung nganggo SSH key** (`C:\Users\SARVAMAYA-3\.ssh\id_ed25519`), dudu password.
  - OpenSSH: `ssh -o BatchMode=yes root@38.103.170.218 '...'`
  - paramiko: `key_filename=r'C:\Users\SARVAMAYA-3\.ssh\id_ed25519', allow_agent=False, look_for_keys=False`
- **OJO NATE** nebak password / retry buta — `fail2ban` aktif. Password ora tau ditulis nang repo, chat, utowo file iki.
- Detail VPS project sebelah (numa): `E:\Nusantara_Mahayatra_LandingPage\CODEX_VPS_GUIDE.md` (moco tok).

## 2. Sing ana nang VPS (ojo disentuh sing dudu duweke)

| Sing | Keterangan |
|---|---|
| `nusantaramahayatra.com` (numa) + `sarvamaya.id` | Situs live liyane (nginx, PM2, MySQL). **Ojo diowahi / dipateni.** |
| `/opt/pdf_project` | Kode MyFlipbook. **Dudu git repo** — isine hasil `git archive` saka commit sing di-deploy. |
| `/opt/pdf_project/.env` | Kunci-kunci (chmod 600). Ojo di-commit, ojo di-print isine. |
| `/opt/pdf_project/.data/` | Database member (`myflipbook.sqlite3`), `visits.sqlite3`, `library/` + `library.key` (wajib di-backup), `admin.log`. Deploy ora tau nyentuh folder iki. |
| `myflipbook.service` | App utama: `python3 server.py --host 127.0.0.1 --port 8080 --public-host myflipbookpro.com --public-host www.myflipbookpro.com` |
| `myflipbook-admin.service` | Panel admin (backend pisah): `python3 admin_server.py --host 127.0.0.1 --port 8091 --proxy` |
| `/etc/nginx/sites-enabled/myflipbookpro` | HTTPS (certbot, wis aktif). `/` → 8080, `/admin/` → 8091. Ojo senggol site liyane. |
| `/root/myflipbook-admin-password.txt` | Login admin (`admin` + password acak, chmod 600). **Ojo dikirim nang chat / ditulis nang repo.** |
| Translate buku (gratis) | VPS ora duwe Argos: batch terjemahan dikirim menyang PC build sing padha (long poll `/api/worker/translate/claim`), dijawab Argos PC. PC mati = 503 "PC penerjemah sedang offline". Sakwise VPS 4 GB: pasang Argos nang VPS, otomatis dienggo lokal. |
| Build APK/EXE | VPS ora duwe Flutter: pesenan build mlebu antrian, dijupuk **PC build** (PC owner, ikon systray `build_worker_tray.py` / `start-build-worker.bat`, otomatis nyala lewat shortcut Startup, kunci `BUILD_WORKER_KEY` padha nang `.env` VPS lan PC). PC mati = build ngantri. Status: `/api/capabilities` → `buildWorker: online/offline`. |

## 3. Prosedur update (kabeh agen nganggo cara iki)

1. **Lokal:** `git status` — yen ana owahan agen liya sing durung di-commit, **ojo di-deploy lan ojo dibuwang**; takon owner / agen sing nduwe. Sing di-deploy **mung commit sing wis di-push**.
2. Tes lokal kabeh lulus (`for f in tests/*.test.cjs tests/qa-*.cjs; do node "$f"; done` + `python -m unittest discover -s tests`).
3. Paket: `git archive --format=tar.gz -o mf-deploy.tgz HEAD`, kirim: `scp mf-deploy.tgz root@38.103.170.218:/root/`.
4. **Backup nang VPS dhisik:** `cd /opt && tar czf /root/pdf_project-code-backup-<tanggal>.tgz --exclude=pdf_project/.data --exclude=pdf_project/.build --exclude=pdf_project/__pycache__ pdf_project && ls -t /root/pdf_project-code-backup-*.tgz | tail -n +4 | xargs -r rm -f --`
   - `.build` (±800 MB hasil build APK/EXE) **ojo melu** dibackup; mung 3 backup kode paling anyar sing disimpen (kode wis aman nang git). 2026-10-06 disk VPS tekan 98% gara-gara 51 backup × 763 MB.
5. Pasang: `cd /opt/pdf_project && tar xzf /root/mf-deploy.tgz` (file anyar ditimpa, `.env`/`.data` aman).
6. Restart: `systemctl restart myflipbook` (lan `myflipbook-admin` yen `admin_server.py`/`admin/` owah). Cek `systemctl is-active ...`, `journalctl -u myflipbook -n 20`.
7. Verifikasi: `curl -s -o /dev/null -w "%{http_code}" https://myflipbookpro.com/api/capabilities` (200) lan `https://myflipbookpro.com/admin/api/session` (200).
8. Catet nang **Log deploy** nang ngisor + `TEAM_WORK.md`, commit & push.

Owahan nginx: backup file dhisik (`/root/nginx-myflipbookpro-backup-<tanggal>`), `nginx -t`, banjur `systemctl reload nginx`.
Ganti password admin: `python3 admin_server.py --hash-password` → ganti `ADMIN_PASSWORD_HASH` nang `.env` → `systemctl restart myflipbook-admin`.
Menehi paket tanpa bayar: `python3 admin_server.py --grant EMAIL business lifetime` (utowo `pro 30`); kecatet nang `.data/admin.log`.

## 4. Watesan

- **Firewall UFW (2026-10-06):** mung 22/80/443 sing mlebu; metu bebas. Kabeh situs (MyFlipbook, numa :3000, sarvamaya.id :3001/:3002) lewat nginx — tes app langsung saka njero VPS (`curl http://127.0.0.1:PORT`), dudu `IP:PORT` saka njaba. Port publik anyar kudu `ufw allow <port>/tcp`.
- **SSH mung nganggo key** (password dipateni owner 2026-10-06; backup config `/root/50-cloud-init.conf.bak-20261006`). Agen / PC anyar: tambahke public key-e nang `authorized_keys` (root utowo `deploy`) dhisik.

- VPS 2 GB RAM / 38 GB disk, dienggo bareng numa + sarvamaya.id. RAM mepet (±600 MB kosong) — ojo nglakoni proses abot (build, OCR massal) nang VPS. Owner arep upgrade nang RAM 4 GB.
- **Ojo install Flutter/Android SDK** nang VPS — build APK/EXE lewat PC build (`build_worker.py` nang PC owner, `start-build-worker.bat`).
- Paywall ON; pembayaran **dipause** (`PAYMENTS_PAUSED=1` nang `.env`, key Midtrans/Tripay/Lemon durung diisi) — upgrade member saiki lewat `--grant`. Nguripke: isi key gateway, tes, banjur guwang/setel `PAYMENTS_PAUSED=0` + `systemctl restart myflipbook`.
- Ojo ngganti password root / user lewat SSH; urusan kredensial domain-e owner.

## 5. Log deploy

| Tanggal | Commit live | Sing nglakoni | Cathetan |
|---|---|---|---|
| 2026-10-03 | (overlay manual) | agen liya | Deploy awal + HTTPS certbot. |
| 2026-10-04 11:18 | `1bf0565` | Claude | Kabeh fitur s/d panel admin; `myflipbook-admin.service` + nginx `/admin/`; backup `/root/pdf_project-code-backup-20261004.tgz`. **Owahan `index.html` (stiker "segera hadir" oranye) sing sadurunge wis live tanpa commit dadi ketimpa** — kudu di-commit dhisik banjur deploy maneh yen arep dibalekke. |
| 2026-10-04 (siang) | `374657f` | Claude | `PAYMENTS_PAUSED=1` ditambah ke `.env` live (pembayaran sementara mati; owner update payment gateway malam ini). Backup `/root/pdf_project-code-backup-20261004b.tgz`, `.env` lama `/root/pdf_project-env-backup-20261004b`. |
| 2026-10-04 (sore) | `02e3f55` | Claude | Antrian build APK/EXE kanggo PC build; `BUILD_WORKER_KEY` ditambah nang `.env` VPS lan PC (backup `.env` `/root/pdf_project-env-backup-20261004c`, kode `/root/pdf_project-code-backup-20261004c.tgz`). Worker mlaku nang PC owner, live `buildWorker: online`. |
| 2026-10-04 (sore 2) | `4b3b8f1` | Claude | Login: ganti akun saat sudah masuk. nginx: `www.myflipbookpro.com` -> 301 `https://myflipbookpro.com` (Google OAuth origin_mismatch); backup nginx `/root/nginx-myflipbookpro-backup-20261004b`, kode `/root/pdf_project-code-backup-20261004d.tgz`. |
| 2026-10-04 (sore 3) | `39b657b` | Claude | Google Drive picker: tab My Drive / Shared with me / Shared drives / Starred / Upload. Backup `/root/pdf_project-code-backup-20261004e.tgz`. |
| 2026-10-04 (sore 4) | `4280ef6` | Claude | Drive picker: BMP, AVIF, Google Drawings. (Kode-only, backup kode sebelumnya `/root/pdf_project-code-backup-20261004e.tgz`.) |
| 2026-10-04 (sore 5) | `1f65562` | Claude | Stiker "Coming soon" oranye di beranda dibalikin (owahan `index.html` agen liya, di-commit atas permintaan owner). Backup `/root/pdf_project-code-backup-20261004f.tgz`. |
| 2026-10-04 (sore 6) | `08a0567` | Claude | Jendela "Add source" bersama (assets/add-source.js) di Converter, AI Summarizer, Workflow. Backup `/root/pdf_project-code-backup-20261004g.tgz`. |
| 2026-10-04 (sore 7) | `a08f984` | Claude | Split PDF: pilih halaman dengan klik (tanpa checkbox), Shift+klik rentang, 🔍 baca halaman. (Kode-only; backup terakhir `/root/pdf_project-code-backup-20261004g.tgz`.) |
| 2026-10-04 (sore 8) | `5f24fde` | Claude | Tombol Upload / Google Drive di jendela Add source dibuat tegas (tidak terkesan disabled). Kode-only. |
| 2026-10-04 (sore 9) | `5b222fe` | Claude | Tombol Upload / Google Drive: bayangan dihapus, garis tegas saja. Kode-only. |
| 2026-10-04 (sore 10) | `0a171c2` | Claude | Translate buku penuh lewat PC build (Argos PC). Worker systray di-restart. Backup `/root/pdf_project-code-backup-20261004h.tgz`. |
| 2026-10-04 (sore 11) | `6ac013e` | Claude | Converter: tombol "📚 Open My Library" (dekat Choose files + kartu hasil). Kode-only. |
| 2026-10-04 (bengi) | `fe2c292` | sesi iki | Gateway Duitku (`ebe86a4`: provider, route `/api/payment/duitku/callback`, UI, tes) + takeout tombol debug log converter. Backup `/root/pdf_project-code-backup-20261004g.tgz` (jeneng tabrakan karo backup sore 6 — isine kode sadurunge deploy bengi). Verifikasi: capabilities 200, admin 200, "Toggle log debug" 0 nang live. Key Duitku durung diisi (Rupiah NONAKTIF, PAYMENTS_PAUSED=1 tetep). |
| 2026-10-04 (bengi 2) | `b6786da` | sesi iki | Organize grid koyo referensi (thumbnail asli, aksi per kartu, tanpa checkbox). Backup `/root/pdf_project-code-backup-20261004i.tgz`. Verifikasi: capabilities 200, `org-thumb` live OK. |
| 2026-10-04 (bengi 3) | `c120080` | sesi iki | Converter tanpa sidebar (1 kolom) + rapian organize. Backup `/root/pdf_project-code-backup-20261004j.tgz`. Verifikasi: capabilities 200, "Pick a converter" 0 nang live. |
| 2026-10-04 (bengi 4) | `202af29` | sesi iki | Drop zone converter kompak (ikon/judul/spasi dicilikke). Backup `/root/pdf_project-code-backup-20261004k.tgz`. Verifikasi: capabilities 200. |
| 2026-10-04 (bengi 5) | `308c521` | sesi iki | Converter 2 kolom (drop kiri, files kanan) + tombol ＋ Add more + append dijamin (duplikat persis diskip, input direset). Backup `/root/pdf_project-code-backup-20261004l.tgz`. Verifikasi: capabilities 200, "Add more" live OK. |
| 2026-10-04 (bengi 6) | `e97a587` | sesi iki | Ndandani layout converter sing jebol (grid Tailwind diganti CSS polos `.conv-cols`, organize max-h 62vh). Backup `/root/pdf_project-code-backup-20261004m.tgz`. Verifikasi: capabilities 200, `conv-cols` live OK. |
| 2026-10-04 (bengi 7) | `4a1aad5` | sesi iki | Converter rapi tenan: rasio kolom bener (files 7fr kiri, drop 5fr kanan) + empty state (file kosong → drop tengah, ora bolong). Backup `/root/pdf_project-code-backup-20261004n.tgz`. Verifikasi: capabilities 200. |
| 2026-10-04 (bengi 8) | `e0b4a39` | sesi iki | Organize workspace ala iLovePDF: grid thumbnail + FAB (+ duplikat & badge, ⇅ sort) + sidebar (Files, Reset, aksi seleksi, tombol abang Organize). Backup `/root/pdf_project-code-backup-20261004o.tgz`. Verifikasi: capabilities 200, `org-ws` live OK. |
| 2026-10-04 (bengi 9) | `c1adbb1` | sesi iki | Organize: panel "Selected files" ganda diumpetke (sidebar workspace sing mlaku; progress/error tetep). Backup `/root/pdf_project-code-backup-20261004p.tgz`. Verifikasi: capabilities 200. |
| 2026-10-04 (bengi 10) | `beac889` | sesi iki | Organize empty state: file kosong → prompt rapi + tombol Choose file (grid/FAB/sidebar didelikke). Backup `/root/pdf_project-code-backup-20261004q.tgz`. Verifikasi: capabilities 200. |
| 2026-10-04 (bengi 11) | `b3abe52` | sesi iki | Organize anti-ngawur: show/hide deterministik (`.is-hidden`) + progress/error pindah sidebar + fileList utuh didelikke + regression test. Backup `/root/pdf_project-code-backup-20261004r.tgz`. Verifikasi: capabilities 200, 4 suite converter ijo. |
| 2026-10-04 (bengi 12) | `914e88d` | sesi iki | Organize thumbnail gede (grid 3 kolom). Backup `/root/pdf_project-code-backup-20261004s.tgz`. Verifikasi: capabilities 200. |
| 2026-10-04 (bengi 13) | `4f3d3dd` | sesi iki | Workspace organize full-width + balik 4 kolom (oyot thumbnail cilik: panel nyusut). Backup `/root/pdf_project-code-backup-20261004t.tgz`. Verifikasi: capabilities 200. |
| 2026-10-04 (bengi 14) | `9d7392f` | sesi iki | Organize tanpa drop ganda (workspace dadi drop target). Backup `/root/pdf_project-code-backup-20261004u.tgz`. Verifikasi: capabilities 200. |
| 2026-10-04 (bengi 15) | `ee3c04b` | sesi iki | Flipbook: takeout 3 paragraf bantuan ekspor (+ guard JS). Backup `/root/pdf_project-code-backup-20261004v.tgz`. Verifikasi: capabilities 200, teks ilang nang live. |
| 2026-10-04 (bengi 16) | `cc64cad` | sesi iki | Organize rapet: gap + padding + nomer dicilikke. Backup `/root/pdf_project-code-backup-20261004w.tgz`. Verifikasi: capabilities 200. |
| 2026-10-04 (bengi 17) | `e731fad` | sesi iki | Organize: ikon SVG rapi + klik thumbnail = zoom lightbox (navigasi + putar/duplikat/hapus + Esc). Backup `/root/pdf_project-code-backup-20261004x.tgz`. Verifikasi: capabilities 200, 4 suite ijo. |
| 2026-10-04 (bengi 18) | `29b32b2` | sesi iki | Tombol + = blank page tenan (seukuran halaman pertama, bisa dipilih/diputar/hapus/zoom, melu ke-save). Backup `/root/pdf_project-code-backup-20261004y.tgz`. Verifikasi: capabilities 200, suite ijo. |
| 2026-10-04 (bengi 19) | `bf773eb` | sesi iki | Organize: tombol ukuran thumbnail S/M/L nang sidebar (pilihan disimpen). Backup `/root/pdf_project-code-backup-20261004z.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `7643070` | sesi iki | Ikon organize ora ganggu: kaca pembesar dibuang (klik gambar = zoom), tombol 24px. Backup `/root/pdf_project-code-backup-20261005a.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `a3ccbf1` | sesi iki | Plus kiwo-tengen saben kartu (sisip blank sadurunge/sawise). Backup `/root/pdf_project-code-backup-20261005b.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `4f63972` | sesi iki | Zoom toggle: klik gambar = balik grid. Backup `/root/pdf_project-code-backup-20261005c.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `1fd2f11` | sesi iki | Organize gabung dokumen: tambah file A/B/C (sing lawas tetep, urutan/rotasi aman), sidebar daftar file + ✕, tombol FAB ikon plus. Backup `/root/pdf_project-code-backup-20261005d.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `af4616a` | sesi iki | Ikon pindah header kartu (nomer+rotasi kiwo, tombol tengen), konten gambar resik. Backup `/root/pdf_project-code-backup-20261005e.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `83d0c1a` | sesi iki | Blank iso diisi gambar (klik blank = pilih file, JPEG, melu ke-save). Backup `/root/pdf_project-code-backup-20261005f.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `e256401` | sesi iki | Plus nang space dewe 30px (ora nempel kartu, siji per gap). Backup `/root/pdf_project-code-backup-20261005g.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `33b31ef` | sesi iki | Balikke frame nyaman kaya referensi (full-width + 4 kolom tetep). Backup `/root/pdf_project-code-backup-20261005h.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `a816f4f` | sesi iki | Kartu persis referensi: slot awal sing nyecet dibuang + nomer ngisor + hover overlay. Backup `/root/pdf_project-code-backup-20261005i.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `38c2cf5` | sesi iki | Sidebar rapet: nempel isi (ora melar), tombol Organize mudun. Backup `/root/pdf_project-code-backup-20261005j.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `e6730af` | sesi iki | S/M/L dibuang (sidebar fokus fungsi editing). Backup `/root/pdf_project-code-backup-20261005k.tgz`. Verifikasi: capabilities 200, S/M/L 0 nang live. |
| 2026-10-05 | `4a9bef4` | sesi iki | Oyot thumbnail cilik ketemu: bar options dikunci max 768px, dijebol full-width kanggo organize. Backup `/root/pdf_project-code-backup-20261005l.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `d0ef2f5` | sesi iki | Blank iso diklik: id kutip dibenerke (`&quot;`) + regression test. Backup `/root/pdf_project-code-backup-20261005m.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `cdf7b2f` | sesi iki | Empty state: tombol Upload + Google Drive langsung (kompak tengah). Backup `/root/pdf_project-code-backup-20261005n.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `47f6450` | sesi iki | AI dibuka kanggo Pro/Business walau gateway durung ono (oyot "translate ga jalan": 503 payments gate; Free tetep dikunci). Disk kebak → backup lawas (a–q) dibuang, backup anyar tanpa `.build`. Backup `/root/pdf_project-code-backup-20261005r.tgz`. Verifikasi: capabilities 200, kode live dicek. |
| 2026-10-05 | `a205da5` | sesi iki | Tab note: outline fokus ireng dipateni. Backup `/root/pdf_project-code-backup-20261005s.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `477e245` | sesi iki | Tahap 1: tombol Organize pages nang flipbook → organize (handoff IndexedDB). Backup `/root/pdf_project-code-backup-20261005t.tgz`. Verifikasi: capabilities 200, tombol live OK. |
| 2026-10-05 | `a55f4fb` | sesi iki | Reader flip mini nang organize (klik kartu = bukune melu flip) + benerke bug pindah-tool ngancurke progress. Backup `/root/pdf_project-code-backup-20261005u.tgz`. Verifikasi: capabilities 200, suite ijo. |
| 2026-10-05 | `e6b46b6` | sesi iki | Reader dadi tetap (tanpa toggle) koyo flipbook. Backup `/root/pdf_project-code-backup-20261005v.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `73b3632` | sesi iki | Klik kartu = flip (gambar ora nyolong klik; zoom pindah double-click). Backup `/root/pdf_project-code-backup-20261005w.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `1301069` | sesi iki | Flip mati didandani: update() saben flip/rebuild + self-heal turnToPage + tes engine (oyot: geometri basi = flip meneng). Backup `/root/pdf_project-code-backup-20261005x.tgz`. Verifikasi: capabilities 200, 5 suite ijo. |
| 2026-10-05 | `a55337b` | sesi iki | Watchdog flip macet (restart loop + snap instan). Backup `/root/pdf_project-code-backup-20261005y.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `b32f424` | sesi iki | Telemetri flip (log dalan klik) + klik pasca-drag dipercoyo. Backup `/root/pdf_project-code-backup-20261005z.tgz`. Verifikasi: capabilities 200. |
| 2026-10-06 | `5aeafe3` | sesi iki | Restart loop saben flip + snap (gambar meneng padahal nomer ganti). Backup `/root/pdf_project-code-backup-20261006a.tgz`. Verifikasi: capabilities 200. |
| 2026-10-06 | `2a840d2` | sesi iki | Heal mung pas macet (restart + snap). Backup `/root/pdf_project-code-backup-20261006b.tgz`. Verifikasi: capabilities 200. |
| 2026-10-06 | `e963b81` | sesi iki | Fallback statis: paint diverifikasi tiap flip, gagal = spread biasa tanpa engine. Backup `/root/pdf_project-code-backup-20261006c.tgz`. Verifikasi: capabilities 200. |
| 2026-10-06 | `4b332bb` | sesi iki | Oyot flip macet ketemu: lazy render ngganti sak isi buku engine. Ndandani + regression test. Backup `/root/pdf_project-code-backup-20261006d.tgz`. Verifikasi: capabilities 200. |
| 2026-10-06 | `f1e6bbf` | sesi iki | Oyot liyane: rebuild ngusap box urip (faces detached saiki) + tes pola bener. Backup `/root/pdf_project-code-backup-20261006e.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `dcb5664` | sesi iki | Zoom bertingkat: klik gambar in/out, klik latar nutup. Backup `/root/pdf_project-code-backup-20261005o.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `3c829da` | sesi iki | Blank isi diklik = zoom (kosong = pilih file) + tombol Ganti gambar nang viewer. Backup `/root/pdf_project-code-backup-20261005p.tgz`. Verifikasi: capabilities 200. |
| 2026-10-05 | `2349881` | sesi iki | Zoom sekali: langsung gede, klik balik (tiering dibuang). Backup `/root/pdf_project-code-backup-20261005q.tgz`. Verifikasi: capabilities 200. |
| 2026-10-06 | `3f59b23` | sesi iki | Organize drag gaya Trello: gap placeholder abang pas hover (kartu liyo minggir), drop commit nang posisi gap + regression test. Backup `/root/pdf_project-code-backup-20261006f.tgz`. Verifikasi: capabilities 200, `orgFinishDrag`/`org-gap` live OK. |
| 2026-10-06 | `9d96803` | sesi iki | Share link flipbook (`share.py` + `/api/share` + publik `/s/<id>` play & `?dl=1` download, kuota paket, tombol 🔗 Share nang editor) + organize auto-scroll pas drag nang pinggir. Backup `/root/pdf_project-code-backup-20261006g.tgz`. Verifikasi: capabilities 200, admin 200, 404 share + pesan ID live OK, POST tanpa login 401, tombol share + `orgAutoStart` live OK. |
| 2026-10-06 | `c8255bc` | sesi iki | Back cover krem kanggo buku genap: flip pungkasan landing spread kebak (lembaran ora lenyap nang bolongan peteng). Backup `/root/pdf_project-code-backup-20261006h.tgz`. Verifikasi: capabilities 200, `withBackCover` anyar live OK. |
| 2026-10-06 | `58b65d3` | sesi iki | Ending kaya buka cover (request owner): blank invisible + geser tengah bareng flip mlebu/metu ending (flip ora main miring, ora glide sawise landing). Backup `/root/pdf_project-code-backup-20261006i.tgz`. Verifikasi: capabilities 200, `lastFirst` + blank-invisible live OK. |
| 2026-10-06 | `42f159c` | sesi iki | Zoom anteng pas flip (oyot video: zoom 2× kecepit tengah flip → snap): zoom-IN ditolak mid-flip, flip snap pre-flip, tap pas zoom = metu zoom. Backup `/root/pdf_project-code-backup-20261006j.tgz`. Verifikasi: capabilities 200, `canZoom`/`snap()` live OK. |
| 2026-10-06 | `9b49a71` | sesi iki | Tombol Share nang header + popup link & Copy (sidebar kepotong nang monitor cendhek). Backup `/root/pdf_project-code-backup-20261006k.tgz`. Verifikasi: capabilities 200, tombol + popup live OK. |
| 2026-10-06 | `1c5e4bd` | sesi iki | Draft autosave lokal (refresh nawakke dokumen bali; catatan/stabilo/bookmark melu). Backup `/root/pdf_project-code-backup-20261006l.tgz`. Verifikasi: capabilities 200, draft-box + draftSave live OK. |
| 2026-10-06 | `37c771d` | sesi iki | Drive launcher (file redirect ~1KB nang player; tombol nang popup share). Backup `/root/pdf_project-code-backup-20261006m.tgz`. Verifikasi: capabilities 200, tombol launcher live OK. |
| 2026-10-06 | `a47774d` | sesi iki | Shortcut .url Windows + popup share 3 tombol (copy/launcher/shortcut). Backup `/root/pdf_project-code-backup-20261006n.tgz`. Verifikasi: capabilities 200, tombol shortcut live OK. |
| 2026-10-06 | `31ff282` | sesi iki | Doc nang Drive langsung (tombol Save Doc: judul project + link klik, via drive.file). Backup `/root/pdf_project-code-backup-20261006o.tgz`. Verifikasi: capabilities 200, tombol Doc live OK. |
| 2026-10-06 | `93373d9` | sesi iki | Tamu dikunci (download + mlebu flipbook login, diteruske) + trial 7 hari (mung moco flipbook, popup Pro) + share gratis 3x + popup login 3 menit. Backup `/root/pdf_project-code-backup-20261006p.tgz`. Verifikasi: capabilities 200, trialWall/loginPopup live OK. |
| 2026-10-06 | `ba45b10` | sesi iki (gabungan) | **Ndandani tabrakan:** deploy 93373d9 numpuk kode live 349d16f (referral, signup-IP, business price) mergo HEAD lokal ketinggalan. Deploy ulang HEAD gabungan origin/main (is ine referral + signup-IP + trial/gates/share-3x/nudge). `.data`/`.env` ora tau kesentuh (backup + live DB utuh). Tes 130 Python ijo nang arsip gabungan; JS frontend = kode sing wes dites (mung i18n nambah). Backup `/root/pdf_project-code-backup-20261006q.tgz`. Verifikasi: capabilities 200, trialWall + referral/Invite live OK. |
| 2026-10-06 | `4bfce46` | Claude | Referral: panel "Ajak teman" (account.html) + info referral di admin; backend referral sudah ikut live lewat `93373d9` (sesi lain). Restart myflipbook + myflipbook-admin. Backup `/root/pdf_project-code-backup-20261006q.tgz`. Verifikasi: account.html berisi panel, /api/auth/referral tamu 401. |
| 2026-10-06 | `c49319a` | Claude | Harga Business Rp199.000/bulan, Rp1.990.000/tahun (USD tetap). Backup `/root/pdf_project-code-backup-20261006r.tgz`. Verifikasi /api/billing/plans. |
| 2026-10-06 | `349d16f` | Claude | 1 akun baru per IP (email & Google), IP dari X-Real-IP nginx, tabel `signups` (IP di-hash). Backup DB `.data/myflipbook-backup-20261006-before-signups.sqlite3`, kode `/root/pdf_project-code-backup-20261006s.tgz`. Atur di `.env`: `SIGNUP_PER_IP` (default sekarang 3, 0 = mati), `SIGNUP_IP_DAYS` (default sekarang 1), `SIGNUP_IP_ALLOW` (IP dibebaskan, koma). |
| 2026-10-06 | `ba45b10` | Claude | Jatah pemakaian per 5 jam (QUOTA_*), daftar per IP dilonggarkan jadi 3/hari, terjemahan buku tidak lagi ditutup saat pembayaran mati. Backup DB `.data/myflipbook-backup-20261006-before-usage.sqlite3`, kode `/root/pdf_project-code-backup-20261006t.tgz`. Verifikasi /api/auth/usage tamu 401. |
| 2026-10-06 | `ddd61fd` | Claude | Statistik pengunjung untuk laporan: dihitung lewat beacon browser (/api/visit), tim dikecualikan (`STATS_EXCLUDE_EMAILS` ditambah ke `.env` live: 4 email tim), laporan harian + CSV di admin. Statistik lama diarsipkan `.data/archive-20261006-visits.sqlite3`, mulai dari 0 pukul ±15:43. Backup kode `/root/pdf_project-code-backup-20261006u.tgz`. |
| 2026-10-06 16:12 | `5b0d489` | Claude | Lokasi pengunjung (negara/provinsi/kota/provider) nang admin: `geo.py` + DB-IP Lite nang `.data/geo` (131 MB), cron `0 4 3 * *` `python3 geo.py --update` (log `/tmp/geo-update.log`); kolom anyar `visits.country/region/city/isp`; IP tetep ora disimpen, privacy.html dianyari. Disk 98% → 65%: 48 backup kode lawas dibusak (owner setuju), backup saiki `--exclude=.build`, mung 3 paling anyar. Backup `/root/pdf_project-code-backup-20261006v.tgz` (13 MB). |
| 2026-10-06 16:35 | `6415b1c` | Claude | SEO: 22 landing page Indonesia (`seo.py`, `/kompres-pdf` dst.), `/robots.txt`, `/sitemap.xml` (30 URL), meta/canonical/OG halaman app. Backup `/root/pdf_project-code-backup-20261006w.tgz`. Owner kudu verifikasi Google Search Console + submit sitemap. |
| 2026-10-06 16:50 | `1509945` | Claude | SEO: judul beranda Indonesia, preview sosmed `hero-1671.jpg`, verifikasi `GOOGLE_SITE_VERIFICATION`/`BING_SITE_VERIFICATION` (.env). Keamanan: Referrer-Policy + X-Frame-Options (app); nginx `server_tokens off` + HSTS 1 taun (backup `/root/nginx-myflipbookpro-backup-20261006`); `.data` 700, `library.key`/sqlite 600. Backup kode `...-20261006x.tgz`.
| 2026-10-06 | (env) | sesi iki | `SIGNUP_PER_IP=20` nang `.env` live (request owner: jaringan bareng sekolah/kafe/warnet/kantor iso mlebu; kunci utama tetep verifikasi email + kuota + trial). Backup `.env` `/root/pdf_project-env-backup-20261006d`, restart myflipbook. Verifikasi: capabilities 200. | |
| 2026-10-06 17:30 | `bfbf9cc` | Claude | Admin: detail member tampil inline nang ngisor tombol Berikutnya (dudu popup), info dadi kolom ber-label. Mung `myflipbook-admin` sing di-restart. Backup `...-20261006y.tgz`. |
| 2026-10-06 17:45 | `5548231` | Claude | Referral: kabeh member oleh kode pas daftar; member lawas diisi otomatis pas start (live: 6 member, 0 tanpa kode). Backup DB `.data/myflipbook-backup-20261006-before-refcodes.sqlite3`, kode `...-20261006z.tgz`. |
| 2026-10-06 18:10 | `a54f9a6` | Claude | SEO: `/artikel` + 10 artikel tutorial (`articles.py`), panduan terkait nang halaman landing, judul Indonesia gawe halaman app; sitemap 41 URL. Backup `...-20261006za.tgz`. |
| 2026-10-06 22:00 | (ora owah) | Claude + owner | Email metu saiki saka **cs@myflipbookpro.com** (EmailArray): `.env` SMTP_HOST=smtp.emailarray.com:465, SMTP_USER/MAIL_FROM=cs@, SMTP_PASS + CS_PASSWORD diisi owner dhewe. IMAP lan kirim tes OK. Backup `.env` lawas (Gmail) `/root/pdf_project-env-backup-202610062147`. DKIM durung. |
| 2026-10-07 00:00 | `e2741e3` | Claude | Converter: Sign PDF, Scan to PDF, PDF Forms, Redact PDF (permanen), Compare PDF (`assets/pdf-extra.js`) + 5 landing SEO (sitemap 46 URL). Deploy mung commit HEAD — **Edit PDF + aksi grid Organize (agen liya, durung commit nang converter.html/index.html/pdf-edit.js) ORA melu**. Backup `...-20261007a.tgz`. |
| 2026-10-07 | `800922c` | sesi iki | Organize grid: split/number/watermark/annotate + layout menu + Edit PDF tool live (kartu SOON dicopot). Backup `...-20261007a.tgz` (jeneng tabrakan karo backup e2741e3 nang ndhuwur — isine kode sadurunge deploy iki, bener kanggo rollback). Verifikasi: 46 Node ijo, capabilities 200, orgAnnotate + edit-pdf live OK. |
| 2026-10-07 | `8733809` | sesi iki | Layout menu organize rapi (formula flex, anotasi 2 baris). Backup `...-20261007b.tgz` (--exclude=.build → 13MB; CATETAN: jeneng tabrakan karo backup d604490 — isine diganti backup pre-deploy iki). Verifikasi: 46 Node ijo, capabilities 200. |
| 2026-10-07 | `d604490` | Claude | 3 artikel SEO segmen guru/perbandingan (`/artikel/cara-membuat-e-modul-flipbook-untuk-guru`, `/artikel/flipbook-untuk-pembelajaran`, `/artikel/alternatif-heyzine-fliphtml5-bahasa-indonesia`), sitemap 49 URL. HEAD wis ngemot `800922c` (Edit PDF + Organize, wis live saka agen liya). Backup `...-20261007b.tgz`. |
| 2026-10-07 | `b2915f5` | Claude | 3 artikel SEO segmen mahasiswa (maca jurnal dadi buku, gabung jurnal dadi buku referensi, maca jurnal cepet), sitemap 52 URL. Backup `...-20261007c.tgz`. |
| 2026-10-07 | `0c368ec` | Claude | Teks UI basa Jawa → Indonesia baku (popup login/trial, pesen Drive/share, draft, menu Organize). Aturan anyar nang AGENTS.md. Backup `...-20261007d.tgz`. |
| 2026-10-07 | `88c614a` | Claude | Resik-resik live: tombol 🧪 test dummy + pesen developer (python server.py, localhost, F12, project server, local LibreOffice) dibusak saka tampilan; cathetan build APK/EXE saiki nyebut layanan build. Backup `...-20261007e.tgz`. |
| 2026-10-07 | `c1b8f0c` | Claude | Kontak cs@myflipbookpro.com nang web: Privasi + Syarat (ganti Gmail), footer beranda + artikel/landing, popup trial, contactPoint Google. Backup `...-20261007f.tgz`. |
| 2026-10-07 | (judul SEO) | Claude | Judul artikel flipbook + landing /pdf-ke-flipbook ngincer "membuat file PDF menjadi buku". Backup `...-20261007g.tgz`. |
| 2026-10-07 | (reader+tombol) | Claude | Pembaca Organize: bentuk halaman saka median sampel (sampul landscape ora nyilikke halaman portrait); tombol Save & export flipbook putih, oranye mung pas hover. Backup `...-20261007h.tgz`. |
| 2026-10-07 | (share sidebar) | Claude | Tombol Share link nang sidebar flipbook dibusak (share tetep nang tombol 🔗 Share ndhuwur). Backup `...-20261007i.tgz`. |
| 2026-10-07 | (refresh draf) | Claude | Flipbook: refresh = buku bali otomatis saka draf (tanpa klik Continue); kunjungan anyar tetep takon. Backup `...-20261007j.tgz`. |
