# ADR 002: Lexicon Schema, Placement, and License Templates

- **Status:** Accepted
- **Date:** 2026-04-03
- **Supersedes:**
  - `.alignment/260403-lexicon-support/NOTE_ON_LEXICON_PLACEMENT.md`
  - `.alignment/260403-lexicon-support/STACK_IMPLEMENTATION_PLAN.md`
  - `.alignment/260403-lexicon-support/LEXICON_DRAFT_V3.md`
  - `.alignment/260403-lexicon-support/LEXICON_DRAFT_V4.md`
  - `.alignment/260403-lexicon-support/LEXICON_DRAFT_V5.md`
  - `.alignment/260403-lexicon-support/26_4_3-license-templates.md`
- **Superseded by:** —
- **Relates to:** [ADR 000](000-bootstrap-architecture.md), [ADR 001](001-storefront-application-architecture.md)

## Context

[ADR 001](001-storefront-application-architecture.md) commits Bazaar to an AT Protocol
commerce surface: catalog, listings, licenses, and purchases as PDS records. The
client scaffold predating April 2026 used hand-rolled types, wrong NSIDs (e.g.
`…bazaar.collection` instead of `…catalog.collection`), and shapes that did not
match the evolving proposal.

The alignment session produced lexicon drafts v3 → v5, a monorepo placement
note, an implementation checklist, and fifteen `license.terms` templates. **v5
is canonical.** Earlier drafts are historical only.

The problem this ADR solves: **one authoritative lexicon source** that both
client and server import, served over the wire for external verifiers, with
license templates that conform to the same schemas.

## Decision

### Namespace and authority

- **Namespace:** `diamonds.whereditgo.bazaar.*`
- **Authority host (target):** `bazaar.whereditgo.diamonds`
- **Interim serving:** Hono exposes lexicons from the running app until domain
  authority is fully delegated.

### Canonical placement (`packages/shared`)

Lexicon JSON lives in `packages/shared/src/lexicons/` — **not** in
`packages/client` or `packages/server`.

| Convention | Rule |
| ---------- | ---- |
| One file per lexicon | Filename = trailing NSID segment (e.g. `catalog.listing.json`) |
| Full NSID | Stored in each file's `id` field |
| Cross-package imports | `@bazaar/shared` and `@bazaar/shared/lexicons` |
| TypeScript types | Derived from JSON (codegen optional); **JSON is canonical**, never hand-written types as source of truth |

**Lexicon set (v5):**

| File | NSID |
| ---- | ---- |
| `defs.json` | `diamonds.whereditgo.bazaar.defs` |
| `catalog.item.digital.json` | `…catalog.item.digital` |
| `catalog.item.physical.json` | `…catalog.item.physical` |
| `catalog.item.bundle.json` | `…catalog.item.bundle` |
| `catalog.collection.json` | `…catalog.collection` |
| `catalog.listing.json` | `…catalog.listing` |
| `catalog.recording.json` | `…catalog.recording` |
| `catalog.composition.json` | `…catalog.composition` *(v5 addition)* |
| `license.terms.json` | `…license.terms` |
| `purchase.receipt.json` | `…purchase.receipt` |
| `purchase.consent.json` | `…purchase.consent` *(v5 addition)* |
| `purchase.stock.json` | `…purchase.stock` |
| `purchase.fulfillment.json` | `…purchase.fulfillment` |
| `actor.merchant.json` | `…actor.merchant` *(alignment proposed `actor.profile`; merchant record is what shipped)* |

Supporting modules:

- `docs.ts` — imports all JSON; exports `lexicons` map keyed by NSID and
  `BAZAAR_LEXICON_DOCS`
- `validate.ts` — `validateBazaarRecord(collectionNsid, value)` via
  `@atproto/lexicon`
- `scripts/validate-lexicons.mjs` — CI gate: all docs load and `$ref` chains resolve

Turbo `dependsOn: ["^build"]` ensures `@bazaar/shared` builds before client and
server consumers.

### Lexicon serving

External resolution (and local dev) uses the ATProto lexicon GET shape:

```
GET /xrpc/com.atproto.lexicon.get?lexicon=<nsid>
```

