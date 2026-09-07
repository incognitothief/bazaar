# ADR 0013: Key rotation and DID document v2

## Status

Accepted (2026-08-30).

Implemented in `lib/merchantKeys.ts`, `lib/serviceDidDocument.ts`, `routes/wellKnown.ts`,
`routes/download.ts`, `db/schema.ts` + `drizzle/0008_app_keys.sql`, `scripts/rotate-did.{sh,ts}`,
`APP_MERCHANT_KEY_HISTORY` in `.env.example`.

Supersedes parts of [ADR 0011](0011-app-service-did-and-kid.md): its single-key template (§1), the
"`verificationMethod` is append-only, retired keys stay in it" rule (§1, §6), verification (§5),
and the rotation procedure (§6). Under this ADR a retired key **leaves** `verificationMethod` and
lives on only in `keyHistory`.

## Date

2026-08-29

## Context

The 2026-08-29 remediation (see ADR 0011's remediation note) fixed the mechanical
spec-conformance problems in the storefront DID stack:

- `publicKeyMultibase` / `did:key` now go through `@atproto/crypto` (`p256-pub` multicodec varint
  `0x80 0x24` + compressed point, base58btc).
- `appSig` on `purchase.receipt` / `purchase.consent` is a compact low-S IEEE-P1363 signature
  (`packages/server/src/lib/atproto/sign.ts`), with a **temporary** DER-accepting fallback for
  pre-migration field receipts.
- `APP_SERVICE_*` → `APP_MERCHANT_*`; `kid` fragment `app-key-…` → `merchant-key-…`.
- The served DID document dropped the empty `authentication` array.

What is still undesigned in practice, and is the subject of this ADR:

1. **One-key template.** `packages/server/config/did-document.template.json` +
   `loadServiceDidDocument()` express exactly one key via two string substitutions
   (`__APP_MERCHANT_KID__`, `__PUBLIC_KEY_MULTIBASE__`). Rotation needs a multi-key document plus a
   history.
2. **Nothing consults the document at verification time.** `packages/server/src/routes/download.ts`
   verifies `purchase.receipt#appSig` only against the key derived from `APP_MERCHANT_PRIVATE_KEY`.
   `kid` is written onto records but never used; a record signed by a rotated-out key cannot be
   verified.
3. **No key registry.** Deferred in ADR 0011; the data-model half of
   `Tickets/2026-04-18 key rotation management hub.md`.
4. **`actor.merchant` vs `artistDid → sellerDid`.** Never examined; §7 frames it, does not resolve
   it.

### Design constraints that shaped this ADR

- **Turnkey, self-hostable, many independent operators.** No private keys in source control. No
  DID-document state that only a bespoke admin UI or a maintenance tunnel can edit.
- **CI/CD-portable.** Deploys run from GitHub Actions where a gitignored config file would be
  absent — so operator-supplied key material must travel as environment variables / CI secrets,
  not files.
- **Revocation is a hard action.** Timing is unreliable across a distributed system, so no
  timestamp is load-bearing in any verification decision — revocation is a boolean state.

## Decision

### 1. DID document shape v2

Served at `GET /.well-known/did.json` (`packages/server/src/routes/wellKnown.ts`),
`Content-Type: application/did+ld+json`, `Cache-Control: public, max-age=3600`.

#### 1a. Key lifecycle

State is **derived from where a key appears** — there is no `status` field in the document.

| state | in `verificationMethod` | in `assertionMethod` | in `keyHistory` |
|---|:--:|:--:|:--:|
| **current** — signs new records | ✓ | ✓ | ✗ |
| **retired** — rotated out, still trusted for its historical records | ✓ | ✗ | ✓ |
| **revoked** — compromised, hard-rejected | ✗ | ✗ | ✓ + `revoked: true` |

- `verificationMethod` — the current key **plus every non-revoked key**, as standard `Multikey`
  entries. A generic `did:web` resolver can verify records signed by any of them (current or
  retired) with no Bazaar knowledge.
- `assertionMethod` — the current key, only.
- `keyHistory` — **every** non-current key (retired and revoked alike), oldest → newest,
  forward-linked by `supersededBy` (a **full DID URL**); the tail entry's `supersededBy` is the
  current key's `id`. Non-revoked entries are duplicated in `verificationMethod`; `keyHistory`
  additionally carries the chain and the revocation tombstones.
- **Retirement** = the key drops out of `assertionMethod` (no longer signs) but stays in
  `verificationMethod` and `keyHistory`.
- **Revocation** = `revoked: true` on the `keyHistory` entry. Optional boolean, no timestamp. The
  key is removed from `verificationMethod`; every verifier rejects everything it signed.

`keyHistory` entry:

```jsonc
{
  "id": "did:web:bazaar.whereditgo.diamonds#merchant-key-2026-04-17",   // required — full DID URL
  "type": "Multikey",                                                   // required
  "controller": "did:web:bazaar.whereditgo.diamonds",                   // required — the document id
  "publicKeyMultibase": "z…",                                           // required
  "supersededBy": "did:web:bazaar.whereditgo.diamonds#merchant-key-2026-08-29",  // required — full DID URL
  "revoked": true                                                        // optional — hard revoke
}
```

Each entry is a complete Multikey verification method (`id`, `type`, `controller`,
`publicKeyMultibase`) plus `supersededBy` and the optional `revoked` — so a consumer can hand a
`keyHistory` entry straight to a Multikey verifier.

#### 1b. `@context` (hosted URL)

Only `keyHistory` and the two Bazaar-specific terms need declaring — `id`, `type`, `controller`,
`publicKeyMultibase` come from the DID-core + Multikey contexts. Term definitions live in a
**hosted JSON-LD context document** at a fixed project URL (every deployment also serves a copy):

```
GET /ns/v1
→ https://bazaar.whereditgo.diamonds/ns/v1
Content-Type: application/ld+json
```

```jsonc
{
  "@context": {
    "keyHistory":   { "@id": "https://bazaar.whereditgo.diamonds/ns#keyHistory", "@container": "@list" },
    "supersededBy": { "@id": "https://bazaar.whereditgo.diamonds/ns#supersededBy", "@type": "@id" },
    "revoked":      { "@id": "https://bazaar.whereditgo.diamonds/ns#revoked",
                      "@type": "http://www.w3.org/2001/XMLSchema#boolean" }
  }
}
```

The DID document's `@context` array is **string-only** (no inline objects — ATCute / Bluesky DID
parsers reject non-string entries; DID Core permits objects, but ecosystem parsers often do not):

