# ADR 0005: Merchant actor record

## Status

Accepted

## Date

2026-04-04

## Context

Bazaar stores storefront presentation data on the merchant's PDS. The initial scaffold used NSID `diamonds.whereditgo.bazaar.actor.profile`, which collided with the generic notion of an ATProto profile. The record is merchant-specific storefront metadata, not `app.bsky.actor.profile`.

## Decision

### 1. Lexicon NSID

Use `diamonds.whereditgo.bazaar.actor.merchant` (file: `packages/shared/src/lexicons/actor.merchant.json`).

Record key: `literal:self` — at most one merchant record per repo (`at://{did}/…actor.merchant/self`).

### 2. Fields

| Field | Role |
|-------|------|
| `displayName` | Required storefront name |
| `description` | Optional bio / tagline |
| `storefrontUrl` | Optional external URL |
| `avatarCid`, `bannerCid` | Optional blob references |
| `createdAt` | Set on first create |

### 3. OAuth scopes

Merchant OAuth includes `repo:{did}:diamonds.whereditgo.bazaar.actor.merchant` create and update (`packages/server/src/lib/atproto/oauth-scope.ts`). Scopes must stay in sync with `BAZAAR_COLLECTION.actorMerchant` in the client.

### 4. Client API

- **Write:** `createActorMerchant` / `putActorMerchant` in `packages/client/src/lib/atproto/records.ts` (Settings page).
- **Read (public):** `useActorMerchantProfile(artistDid)` — `listRecords` on `VITE_ARTIST_DID` repo; used on homepage, item detail, header.

### 5. Distinction from business profile

Legal and contact fields for terms/refunds (`businessName`, `businessState`, `businessEmail`) are **not** on `actor.merchant`. They are stored in server SQLite and exposed via `/api/merchant/business-profile` and `/api/public/business-profile`. Optional env override: `BUSINESS_EMAIL`.

## Constraints

| Rule | Value |
|------|-------|
| Collection NSID | `diamonds.whereditgo.bazaar.actor.merchant` |
| Record rkey | `self` |
| Store owner DID | `VITE_ARTIST_DID` / `ARTIST_DID` for public reads |

## Consequences

**Positive**

- Clear vocabulary: "merchant" = Bazaar storefront actor, not Bluesky profile.
- No cross-lexicon `$ref` breakage (nothing referenced `actor.profile`).

**Negative / trade-offs**

- Breaking NSID change: pre-cutover `actor.profile` records are not read.
- Merchants must re-authenticate after scope updates.
- Two "profile" concepts in the product (PDS merchant vs SQLite business) require documentation for operators.

**Deferred**

- Automated PDS migration from `actor.profile` to `actor.merchant`.
- Alignment doc updates still referencing `actor.profile` in older folders.
