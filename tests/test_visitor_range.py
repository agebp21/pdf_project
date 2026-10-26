"""Visitor timestamp bounds must apply before totals and detail grouping."""
import pathlib
import sqlite3
import sys
import tempfile
import time
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import visits
import admin_server


class VisitorRangeTests(unittest.TestCase):
    def test_exact_bounds_and_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            tracker = visits.Visits(pathlib.Path(tmp)/'visits.db')
            now = int(time.time())
            agent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/150'
            for offset, ip in [(-3600,'1.1.1.1'),(-60,'2.2.2.2'),(3600,'3.3.3.3')]:
                tracker.record('/page',ip,agent,now=now+offset)
            with sqlite3.connect(tracker.path) as db:
                db.row_factory = sqlite3.Row
                self.assertEqual(visits.stats(db,1,now,start=now-120,end=now)['views'],1)
                self.assertEqual(len(visits.visitors(db,1,now,start=now-120,end=now)),1)
            db.close()
            self.assertEqual(admin_server.visitor_range('', '', 30),(None,None,30))
            with self.assertRaises(ValueError):
                admin_server.visitor_range(str(now),str(now-1),30)
