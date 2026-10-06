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
            for column in PLACE:
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

    def record(self, path, ip, agent, referer='', user_id=None, own_hosts=(), now=None, place=None):
        """One page view; False when it is not counted (a bot). place: geo.lookup(ip)."""
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
            db.execute('INSERT INTO visits(ts, day, path, visitor, user_id, ref, device, country, region, city, isp) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                       (now, day, (path or '/')[:200], visitor, user_id, ref, device(agent),
                        *(str(place.get(k) or '')[:100] for k in PLACE)))
            if now - self.pruned > 86400:                 # once a day: forget old rows
                db.execute('DELETE FROM visits WHERE ts < ?', (now - KEEP_DAYS * 86400,))
                self.pruned = now
        return True


def stats(db, days=30, now=None, exclude_users=()):
    """Numbers for the admin panel from an open visits database. exclude_users:
    member ids of the team — their visits, and every other visit from the same
    browser that day (the visitor code changes daily), are left out."""
    now = int(now or time.time())
    since = day_of(now - (days - 1) * 86400)
    today = day_of(now)
    ids = [int(u) for u in exclude_users]
    team = (' AND (visitor || day) NOT IN (SELECT visitor || day FROM visits WHERE user_id IN (%s))' % ','.join('?' * len(ids))) if ids else ''
    base = f'SELECT * FROM visits WHERE day >= ?{team}'
    args = [since] + ids

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
    have = {r[1] for r in db.execute('PRAGMA table_info(visits)')}
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
