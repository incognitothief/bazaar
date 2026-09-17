.DEFAULT_GOAL := help

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

DOCKER_IMAGE ?= bazaar:local

# When nix + flake.nix are present, npm installs run inside the pinned dev shell.
NIX_AVAILABLE := $(shell command -v nix >/dev/null 2>&1 && test -f flake.nix && echo yes)
ifeq ($(NIX_AVAILABLE),yes)
  NIX_RUN := nix develop -c
else
  NIX_RUN :=
endif

# Optional Docker build-args (same names as Dockerfile / deploy workflow).
# Export from your shell or a local .env before `make docker-build`.
VITE_APP_URL ?=
VITE_MERCHANT_DID ?=
VITE_API_ORIGIN ?=
# Optional cloudflared quick-tunnel origin. When set, `make dev` exports it into
# the client/server URL vars so you don't rewrite packages/*/.env on each new hostname.
#   make tunnel
#   make dev CLOUDFLARED_URL=https://xxxx.trycloudflare.com
CLOUDFLARED_URL ?=

# `make dev TUNNEL_URL=https://<sub>.trycloudflare.com` points the OAuth / SPA origins at a
# public HTTPS tunnel for real-OAuth testing (see the "testing auth locally" runbook), instead
# of hand-editing packages/{server,client}/.env. It overrides APP_URL, VITE_APP_URL and
# VITE_API_ORIGIN for that run only. Leave unset for plain loopback dev.
TUNNEL_URL ?=
override TUNNEL_URL := $(patsubst %/,%,$(TUNNEL_URL))

.PHONY: help
help: ## Show available targets
	@grep -E '^[a-zA-Z0-9_.-]+:.*## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

.PHONY: shell
shell: ## Enter Nix dev shell (node 22, bun, flyctl, docker, …)
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
dev: ## Run client (:5173) + server (:3000) via Turbo. TUNNEL_URL=https://… routes OAuth origins through a tunnel.
ifeq ($(strip $(TUNNEL_URL)),)
	npm run dev
else
	@case "$(TUNNEL_URL)" in http://*|https://*) ;; *) \
		echo "TUNNEL_URL must start with http:// or https:// (got: $(TUNNEL_URL))"; exit 1;; esac
	@echo "dev: routing all OAuth / SPA origins through $(TUNNEL_URL)"
	APP_URL="$(TUNNEL_URL)" \
		ATPROTO_OAUTH_REDIRECT_URI="$(TUNNEL_URL)/api/atproto/callback" \
		PUBLIC_WEB_APP_URL="$(TUNNEL_URL)" \
		VITE_APP_URL="$(TUNNEL_URL)" \
		VITE_API_ORIGIN="$(TUNNEL_URL)" \
		npm run dev
endif

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

.PHONY: storefront-key
storefront-key: ## Print the storefront secrets to set; first run needs DOMAIN=store.example.com
	npx tsx scripts/gen-storefront-key.ts $(DOMAIN)

.PHONY: storefront-key-rotate
storefront-key-rotate: ## Replace the signing key; the old one is retired, still trusted for past receipts
	npx tsx scripts/gen-storefront-key.ts --rotate

.PHONY: storefront-key-revoke
storefront-key-revoke: ## Disavow a retired key: make storefront-key-revoke KID=storefront-key-2026-09-16
	npx tsx scripts/gen-storefront-key.ts --revoke $(KID)

.PHONY: tunnel
tunnel: ## Expose Vite :5173 via cloudflared; then make dev CLOUDFLARED_URL=<printed url>
	./tunnel.sh

.PHONY: docker-build
docker-build: ## Build the production Docker image locally
	docker build \
		--build-arg VITE_APP_URL="$(VITE_APP_URL)" \
		--build-arg VITE_MERCHANT_DID="$(VITE_MERCHANT_DID)" \
		--build-arg VITE_API_ORIGIN="$(VITE_API_ORIGIN)" \
		-t "$(DOCKER_IMAGE)" \
		.

.PHONY: docker-run
docker-run: ## Run the local Docker image on port 3000 (volume: bazaar-data)
	docker run --rm -p 3000:3000 -v bazaar-data:/data "$(DOCKER_IMAGE)"

.PHONY: fly-deploy
fly-deploy: ## Deploy to Fly production (requires FLY_APP, FLY_API_TOKEN and VITE_* env)
	@test -n "$${FLY_API_TOKEN:-}" || { echo "FLY_API_TOKEN is not set"; exit 1; }
	@test -n "$${FLY_APP:-}" || { echo "FLY_APP is not set (fly.toml holds a placeholder, not your app name)"; exit 1; }
	flyctl deploy --remote-only --app "$${FLY_APP}" \
		--build-arg VITE_APP_URL="$${VITE_APP_URL:-}" \
		--build-arg VITE_MERCHANT_DID="${VITE_MERCHANT_DID:-}" \
		--build-arg VITE_API_ORIGIN="$${VITE_API_ORIGIN:-}"

.PHONY: fly-deploy-stg
fly-deploy-stg: ## Deploy to Fly staging (requires FLY_APP, FLY_API_TOKEN and VITE_* env)
	@test -n "$${FLY_API_TOKEN:-}" || { echo "FLY_API_TOKEN is not set"; exit 1; }
	@test -n "$${FLY_APP:-}" || { echo "FLY_APP is not set (fly.stg.toml holds a placeholder, not your app name)"; exit 1; }
	flyctl deploy --remote-only --config fly.stg.toml --app "$${FLY_APP}" \
		--build-arg VITE_APP_URL="$${VITE_APP_URL:-}" \
		--build-arg VITE_MERCHANT_DID="${VITE_MERCHANT_DID:-}" \
		--build-arg VITE_API_ORIGIN="$${VITE_API_ORIGIN:-}"
