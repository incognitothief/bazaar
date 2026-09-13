# ADR 0015: storefront/merchant terminology split

## Status

Accepted.

## Date

2026-09-07

## Context

Two distinct DIDs were both informally called "merchant" in different parts of the codebase,
which had started to actively collide:

1. **The signing/service identity** (`APP_DID`) — a `did:web`, holds the keyring
   (`APP_MERCHANT_PRIVATE_KEY` / `_KID` / `_KEY_HISTORY` / `_PUBLIC_MULTIBASE`), signs
   `purchase.receipt#appSig` / `purchase.consent#appSig`, and is served at
   `/.well-known/did.json`. Whoever self-hosts Bazaar generates this themselves.
2. **The catalog/seller identity** (`ARTIST_DID`) — a portable ATProto DID (typically `did:plc`),
   hosts `catalog.item` / `catalog.product` / `actor.merchant` (the storefront's own
   "you are a merchant" onboarding record), and gates the merchant-dashboard login
   (`merchantGuard` in `routes/merchant.ts`).

`merchantKeys.ts` named the *signing* identity's keyring "merchant" (`getMerchantKeys()`,
`merchantDid()` returning `APP_DID`, `APP_MERCHANT_*` env vars) — the opposite of what
`actor.merchant` already meant. `purchase.receipt.issuerScope` ("DID of the artist/storefront
this receipt was issued under") was populated from `item?.artistDid ?? ARTIST_DID`, but the
current unified `catalog.item` lexicon has no `artistDid` field (it has `sellerDid` — see ADR
0013 §7's flagged `artistDid → sellerDid` gap) — so `issuerScope` silently fell through to the
env var on every unified-item purchase, working only by accident in a single-seller deployment.

Bazaar has exactly one live production instance (this deployment), and a key rotation has
already happened, so this is a hard cut rather than a dual-name migration: no legacy-field
fallback is being added for `appDid` / `issuerScope` on existing receipts.

## Decision

### Naming

| Concept | Was | Becomes |
|---|---|---|
| Signing/service identity (keyring, DID document, `/.well-known/did.json`) | `APP_DID` | `STOREFRONT_DID` |
| Catalog/seller identity (`actor.merchant`, `merchantGuard`, catalog ownership) | `ARTIST_DID` | `MERCHANT_DID` |

"Storefront" was already the word used throughout ADR-0013 and code comments for the signing
identity — promoting it to the actual identifier name costs nothing and is whitelabel-safe
(unlike a literal `BAZAAR_DID`, which would hardcode this project's own brand into a
self-hostable app's core identity naming).

### Lexicon changes (breaking)

- `purchase.receipt` / `purchase.consent`:
  - `appDid` → `storefrontDid` ("DID of the storefront that issued this receipt")
  - `issuerScope` → `merchantDid` ("DID of the merchant this receipt was issued under")
  - `kid` format: `merchant-key-{YYYY-MM-DD}` → `storefront-key-{YYYY-MM-DD}` (hint only,
    verifiers still cryptographically verify and fall back to trying all non-revoked keys)
- `actor.merchantKeys` → **`actor.storefrontKeys`**: this collection mirrors the storefront's
  own key history into the merchant's PDS (for verifier convenience, per ADR 0014) — its
  *content* is storefront keys, so keeping "merchant" in the NSID would reintroduce the same
  collision. Its `appDid` field → `storefrontDid`. This collection is a zero-authority cache
  (ADR-0013 §3); after this deploy, resync it from the merchant panel — old records under the
  retired `actor.merchantKeys` NSID are simply orphaned, not migrated.
- `purchase.receipt.issuerScope`'s source: `item?.artistDid` (a field that doesn't exist on the
  unified `catalog.item`) → `item?.sellerDid ?? process.env.MERCHANT_DID`.

### Environment variables

`APP_DID` → `STOREFRONT_DID`; `APP_MERCHANT_PRIVATE_KEY` / `_KID` / `_PUBLIC_MULTIBASE` /
`_KEY_HISTORY` → `STOREFRONT_PRIVATE_KEY` / `_KID` / `_PUBLIC_MULTIBASE` / `_KEY_HISTORY`;
`ARTIST_DID` → `MERCHANT_DID`; client-side `VITE_APP_DID` → `VITE_STOREFRONT_DID`,
`VITE_ARTIST_DID` → `VITE_MERCHANT_DID`.

### Code

`packages/server/src/lib/merchantKeys.ts` → `storefrontKeys.ts`: `MerchantKey`/`MerchantKeySet`
→ `StorefrontKey`/`StorefrontKeySet`, `merchantDid()` → `storefrontDid()`, `getMerchantKeys()`
→ `getStorefrontKeys()`, `reconcileMerchantKeys`/`checkMerchantKeySync`/
`expectedMerchantKeyRecords`/`diffMerchantKeyMirror`/`readMerchantKeySyncStatus` → the
`Storefront`-prefixed equivalents. `MerchantKeySyncStatus.artistDid` → `.merchantDid` (it's the
repo DID the mirror is checked against, i.e. `MERCHANT_DID`). `sign.ts`:
`appMerchantKidFromEnv`/`appMerchantPublicKeyPemFromEnv`/`normalizeAppMerchantPrivateKey` →
`storefrontKidFromEnv`/`storefrontPublicKeyPemFromEnv`/`normalizeStorefrontPrivateKey`.

## Consequences

**Positive**
- `MERCHANT_DID` now backs the concept `actor.merchant` already named — no more two DIDs
  sharing one informal label with opposite referents.
- `STOREFRONT_DID` is brand-neutral, matching the language already used in prose throughout
  ADR-0013 — safe for a future whitelabeled deployment.
- `purchase.receipt.merchantDid` is now sourced from the same field (`sellerDid`) that
  `merchantGuard` and catalog ownership already use, closing the accidental-single-tenant bug.

**Negative / trade-offs**
- Breaking change: any external verifier or tooling reading `purchase.receipt.appDid` /
  `.issuerScope` (e.g. a reference verifier resolving the signer DID) must be updated to read
  `storefrontDid` / `merchantDid` instead. No dual-field fallback is provided — accepted because
  this deployment is the sole issuer and the fields are only consumed externally in practice
  (Bazaar's own internal verification in `routes/download.ts` never read `appDid` to begin with).
- `actor.storefrontKeys` starts empty under the new NSID; the merchant panel's key-sync check
  will report drift until the next manual resync.
- Historical ADRs (0005, 0011, 0012, 0013, 0014) still refer to `APP_DID` / `ARTIST_DID` /
  `actor.merchantKeys` as those were the terms in effect at the time — they are not rewritten;
  this ADR is the terminology source of truth going forward.

**Deferred**
- The legacy per-type catalog lexicons (`catalog.item.digital`, `catalog.item.physical`,
  `catalog.collection`) still use `artistDid` and are separately marked deprecated — not touched
  here.
- Whether `catalog.item`/`catalog.product`'s `sellerDid` field itself should also become
  `merchantDid` for full naming consistency is an open question for a future pass.
