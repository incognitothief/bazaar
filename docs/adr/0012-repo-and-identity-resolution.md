# ADR 0012: Repo and identity resolution (DID→PDS, handle↔DID)

## Status

Accepted

## Date

2026-08-17

## Context

`com.atproto.repo.getRecord` / `listRecords` are **PDS-hosted** endpoints — they only return data
for repos physically hosted on the queried server. Server and client code assumed a single fixed
`ATPROTO_SERVICE` / `VITE_ATPROTO_SERVICE` host (defaulting to `https://bsky.social`) could serve
`getRecord`/`listRecords` for *any* DID. It can't — that only works for repos that happen to be
hosted on that specific server. Every other DID silently 404s.

This was invisible until buyers whose PDS wasn't the default host started reporting broken
purchase receipts and downloads. The worst instance was in the receipt-writing path itself
(`fulfillCheckoutSession.ts`): a fixed-host assumption there meant a purchase could fail outright
during fulfillment, not just be invisible afterward.

An earlier idea — routing reads through Slingshot (microcosm.blue's edge record/identity cache,
`slingshot.microcosm.blue`) — was considered and rejected: its `getRecord` support doesn't extend
to `listRecords`, so it couldn't fully replace the fixed-host pattern; proper DID resolution was
needed regardless, and adding a third-party caching dependency on top wasn't justified once the
core resolver existed.

A second, related instance of the same problem class surfaced on the identity side: dev mock
sign-in's handle→DID lookup called a fixed AppView's `com.atproto.identity.resolveHandle`
(`bsky.social` by default). This "worked" only because that particular AppView happens to index
arbitrary handles as a convenience — it isn't a resolution authority, and there's no guarantee any
given AppView indexes a given handle at all.

## Decision

### 1. DID→PDS/handle resolution (server)

`packages/server/src/lib/atproto/resolvePds.ts` uses `IdResolver` (`@atproto/identity`) to resolve
a DID's document — `plc.directory` for `did:plc`, the DID's own domain for `did:web` — and caches
`{ pds, handle }` together for 1 hour (one resolution call yields both).

- `resolvePdsForDid(did)` — PDS service endpoint.
- `resolveHandleForDid(did)` — the DID document's *claimed* handle. Display-only, not
  bidirectionally verified when resolving this direction.
- `getAgentForDid(did)` — unauthenticated `Agent` bound to the resolved PDS. Falls back to
  `ATPROTO_SERVICE` (or `https://bsky.social`) only if resolution fails, so behavior never
  regresses below the old fixed-host baseline.

### 2. Handle→DID resolution, bidirectionally verified (server)

