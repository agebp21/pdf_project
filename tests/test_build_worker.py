"""Remote builds: a server without Flutter (the VPS) queues APK/EXE jobs; the
build PC (build_worker.py) claims them with BUILD_WORKER_KEY, builds (here a
stand-in for server.build_job) and sends the file back; the reader downloads
it as usual. A wrong key is refused; a failed build reports its log."""
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import build_worker
import server


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class RemoteBuilds(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        cls.port = free_port()
        flutter = shutil.which('flutter')
        path = os.pathsep.join(p for p in os.environ.get('PATH', '').split(os.pathsep)
                               if not (flutter and Path(p).resolve() == Path(flutter).resolve().parent))
        env = dict(os.environ, PATH=path, MYFLIPBOOK_DB=str(Path(cls.tmp.name) / 'a.sqlite3'), BUILD_WORKER_KEY='worker-key-123')
        cls.proc = subprocess.Popen([sys.executable, str(ROOT / 'server.py'), '--port', str(cls.port), '--no-paywall'], cwd=ROOT, env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                cls.call('GET', '/api/capabilities'); break
            except OSError:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate(); cls.proc.wait(10); cls.tmp.cleanup()

    @classmethod
    def call(cls, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=20)
        conn.request(method, path, body, dict({'Host': f'127.0.0.1:{cls.port}'}, **(headers or {})))
        r = conn.getresponse(); data = r.read(); conn.close()
        try:
            return r.status, json.loads(data)
        except ValueError:
            return r.status, data

    def order(self, target):
        _, caps = self.call('GET', '/api/capabilities')
        status, body = self.call('POST', f'/api/build/{target}', b'PK-book-bundle',
                                 {'Content-Type': 'application/zip', 'X-Build-Token': caps['token']})
        self.assertEqual(status, 202, body)
        return body['id']

    def fake_build(self, ok):
        def build_job(job_id, target):
            job, folder = server.JOBS[job_id], server.BUILD / job_id
            try:
                self.assertEqual((folder / 'input.zip').read_bytes(), b'PK-book-bundle', 'the book reached the build PC')
                job.update(status='running', message='Membangun…', progress=0.5)
                if ok:
                    (folder / 'flipbook.apk').write_bytes(b'APK-BYTES')
                    job.update(status='done', artifact='flipbook.apk', download_name='Buku Saya.apk', progress=1)
                else:
                    (folder / 'build.log').write_text('gradle exploded', encoding='utf-8')
                    job.update(status='failed', message='Build gagal.')
            finally:
                server.BUILD_LOCK.release()
        return build_job

    def test_1_queue_build_and_download(self):
        _, caps = self.call('GET', '/api/capabilities')
        self.assertEqual((caps['apk'], caps['exe'], caps['buildWorker']), (True, True, 'offline'))
        job_id = self.order('exe')
        _, job = self.call('GET', f'/api/jobs/{job_id}')
        self.assertEqual(job['status'], 'queued'); self.assertIn('offline', job['message'])
        # Wrong key: refused.
        bad = build_worker.Worker(f'http://127.0.0.1:{self.port}', 'nope')
        with self.assertRaises(Exception):
            bad.run_one()
        worker = build_worker.Worker(f'http://127.0.0.1:{self.port}', 'worker-key-123', log=lambda *a: None)
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as local, \
                mock.patch.object(server, 'BUILD', Path(local)), mock.patch.object(server, 'build_job', self.fake_build(True)):
            self.assertTrue(worker.run_one())
            self.assertFalse(worker.run_one(), 'queue empty')
        _, caps = self.call('GET', '/api/capabilities')
        self.assertEqual(caps['buildWorker'], 'online')
        _, job = self.call('GET', f'/api/jobs/{job_id}')
        self.assertEqual((job['status'], job['download_name']), ('done', 'Buku Saya.apk'))
        status, data = self.call('GET', job['download'])
        self.assertEqual((status, data), (200, b'APK-BYTES'))

    def test_2_failed_build_reports(self):
        job_id = self.order('apk')
        worker = build_worker.Worker(f'http://127.0.0.1:{self.port}', 'worker-key-123', log=lambda *a: None)
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as local, \
                mock.patch.object(server, 'BUILD', Path(local)), mock.patch.object(server, 'build_job', self.fake_build(False)):
            self.assertTrue(worker.run_one())
        _, job = self.call('GET', f'/api/jobs/{job_id}')
        self.assertEqual(job['status'], 'failed')
        self.assertEqual(self.call('GET', job['log'])[1], b'gradle exploded')


class RemoteTranslation(unittest.TestCase):
    """Whole-book free translation without Argos on the server: batches go to the PC."""
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        cls.port = free_port()
        env = dict(os.environ, MYFLIPBOOK_DB=str(Path(cls.tmp.name) / 'a.sqlite3'), BUILD_WORKER_KEY='worker-key-123', FREE_TRANSLATE_LOCAL='0')
        cls.proc = subprocess.Popen([sys.executable, str(ROOT / 'server.py'), '--port', str(cls.port), '--no-paywall'], cwd=ROOT, env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                RemoteBuilds.call.__func__(cls, 'GET', '/api/capabilities'); break
            except OSError:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate(); cls.proc.wait(10); cls.tmp.cleanup()

    def translate(self, results):
        _, caps = RemoteBuilds.call.__func__(type(self), 'GET', '/api/capabilities')
        body = json.dumps({'pages': {'0': 'Good morning.', '3': 'The old lighthouse.'}, 'target': 'id-ID'}).encode()
        results.append(RemoteBuilds.call.__func__(type(self), 'POST', '/api/translate-free', body,
                                                  {'Content-Type': 'application/json', 'X-Build-Token': caps['token']}))

    def test_1_offline_pc(self):
        out = []; self.translate(out)
        self.assertEqual(out[0][0], 503); self.assertIn('offline', out[0][1]['error'])

    def test_2_pc_translates(self):
        import threading
        worker = build_worker.Worker(f'http://127.0.0.1:{self.port}', 'worker-key-123', log=lambda *a: None)
        fake = lambda pages, target: {k: '<' + target + '> ' + v for k, v in pages.items()}
        with mock.patch('free_translate.translate_texts', fake):
            # The PC is seen (a quick claim with nothing waiting), then a reader asks.
            first = threading.Thread(target=worker.run_translate_one); first.start(); first.join(40)
            out = []
            asking = threading.Thread(target=self.translate, args=(out,)); asking.start()
            self.assertTrue(worker.run_translate_one(), 'the PC took the batch')
            asking.join(30)
        status, body = out[0]
        self.assertEqual(status, 200, body)
        self.assertEqual(body['pages'], {'0': '<id-ID> Good morning.', '3': '<id-ID> The old lighthouse.'})
        self.assertEqual(body['engine'], 'free')


if __name__ == '__main__':
    unittest.main()
