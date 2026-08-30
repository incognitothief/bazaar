# ADR 0013: Key rotation and DID document v2

## Status

**Draft** — not yet accepted. Not listed in `docs/adr/README.md` until accepted.

Amends and partially supersedes [ADR 0011](0011-app-service-did-and-kid.md) (§5 verification, §6
rotation procedure, the single-key template shape).

## Date

2026-08-29

## Context

The 2026-08-29 remediation (see ADR 0011's remediation note) fixed the mechanical
spec-conformance problems in the storefront DID stack:

- `publicKeyMultibase` is now a conformant Multikey string (`p256-pub` multicodec varint
  `0x80 0x24` + compressed point, base58btc) via `@atproto/crypto` `formatMultikey`.
- `appSig` on `purchase.receipt` / `purchase.consent` is a compact low-S IEEE-P1363 signature
  (`packages/server/src/lib/atproto/sign.ts`), with a **temporary** DER-accepting fallback for
  pre-migration field receipts.
- `APP_SERVICE_*` env vars → `APP_MERCHANT_*`; `kid` fragment `app-key-YYYY-MM-DD` →
  `merchant-key-YYYY-MM-DD`.
- The served DID document no longer carries an empty `authentication`.

What is still **undesigned in practice**, and is the subject of this ADR:

1. The DID-document template (`packages/server/config/did-document.template.json`) holds exactly
   one key. Two string substitutions (`__APP_MERCHANT_KID__`, `__PUBLIC_KEY_MULTIBASE__`) in
   `loadServiceDidDocument()` cannot express the append-only multi-key `verificationMethod` that
   rotation requires.
2. Nothing consults the DID document at verification time. `packages/server/src/routes/download.ts`
   verifies `purchase.receipt#appSig` only against the key derived from `APP_MERCHANT_PRIVATE_KEY`
   (`appMerchantPublicKeyPemFromEnv()`). `kid` is written onto records but never used to select a
   key, and there is no path to verify a record signed by a retired key.
3. There is no `app_keys` registry (deferred in ADR 0011; the data-model half of the vault ticket
   `Tickets/2026-04-18 key rotation management hub.md`).
4. `diamonds.whereditgo.bazaar.actor.merchant` has never been examined against the planned
   `artistDid → sellerDid` generalization. It carries no seller-identity field at all today.

The vault documents `Documentation/merchant key management/26_4_17-key-rotation-strategy-v1.md`
and `26.4.18 Service DID & DID Document.md` describe a "retire, never remove" rotation model and
an `app_keys` table, but predate the current code and use stale names. This ADR is the canonical
version; those docs become the operator handbook (draft:
`Documentation/merchant key management/2026-08-29 Storefront key handbook (DRAFT).md`).

## Decision

### 1. DID document shape v2

Served at `GET /.well-known/did.json` (`packages/server/src/routes/wellKnown.ts`),
`application/did+ld+json`, `Cache-Control: public, max-age=3600`.

- **`verificationMethod`** — standard, **append-only**, one entry per non-revoked key:
  `{ id: "<APP_DID>#<kid>", type: "Multikey", controller: "<APP_DID>", publicKeyMultibase: "z…" }`.
  Entries are never edited or reordered. A key is removed **only** on confirmed compromise
  (§5b).
- **`assertionMethod`** — exactly one entry: the currently active key fragment.
- **`authentication`** — omitted (the storefront key signs records, it does not authenticate).
- **`diamonds.whereditgo.bazaar:keyHistory`** — a top-level, namespaced member carrying the
  lifecycle metadata that does not belong in `verificationMethod`:

  ```jsonc
  "diamonds.whereditgo.bazaar:keyHistory": [
    {
      "kid": "merchant-key-2026-04-17",
      "status": "retired",            // "active" | "retired" | "revoked"
      "activatedAt": "2026-04-17T00:00:00Z",
      "retiredAt": "2026-08-29T00:00:00Z",
      "prev": null,
      "next": "merchant-key-2026-08-29"
    },
    {
      "kid": "merchant-key-2026-08-29",
      "status": "active",
      "activatedAt": "2026-08-29T00:00:00Z",
      "retiredAt": null,
      "prev": "merchant-key-2026-04-17",
      "next": null
    }
  ]
  ```

  Ordered oldest → newest; `prev` / `next` make the chain explicit for consumers that walk it.
  A generic `did:web` + Multikey resolver ignores the unknown top-level member and still reads
  `verificationMethod` / `assertionMethod` correctly.

**Rationale for a namespaced array over per-entry extension properties on `verificationMethod`:**
keeps each `verificationMethod` entry byte-identical to what a generic Multikey library expects
(no unknown keys inside the entry), and keeps all lifecycle state in one auditable place that the
git history of the served document (or the `app_keys` table) can be diffed against.

### 2. Multi-key template assembly

Replace the two `String.replaceAll` substitutions in `loadServiceDidDocument()`
(`packages/server/src/lib/serviceDidDocument.ts`) with assembly from a list source (the
`app_keys` table, §3; env-only is the degenerate single-key case):

- `verificationMethod` ← every `app_keys` row where `status != 'revoked'`.
- `assertionMethod` ← the single `status = 'active'` row.
- `keyHistory` ← every row, ordered by `activated_at`, with `prev` / `next` computed.

The template file keeps a static `@context` / `id` skeleton; the three dynamic arrays are built
in code. The env single-key path (`APP_MERCHANT_KID` + `APP_MERCHANT_PUBLIC_MULTIBASE` or derived
from `APP_MERCHANT_PRIVATE_KEY`) still works when the table has one active row and no history.

### 3. `app_keys` ERP table

New table in `packages/server/src/db/schema.ts`, migration via `npm run db:generate -w
@bazaar/server` into `packages/server/drizzle/`:

| column | type | notes |
|---|---|---|
| `kid` | text PK | e.g. `merchant-key-2026-08-29` |
| `public_key_multibase` | text not null | conformant `z…` (matches `verificationMethod`) |
| `public_key_pem` | text not null | SPKI PEM, for `crypto.verify` without re-decoding |
| `status` | text not null | `active` \| `retired` \| `revoked` (check constraint) |
| `activated_at` | integer timestamp not null | |
| `retired_at` | integer timestamp | null unless retired/revoked |
| `notes` | text | operator reason for retirement/revocation |

Invariants: exactly one `active` row; rows are never deleted; `kid` immutable.

**Boot reconciliation** (`packages/server/src/index.ts` / a small `lib/merchantKeys.ts`):
- If `APP_MERCHANT_PRIVATE_KEY` + `APP_MERCHANT_KID` are set and no matching `active` row exists,
  insert one (derive multibase + PEM). This makes first boot and the current single-operator
  deployment self-seed with no manual SQL.
- Warn if the env active key disagrees with the table's `active` row.

Closes ADR 0011's deferred `app_keys` item and the data-model half of
`Tickets/2026-04-18 key rotation management hub.md`. A management UI stays out of scope.

### 4. Verification path

`verifyReceiptPayload` / `verifyConsentPayload` (`sign.ts`) currently take a single
`publicKeyPem`. Add a resolver that, given a record's optional `kid`:

1. If `kid` present and a non-revoked `app_keys` row matches → try that key first.
2. Else, or on failure → try every non-revoked key (`app_keys`, or `verificationMethod` from the
   resolved DID document for an offline/external verifier).
3. `appMerchantPublicKeyPemFromEnv()` becomes "the active key accessor", used as the fast path
   and as the fallback when the table is unavailable — behaviour never regresses below today's
   single-key check.

`download.ts` call sites (`appMerchantPublicKeyPemFromEnv()` at the two entitlement checks) switch
to the resolver. `@atproto/identity` `IdResolver` (already a dependency, see ADR 0012) resolves
our own `did:web` for the external-verifier shape.

### 5. Rotation procedures

**5a. Planned rotation**
1. `./scripts/gen-did.sh` → new keypair, `kid = merchant-key-<today>`.
2. `INSERT` the new key into `app_keys` as `active`; flip the previous `active` row to `retired`
   with `retired_at = now()`.
3. Set `APP_MERCHANT_PRIVATE_KEY` + `APP_MERCHANT_KID` to the new key (Fly secrets / `.env`).
4. Deploy. The served DID document now lists both keys in `verificationMethod`, the new one in
   `assertionMethod`, and both in `keyHistory` with the `prev`/`next` link. New records carry the
   new `kid`; old records still verify against the retired key.
5. Pre-flight (`curl /.well-known/did.json`) — see the handbook.

**5b. Emergency rotation (key compromise)**
1. Generate + activate a new key as in 5a steps 1–3.
2. `UPDATE app_keys SET status = 'revoked', retired_at = now(), notes = '<reason>'` for the
   compromised `kid`.
3. Deploy. The revoked key is dropped from `verificationMethod` and marked `revoked` in
   `keyHistory` (the only case a key leaves `verificationMethod`).
4. Accept that every `purchase.receipt` / `purchase.consent` / `bazaarIdentifier` signed with the
   revoked key now fails verification. Reissue receipts from the `payment_fulfillment` /
   fulfillment records where possible; notify affected buyers.

### 6. Transitional state (single resolution method target)

The DER-accepting fallback in `verifyCanonical` (`sign.ts`) and the DER signer left in
`bazaarIdentifiers.ts` exist only for records issued before this remediation. The **target state
is a single resolution method**: compact low-S IEEE-P1363, verified against a `keyHistory` /
`app_keys` key selected by `kid`.

Removal is tracked by
`bazaar-vault/Tickets/2026-08-29 Remove DER appSig fallback after field-receipt migration.md`.
It can be done once the operator has migrated the known field receipts (all self-issued) to the
new attestation structure. `bazaarIdentifiers` is deprecated wholesale (see §7) and its signer is
expected to be deleted rather than converted.

### 7. `actor.merchant` identity gap (surfaced, not resolved here)

Full write-up:
`bazaar-vault/Documentation/merchant key management/2026-08-29 actor.merchant identity gap.md`.

- **Today** `diamonds.whereditgo.bazaar.actor.merchant` (`packages/shared/src/lexicons/actor.merchant.json`,
  rkey `self`, ADR 0005) holds only storefront presentation: `displayName`, `description`,
  `storefrontUrl`, `avatarCid`, `bannerCid`, `createdAt`. Legal/contact fields live in server
  SQLite (`merchant_business_profile`), not the PDS record. There is **no** seller-identity field
  on the record — the seller is implied by the repo the record lives in (`ARTIST_DID` /
  `VITE_ARTIST_DID`).
- **Coming** `artistDid → sellerDid` is a planned generalization of the catalog + receipt model
  (catalog lexicons still use `artistDid`; receipts use `buyerDid` + `issuerScope`). Future
  receipt-issuance work covers the migration — this ADR deliberately does **not** redesign
  records now.
- **Open questions for that future pass** (no answer proposed here):
  - Should `actor.merchant` self-declare its `sellerDid` (an explicit alias of the repo DID that
    survives a handle/DID change)?
  - A seller kind (`individual` | `business` | `label`) — on the PDS record, or SQLite?
  - Should the record name the `appDid` (storefront `did:web`) that signs on its behalf, so a
    consumer verifying a receipt can cross-check the storefront from the seller's own repo
    without out-of-band knowledge?
  - What stays in `merchant_business_profile` vs. moves onto the PDS record?

The deliverable of this section is the framed gap, so the future migration is designed with it in
view.

## Constraints

| Rule | Value |
|---|---|
| Trust anchor | `appDid` (`did:web:bazaar.whereditgo.diamonds`) DID document |
| `kid` format | `merchant-key-YYYY-MM-DD` (max 64 chars) |
| `verificationMethod` | append-only; removal only on compromise |
| `assertionMethod` | exactly one (active) key |
| `authentication` | omitted |
| keyHistory member | `diamonds.whereditgo.bazaar:keyHistory` (namespaced, top-level, ordered) |
| Key registry | `app_keys` table (`packages/server/src/db/schema.ts`) |
| Signature format | compact low-S IEEE-P1363; DER accepted transitionally on verify only |
| DID route | `packages/server/src/routes/wellKnown.ts` |

## Consequences

**Positive**
- Rotation is expressible end-to-end: DID document, `keyHistory`, `app_keys`, verification.
- External verifiers can resolve and select keys with a standard resolver plus the documented
  `keyHistory` member — no Bazaar source needed.
- Single-operator deployment self-seeds `app_keys` on boot; no manual SQL for the common path.

**Negative / trade-offs**
- `loadServiceDidDocument()` gains a DB read (cached at startup like today; rotation needs a
  redeploy or a cache bust).
- The DER fallback and `bazaarIdentifiers` DER signer linger until field-receipt migration.
- `keyHistory` is a Bazaar-specific extension; consumers that want the chain must be told about
  it (handbook + `verify-receipt.ts`).

**Deferred**
- Key-rotation management UI.
- `kid` population on `bazaarIdentifier` instances (module is deprecated; likely moot).
- `actor.merchant` schema changes (§7) — future receipt-issuance pass.
- Removing the DER fallback (its own ticket).
