# Makefile — orchestration layer for node-ts-starter (multilingual: Node + Spring).
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

NODE_API_DIR    := services/node-api
SPRING_API_DIR  := services/spring-api

# JAVA_HOME for Maven (Spring targets). If the shell has it set, we keep it.
# Otherwise on macOS, resolve Java 21 automatically via /usr/libexec/java_home.
# Linux users that need a custom path can set JAVA_HOME in their shell.
ifeq ($(JAVA_HOME),)
    ifneq ($(wildcard /usr/libexec/java_home),)
        export JAVA_HOME := $(shell /usr/libexec/java_home -v 21 2>/dev/null)
    endif
endif

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
install: install-node-api install-web ## Install all node-side dependencies (node-api + web).

.PHONY: install-node-api
install-node-api: ## Install node-api dependencies.
	cd $(NODE_API_DIR) && npm install

.PHONY: install-web
install-web: ## Install frontend dependencies.
	cd web && npm install

## --- Local dev (no docker) ---

.PHONY: dev-node-api
dev-node-api: ## Run node-api dev server with --watch (port 3000).
	cd $(NODE_API_DIR) && npm run dev

.PHONY: dev-spring-api
dev-spring-api: ## Run spring-api dev server (port 8080).
	cd $(SPRING_API_DIR) && mvn spring-boot:run

.PHONY: dev-web
dev-web: ## Run Vite dev server (port 5173).
	cd web && npm run dev

.PHONY: dev
dev: ## Run node-api + web concurrently (use two terminals for clean output).
	$(MAKE) -j 2 dev-node-api dev-web

## --- Quality: Node-API ---

.PHONY: node-typecheck
node-typecheck: ## Type-check node-api + web.
	# Subshells so the second `cd` is relative to the original CWD even
	# under `.ONESHELL` (which keeps all recipe lines in one shell).
	( cd $(NODE_API_DIR) && npm run typecheck )
	( cd web && npm run typecheck )

.PHONY: node-lint
node-lint: ## Lint with Biome across the repo (no writes).
	npx --prefix $(NODE_API_DIR) biome check .

.PHONY: node-lint-fix
node-lint-fix: ## Lint and apply safe fixes.
	npx --prefix $(NODE_API_DIR) biome check --write .

.PHONY: node-format
node-format: ## Format with Biome.
	npx --prefix $(NODE_API_DIR) biome format --write .

.PHONY: node-test
node-test: ## Run node-api test suite.
	cd $(NODE_API_DIR) && npm test

.PHONY: node-test-watch
node-test-watch: ## Run node-api tests in watch mode.
	cd $(NODE_API_DIR) && npm run test:watch

.PHONY: node-test-coverage
node-test-coverage: ## Run node-api tests with coverage report.
	cd $(NODE_API_DIR) && npm run test:coverage

.PHONY: node-test-postgres
node-test-postgres: ## Run node-api tests with TEST_DATABASE_URL pointing at local pg (must be running).
	cd $(NODE_API_DIR) && TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:$${DB_PORT:-55432}/app npm test

.PHONY: node-migrate
node-migrate: ## Apply pending Postgres migrations from node-api (uses DATABASE_URL from .env).
	cd $(NODE_API_DIR) && npm run migrate

.PHONY: node-check
node-check: node-lint node-typecheck node-test ## Run all node-api quality gates.

## --- Quality: Spring-API ---

.PHONY: spring-test
spring-test: ## Run spring-api tests.
	cd $(SPRING_API_DIR) && mvn test

.PHONY: spring-package
spring-package: ## Build spring-api jar (skip tests).
	cd $(SPRING_API_DIR) && mvn -DskipTests package

.PHONY: spring-check
spring-check: ## Run spring-api full verify (compile + tests + checks).
	cd $(SPRING_API_DIR) && mvn verify

## --- Combined ---

.PHONY: check
check: node-check spring-check ## Run all quality gates across both services.

.PHONY: ci ci-web-build
ci: check ci-web-build build ## Reproduce CI locally: check + web build + docker build.

ci-web-build:
	cd web && npm run build

## --- Docker ---

.PHONY: build
build: ## Build all images (production).
	$(COMPOSE) build

.PHONY: build-node-api
build-node-api: ## Build only the node-api image.
	$(COMPOSE) build node-api

.PHONY: build-spring-api
build-spring-api: ## Build only the spring-api image.
	$(COMPOSE) build spring-api

.PHONY: build-web
build-web: ## Build only the web image.
	$(COMPOSE) build web

API_PORT        ?= 3000
SPRING_API_PORT ?= 8080
WEB_PORT        ?= 8081
export API_PORT SPRING_API_PORT WEB_PORT

.PHONY: up
up: ## Start the production stack in background (override ports via API_PORT, SPRING_API_PORT, WEB_PORT).
	$(COMPOSE) up -d --remove-orphans
	@echo
	@echo "  node-api:   http://localhost:$(API_PORT)/health"
	@echo "  spring-api: http://localhost:$(SPRING_API_PORT)/actuator/health"
	@echo "  web:        http://localhost:$(WEB_PORT)/"
	@echo

.PHONY: up-fg
up-fg: ## Start the production stack in the foreground.
	$(COMPOSE) up --remove-orphans

.PHONY: up-dev
up-dev: ## Start the stack with dev overrides (Vite on :5173, node-api with --watch).
	$(COMPOSE_DEV) up --remove-orphans

.PHONY: obs-up
obs-up: ## Start dev stack + observability (Prometheus :9090, Tempo :3200, Grafana :3001).
	$(COMPOSE_OBS) up -d --remove-orphans
	@echo
	@echo "  node-api:   http://localhost:3000/health"
	@echo "  spring-api: http://localhost:8080/actuator/health"
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

.PHONY: logs-node-api
logs-node-api: ## Tail node-api logs.
	$(COMPOSE) logs -f --tail=100 node-api

.PHONY: logs-spring-api
logs-spring-api: ## Tail spring-api logs.
	$(COMPOSE) logs -f --tail=100 spring-api

.PHONY: logs-web
logs-web: ## Tail web logs.
	$(COMPOSE) logs -f --tail=100 web

.PHONY: shell-node-api
shell-node-api: ## Open a shell inside the node-api container.
	$(COMPOSE) exec node-api sh

.PHONY: shell-spring-api
shell-spring-api: ## Open a shell inside the spring-api container.
	$(COMPOSE) exec spring-api sh

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
smoke: ## Smoke-test the running stack (both apis + web index).
	@echo "→ node-api health (port $(API_PORT)):"
	@curl -fsS "http://localhost:$(API_PORT)/health" && echo
	@echo "→ spring-api health (port $(SPRING_API_PORT)):"
	@curl -fsS "http://localhost:$(SPRING_API_PORT)/actuator/health" && echo
	@echo "→ web index (port $(WEB_PORT)):"
	@curl -fsSI "http://localhost:$(WEB_PORT)/" | head -1

## --- Cleanup ---

.PHONY: clean
clean: ## Stop stack and remove containers + named volumes + local images.
	$(COMPOSE) down -v --rmi local

.PHONY: clean-deps
clean-deps: ## Remove all node_modules.
	rm -rf $(NODE_API_DIR)/node_modules web/node_modules node_modules

.PHONY: clean-spring
clean-spring: ## Remove Spring Maven target/ output.
	cd $(SPRING_API_DIR) && mvn clean

.PHONY: clean-all
clean-all: clean clean-deps clean-spring ## Full reset: containers, volumes, images, node_modules, Maven target.
	rm -rf web/dist $(NODE_API_DIR)/coverage
