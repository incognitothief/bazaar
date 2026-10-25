# ADR 0024: Relicense to MIT, drop the CLA, move CI to Tangled spindles

## Status

Accepted. `.github/workflows/` is removed in the same change, so once it reaches `main`
production deploys only from Tangled, manually.

## Date

2026-10-25

## Context

Bazaar was AGPL-3.0-only, with the eight lexicon JSON files carved out as Apache-2.0 so
other implementations could use the record format freely. Contributions went through a CLA
that allowed commercial relicensing — the point of the split was a dual-licensing option.

The repository is moving off GitHub to Tangled (`tangled.org/whereditgo.diamonds/bazaar`).
The CLA was enforced by a GitHub Action that comments on pull requests, records signatures on
a `cla-signatures` branch and sets a status check. None of that exists on Tangled, whose pull
requests are atproto records rather than GitHub events.

Every commit in history is the maintainer's; the only recorded CLA signature is the
maintainer's own test signature. No third-party copyright stands in the way of relicensing.

## Decision

**Licence.** The whole repository — application and lexicons — is MIT. The CLA, its workflow
and the lexicon directory's separate Apache-2.0 `LICENSE` are removed. Contributions are
accepted under the project licence (inbound = outbound); there is nothing to sign. Versions
already published under AGPL remain available under AGPL to whoever received them.

This gives up the dual-licensing option: anyone may run a modified, closed Bazaar as a
service. The footer "Source Code" link (`sourceCodeUrl.ts`) stays as a courtesy, no longer
an AGPL §13 obligation, and now defaults to the Tangled repository. Tangled 404s on an
abbreviated SHA, so `VITE_SOURCE_COMMIT` is only appended there when it is a full 40 characters.

**CI.** GitHub Actions (`.github/workflows/test.yml`, `deploy.yml`) is removed.
`.tangled/workflows/` runs on the Tangled spindle, nixery engine:

- `test.yml` — push to `main` and pull requests into `main`; same checks as `make ci`.
- `deploy-production.yml` — **manual only**, refused unless the run is for `main`.
- `deploy-staging.yml` — **manual only**, any ref.

Differences from the GitHub setup, and why:

- **No required reviewers.** Spindle has no deployment environments, so the manual trigger is
  the production gate. Nothing deploys on push.
- **Secrets are repo-wide.** Every workflow, including PR test runs, can read every secret.
  Prod and staging get separate secret names (`*_PROD`, `*_STG`) and each `FLY_API_TOKEN_*`
  must be a deploy token scoped to its one Fly app (`fly tokens create deploy -a <app>`), so
  a leaked staging token cannot touch production.
- **Staging is no longer deployed from PRs.** GitHub filtered out fork PRs by head repo;
  spindle exposes no equivalent, and secrets are repo-wide, so a PR trigger could hand a token
  to fork code. The `DEPLOY_STG` repo variable has no spindle equivalent and is gone with it.
- **No concurrency groups.** Overlapping manual runs race; don't start one mid-deploy.
- **bun on nixery.** The server scripts run `npx --yes bun@1.4.0`, a prebuilt glibc binary
  that needs `/lib64/ld-linux-x86-64.so.2`. Nixery images have no `/lib64`, so the test
  workflow links nixpkgs' glibc loader there first.
- **5-minute default workflow timeout** (operator-set). GitHub deploy jobs took 59–132s and
  tests ~35s, so both fit, but a cold `--no-cache` remote build is the one to watch.

## Cutover

Removing `.github/workflows/` means merging this change to `main` on GitHub deploys nothing,
so there is no window where both systems deploy production.

1. Create the `*_PROD` / `*_STG` repo secrets on Tangled, with app-scoped deploy tokens.
2. Run `deploy-staging` manually; confirm the deploy and timing.
3. Merge to `main`, then run `deploy-production` manually from `main`.
4. Retire the remaining GitHub-hosted references (security-advisory link in
   `CONTRIBUTING.md`) and the GitHub environments, secrets and `cla-signatures` branch.

While both remotes are pushed, `git push tangled -o skip-ci` skips spindle runs.
