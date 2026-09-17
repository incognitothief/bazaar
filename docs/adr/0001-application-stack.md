# ADR 0001: Application stack and deployment

## Status

Accepted, partially superseded by [ADR 0020](0020-remove-pulumi.md) (§1 layout, §4 storage, §6 CI/CD — Pulumi removed).

## Date

2026-03-31

## Context

Bazaar is a self-hostable storefront monorepo. The initial scaffold optimizes for a single Fly.io container, minimal external dependencies, low cost, and TypeScript throughout.

## Decision

### 1. Monorepo layout

- `packages/server` — Bun + Hono + Drizzle + SQLite
- `packages/client` — React + TypeScript + Vite
- `packages/infra` — Pulumi (TypeScript) provisioning Cloudflare R2
- Root `package.json` — npm workspaces + Turborepo task orchestration

### 2. Runtime and build

- **Server runtime:** Bun (`packages/server` dev/build/start scripts).
- **Workspace tooling:** npm (`npm ci` in CI and Docker build stage).
- **Frontend build:** Vite → `packages/client/dist`.
- **Production static files:** Hono `serveStatic` from `STATIC_ROOT` (default `../../client/dist` in dev; `/app/static` in container).
- **API namespace:** all backend routes under `/api`.
- **Development:** Vite on `:5173` proxies `/api` to Hono on `:3000`.

### 3. Data layer

- **SQLite** as the only database (no Postgres). File path from `DATABASE_PATH` (default `./data/app.db`; `/data/app.db` on Fly).
- **Drizzle ORM** for schema and migrations; migrations run at server startup.
- **Litestream** continuously replicates the SQLite WAL to Cloudflare R2 when `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_ENDPOINT` are set. Implemented via `litestream replicate -exec` wrapping the Bun server in `docker-entrypoint.sh` (not a separate process supervisor).

### 4. Storage and infrastructure

- **Cloudflare R2** — one primary bucket per Pulumi stack (`bazaar-${stack}`) for multimedia assets and Litestream DB backups (`litestream/` prefix).
- **Pulumi state** — stored in a dedicated R2 bucket (`bazaar-pulumi-state-prod`), created only on the `prod` stack; non-prod stacks reuse the same backend URL.
- **Fly.io** — single container, persistent volume at `/data`, config in `fly.toml`.

### 5. Container image

Multi-stage `Dockerfile`: Node 22 builds frontend + bundles server; Bun slim runtime image includes Litestream binary, `docker-entrypoint.sh`, migrations, and static assets.

### 6. CI/CD

On push to `main`: `pulumi up` (stack `prod`) then `flyctl deploy`. Requires Cloudflare API token, R2-backed Pulumi backend credentials, and Fly deploy token. See `README.md` for the full secrets list.

## Constraints

| Rule | Value / location |
|------|------------------|
| No Postgres | SQLite only |
| No separate CDN | Frontend served from Hono |
| Single production container | No Docker Compose in prod |
| Bun SQLite binding | No `better-sqlite3` |
| API prefix | `/api` |
| Default port | `3000` |

## Consequences

**Positive**

- Single deploy target; low operational surface area.
- Litestream + R2 makes SQLite viable for production without managed Postgres cost.
- TypeScript across server, client, and infra.

**Negative / trade-offs**

- npm + Bun split adds mental overhead vs. a single package manager.
- Litestream requires R2 credentials at runtime; local dev runs without replication.
- Fly volume is a single point of failure until Litestream restore is exercised.

**Deferred**

- Staging environment (see ADR 0010).
