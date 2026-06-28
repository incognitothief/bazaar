# Bazaar — Payments Pivot: Scope & Decisions

**Date:** 28 June 2026
**Status:** Scoping in progress — full multi-rail map being drawn before any build work starts. Several threads below are still open.
**Applies to:** payment architecture, admin panel, MVP inventory scope. Reframes priority set by the licensing-focused proposals (`26_4_3` through `26_4_17`), which remain valid but are no longer the active work.

---

## Why this pivot

The prior posture was "how do I cover every use case an artist might need for a business." That's an unbounded backlog. The new posture is "run my artist business" — scope is whatever that actually requires, not whatever a generic artist-business platform might eventually need.

Two concrete consequences:

1. **Licensing work is benched.** It was consuming disproportionate cognitive overhead relative to what the MVP needs.
2. **Flexible payments is now the active work.** Current posture is Stripe + a business account, single ingress for payments and compliance. Target is to accept crypto, Venmo, and Cash App in addition to Stripe, and to support rentals, subscriptions, and agentic microtransactions.

---

## Licensing: benched, not abandoned

- `license.terms` and related lexicons stay frozen at the v6r2 settled design (`26_4_17-lexicon-proposal-6r2.md`). No further licensing lexicon work is active.
- This is safe to bench because `purchase.receipt` already treats license fields as optional (`licenseGrantUri`, `licenseGrantCid`) — nothing downstream depends on licensing work continuing.
- Revisit only if a concrete future need surfaces. Lexicon namespace and authority host are unaffected either way.

---

## Payment rails

### Decided: Stripe + Venmo + Cash App, API-backed only

Venmo and Cash App each have a "real API" tier and a "personal P2P" tier:

| Rail     | Personal P2P                          | API-integrated                                                                                                                   |
| -------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Venmo    | `@username` link — no API, no webhook | "Pay with Venmo" via Braintree/PayPal checkout — real webhook, gated by business-model eligibility (US business entity required) |
| Cash App | `$cashtag` link — no API, no webhook  | Cash App Pay via Square's merchant API — real webhook                                                                            |

**Decision: API-integrated tiers only.** The existing business entity behind the Stripe account clears the eligibility bar for both, so there's no reason to take on the manual-attestation trust gap that personal P2P would require. Every receipt continues to be signed only after a confirmed webhook event — no exceptions, no new trust tier needed on `purchase.receipt`.

### Modular payment menu

Checkout is built so each merchant's storefront presents only the payment rails actually enabled for that merchant, not a fixed global list. Each rail is a pluggable adapter with the same shape:

- capability check — is this rail enabled for this merchant
- create checkout session
- handle this rail's webhook
- write the receipt with the appropriate `paymentProcessor` value

No lexicon change is required for this. `purchase.receipt.paymentProcessor` is already a free-text string, not an enum — it was never hardcoded to Stripe.

### Traded away: single compliance ingress

Adding Square (Cash App Pay) and Braintree/PayPal (Venmo) as real merchant relationships means reconciliation and tax reporting no longer live in one Stripe dashboard. This is an accepted tradeoff, not an oversight — but it needs its own operational document rather than a paragraph here.

**Action item: write a separate runbook** for app owners/merchants covering the included processes. Skeleton:

- **Per-processor map** — where each rail's dashboard lives, what `paymentProcessor` value identifies it on a receipt, who to log into in a dispute
- **Reconciliation cadence** — what "closing the books" means when revenue is split across Stripe + Square + Braintree (+ crypto later)
- **Tax reporting matrix** — which processor issues a 1099-K and at what threshold, so nothing falls through a gap between two processors each assuming the other reports it
- **Dispute/chargeback behavior per rail** — card chargebacks, ACH, Cash App Pay/Venmo-via-Braintree disputes, and crypto's lack of any reversal mechanism all behave differently
- **Degraded-mode behavior** — what checkout does if one processor's API is down, given the payment menu is now modular per-merchant
- **Onboarding checklist** — steps to stand up each new merchant relationship (Square seller account, Braintree, crypto gateway) when a rail is ready to flip on

This runbook is not yet written.

### Still open

- **Crypto rail** — stablecoin choice, custody model, on-chain confirmation/signing flow. Not yet mapped.

---

## Rentals & subscriptions

### Rental

- A single purchase granting time-boxed access — modeled around 24 hours, though duration can vary by listing.
- Two scopes: a specific item/project (one song or one release), or a sitewide day pass — access to everything on the storefront for the window.
- No downloads. Rentals are stream/access-only.

### Subscription

- Patronage-style, not tied to any single song — gives ongoing premium access while active.
- Recurring, periodic refresh (billing period), not a one-time grant.
- **No perpetual access.** Once a subscription lapses, access reverts to nothing — no "keep what you had while subscribed" carryover. This keeps the entitlement check to a single boolean: is there a currently-active subscription record for this buyer and this artist.
- **Cancellation:** stops future renewal, but access continues until the end of the current paid period — the standard pattern, not an immediate cutoff.

### ATProto required for both