Returns lexicon JSON or `{ error: "LexiconNotFound" }` (404). Mounted on the
main Hono app in `packages/server/src/index.ts`. Clients may bundle lexicons at
build time via `@bazaar/shared` — no runtime fetch required for validation UI.

### v5 schema decisions (carry forward)

These deltas from v4 define how commerce records relate:

**Listing is the commercial offer.** `catalog.listing` requires `licenseUri` and
`licenseGrantCid`. The listing's license governs point of sale. Item/collection
`defaultLicenseUri` is a **form default only** — not authoritative at checkout.

**Buyer identity is explicit.** `purchase.receipt` requires `buyerDid`. Receipt
`appSig` covers `SHA-256(purchasedAt:paymentRef:itemUri:listingCid:buyerDid)`.

**Consent is a first-class record.** `purchase.consent` is written to the buyer's
PDS at checkout. It names `buyerDid`, anchors `licenseGrantCid`, and links to the
receipt. Required for commercial and sync tiers; recommended for personal.
`appSig` on consent covers
`SHA-256(buyerDid:licenseGrantCid:receiptCid:consentedAt)`.

**Share-alike in license terms.** `license.terms#usageRestrictions` includes
`requiresShareAlike` for CC BY-SA variants. Informational only — enforcement is
off-chain.

**Self-issued identifiers.** `defs#bazaarIdentifier` supports `bazaar:rid:*`,
`bazaar:wid:*`, `bazaar:pid:*` — signed, timestamped assertions shadowing ISRC /
ISWC / UPC until formal registration. Optional `supersededByIsrc` etc. when
institutional IDs arrive.

**Digital file identity.** `catalog.item.digital` uses `fileChecksum`,
`fileCid`, `fileFormat` (not legacy `audio*` field names). Immutable file fields
change only via a **new record** with `supersedes` — file replacement is a
publishing act, not an in-place edit.

**Licensing UI directive.** The license management panel must surface three
states at all times: (1) licenses already on the artist PDS, (2) platform
templates as starting points, (3) explanatory context that terms are CID-locked
at purchase and past buyers keep the grant in effect. Upload flow must confirm
license at **listing creation**, not inherit silently from the item default.

### Field mutability (summary)

| Category | Examples | Change mechanism |
| -------- | -------- | -------------- |
| Cosmetic | description, artwork, genre | `putRecord` in place |
| External IDs | ISRC, ISWC, UPC | `putRecord` in place |
| Self-issued IDs | `bazaarRid`, `bazaarWid`, `bazaarPid` | `putRecord` in place |
| Collection membership | items, essential flag | `putRecord` on collection |
| License on listing | `licenseUri` | New `license.terms` + new listing |
| File identity | `fileCid`, `fileChecksum`, formats | New digital item via `supersedes` |
| Price / availability | `price`, `status`, schedule | New listing for material changes; minor toggles may update in place |

### Purchase and delivery model

| Scenario | Receipt `item` | Delivery |
| -------- | -------------- | -------- |
| Collection purchase | `catalog.collection` URI | Zip of `essential: true` member items |
| Standalone item | `catalog.item.digital` URI | That item's file |
| Collection entitlement check | Buyer receipts for collections | Resolve collection; match requested item URI in `essential: true` items |

`essential: false` items are artist-discretionary bonus content; lexicon records
existence; backend decides surfacing.

### Verification flow

Verifiers (and Bazaar internally) may reconstruct trust as:

1. Resolve `appDid` → public key from DID document
2. Verify receipt `appSig` over `purchasedAt:paymentRef:itemUri:listingCid:buyerDid`
3. Optionally confirm `paymentRef` with Stripe
4. Resolve `licenseGrantUri` + `licenseGrantCid` → terms at purchase time
5. Resolve item → `fileChecksum`; compare to served bytes
6. For collections, enumerate `essential: true` items covered
7. Optionally verify `bazaarRid` / `bazaarWid` sig against artist DID
8. Resolve `purchase.consent` on buyer PDS; for commercial/sync, absence is an
   evidentiary gap

### License templates (`packages/shared/src/license-templates/`)

Fifteen pre-authored `license.terms` payloads ship as JSON files plus a typed
registry (`registry.ts`). Exported via `@bazaar/shared/license-templates`.

**Two groups:**

