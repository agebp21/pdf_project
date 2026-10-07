"""Visitor statistics for the admin panel (admin_server.py).

Each page view of a public page is one row: when, which page, the device kind,
the site it came from (host only), the approximate place (country, province,
city, internet provider — looked up from the IP on this server by geo.py) and,
when logged in, the member id. No IP address or browser string is stored: a visitor is a short hash of IP + browser
+ a secret that changes every day, so the same person counts once per day and
cannot be followed from one day to the next. Bots are not counted. Rows older
than KEEP_DAYS are removed.
"""
import contextlib
import hashlib
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
from urllib.parse import urlsplit

KEEP_DAYS = 400
PLACE = ('country', 'region', 'city', 'isp')
# Internet providers that are data centres / clouds: visits from there are
# machines (crawlers, link checkers, scanners), not people.
DATACENTER = ('Google', 'Amazon', 'Microsoft', 'Azure', 'DigitalOcean', 'OVH', 'Hetzner', 'Linode', 'Akamai',
              'LogicWeb', 'Oracle', 'Alibaba', 'Tencent', 'Contabo', 'Vultr', 'Choopa', 'Constant Company', 'M247',
              'Leaseweb', 'Cloudflare', 'Facebook', 'Meta Platforms', 'Datacamp', 'Hostinger', 'IONOS', 'Scaleway',
              'Zenlayer', 'GoDaddy', 'Censys', 'Fastly', 'Huawei Cloud', 'Biznet GIO')


def is_datacenter(isp):
    isp = (isp or '').lower()
    return any(name.lower() in isp for name in DATACENTER)
BOT = re.compile(r'bot|crawl|spider|slurp|preview|monitor|curl|wget|python-requests|httpclient|headless|lighthouse', re.I)


def device(agent):
    agent = agent or ''
    if re.search(r'ipad|tablet|(android(?!.*mobile))', agent, re.I):
        return 'tablet'
    if re.search(r'mobi|iphone|android', agent, re.I):
        return 'mobile'
    return 'desktop'


def day_of(ts):
    return time.strftime('%Y-%m-%d', time.localtime(ts))