```jsonc
"@context": [
  "https://www.w3.org/ns/did/v1",
  "https://w3id.org/security/multikey/v1",
  "https://bazaar.whereditgo.diamonds/ns/v1"
]
```

`@container: "@list"` preserves chain order; `"@type": "@id"` makes `supersededBy` a proper node
link (hence the full-DID-URL values); `revoked` is explicitly typed `xsd:boolean`. The IRI
namespace
`https://bazaar.whereditgo.diamonds/ns#` is a **fixed Bazaar-project vocabulary URI**, identical
for every deployment regardless of the operator's own `did:web` host. Version the path (`/ns/v1`);
breaking term changes get `/ns/v2` and a DID `@context` bump.

#### 1c. Full example

```jsonc
{
  "@context": [ /* …as 1b… */ ],
  "id": "did:web:bazaar.whereditgo.diamonds",
  "verificationMethod": [
    { "id": "did:web:bazaar.whereditgo.diamonds#merchant-key-2026-08-29", "type": "Multikey",
      "controller": "did:web:bazaar.whereditgo.diamonds", "publicKeyMultibase": "z…current…" },
    { "id": "did:web:bazaar.whereditgo.diamonds#merchant-key-2026-04-17", "type": "Multikey",
      "controller": "did:web:bazaar.whereditgo.diamonds", "publicKeyMultibase": "z…retired…" }
  ],
  "assertionMethod": ["did:web:bazaar.whereditgo.diamonds#merchant-key-2026-08-29"],
  "keyHistory": [
    { "id": "did:web:bazaar.whereditgo.diamonds#merchant-key-2026-01-10", "type": "Multikey",
      "controller": "did:web:bazaar.whereditgo.diamonds", "publicKeyMultibase": "z…", "revoked": true,
      "supersededBy": "did:web:bazaar.whereditgo.diamonds#merchant-key-2026-04-17" },
    { "id": "did:web:bazaar.whereditgo.diamonds#merchant-key-2026-04-17", "type": "Multikey",
      "controller": "did:web:bazaar.whereditgo.diamonds", "publicKeyMultibase": "z…retired…",
      "supersededBy": "did:web:bazaar.whereditgo.diamonds#merchant-key-2026-08-29" }
  ]
}
```