Both rentals and subscriptions require ATProto login. This keeps them inside the existing portable-receipt trust model — entitlement lives on the buyer's own PDS and is checkable the same way `purchase.receipt` already is.

### Still open

- **Entitlement record shape.** Neither rental nor subscription fits cleanly into `purchase.receipt` as currently defined — that lexicon assumes a single `item` and a point-in-time fact. A day pass and a subscription are both _scope_-level grants (item / collection / storefront-wide), and a subscription is ongoing rather than point-in-time. This will likely need a new, lightweight record type alongside `purchase.receipt` — something like a `purchase.entitlement` shape with a `scope` and a window (fixed `expiresAt` for rentals, `currentPeriodEnd` + status for subscriptions). Not yet drafted.

---

## One-off purchases & guest checkout

ATProto login is optional for one-off purchases — soft-nudged, never required.

### Trust model impact

This is a real fork, not a free choice. `purchase.receipt`'s trust model depends on two properties: a receipt is independently verifiable by anyone without contacting the backend (because it's signed and lives on the buyer's own PDS), and downloads are gated by matching the authenticated session's DID to `receipt.buyerDid`. A guest has no PDS, so neither property is available — access has to fall back to something backend-anchored instead.

Net effect: there are now two real tiers of purchase. Portable and independently verifiable for anything ATProto-backed (rentals, subscriptions, and any one-off where the buyer chooses to log in). Ephemeral and backend-only for guest one-offs.

### Three-tier guest experience

1. **ATProto login** (soft-nudged, default recommendation) — full receipt on the buyer's PDS, shows up in their library permanently.
2. **Guest + optional email** — ephemeral backend record, no PDS write. Backend can send a magic link to re-deliver the download.
3. **Guest, no email** — pure session/immediate download. If the buyer closes the tab, it's gone; recovery means the artist manually looking up the Stripe payment and resending by hand.

### PII retention (tier 2)

- **Hard cap: 30 days from issuance**, or **purge after the 3rd successful download** — whichever happens first.
- The email address and the magic link are purged together when either limit is hit.
- The financial/ledger record (amount, date, `paymentRef`) is **not** affected by this purge — it's retained separately per accounting/tax requirements, which run on a different and much longer clock. It simply no longer has a working email attached to it.
- The delivery email states the actual purge condition explicitly (e.g. "This link works until [date], or for your first 3 downloads, whichever comes first") rather than a vague "expires eventually."
- A guest purchase recovered after purge is a manual support case, same as the no-email tier.

---

## Agent hooks

Hooks for starting and ending subscriptions, starting rentals, and one-off purchases, callable by an agent rather than a human clicking through checkout.

These inherit the trust tiers above rather than needing new exceptions:

- **Rentals/subscriptions** require ATProto, so an agent acting on these must operate under a DID-scoped, user-delegated OAuth context — not an anonymous path.
- **One-off purchases** can be done by an agent without login, in which case they inherit the guest tier (ephemeral access, no signed receipt) exactly as a human guest checkout would.

### Still open

- The actual hook surface — API shape, how an agent obtains a DID-scoped session vs. its own credentials. Left open deliberately, since it will likely share plumbing with whatever the crypto/agentic-microtransactions rail ends up being.

---

## Admin panel

### v1 ambition: single owner

- ATProto OAuth continues as the merchant identity layer (already in place for `/merchant/*` routes).
- **DID-signed, PDS-published audit trail: explicitly deferred as a future feature.** Rationale: ATProto's Private Data Working Group is still in the requirements-gathering stage — there is no shipped mechanism for non-public records, and the core spec recommends against bolting encryption onto existing primitives. Every PDS record is public by default today. Publishing admin action history (price changes, internal operations) as PDS records would mean leaking that data publicly. This is parked, not killed — revisit once ATProto private data lands.
- **v1 default instead: a conventional backend DB audit/activity log.** Not signed, not portable, not published to the PDS — just an internal record of who did what, for support and debugging. Cheap to include now; doesn't conflict with deferring the portable version later.

### Investment areas

Three buckets of ergonomic tooling, to be designed once the payment map is complete:

1. **Site presentation** — storefront content, branding
2. **Business-critical** — orders, payments, payouts, listings
3. **Data-heavy** — inventory views at scale

---

## MVP inventory scope

- **Digital-only.** Physical goods upload and multi-artist support remain explicitly deferred, carried over from the Phase 1 summary.
- **Strictly music.** No expansion to other content categories for MVP. Liner notes, artwork, and video bundled _into_ a music release remain fine since they're still part of selling the music, not a separate product line.

---

## Action items / next steps

- [ ] Write the multi-processor operational runbook (see skeleton above)
- [ ] Map the crypto rail (stablecoin, custody, confirmation model)
- [ ] Draft the `purchase.entitlement` record shape for rentals/day-passes/subscriptions
- [ ] Design the agent hook API surface and DID-delegation/auth model
- [ ] Build the guest-checkout magic-link + PII purge mechanism (30-day / 3-download cap, whichever first)
- [ ] Define financial-ledger retention duration for the runbook's tax reporting matrix
- [ ] Design the three admin panel categories in detail once the payment map is complete
