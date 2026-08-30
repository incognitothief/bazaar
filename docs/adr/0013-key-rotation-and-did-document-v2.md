# ADR 0013: Key rotation and DID document v2

## Status

**Draft** — not yet accepted. Not listed in `docs/adr/README.md` until accepted.

Implemented on branch `feature/rework-did-document`: `lib/merchantKeys.ts`,
`lib/serviceDidDocument.ts`, `routes/wellKnown.ts`, `routes/download.ts`, `db/schema.ts` +
`drizzle/0008_app_keys.sql`, `scripts/rotate-did.{sh,ts}`, `APP_MERCHANT_KEY_HISTORY` in
`.env.example`. Doc follow-ups tracked in
`bazaar-vault/Tickets/2026-08-29 Finalize storefront key rotation docs after ADR 0013 lands.md`.

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

| state | in `verificationMethod` | in `assertionMethod` | in `keyHistory` |
|---|:--:|:--:|:--:|
| **current** | ✓ | ✓ | ✗ |
| **active** (valid, not the signing key) | ✓ | ✗ | ✓ `status: "active"` |
| **retired** (dropped from `verificationMethod`) | ✗ | ✗ | ✓ `status: "retired"` |
| **revoked** (compromised) | ✗ | ✗ | ✓ `status: "revoked"` |

- `verificationMethod` — the current key **plus every still-active key**, as standard `Multikey`
  entries. A generic `did:web` resolver accepts all of them.
- `assertionMethod` — exactly one entry: the current key.
- `keyHistory` — every **non-current** key. Each entry is self-contained (carries its own
  `publicKeyMultibase`, duplicating the `verificationMethod` entry for `active` keys) so a
  consumer can read every non-current key from one place. Ordered oldest → newest, forward-linked
  by `supersededBy`; the tail entry's `supersededBy` is the current `kid`.
- **Retirement** = removing a key from `verificationMethod` (it stays in `keyHistory` for
  Bazaar-aware historical verification).
- **Revocation** = `status: "revoked"`. No timestamp. Every verifier rejects everything it signed.

`keyHistory` entry:

```jsonc
{
  "kid": "merchant-key-2026-04-17",         // required
  "publicKeyMultibase": "z…",               // required — self-contained
  "status": "active",                       // required — "active" | "retired" | "revoked"
  "supersededBy": "merchant-key-2026-08-29", // required — kid that became current after this one
  "activatedAt": "2026-04-17T00:00:00Z",    // optional, informational — never a verification input
  "retiredAt":   "2026-08-29T00:00:00Z",    // optional, informational — never a verification input
  "notes": "scheduled rotation"             // optional, informational
}
```

#### 1b. `@context` (inline)

`keyHistory` and its terms are declared with an **inline context object** appended to the
`@context` array — no second document to serve, offline-safe, one deployment dependency:

```jsonc
"@context": [
  "https://www.w3.org/ns/did/v1",
  "https://w3id.org/security/multikey/v1",
  {
    "keyHistory":   { "@id": "https://bazaar.whereditgo.diamonds/ns#keyHistory", "@container": "@list" },
    "kid":          "https://bazaar.whereditgo.diamonds/ns#kid",
    "status":       "https://bazaar.whereditgo.diamonds/ns#status",
    "supersededBy": "https://bazaar.whereditgo.diamonds/ns#supersededBy",
    "activatedAt":  "https://bazaar.whereditgo.diamonds/ns#activatedAt",
    "retiredAt":    "https://bazaar.whereditgo.diamonds/ns#retiredAt",
    "notes":        "https://bazaar.whereditgo.diamonds/ns#notes"
  }
]
```

`@container: "@list"` preserves chain order. The IRI namespace
`https://bazaar.whereditgo.diamonds/ns#` is a **fixed Bazaar-project vocabulary URI**, identical
for every deployment regardless of the operator's own `did:web` host; nothing needs to resolve
there today. `publicKeyMultibase` is already defined by the multikey context.

#### 1c. Full example

```jsonc
{
  "@context": [ /* …as 1b… */ ],
  "id": "did:web:bazaar.whereditgo.diamonds",
  "verificationMethod": [
    { "id": "did:web:bazaar.whereditgo.diamonds#merchant-key-2026-08-29", "type": "Multikey",
      "controller": "did:web:bazaar.whereditgo.diamonds", "publicKeyMultibase": "z…current…" },
    { "id": "did:web:bazaar.whereditgo.diamonds#merchant-key-2026-04-17", "type": "Multikey",
      "controller": "did:web:bazaar.whereditgo.diamonds", "publicKeyMultibase": "z…still-active…" }
  ],
  "assertionMethod": ["did:web:bazaar.whereditgo.diamonds#merchant-key-2026-08-29"],
  "keyHistory": [
    { "kid": "merchant-key-2026-01-10", "publicKeyMultibase": "z…", "status": "retired",
      "supersededBy": "merchant-key-2026-04-17" },
    { "kid": "merchant-key-2026-04-17", "publicKeyMultibase": "z…", "status": "active",
      "supersededBy": "merchant-key-2026-08-29" }
  ]
}
```

