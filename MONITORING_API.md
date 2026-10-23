# MyFlipbook Pro — monitoring API (read-only)

Step-by-step setup for ChatGPT, Claude, Windows and n8n (in Indonesian): [PANDUAN_API_AI.md](PANDUAN_API_AI.md).

For a program that watches MyFlipbook Pro's traffic and usage and writes audits
(an AI agent, a dashboard, a script). It reads the same numbers as the admin
panel, without the admin login, and cannot change anything.

## Access

- Base URL: `https://myflipbookpro.com/admin`
- Every request: header `Authorization: Bearer mfa_…` (the key you were given).
- `GET` only. At most **60 requests per minute** per key (`429` past that).
- `401`: unknown or revoked key. `403`: the path is not open to keys.

```bash
curl -s -H "Authorization: Bearer $MYFLIPBOOK_MONITOR_KEY" https://myflipbookpro.com/admin/api/overview
```

```js
const r = await fetch('https://myflipbookpro.com/admin/api/visits?days=7', {
  headers: { Authorization: `Bearer ${process.env.MYFLIPBOOK_MONITOR_KEY}` },
});
const stats = await r.json();
```

Keep the key in an environment variable or a secret store, never in code or chat.

## Endpoints

| Path | What it returns |
|---|---|
| `GET /api/overview` | Members (total, verified, Google, paid, new in 7 / 30 days, per plan), orders per status, paid revenue per currency, books in My Library (count, bytes, members), exports, and the last 30 days of visits. |
| `GET /api/visits?days=N` | Traffic for the last N days (1–365, default 30): per day `views`, `visitors`, new `members`, `office` conversions, `ai` uses, `translate` characters, `books` saved; totals; top `pages`, `referrers`, `devices`, `countries`, `regions`, `cities`, `isps`; the latest page views (`recent`: time, page, device, referrer, place — no member ids). |
| `GET /api/server` | Which settings are filled in (true / false, never their values), disk total / free, database and library sizes in bytes. |
| `GET /api/report.csv?days=N` | One row per day: date, visitors, page views, new members, conversions, AI uses, translated characters, books saved. |

Times are Unix seconds; days are `YYYY-MM-DD` (server time, WIB). The team's own
accounts are left out of the traffic and usage numbers.

## Not open to keys

Member lists and details, uploads, the visitor list and the PDF report hold
personal data (emails), so they stay behind the admin login.

## For the site owner

On the server (`/opt/pdf_project`):

```bash
python3 admin_server.py --new-api-key NAME      # prints the key once; only its SHA-256 is kept
python3 admin_server.py --list-api-keys         # names, made, last used, uses — never the keys
python3 admin_server.py --revoke-api-key NAME   # the key stops working at once
```

Keys live in `.data/admin-api-keys.json`; making and revoking them is logged in
`.data/admin.log`. Each key counts every request, refused ones too.
