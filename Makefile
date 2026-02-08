.PHONY: install dev build test lint format typecheck clean docker-up docker-down db-migrate db-seed db-push setup demo demo-auto

# ── Single-command setup (installs deps, starts infra, seeds DB) ──
setup:
	./scripts/setup.sh

# Install dependencies
install:
	bun install

# Run development servers (web + clutchd)
dev:
	bun run dev

# Build all packages
build:
	bun run build

# Run tests
test:
	bun run test

# Lint code
lint:
	bun run lint

# Format code
format:
	bun run format

# Check formatting
format-check:
	bun run format:check

# Type check
typecheck:
	bun run typecheck

# Clean build artifacts
clean:
	rm -rf apps/*/dist
	rm -rf node_modules apps/*/node_modules packages/*/node_modules

# Docker command (supports both old and new syntax)
DOCKER_COMPOSE := $(shell command -v docker-compose 2>/dev/null || echo "docker compose")

# Start Docker services (postgres, redis)
docker-up:
	$(DOCKER_COMPOSE) up -d postgres redis

# Start all Docker services including apps
docker-up-all:
	$(DOCKER_COMPOSE) up -d

# Stop Docker services
docker-down:
	$(DOCKER_COMPOSE) down

# Stop and remove volumes (WARNING: deletes all data)
docker-clean:
	$(DOCKER_COMPOSE) down -v

# Run database migrations (legacy — prefer db-push for dev)
db-migrate:
	bun run db:migrate

# Push schema directly to database (dev workflow)
db-push:
	cd apps/clutchd && bunx drizzle-kit push --force

# Seed database
db-seed:
	bun run db:seed

# Reset database (drop all data, re-push schema, re-seed)
db-reset: docker-up
	@echo "Waiting for PostgreSQL..."
	@until docker exec clutch-postgres pg_isready -U clutch -q 2>/dev/null; do sleep 1; done
	cd apps/clutchd && bunx drizzle-kit push --force
	bun run db:seed
	@echo "Database reset complete."

# Run E2E demo (requires clutchd to be running)
demo:
	bun run scripts/demo-e2e.ts

# Run E2E demo with auto-approval
demo-auto:
	bun run scripts/demo-e2e.ts --auto-approve
