@echo off
REM ──────────────────────────────────────────────
REM Campfire — Quick Host Script (Windows)
REM Starts the app so others on your network can connect.
REM Usage:  scripts\host.bat
REM ──────────────────────────────────────────────

set APP_PORT=3000
set SOCKET_PORT=3001

REM Detect LAN IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        set LAN_IP=%%b
        goto :found
    )
)
:found

if "%LAN_IP%"=="" (
    echo WARNING: Could not detect LAN IP, using localhost
    set LAN_IP=localhost
)

echo.
echo   ==========================================
echo     Campfire is starting
echo   ==========================================
echo.
echo   Local:   http://localhost:%APP_PORT%
echo   Network: http://%LAN_IP%:%APP_PORT%
echo   Socket:  http://%LAN_IP%:%SOCKET_PORT%
echo.
echo   Share the Network URL with others!
echo   ==========================================
echo.

set NEXT_PUBLIC_APP_URL=http://%LAN_IP%:%APP_PORT%
set NEXT_PUBLIC_SOCKET_URL=http://%LAN_IP%:%SOCKET_PORT%
set PORT=%APP_PORT%

REM Start realtime server in background
echo [Campfire] Starting realtime server on port %SOCKET_PORT%...
start /b npx tsx realtime/server.ts

REM Start Next.js
echo [Campfire] Starting web server on port %APP_PORT%...
npx next start -p %APP_PORT% -H 0.0.0.0