#### 1d. Trade-off

A resolver that reads only `verificationMethod` can verify records signed by the **current or any
active** key. Verifying a record signed by a **retired or revoked** key requires understanding the
`keyHistory` extension. This is a deliberate departure from ADR 0011's "append-only
`verificationMethod`, retired keys stay" model: it keeps the standard surface small (only keys the
operator still vouches for as first-class) and pushes historical-key verification into the
documented extension. Acceptable because every signed record carries `kid`, and `verify-receipt.ts`
+ the operator handbook document the walk.

### 2. Source of truth: environment only

No file (CI-absent), no committed key material, no DB authority.

| var | contents |
|---|---|
| `APP_MERCHANT_PRIVATE_KEY` | active (current) private key — secret |
| `APP_MERCHANT_KID` | current key fragment, `merchant-key-YYYY-MM-DD[-N]` |
| `APP_MERCHANT_PUBLIC_MULTIBASE` | current public key `z…` — optional, derived from the private key if unset |
| `APP_MERCHANT_KEY_HISTORY` | **base64(JSON array)** of every non-current key descriptor (the `keyHistory` entries of §1a) |

- `APP_MERCHANT_KEY_HISTORY` decodes to the `keyHistory` array verbatim. Base64 wraps it to
  survive dotenv / shell / CI-secret round-trips (same rationale as the PEM `\n`-escape handling);
  a plain-JSON value is also accepted (try `JSON.parse`, then try base64-decode).
- Public key material only — nothing secret — but it travels as one variable so CI/CD passes it
  through like any other secret.

`loadServiceDidDocument()` (`packages/server/src/lib/serviceDidDocument.ts`) stops doing string
substitution and assembles:

- `@context` — static skeleton + the inline object of §1b.
- `verificationMethod` — the current key (from the active-key vars) **+** every
  `APP_MERCHANT_KEY_HISTORY` entry with `status: "active"`.
- `assertionMethod` — `[ current kid ]`.
- `keyHistory` — the full parsed `APP_MERCHANT_KEY_HISTORY` array (all non-current keys).

The template file keeps only the `@context` skeleton + `id`. The env single-key path still works:
no `APP_MERCHANT_KEY_HISTORY` → one `verificationMethod` entry, empty `keyHistory`.

`scripts/rotate-did.sh` (new): generate a new keypair → read the current `APP_MERCHANT_*` values →
emit (a) the new active-key env block and (b) the new `APP_MERCHANT_KEY_HISTORY` blob with the
outgoing key appended (`status: "active"` if kept in `verificationMethod` for a grace window,
`"retired"` otherwise; `supersededBy` = new kid). The operator sets the secrets (local `.env` /
`fly secrets` / CI secret) and deploys. Nothing is committed.

### 3. `app_keys` table — runtime cache + ERP surface

New table in `packages/server/src/db/schema.ts`, migration via
`npm run db:generate -w @bazaar/server` into `packages/server/drizzle/`.

| column | type | notes |
|---|---|---|
| `kid` | text PK | |
| `public_key_multibase` | text not null | |
| `public_key_pem` | text not null | SPKI PEM, so `crypto.verify` needs no re-decode |
| `status` | text not null | `current` \| `active` \| `retired` \| `revoked` (check) |
| `superseded_by` | text | null for the current key |
| `first_seen_at` | integer timestamp not null | when this process first recorded the key |
| `last_verified_at` | integer timestamp | updated when a signature verifies against it |
| `notes` | text | |

**Zero authority.** Rebuilt on every boot from the environment (`buildMerchantKeyIndex()` in a
new `lib/merchantKeys.ts`, called from `index.ts`): parse the active-key vars + the decoded
`APP_MERCHANT_KEY_HISTORY`, upsert rows, drop rows no longer present. The in-memory index it
returns is what verification uses. Because the served DID document is rendered from the same env,
this *is* "backfilling from the DID document" — an optional extra step fetches the deployment's
own `/.well-known/did.json` when the public URL is reachable and logs a warning on any drift, but
nothing depends on that fetch.

