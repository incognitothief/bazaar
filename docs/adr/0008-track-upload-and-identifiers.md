# ADR 0008: Track release upload and self-issued identifiers

## Status

Accepted

## Date

2026-04-05

## Context

Merchants upload audio releases as collections with per-track rights metadata. Bytes upload through inventory sessions (ADR 0007); PDS records are written only on explicit publish. Institutional IDs (ISRC, ISWC, UPC) are often missing at upload time; Bazaar provides self-issued `bazaarRid`, `bazaarWid`, and `bazaarPid` identifiers signed by the app service.

## Decision

### 1. Primary upload surface

**`UploadTracksPage`** (`/merchant/upload/tracks`) is the active flow: four steps (Release → Tracks & files → License → Review & publish), backed by `inventory_upload_session` and `POST …/publish`.

**`UploadDigitalPage`** remains a legacy fallback. Do not remove it; avoid large refactors there while iterating on the tracks flow unless explicitly scoped.

Scope: **tracks** and collection releases only — not all `catalog.item.digital` item classes on this page.

### 2. Publish boundary

No PDS catalog records until the merchant confirms review and publish succeeds. Publish runs server-side (`packages/server/src/routes/inventory.ts`), writing:

- `catalog.item.digital` per track
- `catalog.composition` (Path A — new composition only)
- `catalog.recording` per track
- `catalog.collection` wrapping the release
- `bazaarPid` via follow-up `putRecord` on the collection

**No `catalog.listing`** in this flow — listings are created separately at `/merchant/listings`.

### 3. Composition assignment

Per track, **Path A (new):** full composition fields; server mints `bazaarWid` and writes `catalog.composition`.

**Path B (existing):** link `recording.songMetaUri` to an existing composition; copy `bazaarWid`; skip composition create. Editing composition fields after linking switches to Path A (new record).

### 4. Self-issued identifiers

Implemented in `packages/server/src/lib/bazaarIdentifiers.ts`; exposed as `POST /api/identifiers/{rid,wid,pid}`.

All signatures use **`APP_SERVICE_PRIVATE_KEY`** (not the artist OAuth key). Trust chain: artist granted OAuth write scope → app signed identifier → record on artist PDS.

| Field | When generated |
|-------|----------------|
| `bazaarRid` | Per digital item at publish (binds `fileCid` + `fileChecksum`) |
| `bazaarWid` | Per new composition at publish |
| `bazaarPid` | After collection record exists (requires `collectionUri`) |

Publish requires identifiers to be configured; otherwise `identifiers_unconfigured`.

### 5. Completeness score

Client-side score on the review step is **advisory** — it lists missing optional metadata but does not block publish (required fields still enforced by step validation and server draft checks).

### 6. License step

Uses saved vs template license selection (ADR 0006); `licenseUri` + `licenseGrantCid` required in publish draft.

## Constraints

| Rule | Value |
|------|-------|
| Active route | `/merchant/upload/tracks` |
| Publish endpoint | `POST /api/inventory/sessions/:id/publish` |
| Identifier signing | App service PEM |
| Listing creation | Out of scope for upload |

## Consequences

**Positive**

- Collection-first model matches storefront display (albums/EPs/singles).
- File-bound `bazaarRid` gives pre-ISRC provenance.
- Server publish centralizes identifier minting and record ordering.

**Negative / trade-offs**

- App-signed identifiers are weaker than artist keypair signatures; see ADR 0011 for DID resolution and `kid`.
- Two upload pages increase maintenance surface.
- PLAN-v2 additional-material and strict completeness gating were not fully adopted.

**Deferred**

- Client-side identifier signing via browser crypto.
- Additional material rows (video, PDF) on tracks page.
- `POST /api/license/resolve` server helper (client/find path used instead).
