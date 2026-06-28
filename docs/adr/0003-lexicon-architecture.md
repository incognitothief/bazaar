# ADR 0003: Lexicon architecture and commerce data model

## Status

Accepted

## Date

2026-04-03

## Context

Bazaar records catalog, licensing, and purchase data on ATProto. Lexicon definitions must be a single source of truth for client, server, and external verifiers. The v5 proposal establishes listing-level licensing, buyer consent records, and signed purchase attestations.

## Decision

### 1. Package placement

All lexicon JSON lives in `packages/shared/src/lexicons/`, one file per NSID (filename = trailing segment, e.g. `catalog.listing.json`). The full NSID is the `id` field inside each file.

`packages/shared/src/lexicons/docs.ts` imports every JSON file and exports:

- `lexicons` — `Record<string, LexiconDoc>` keyed by NSID
- `BAZAAR_LEXICON_DOCS`, `BAZAAR_LEXICON_IDS`

`packages/shared/src/lexicons/validate.ts` exposes `validateBazaarRecord(collectionNsid, value)` via `@atproto/lexicon`.

Neither `packages/client` nor `packages/server` owns lexicon JSON directly.

### 2. Namespace and authority

All record types use NSIDs under `diamonds.whereditgo.bazaar.*`. Authority host for lexicon resolution: `bazaar.whereditgo.diamonds`.

Client code references collection NSIDs via `packages/client/src/lib/atproto/ns.ts` (`BAZAAR_COLLECTION`).

### 3. Lexicon discovery endpoint

The Hono app serves:

```
GET /xrpc/com.atproto.lexicon.get?lexicon=<nsid>
```

Returns the lexicon document JSON or `{ error: "LexiconNotFound" }` with HTTP 404.

### 4. Commerce record model (v5)

**Catalog** — `catalog.item.digital`, `catalog.item.physical`, `catalog.item.bundle`, `catalog.collection`, `catalog.listing`, `catalog.recording`, `catalog.composition`.

**Licensing** — `license.terms`; shared templates in `packages/shared/src/license-templates/` (Bazaar-native + Creative Commons starters).

**Purchase** — `purchase.receipt`, `purchase.consent`, `purchase.stock`, `purchase.fulfillment`.

**Actor** — `actor.merchant` (storefront profile; see ADR TBD for rename from `actor.profile`).

**Shared defs** — `defs.json` including `#money`, `#itemRef`, `#bazaarIdentifier`, `#address`, etc.

### 5. Listing-level license

The listing is the commercial offer. `catalog.listing` requires `licenseUri` and `licenseGrantCid`. An item or collection `defaultLicenseUri` pre-fills upload forms only; the listing creation step must record explicit license fields. Different listings for the same item may reference different `license.terms` records.

### 6. Purchase attestation

`purchase.receipt` requires `buyerDid`. `appSig` covers `SHA-256(purchasedAt:paymentRef:item.uri:listingCid:buyerDid)`.

`purchase.consent` is written to the buyer's PDS at checkout, naming `buyerDid` and `licenseGrantCid`. Required for commercial/sync tiers; recommended for personal use. Consent `appSig` covers `SHA-256(buyerDid:licenseGrantCid:receiptCid:consentedAt)`.

Both records support optional `kid` for app-service key rotation (see ADR TBD).

### 7. Digital item file identity

`catalog.item.digital` uses `fileCid`, `fileChecksum`, and `fileFormat`. File identity changes require a new item record (supersedes chain), not in-place mutation.

### 8. TypeScript types

Hand-maintained types in `packages/client/src/types/lexicons.ts` mirror the JSON schemas. JSON in `packages/shared` is canonical; types are updated when lexicons change. Lexicon codegen remains optional future work.

### 9. Quality gate

`npm run lexicons:validate` at repo root validates all JSON files and cross-lexicon `$ref` resolution.

## Constraints

| Rule | Value |
|------|-------|
| Namespace | `diamonds.whereditgo.bazaar` |
| Canonical lexicon path | `packages/shared/src/lexicons/` |
| Listing license fields | `licenseUri` + `licenseGrantCid` required |
| Receipt buyer field | `buyerDid` required |

## Consequences

**Positive**

- Single import surface prevents client/server schema drift.
- `com.atproto.lexicon.get` enables third-party verification without repo access.
- `licenseGrantCid` on listings anchors terms at point of sale.

**Negative / trade-offs**

- Hand-maintained TS types can lag JSON changes without CI discipline.
- v5 cutover invalidated pre-shared client scaffold NSIDs and field names.
- Full v5 purchase/delivery narrative in the proposal assumes collection `essential` flags; those were removed post-implementation (see ADR TBD).

**Deferred**

- Official lexicon codegen → generated types in `packages/shared`.
- `purchase.stock` / `purchase.fulfillment` runtime flows (physical goods).
- Full licensing UI three-state panel directive (partially implemented in license gallery).
