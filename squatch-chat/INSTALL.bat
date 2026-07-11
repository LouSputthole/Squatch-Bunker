@echo off
echo.
echo   Starting Campfire installer...
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
