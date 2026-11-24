@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-EvernoteArchive.ps1" -Share -Port 4319
if errorlevel 1 pause
