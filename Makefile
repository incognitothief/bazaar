.DEFAULT_GOAL := help

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

DOCKER_IMAGE ?= bazaar:local
PULUMI_STACK ?= prod
INFRA_DIR := packages/infra

# When nix + flake.nix are present, npm installs run inside the pinned dev shell.
NIX_AVAILABLE := $(shell command -v nix >/dev/null 2>&1 && test -f flake.nix && echo yes)
ifeq ($(NIX_AVAILABLE),yes)
  NIX_RUN := nix develop -c
else
  NIX_RUN :=
endif

# Optional Docker build-args (same names as Dockerfile / deploy workflow).
# Export from your shell or a local .env before `make docker-build`.
VITE_ATPROTO_SERVICE ?=
VITE_APP_DID ?=
VITE_APP_URL ?=
VITE_LEXICON_NAMESPACE ?=
VITE_ARTIST_DID ?=
VITE_API_ORIGIN ?=
# Optional cloudflared quick-tunnel origin. When set, `make dev` exports it into
# the client/server URL vars so you don't rewrite packages/*/.env on each new hostname.
#   make tunnel
#   make dev CLOUDFLARED_URL=https://xxxx.trycloudflare.com
CLOUDFLARED_URL ?=

.PHONY: help
help: ## Show available targets
	@grep -E '^[a-zA-Z0-9_.-]+:.*## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

.PHONY: shell
shell: ## Enter Nix dev shell (node 22, bun, pulumi, flyctl, docker, …)
	@command -v nix >/dev/null 2>&1 || { echo "nix is not installed; see https://nixos.org/download.html"; exit 1; }
	nix develop

.PHONY: nix-lock
nix-lock: ## Refresh flake.lock (run once after cloning, or when bumping inputs)
	@command -v nix >/dev/null 2>&1 || { echo "nix is not installed; see https://nixos.org/download.html"; exit 1; }
	nix flake lock

.PHONY: install
install: ## Install dependencies (npm install; uses nix develop when available)
	$(NIX_RUN) npm install

.PHONY: install-ci
install-ci: ## Install dependencies for CI (npm ci; uses nix develop when available)
	$(NIX_RUN) npm ci

.PHONY: setup-env
setup-env: ## Copy .env.example files when packages/*/.env are missing
	@test -f packages/server/.env || cp packages/server/.env.example packages/server/.env
	@test -f packages/client/.env || cp packages/client/.env.example packages/client/.env
	@echo "Wrote packages/server/.env and/or packages/client/.env from examples (skipped existing files)."

.PHONY: dev
dev: ## Run client + server (optional: CLOUDFLARED_URL=https://….trycloudflare.com)
	@url="$(CLOUDFLARED_URL)"; \
	url="$${url%/}"; \
	if [ -n "$$url" ]; then \
	  echo "Injecting tunnel origin $$url (overrides URL vars in packages/*/.env)"; \
	  export VITE_API_ORIGIN="$$url" \
	    VITE_APP_URL="$$url" \
	    APP_URL="$$url" \
	    PUBLIC_WEB_APP_URL="$$url" \
	    ATPROTO_OAUTH_REDIRECT_URI="$$url/api/atproto/callback"; \
	fi; \
	npm run dev -- --env-mode=loose

.PHONY: build
build: ## Build all workspaces (Turbo)
	npm run build

.PHONY: start
start: build ## Build then run the production server locally (Bun)
	npm run start -w @bazaar/server

.PHONY: client-preview
client-preview: build ## Serve built client with Vite preview
	npm run preview -w @bazaar/client

.PHONY: test
test: ## Run server unit tests (Bun)
	npm run test -w @bazaar/server

.PHONY: lexicons-validate
lexicons-validate: ## Validate Bazaar lexicons
	npm run lexicons:validate

.PHONY: db-generate
db-generate: ## Generate Drizzle migrations
	npm run db:generate

