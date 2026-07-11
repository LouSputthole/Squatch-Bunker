@echo off
REM Campfire — One-Command Host (Windows)
REM Usage:  npm run host
cd /d "%~dp0\.."
if "%PORT%"=="" set PORT=3000
if "%JWT_SECRET%"=="" set JWT_SECRET=campfire-host-%RANDOM%%RANDOM%
npx tsx server.ts
