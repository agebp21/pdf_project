"""Visitor statistics for the admin panel (admin_server.py).

Each page view of a public page is one row: when, which page, the device kind,
the site it came from (host only) and, when logged in, the member id. No IP
address or browser string is stored: a visitor is a short hash of IP + browser
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

    @contextlib.contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        finally:
            db.close()

    def record(self, path, ip, agent, referer='', user_id=None, own_hosts=(), now=None):
        """One page view; False when it is not counted (a bot)."""
        if BOT.search(agent or '') or not agent:
            return False
        now = int(now or time.time())
        day = day_of(now)
        visitor = hashlib.sha256(self.secret + day.encode() + (ip or '').encode() + b'|' + agent.encode()).hexdigest()[:16]
        ref = (urlsplit(referer or '').hostname or '').lower()[:100]
        if ref in own_hosts or ref.startswith('www.') and ref[4:] in own_hosts:
            ref = ''
        with self.connect() as db:
            db.execute('INSERT INTO visits(ts, day, path, visitor, user_id, ref, device) VALUES(?,?,?,?,?,?,?)',
                       (now, day, (path or '/')[:200], visitor, user_id, ref, device(agent)))
            if now - self.pruned > 86400:                 # once a day: forget old rows
                db.execute('DELETE FROM visits WHERE ts < ?', (now - KEEP_DAYS * 86400,))
                self.pruned = now
        return True


def stats(db, days=30, now=None):
    """Numbers for the admin panel from an open visits database."""
    now = int(now or time.time())
    since = day_of(now - (days - 1) * 86400)
    today = day_of(now)
    rows = db.execute('SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM visits WHERE day >= ? '
                      'GROUP BY day ORDER BY day', (since,)).fetchall()
    by_day = {r['day']: (r['views'], r['visitors']) for r in rows}
    daily = []
    for i in range(days - 1, -1, -1):
        d = day_of(now - i * 86400)
        views, visitors = by_day.get(d, (0, 0))
        daily.append(dict(day=d, views=views, visitors=visitors))
    def top(column, limit=10, extra=''):
        return [dict(name=r[0], views=r[1]) for r in db.execute(
            f'SELECT {column}, COUNT(*) FROM visits WHERE day >= ? {extra} GROUP BY {column} ORDER BY 2 DESC LIMIT ?',
            (since, limit))]
    total = db.execute('SELECT COUNT(*), COUNT(DISTINCT visitor || day) FROM visits WHERE day >= ?', (since,)).fetchone()
    members = db.execute('SELECT COUNT(DISTINCT user_id) FROM visits WHERE day >= ? AND user_id IS NOT NULL', (since,)).fetchone()[0]
    return dict(days=days, today=dict(zip(('views', 'visitors'), by_day.get(today, (0, 0)))),
                views=total[0], visitors=total[1], members=members, daily=daily,
                pages=top('path'), referrers=top('ref', extra="AND ref != ''"), devices=top('device', 5))