class Visits:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        salt = self.path.with_suffix('.salt')
        if not salt.exists():
            salt.write_bytes(secrets.token_bytes(32))
            try:
                os.chmod(salt, 0o600)
            except OSError:
                pass
        self.secret = salt.read_bytes()
        self.pruned = 0
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS visits(
                    ts INTEGER NOT NULL, day TEXT NOT NULL, path TEXT NOT NULL, visitor TEXT NOT NULL,
                    user_id INTEGER, ref TEXT NOT NULL DEFAULT '', device TEXT NOT NULL DEFAULT 'desktop');
                CREATE INDEX IF NOT EXISTS visits_day ON visits(day);
            ''')
            have = {r[1] for r in db.execute('PRAGMA table_info(visits)')}
            for column in PLACE + ('kind',):
                if column not in have:
                    db.execute(f"ALTER TABLE visits ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")

    @contextlib.contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        finally:
            db.close()

    def record(self, path, ip, agent, referer='', user_id=None, own_hosts=(), now=None, place=None, kind=''):
        """One page view; False when it is not counted (a bot). place: geo.lookup(ip).
        kind: '' a person, 'team' a team browser, 'bot' a data-centre network —
        kept for the admin's visitor list, left out of the numbers."""
        if BOT.search(agent or '') or not agent:
            return False
        now = int(now or time.time())
        day = day_of(now)
        visitor = hashlib.sha256(self.secret + day.encode() + (ip or '').encode() + b'|' + agent.encode()).hexdigest()[:16]
        ref = (urlsplit(referer or '').hostname or '').lower()[:100]
        if ref in own_hosts or ref.startswith('www.') and ref[4:] in own_hosts:
            ref = ''
        with self.connect() as db:
            place = place or {}
            if not kind and is_datacenter(place.get('isp')):
                kind = 'bot'
            db.execute('INSERT INTO visits(ts, day, path, visitor, user_id, ref, device, country, region, city, isp, kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                       (now, day, (path or '/')[:200], visitor, user_id, ref, device(agent),
                        *(str(place.get(k) or '')[:100] for k in PLACE), kind if kind in ('team', 'bot') else ''))
            if now - self.pruned > 86400:                 # once a day: forget old rows
                db.execute('DELETE FROM visits WHERE ts < ?', (now - KEEP_DAYS * 86400,))
                self.pruned = now
        return True


def stats(db, days=30, now=None, exclude_users=(), skip_keys=(), keep_keys=()):
    """Numbers for the admin panel from an open visits database. exclude_users:
    member ids of the team — their visits, and every other visit from the same
    browser that day (the visitor code changes daily), are left out. Team
    browsers and data-centre machines are left out too; skip_keys / keep_keys
    (visitor || day) are the admin's own corrections."""
    now = int(now or time.time())
    since = day_of(now - (days - 1) * 86400)
    today = day_of(now)
    have = {r[1] for r in db.execute('PRAGMA table_info(visits)')}
    ids = [int(u) for u in exclude_users]
    skip, keep = list(skip_keys), list(keep_keys)
    marks = lambda n: ','.join('?' * n)
    where = ''
    if ids:
        where += ' AND (visitor || day) NOT IN (SELECT visitor || day FROM visits WHERE user_id IN (%s))' % marks(len(ids))
    if skip:
        where += ' AND (visitor || day) NOT IN (%s)' % marks(len(skip))
    if 'kind' in have and 'isp' in have:
        machine = ' OR '.join(['isp LIKE ?'] * len(DATACENTER))
        people = f"(visitor || day) NOT IN (SELECT visitor || day FROM visits WHERE day >= ? AND (kind != '' OR {machine}))"
        where += f' AND ({people}' + (' OR (visitor || day) IN (%s))' % marks(len(keep)) if keep else ')')
    base = f'SELECT * FROM visits WHERE day >= ?{where}'
    args = [since] + ids + skip
    if 'kind' in have and 'isp' in have:
        args += [since] + [f'%{name}%' for name in DATACENTER] + keep

    def q(sql, extra=()):
        return db.execute(f'WITH v AS ({base}) ' + sql, args + list(extra))
    rows = q('SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM v GROUP BY day ORDER BY day').fetchall()
    by_day = {r['day']: (r['views'], r['visitors']) for r in rows}
    daily = []
    for i in range(days - 1, -1, -1):
        d = day_of(now - i * 86400)
        views, visitors = by_day.get(d, (0, 0))
        daily.append(dict(day=d, views=views, visitors=visitors))

    def top(column, limit=10, extra=''):
        return [dict(name=r[0], views=r[1]) for r in q(f'SELECT {column}, COUNT(*) FROM v WHERE 1=1 {extra} GROUP BY {column} ORDER BY 2 DESC LIMIT ?', [limit])]
    def places(column, need=None, limit=10):
        """Where visitors come from: visitors (one per day), not page views."""
        return [dict(name=r[0], views=r[1]) for r in q(f"SELECT {column}, COUNT(DISTINCT visitor || day) FROM v WHERE {need or column} != '' GROUP BY 1 ORDER BY 2 DESC LIMIT ?", [limit])]
    located = all(c in have for c in PLACE)
    recent = [dict(r) for r in q(f"SELECT ts, path, device, user_id, ref{', country, region, city, isp' if located else ''} FROM v ORDER BY ts DESC LIMIT 50")]
    total = q('SELECT COUNT(*), COUNT(DISTINCT visitor || day) FROM v').fetchone()
    members = q('SELECT COUNT(DISTINCT user_id) FROM v WHERE user_id IS NOT NULL').fetchone()[0]
    counted = [d for d in daily if d['views']] or daily[-1:]
    first = q('SELECT MIN(day) FROM v').fetchone()[0]
    span = max(1, sum(1 for d in daily if first and d['day'] >= first))
    return dict(days=days, today=dict(zip(('views', 'visitors'), by_day.get(today, (0, 0)))),
                views=total[0], visitors=total[1], average=round(total[1] / span, 1), since=first, members=members, daily=daily,
                pages=top('path'), referrers=top('ref', extra="AND ref != ''"), devices=top('device', 5),
                countries=places('country') if located else [],
                regions=places("region || ', ' || country", 'region') if located else [],
                cities=places("city || CASE WHEN region != '' THEN ' · ' || region ELSE '' END", 'city') if located else [],
                isps=places('isp') if located else [], recent=recent)


def visitors(db, days=30, now=None, team_users=(), labels=None, limit=300):
    """One row per visitor per day (the visitor code changes daily): where,
    which network and device, when, the pages in order — and whether it looks
    like a person, the team, a machine, or is unsure, with the reason.
    labels: {visitor || day: 'team' | 'bot' | 'human'} set by the admin."""
    labels = labels or {}
    now = int(now or time.time())
    since = day_of(now - (days - 1) * 86400)
    have = {r[1] for r in db.execute('PRAGMA table_info(visits)')}
    extra = [c for c in PLACE + ('kind',) if c in have]
    rows = db.execute(f"SELECT ts, day, path, visitor, user_id, ref, device{''.join(', ' + c for c in extra)} "
                      'FROM visits WHERE day >= ? ORDER BY ts', (since,)).fetchall()
    team_users = {int(u) for u in team_users}
    groups = {}
    for r in rows:
        r = dict(r)
        g = groups.setdefault(r['visitor'] + r['day'], dict(
            key=r['visitor'] + r['day'], day=r['day'], first=r['ts'], last=r['ts'], views=0, pages=[], hits=[], users=set(),
            ref='', device=r['device'], country=r.get('country', ''), region=r.get('region', ''), city=r.get('city', ''),
            isp=r.get('isp', ''), kinds=set()))
        g['last'] = r['ts']; g['views'] += 1; g['hits'].append((r['path'], r['ts']))
        if r['path'] not in g['pages']:
            g['pages'].append(r['path'])
        if r['user_id']:
            g['users'].add(r['user_id'])
        if r['ref'] and not g['ref']:
            g['ref'] = r['ref']
        if r.get('kind'):
            g['kinds'].add(r['kind'])
    for g in groups.values():
        label = labels.get(g['key'])
        if label in ('team', 'bot', 'human'):
            g['status'], g['reason'] = label, 'Ditandai admin'
        elif 'team' in g['kinds']:
            g['status'], g['reason'] = 'team', 'Browser tim (tombol "Jangan hitung browser ini")'
        elif g['users'] & team_users:
            g['status'], g['reason'] = 'team', 'Login dengan akun tim'
        elif 'bot' in g['kinds'] or is_datacenter(g['isp']):
            g['status'], g['reason'] = 'bot', 'Jaringan pusat data / mesin otomatis' + (f" ({g['isp']})" if g['isp'] else '')
        elif g['users']:
            g['status'], g['reason'] = 'human', 'Member yang login'
        else:
            g['status'], g['reason'] = 'human', ''
    team_hits = [h for g in groups.values() if g['status'] == 'team' for h in g['hits']]
    for g in groups.values():
        if g['status'] == 'human' and not g['users'] and g['key'] not in labels:
            if any(path == tp and abs(ts - tts) <= 120 for path, ts in g['hits'] for tp, tts in team_hits):
                g['status'], g['reason'] = 'unsure', 'Membuka halaman yang sama pada menit yang sama dengan tim'
    out = sorted(groups.values(), key=lambda g: g['last'], reverse=True)[:limit]
    for g in out:
        g['users'] = sorted(g['users'])
        del g['hits'], g['kinds']
    return out
