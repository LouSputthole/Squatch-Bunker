# ═══════════════════════════════════════════════════════════════
#  SquatchChat Installer — Windows (PowerShell)
#  One command: .\install.ps1
# ═══════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"

function Write-Banner {
    Write-Host ""
    Write-Host "  ____                    _       _      ____ _           _   " -ForegroundColor Green
    Write-Host " / ___|  __ _ _   _  __ _| |_ ___| |__  / ___| |__   __ _| |_ " -ForegroundColor Green
    Write-Host " \___ \ / _`` | | | |/ _`` | __/ __| '_ \| |   | '_ \ / _`` | __|" -ForegroundColor Green
    Write-Host "  ___) | (_| | |_| | (_| | || (__| | | | |___| | | | (_| | |_ " -ForegroundColor Green
    Write-Host " |____/ \__, |\__,_|\__,_|\__\___|_| |_|\____|_| |_|\__,_|\__|" -ForegroundColor Green
    Write-Host "            |_|                                                " -ForegroundColor Green
    Write-Host ""
    Write-Host "  Private chat for creatures of the forest" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step($msg) { Write-Host "`n[OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "`n[!] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "`n[X] $msg" -ForegroundColor Red }
function Write-Info($msg)  { Write-Host "    -> $msg" -ForegroundColor Cyan }

function Test-CommandExists($cmd) {
    try { Get-Command $cmd -ErrorAction Stop | Out-Null; return $true }
    catch { return $false }
}

# ── Banner ────────────────────────────────────────────────────

Write-Banner
Write-Host "Checking prerequisites...`n" -NoNewline

# ── Check Node.js ─────────────────────────────────────────────

if (Test-CommandExists "node") {
    $nodeVersion = node -v
    Write-Info "Node.js found: $nodeVersion"
    $nodeMajor = [int]($nodeVersion -replace 'v','').Split('.')[0]
    if ($nodeMajor -lt 18) {
        Write-Err "Node.js 18+ required (found $nodeVersion)"
        Write-Host "    Install from: https://nodejs.org/"
        exit 1
    }
} else {
    Write-Err "Node.js not found"
    Write-Host ""
    Write-Host "  Install Node.js 18+ from:"
    Write-Host "    * https://nodejs.org/ (official installer)"
    Write-Host "    * winget: winget install OpenJS.NodeJS.LTS"
    Write-Host "    * choco:  choco install nodejs-lts"
    exit 1
}

# ── Check pnpm ────────────────────────────────────────────────

if (Test-CommandExists "pnpm") {
    Write-Info "pnpm found: $(pnpm -v)"
} else {
    Write-Warn "pnpm not found - installing it now"
    npm install -g pnpm
    Write-Info "pnpm installed: $(pnpm -v)"
}

# ── Check PostgreSQL ──────────────────────────────────────────

$pgAvailable = $false
if (Test-CommandExists "psql") {
    Write-Info "PostgreSQL client found"
    $pgAvailable = $true
} elseif (Test-CommandExists "pg_isready") {
    Write-Info "PostgreSQL detected via pg_isready"
    $pgAvailable = $true
}

if (-not $pgAvailable) {
    Write-Warn "PostgreSQL not detected on this system"
    Write-Host ""
    Write-Host "  You have three options:"
    Write-Host ""
    Write-Host "  1. Install PostgreSQL locally:"
    Write-Host "     * https://www.postgresql.org/download/windows/"
    Write-Host "     * winget: winget install PostgreSQL.PostgreSQL.16"
    Write-Host "     * choco:  choco install postgresql16"
    Write-Host ""
    Write-Host "  2. Use Docker Desktop:"
    Write-Host "     docker run -d --name squatch-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=squatchchat -p 5432:5432 postgres:16"
    Write-Host ""
    Write-Host "  3. Use a remote PostgreSQL (update DATABASE_URL in .env after install)"
    Write-Host ""
    $reply = Read-Host "  Continue without PostgreSQL? (y/N)"
    if ($reply -ne "y" -and $reply -ne "Y") {
        Write-Host "  Install PostgreSQL first, then re-run this script."
        exit 1
    }
}

# ── Install dependencies ─────────────────────────────────────

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Step "Installing dependencies..."
pnpm install

# ── Configure environment ─────────────────────────────────────

if (-not (Test-Path ".env")) {
    Write-Step "Creating .env configuration..."
    Copy-Item ".env.example" ".env"

    # Generate a random JWT secret
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $jwtSecret = [System.BitConverter]::ToString($bytes) -replace '-',''
    $envContent = Get-Content ".env" -Raw
    $envContent = $envContent -replace "squatch-secret-change-me-in-production", $jwtSecret.ToLower()
    Set-Content ".env" $envContent -NoNewline
    Write-Info "Generated random JWT secret"
} else {
    Write-Info ".env already exists - keeping existing config"
}

# ── Set up database ───────────────────────────────────────────

Write-Step "Generating Prisma client..."
npx prisma generate

if ($pgAvailable) {
    Write-Step "Setting up database..."
    Write-Info "Running database migrations..."
    try {
        npx prisma migrate dev --name init 2>$null
    } catch {
        Write-Warn "Migration failed - you may need to configure DATABASE_URL in .env"
        Write-Info "Edit .env, set your DATABASE_URL, then run: pnpm db:migrate"
    }
} else {
    Write-Warn "Skipping database setup (PostgreSQL not available)"
    Write-Info "After installing PostgreSQL, run: pnpm db:migrate"
}

# ── Build the app ─────────────────────────────────────────────

Write-Step "Building SquatchChat..."
try {
    pnpm build 2>&1
} catch {
    Write-Warn "Build had warnings (this is usually fine for first run)"
}

# ── Create launcher scripts ──────────────────────────────────

Write-Step "Creating launcher scripts..."

$startScript = @'
# SquatchChat Launcher - Windows
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host ""
Write-Host "  Starting SquatchChat..." -ForegroundColor Green
Write-Host ""

# Start realtime server in background
$realtimeJob = Start-Job -ScriptBlock {
    Set-Location $using:scriptDir
    pnpm dev:realtime
}

# Start Next.js in background
$nextJob = Start-Job -ScriptBlock {
    Set-Location $using:scriptDir
    pnpm dev
}

Write-Host "  SquatchChat is running!" -ForegroundColor Green
Write-Host "  -> App:      http://localhost:3000" -ForegroundColor Cyan
Write-Host "  -> Realtime: ws://localhost:3001" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Open browser
Start-Sleep -Seconds 3
Start-Process "http://localhost:3000"

try {
    while ($true) {
        # Show output from jobs
        Receive-Job $realtimeJob -ErrorAction SilentlyContinue
        Receive-Job $nextJob -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
} finally {
    Write-Host "`n  Shutting down..." -ForegroundColor Yellow
    Stop-Job $realtimeJob -ErrorAction SilentlyContinue
    Stop-Job $nextJob -ErrorAction SilentlyContinue
    Remove-Job $realtimeJob -ErrorAction SilentlyContinue
    Remove-Job $nextJob -ErrorAction SilentlyContinue

    # Kill any remaining node processes for our app
    Get-Process -Name "node" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match "squatch-chat" } |
        Stop-Process -Force -ErrorAction SilentlyContinue

    Write-Host "  SquatchChat stopped." -ForegroundColor Green
}
'@

Set-Content -Path "start.ps1" -Value $startScript

$stopScript = @'
# SquatchChat Stopper - Windows
Write-Host "Stopping SquatchChat processes..."
Get-Process -Name "node" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "squatch-chat|next dev|tsx watch" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Done."
'@

Set-Content -Path "stop.ps1" -Value $stopScript

# Also create .bat wrappers for double-click convenience
$installBat = @'
@echo off
echo Starting SquatchChat installer...
powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
'@

Set-Content -Path "INSTALL.bat" -Value $installBat

$startBat = @'
@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1"
'@

Set-Content -Path "START.bat" -Value $startBat

$stopBat = @'
@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
pause
'@

Set-Content -Path "STOP.bat" -Value $stopBat

# ── Done ──────────────────────────────────────────────────────

Write-Host ""
Write-Host "  =======================================================" -ForegroundColor Green
Write-Host "  SquatchChat installed successfully!" -ForegroundColor Green
Write-Host "  =======================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  To start SquatchChat:" -ForegroundColor White
Write-Host "    .\start.ps1   (PowerShell)" -ForegroundColor Cyan
Write-Host "    START.bat      (double-click)" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Then open:" -ForegroundColor White
Write-Host "    http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To stop:" -ForegroundColor White
Write-Host "    .\stop.ps1  or  Ctrl+C" -ForegroundColor Cyan
Write-Host ""
if (-not $pgAvailable) {
    Write-Host "  [!] Remember to set up PostgreSQL and run:" -ForegroundColor Yellow
    Write-Host "    pnpm db:migrate" -ForegroundColor Cyan
    Write-Host ""
}
Write-Host "  Welcome to the woods." -ForegroundColor White
Write-Host ""
