"""Laporan mingguan admin (weekly_report.py): pengaturan, jadwal Senin/Sabtu, isi PDF dan email,
segmentasi follow-up member gratis, dan endpoint admin."""
import http.client
import json
import os
from pathlib import Path
import re
import smtplib
import sys
import tempfile
import threading
import time
import unittest
import zlib
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import accounts
import admin_server
import visits
import weekly_report


def pdf_text(pdf):
    streams = re.findall(rb'stream\n(.*?)\nendstream', pdf, re.S)
    return ' '.join(re.findall(r'\((.*?)\) Tj', b''.join(zlib.decompress(s) for s in streams).decode('latin-1')))


def local(year, month, day, hour=0, minute=0):
    return int(time.mktime((year, month, day, hour, minute, 0, 0, 0, -1)))


class FakeSMTP:
    sent, fail, logins = [], False, []

    def __init__(self, host, port, timeout=0, context=None):
        self.host, self.port = host, port

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        pass

    def login(self, user, password):
        FakeSMTP.logins.append((user, password))

    def send_message(self, message):
        if FakeSMTP.fail:
            raise smtplib.SMTPException('simulasi gagal')
        FakeSMTP.sent.append(message)


class WeeklyReportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.data = Path(self.tmp.name)
        self.db = self.data / 'myflipbook.sqlite3'
        store = accounts.Accounts(str(self.db))
        now = int(time.time())
        day = 86400
        self.ids = {}
        # (email, plan, verified, umur hari)
        for email, plan, verified, age in [
                ('alice@example.com', 'medium', 1, 50), ('carol@example.com', 'basic', 1, 20), ('dave@example.com', 'basic', 1, 20),
                ('erin@example.com', 'basic', 1, 3), ('frank@example.com', 'basic', 0, 2), ('gina@example.com', 'basic', 1, 40),
                ('hank@example.com', 'basic', 1, 90), ('team@example.com', 'basic', 1, 20), (weekly_report.TESTER, 'basic', 1, 20)]:
            user = store.user_for(store.register(email, 'secret-pass-1', email.split('@')[0].title()))
            self.ids[email.split('@')[0]] = user['id']
            with store.connect() as db:
                db.execute('UPDATE users SET plan=?, plan_expires_at=?, verified=?, created_at=? WHERE id=?',
                           (plan, now + 20 * day if plan == 'medium' else None, verified, now - age * day, user['id']))
        i = self.ids
        with store.connect() as db:
            order = ("INSERT INTO orders(id, user_id, plan, cycle, amount, status, provider, created_at, paid_at, currency) "
                     "VALUES(?, ?, 'medium', 'monthly', 89500, ?, 'mock', ?, ?, 'IDR')")
            db.execute(order, ('o-paid', i['alice'], 'paid', now - day, now - day))
            db.execute(order, ('o-pending', i['carol'], 'pending', now - day, None))
            db.execute(order, ('o-old', i['hank'], 'paid', now - 60 * day, now - 60 * day))
            db.execute(order, ('o-test', i['duitku-tester'], 'paid', now - day, now - day))
            db.executescript('''CREATE TABLE IF NOT EXISTS library_books(id TEXT PRIMARY KEY, user_id INTEGER, title TEXT, page_count INTEGER,
                                  size INTEGER, has_cover INTEGER, created_at INTEGER, updated_at INTEGER);
                                CREATE TABLE IF NOT EXISTS library_exports(id TEXT PRIMARY KEY, book_id TEXT, user_id INTEGER, kind TEXT,
                                  filename TEXT, size INTEGER, created_at INTEGER);''')
            db.execute("INSERT INTO library_books VALUES('b1', ?, 'Buku Dave', 10, 1000, 1, ?, ?)", (i['dave'], now - day, now - day))
            for uid, kind, amount in [(i['dave'], 'office', 6), (i['dave'], 'ai', 2), (i['team'], 'office', 30), (i['alice'], 'ai', 4)]:
                db.execute('INSERT INTO usage(user_id, kind, amount, at) VALUES(?,?,?,?)', (uid, kind, amount, now - day))
        v = visits.Visits(self.data / 'visits.sqlite3')
        chrome = 'Mozilla/5.0 (Windows NT 10.0) Chrome/150'
        v.record('/index.html', '1.2.3.4', chrome, 'https://www.google.com/search', None, own_hosts={'myflipbookpro.com'})
        v.record('/artikel', '5.6.7.8', 'Mozilla/5.0 (iPhone) Mobile Safari', 'https://www.instagram.com/')
        self.env = mock.patch.dict(os.environ, {'MYFLIPBOOK_DB': str(self.db), 'STATS_EXCLUDE_EMAILS': 'team@example.com',
                                                'ADMIN_USERNAME': 'boss', 'ADMIN_PASSWORD_HASH': accounts.hash_password('very-long-admin-pass')})
        self.env.start()
        for key in ('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PORT', 'MAIL_FROM'):
            os.environ.pop(key, None)
        FakeSMTP.sent, FakeSMTP.fail, FakeSMTP.logins = [], False, []
        self.ctx = admin_server.report_ctx()
        self.now = now

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def smtp(self):
        return mock.patch.dict(
            os.environ, {'SMTP_HOST': 'smtp.gmail.com', 'SMTP_USER': 'kirim@gmail.com', 'SMTP_PASS': 'app-password-rahasia'})

    # ------------------------------------------------------------ pengaturan

    def test_defaults_and_validation(self):
        cfg = weekly_report.config(self.data)
        self.assertEqual(cfg['recipients'], ['sarvamayahybrid@gmail.com', 'wiyanjenarmahesa@gmail.com'])
        self.assertEqual((cfg['days'], cfg['hour'], cfg['enabled']), ([0, 5], 8, True))
        for bad in ({'recipients': 'a@b.com\nBcc: x@y.com'}, {'recipients': 'bukan-email'}, {'recipients': ''},
                    {'days': []}, {'days': [7]}, {'days': ['x']}, {'hour': 24}, {'hour': 'x'},
                    {'notes': {'market': 'x' * 2001}}, {'notes': 'x'}, 'bukan dict'):
            with self.assertRaises(ValueError, msg=str(bad)):
                weekly_report.save_config(self.data, bad)
        saved = weekly_report.save_config(self.data, {'recipients': 'A@x.com, b@y.org;a@x.com', 'days': [4, 0, 0], 'hour': 7,
                                                      'enabled': False, 'notes': {'market': ' Pesaing A turun harga '}})
        self.assertEqual(saved['recipients'], ['a@x.com', 'b@y.org'])
        self.assertEqual((saved['days'], saved['hour'], saved['enabled']), ([0, 4], 7, False))
        self.assertEqual(weekly_report.config(self.data)['notes'], {'market': 'Pesaing A turun harga', 'product': ''})
        self.assertIsNone(weekly_report.next_run(saved), 'dimatikan: tidak ada jadwal')

    def test_next_run(self):
        cfg = weekly_report.defaults()
        wednesday = local(2026, 11, 25, 12)
        t = time.localtime(weekly_report.next_run(cfg, wednesday))
        self.assertEqual((t.tm_wday, t.tm_mday, t.tm_hour), (5, 28, 8), 'Rabu -> Sabtu 08.00')
        t = time.localtime(weekly_report.next_run(cfg, local(2026, 11, 30, 7)))
        self.assertEqual((t.tm_wday, t.tm_mday), (0, 30), 'Senin sebelum jam kirim -> hari itu juga')
        t = time.localtime(weekly_report.next_run(cfg, local(2026, 11, 28, 9)))
        self.assertEqual((t.tm_wday, t.tm_mday), (0, 30), 'Sabtu setelah jam kirim -> Senin')

    # ------------------------------------------------------------ data

    def test_release_notes(self):
        root = self.data / 'repo'
        root.mkdir()
        (root / 'DEPLOY.md').write_text(
            '# Deploy\n\n## Log terbaru\n\n'
            '- 25 November 2026 \u2014 live kode `da33e6e`: kartu Privacy pada beranda diganti menjadi Artikel. Backup kode `/root/x.tgz`; hash lain.\n\n'
            '- 5 November 2026 \u2014 live `142427e`: indikator bulat dihapus.\n\n'
            '## 1. Login VPS\n\n- 1 Januari 2020 \u2014 bukan log\n', encoding='utf-8')
        notes = weekly_report.release_notes(root, local(2026, 11, 26, 9), days=7)
        self.assertEqual([n['code'] for n in notes['items']], ['da33e6e'])
        self.assertEqual(notes['items'][0]['summary'], 'kartu Privacy pada beranda diganti menjadi Artikel')
        self.assertEqual(notes['latest']['code'], 'da33e6e')
        older = weekly_report.release_notes(root, local(2026, 11, 26, 9), days=30)
        self.assertEqual([n['code'] for n in older['items']], ['da33e6e', '142427e'])
        self.assertEqual(weekly_report.release_notes(self.data / 'tidak-ada', self.now), dict(items=[], latest=None))

    def test_followup_segments(self):
        f = weekly_report.followup(self.ctx, self.now)
        self.assertEqual(f['total'], 6, 'alice berbayar, tim, dan akun tester tidak dihitung')
        self.assertEqual(f['segments'], {'aktif': 1, 'checkout': 1, 'mantan': 1, 'baru': 1})
        self.assertEqual((f['notVerified'], f['inactive'], f['pool']), (1, 1, 4))
        emails = [m['email'] for m in f['items']]
        self.assertEqual(emails[0], 'dave@example.com', 'pemakaian terbanyak paling atas')
        self.assertNotIn('team@example.com', emails); self.assertNotIn(weekly_report.TESTER, emails)
        self.assertNotIn('frank@example.com', emails, 'belum verifikasi: hanya dihitung')
        self.assertNotIn('gina@example.com', emails, 'tidak aktif: hanya dihitung')
        carol = next(m for m in f['items'] if m['email'] == 'carol@example.com')
        self.assertEqual(carol['segment'], 'checkout'); self.assertIn('belum membayar', carol['reasons'])

    def test_collect_funnel_and_team_excluded(self):
        d = weekly_report.collect(self.ctx, self.now)
        self.assertEqual(d['cur']['orders'], 1, 'order tester tidak dihitung')
        self.assertEqual(d['cur']['revenue'], {'IDR': 89500})
        self.assertEqual(d['cur']['pending'], 1)
        self.assertEqual(d['cur']['usage']['office'], dict(total=6, users=1), 'pemakaian tim tidak dihitung')
        self.assertEqual(d['cur']['signups'], 2, 'erin dan frank mendaftar dalam 7 hari')
        self.assertEqual(d['stats']['visitors'], 2)
        self.assertTrue(any('Pengunjung unik 2' in x for x in d['insights']))

    # ------------------------------------------------------------ PDF dan email

    def test_pdf_and_email_content(self):
        weekly_report.save_config(self.data, {'notes': {'market': 'Pesaing X menawarkan promo', 'product': 'Sedang membuat editor baru'}})
        d = weekly_report.collect(self.ctx, self.now)
        pdf = weekly_report.build_pdf(d)
        self.assertTrue(pdf.startswith(b'%PDF-1.4') and pdf.rstrip().endswith(b'%%EOF'))
        text = pdf_text(pdf)
        for expected in ('Laporan Mingguan MyFlipbook Pro', '1. Ringkasan dan temuan utama', '2. Pengunjung dan traffic',
                         '3. Analisis pasar', '4. Progress pengembangan produk', '5. Follow-up member gratis', 'dave@example.com',
                         'Pesaing X menawarkan promo', 'Sedang membuat editor baru', 'Mesin pencari', 'Pemesanan tertunda', 'Contoh pesan'):
            self.assertIn(expected, text)
        self.assertNotIn('team@example.com', text); self.assertNotIn(weekly_report.TESTER, text)
        subject, body, html = weekly_report.compose(d)
        self.assertIn('Laporan Mingguan MyFlipbook Pro', subject)
        for member in ('dave@example.com', 'carol@example.com'):
            self.assertNotIn(member, body + html, 'email member hanya di lampiran PDF')
        self.assertIn('lampiran PDF', body)
        for banned in ('masa coba', 'uji coba', 'trial'):
            self.assertNotIn(banned, (text + body).lower(), 'masa coba tidak disebut (keputusan owner)')

    def test_followup_repeat_flag_after_send(self):
        with self.smtp(), mock.patch.object(weekly_report.smtplib, 'SMTP', FakeSMTP):
            self.assertEqual(weekly_report.run(self.ctx, now=self.now)['status'], 'sent')
            again = weekly_report.followup(self.ctx, self.now + 3600)
        self.assertTrue(all(m['repeat'] for m in again['items']))
        pdf = pdf_text(weekly_report.build_pdf(weekly_report.collect(self.ctx, self.now + 3600)))
        self.assertIn('sudah tampil di laporan sebelumnya', pdf)

    # ------------------------------------------------------------ penjadwal

    def test_tick_sends_once_per_report_day(self):
        monday, tuesday, saturday = local(2026, 11, 30, 9), local(2026, 12, 1, 9), local(2026, 12, 5, 9)
        with self.smtp(), mock.patch.object(weekly_report.smtplib, 'SMTP', FakeSMTP):
            self.assertIsNone(weekly_report.tick(self.ctx, local(2026, 11, 30, 7, 59)), 'belum jam 08.00')
            self.assertEqual(weekly_report.tick(self.ctx, monday)['status'], 'sent')
            self.assertIsNone(weekly_report.tick(self.ctx, monday + 600), 'sudah terkirim hari ini')
            self.assertIsNone(weekly_report.tick(self.ctx, tuesday), 'bukan hari laporan')
            self.assertEqual(weekly_report.tick(self.ctx, saturday)['status'], 'sent')
        self.assertEqual(len(FakeSMTP.sent), 2)
        message = FakeSMTP.sent[0]
        self.assertEqual(message['To'], 'sarvamayahybrid@gmail.com, wiyanjenarmahesa@gmail.com')
        self.assertIn('Laporan Mingguan MyFlipbook Pro - Senin', message['Subject'])
        attachment = next(message.iter_attachments())
        self.assertEqual(attachment.get_content_type(), 'application/pdf')
        self.assertTrue(attachment.get_filename().startswith('laporan-mingguan-myflipbook-'))
        self.assertTrue(attachment.get_content().startswith(b'%PDF'))
        self.assertEqual(FakeSMTP.logins[0], ('kirim@gmail.com', 'app-password-rahasia'))
        self.assertNotIn('app-password-rahasia', json.dumps(weekly_report.status(self.data)), 'sandi tidak pernah ditampilkan')

    def test_tick_disabled_or_wrong_hour(self):
        weekly_report.save_config(self.data, {'enabled': False})
        with self.smtp(), mock.patch.object(weekly_report.smtplib, 'SMTP', FakeSMTP):
            self.assertIsNone(weekly_report.tick(self.ctx, local(2026, 11, 30, 9)))
            weekly_report.save_config(self.data, {'enabled': True, 'hour': 10})
            self.assertIsNone(weekly_report.tick(self.ctx, local(2026, 11, 30, 9)))
            self.assertEqual(weekly_report.tick(self.ctx, local(2026, 11, 30, 10))['status'], 'sent')

    def test_tick_retries_then_gives_up(self):
        monday = local(2026, 11, 30, 9)
        FakeSMTP.fail = True
        with self.smtp(), mock.patch.object(weekly_report.smtplib, 'SMTP', FakeSMTP):
            self.assertEqual(weekly_report.tick(self.ctx, monday)['status'], 'gagal')
            self.assertIsNone(weekly_report.tick(self.ctx, monday + 600), 'tunggu 30 menit')
            self.assertEqual(weekly_report.tick(self.ctx, monday + 1900)['status'], 'gagal')
            FakeSMTP.fail = False
            self.assertEqual(weekly_report.tick(self.ctx, monday + 4000)['status'], 'sent', 'percobaan ketiga berhasil')
            self.assertIsNone(weekly_report.tick(self.ctx, monday + 9000))
        runs = weekly_report.status(self.data)['runs']
        self.assertEqual([r['status'] for r in runs], ['sent', 'gagal', 'gagal'])
        self.assertIn('simulasi gagal', runs[1]['error'])

    def test_tick_without_smtp_logs_once_and_sends_nothing(self):
        monday = local(2026, 11, 30, 9)
        self.assertIsNone(weekly_report.tick(self.ctx, monday))
        self.assertIsNone(weekly_report.tick(self.ctx, monday + 3600))
        runs = weekly_report.status(self.data)['runs']
        self.assertEqual(len(runs), 1)
        self.assertIn('SMTP belum diatur', runs[0]['error'])
        self.assertFalse((self.data / 'outbox').exists(), 'penjadwal tidak menumpuk berkas outbox')

    # ------------------------------------------------------------ endpoint admin

    def serve(self):
        admin_server.SESSIONS.clear(); admin_server.FAILURES.clear()
        httpd = admin_server.ThreadingHTTPServer(('127.0.0.1', 0), admin_server.AdminHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (httpd.shutdown(), httpd.server_close()))
        self.httpd, self.cookie = httpd, ''

    def call(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=20)
        h = {'Cookie': self.cookie} if self.cookie else {}
        if body is not None:
            h.update({'Content-Type': 'application/json', 'X-Admin': '1'})
        h.update(headers or {})
        conn.request(method, path, json.dumps(body) if body is not None else None, h)
        r = conn.getresponse()
        data, cookie = r.read(), r.getheader('Set-Cookie')
        conn.close()
        try:
            data = json.loads(data)
        except ValueError:
            pass
        return r.status, data, cookie

    def test_admin_endpoints(self):
        self.serve()
        for method, path, body in (('GET', '/api/weekly-report', None), ('GET', '/api/weekly-report.pdf', None),
                                   ('POST', '/api/weekly-report', {}), ('POST', '/api/weekly-report/send', {})):
            self.assertEqual(self.call(method, path, body)[0], 401, path)
        status, _, cookie = self.call('POST', '/api/login', {'username': 'boss', 'password': 'very-long-admin-pass'})
        self.assertEqual(status, 200); self.cookie = cookie.split(';')[0]
        status, data, _ = self.call('GET', '/api/weekly-report')
        self.assertEqual(status, 200)
        self.assertEqual((data['smtpReady'], data['config']['days'], data['runs']), (False, [0, 5], []))
        self.assertIsNotNone(data['nextRun'])
        status, data, _ = self.call('POST', '/api/weekly-report', {'recipients': 'tim@example.com', 'days': [0, 5], 'hour': 9,
                                                                    'notes': {'product': 'Fitur laporan'}})
        self.assertEqual((status, data['config']['recipients'], data['config']['hour']), (200, ['tim@example.com'], 9))
        self.assertEqual(self.call('POST', '/api/weekly-report', {'recipients': 'salah'})[0], 400)
        self.assertEqual(self.call('POST', '/api/weekly-report/send', {'to': 'bukan email'})[0], 400)
        status, data, _ = self.call('POST', '/api/weekly-report/send', {'to': 'uji@example.com'})
        self.assertEqual((status, data), (200, {'status': 'outbox', 'to': 1}), 'tanpa SMTP: .eml di outbox, tidak ke jaringan')
        eml = next((self.data / 'outbox').glob('*laporan-mingguan.eml')).read_bytes()
        self.assertIn(b'uji@example.com', eml); self.assertIn(b'application/pdf', eml)
        status, body, _ = self.call('GET', '/api/weekly-report.pdf')
        self.assertEqual(status, 200); self.assertTrue(body.startswith(b'%PDF-1.4'))
        self.assertEqual(self.call('GET', '/api/weekly-report')[1]['runs'][0]['manual'], True)
        key = admin_server.new_key('uji')
        auth = {'Authorization': 'Bearer ' + key}
        self.cookie = ''
        for path in ('/api/weekly-report', '/api/weekly-report.pdf'):
            self.assertEqual(self.call('GET', path, headers=auth)[0], 403, path + ': data pribadi, bukan untuk kunci monitoring')

    def test_send_now_reports_smtp_failure(self):
        self.serve()
        status, _, cookie = self.call('POST', '/api/login', {'username': 'boss', 'password': 'very-long-admin-pass'})
        self.cookie = cookie.split(';')[0]
        FakeSMTP.fail = True
        with self.smtp(), mock.patch.object(weekly_report.smtplib, 'SMTP', FakeSMTP):
            status, data, _ = self.call('POST', '/api/weekly-report/send', {})
        self.assertEqual(status, 502); self.assertIn('Email gagal dikirim', data['error'])


if __name__ == '__main__':
    unittest.main()
