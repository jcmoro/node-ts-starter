# Makefile — orchestration layer for node-ts-starter.
#
# Run `make` or `make help` for the full list of targets.

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.ONESHELL:
.DELETE_ON_ERROR:
MAKEFLAGS += --warn-undefined-variables
MAKEFLAGS += --no-builtin-rules

# ---------- Config ----------

COMPOSE         := docker compose
COMPOSE_DEV     := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_OBS     := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.obs.yml
DOCKER_BUILDKIT ?= 1
export DOCKER_BUILDKIT

# ---------- Help (default) ----------

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help.
	@awk 'BEGIN {FS = ":.*?## "; printf "\nUsage: make <target>\n\nTargets:\n"} \
	     /^[a-zA-Z_-]+:.*?## / { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 } \
	     /^## ?---/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 4) }' \
	     $(MAKEFILE_LIST)
	@echo

## --- Setup ---

.PHONY: install
install: install-api install-web ## Install all dependencies (api + web).

.PHONY: install-api
install-api: ## Install backend dependencies.
	npm install

.PHONY: install-web
install-web: ## Install frontend dependencies.
	cd web && npm install

## --- Local dev (no docker) ---

.PHONY: dev-api
dev-api: ## Run backend dev server with --watch (port 3000).
	npm run dev

.PHONY: dev-web
dev-web: ## Run Vite dev server (port 5173).
	cd web && npm run dev

.PHONY: dev
dev: ## Run api + web concurrently (use two terminals for clean output).
	$(MAKE) -j 2 dev-api dev-web

## --- Quality ---

.PHONY: typecheck
typecheck: ## Type-check api + web.
	npm run typecheck
	cd web && npm run typecheck

.PHONY: lint
lint: ## Lint with Biome (no writes).
	npx biome check .

.PHONY: lint-fix
lint-fix: ## Lint and apply safe fixes.
	npx biome check --write .

.PHONY: format
format: ## Format with Biome.
	npx biome format --write .

.PHONY: test
test: ## Run backend test suite.
	npm test

.PHONY: test-watch
test-watch: ## Run tests in watch mode.
	npm run test:watch

.PHONY: test-coverage
test-coverage: ## Run tests with coverage report.
	npm run test:coverage

.PHONY: test-postgres
test-postgres: ## Run tests with TEST_DATABASE_URL pointing at local pg (must be running).
	TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:$${DB_PORT:-55432}/app npm test

.PHONY: migrate
migrate: ## Apply pending Postgres migrations (uses DATABASE_URL from .env).
	npm run migrate

.PHONY: check
check: lint typecheck test ## Run all quality gates (lint + typecheck + tests).

.PHONY: ci ci-web-build
ci: check ci-web-build build ## Reproduce CI locally (assumes deps installed): check + web build + docker build.

ci-web-build:
	cd web && npm run build

## --- Docker ---

.PHONY: build
build: ## Build all images (production).
	$(COMPOSE) build

.PHONY: build-api
build-api: ## Build only the api image.
	$(COMPOSE) build api

.PHONY: build-web
build-web: ## Build only the web image.
	$(COMPOSE) build web

API_PORT ?= 3000
WEB_PORT ?= 8080
export API_PORT WEB_PORT

.PHONY: up
up: ## Start the production stack in background (override ports via API_PORT, WEB_PORT).
	$(COMPOSE) up -d --remove-orphans
	@echo
	@echo "  api: http://localhost:$(API_PORT)/health"
	@echo "  web: http://localhost:$(WEB_PORT)/"
	@echo

.PHONY: up-fg
up-fg: ## Start the production stack in the foreground.
	$(COMPOSE) up --remove-orphans

.PHONY: up-dev
up-dev: ## Start the stack with dev overrides (Vite on :5173, api with --watch).
	$(COMPOSE_DEV) up --remove-orphans

.PHONY: obs-up
obs-up: ## Start dev stack + observability (Prometheus :9090, Tempo :3200, Grafana :3001).
	$(COMPOSE_OBS) up -d --remove-orphans
	@echo
	@echo "  api:        http://localhost:3000/health"
	@echo "  web:        http://localhost:5173/"
	@echo "  Grafana:    http://localhost:3001/"
	@echo "  Prometheus: http://localhost:9090/"
	@echo "  Tempo API:  http://localhost:3200/ready"
	@echo

.PHONY: obs-down
obs-down: ## Stop the observability stack (preserves volumes).
	$(COMPOSE_OBS) down

.PHONY: obs-clean
obs-clean: ## Stop and wipe observability volumes (loses all metric/trace history).
	$(COMPOSE_OBS) down -v

.PHONY: obs-logs
obs-logs: ## Tail logs from the observability services.
	$(COMPOSE_OBS) logs -f --tail=100 prometheus tempo grafana

.PHONY: down
down: ## Stop the stack (preserves volumes).
	$(COMPOSE) down

.PHONY: restart
restart: down up ## Restart the stack.

.PHONY: ps
ps: ## Show running services.
	$(COMPOSE) ps

.PHONY: logs
logs: ## Tail logs from all services.
	$(COMPOSE) logs -f --tail=100

.PHONY: logs-api
logs-api: ## Tail api logs.
	$(COMPOSE) logs -f --tail=100 api

.PHONY: logs-web
logs-web: ## Tail web logs.
	$(COMPOSE) logs -f --tail=100 web

.PHONY: shell-api
shell-api: ## Open a shell inside the api container.
	$(COMPOSE) exec api sh

.PHONY: shell-web
shell-web: ## Open a shell inside the web container.
	$(COMPOSE) exec web sh

.PHONY: db-up
db-up: ## Start ONLY the local Postgres dev container (for running tests/migrations).
	$(COMPOSE_DEV) up -d db
	@echo "  postgres: postgresql://postgres:postgres@localhost:$${DB_PORT:-55432}/app"

.PHONY: db-down
db-down: ## Stop the local Postgres dev container.
	$(COMPOSE_DEV) stop db
	$(COMPOSE_DEV) rm -f db

.PHONY: db-shell
db-shell: ## Open a psql shell into the local Postgres dev container.
	$(COMPOSE_DEV) exec db psql -U postgres -d app

.PHONY: smoke
smoke: ## Smoke-test the running stack (api health + web index).
	@echo "→ api health (port $(API_PORT)):"
	@curl -fsS "http://localhost:$(API_PORT)/health" && echo
	@echo "→ web index (port $(WEB_PORT)):"
	@curl -fsSI "http://localhost:$(WEB_PORT)/" | head -1

## --- Cleanup ---

.PHONY: clean
clean: ## Stop stack and remove containers + named volumes + local images.
	$(COMPOSE) down -v --rmi local

.PHONY: clean-deps
clean-deps: ## Remove all node_modules.
	rm -rf node_modules web/node_modules

.PHONY: clean-all
clean-all: clean clean-deps ## Full reset: containers, volumes, images, node_modules.
	rm -rf web/dist coverage
