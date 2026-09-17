# ADR 0010: Staging deployment environment

## Status

Accepted, partially superseded by [ADR 0020](0020-remove-pulumi.md) (§1, §2, §4, §5 — Pulumi removed; staging is still a separate Fly app + R2 bucket).

## Date

2026-04-05

## Context

Bazaar deploys to Fly.io with Pulumi-provisioned R2 buckets. Production runs on every push to `main`. Contributors need a staging environment that exercises the full deploy pipeline on pull requests without overwriting production data or secrets.

## Decision

### 1. Two Fly apps

| Environment | Fly config | Pulumi stack | Trigger |
|-------------|------------|--------------|---------|
| Production | `fly.toml` | `prod` | Push to `main` |
| Staging | `fly.stg.toml` | `stg` | Pull request events (gated) |

Each app has its own persistent volume, Fly secrets, and R2 primary bucket (`bazaar-${stack}`).

### 2. CI workflow split (`.github/workflows/deploy.yml`)

- **`deploy-production`** — `if: push to main`; `environment: production`; `PULUMI_STACK: prod`; `flyctl deploy` (default config).
- **`deploy-staging`** — `if: pull_request` + `vars.DEPLOY_STG == 'true'` + PR head repo is same repository (fork guard); `environment: staging`; `PULUMI_STACK: stg`; `flyctl deploy --config fly.stg.toml`.

`deploy-preflight.yml` mirrors the same gates so PRs do not fail on missing staging secrets when `DEPLOY_STG` is unset.

### 3. `DEPLOY_STG` repository variable

GitHub Actions **repository variable** `DEPLOY_STG=true` enables staging deploys. Not read by the application runtime — CI only.

When unset or not `true`, PR workflows skip staging jobs (no cost, no missing-secret failures).

### 4. Secrets and build args

GitHub Environments `production` and `staging` hold parallel secret names with different values:

- Cloudflare / Pulumi backend (`CLOUDFLARE_*`, `PULUMI_BACKEND_URL`, `AWS_*`)
- `FLY_API_TOKEN`
- `VITE_*` build-args for the client bundle

Server-only runtime secrets are set on each Fly app via `fly secrets set` (documented in `packages/server/.env.example`).

### 5. Pulumi state

Non-prod stacks reuse the prod Pulumi state bucket (`PULUMI_BACKEND_URL`); only the `prod` stack creates the state bucket (ADR 0001).

### 6. Documentation layer

Root and package `.env.example` files document three layers: **local dev**, **CI controls** (`DEPLOY_STG`), and **hosted runtime** (Fly secrets per app).

## Constraints

| Rule | Value |
|------|-------|
| Staging gate | `DEPLOY_STG=true` |
| Fork PRs | No staging deploy (same-repo check) |
| Staging concurrency | `cancel-in-progress: true` on staging job |

## Consequences

**Positive**

- PR branches get a real deployed preview when enabled.
- Production and staging isolation for buckets, volumes, and secrets.

**Negative / trade-offs**

- Operators must maintain duplicate secret sets in GitHub Environments.
- Shared staging app means concurrent PRs overwrite each other (latest PR wins).
- Pulumi state bucket shared across stacks requires careful bootstrap (documented in README).

**Deferred**

- Per-PR ephemeral preview apps.
