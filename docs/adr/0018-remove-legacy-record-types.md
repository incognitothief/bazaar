# ADR 0018: Remove the legacy catalog record types

## Status

Accepted.

## Date

2026-09-15

## Context

Bazaar carried two generations of catalog records at once. The v5 set —
`catalog.item.digital`, `catalog.collection`, `catalog.item.physical`, plus
`catalog.recording` and `catalog.composition` — predated the
`catalog.item` / `catalog.product` model introduced for the product/item page
work (see ADR 0003 for the original set).

Both generations were live simultaneously: every catalog read fanned out across
five collections and merged the results, every display helper branched per
`$type`, and the OAuth scope declared create permissions for all of them.
`AGENTS.md` deliberately froze the legacy pages as a working reference and
deferred the cleanup to "the dedicated legacy-deprecation cleanup that comes
later." This is that cleanup.

The precondition was inventory, not code. Legacy records could not be deleted
from the app at all until ADR 0017 added permanent catalog deletion; the
operator then cleared the remaining legacy inventory through that feature
before any of this landed.

"Legacy" turned out to name four independent things, with different blast
radii:

1. **Record types** — the five collections above.
2. **Receipt shape** — `purchase.receipt` payloads predating
   `licenseGrantCid` / `grantedItems`, verified by an optional-field signature.
3. **Signature encoding** — the DER `storefrontSig` fallback (ADR 0013 §6).
4. **Self-issued identifiers** — the `bazaarRid` / `bazaarWid` / `bazaarPid`
   scheme.

This ADR covers 1 and 4. 2 and 3 are receipt concerns that touch records living
on buyers' own PDSs and are handled separately.

## Decision

Delete the legacy record types outright, with no adapter and no migration
path. The lexicons, their TypeScript types, their NSIDs, their OAuth scopes and
every code path that read or wrote them are removed.

### What made this safe to do by deletion rather than by adapter

- No legacy records remain in the merchant's repo.
- `catalog.recording` and `catalog.composition` had no create path anywhere and
  were not in the OAuth scope, so they were already unwritable.
- The legacy publish route (`POST /inventory/sessions/:id/publish`) and its
  client (`UploadTracksPage`) were the only writers of the rest.

### Method

Narrowing the `CatalogItem` union to `BazaarItem | Product` — and
`MerchantItemRow["kind"]` to `"item" | "product"` — turned the type-checker
into an exhaustive worklist. This found consumers that a grep over the lexicon
names did not, and is the reason the change is believable at this size.

Two things it surfaced that were not on the original scan:

- **The server twin.** Deleting `UploadTracksPage` orphaned ~470 lines in
  `inventory.ts` that minted legacy records with signed identifiers. Nothing
  named it in the manifest; it was only reachable by chasing what the
  identifier imports still fed.
- **A four-layer cascade.** `rowArtworkCid` existed only because legacy records
  carried a PDS blob `artworkCid`. Removing it made `ArtworkImage` unreachable,
  which made its `agent` / `merchantDid` props dead, which made the public
  agent built solely to feed them dead — taking `inventoryArtworkPresign.ts`
  and the whole `/api/inventory-public` router with it.

### Consequential removals

- **Artwork.** The PDS-blob artwork path is gone entirely. `catalog.item` and
  `catalog.product` keep cover art in R2 (`catalogProductAssets`), reached by
  presigned URL. Per-item `og:image` is now the site default everywhere, which
  was already the behaviour for products.
- **Legacy item URLs.** `/item/<url-encoded at:// URI>` no longer resolves;
  those links fall through to the catch-all redirect. Deliberate, not
  incidental — a redirect shim was considered and declined.
- **Upload sessions are product-only.** `inventoryKind` other than `"product"`
  is rejected at session creation rather than opening a session that can
  upload but never publish.
- **The legacy R2 key scheme.** `inventoryObjectKey()` and
  `extensionForDigital()` are gone. Every object now resolves through
  `inventoryUploadObject.r2Key`, a DB lookup, never recomputation.
- **`bazaarIdentifiers`** (axis 4) — lib, route, tests, client API and every
  call site. The DER-fallback ticket had already slated this for removal; it
  fell out once its last caller went.

### Tests

Two tests would have kept passing vacuously and were reframed rather than
deleted: the entitlement "collections stay on the legacy path" case now asserts
the real invariant (any non-product NSID resolves to `undefined`), and the
buyer-scope exclusion test now names collections that actually exist.

## Consequences

**Positive**
- Lexicons 15 → 10. Client bundle 2,324 → 2,189 kB (gzip 592 → 558).
- One record model, one read path, one display path. Catalog reads fetch two
  collections instead of five.
- Fixed a live bug in passing: `OnboardingChecklist` pointed new merchants at
  the legacy upload page.
- Fixed a latent bug in passing: a standalone `catalog.item` used to resolve
  its bytes through the legacy branch by a coincidental `rkey` match rather
  than its own `objectId`.

**Negative / trade-offs**
- Any legacy record still on some PDS is now unreadable by this app, with no
  adapter to fall back on. This is the accepted cost of deleting rather than
  translating.
- Inbound links using the old `/item/at://…` form break.
- `DashboardPage` and `devCatalogDummy` had to be ported rather than deleted;
  both were quietly legacy-only and the dashboard was already showing nothing
  once legacy inventory was cleared.

**Deferred**
- Receipt shape and signature encoding (axes 2 and 3).
- Per-product `og:image`, which would need a public open-artwork endpoint for
  R2-backed cover art.
