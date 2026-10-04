"""The build PC in the system tray (no window): build_worker.py's loops (APK/EXE
builds, whole-book free translations) with a
small icon by the clock — green: waiting for builds, orange: building, red:
the server cannot be reached. Menu: status, open the log, open the site, quit.

  pythonw build_worker_tray.py            # start-build-worker.bat does this

Only one build PC runs at a time on this computer (a second start just exits).
"""
import logging
import os
from pathlib import Path
import shutil
import socket
import sys
import threading
import time
import urllib.error
import webbrowser

import pystray
from PIL import Image, ImageDraw

import build_worker
import server

SITE = 'https://myflipbookpro.com'
LOG = server.ROOT / '.data' / 'build-worker.log'
SINGLE_PORT = 47391                 # held while running: a second copy sees it taken and exits
COLORS = {'idle': (47, 158, 68), 'busy': (240, 140, 0), 'offline': (201, 42, 42), 'stopped': (134, 142, 150)}


def icon_image(state):
    image = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((4, 8, 60, 56), 10, fill=(26, 60, 52))            # a book
    draw.line((32, 12, 32, 52), fill=(255, 255, 255), width=3)
    draw.ellipse((38, 34, 62, 58), fill=COLORS[state], outline=(255, 255, 255), width=3)
    return image


class TrayWorker:
    def __init__(self, key):
        self.state, self.detail, self.stop = 'idle', 'Menunggu build…', threading.Event()
        self.worker = build_worker.Worker(SITE, key, log=logging.info, on_job=self.job_changed)
        self.icon = pystray.Icon('myflipbook-build', icon_image('idle'), self.title(), menu=pystray.Menu(
            pystray.MenuItem(lambda item: self.detail, None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem('Buka log build', lambda: os.startfile(LOG) if LOG.exists() else None),
            pystray.MenuItem('Buka myflipbookpro.com', lambda: webbrowser.open(SITE)),
            pystray.MenuItem('Keluar (build berhenti)', self.quit)))

    def title(self):
        return 'MyFlipbook build PC — ' + self.detail

    def show(self, state, detail):
        self.state, self.detail = state, detail
        self.icon.icon = icon_image(state)
        self.icon.title = self.title()[:120]
        self.icon.update_menu()

    def job_changed(self, job):
        if job:
            self.show('busy', f"Sedang build {job['target'].upper()}…")
        else:
            self.show('idle', 'Menunggu build…')

    def loop(self):
        while not self.stop.is_set():
            try:
                busy = self.worker.run_one()
                if self.state == 'offline':
                    self.show('idle', 'Menunggu build…')
            except urllib.error.HTTPError as cause:
                busy = False
                if cause.code == 403:
                    self.show('stopped', 'Kunci worker ditolak server (BUILD_WORKER_KEY beda?)')
                    logging.error('worker key refused'); return
                self.show('offline', f'Server menjawab {cause.code}, mencoba lagi…')
            except (urllib.error.URLError, OSError) as cause:
                busy = False
                self.show('offline', 'Server tidak terjangkau, mencoba lagi…')
                logging.warning('server not reachable: %s', cause)
            if not busy:
                self.stop.wait(build_worker.POLL_SECONDS)

    def quit(self):
        self.stop.set()
        self.icon.stop()

    def run(self):
        threading.Thread(target=self.loop, daemon=True).start()
        threading.Thread(target=self.worker.translate_loop, args=(self.stop,), daemon=True).start()   # whole-book translations
        self.icon.run()


def main():
    LOG.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=LOG, level=logging.INFO, format='%(asctime)s %(message)s')
    guard = socket.socket()
    try:
        guard.bind(('127.0.0.1', SINGLE_PORT))      # one build PC per computer
    except OSError:
        return
    server.load_env(server.ROOT / '.env')
    key = os.environ.get('BUILD_WORKER_KEY', '').strip()
    if not key or not shutil.which('flutter'):
        logging.error('cannot start: %s', 'BUILD_WORKER_KEY missing' if not key else 'Flutter not installed')
        return
    logging.info('build PC started (tray), server %s', SITE)
    TrayWorker(key).run()


if __name__ == '__main__':
    main()
