.PHONY: install dev build test lint format typecheck clean docker-up docker-down db-migrate db-seed demo demo-auto

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

# Stop and remove volumes
docker-clean:
	$(DOCKER_COMPOSE) down -v

# Run database migrations
db-migrate:
	bun run db:migrate

# Seed database
db-seed:
	bun run db:seed

# Development with Docker (postgres/redis in Docker, apps local)
dev-docker: docker-up
	@echo "Waiting for services to be ready..."
	@sleep 3
	bun run dev

# Full local development setup
setup: install docker-up
	@echo "Waiting for database..."
	@sleep 3
	$(MAKE) db-migrate
	$(MAKE) db-seed
	@echo "Setup complete! Run 'make dev' to start development servers."

# Run E2E demo (requires clutchd to be running)
demo:
	bun run scripts/demo-e2e.ts

# Run E2E demo with auto-approval
demo-auto:
	bun run scripts/demo-e2e.ts --auto-approve
