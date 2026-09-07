# ADR 000: Bootstrap Architecture

- **Status:** Accepted
- **Date:** 2026-03-31
- **Supersedes:** `.alignment/260331-scaffolding/PLAN.MD`
- **Superseded by:** —

## Context

Bazaar is a full-stack, self-hostable web application. The goal is a storefront
that a single operator can deploy and maintain without a platform team: one
container, predictable costs, and a codebase readable enough that non-technical
stakeholders can follow the shape of the system.

The bootstrap problem is not feature depth — it is **deployment simplicity**.
Every extra moving part (separate static host, managed database, compose stacks,
polyglot tooling) increases the surface area for failure and the burden on
someone self-hosting on Fly.io with object storage on Cloudflare R2.

Guiding principles for every later decision:

- **Single container deployment** — one image, one Fly app, one place to look when
  something breaks.
- **Minimal external dependencies** — prefer embedded and managed-free primitives
  (SQLite, R2 free tier) over always-on services.
- **Low cost** — R2 for assets and backups; no egress fees; SQLite instead of a
  managed database.
- **Maintainability** — TypeScript end-to-end so server, client, and infra share
  one language and one mental model.

## Decision

We adopt the following foundational architecture.

### Monorepo layout

Turborepo workspace at the repository root:

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
└── package.json       # workspace root
```

Later packages (for example `packages/shared` for lexicons) extend this layout;
they do not change the bootstrap shape of server + client + infra.

### Runtime and tooling

| Layer | Choice | Role |
| ----- | ------ | ---- |
| Runtime | **Bun** | Server process and preferred package/runtime for backend code |
| Orchestration | **Turborepo** | Monorepo task graph (`dev`, `build`, deploy prep) |
| Language | **TypeScript** | Server, client, and infra — intentional for maintainability |

### Backend (`packages/server`)

- **Hono** — HTTP routing for API and static asset serving.
- **Drizzle ORM** — schema and database access.
- **SQLite** — embedded primary database via Bun's native bindings (`bun:sqlite`).
  Do not use `better-sqlite3` or other native SQLite modules.
- **Litestream** — sidecar process that continuously replicates the SQLite file
  to Cloudflare R2 for point-in-time restore.

**Serving model:** Hono serves the compiled frontend from `/` and namespaces all
API routes under `/api`. There is no separate static file server in production.

**Development:** Vite runs on its own port; a dev proxy forwards `/api` to the
Hono dev server.

### Frontend (`packages/client`)

- **React** with **TypeScript**.
- **Vite** — dev server and production build.
- Build output lands in `packages/client/dist`; production Hono serves that
  directory as static files.

### Infrastructure (`packages/infra`)

- **Pulumi** (TypeScript SDK) with the **Cloudflare** provider.
- Provisions one R2 bucket used for **both** multimedia asset storage and
  Litestream database backups.
- Stack outputs (scoped API token, bucket name) are injected into the runtime
  container as environment variables.

### Storage

| Store | Role |
| ----- | ---- |
| **SQLite** (Fly persistent volume) | Primary application database |
| **Cloudflare R2** | Multimedia assets + Litestream WAL replication |
| **Litestream** | Real-time SQLite → R2 replication; enables PITR |

R2 is chosen for object storage: no egress fees, free tier (10 GB storage, 1M
Class A / 10M Class B ops per month).

### Hosting

- **Fly.io** — single container running Bun/Hono and the Litestream sidecar.
- Persistent volume mounted for the SQLite database file.
- App configuration in `fly.toml` at the repo root.

### Container image

The `Dockerfile` produces one image that:

1. Builds the React frontend with Vite.
2. Bundles the Hono backend.
3. Installs the Litestream binary.
4. At startup, runs Bun and Litestream concurrently (shell supervisor or
   s6-overlay).

Required runtime environment variables:

| Variable | Purpose |
| -------- | ------- |
| `R2_BUCKET` | Cloudflare R2 bucket name |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_ENDPOINT` | R2 S3-compatible endpoint URL |
| `DATABASE_PATH` | SQLite file on the persistent volume (e.g. `/data/app.db`) |
| `PORT` | Hono listen port (default `3000`) |

### CI/CD

GitHub Actions workflow on push to `main`, three ordered steps:

1. **Provision infrastructure** — `cd packages/infra && pulumi up --yes`
   (idempotent; safe every deploy). Secrets: `CLOUDFLARE_API_TOKEN`,
   `PULUMI_ACCESS_TOKEN`.
2. **Build and push image** — `docker build` to Fly.io registry or GHCR.
3. **Deploy** — `flyctl deploy`. Secret: `FLY_API_TOKEN`.

### Hard constraints (carry forward)

These are non-negotiable for the bootstrap architecture unless a future ADR
explicitly revisits them:

- **No Postgres** — SQLite only; Litestream → R2 makes this production-viable.
- **No separate CDN or static host** — frontend ships from Hono; one deploy
  target.
- **Single container in production** — no Docker Compose stack on the server.
- **TypeScript everywhere** — server, client, infra.
- **Bun native SQLite** — not `better-sqlite3`.
- **Litestream as sidecar** — Go binary as a second process, not an in-process
  library.

## Consequences

### Positive

- **Operators run one thing.** A single Fly app and one container image map
  cleanly to "is the store up?"
- **Cost floor stays low.** SQLite + R2 free tier avoids always-on database and
  egress billing surprises.
- **Disaster recovery is object-store shaped.** Litestream replication to the
  same R2 bucket that holds assets keeps backup story simple.
- **One language reduces context switching.** TypeScript from UI through Pulumi
  lowers the bar for contributors who are not full-time operators.
- **Self-hosting stays honest.** No hidden requirement for Postgres, Redis, or a
  separate static host.

### Negative / trade-offs

- **SQLite write concurrency** — acceptable for a single-merchant storefront;
  not a multi-tenant write-heavy platform without later redesign.
- **Coupled frontend deploys** — static assets and API ship together; no
  independent CDN cache busting without a follow-up decision.
- **Sidecar operational complexity** — two processes in one container (Bun +
  Litestream) need a supervisor and shared volume discipline.
- **Pulumi on every deploy** — infra step adds latency; mitigated by idempotent
  `pulumi up` but still a pipeline dependency.
- **Fly + R2 + Litestream stack** — opinionated; migrating off any leg is a
  deliberate migration project.

## Considered alternatives

- **Postgres (managed or self-hosted).** Rejected for bootstrap: adds cost,
  connection management, and another service to operate. Litestream-backed SQLite
  is the chosen production path.
- **Separate CDN / static hosting for the React build.** Rejected: second deploy
  target and DNS surface; Hono serving `dist/` keeps the topology single-target.
- **Docker Compose in production.** Rejected: multi-service orchestration on the
  host conflicts with single-container Fly deployment.
- **`better-sqlite3` or other native SQLite bindings.** Rejected: Bun's built-in
  SQLite avoids native module build pain in the container.
- **Litestream as an application library.** Rejected: Litestream is operated as
  an external replication sidecar, not embedded in application code.
