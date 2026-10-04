"""Build PC for the live site: takes queued APK/EXE builds (and whole-book
free-translation batches, when the server has no Argos) from
myflipbookpro.com, builds them here with the normal build (server.build_job:
Flutter, Android SDK, release signing key, Windows launcher) and sends the
result back. The live server (no Flutter) queues builds while this runs.

  python build_worker.py                         # https://myflipbookpro.com, key from .env
  python build_worker.py --server http://localhost:8080 --once

Needs BUILD_WORKER_KEY in this computer's .env (the same value as on the
server). Leave it running; when the computer is off, builds wait in the queue.
"""
import argparse
import json
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import quote

import server

POLL_SECONDS = 10


class Worker:
    def __init__(self, base, key, log=print, on_job=None):
        self.base, self.key, self.log = base.rstrip('/'), key, log
        self.on_job = on_job or (lambda job: None)      # {'id', 'target'} while building, None after
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}) if '//localhost' in base or '//127.' in base else urllib.request.ProxyHandler())

    def request(self, method, path, body=None, content_type='application/json', headers=None, timeout=60):
        data = json.dumps(body).encode() if isinstance(body, (dict, list)) else body
        h = {'X-Worker-Key': self.key, 'User-Agent': 'MyFlipbook-build-worker'}
        if data is not None:
            h['Content-Type'] = content_type
        h.update(headers or {})
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        with self.opener.open(req, timeout=timeout) as r:
            raw = r.read()
            return json.loads(raw) if r.headers.get_content_type() == 'application/json' else raw

    def run_translate_one(self):
        """Wait (long poll) for one free-translation batch and answer it; False when none came."""
        task = self.request('POST', '/api/worker/translate/claim', {}, timeout=60)
        if not task.get('id'):
            return False
        import free_translate
        try:
            answer = {'pages': free_translate.translate_texts(task['pages'], task['target'])}
        except Exception as cause:
            answer = {'error': str(cause)[:300]}
        self.request('POST', f"/api/worker/translate/{task['id']}/result", answer)
        self.log(f'{time.strftime("%H:%M:%S")} translated {len(task["pages"])} block(s) to {task["target"]}' if 'pages' in answer
                 else f'{time.strftime("%H:%M:%S")} translation failed: {answer["error"]}')
        return True

    def translate_loop(self, stop=None):
        """Answer translation batches until stop is set (a thread of its own)."""
        while not (stop and stop.is_set()):
            try:
                self.run_translate_one()
            except urllib.error.HTTPError as cause:
                if cause.code == 403:
                    return
                time.sleep(POLL_SECONDS)
            except (urllib.error.URLError, OSError):
                time.sleep(POLL_SECONDS)

    def run_one(self):
        """Claim one job and build it; False when the queue is empty."""
        job = self.request('POST', '/api/worker/claim', {})
        if not job.get('id'):
            return False
        job_id, target = job['id'], job['target']
        self.on_job(job)
        self.log(f'{time.strftime("%H:%M:%S")} build {target.upper()} {job_id[:8]}…')
        folder = server.BUILD / job_id
        try:
            folder.mkdir(parents=True, exist_ok=True)
            (folder / 'input.zip').write_bytes(self.request('GET', f'/api/worker/jobs/{job_id}/input', timeout=600))
            local = server.JOBS[job_id] = dict(id=job_id, status='queued', message='Build menunggu…', progress=0)
            server.BUILD_LOCK.acquire()                       # build_job releases it
            thread = threading.Thread(target=server.build_job, args=(job_id, target), daemon=True)
            thread.start()
            sent = None
            while thread.is_alive():
                thread.join(3)
                news = (local.get('message'), round(local.get('progress', 0), 2))
                if news != sent and local['status'] == 'running':
                    try:
                        self.request('POST', f'/api/worker/jobs/{job_id}/progress', {'message': news[0], 'progress': news[1]})
                    except (urllib.error.URLError, OSError):
                        pass
                    sent = news
            if local['status'] == 'done':
                data = (folder / local['artifact']).read_bytes()
                self.request('POST', f'/api/worker/jobs/{job_id}/result', data, 'application/octet-stream',
                             {'X-Download-Name': quote(local.get('download_name', local['artifact']))}, timeout=900)
                self.log(f'{time.strftime("%H:%M:%S")} done {job_id[:8]} ({len(data) // 1024} KB)')
            else:
                log = (folder / 'build.log').read_text(encoding='utf-8', errors='replace') if (folder / 'build.log').is_file() else ''
                self.request('POST', f'/api/worker/jobs/{job_id}/fail', {'message': local.get('message', 'Build gagal.'), 'log': log})
                self.log(f'{time.strftime("%H:%M:%S")} failed {job_id[:8]}: {local.get("message")}')
        except Exception as cause:
            try:
                self.request('POST', f'/api/worker/jobs/{job_id}/fail', {'message': 'PC build error: ' + str(cause)[:200]})
            except Exception:
                pass
            self.log(f'{time.strftime("%H:%M:%S")} error {job_id[:8]}: {cause}')
        finally:
            server.JOBS.pop(job_id, None)
            shutil.rmtree(folder, ignore_errors=True)
            self.on_job(None)
        return True


def main():
    parser = argparse.ArgumentParser(description='Build PC for myflipbookpro.com (APK/EXE).')
    parser.add_argument('--server', default='https://myflipbookpro.com')
    parser.add_argument('--once', action='store_true', help='Build what is queued, then stop.')
    args = parser.parse_args()
    server.load_env(server.ROOT / '.env')
    import os
    key = os.environ.get('BUILD_WORKER_KEY', '').strip()
    if not key:
        sys.exit('BUILD_WORKER_KEY is missing in .env (same value as on the server).')
    if not shutil.which('flutter'):
        sys.exit('Flutter is not installed on this computer.')
    worker = Worker(args.server, key)
    print(f'MyFlipbook build PC: waiting for builds from {args.server} (Ctrl+C to stop)')
    if not args.once:
        threading.Thread(target=worker.translate_loop, daemon=True).start()
    while True:
        try:
            busy = worker.run_one()
        except urllib.error.HTTPError as cause:
            if cause.code == 403:
                sys.exit('The server refused the worker key (BUILD_WORKER_KEY differs?).')
            print(f'{time.strftime("%H:%M:%S")} server said {cause.code}; retrying'); busy = False
        except (urllib.error.URLError, OSError) as cause:
            print(f'{time.strftime("%H:%M:%S")} server not reachable ({cause}); retrying'); busy = False
        if args.once and not busy:
            return
        if not busy:
            time.sleep(POLL_SECONDS)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