`resolveDidForHandle(handle)` — protocol-level resolution only: `IdResolver.handle` (DNS TXT
record at `_atproto.<handle>`, or `/.well-known/atproto-did` on the handle's own domain). Never
calls a fixed AppView's `resolveHandle`. The result is bidirectionally verified — the resolved
DID's own document must claim this same handle back, or resolution is treated as failed — closing
a spoofing gap the old fixed-host call didn't (deliberately) guard against.

### 3. Generic public endpoint

`GET /api/atproto/resolve-pds` accepts either `?did=` or `?handle=` and returns
`{ did, pds, handle }` from whichever was given. Public, no auth (identity data is public).

### 4. Client mirror

`packages/client/src/lib/atproto/pdsResolve.ts` — `agentForRepo(did)`, `resolveHandleForDid(did)`,
`resolveDidForHandle(handle)` — same shape, same 1-hour caching, backed by the endpoint above.
`resolveDidForHandle` opportunistically warms the DID-keyed cache from the same response.

### 5. Call sites migrated

Every server route reading an artist/buyer repo by DID switched from the old fixed-host
`getAgent()` (`packages/server/src/lib/atproto/client.ts` — now deleted, no longer referenced) to
`getAgentForDid(did)`: `resolveCatalogItemUri.ts`, `routes/download.ts`, `routes/stripe.ts`,
`routes/catalog.ts`, `lib/spaHtmlMeta.ts`, and `lib/stripe/fulfillCheckoutSession.ts` (the
receipt-writing path — the most severe instance). `lib/inventoryArtworkPresign.ts` was missed in
the original sweep and found/fixed in this pass — its artwork-fallback path was silently 404ing
for repos off the default host.

Mock sign-in (`useAtpSession.tsx`) switched from `createPublicAgent().identity.resolveHandle` to
`resolveDidForHandle`.

### 6. OAuth scope narrowing (same effort)

Buyer sessions request only `purchase.receipt`/`purchase.consent` create scope; merchant sessions
keep the full scope. Role is inferred from the sign-in destination (`/merchant/` prefix), since
the real DID/role isn't known until after OAuth completes.

## Constraints

| Rule | Value |
|---|---|
| DID resolution library | `@atproto/identity` `IdResolver` |
| PDS/handle cache TTL | 1 hour (server and client, separate caches) |
| Handle resolution | DNS TXT / `.well-known` only; bidirectionally verified; never a fixed AppView |
| Fallback host | `ATPROTO_SERVICE` / `VITE_ATPROTO_SERVICE` (default `https://bsky.social`) — last resort only |
| Generic resolver endpoint | `GET /api/atproto/resolve-pds?did=…` or `?handle=…`, public, no auth |

## Consequences

**Positive**

- Purchases, downloads, artwork, and catalog reads now work for artists on any PDS, not just the
  default host.
- No dependency on a specific AppView being reachable or willing to index a handle.
  `plc.directory` remains an unavoidable dependency for `did:plc` DID documents — it's the sole
  registry for that method, the same root-of-trust any resolver (including Slingshot) must use,
  not a Bluesky-convenience shortcut. `did:web` needs neither `plc.directory` nor any AppView.
- Bidirectional handle verification closes a spoofing gap the old fixed-host `resolveHandle` call
  didn't guard against.

**Negative / trade-offs**

- More network calls on a cold cache miss (a DID doc fetch, and for handles, a second DID-doc
  fetch for verification) — mitigated by the 1-hour cache, but a burst of first-time DIDs (e.g.
  loading a payment activity table full of new buyers) means that many concurrent resolutions.
- Six client call sites still call `createPublicAgent()` directly against the fixed host, not yet
  migrated to per-DID resolution: `HomePage`, `ItemDetailPage`, `PurchaseDetailPage`,
  `SettingsPage`, `PublicHeaderAccount`, `useActorMerchantProfile`. Same bug class remains latent
  there.

**Deferred**

- Migrating the six `createPublicAgent()` call sites above.
- Item purchased / license name columns on the merchant payment activity page — mechanically
  possible now (receipt on buyer's PDS → item/license on the merchant's own repo) but real
  per-row I/O; not implemented.
- Dashboard stat cards (Total sales / Last week / Last 24h) — no amount/currency persisted
  locally today; needs a schema migration and a backfill decision for historical rows; not
  implemented.

## Minor fixes and unrelated changes this session

- **Sign-in page**: typeahead selection now auto-starts sign-in instead of requiring a second
  click on Continue (the reopening suggestion dropdown could visually block it); sign-in failures
  now show inline instead of navigating to a bare server error page (a `redirect: "manual"`
  preflight fetch runs before committing to the real OAuth redirect); busy-state visual feedback
  on the Continue button; copy updated to "atmosphere account" branding with a link.
- **Merchant dashboard**: left sidebar is now collapsible (state persisted via localStorage);
  "Payment activity" promoted from a nested "Sales" dropdown to a top-level nav item.
- **Merchant payment activity table**: buyer column now shows the resolved handle (falls back to
  DID while resolving or on failure), full DID always available via hover tooltip, still links
  through to pdsls.
- **CI**: `pulumi/actions@v6` now pins `pulumi-version: "3.253.0"` in `deploy.yml`. An unpinned
  upgrade (to 3.256.0/3.257.0) changed the Pulumi S3 DIY backend's default AWS SDK checksum
  behavior, breaking state writes to Cloudflare R2 with `InvalidDigest`. Pulumi's own partial fix
  for that bug class targets a different symptom (403s, not the 400 hit here), so pinning to the
  last confirmed-working version was the safer immediate fix over chasing the fix's exact
  applicability.
