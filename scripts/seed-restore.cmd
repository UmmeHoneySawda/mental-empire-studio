@echo off
REM Double-clickable restore of Mental Empire Studio user data from the local
REM snapshot (settings, API configs, sources, channels, automations, library).
REM Close the app first (including the tray icon).
setlocal
set "HERE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%seed-restore.ps1" %*
echo.
echo Press any key to close...
pause >nul
