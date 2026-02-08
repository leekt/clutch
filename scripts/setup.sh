#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# Clutch — single-command local development setup
#
# Usage:  ./scripts/setup.sh        (or: make setup)
#
# What it does:
#   1. Copies .env.example → .env (if missing)
#   2. Installs bun dependencies
#   3. Starts PostgreSQL + Redis via Docker
#   4. Waits until both are healthy
#   5. Pushes the Drizzle schema to the database
#   6. Seeds the database with dev data
#   7. Prints next steps
# ──────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[setup]${NC} $*"; }
warn()  { echo -e "${YELLOW}[setup]${NC} $*"; }
fail()  { echo -e "${RED}[setup]${NC} $*"; exit 1; }

# ── 0. Pre-flight checks ──────────────────────
command -v bun  >/dev/null 2>&1 || fail "bun is not installed. Install it: https://bun.sh"
command -v docker >/dev/null 2>&1 || fail "docker is not installed. Install Docker Desktop or similar."

# Docker compose command (supports both old and new syntax)
if command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  DC="docker compose"
fi

# ── 0.5. Ensure Docker daemon is running ──────
if ! docker info >/dev/null 2>&1; then
  warn "Docker daemon is not running."

  # macOS: try to launch Docker Desktop
  if [ "$(uname)" = "Darwin" ]; then
    if [ -d "/Applications/Docker.app" ]; then
      info "Starting Docker Desktop..."
      open -a Docker
    elif [ -d "$HOME/Applications/Docker.app" ]; then
      info "Starting Docker Desktop..."
      open -a "$HOME/Applications/Docker.app"
    else
      fail "Docker Desktop not found in /Applications. Please start Docker manually."
    fi
  # Linux: try systemd
  elif command -v systemctl >/dev/null 2>&1; then
    info "Starting Docker via systemctl..."
    sudo systemctl start docker
  else
    fail "Cannot auto-start Docker. Please start the Docker daemon manually and re-run."
  fi

  # Wait for Docker daemon to be ready
  info "Waiting for Docker daemon..."
  WAITED=0
  MAX_DOCKER_WAIT=60
  until docker info >/dev/null 2>&1; do
    WAITED=$((WAITED + 1))
    if [ $WAITED -ge $MAX_DOCKER_WAIT ]; then
      fail "Docker daemon did not start within ${MAX_DOCKER_WAIT}s. Please start it manually."
    fi
    sleep 1
  done
  info "Docker daemon is ready (${WAITED}s)."
fi

# ── 1. Environment file ───────────────────────
if [ ! -f .env ]; then
  info "Creating .env from .env.example..."
  cp .env.example .env
  warn "Edit .env to add your API keys (OPENAI_API_KEY / ANTHROPIC_API_KEY)"
else
  info ".env already exists, skipping."
fi

# ── 2. Install dependencies ───────────────────
info "Installing dependencies..."
bun install

# ── 3. Start Docker services ──────────────────
info "Starting PostgreSQL and Redis..."
$DC up -d postgres redis

# ── 4. Wait for services ──────────────────────
info "Waiting for PostgreSQL to be ready..."
MAX_WAIT=30
WAITED=0
until docker exec clutch-postgres pg_isready -U clutch -q 2>/dev/null; do
  WAITED=$((WAITED + 1))
  if [ $WAITED -ge $MAX_WAIT ]; then
    fail "PostgreSQL did not become ready within ${MAX_WAIT}s"
  fi
  sleep 1
done
info "PostgreSQL is ready (${WAITED}s)."

info "Waiting for Redis to be ready..."
WAITED=0
until docker exec clutch-redis redis-cli ping 2>/dev/null | grep -q PONG; do
  WAITED=$((WAITED + 1))
  if [ $WAITED -ge $MAX_WAIT ]; then
    fail "Redis did not become ready within ${MAX_WAIT}s"
  fi
  sleep 1
done
info "Redis is ready (${WAITED}s)."

# ── 5. Push schema to database ─────────────────
info "Pushing database schema (drizzle-kit push)..."
cd apps/clutchd
bunx drizzle-kit push --force 2>&1 | tail -5
cd "$ROOT"

# ── 6. Seed database ──────────────────────────
info "Seeding database..."
bun run db:seed

# ── 7. Done ────────────────────────────────────
echo ""
info "========================================="
info "  Setup complete!"
info "========================================="
echo ""
info "Next steps:"
info "  make dev          — start clutchd + web in dev mode"
info "  open http://localhost:3000  — web UI"
info "  open http://localhost:3000/colony  — colony view"
echo ""
warn "Make sure to set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env for agent LLM calls."