Value of the table beyond the in-memory index: queryable audit surface, `notes`,
`last_verified_at` usage signal, and a place for future admin tooling. A management UI stays out
of scope (the rotation ticket's other half).

### 4. Verification path

New resolver in `sign.ts` / `merchantKeys.ts`, given a record's optional `kid`:

1. `kid` present → if it is the current kid, verify against the current key; else look up the
   `app_keys` row. `status: "revoked"` → **reject immediately**, no signature check. Otherwise try
   that key.
2. No `kid`, unknown `kid`, or step 1's key failed → try the current key, then each non-revoked
   key newest → oldest.
3. Signature check itself: compact low-S IEEE-P1363 first, DER fallback (transitional, §6).

`packages/server/src/routes/download.ts` — the two `appMerchantPublicKeyPemFromEnv()` entitlement
checks switch to this resolver. `appMerchantPublicKeyPemFromEnv()` remains as the "current key"
accessor and the last-resort fallback when the index is somehow empty, so behaviour never
regresses below today's single-key check. `@atproto/identity` `IdResolver` (already a dependency,
ADR 0012) covers the external-verifier shape of resolving our own `did:web`.

### 5. Rotation procedures (operator)

**5a. Planned rotation**
1. `./scripts/rotate-did.sh` → new keypair, `kid = merchant-key-<today>` (add `-2`, `-3`… for a
   second rotation the same day).
2. It prints the new `APP_MERCHANT_PRIVATE_KEY` / `APP_MERCHANT_KID` /
   `APP_MERCHANT_PUBLIC_MULTIBASE` and the new `APP_MERCHANT_KEY_HISTORY` (previous current key
   appended, `supersededBy` = new kid; `status: "active"` to keep it in `verificationMethod` for a
   grace window, or `"retired"` to drop it immediately).
3. Set the four vars (local / `fly secrets` / CI secret). Deploy.
4. Pre-flight `curl /.well-known/did.json` — see the handbook.

**5b. Retiring an active key** (later — end the grace window)
- Flip that key's `APP_MERCHANT_KEY_HISTORY` entry `status: "active"` → `"retired"`. Redeploy. It
  leaves `verificationMethod`; it stays in `keyHistory`; records it signed still verify through
  the extension.

**5c. Emergency — key compromise**
1. Rotate as in 5a.
2. Set the compromised key's `APP_MERCHANT_KEY_HISTORY` entry `status: "revoked"` (add `notes`).
   Redeploy. It is absent from `verificationMethod` and marked `revoked` in `keyHistory`.
3. Every `purchase.receipt` / `purchase.consent` / `bazaarIdentifier` signed with it now fails
   verification — unavoidable.
4. **Best-effort reissue.** `fulfillCheckoutSession` already restores buyer OAuth sessions
   (`oauthClient.restore(buyerDid)`), and `payment_fulfillment` holds `buyerDid` / `paymentRef` /
   snapshot. For buyers whose session is still restorable the server can rewrite `purchase.receipt`
   with the new key; buyers whose session has expired must re-authenticate before their receipt
   can be reissued. There is no fully automatic recovery.

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
| `verificationMethod` | current key + every `status:"active"` key |
| `assertionMethod` | exactly the current key |
| `authentication` | omitted |
| `keyHistory` | every non-current key; ordered; self-contained; `status` ∈ {active, retired, revoked}; forward-linked by `supersededBy` |
| `keyHistory` vocab | inline `@context` object; IRI ns `https://bazaar.whereditgo.diamonds/ns#` (fixed, project-wide) |
| Revocation | boolean `status:"revoked"`; no timestamp is a verification input |
| Source of truth | environment only (`APP_MERCHANT_PRIVATE_KEY` / `_KID` / `_PUBLIC_MULTIBASE` / `_KEY_HISTORY`) |
| `app_keys` table | runtime cache + audit surface, rebuilt from env each boot; zero authority |
| Signature format | compact low-S IEEE-P1363; DER accepted transitionally on verify only |
| DID route | `packages/server/src/routes/wellKnown.ts` |

## Consequences

**Positive**
- Rotation is fully expressible via four environment variables — CI/CD-portable, no committed
  keys, no admin UI required for the core operation.
- Standard `did:web` resolvers verify current + active keys with no Bazaar knowledge; the
  `keyHistory` extension (documented, inline-context) covers historical keys.
- `app_keys` is derived state, so it can never be the thing that is wrong — the environment is.

**Negative / trade-offs**
- `loadServiceDidDocument()` and `buildMerchantKeyIndex()` parse a base64 JSON blob at boot; a
  malformed `APP_MERCHANT_KEY_HISTORY` must fail loudly, not silently drop history.
- Retired/revoked-key verification requires the `keyHistory` extension — a bare Multikey resolver
  cannot check those records.
- The DER fallback and the `bazaarIdentifiers` DER signer linger until field-receipt migration.
- DID document is built once at boot; rotation lands on redeploy (acceptable for a rare op).

**Deferred**
- Key-rotation management UI.
- `kid` on `bazaarIdentifier` instances (module deprecated; likely moot).
- `actor.merchant` schema changes (§7) — future receipt-issuance pass.
- Removing the DER fallback (its own ticket).
- Promoting the inline `@context` to a hosted context document if the vocabulary grows.
