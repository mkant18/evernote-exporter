@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Export-EvernoteBackup.ps1" %*
set "result=%errorlevel%"
pause
exit /b %result%
