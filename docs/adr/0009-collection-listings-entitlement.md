# ADR 0009: Collection listings and entitlement (post-essential)

## Status

Accepted

## Date

2026-04-05

## Context

Early lexicon drafts used `collection.items[].essential` to distinguish bonus tracks from deliverable album content. That flag complicated upload UX and download entitlement. Merchants also need to sell individual tracks from a collection release without exposing unrelated singles as buyable on the collection page.

## Decision

### 1. Remove `essential` from the lexicon

`catalog.collection.items[]` no longer includes an `essential` field. All members in `items` are part of the release for entitlement and display purposes.

Legacy records may still carry `essential` in stored JSON; readers ignore it.

### 2. `parentListing` on `catalog.listing`

Optional `parentListing` (AT-URI) links a **track listing** to the **collection listing** AT-URI for the same release.

| Listing type | `parentListing` |
|--------------|-----------------|
| Collection listing | absent |
| Track single from that release | set to collection listing URI |

**Storefront:** On a collection item page, a track is individually purchasable only when an active listing exists for that track's digital URI **and** `parentListing` matches this collection's listing URI.

**Cascade pause:** Pausing the collection listing updates child listings (matching `parentListing`) to `paused`.

### 3. Download entitlement

With a valid collection `purchase.receipt`:

- **Per-item:** Any URI in `collection.items` may be downloaded via `GET /api/download?itemUri=…` (all roles, not only tracks).
- **Collection zip:** `GET /api/download/collection-zip?collectionUri=…` returns an archive of member masters (size caps enforced).

Collection entitlement checks membership in `collection.items` only — no `essential` filter.

### 4. Checkout guard

If a listing has `parentListing`, checkout and fulfillment require the **parent** listing to exist and be in an active (sale-allowed) state (`parentListingAllowsSale` in `fulfillCheckoutSession.ts` and `stripe.ts` checkout).

### 5. Upload → listings bridge

Publish accepts per-track `allowIndividualPurchase` intent (not a lexicon field). On successful inventory publish, an append-only `inventory_prefill_log` row records `collectionListingUri` and `individualPurchaseTrackUris` for the listings page shortcut.

### 6. Collection item page UX

**Purchased:** per-item download controls + collection zip button.

**Not purchased:** track list; buy affordances for the collection (if listed) and for tracks with active child listings (`parentListing` match).

## Constraints

| Rule | Enforcement |
|------|-------------|
| No `essential` in lexicon | `catalog.collection.json` |
| Child track sales | `parentListing` on listing |
| Parent must be active | Server checkout + fulfillment |

## Consequences

**Positive**

- Simpler collection model: everything in `items` ships together.
- Explicit parent/child listing graph for storefront and pause cascade.
- Zip download matches buyer expectation for album purchases.

**Negative / trade-offs**

- v5 alignment docs referencing `essential` are obsolete.
- Merchants must create collection listing before track singles with correct `parentListing`.
- In-memory zip assembly limits very large collections.

**Deferred**

- Server-side cascade pause API (client batch `putRecord` today).
