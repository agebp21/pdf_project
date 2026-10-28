"""Video Overview: slide-to-PNG rendering, the ffmpeg pipeline (mocked — no real browser,
Piper voices or ffmpeg needed in CI), and the /api/video-overview + shared /api/jobs/<id>
polling route."""
import json
import os
from pathlib import Path
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class SlideHtmlTests(unittest.TestCase):
    def test_escapes_content_and_numbers_the_slide(self):
        html = server.slide_html({'title': 'A & <B>', 'points': ['x < y', 'ok']}, 2, 8)
        self.assertIn('A &amp; &lt;B&gt;', html)
        self.assertIn('<li>x &lt; y</li><li>ok</li>', html)
        self.assertIn('3 / 8', html)


class VideoOverviewJobTests(unittest.TestCase):
    def setUp(self):
        server.JOBS.clear()
        if server.BUILD_LOCK.locked():
            server.BUILD_LOCK.release()

    def run_job(self, slides, ffmpeg_ok=True, ffmpeg_found='/usr/bin/ffmpeg', voices_available=True):
        job_id = 'deadbeef' * 4
        folder = server.BUILD / job_id
        folder.mkdir(parents=True, exist_ok=True)
        server.JOBS[job_id] = dict(id=job_id, status='queued', message='', progress=0)
        fake_speaker = mock.MagicMock()
        fake_speaker.available.return_value = voices_available
        fake_speaker.wav.return_value = b'RIFF....WAVEfake'

        def fake_run(args, **kwargs):
            out = Path(args[-1])
            if ffmpeg_ok:
                out.write_bytes(b'fake-mp4-bytes')
            return mock.MagicMock(returncode=0 if ffmpeg_ok else 1)

        server.BUILD_LOCK.acquire()         # video_overview_job's `finally` always releases it, as the route does
        with mock.patch.object(server, 'make_slides', return_value=slides), \
             mock.patch.object(server, 'find_ffmpeg', return_value=ffmpeg_found), \
             mock.patch.object(server, 'piper_speaker', return_value=fake_speaker), \
             mock.patch.object(server, 'render_slide_png', return_value=b'\x89PNGfake'), \
             mock.patch('subprocess.run', side_effect=fake_run):
            server.video_overview_job(job_id, 'Gamelan', '[Halaman 1]\nisi', 'id-ID', '')
        return server.JOBS[job_id], folder

    def test_happy_path_produces_a_done_job(self):
        slides = [{'title': f'S{i}', 'points': ['a'], 'notes': f'Narasi {i}'} for i in range(3)]
        job, folder = self.run_job(slides)
        self.assertEqual(job['status'], 'done')
        self.assertEqual(job['progress'], 1)
        self.assertEqual(job['artifact'], 'video-overview.mp4')
        self.assertTrue(job['download_name'].endswith(' - Video Overview.mp4'))
        self.assertEqual(job['download'], f'/api/jobs/{job["id"]}/download')
        self.assertTrue((folder / 'video-overview.mp4').is_file())
        # per-slide scratch files are cleaned up once the final video exists
        self.assertEqual(list(folder.glob('slide-*.png')), [])
        self.assertEqual(list(folder.glob('clip-*.mp4')), [])

    def test_missing_ffmpeg_fails_the_job(self):
        job, _ = self.run_job([{'title': 'S', 'points': []}], ffmpeg_found=None)
        self.assertEqual(job['status'], 'failed')
        self.assertIn('ffmpeg tidak ditemukan', job['message'])

    def test_missing_voices_fails_the_job(self):
        job, _ = self.run_job([{'title': 'S', 'points': []}], voices_available=False)
        self.assertEqual(job['status'], 'failed')
        self.assertIn('belum terpasang', job['message'])

    def test_ffmpeg_failure_fails_the_job(self):
        job, _ = self.run_job([{'title': 'S', 'points': []}], ffmpeg_ok=False)
        self.assertEqual(job['status'], 'failed')
        self.assertIn('ffmpeg gagal', job['message'])

    def test_build_lock_always_released(self):
        self.run_job([{'title': 'S', 'points': []}])
        self.assertFalse(server.BUILD_LOCK.locked(), 'the job releases the lock it ran under, success or failure')


class VideoOverviewRouteTests(unittest.TestCase):
    def setUp(self):
        server.JOBS.clear()
        if server.BUILD_LOCK.locked():
            server.BUILD_LOCK.release()
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True); self.thread.start()

    def tearDown(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.thread.join()
        if server.BUILD_LOCK.locked():
            server.BUILD_LOCK.release()

    def post(self, path, body):
        request = urllib.request.Request(f'http://127.0.0.1:{self.httpd.server_port}{path}', data=json.dumps(body).encode(), method='POST',
                                         headers={'Content-Type': 'application/json', 'X-Build-Token': server.TOKEN})
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.loads(error.read())

    def get(self, path):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{self.httpd.server_port}{path}') as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.loads(error.read())

    def test_starts_a_job_pollable_through_the_shared_jobs_route(self):
        words = ' '.join(['kata'] * 60)
        done = threading.Event()

        def fake_job(job_id, title, text, lang, work):
            server.JOBS[job_id].update(status='done', message='ok', progress=1, artifact='video-overview.mp4',
                                       download_name='Gamelan - Video Overview.mp4', download=f'/api/jobs/{job_id}/download')
            server.BUILD_LOCK.release()
            done.set()
        with mock.patch.object(server, 'video_overview_job', side_effect=fake_job):
            status, body = self.post('/api/video-overview', {'title': 'Gamelan', 'text': {'0': [words]}, 'lang': 'id-ID'})
        self.assertEqual(status, 202)
        job_id = body['id']
        self.assertTrue(done.wait(5))
        status, job = self.get(f'/api/jobs/{job_id}')
        self.assertEqual((status, job['status'], job['download']), (200, 'done', f'/api/jobs/{job_id}/download'))

    def test_a_running_build_blocks_a_new_one(self):
        server.BUILD_LOCK.acquire()
        try:
            status, body = self.post('/api/video-overview', {'text': {'0': [' '.join(['kata'] * 60)]}})
            self.assertEqual(status, 409)
        finally:
            server.BUILD_LOCK.release()

    def test_too_little_text_is_rejected(self):
        status, _ = self.post('/api/video-overview', {'text': {'0': ['sedikit']}})
        self.assertEqual(status, 400)


if __name__ == '__main__':
    unittest.main()
