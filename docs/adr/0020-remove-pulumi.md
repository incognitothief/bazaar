# ADR 0020: Remove Pulumi — provision R2 by hand

## Status

Accepted.

Supersedes parts of [ADR 0001](0001-application-stack.md): the `packages/infra` entry in its
monorepo layout (§1), the Pulumi state bucket in its storage section (§4), and the `pulumi up`
step in its CI/CD description (§6). Supersedes parts of [ADR 0010](0010-staging-environment.md):
the Pulumi stack column of its environment table (§1), the `PULUMI_STACK` job wiring (§2), the
Cloudflare/Pulumi/AWS secret group (§4), and the shared-state-bucket rule (§5).

## Date

2026-09-16

## Context

`packages/infra` was a Pulumi TypeScript program with the Cloudflare provider. Across its whole
life it managed exactly one resource type, `cloudflare.R2Bucket`, in two instances:

- `primary` — `bazaar-${stack}`, holding inventory bytes and Litestream backups
- `pulumi-state` — created only on the `prod` stack, existing solely to hold Pulumi's own state

Half the infrastructure under management was Pulumi's own bookkeeping. The exported prod state
committed at `packages/infra/stack.json` confirmed the shape: one `R2Bucket`, one provider, one
stack resource.

**Nothing consumed its outputs.** The server reads `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` and `R2_BUCKET_NAME` from the process environment
(`packages/server/src/lib/r2/env.ts`); `litestream.yml` and `docker-entrypoint.sh` read the same
four. Those values are Fly runtime secrets, set by hand. The R2 S3 API keys were *always* minted
manually in the Cloudflare dashboard — Pulumi never issued them. The comment in `env.ts` telling
the reader to "align bucket with packages/infra Pulumi `primary` output" described a human
convention, not a wired dependency. `packages/infra` was already excluded from the Docker build.

So the stack automated the one step that nobody gets wrong — creating a bucket — while every step
that actually breaks a deployment (tokens, Fly secrets, the volume) stayed manual.

What it cost in exchange:

1. **A bucket-creating Cloudflare credential in CI on every deploy.** `CLOUDFLARE_API_TOKEN` sat
   in Actions for both environments purely to converge a no-op diff.
2. **A pinned-version liability.** `deploy.yml` pinned `pulumi-version: "3.253.0"` with a comment
   explaining that an unpinned upgrade to 3.256.0/3.257.0 broke the S3 DIY backend against R2 with
   `InvalidDigest` (recorded in [ADR 0012](0012-repo-and-identity-resolution.md)). Pulumi's own
   partial fix targeted a different symptom. The project was pinned behind a known-broken upgrade
   path on a backend combination Pulumi does not test well.
3. **Dependency weight.** ~19 MB of `@pulumi/*` plus a gRPC/protobuf transitive tree, installed by
   `npm ci` in both deploy jobs.
4. **Secret sprawl.** Five secrets existed only for Pulumi — `CLOUDFLARE_API_TOKEN`,
   `PULUMI_BACKEND_URL`, `PULUMI_CONFIG_PASSPHRASE`, `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY` — duplicated across the `production` and `staging` environments.
5. **A hostile first run.** The README bootstrap was a five-step chicken-and-egg dance: log in to a
   `file://` backend, `pulumi up`, mint an S3 token, `stack export`, log in to the `s3://` backend,
   `stack import`. Every self-hoster had to understand Pulumi state backends to get one bucket.
   For a project whose premise is that a merchant can run their own storefront, that is the worst
   step in the setup.

## Decision

Delete `packages/infra` and provision the R2 bucket by hand, once, per environment.

### What made this safe to do by deletion rather than by migration

There was no state to carry across. The buckets already exist in Cloudflare; Pulumi's only claim
on them was a state file. Deleting the program and the state bucket leaves the primary buckets
untouched and the running application entirely unaffected, because the application never read
anything Pulumi produced.

### Method

- Removed `packages/infra` in full (program, `Pulumi.yaml`, stack config examples, exported
  `stack.json`). The root `package.json` needs no edit — the `packages/*` workspace glob covers it.
- Pruned the `@pulumi/*` tree from `package-lock.json`.
- `deploy.yml`: dropped the `pulumi/actions@v6` setup and the `Pulumi up` step from both jobs,
  along with `PULUMI_STACK`. Dropped `actions/setup-node` and `npm ci` with them — those existed
  only to install the Pulumi program. `flyctl deploy --remote-only` builds the image remotely and
  the Dockerfile runs its own `npm ci`, so the deploy jobs now need no Node toolchain at all.
- `deploy-preflight.yml`: dropped `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `PULUMI_BACKEND_URL`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from both required-secret
  lists. `CLOUDFLARE_ACCOUNT_ID` goes too: the application takes its account id from the
  `CF_ACCOUNT_ID` Fly secret, never from CI.
- Removed `make infra-preview` / `make infra-up`, `pulumi-bin` from `flake.nix`, the `.pulumi` and
  `Pulumi.*.yaml` ignore rules, and the `packages/infra` Docker exclusion.
- Rewrote the README setup to a single "create a bucket and an S3 token" section.

### Consequential removal: a committed account id

`packages/infra/stack.json` was tracked in git and carried the real Cloudflare account id in five
places. It held no encrypted secret material — no `secure` config keys, no API token — so this is
an identifier leak rather than a credential leak, but it had no business in a public repository.
Deleting the file removes it going forward; it remains in git history.

### Bucket creation is now a documented manual step

`bazaar-prod` (and `bazaar-stg`) are created in the Cloudflare dashboard, or with
`npx wrangler r2 bucket create`. No Makefile target and no new dependency wraps this: adding
`wrangler` to the project to run one idempotent command would re-import a chunk of what this ADR
removes.

## Consequences

**Positive**

- CI no longer holds a credential that can create or destroy Cloudflare buckets.
- Deploys lose a no-op provisioning step, a toolchain install and a dependency install.
- No pinned third-party version standing between the project and a working deploy.
- Setup for a new self-hoster is "make a bucket, make a token" instead of a state-backend bootstrap.
- A real account id leaves the tree.

**Negative / trade-offs**

- No audit trail for bucket configuration changes, and no drift detection. For a bucket whose only
  meaningful property is its name, this is an acceptable trade.
- No deletion protection from a declarative definition. Mitigated in practice by the fact that
  nothing automated can now reach the bucket at all.
- Bucket creation is a manual step a new operator can forget. It fails loudly and early: the server
  logs `R2_BUCKET_NAME is not set` (or an S3 404) and `docker-entrypoint.sh` prints that it is
  starting with no database backups.

**Deferred**

- If Cloudflare surface grows beyond bucket existence — DNS, Workers, R2 custom domains, lifecycle
  or CORS rules — reintroducing IaC should be reconsidered as its own decision. At the time of this
  ADR none of that exists: all R2 access is server-side `S3Client`, with no public bucket, no
  presigned URLs and no CORS configuration.
- The `bazaar-pulumi-state-prod` bucket and the Cloudflare API token are retired by hand as an
  operator task; neither is referenced by anything in the tree after this change.
