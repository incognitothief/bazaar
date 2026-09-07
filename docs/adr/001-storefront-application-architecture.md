# ADR 001: Storefront Application Architecture

- **Status:** Accepted
- **Date:** 2026-04-02
- **Supersedes:** `.alignment/260402-scaffold-ui/PLAN.md`
- **Superseded by:** —
- **Relates to:** [ADR 000](000-bootstrap-architecture.md)

## Context

[ADR 000](000-bootstrap-architecture.md) defines how Bazaar deploys: one Bun/Hono
container, SQLite for app state, R2 for blobs and backups. It does not define how
merchants and buyers interact with the store.

Bazaar is a **decentralized-commerce storefront**: catalog, listings, licenses, and
purchase receipts live as AT Protocol lexicon records on a merchant's PDS (and,
when captured, the buyer's PDS). Payments run through Stripe. The UI must make
that model legible to non-technical operators while keeping secrets and signing
off the browser.

The alignment session produced a phased build plan (public storefront, merchant
dashboard, upload flows, Stripe webhook). This ADR extracts the **architectural
decisions** from that plan. Step-by-step gates and component inventories remain
historical context in the superseded alignment file.

## Decision

We adopt the following application architecture for `packages/client` and its
server API surface.

### UI stack

| Layer | Choice | Role |
| ----- | ------ | ---- |
| Build | **Vite 6** | Dev server (port 5173) and production bundle |
| UI | **React 19** + **TypeScript** | SPA in `packages/client` |
| Styling | **Tailwind CSS** + **shadcn/ui** | Utility classes and accessible primitives under `components/ui/` |
| Routing | **react-router-dom** | Client-side routes; no SSR |
| Forms | **react-hook-form** + **Zod** | Multi-step merchant flows with schema validation |
| Toasts | **sonner** | App-wide feedback via root `<Toaster />` |
| Payments (browser) | **@stripe/stripe-js** | Redirect to Checkout; no secret keys in the client |
| ATProto (browser) | **@atproto/api** | Merchant session agent for PDS reads/writes |

Production: Hono serves `packages/client/dist` and mounts APIs under `/api`
([ADR 000](000-bootstrap-architecture.md)). Development: Vite proxies `/api` to
the Bun server on port 3000.

### Client / server boundary

Environment variables split strictly:

- **Client (`VITE_*` only)** — ATProto service URL, app DID, lexicon namespace,
  artist DID, Stripe publishable key, app URL, API origin for OAuth redirects.
- **Server (never bundled)** — app service private key, Stripe secret + webhook
  secret, session cookies, signing material.

Rule: anything that signs, charges, or verifies webhooks stays in
`packages/server`. The browser may hold merchant OAuth JWTs in session state but
never receives server signing keys.

### Domain model: lexicon-driven types

Catalog and commerce shapes are defined by AT Protocol lexicons under namespace
`diamonds.whereditgo.bazaar.*` (defs, digital items, collections, listings,
license terms, purchase receipts, and related purchase records).

TypeScript types in the client are **derived from those schemas**, not invented
in parallel. Lexicon JSON and shared constants live in `@bazaar/shared` (the
alignment plan anticipated a future shared package; that package is now
canonical — both client and server import from it to avoid drift).

Key record types the UI reads and writes:

| Lexicon | Purpose |
| ------- | ------- |
| `catalog.item.digital` | Tracks and digital goods |
| `catalog.collection` | Albums and bundles |
| `catalog.listing` | Price and availability |
| `license.terms` | Usage rights attached to items |
| `purchase.receipt` | Signed proof of purchase on buyer PDS |
| `actor.merchant` / profile | Merchant storefront identity (evolved from early `actor.profile` in plan) |

### ATProto client roles

Two agent contexts, intentionally separate:

1. **Browser merchant agent** — created from OAuth session JWTs
   (`createSessionAgent`). Used for catalog CRUD the merchant authorizes
   directly on their PDS.
2. **Server service agent** — singleton with app credentials. Used for OAuth
   callback exchange, receipt signing, and any write that requires the app
   service key.

Typed record helpers wrap `com.atproto.repo.createRecord`, `listRecords`, and
`putRecord` with lexicon payloads. Updates preserve record keys (`putRecord`,
not a second `createRecord`).

### Routing architecture

Two layout shells:

```
PublicLayout (no auth required)
  /                         → storefront inventory
  /item/:…                  → item detail + buy flow
  /purchase/success         → post-checkout confirmation
  (+ policy pages, sign-in, buyer dashboard — added in later work)

MerchantLayout (session guard)
  /merchant/dashboard       → onboarding + stats
  /merchant/upload/*        → ingest flows
  /merchant/listings        → listing management
  /merchant/license         → license templates
  /merchant/settings        → profile + connections
```

`MerchantLayout` redirects unauthenticated users to the public shell. OAuth
`signIn` targets the **server** callback (`/api/atproto/...`) using
`VITE_API_ORIGIN`, not the Vite dev port.

Item URLs in the plan used URL-encoded AT-URIs; implementation later moved to
human-readable `/item/:rkey/:slug` paths. The decision that matters: **public
item pages are stable, shareable routes** — exact path shape may evolve in a
follow-up ADR.

### Public storefront

- **Inventory** reads digital items and collections from the artist PDS; only
  items with an **active** listing appear on the home grid.
- **Item detail** shows metadata, optional license summary, and a buy action.
- **Buy flow** requires an explicit **license consent checkbox** when
  `checkoutConsentRequired` is true (or when no license is linked). Buy is
  disabled until consent is given — this is mandatory, not optional polish.
