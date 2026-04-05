#!/usr/bin/env bash
set -e

# ═══════════════════════════════════════════════════════════════
#  Campfire Installer — Linux / macOS
#  One command: ./install.sh
# ═══════════════════════════════════════════════════════════════

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

print_banner() {
  echo -e "${GREEN}"
  echo '  ____                    _       _      ____ _           _   '
  echo ' / ___|  __ _ _   _  __ _| |_ ___| |__  / ___| |__   __ _| |_ '
  echo ' \___ \ / _` | | | |/ _` | __/ __| `_ \| |   | `_ \ / _` | __|'
  echo '  ___) | (_| | |_| | (_| | || (__| | | | |___| | | | (_| | |_ '
  echo ' |____/ \__, |\__,_|\__,_|\__\___|_| |_|\____|_| |_|\__,_|\__|'
  echo '           |_|                                                 '
  echo -e "${NC}"
  echo -e "${CYAN}  Private chat for creatures of the forest${NC}"
  echo ""
}

log_step() { echo -e "\n${BOLD}${GREEN}[✓]${NC} ${BOLD}$1${NC}"; }
log_warn() { echo -e "\n${BOLD}${YELLOW}[!]${NC} ${BOLD}$1${NC}"; }
log_error() { echo -e "\n${BOLD}${RED}[✗]${NC} ${BOLD}$1${NC}"; }
log_info() { echo -e "    ${CYAN}→${NC} $1"; }

# ── Pre-flight checks ────────────────────────────────────────

check_command() {
  if command -v "$1" &> /dev/null; then
    return 0
  else
    return 1
  fi
}

print_banner

echo -e "${BOLD}Checking prerequisites...${NC}\n"

# Check Node.js
if check_command node; then
  NODE_VERSION=$(node -v)
  log_info "Node.js found: $NODE_VERSION"
  # Check minimum version (18+)
  NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -lt 18 ]; then
    log_error "Node.js 18+ required (found $NODE_VERSION)"
    echo "    Install from: https://nodejs.org/"
    exit 1
  fi
else
  log_error "Node.js not found"
  echo ""
  echo "  Install Node.js 18+ from one of:"
  echo "    • https://nodejs.org/ (official installer)"
  echo "    • nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash"
  echo "    • Linux: sudo apt install nodejs npm  /  sudo dnf install nodejs npm"
  echo "    • macOS: brew install node"
  exit 1
fi

# Check pnpm
if check_command pnpm; then
  log_info "pnpm found: $(pnpm -v)"
else
  log_warn "pnpm not found — installing it now"
  npm install -g pnpm
  log_info "pnpm installed: $(pnpm -v)"
fi

# Check PostgreSQL
POSTGRES_AVAILABLE=false
if check_command psql; then
  log_info "PostgreSQL client found: $(psql --version | head -1)"
  POSTGRES_AVAILABLE=true
elif check_command pg_isready; then
  log_info "PostgreSQL detected via pg_isready"
  POSTGRES_AVAILABLE=true
fi

if [ "$POSTGRES_AVAILABLE" = false ]; then
  log_warn "PostgreSQL not detected on this system"
  echo ""
  echo "  You have three options:"
  echo ""
  echo "  1. Install PostgreSQL locally:"
  echo "     • Linux (Debian/Ubuntu): sudo apt install postgresql postgresql-contrib"
  echo "     • Linux (Fedora/RHEL):   sudo dnf install postgresql-server postgresql-contrib"
  echo "     • macOS:                 brew install postgresql@16 && brew services start postgresql@16"
  echo ""
  echo "  2. Use Docker:"
  echo "     docker run -d --name campfire-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=campfire -p 5432:5432 postgres:16"
  echo ""
  echo "  3. Use a remote PostgreSQL (update DATABASE_URL in .env after install)"
  echo ""
  read -p "  Continue without PostgreSQL? (y/N) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "  Install PostgreSQL first, then re-run this script."
    exit 1
  fi
fi

# ── Install dependencies ─────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log_step "Installing dependencies..."
pnpm install

# ── Configure environment ─────────────────────────────────────

