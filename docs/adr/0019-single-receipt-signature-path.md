# ADR 0019: One receipt signature path — fixed payload, no DER fallback

## Status

Accepted.

## Date

2026-09-15

## Context

`purchase.receipt.storefrontSig` had accumulated two independent axes of
backward compatibility, both of which made an old receipt verifiable against a
shape the current signer would never produce.

**Payload shape.** `receiptPayloadString()` built a colon-delimited message
variadically: five base fields, then `licenseGrantCid` *if present*, then the
`grantedItems` digest *if present*. A receipt therefore verified against a
five-, six- or seven-field payload depending on when it was minted. That was
deliberate — ADR 0016 introduced `licenseGrantCid` into the signature and kept
it optional so receipts predating it still verified.

**Signature encoding.** The 2026-08-29 remediation switched `storefrontSig`
from DER to compact low-S IEEE-P1363 (`r || s`), the AT Protocol convention and
what `bazaar-vault/Demos/verify-receipt.ts` expects. `verifyCanonical()` tried
P-1363 first and fell back to DER, so pre-remediation field receipts kept
working. The vault ticket *"2026-08-29 Remove DER appSig fallback after
field-receipt migration"* tracked removing it, blocked on migrating those
receipts, and explicitly warned: *do not remove the fallback before the field
receipts are migrated — it will break historical downloads with no recovery
path.*

That blocker was resolved by decision rather than by migration. Breaking
changes were deployed to production deliberately; the four affected buyers were
identified and compensated with coupon codes. The operator's instruction was to
take the break rather than carry migration code into an open-source release.

## Decision

Collapse both axes to a single path.

### Payload

`receiptPayloadString()` takes seven required fields and always joins all
seven. `licenseGrantCid` and `entitlementDigest` are no longer optional on
`signReceiptPayload` / `verifyReceiptPayload`.

A receipt that lacks either field cannot reconstruct the signed string and does
not verify. There is no five- or six-field fallback.

### Encoding

`verifyCanonical()` accepts a 64-byte IEEE-P1363 signature and nothing else. A
DER signature is rejected on length before any crypto runs.

### Signing side

`fulfillCheckoutSession` now signs only when both fields are available, and
logs a warning and leaves `storefrontSig` empty otherwise. Minting a signature
over a payload no verifier could reconstruct is worse than an unsigned receipt.

In practice this never trips: `resolveGrantedItems` yields a ref for every
`catalog.item` and every `catalog.product` (whose `items` is `minLength: 1`),
and checkout is already gated on the listing carrying a `licenseGrant`.

### Downstream

`verifyReceiptForBuyer` returns false early when a receipt has no frozen grant
or no `licenseGrant.cid`. That made the "legacy receipts resolve against live
membership" branches in `download.ts` unreachable — a receipt reaching them
could never have verified — so they are gone, along with `productContainsItem`.
Entitlement is now exactly the frozen grant, with nothing behind it.

## Consequences

**Positive**
- One way to verify a receipt. The reference verifier in the vault and the
  server agree with no conditional branches between them.
- Every receipt that verifies has its license terms and its exact entitlement
  bound into the signature. The partially-signed shapes are gone.
- `download.ts` loses a fallback path that silently widened entitlement to live
  product membership.

**Negative / trade-offs**
- **Irreversible, against data we do not control.** Every receipt minted before
  this shape is permanently unverifiable. Those records live in buyers' own
  repos and cannot be rewritten by us. There is no recovery path — this is the
  outcome the vault ticket warned about, accepted knowingly.
- A buyer holding such a receipt loses download access entirely. The four known
  holders were compensated out of band before this landed.
- Anyone who built against the optional-field payload (the shape is public, the
  lexicon is served at `com.atproto.lexicon.get`) has a breaking change with no
  deprecation window.

**Deferred**
- Nothing. Both axes are closed; the vault ticket is closed with this ADR.