| Group | Use | `checkoutConsentRequired` |
| ----- | --- | ------------------------- |
| Bazaar-native (10) | Paid, buyer-specific grants | `true` |
| Creative Commons (5) | Free / pay-what-you-want public grants | `false` |

Bazaar-native tiers include personal, commercial (master / derivatives), stem,
sync (master / publishing / full), broadcast, and mechanical. CC templates cover
BY, BY-NC, BY-NC-ND, BY-SA, BY-NC-SA.

**Template write behaviour:**

- On first use, dedupe by `title` + `version` + `tier` + `rightsType` on the
  artist PDS; reuse existing AT-URI if match found.
- Any artist modification → always write a new record (no dedupe).
- UI must **warn** (blocking warning, not hard error) when attaching a CC
  template to a priced listing — CC is a public grant; paid listings imply
  buyer-specific rights.

`createdAt` is omitted from template JSON; backend adds it at write time.

### Deprecation of client scaffold

After `@bazaar/shared` landed, client-local `lexicons.ts` and hand-rolled types
were replaced or thinned. All new record shapes and NSIDs must come from shared
JSON. Any data written under pre-v5 NSIDs or shapes is incompatible — treat as
migration-required, not drop-in.

## Consequences

### Positive

- **Single source of truth** for schemas across client, server, and external
  verifiers.
- **Listing-level license** closes the gap where item defaults could silently
  govern checkout.
- **CID-anchored grants** (`licenseGrantCid` on listing and receipt) make "terms
  at time of purchase" queryable and auditable.
- **Consent record** separates buyer affirmation from receipt economics.
- **Validate script** catches broken `$ref` chains before deploy.
- **Template registry** gives merchants v5-conformant starting points without
  authoring JSON by hand.

### Negative / trade-offs

- **Lexicon rigidity.** Schema changes require editing JSON, re-validating, and
  coordinating client/server cutover.
- **v5 is not backward compatible** with the original client scaffold NSIDs and
  fields.
- **Known gaps remain off-ledger** (see below) — the lexicon records intent; it
  does not enforce law, territory, PRO royalties, or share-alike downstream.
- **Codegen not mandatory yet.** Hand-maintained TS types in client may drift
  until lexicon codegen is wired.
- **`actor.profile` → `actor.merchant`** rename means alignment prose referencing
  `actor.profile` is stale; code and JSON use `actor.merchant`.

### Known gaps (documented, not closed by this ADR)

- Clickwrap UI enforcement — lexicon records consent; cannot prove UI showed terms
- Copyright ownership, tax, territory — off-chain / off-ledger
- No `appSig` key rotation or revocation mechanism yet
- Collection mutability can shift `essential` membership after purchase — snapshot
  entitlement semantics deferred
- `bazaar:*` identifiers are signed assertions, not court-defensible registration
- No exclusive-license expression beyond `maxPurchasesPerBuyer: 1` approximation
- Buyer ATProto login at checkout, download delivery, physical goods UI — still
  deferred per [ADR 001](001-storefront-application-architecture.md)

## Considered alternatives

- **Lexicons only in `packages/client`.** Rejected: server validation, webhook
  writes, and `com.atproto.lexicon.get` need the same docs; duplication guaranteed
  drift.
- **Hand-written TypeScript as canonical.** Rejected: ATProto tooling and external
  verifiers expect lexicon JSON; types should be derived.
- **Item-level license as authoritative.** Rejected in v5: listings are the
  commercial offer; same item may have personal vs commercial listings.
- **Receipt without `buyerDid`.** Rejected: implied identity via `appSig` only is
  not queryable; consent record design requires explicit buyer DID.
- **Skip `purchase.consent`.** Rejected for commercial/sync evidentiary chain;
  receipt alone does not capture buyer affirmative agreement to specific terms CID.

## Implementation status

As of this ADR, the stack plan has landed:

- `@bazaar/shared` with full v5 JSON set (14 lexicon files)
- `docs.ts`, `validate.ts`, `npm run lexicons:validate`
- Hono `com.atproto.lexicon.get`
- License template registry (15 templates)
- Client/server import from shared package

Follow-ups for later ADRs: lexicon codegen to `packages/shared/src/generated/`,
full `purchase.consent` write path at checkout, licensing three-state UI panel,
completeness score criteria per `itemClass`.
