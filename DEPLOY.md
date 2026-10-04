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

## 3. Prosedur update (kabeh agen nganggo cara iki)

1. **Lokal:** `git status` — yen ana owahan agen liya sing durung di-commit, **ojo di-deploy lan ojo dibuwang**; takon owner / agen sing nduwe. Sing di-deploy **mung commit sing wis di-push**.
2. Tes lokal kabeh lulus (`for f in tests/*.test.cjs tests/qa-*.cjs; do node "$f"; done` + `python -m unittest discover -s tests`).
3. Paket: `git archive --format=tar.gz -o mf-deploy.tgz HEAD`, kirim: `scp mf-deploy.tgz root@38.103.170.218:/root/`.
4. **Backup nang VPS dhisik:** `cd /opt && tar czf /root/pdf_project-code-backup-<tanggal>.tgz --exclude=pdf_project/.data --exclude=pdf_project/__pycache__ pdf_project`
5. Pasang: `cd /opt/pdf_project && tar xzf /root/mf-deploy.tgz` (file anyar ditimpa, `.env`/`.data` aman).
6. Restart: `systemctl restart myflipbook` (lan `myflipbook-admin` yen `admin_server.py`/`admin/` owah). Cek `systemctl is-active ...`, `journalctl -u myflipbook -n 20`.
7. Verifikasi: `curl -s -o /dev/null -w "%{http_code}" https://myflipbookpro.com/api/capabilities` (200) lan `https://myflipbookpro.com/admin/api/session` (200).
8. Catet nang **Log deploy** nang ngisor + `TEAM_WORK.md`, commit & push.

Owahan nginx: backup file dhisik (`/root/nginx-myflipbookpro-backup-<tanggal>`), `nginx -t`, banjur `systemctl reload nginx`.
Ganti password admin: `python3 admin_server.py --hash-password` → ganti `ADMIN_PASSWORD_HASH` nang `.env` → `systemctl restart myflipbook-admin`.
Menehi paket tanpa bayar: `python3 admin_server.py --grant EMAIL business lifetime` (utowo `pro 30`); kecatet nang `.data/admin.log`.

## 4. Watesan

- VPS 2 GB RAM / 38 GB disk, dienggo bareng numa + sarvamaya.id. RAM mepet (±600 MB kosong) — ojo nglakoni proses abot (build, OCR massal) nang VPS. Owner arep upgrade nang RAM 4 GB.
- **Ojo install Flutter/Android SDK** nang VPS (`apk:false`); build EXE mustahil nang Linux (`exe:false`).
- Paywall ON; pembayaran **dipause** (`PAYMENTS_PAUSED=1` nang `.env`, key Midtrans/Tripay/Lemon durung diisi) — upgrade member saiki lewat `--grant`. Nguripke: isi key gateway, tes, banjur guwang/setel `PAYMENTS_PAUSED=0` + `systemctl restart myflipbook`.
- Ojo ngganti password root / user lewat SSH; urusan kredensial domain-e owner.

## 5. Log deploy

| Tanggal | Commit live | Sing nglakoni | Cathetan |
|---|---|---|---|
| 2026-10-03 | (overlay manual) | agen liya | Deploy awal + HTTPS certbot. |
| 2026-10-04 11:18 | `1bf0565` | Claude | Kabeh fitur s/d panel admin; `myflipbook-admin.service` + nginx `/admin/`; backup `/root/pdf_project-code-backup-20261004.tgz`. **Owahan `index.html` (stiker "segera hadir" oranye) sing sadurunge wis live tanpa commit dadi ketimpa** — kudu di-commit dhisik banjur deploy maneh yen arep dibalekke. |
| 2026-10-04 (siang) | `374657f` | Claude | `PAYMENTS_PAUSED=1` ditambah ke `.env` live (pembayaran sementara mati; owner update payment gateway malam ini). Backup `/root/pdf_project-code-backup-20261004b.tgz`, `.env` lama `/root/pdf_project-env-backup-20261004b`. |
