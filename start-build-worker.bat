@echo off
rem MyFlipbook build PC: takes APK/EXE builds from myflipbookpro.com (keep it running).
rem Put a shortcut to this file in shell:startup to start it with Windows.
cd /d "%~dp0"
start "MyFlipbook build PC" /min python -u build_worker.py >> .datauild-worker.log 2>&1
