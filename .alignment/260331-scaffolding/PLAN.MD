# Agent briefing — app stack & architecture

## Objective

Scaffold a full-stack, self-hostable web application as a monorepo. The app serves a static React frontend from a Hono backend, persists data in SQLite (replicated continuously to Cloudflare R2 via Litestream), and stores multimedia assets in Cloudflare R2. Infrastructure is provisioned with Pulumi and deployed to Fly.io via a GitHub Actions pipeline.

The guiding principles throughout are: single container deployment, minimal external dependencies, low cost, and a codebase that is readable and maintainable by non-technical users.

---

## Repo structure

```
/
├── packages/
│   ├── server/        # Bun + Hono + Drizzle + SQLite
│   ├── client/        # React + TypeScript + Vite
│   └── infra/         # Pulumi TypeScript — provisions Cloudflare R2
├── .github/
│   └── workflows/
│       └── deploy.yml # CI/CD pipeline
├── Dockerfile
├── fly.toml
└── package.json       # Turborepo workspace root
```

---

## Stack

### Runtime & package manager

- **Bun** — runtime and package manager for all packages
- **Turborepo** — monorepo task orchestration

### Backend (`packages/server`)

- **Hono** — web framework, handles all HTTP routing
- **Drizzle ORM** — database access and schema management
- **SQLite** — embedded database via Bun's native bindings (no `better-sqlite3` or other native modules needed)
- **Litestream** — sidecar process that continuously replicates the SQLite file to Cloudflare R2

The backend serves the compiled frontend static files from its root (`/`). All API routes are namespaced under `/api`. There is no separate static file server.

### Frontend (`packages/client`)

- **React** with **TypeScript**
- **Vite** — dev server and build tool
- Vite outputs compiled assets to `packages/client/dist`
- In production, Hono serves this `dist` folder statically
- In development, Vite runs on a separate port with a proxy forwarding `/api` requests to the Hono dev server

### Infrastructure (`packages/infra`)

- **Pulumi** with the **TypeScript** SDK
- **Cloudflare provider** — provisions one R2 bucket used for both multimedia asset storage and Litestream DB backups
- Outputs a scoped Cloudflare API token and bucket name, which are injected into the container as environment variables

### Storage

- **Cloudflare R2** — object storage for multimedia assets and SQLite DB backups
  - No egress fees
  - Free tier: 10GB storage, 1M Class A ops, 10M Class B ops per month
- **SQLite** — primary database, stored as a file on a Fly.io persistent volume
- **Litestream** — replicates SQLite WAL changes to R2 in real time; enables point-in-time restore

### Hosting

- **Fly.io** — container hosting
  - Single container running the Bun/Hono server and Litestream sidecar
  - Persistent volume mounted for the SQLite database file
  - Config lives in `fly.toml` at the repo root

---

## Container

The `Dockerfile` should produce a single image that:

1. Builds the React frontend with Vite
2. Bundles the Hono backend
3. Installs the Litestream binary
4. At startup, runs both the Bun server and Litestream as concurrent processes (use a simple shell process supervisor or s6-overlay)

Environment variables the container expects at runtime:

- `R2_BUCKET` — name of the Cloudflare R2 bucket
- `R2_ACCESS_KEY_ID` — Cloudflare R2 access key
- `R2_SECRET_ACCESS_KEY` — Cloudflare R2 secret key
- `R2_ENDPOINT` — Cloudflare R2 S3-compatible endpoint URL
- `DATABASE_PATH` — path to the SQLite file on the persistent volume (e.g. `/data/app.db`)
- `PORT` — port Hono listens on (default `3000`)

---

## CI/CD (`deploy.yml`)

The GitHub Actions workflow runs on push to `main` and executes three steps in order:

1. **Provision infrastructure** — `cd packages/infra && pulumi up --yes`
   - Idempotent; safe to run on every deploy
   - Requires secrets: `CLOUDFLARE_API_TOKEN`, `PULUMI_ACCESS_TOKEN`

2. **Build Docker image** — standard `docker build` + push to a container registry (Fly.io's built-in registry or GHCR)

3. **Deploy to Fly.io** — `flyctl deploy`
   - Requires secret: `FLY_API_TOKEN`

---

## Key constraints & decisions

- **No Postgres.** SQLite only. The Litestream → R2 replication strategy makes this production-safe.
- **No separate CDN or static hosting.** The frontend is served from the Hono backend root. Keeps deployment to a single target.
- **Single container.** Everything runs in one image. No Docker Compose in production.
- **TypeScript everywhere.** Server, client, and infra are all TypeScript. This is intentional for maintainability.
- **Bun's native SQLite.** Do not use `better-sqlite3` or any other SQLite binding. Bun's built-in `bun:sqlite` module is preferred.
- **Litestream is a sidecar, not a library.** It is a Go binary running as a second process in the container alongside the Bun server.
