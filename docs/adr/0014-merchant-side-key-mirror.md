# ADR 0014: Merchant-side storefront key mirror (`actor.merchantKeys`)

## Status

Accepted (2026-08-30). Depends on
[ADR 0013](0013-key-rotation-and-did-document-v2.md) (the storefront `keyHistory`).

Implemented in `packages/shared/src/lexicons/actor.merchantKeys.json`,
`packages/server/src/lib/merchantKeys.ts` (`checkMerchantKeySync`, `diffMerchantKeyMirror`,
`expectedMerchantKeyRecords`, `readMerchantKeySyncStatus`),
`packages/server/src/routes/merchant.ts` (`/api/merchant/key-sync-status[/recheck]`),
`packages/client/src/hooks/useMerchantKeySync.ts`,
`packages/client/src/components/merchant/MerchantKeySyncBanner.tsx`.

## Date

2026-08-30

## Context

ADR 0013 publishes the storefront's signing-key lineage in the served `did:web` document as
`keyHistory`. A verifier checking a `purchase.receipt` today learns the storefront DID from the
receipt's `appDid` and must fetch `https://<storefront>/.well-known/did.json` to get the keys.

To let a verifier work from the **merchant's own repo** — and to keep a durable, PDS-hosted copy
of the key lineage that does not depend on the storefront being reachable — the key history
should also live on the merchant's PDS.

The obstacle: writes to a PDS need the merchant's OAuth session, and the Bazaar server does not
hold one on demand (buyer/merchant sessions are restorable but may be expired; a rotation is
exactly when nobody may be logged in). An earlier attempt embedded the history as fields on
`actor.merchant` and left the write path undefined.

## Decision

### 1. Collection

`diamonds.whereditgo.bazaar.actor.merchantKeys`, **one record per non-current storefront key**
(each `keyHistory` entry of the `appDid` DID document — retired and revoked keys). The **current**
signing key is *not* mirrored; it is always live in the DID document's `verificationMethod`.

- Record key: `any`. **rkey = the bare kid fragment** (`merchant-key-2026-04-17`), so
  `putRecord` is idempotent per key and a superseded key is a single `deleteRecord`.
- Record value mirrors a `keyHistory` entry: `appDid`, `id` (full DID URL), `type: "Multikey"`,
  `controller`, `publicKeyMultibase`, `supersededBy` (full DID URL), optional `revoked`, plus
  `syncedAt` (set by the client at write time).
- **The DID document is authoritative.** A verifier that finds a mirror record disagreeing with
  the live document trusts the document. The mirror is an availability/locality convenience, not
  a second root of trust.

### 2. Drift check — every deploy, server-side

`checkMerchantKeySync(db)` runs from `index.ts` immediately after `reconcileMerchantKeys(db)` —
the same lifecycle point where the `app_keys` ERP mirror is reconciled from the environment.
Best-effort, never blocks boot:

1. `ARTIST_DID` unset → store `{ inSync: null, status: "unconfigured" }`.
2. Resolve the merchant PDS (`getAgentForDid(ARTIST_DID)`, ADR 0012), `listRecords` on
   `actor.merchantKeys` (public read, no session).
3. `diffMerchantKeyMirror` compares by rkey against `expectedMerchantKeyRecords()`:
   `missing` (kid absent or a field differs), `extra` (rkey on the PDS not in the current
   history), `inSync = missing.length === 0 && extra.length === 0`.
4. Store the result as JSON in `meta` key `merchant_keys_sync`. PDS unreachable / resolve failure
   → `{ inSync: null, error }`.

### 3. Sync — merchant-triggered, from the panel

`GET /api/merchant/key-sync-status` (behind `merchantGuard`) returns the stored status **plus**
`expected: [{ rkey, record }]` — the exact records to write, so the client needs no key logic.
`POST /api/merchant/key-sync-status/recheck` re-runs the diff.

`MerchantKeySyncBanner` (rendered in `MerchantLayout`, above every merchant page) shows only when
`inSync === false`. **Synchronize** → for each `expected` entry `putRecord` (rkey = kid,
`syncedAt` = now); for each `extra` rkey `deleteRecord`; then `recheck`. Writes go through the
merchant's live OAuth session, so a fresh session is captured exactly at key turnover — which is
the point.

### 4. OAuth scope

`bazaarRepoOAuthScopes()` gains `repo:…actor.merchantKeys?action={create,update,delete}`.
`buildOAuthScopeString()` (the client-metadata superset) picks these up. **Merchants must
re-authenticate** after this change; the banner detects an auth/scope error on sync and says so.

## Constraints

| Rule | Value |
|---|---|
| Collection | `diamonds.whereditgo.bazaar.actor.merchantKeys` |
| rkey | the bare kid fragment; lexicon key type `any` |
| Records | one per non-current key (`keyHistory` entry); current key not mirrored |
| Authority | the `appDid` DID document — the mirror never overrides it |
| Drift check | `checkMerchantKeySync(db)` on every boot, result in `meta.merchant_keys_sync` |
| Sync trigger | merchant, from `MerchantKeySyncBanner`, using their OAuth session |
| Endpoints | `GET/POST /api/merchant/key-sync-status[/recheck]`, behind `merchantGuard` |

## Consequences

**Positive**
- The key lineage is durably on the merchant's PDS; verifiers can work from the merchant repo.
- The write happens with a real, fresh merchant session — no server-held-session fragility.
- The check reuses the existing boot reconciliation point and the `meta` table.

**Negative / trade-offs**
- The mirror is only as fresh as the merchant's last visit to the panel after a rotation.
  Between a rotation and the sync, `inSync` is `false` and verifiers should prefer the live DID
  document (which is always correct).
- One extra best-effort HTTP call at boot (`listRecords` to the merchant PDS).
- Scope change forces a merchant re-auth.

**Deferred**
- Automatic / server-pushed sync (needs a durable session or a background sweep).
- Multi-merchant deployments — the check assumes the single `ARTIST_DID`.
- Mirroring the current key.
- `verify-receipt.ts` / consumers actually reading `actor.merchantKeys` (tracked by the finalize
  ticket alongside the `keyHistory` walk).
