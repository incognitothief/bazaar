# ADR 0004: Payment flow and PDS fulfillment

## Status

Accepted

## Date

2026-04-04

## Context

Bazaar completes purchases through Stripe Checkout and writes `purchase.receipt` and `purchase.consent` records to the buyer's PDS. These records are the core trust artifact; download entitlement and storefront UI consume them downstream. See ADR 0003 for lexicon field definitions.

The initial plan keyed idempotency off SQLite `meta` rows written only after both PDS records succeeded. That left a crash window where a receipt could be created on the PDS but consent failed, causing duplicate receipt writes on retry. Stripe webhooks also return 200 on most failures, so transient PDS errors need an internal retry path.

## Decision

### 1. Checkout entry (client)

`BuyButton` requires a buyer ATProto session (`useAtpSession`). Unsigned users see **Sign in to purchase** with `returnTo` back to the item page.

When `license.terms.checkoutConsentRequired` is true (or terms are unknown), a clickwrap checkbox must be checked before buy is enabled.

`POST /api/stripe/checkout` body includes `listingUri`, `itemUri`, and **`buyerDid`** (session DID). When Stripe is configured, missing or invalid `buyerDid` returns **400**.

The server creates a Stripe Checkout Session (payment mode) with metadata: `listingUri`, `itemUri`, `listingCid`, `appDid`, `buyerDid`. The browser redirects to Stripe's hosted checkout URL.

### 2. Server routes (`packages/server/src/routes/stripe.ts`)

| Route | Role |
|-------|------|
| `POST /checkout` | Create Checkout Session; embed listing snapshot CID |
| `POST /webhook` | Verify Stripe signature; handle `checkout.session.completed` |
| `POST /fulfill-session` | Client-triggered fulfillment after redirect (local dev / delayed webhooks) |

`createStripeRouter` receives `oauthClient` (same pattern as ATProto routes) for PDS writes without a browser cookie.

Stripe credentials resolve from environment variables or merchant-configured keys persisted in SQLite (`getStripe`).

### 3. Fulfillment pipeline

Core logic lives in `packages/server/src/lib/stripe/fulfillCheckoutSession.ts` (`fulfillCheckoutSession`).

On `checkout.session.completed` (webhook) or `/fulfill-session` (client, cookie DID must match `metadata.buyerDid`):

1. **PaymentIntent** — Retrieve PI; require `status === "succeeded"`. Use PI id as `paymentRef`.
2. **Listing snapshot** — `getRecord` for listing; validate `listingCid` metadata matches checkout anchor.
3. **Price** — Compare PI `amount_received` and currency to listing `price` (smallest-unit semantics). Mismatch: log, mark dead-letter or skip writes; still return **200** to Stripe where applicable.
4. **Receipt** — Build `purchase.receipt` (v5 fields including `buyerDid`, `licenseGrantUri`/`licenseGrantCid` from listing, `appSig` via `signReceiptPayload`). Optional `kid` when `APP_MERCHANT_KID` is set (see ADR 0011).
5. **Consent** — Build `purchase.consent` with `signConsentPayload` over `buyerDid:licenseGrantCid:receiptCid:consentedAt` (same instant as `purchasedAt` for MVP).
6. **PDS writes** — `oauthClient.restore(buyerDid)` → `Agent` → `com.atproto.repo.createRecord` on buyer repo for receipt, then consent.

**Dev mock sign-in** (`VITE_DEV_MOCK_ATPROTO_SIGNIN`) does not create a server OAuth session; webhook and fulfillment PDS writes fail for mock buyers until real OAuth is used.

### 4. `payment_fulfillment` state machine

SQLite table `payment_fulfillment` (Drizzle schema) keyed by Stripe PaymentIntent id (`pi_…`).

| Column | Purpose |
|--------|---------|
| `status` | `pending` → `processing` → `receipt_written` → `completed`; or `failed` / `dead_letter` |
| `receipt_uri`, `receipt_cid`, `consent_uri` | Resume: skip `createRecord` when URI already set |
| `attempt_count`, `next_retry_at`, `last_error` | Retry backoff |
| `buyer_did`, `checkout_session_id`, `payload_snapshot` | Support / sweeper inputs |

**Claiming** — Transactional row claim prevents concurrent duplicate work. Stale `processing` locks are re-claimed after 120s.

**PDS reconciliation** — Before creating a receipt, list buyer repo for existing `paymentRef`; before consent, list for existing `receiptUri`. Mitigates the narrow crash window between PDS accept and DB update.

**Retry sweeper** — `sweepPaymentFulfillment` runs on an interval from server startup (`BAZAAR_FULFILLMENT_SWEEP_MS`, default 45s; `0` disables). Retries `failed` and incomplete `receipt_written` rows with exponential backoff (max 30 attempts).

**Legacy backfill** — `backfillPaymentFulfillmentFromMeta` copies completed `purchase_pds:*` meta keys into `payment_fulfillment` at startup.

### 5. Signing (`packages/server/src/lib/atproto/sign.ts`)

- **Receipt:** `SHA-256(purchasedAt:paymentRef:itemUri:listingCid:buyerDid)` → RSA-SHA256 `appSig` (base64url).
- **Consent:** `SHA-256(buyerDid:licenseGrantCid:receiptCid:consentedAt)` → RSA-SHA256 `appSig`.
- `verifyReceiptPayload` / `verifyConsentPayload` for round-trip tests.
- Signing key: `APP_MERCHANT_PRIVATE_KEY` PEM; `APP_DID` on records.

### 6. Preconditions

- **Env:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_DID`, `APP_MERCHANT_PRIVATE_KEY`, reachable `ATPROTO_SERVICE`.
- **Buyer PDS** must allow creating `diamonds.whereditgo.bazaar.*` records.
- **Local webhooks:** `stripe listen --forward-to localhost:3000/api/stripe/webhook` with a buyer who completed real OAuth through the app.

## Constraints

| Rule | Value / location |
|------|------------------|
| Buyer DID at checkout | Required when Stripe enabled |
| Idempotency key | PaymentIntent id |
| Webhook signature | Required (`STRIPE_WEBHOOK_SECRET`) |
| Fulfillment module | `fulfillCheckoutSession.ts` |
| Max sweeper attempts | 30 per PI |

## Consequences

**Positive**

- Receipt + consent on buyer PDS enable decentralized proof of purchase and license agreement.
- `payment_fulfillment` resume semantics prevent duplicate receipts under retry and concurrent webhook delivery.
- `/fulfill-session` unblocks local development without reliable webhooks.

**Negative / trade-offs**

- Buyers must OAuth through Bazaar before purchase; no anonymous checkout.
- Transient OAuth/PDS failures may delay `completed` until the sweeper succeeds.
- At-most-once on PDS is best-effort: crash between PDS write and DB update still possible; mitigated by repo listing, not cryptographic rkeys.
- Stripe Connect / merchant payout observability remain separate from this fulfillment path.

**Deferred**

- Download URL generation and entitlement enforcement.
- Deterministic `rkey` / `putRecord` for cryptographic at-most-once on PDS.
- Separate admin reconciliation job (PDS vs DB).
- `usageTier` / `syncProject` on consent via checkout metadata.
