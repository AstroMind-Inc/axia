SHELL := /bin/bash

# Detect docker compose vs docker-compose
DC := $(shell if docker compose version >/dev/null 2>&1; then echo "docker compose"; else echo "docker-compose"; fi)

ENV_FILE := .env
PROFILE_FLAG := --profile $(shell grep -E '^MONGODB_MODE=' $(ENV_FILE) 2>/dev/null | cut -d= -f2 | tr -d '"' || echo local)

# Variables the parent shell might have leaking in (e.g. exported as empty by
# a previous `source .env`). Unsetting them forces docker-compose to read the
# values from `.env` instead. Add new env vars here as they appear.
LEAKY_VARS := \
	OPENAI_API_KEY OPENAI_DEFAULT_MODEL \
	MODEL_SERVER_URL PROJECTOR_URL PROJECTOR_PORT HF_REPO_ID \
	MONGODB_URI MONGODB_DB MONGODB_MODE \
	MONGODB_CORPUS_COLLECTION MONGODB_METADATA_COLLECTION \
	NEXT_PUBLIC_API_URL NEXT_PUBLIC_MONGODB_URI NEXT_PUBLIC_MONGODB_DB \
	NEXT_PUBLIC_MONGODB_MODE NEXT_PUBLIC_DEBUG NEXT_PUBLIC_ALLOWED_FILE_TYPES \
	SERVICE_HOST SERVICE_PORT SERVICE_LOG_LEVEL SERVICE_DEBUG \
	WEBAPP_PORT

ENV_PREFIX := env $(foreach v,$(LEAKY_VARS),-u $(v))

.DEFAULT_GOAL := help

.PHONY: help setup up down restart logs ps load-sample load-from-hf rebuild-from-csc \
        service-dev webapp-dev model-server projector shell-service shell-webapp shell-mongo \
        lint clean clean-data verify \
        prod-up prod-down prod-restart prod-logs

help: ## Show this help
	@echo "Axia — make targets"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf "  %-22s %s\n", "target", "description"} \
		/^[a-zA-Z0-9_-]+:.*##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""

# ----------------------------------------------------------------------------
# Setup
# ----------------------------------------------------------------------------

setup: ## Interactively configure .env (Mongo mode, OpenAI key, optional model URL)
	@bash scripts/setup.sh

$(ENV_FILE):
	@echo "No .env file found. Run 'make setup' or 'cp .env.example .env'."
	@exit 1

# ----------------------------------------------------------------------------
# Stack lifecycle (docker compose)
# ----------------------------------------------------------------------------

up: $(ENV_FILE) ## Start the stack (mongo + projector + service + webapp)
	@$(ENV_PREFIX) $(DC) $(PROFILE_FLAG) up -d --build
	@echo ""
	@echo "Stack starting. Endpoints:"
	@WEBAPP_PORT=$$(grep -E '^WEBAPP_PORT=' $(ENV_FILE) | cut -d= -f2 | tr -d '"'); \
		echo "  webapp    : http://localhost:$${WEBAPP_PORT:-3000}"
	@echo "  service   : http://localhost:8000/docs"
	@PROJECTOR_PORT=$$(grep -E '^PROJECTOR_PORT=' $(ENV_FILE) | cut -d= -f2 | tr -d '"'); \
		echo "  projector : http://localhost:$${PROJECTOR_PORT:-8001}/health"
	@grep -q '^MONGODB_MODE=local' $(ENV_FILE) && echo "  mongo     : mongodb://localhost:27017" || true
	@echo ""
	@echo "Tail logs with: make logs"

down: ## Stop the stack
	@$(ENV_PREFIX) $(DC) $(PROFILE_FLAG) down

restart: down up ## Restart the stack

logs: ## Tail logs from all services
	@$(ENV_PREFIX) $(DC) $(PROFILE_FLAG) logs -f --tail=100

ps: ## Show running containers
	@$(ENV_PREFIX) $(DC) $(PROFILE_FLAG) ps

# ----------------------------------------------------------------------------
# Data
# ----------------------------------------------------------------------------

load-sample: $(ENV_FILE) ## Reload the bundled sample dataset into Mongo
	@$(ENV_PREFIX) $(DC) $(PROFILE_FLAG) run --rm mongo-init bash /init/load_sample.sh

rebuild-from-csc: $(ENV_FILE) ## Rebuild the full corpus from raw CSC data (~6h; needs GPU model server). For reproducibility / re-training. Most users want load-from-hf instead.
	@if [ -z "$$(grep -E '^MODEL_SERVER_URL=' $(ENV_FILE) | cut -d= -f2)" ]; then \
		echo "MODEL_SERVER_URL is empty in $(ENV_FILE)."; \
		echo "Rebuilding from CSC requires the fine-tuned model server. Aborting."; \
		exit 1; \
	fi
	@$(ENV_PREFIX) $(DC) $(PROFILE_FLAG) run --rm \
		-v $$(pwd)/data:/work/data \
		service \
		python -m data.ingest.run_full_corpus

