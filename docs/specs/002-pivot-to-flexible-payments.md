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
- **Subscriptions** — a different entitlement shape than `purchase.receipt`'s point-in-time model; likely needs its own lightweight "current period" record rather than living inside the receipt. Not yet mapped.
- **Rentals** — closer to what exists already; probably just a receipt with an `expiresAt` and a backend access-check change rather than new lexicon work. Not yet mapped in detail.
- **Agentic microtransactions** — framing undecided. Could mean AI agents shopping on a human's behalf, machine-to-machine micropayments (agent pays per request/asset, x402-style), or both. Likely shares plumbing with whatever the crypto rail ends up being, since card and P2P rails have no concept of sub-dollar autonomous payments.

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
- [ ] Map subscriptions and rentals as entitlement shapes
- [ ] Resolve the agentic microtransactions framing
- [ ] Design the three admin panel categories in detail once the payment map is complete
