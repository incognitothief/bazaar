# ADR 0016: Retire `purchase.consent` — freeze license terms atomically on the receipt

## Status

Accepted.

## Date

2026-09-11

## Context

`purchase.consent` was a second signed record, written to the buyer's PDS immediately after
`purchase.receipt`, carrying `receiptUri`/`receiptCid`, a `licenseGrant` ref, `consentedAt`, and
its own `appSig`. The intent was to give license-terms acceptance its own tamper-evident record,
separate from the payment receipt.

In practice it never was separate:

- `fulfillCheckoutSession.ts` built both records from the same in-memory `licenseGrantUri` /
  `licenseGrantCid` locals, in the same synchronous flow. Consent could never disagree with the
  receipt it accompanied.
- `consentedAt` was hardcoded to the receipt's own `purchasedAt` — there was no independent
  "buyer clicked I agree" moment being captured, just a copy of the purchase timestamp.
- The client (`PurchaseDetailPage.tsx`) already read license terms from `receipt.licenseGrant`,
  never from `consent.licenseGrant`. The only thing actually read off the consent record was
  `consentedAt`, which duplicated `receipt.purchasedAt`.

The one real thing `purchase.consent` provided: `purchase.receipt`'s own `appSig` never covered
`licenseGrant.cid` (it signed `purchasedAt:paymentRef:purchasedGood.uri:listing.cid:buyerDid[
:entitlementDigest]`). A buyer holding OAuth write access to their own repo could edit their
receipt's `licenseGrant` field without invalidating `appSig`. `purchase.consent`'s signature did
cover `licenseGrantCid` (alongside `receiptCid`, which content-hashes the whole receipt including
its `licenseGrant`), so it was the only tamper-evident anchor for the license terms — a second
record doing one job the first record's signature was simply missing.

## Decision

Fold that one job into the receipt directly instead of carrying a second record for it.

### Lexicon

- `purchase.receipt.licenseGrant` moves from optional to **required** — every listing must carry
  license terms before it can be sold (`listingHasV5License` already gates checkout on this), so
  every receipt has one.
- `purchase.receipt.appSig` now folds `licenseGrant.cid` into the signed payload as an optional
  trailing field (present whenever `licenseGrant.cid` is), positioned before the existing
  optional `grantedItems` digest field. Order is fixed and mirrors the existing pattern used for
  `entitlementDigest`: base 5-field payload, then `licenseGrantCid` if present, then the
  entitlement digest if present. This preserves verifiability of every receipt shape that could
  already exist (base-only, digest-only) while making all new receipts additionally freeze their
  license terms.
- `purchase.consent` lexicon is deleted outright (`diamonds.whereditgo.bazaar.purchase.consent`).
  No replacement collection, no migration — the collection was introduced on this same unreleased
  branch and never shipped to production, so there is nothing to migrate away from.

### Code

- `sign.ts`: `receiptPayloadString` / `signReceiptPayload` / `verifyReceiptPayload` gain an
  optional `licenseGrantCid` param, appended to the signed message when present.
  `signConsentPayload` / `verifyConsentPayload` are removed.
- `fulfillCheckoutSession.ts`: the consent-signing and consent-`createRecord` step is removed
  entirely. Checkout fulfillment is now: verify payment → write receipt (with `licenseGrantCid`
  folded into `appSig`) → mark `payment_fulfillment` row `completed`. The `receipt_written`
  intermediate status is kept as-is for crash-recovery idempotency, it just has no follow-up work
  after it anymore.
- `download.ts`: `verifyReceiptForBuyer` reconstructs the payload with
  `licenseGrantCid: rec.licenseGrant?.cid`.
- `payment_fulfillment.consent_uri` column dropped (migration `0018_married_gambit.sql`).
- `oauth-scope.ts`: `purchase.consent` create scope removed from both the full and buyer-limited
  OAuth scope sets.
- Client: `PurchaseConsent` type, `listPurchaseConsentRows`, the "Consented at" line on
  `PurchaseDetailPage`, and the "License consent" / consent-URI surfacing in
  `PurchaseSuccessPage` and `MerchantTransactionsPage` are all removed.

## Consequences

**Positive**
- One signed record per purchase instead of two, with no loss of tamper-evidence — the property
  `purchase.consent` existed to provide (license terms frozen against buyer-side tampering) now
  lives directly on the receipt's own signature.
- Removes a whole class of partial-fulfillment states (`receipt_written` used to mean "receipt
  done, consent still pending"); a completed row now really means everything is written.
- Fewer PDS writes per purchase (one instead of two), fewer places for the buyer OAuth session to
  fail mid-checkout.

**Negative / trade-offs**
- A verifier holding only a bare `purchase.receipt` blob (no separate consent artifact) is exactly
  where verification already happens in this codebase — there was never a scenario using consent
  as a receipt-independent artifact.
- Breaking lexicon change: `licenseGrant` required, `appSig` payload shape changed. Accepted
  because `purchase.consent` and the required-`licenseGrant` receipt shape both postdate the last
  production deploy (this branch, not yet merged) — no live receipts exist under either shape yet.

**Deferred**
- Whether `purchasedAt` alone is sufficient going forward as the "when" for a purchase, now that
  there's no separate `consentedAt`. If a genuinely distinct affirmative-consent step (e.g. a
  clickwrap gate timed apart from payment) is ever added, it should be a field on the receipt
  itself, not a second record.