# Override `DATASET=...` to point at a different HF repo.
DATASET ?= astromindinc/axia-csc-corpus

load-from-hf: $(ENV_FILE) ## Download corpus from Hugging Face -> tmp dir -> Mongo
	@MODE=$$(grep -E '^MONGODB_MODE=' $(ENV_FILE) | cut -d= -f2 | tr -d '"'); \
	if [ "$$MODE" = "local" ]; then ATLAS_FLAG=""; else ATLAS_FLAG="--atlas"; fi; \
	HF_TOK=$$(grep -E '^HF_TOKEN=' $(ENV_FILE) | cut -d= -f2); \
	echo "Loading $(DATASET) into MongoDB ($$MODE) via service container ..."; \
	$(ENV_PREFIX) $(DC) $(PROFILE_FLAG) run --rm \
		-v $$(pwd)/data:/app/data \
		-e HF_TOKEN="$$HF_TOK" \
		service \
		python data/ingest/load_from_huggingface.py \
			--repo-id "$(DATASET)" \
			--drop $$ATLAS_FLAG

# ----------------------------------------------------------------------------
# Dev (host-side)
# ----------------------------------------------------------------------------

service-dev: $(ENV_FILE) ## Run service on host (poetry, hot reload)
	@cd service && poetry install --no-root && \
		set -a && source ../.env && set +a && \
		poetry run uvicorn main:app --reload --host 0.0.0.0 --port 8000

webapp-dev: $(ENV_FILE) ## Run webapp on host (npm, hot reload)
	@cd webapp && npm install && \
		set -a && source ../.env && set +a && \
		npm run dev

model-server: ## Print instructions for deploying model/server
	@cat model/server/README.md | head -80

projector: $(ENV_FILE) ## Run projector standalone (downloads weights from HF on first start)
	@$(ENV_PREFIX) $(DC) $(PROFILE_FLAG) up -d --build projector
	@PROJECTOR_PORT=$$(grep -E '^PROJECTOR_PORT=' $(ENV_FILE) | cut -d= -f2 | tr -d '"'); \
		echo "Projector starting at http://localhost:$${PROJECTOR_PORT:-8001}/health"
	@echo "First start downloads ~130 MB of weights from HF (cached afterwards)."

# ----------------------------------------------------------------------------
# Shells
# ----------------------------------------------------------------------------

shell-service: ## Open a shell inside the service container
	@$(ENV_PREFIX) $(DC) $(PROFILE_FLAG) exec service /bin/bash

shell-webapp: ## Open a shell inside the webapp container
	@$(ENV_PREFIX) $(DC) $(PROFILE_FLAG) exec webapp /bin/sh

shell-mongo: ## Open mongosh against the local Mongo container
	@DB=$$(grep -E '^MONGODB_DB=' $(ENV_FILE) | cut -d= -f2 | tr -d '"'); \
		$(ENV_PREFIX) $(DC) $(PROFILE_FLAG) exec mongo mongosh "$${DB:-axia}"

# ----------------------------------------------------------------------------
# Verify / clean
# ----------------------------------------------------------------------------

verify: ## Smoke test: hit /health on service and check sample loaded in Mongo
	@bash scripts/verify.sh

lint: ## Run linters
	@cd service && poetry run ruff check . || true
	@cd webapp && npm run lint || true

clean: ## Stop stack and remove containers (keeps volumes)
	@$(ENV_PREFIX) $(DC) $(PROFILE_FLAG) down

clean-data: ## DESTRUCTIVE: drop containers AND mongo volume
	@$(ENV_PREFIX) $(DC) $(PROFILE_FLAG) down -v

# ----------------------------------------------------------------------------
# Production (Caddy + autoheal + systemd)
# ----------------------------------------------------------------------------

DC_PROD := $(DC) -f docker-compose.yml -f docker-compose.prod.yml $(PROFILE_FLAG)

prod-up: $(ENV_FILE) ## Start production stack (Caddy HTTPS + autoheal + all services)
	@$(ENV_PREFIX) $(DC_PROD) up -d --build
	@DOMAIN=$$(grep -E '^DOMAIN=' $(ENV_FILE) | cut -d= -f2 | tr -d '"'); \
		echo ""; \
		echo "Production stack starting."; \
		echo "  URL: https://$${DOMAIN:-localhost}"; \
		echo ""; \
		echo "Autoheal is monitoring all containers."; \
		echo "Tail logs with: make prod-logs"

prod-down: ## Stop the production stack
	@$(ENV_PREFIX) $(DC_PROD) down

prod-restart: prod-down prod-up ## Restart the production stack

prod-logs: ## Tail production logs
	@$(ENV_PREFIX) $(DC_PROD) logs -f --tail=100
