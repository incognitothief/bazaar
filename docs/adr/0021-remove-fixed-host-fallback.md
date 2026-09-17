# ADR 0021: Remove the fixed-host fallback — resolution failure is an error

## Status

Accepted.

Supersedes parts of [ADR 0012](0012-repo-and-identity-resolution.md): its `getAgentForDid`
fallback clause (§1), its "Fallback host" constraint row, and the deferred `createProxyAgent`
item. The resolution machinery 0012 introduced — `IdResolver`, the 1-hour caches, bidirectional
handle verification, `GET /api/atproto/resolve-pds` — is unchanged and remains in force.

## Date

2026-09-17

## Context

ADR 0012 established that `com.atproto.repo.getRecord` / `listRecords` and
`com.atproto.sync.getBlob` are PDS-hosted: they answer only for repos physically on the queried
host, and every other DID silently 404s. It replaced the fixed-host assumption with per-DID
resolution, but kept the old host as a fallback when resolution failed, "so behavior never
regresses below the previous fixed-host baseline."

That fallback was the wrong shape for the failure it handles, for a reason worth stating plainly:
**it converts an error into an absence.** When resolution fails, the fallback issues a lookup
against a server that almost certainly does not hold the repo. The response is not an error — it
is a perfectly ordinary empty result. The caller cannot distinguish "this record does not exist"
from "we failed to find out where to look," so it renders the former.

Two things made this concrete rather than theoretical.

**1. It reads as a misunderstanding, not as caution.** A fallback is conservative when the
fallback can actually serve the request. This one only ever worked for repos that happened to be
on the default host, which is the exact assumption ADR 0012 was written to remove. Keeping it
preserved the old bug as the failure mode of the new code.

**2. It was writing bad data.** `createProxyAgent(did)` splits its transports: writes proxy
through the server, which resolves correctly; reads went to the fixed host. `SettingsPage` read
the merchant's `actor.merchant` record through that read path, and on an empty result bailed out
leaving `profileRkey`/`profileCid` null. Saving then took the "no existing record" branch and
called `createRecord` with no rkey, so the PDS minted a new one — and the write *succeeded*,
because writes resolved properly. A merchant hosted off the default host therefore accumulated a
fresh duplicate `actor.merchant` record on every save, while public reads (`limit: 1`,
`records[0]`) picked an arbitrary one as their storefront identity.

The codebase had already noticed the read path was wrong without naming it: `putListing`,
`putCatalogItem` and `putProduct` each built a *second* agent via `agentForRepo(did)` purely to
do their read-before-write, routing around the proxy's own `getRecord`. Three local workarounds
for a defect nobody had fixed at the source.

## Decision

Resolution failure throws. There is no default host anywhere in the system.

### 1. `agentForRepo` / `getAgentForDid` throw

Both client (`lib/atproto/pdsResolve.ts`) and server (`lib/atproto/resolvePds.ts`) now throw
`Could not resolve a PDS for <did>` instead of constructing an agent pointed at a fallback.

This is a smaller behavioral change than it looks. Today's fallback agent issues a request to a
host that does not have the repo, and that request throws inside the `getRecord` call one line
later — landing in the same `catch` the caller already has. Throwing at resolution moves the
failure earlier and drops a pointless round trip. Every existing server caller
(`fulfillCheckoutSession`, `catalog`, `merchant`, `stripe`, `spaHtmlMeta`, `storefrontKeys`,
`resolveCatalogItemUri`) already wraps these in `try`/`catch → null`.

The one genuine regression: a DID that *is* on the old default host, whose resolution fails
transiently (say a `plc.directory` blip), previously succeeded and now fails. That is the correct
trade — a transient failure becoming visible beats it silently succeeding only for one host's
users.

### 2. `createProxyAgent` resolves reads per call

Its `getRecord`/`listRecords` now resolve on `input.repo`, not on the session DID — these methods
accept any repo, not only the session's own. `ATPRepoClient` already declared both as returning
promises, so no call-site signatures changed.

### 3. `createPublicAgent` is deleted

With the proxy's reads resolved and the six ADR-0012 call sites migrated, it had no remaining
consumer.

### 4. The env vars are gone

`VITE_ATPROTO_SERVICE` and `ATPROTO_SERVICE` existed only to feed the fallback — the OAuth flow
discovers the PDS from the submitted handle and never read either. Both are removed from
`vite-env.d.ts`, `Dockerfile` `ARG`/`ENV`, the `Makefile` build-args, `deploy.yml`,
`deploy-preflight.yml`'s required-secret lists, and both `.env.example` files. Operators should
delete `VITE_ATPROTO_SERVICE` from the `production` and `staging` GitHub Environments.

### 5. The read-before-write workarounds are collapsed

`putListing`, `putCatalogItem` and `putProduct` now read through the agent they were handed,
since it resolves correctly.

## Consequences

**Positive**

- No code path can silently query a host that does not hold the repo. "Could not resolve" and
  "does not exist" are now distinguishable.
- The `actor.merchant` duplication bug is fixed at its source rather than at its symptom.
- One fewer required build-arg and CI secret; one fewer configuration surface where a wrong value
  produces plausible-looking wrong behavior rather than an error.
- `createPublicAgent` and the three `readAgent` workarounds are gone — the "resolve the PDS"
  rule now has no exceptions to remember.

**Negative / trade-offs**

- Transient resolution failures surface as errors rather than being papered over for DIDs on the
  old default host (see §1).
- Callers that catch broadly still turn a thrown resolution error into an empty render. The error
  is now available to distinguish the two cases, but no caller does so yet — improving those
  messages is follow-up work, not a regression.
- Deployments that had set `VITE_ATPROTO_SERVICE` to a non-default host as a de-facto "which
  network am I on" switch lose that lever. Nothing in the tree used it that way.

**Deferred**

- Surfacing resolution failure distinctly in the UI, rather than as an empty state, at the call
  sites that currently `catch → null`.
- Deduplicating any `actor.merchant` records already created by the bug in §2 of Context. The fix
  stops new ones; it does not clean up existing repos.
