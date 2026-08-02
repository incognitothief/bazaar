# ADR 0011: App service DID and signing key hints (`kid`)

## Status

Accepted

## Date

2026-04-18

## Context

Bazaar signs purchase receipts, purchase consent records, and self-issued identifiers (`bazaarRid`, `bazaarWid`, `bazaarPid`) with the **app service keypair** (`APP_SERVICE_PRIVATE_KEY`), not the artist's ATProto key. Third parties verify signatures by resolving `appDid` to a DID document with published verification keys.

Without a key identifier on signed records, key rotation forces verifiers to try every historical key in the DID document. Receipts and consent on buyer PDSs are immutable — they cannot be updated after rotation.

## Decision

### 1. Service DID document

`APP_DID` should match the `id` in the served DID document (e.g. `did:web:bazaar.whereditgo.diamonds`).

Static template: `packages/server/config/did-document.template.json`, substituted at startup via `loadServiceDidDocument()` (`APP_SERVICE_KID`, `APP_SERVICE_PUBLIC_MULTIBASE` or derived from private key PEM).

Served at:

```
GET /.well-known/did.json
```

`Content-Type: application/did+ld+json`, `Cache-Control: public, max-age=3600`.

`verificationMethod` is **append-only** (retired keys stay for historical verification). `assertionMethod` references only the **active** key fragment.

### 2. `APP_SERVICE_KID`

Environment variable naming the active key fragment (e.g. `app-key-2026-04-17`). Must match the `verificationMethod` id suffix in the DID document.

If unset in production, server logs a startup warning; signing continues but new records omit `kid`.

### 3. Lexicon `kid` field (optional)

Added to:

- `defs#bazaarIdentifier` (inherited by `bazaarRid`, `bazaarWid`, `bazaarPid`)
- `purchase.receipt`
- `purchase.consent`

`kid` is a **hint** for verifiers to select the correct key from `verificationMethod`; cryptographic verification still required; fallback to trying all non-revoked keys if hint fails.

Lexicon descriptions updated to document app-service signing (not artist keypair) and canonical `appSig` payloads.

### 4. Runtime signing

When `APP_SERVICE_KID` is set:

- **Receipt and consent** — `fulfillCheckoutSession` includes `kid` on newly written `purchase.receipt` and `purchase.consent` records.

**bazaar identifiers** — lexicon supports `kid`; population on `bazaarRid`/`bazaarWid`/`bazaarPid` at publish may lag receipt/consent (extend `buildBazaarRid` et al. when rotation coverage is needed).

### 5. Verification

Download and entitlement paths verify `purchase.receipt#appSig` using the app public key. Prefer `kid` when present; otherwise exhaustive key search.

### 6. Key rotation procedure (operator)

1. Generate new keypair (`scripts/gen-did.sh` / `gen-did.ts`).
2. Append new `verificationMethod` to DID template; update `assertionMethod` to new fragment.
3. Set `APP_SERVICE_PRIVATE_KEY` and `APP_SERVICE_KID` on Fly (or env).
4. Deploy — new records carry new `kid`; old records remain verifiable via retained keys.

## Constraints

| Rule | Value |
|------|-------|
| Trust anchor | `appDid` DID document |
| `kid` format | `app-key-YYYY-MM-DD` (max 64 chars) |
| DID route | `packages/server/src/routes/wellKnown.ts` |

## Consequences

**Positive**

- External verifiers can resolve keys without Bazaar source code.
- `kid` makes post-rotation verification practical for immutable buyer records.
- Lexicon text matches implementation (app signs, not artist).

**Negative / trade-offs**

- Operators must keep DID document, env PEM, and `APP_SERVICE_KID` in sync.
- Records without `kid` (pre-migration or missing env) require slower verification.
- `did:web` requires correct DNS/host routing to the Bazaar server.

**Deferred**

- `kid` on all newly minted `bazaarIdentifier` instances at publish time.
- `app_keys` SQLite table from key-rotation strategy doc (env-sourced kid today).