.PHONY: db-migrate
db-migrate: ## Apply Drizzle migrations
	npm run db:migrate

.PHONY: ci
ci: install-ci lexicons-validate build test ## Run the same checks as .github/workflows/test.yml

.PHONY: gen-did
gen-did: ## Generate service keys and DID snippets (scripts/gen-did.sh)
	chmod 700 scripts/gen-did.sh
	./scripts/gen-did.sh

.PHONY: tunnel
tunnel: ## Expose Vite :5173 via cloudflared; then make dev CLOUDFLARED_URL=<printed url>
	./tunnel.sh

.PHONY: docker-build
docker-build: ## Build the production Docker image locally
	docker build \
		--build-arg VITE_ATPROTO_SERVICE="$(VITE_ATPROTO_SERVICE)" \
		--build-arg VITE_APP_DID="$(VITE_APP_DID)" \
		--build-arg VITE_APP_URL="$(VITE_APP_URL)" \
		--build-arg VITE_LEXICON_NAMESPACE="$(VITE_LEXICON_NAMESPACE)" \
		--build-arg VITE_ARTIST_DID="$(VITE_ARTIST_DID)" \
		--build-arg VITE_API_ORIGIN="$(VITE_API_ORIGIN)" \
		-t "$(DOCKER_IMAGE)" \
		.

.PHONY: docker-run
docker-run: ## Run the local Docker image on port 3000 (volume: bazaar-data)
	docker run --rm -p 3000:3000 -v bazaar-data:/data "$(DOCKER_IMAGE)"

.PHONY: infra-preview
infra-preview: ## Pulumi preview (packages/infra; set PULUMI_STACK=prod|stg)
	cd "$(INFRA_DIR)" && npm run preview -- --stack "$(PULUMI_STACK)"

.PHONY: infra-up
infra-up: ## Pulumi up (packages/infra; set PULUMI_STACK=prod|stg)
	cd "$(INFRA_DIR)" && npm run up -- --stack "$(PULUMI_STACK)"

.PHONY: fly-deploy
fly-deploy: ## Deploy to Fly production (fly.toml; requires FLY_API_TOKEN and VITE_* env)
	@test -n "$${FLY_API_TOKEN:-}" || { echo "FLY_API_TOKEN is not set"; exit 1; }
	flyctl deploy --remote-only \
		--build-arg VITE_ATPROTO_SERVICE="$${VITE_ATPROTO_SERVICE:-}" \
		--build-arg VITE_APP_DID="$${VITE_APP_DID:-}" \
		--build-arg VITE_APP_URL="$${VITE_APP_URL:-}" \
		--build-arg VITE_LEXICON_NAMESPACE="$${VITE_LEXICON_NAMESPACE:-}" \
		--build-arg VITE_ARTIST_DID="$${VITE_ARTIST_DID:-}" \
		--build-arg VITE_API_ORIGIN="$${VITE_API_ORIGIN:-}"

.PHONY: fly-deploy-stg
fly-deploy-stg: ## Deploy to Fly staging (fly.stg.toml; requires FLY_API_TOKEN and VITE_* env)
	@test -n "$${FLY_API_TOKEN:-}" || { echo "FLY_API_TOKEN is not set"; exit 1; }
	flyctl deploy --remote-only --config fly.stg.toml \
		--build-arg VITE_ATPROTO_SERVICE="$${VITE_ATPROTO_SERVICE:-}" \
		--build-arg VITE_APP_DID="$${VITE_APP_DID:-}" \
		--build-arg VITE_APP_URL="$${VITE_APP_URL:-}" \
		--build-arg VITE_LEXICON_NAMESPACE="$${VITE_LEXICON_NAMESPACE:-}" \
		--build-arg VITE_ARTIST_DID="$${VITE_ARTIST_DID:-}" \
		--build-arg VITE_API_ORIGIN="$${VITE_API_ORIGIN:-}"
