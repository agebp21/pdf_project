"""Visitor place (geo.py): a small MaxMind DB reader over the DB-IP Lite files,
used for the admin statistics — the place names are kept, the IP never is."""
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import geo
import visits


def enc(value):
    """MaxMind DB data encoding (only what the test needs)."""
    def head(kind, size):
        extra = b'' if size < 29 else bytes([size - 29])      # sizes 29..284: one more byte
        size = min(size, 29)
        return (bytes([(kind << 5) | size]) if kind < 8 else bytes([size, kind - 7])) + extra
    if isinstance(value, str):
        raw = value.encode()
        return head(2, len(raw)) + raw
    if isinstance(value, int):
        raw = value.to_bytes(4, 'big').lstrip(b'\0')
        return head(6, len(raw)) + raw
    if isinstance(value, list):
        return head(11, len(value)) + b''.join(enc(v) for v in value)
    return head(7, len(value)) + b''.join(enc(k) + enc(v) for k, v in value.items())


def mmdb(path, prefix, record):
    """An IPv4 database (record size 24) where every address in prefix/8 maps to record."""
    nodes = 8
    data = enc(record)
    tree = b''
    for i in range(nodes):
        bit = (prefix >> (7 - i)) & 1
        nxt = i + 1 if i < nodes - 1 else nodes + 16      # the last step points at the data (offset 0)
        pair = [nodes, nodes]                            # the other way: not in the database
        pair[bit] = nxt
        tree += pair[0].to_bytes(3, 'big') + pair[1].to_bytes(3, 'big')
    meta = enc({'node_count': nodes, 'record_size': 24, 'ip_version': 4, 'binary_format_major_version': 2})
    Path(path).write_bytes(tree + b'\0' * 16 + data + geo.META + meta)


class GeoTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        folder = Path(self.tmp.name)
        mmdb(folder / geo.FILES['city'], 36, {'country': {'iso_code': 'ID', 'names': {'en': 'Indonesia'}},
                                              'subdivisions': [{'names': {'en': 'East Java'}}], 'city': {'names': {'en': 'Malang'}}})
        mmdb(folder / geo.FILES['asn'], 36, {'autonomous_system_number': 7713, 'autonomous_system_organization': 'Telkom'})
        self.env = mock.patch.dict(os.environ, {'GEOIP_DIR': str(folder)})
        self.env.start()

    def tearDown(self):
        for _, r in geo.READERS.values():
            r.close()
        geo.READERS.clear()
        self.env.stop(); self.tmp.cleanup()

    def test_lookup(self):
        self.assertEqual(geo.lookup('36.68.1.1'), {'country': 'Indonesia', 'country_code': 'ID', 'region': 'East Java',
                                                   'city': 'Malang', 'isp': 'Telkom'})
        self.assertIsNone(geo.lookup('37.1.1.1'), 'not in the database')
        self.assertIsNone(geo.lookup('192.168.1.5'), 'private address')
        self.assertIsNone(geo.lookup('not an ip'))
        self.assertIsNone(geo.lookup('::1'))

    def test_no_database(self):
        with mock.patch.dict(os.environ, {'GEOIP_DIR': str(Path(self.tmp.name) / 'none')}):
            geo.READERS.clear()
            self.assertIsNone(geo.lookup('36.68.1.1'))

    def test_stats_keep_place_not_ip(self):
        v = visits.Visits(Path(self.tmp.name) / 'visits.sqlite3')
        agent = 'Mozilla/5.0 Chrome/150'
        now = int(time.time())
        v.record('/index.html', '36.68.1.1', agent, '', None, now=now + 0, place=geo.lookup('36.68.1.1'))
        v.record('/flipbook.html', '36.68.1.1', agent, '', None, now=now + 1, place=geo.lookup('36.68.1.1'))
        v.record('/index.html', '8.8.8.8', agent, '', None, now=now + 2, place=geo.lookup('8.8.8.8'))
        db = sqlite3.connect(Path(self.tmp.name) / 'visits.sqlite3'); db.row_factory = sqlite3.Row
        s = visits.stats(db)
        dump = '\n'.join(db.iterdump()); db.close()
        self.assertNotIn('36.68.1.1', dump)
        self.assertEqual(s['countries'], [{'name': 'Indonesia', 'views': 1}], 'counted per visitor, not per page')
        self.assertEqual(s['regions'], [{'name': 'East Java, Indonesia', 'views': 1}])
        self.assertEqual(s['cities'], [{'name': 'Malang · East Java', 'views': 1}])
        self.assertEqual(s['isps'], [{'name': 'Telkom', 'views': 1}])
        self.assertEqual(len(s['recent']), 3); self.assertEqual(s['recent'][0]['country'], '')

    def test_old_database_gets_columns(self):
        path = Path(self.tmp.name) / 'old.sqlite3'
        db = sqlite3.connect(path)
        db.execute("CREATE TABLE visits(ts INTEGER NOT NULL, day TEXT NOT NULL, path TEXT NOT NULL, visitor TEXT NOT NULL, user_id INTEGER, ref TEXT NOT NULL DEFAULT '', device TEXT NOT NULL DEFAULT 'desktop')")
        db.execute("INSERT INTO visits VALUES(?, '2026-10-01', '/index.html', 'abc', NULL, '', 'desktop')", (int(time.time()) - 60,))
        db.commit()
        db.row_factory = sqlite3.Row
        self.assertEqual(visits.stats(db)['countries'], [], 'an old table still reads')
        db.close()
        visits.Visits(path).record('/index.html', '36.1.1.1', 'Mozilla/5.0', place={'country': 'Indonesia'})
        db = sqlite3.connect(path)
        self.assertEqual(db.execute('SELECT country FROM visits ORDER BY ts').fetchall(), [('',), ('Indonesia',)]); db.close()


if __name__ == '__main__':
    unittest.main()
