# AGENTS.md

## What this is

Bazaar — a self-hostable storefront for digital goods. Purchase records are written to
the buyer's own PDS (ATProto Personal Data Server).

## Layout

```
packages/
  client/   React + Vite + TypeScript SPA
  server/   Bun + Hono API, SQLite (Drizzle) + Litestream → R2, Stripe fulfillment
  shared/   Lexicons (JSON), license templates, shared TS types
  infra/    Pulumi — provisions Cloudflare R2 buckets
docs/adr/   Canonical decision log
Makefile    Canonical command surface (`make help`)
```

Deployment is Fly.io (`fly.toml` / `fly.stg.toml`, `.github/workflows/deploy.yml`).

## Rules

- `docs/adr/` is the canonical decision log. When creating a new major feature, it should be detailed here automatically. Do not bloat this folder; Coalesce when necessary within single working sessions.

## Design principles

- The AT Protocol promises a distributed network of users: any DID's repo can live on any PDS, and any handle resolves
  independently of any single host. Code must resolve per-identity, never assume a fixed default
  host serves an arbitrary DID or handle. Full rationale: [ADR 0012](docs/adr/0012-repo-and-identity-resolution.md).

## Commands

`make help` lists all targets; the ones below are primary.

| Command                                   | Does                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `make install`                            | Install dependencies                                                                         |
| `make dev`                                | Client (Vite `:5173`) + server (Bun `:3000`) via Turbo                                       |
| `make build`                              | Build all workspaces (Turbo)                                                                 |
| `make test`                               | Server unit tests (Bun)                                                                      |
| `make lexicons-validate`                  | Validate lexicons                                                                            |
| `make db-generate` / `make db-migrate`    | Drizzle migrations                                                                           |
| `make ci`                                 | `install-ci` + `lexicons-validate` + `build` + `test` — matches `.github/workflows/test.yml` |
| `make infra-preview` / `make infra-up`    | Pulumi, R2 buckets only (`PULUMI_STACK=prod\|stg`)                                           |
| `make fly-deploy` / `make fly-deploy-stg` | Fly deploy                                                                                   |
| `make docker-build` / `make docker-run`   | Local production image                                                                       |

Type-checking is manual: run `npx tsc --noEmit -p .` inside a package. Only
`packages/shared` type-checks during its own build; `vite build` and `bun build` do not.