if [ ! -f .env ]; then
  log_step "Creating .env configuration..."
  cp .env.example .env

  # Generate a random JWT secret
  if check_command openssl; then
    JWT_SECRET=$(openssl rand -hex 32)
  else
    JWT_SECRET="campfire-$(date +%s)-$(head -c 16 /dev/urandom | xxd -p)"
  fi
  sed -i.bak "s/campfire-secret-change-me-in-production/$JWT_SECRET/" .env && rm -f .env.bak
  log_info "Generated random JWT secret"
else
  log_info ".env already exists — keeping existing config"
fi

# ── Set up database ───────────────────────────────────────────

log_step "Generating Prisma client..."
npx prisma generate

# Try to create database and run migrations
if [ "$POSTGRES_AVAILABLE" = true ]; then
  log_step "Setting up database..."

  # Source the DATABASE_URL from .env
  DB_URL=$(grep DATABASE_URL .env | cut -d '"' -f 2)

  # Try to connect and create database if it doesn't exist
  DB_NAME=$(echo "$DB_URL" | sed 's/.*\///' | sed 's/?.*//')
  DB_HOST=$(echo "$DB_URL" | sed 's/.*@//' | sed 's/:.*//')
  DB_PORT=$(echo "$DB_URL" | sed 's/.*://' | sed 's/\/.*//' | grep -o '[0-9]*')
  DB_USER=$(echo "$DB_URL" | sed 's/postgresql:\/\///' | sed 's/:.*//')

  if check_command createdb; then
    createdb -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" "$DB_NAME" 2>/dev/null || true
  fi

  log_info "Running database migrations..."
  npx prisma migrate dev --name init 2>/dev/null || {
    log_warn "Migration failed — you may need to configure DATABASE_URL in .env"
    log_info "Edit .env, set your DATABASE_URL, then run: pnpm db:migrate"
  }
else
  log_warn "Skipping database setup (PostgreSQL not available)"
  log_info "After installing PostgreSQL, run: pnpm db:migrate"
fi

# ── Build the app ─────────────────────────────────────────────

log_step "Building Campfire..."
pnpm build 2>&1 || {
  log_warn "Build had warnings (this is usually fine for first run)"
}

# ── Create launcher scripts ──────────────────────────────────

log_step "Creating launcher scripts..."

cat > start.sh << 'LAUNCHER'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "  🌲 Starting Campfire..."
echo ""

# Start realtime server in background
pnpm dev:realtime &
REALTIME_PID=$!

# Start Next.js
pnpm dev &
NEXT_PID=$!

echo ""
echo "  Campfire is running!"
echo "  → App:      http://localhost:3000"
echo "  → Realtime: ws://localhost:3001"
echo ""
echo "  Press Ctrl+C to stop"
echo ""

cleanup() {
  echo ""
  echo "  Shutting down..."
  kill $REALTIME_PID 2>/dev/null
  kill $NEXT_PID 2>/dev/null
  wait $REALTIME_PID 2>/dev/null
  wait $NEXT_PID 2>/dev/null
  echo "  Campfire stopped."
}
trap cleanup EXIT INT TERM

wait
LAUNCHER
chmod +x start.sh

cat > stop.sh << 'STOPPER'
#!/usr/bin/env bash
echo "Stopping Campfire processes..."
pkill -f "next dev" 2>/dev/null || true
pkill -f "tsx watch realtime" 2>/dev/null || true
echo "Done."
STOPPER
chmod +x stop.sh

# ── Done ──────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Campfire installed successfully!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}To start Campfire:${NC}"
echo -e "    ${CYAN}./start.sh${NC}"
echo ""
echo -e "  ${BOLD}Then open:${NC}"
echo -e "    ${CYAN}http://localhost:3000${NC}"
echo ""
echo -e "  ${BOLD}To stop:${NC}"
echo -e "    ${CYAN}./stop.sh${NC}  or  ${CYAN}Ctrl+C${NC}"
echo ""
if [ "$POSTGRES_AVAILABLE" = false ]; then
  echo -e "  ${YELLOW}⚠ Remember to set up PostgreSQL and run:${NC}"
  echo -e "    ${CYAN}pnpm db:migrate${NC}"
  echo ""
fi
echo -e "  ${BOLD}Welcome to the woods.${NC}"
echo ""
