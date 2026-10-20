# ADR 0024: Fulfill a paid order against the listing the buyer checked out against

## Status

Accepted.

Amends the fulfillment steps of [ADR 0004](0004-payment-flow.md). Does not change the receipt
record or its signed payload ([ADR 0019](0019-single-receipt-signature-path.md)).

## Date

2026-10-19

## Context

A buyer could be charged and get no receipt if the merchant touched the listing while the buyer was
on the Stripe Checkout page.

`POST /stripe/checkout` read the listing, gated on it (`status`, active `parentListing`, a
`licenseGrant`, the pinned `item.cid`) and put the listing's CID into the session metadata.
`fulfillCheckoutSession` then re-fetched the listing with `getRecord({ cid })` to recover what was
bought. A PDS serves only the current version of a record, so that fetch fails after **any**
`putRecord` on the listing in between, and the order was dead-lettered as
`listing_snapshot_mismatch`. Ordinary merchant work triggers this: a price change, or the automatic
re-pin of `item.cid` that the inventory and product edit pages do after a metadata edit.

Fulfillment also re-checked the listing's `status` and, live, its parent listing's `status`, so
pausing either after the buyer paid dead-lettered the order (`listing_not_active`,
`listing_parent_not_active`).

Nothing refunds a dead-lettered order. It only appears as `dead_letter` on the merchant's Sales
page; the buyer has paid and holds nothing.

## Decision

**Snapshot at checkout, fulfill against the snapshot.** `POST /stripe/checkout` writes a
`checkout_snapshot` row — listing URI, CID and JSON, purchased item/product URI, CID and JSON —
exactly as it read and validated them, and puts the row id in the session metadata as
`checkoutSnapshotId`. Fulfillment loads that row instead of re-fetching the listing, and uses the
snapshot's item/product record (not a live fetch) to compute `grantedItems`, so a product edit
mid-checkout can't change the entitlement either.

**A DB row, not Stripe metadata.** Stripe caps metadata values at 500 characters; a listing with a
license grant, item ref and price does not reliably fit, and a product record never does. The row
is written by our server from the same `getRecord` response that supplied the CID, so it needs no
further integrity check than matching the session metadata: if `listingUri`, `listingCid` or
`itemUri` on the row disagree with the session, the order is dead-lettered as
`checkout_snapshot_mismatch` rather than fulfilled against the wrong terms.

**What fulfillment still checks:** the PaymentIntent succeeded; the snapshot carries a
`licenseGrant`; the snapshot's `item.uri` matches the session's `itemUri`; and the amount and
currency received equal the snapshot's price. Those are properties of *this* payment against *these*
terms.

**What it no longer checks:** listing `status` and parent-listing `status`. Both are enforced when
the session is created. Pausing a listing stops new checkouts; it does not reach back and void a
payment that already happened. A merchant who wants to refuse a paid order refunds it in Stripe.

**The signed payload is unchanged.** The receipt's `listing.cid`, and the `listingCid` folded into
`storefrontSig`, are the snapshot's CID — the CID the buyer checked out against, as before. A
verifier sees no difference.

**Retention.** The fulfillment sweeper deletes snapshots older than 30 days. A Checkout Session
lives at most 24 hours and the retry ladder (30 attempts, backoff capped at an hour) runs out in
about a day and a half, so nothing still fulfillable loses its snapshot.

## Consequences

- Editing, re-pinning or pausing a listing (or pausing its parent) mid-checkout no longer strands a
  paid order. Tests: `packages/server/src/lib/stripe/checkoutSnapshot.test.ts`.
- A receipt's `listing.cid` may name a listing version the merchant's PDS no longer serves. That was
  already true of every receipt once its listing was later edited; verification never needed the
  listing record, only the CID in the signed payload.
- Sessions created before this change carry no `checkoutSnapshotId` and fall back to the old
  at-CID fetch, so they still dead-letter if the listing changed. Same for a session whose snapshot
  row is missing.
- Abandoned checkouts leave a snapshot row until the 30-day prune.