- Checkout: browser `POST /api/stripe/checkout` with listing/item references →
  server creates Stripe Checkout Session → browser redirects to Stripe-hosted
  payment.

Stripe session metadata carries `listingUri`, `itemUri`, `listingCid`, license
grant references, and `appDid` for webhook fulfillment.

### Merchant experience

**Onboarding** is a blocking checklist: connect ATProto, connect Stripe, then
optional license and first-upload prompts. Blocking items gate perceived
readiness; non-blocking items are dismissible.

**Digital upload** is a **multi-step form** (file & basics → deferred metadata →
license → price/listing) backed by one `react-hook-form` + Zod schema:

- Step 1 is blocking: audio file, title, artist name, item class.
- Step 2 is deferred: description, genre, ISRC/ISWC, PRO fields — all optional
  with a "skip for now" path.
- Step 3 is blocking: license via template picker or full custom form.
- Step 4 sets price (integer **cents**), listing status, and schedule.

**Completeness score** (0–100) surfaces publish quality: required fields (~60%),
recommended (~25%), optional (~15%). Used in upload UI and dashboard list rows.

**Audio ingest** parses files in the **browser** via `music-metadata/browser`
and `parseBlob` — never `parseFile` or Node stream APIs. Parsed tags auto-fill
title, duration, format, and ISRC when present.

**Submission order** on publish (each step must succeed before the next):

1. Upload artwork blob (if any) → `artworkCid`
2. Upload audio blob → private app-layer mapping (download URL not public in lexicon)
3. Create or reuse `license.terms` record
4. Create `catalog.item.digital` record
5. Create `catalog.listing` record
6. Navigate to dashboard with success feedback

### Payments and receipts

| Step | Owner | Behavior |
| ---- | ----- | -------- |
| Checkout session | Server (`/api/stripe/checkout`) | Stripe secret; returns redirect URL |
| Payment | Stripe hosted | Buyer completes payment |
| Fulfillment | Server webhook (`/api/stripe/webhook`) | Verify signature; handle `checkout.session.completed` |

**Receipt signing (`appSig`):** server hashes
`purchasedAt:paymentRef:itemUri:listingCid:buyerDid`, signs with
`APP_SERVICE_PRIVATE_KEY`, stores signature on the `purchase.receipt` record.
Verification utility is the inverse (unit-tested round-trip).

When `buyerDid` is absent (buyer not logged in at checkout — in scope for
bootstrap UI), webhook **still returns 200** and completes payment bookkeeping;
PDS receipt write is skipped gracefully. Buyer DID capture at checkout is
explicitly deferred.

### Error, loading, and empty states

Every async UI path defines loading, success, and error surfaces (skeletons on
grids, inline dropzone errors, toast on ATProto write failure with retry).
Webhook failures are server-side only — never surfaced to the buyer mid-checkout.

### Explicitly deferred (bootstrap UI scope)

Do not implement without a new ADR:

- Physical goods upload (stub page only)
- Buyer ATProto login at checkout
- Download link generation and delivery
- PRO royalty remittance
- Multi-artist / multi-tenant
- `purchase.stock` and `purchase.fulfillment` management
- Mutual verification / attestation
- Mechanical-license compliance tooling
- i18n and multi-currency beyond USD display

## Consequences

### Positive

- **Decentralized catalog.** Merchant inventory survives beyond the Bazaar host;
  PDS records are portable and inspectable.
- **Clear trust boundary.** Payment secrets and receipt signing never ship to the
  browser bundle.
- **Operator-friendly upload.** Multi-step form with templates, deferred
  metadata, and completeness scoring matches "publish now, enrich later."
- **Consent before commerce.** License checkbox prevents accidental purchases
  without terms acknowledgment.
- **One design system.** Tailwind + shadcn/ui keeps UI consistent and
  accessible-by-default when labels and `aria-*` are applied.
- **Shared lexicons prevent drift.** `@bazaar/shared` gives client and server the
  same schema source.

### Negative / trade-offs

- **PDS write latency and failure modes.** Publishing is multi-record and
  network-dependent; partial failure handling is complex.
- **Browser audio parsing limits.** Large files and exotic formats depend on
  `music-metadata` browser support; server-side parsing is a separate path.
- **Stripe redirect checkout.** Simple and PCI-light, but leaves the SPA during
  payment and complicates deep mobile WebView flows.
- **Buyer receipt gap without buyer login.** Payments succeed but receipts may
  not land on a buyer PDS until a later identity flow ships.
- **Lexicon rigidity.** Schema changes require lexicon version bumps and
  coordinated client/server updates.
- **Phased plan complexity.** The original alignment doc is long; agents should
  read this ADR for *why* and the code for *what shipped*.

## Considered alternatives

- **Catalog in SQLite only.** Rejected: defeats decentralized portability;
  ATProto records are the merchant-facing source of truth for listings the world
  can read.
- **Stripe entirely in the browser.** Rejected: webhooks, Connect, and receipt
  signing require server secrets.
- **Server-rendered pages (SSR).** Rejected: conflicts with ADR 000's static
  SPA-from-Hono model; Vite + client routing is the chosen dev/prod path.
- **Duplicate lexicon types per package.** Rejected in favor of `@bazaar/shared`
  to avoid client/server schema drift.
- **Skip license consent at checkout.** Rejected: legal/UX requirement for
  template and custom licenses with `checkoutConsentRequired`.