#### 1d. Trade-off

A resolver that reads only `verificationMethod` verifies records signed by the **current or any
retired** key. Only a **revoked** key's records fail for such a resolver — which is correct.
`keyHistory` adds two things a bare Multikey resolver does not use: the `supersededBy` chain, and
the revocation tombstones (so a Bazaar-aware verifier can give a specific "signed by a revoked
key" answer rather than a generic failure). This keeps ADR 0011's spirit — retired keys stay
verifiable — while replacing "append-only `verificationMethod`" with "`verificationMethod` = every
non-revoked key, revoked keys removed".

### 2. Source of truth: environment only

No file (CI-absent), no committed key material, no DB authority.

| var | contents |
|---|---|
| `APP_MERCHANT_PRIVATE_KEY` | current private key — secret |
| `APP_MERCHANT_KID` | current key fragment, `merchant-key-YYYY-MM-DD[-N]` |
| `APP_MERCHANT_PUBLIC_MULTIBASE` | current public key `z…` — optional, derived from the private key if unset |
| `APP_MERCHANT_KEY_HISTORY` | **base64(JSON array)** of every non-current key (the `keyHistory` entries of §1a) |

- `APP_MERCHANT_KEY_HISTORY` decodes to the `keyHistory` array. Base64 wraps it to survive
  dotenv / shell / CI-secret round-trips (same rationale as the PEM `\n`-escape handling); a
  plain-JSON value is also accepted, and `id` / `supersededBy` may be given as bare fragments
  (expanded with `APP_DID`).
- Public key material only — nothing secret — but it travels as one variable so CI/CD passes it
  through like any other secret.

The storefront DID `id` is `APP_DID` when it is a `did:web:` (else the built-in default); a
non-`did:web` `APP_DID` is ignored with a warning.

`loadServiceDidDocument()` (`packages/server/src/lib/serviceDidDocument.ts`) assembles:

- `@context` — base array read from `config/did-document.template.json` + the hosted context URL of §1b.
- `verificationMethod` — the current key + every non-revoked `APP_MERCHANT_KEY_HISTORY` entry.
- `assertionMethod` — `[ current key id ]`.
- `keyHistory` — the full parsed `APP_MERCHANT_KEY_HISTORY` array.

No `APP_MERCHANT_KEY_HISTORY` → one `verificationMethod` entry, empty `keyHistory`.

`scripts/rotate-did.sh` / `rotate-did.ts` (new): generate a new keypair → read the current
`APP_MERCHANT_*` values → emit the new current-key env block and the new
`APP_MERCHANT_KEY_HISTORY` with the outgoing key appended (`supersededBy` = new key id). The
operator sets the secrets (local `.env` / `fly secrets` / CI secret) and deploys. Nothing is
committed. Same-day rotations get a `-N` suffix.

### 3. `app_keys` table — runtime cache + audit surface

New table in `packages/server/src/db/schema.ts` (migration `drizzle/0008_app_keys.sql`).

| column | notes |
|---|---|
| `kid` (PK) | bare fragment |
| `id` | full DID URL |
| `public_key_multibase` | |
| `public_key_pem` | SPKI PEM, so `crypto.verify` needs no re-decode |
| `status` | derived: `current` \| `retired` \| `revoked` |
| `superseded_by` | full DID URL; null for the current key |
| `revoked` | boolean, mirrors the flag |
| `first_seen_at` | when this process first recorded the key |

**Zero authority.** `reconcileMerchantKeys(db)` (`lib/merchantKeys.ts`, called from `index.ts`
after `migrate`) truncates and repopulates it from the environment on every boot, preserving
`first_seen_at` for kids already present. If `APP_MERCHANT_KEY_HISTORY` is malformed it exits
with a message rather than serving a broken document. Verification reads the in-memory key set
(`getMerchantKeys()`), not this table; the table is for operator queries and future admin tooling.

### 4. Verification path

`candidatePemsForKid(getMerchantKeys(), kid)` (`lib/merchantKeys.ts`), given a record's optional
`kid` (a bare fragment):

1. `kid` resolves to a `keyHistory` entry with `revoked: true` → `{ revoked: true, pems: [] }` —
   **reject immediately**, no signature check.
2. Otherwise return an ordered PEM list: the hinted key (if `kid` resolves and is not revoked),
   then the current key, then every non-revoked `keyHistory` key newest → oldest.
3. `verifyReceiptPayload` per candidate: compact low-S IEEE-P1363 first, DER fallback
   (transitional, §6).

`packages/server/src/routes/download.ts` — the two entitlement checks call this;
`appMerchantPublicKeyPemFromEnv()` remains as the fallback when the key set is empty, so behaviour
never regresses below today's single-key check.

### 5. Rotation procedures (operator)

**5a. Planned rotation**
1. `./scripts/rotate-did.sh` — new keypair, `kid = merchant-key-<today>` (`-2`, `-3`… for a
   same-day second rotation). It prints the new `APP_MERCHANT_PRIVATE_KEY` / `APP_MERCHANT_KID` /
   `APP_MERCHANT_PUBLIC_MULTIBASE` and the new `APP_MERCHANT_KEY_HISTORY` (outgoing key appended,
   `supersededBy` = new key id).
2. Set the four vars (local / `fly secrets` / CI secret). Deploy.
3. Pre-flight `curl /.well-known/did.json` — see the handbook.

The outgoing key is **retired**: only in `keyHistory`, still trusted for the records it signed.

**5b. Emergency — key compromise**
1. Rotate as in 5a.
2. Add `"revoked": true` to the compromised key's `APP_MERCHANT_KEY_HISTORY` entry. Redeploy.
3. Every `purchase.receipt` / `purchase.consent` / `bazaarIdentifier` signed with it now fails
   verification — unavoidable.
4. **Best-effort reissue.** `fulfillCheckoutSession` already restores buyer OAuth sessions
   (`oauthClient.restore(buyerDid)`), and `payment_fulfillment` holds `buyerDid` / `paymentRef` /
   snapshot. For buyers whose session is still restorable the server can rewrite `purchase.receipt`
   with the new key; buyers whose session has expired must re-authenticate first. There is no
   fully automatic recovery.

### 6. Transitional state (single resolution method target)

The DER-accepting fallback in `verifyCanonical` (`sign.ts`) and the DER signer left in
`bazaarIdentifiers.ts` exist only for records issued before the 2026-08-29 remediation. **Target
state: one resolution method** — compact low-S IEEE-P1363, verified against a key selected by
`kid` from `keyHistory` / `app_keys`.

Removal is tracked by
`bazaar-vault/Tickets/2026-08-29 Remove DER appSig fallback after field-receipt migration.md`,
gated on migrating the known (all self-issued) field receipts. `bazaarIdentifiers` is deprecated
wholesale (§7) — its signer is expected to be deleted, not converted.

### 7. `actor.merchant` identity gap (surfaced, not resolved here)

Full write-up:
`bazaar-vault/Documentation/merchant key management/2026-08-29 actor.merchant identity gap.md`.

- **Today** `diamonds.whereditgo.bazaar.actor.merchant`
  (`packages/shared/src/lexicons/actor.merchant.json`, rkey `self`, ADR 0005) holds only
  storefront presentation: `displayName`, `description`, `storefrontUrl`, `avatarCid`,
  `bannerCid`, `createdAt`. Legal/contact fields are in server SQLite
  (`merchant_business_profile`). There is **no** seller-identity field on the record — the seller
  is implied by the repo it lives in (`ARTIST_DID` / `VITE_ARTIST_DID`).
- **Coming** `artistDid → sellerDid` is a planned generalization (catalog lexicons still use
  `artistDid`; receipts use `buyerDid` + `issuerScope`). Future receipt-issuance work owns the
  migration — this ADR deliberately does **not** redesign records.
- **Open questions for that pass** (no answer here): explicit self-declared `sellerDid`? a seller
  kind (`individual` | `business` | `label`), PDS vs SQLite? should the record name the `appDid`
  that signs for it, so a receipt verifier can cross-check the storefront from the seller's own
  repo? what stays in `merchant_business_profile`?

## Constraints

| Rule | Value |
|---|---|
| Trust anchor | `appDid` (`did:web`) DID document |
| `kid` format | `merchant-key-YYYY-MM-DD[-N]` (max 64 chars) |
| `verificationMethod` | the current key + every non-revoked key |
| `assertionMethod` | the current key, only |
| `authentication` | omitted |
| `keyHistory` | every non-current key; ordered oldest→newest; `{ id, type, controller, publicKeyMultibase, supersededBy }` with `id` / `supersededBy` full DID URLs; optional `revoked: true` (`@context`-typed `xsd:boolean`) |
| state | derived from field membership — no `status` in the document |
| `keyHistory` vocab | hosted at `https://bazaar.whereditgo.diamonds/ns/v1` (`GET /ns/v1`); IRI ns `https://bazaar.whereditgo.diamonds/ns#` (fixed, project-wide); DID `@context` is string-only |
| Revocation | optional boolean `revoked: true` on the `keyHistory` entry; no timestamp is a verification input |
| Source of truth | environment only (`APP_MERCHANT_PRIVATE_KEY` / `_KID` / `_PUBLIC_MULTIBASE` / `_KEY_HISTORY`) |
| `app_keys` table | runtime cache + audit surface, rebuilt from env each boot; zero authority |
| Signature format | compact low-S IEEE-P1363; DER accepted transitionally on verify only |
| DID route | `packages/server/src/routes/wellKnown.ts` |

## Consequences

**Positive**
- Rotation is fully expressible via four environment variables — CI/CD-portable, no committed
  keys, no admin UI required for the core operation.
- Standard `did:web` resolvers verify records signed by the current key or any retired key with no
  Bazaar knowledge; the `keyHistory` extension (hosted context URL) adds the `supersededBy`
  chain and the revocation tombstones.
- `app_keys` is derived state, so it can never be the thing that is wrong — the environment is.

**Negative / trade-offs**
- `loadServiceDidDocument()` and `reconcileMerchantKeys()` parse a base64 JSON blob at boot; a
  malformed `APP_MERCHANT_KEY_HISTORY` fails loudly (process exit), it does not silently drop
  history.
- Distinguishing a revoked key's records from a generic bad signature requires the `keyHistory`
  extension — a bare Multikey resolver just sees "signature does not verify against any method".
- The DER fallback and the `bazaarIdentifiers` DER signer linger until field-receipt migration.
- DID document is built once at boot; rotation lands on redeploy (acceptable for a rare op).
- Full JSON-LD consumers must fetch `/ns/v1` (or the fixed project URL) to expand `keyHistory`
  terms; document-shape validators that only accept string `@context` entries (ATCute, Bluesky)
  work without that fetch.

**Deferred**
- Key-rotation management UI.
- `kid` on `bazaarIdentifier` instances (module deprecated; likely moot).
- `actor.merchant` schema changes (§7) — future receipt-issuance pass.
- Removing the DER fallback (its own ticket).
