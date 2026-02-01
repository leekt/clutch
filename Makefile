.PHONY: install dev build test lint format typecheck clean docker-up docker-down db-migrate db-seed

# Install dependencies
install:
	pnpm install

# Run development servers (web + clutchd)
dev:
	pnpm run dev

# Build all packages
build:
	pnpm run build

# Run tests
test:
	pnpm run test

# Lint code
lint:
	pnpm run lint

# Format code
format:
	pnpm run format

# Check formatting
format-check:
	pnpm run format:check

# Type check
typecheck:
	pnpm run typecheck

# Clean build artifacts
clean:
	rm -rf apps/*/dist agents/*/dist
	rm -rf node_modules apps/*/node_modules agents/*/node_modules

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
	pnpm run db:migrate

# Seed database
db-seed:
	pnpm run db:seed

# Development with Docker (postgres/redis in Docker, apps local)
dev-docker: docker-up
	@echo "Waiting for services to be ready..."
	@sleep 3
	pnpm run dev

# Full local development setup
setup: install docker-up
	@echo "Waiting for database..."
	@sleep 3
	$(MAKE) db-migrate
	$(MAKE) db-seed
	@echo "Setup complete! Run 'make dev' to start development servers."
