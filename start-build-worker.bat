@echo off
rem MyFlipbook build PC: takes APK/EXE builds from myflipbookpro.com.
rem Runs as an icon in the system tray (no window); a second start does nothing.
rem A shortcut to this file in shell:startup starts it with Windows.
cd /d "%~dp0"
start "" pythonw build_worker_tray.py
