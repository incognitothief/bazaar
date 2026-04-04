# Bazaar — UI Build Plan
**Version:** 1.2  
**Target executor:** AI agent  
**Stack:** Vite 6, React 19, TypeScript, **Tailwind CSS**, **shadcn/ui**, client-side routing (`react-router-dom`), Hono on Bun (`packages/server`) for `/api` and production static hosting, AT Protocol SDK (`@atproto/api`), Stripe.js  
**Monorepo:** npm workspaces + Turbo; UI in `packages/client`, API in `packages/server`  
**Lexicon namespace:** `diamonds.whereditgo.bazaar.*`

---

## Conventions used in this document

- `[BLOCKING]` — task must be complete and validated before downstream tasks begin
- `[AUTO]` — field or value is system-generated; no user input required
- `[DEFERRED]` — field is optional at first publish; UI must surface it as incomplete but not block
- `[GATE]` — explicit validation checkpoint; agent must assert all gate conditions before proceeding
- `[SCHEMA:field]` — references a specific field in the lexicon schemas defined in the project context
- **Paths:** `packages/client/...` for the SPA; `packages/server/...` for Hono routes and server-only libraries (secrets, webhooks, Stripe session creation)
- **Dev:** Vite serves the client on port **5173** and proxies `/api` to the Bun server on **3000** (see `packages/client/vite.config.ts`). **Prod:** a single Bun process serves `packages/client/dist` and mounts API under `/api`

---

## Phase 0 — Project scaffold

### 0.1 Initialize repository `[BLOCKING]`

The repo already scaffolds **`packages/client`** (Vite + React 19 + TypeScript) and **`packages/server`** (Hono + Bun + Drizzle). Extend the client from the repository root:

```bash
cd packages/client

# Routing + forms + ATProto/Stripe in the browser
npm install react-router-dom @atproto/api zod react-hook-form @hookform/resolvers
npm install @stripe/stripe-js @stripe/react-stripe-js
npm install lucide-react clsx tailwind-merge
npm install music-metadata   # use browser entry in code — see §1.4

# Tailwind + shadcn/ui (follow CLI prompts; align with official Vite + React guide)
npx shadcn@latest init
# Typical choices: Default style, Zinc base, CSS variables: yes, paths under src/

npx shadcn@latest add button input label select textarea
npx shadcn@latest add card badge separator tabs
npx shadcn@latest add dialog sheet form
npx shadcn@latest add progress toast sonner

# Optional: ESLint/Prettier for the client if not already wired at repo level
```

**Styling:** Use **Tailwind** utility classes and **shadcn/ui** primitives (`components/ui/*`). Prefer `cn()` from `lib/utils.ts` for conditional classes. Keep global tokens in `src/index.css` only as required by shadcn/Tailwind setup. Mount **`<Toaster />`** (sonner) once near the root in `App.tsx` so toast APIs work app-wide.

**Server packages** (install under `packages/server` when implementing API features):

```bash
cd packages/server
# e.g. npm install @atproto/api stripe ...
```

**Validation:** From repo root, `npm run build` (Turbo) exits 0; `packages/client` TypeScript is clean.

---

### 0.2 Environment variables

Split **client-exposed** vs **server-only** (Vite only exposes vars prefixed `VITE_`).

**`packages/client/.env`** (stubs only; no real secrets):

```env
# Exposed to the browser via import.meta.env.VITE_*
VITE_ATPROTO_SERVICE=https://bsky.social
VITE_APP_DID=did:plc:PLACEHOLDER
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_PLACEHOLDER
VITE_APP_URL=http://localhost:5173
VITE_LEXICON_NAMESPACE=diamonds.whereditgo.bazaar
VITE_ARTIST_DID=did:plc:PLACEHOLDER
# Origin of the Bun API (OAuth callback, cookies); differs from Vite port in dev
VITE_API_ORIGIN=http://localhost:3000
```

**`packages/server/.env`** (never shipped to the client):

```env
# ATProto / app service
ATPROTO_SERVICE=https://bsky.social
APP_DID=did:plc:PLACEHOLDER
APP_SERVICE_PRIVATE_KEY=PLACEHOLDER

# Stripe
STRIPE_SECRET_KEY=sk_test_PLACEHOLDER
STRIPE_WEBHOOK_SECRET=whsec_PLACEHOLDER

# URLs used by server redirects and Stripe callbacks (use prod URL in production)
APP_URL=http://localhost:3000
LEXICON_NAMESPACE=diamonds.whereditgo.bazaar
```

Add `/// <reference types="vite/client" />` and extend `ImportMetaEnv` in `packages/client/src/vite-env.d.ts` for typed `import.meta.env`.

**Validation:** Both env files contain all keys as stubs. No real credentials committed.

---

### 0.3 Directory structure

Create the following trees. Files may be empty stubs at this stage.

**Client (`packages/client/src/`):**

```
packages/client/src/
├── main.tsx
├── App.tsx                                 # Router outlet + providers
├── index.css                               # Tailwind directives + globals (per shadcn init)
├── routes/
│   ├── PublicLayout.tsx                    # shell: header / footer / <Outlet />
│   ├── HomePage.tsx                        # storefront home / inventory
│   ├── ItemDetailPage.tsx                  # route: /item/:uri (AT-URI URL-encoded)
│   ├── PurchaseSuccessPage.tsx             # /purchase/success?session_id=
│   ├── MerchantLayout.tsx                  # auth guard + sidebar
│   ├── DashboardPage.tsx
│   ├── UploadDigitalPage.tsx
│   ├── UploadPhysicalPage.tsx              # deferred — stub only
│   ├── ListingsPage.tsx
│   ├── LicensePage.tsx
│   └── SettingsPage.tsx
├── components/
│   ├── ui/                                 # shadcn primitives
│   ├── public/
│   │   ├── InventoryGrid.tsx
│   │   ├── ItemCard.tsx
│   │   ├── CollectionDetail.tsx
│   │   ├── TrackList.tsx
│   │   └── BuyButton.tsx
│   ├── merchant/
│   │   ├── DigitalUploadForm.tsx
│   │   ├── TrackListBuilder.tsx
│   │   ├── ListingForm.tsx
│   │   ├── LicensePickerSimple.tsx
│   │   ├── LicenseFormFull.tsx
│   │   ├── CompletenessIndicator.tsx
│   │   └── OnboardingChecklist.tsx
│   └── shared/
│       ├── AudioFileDropzone.tsx
│       ├── ImageDropzone.tsx
│       ├── FormatBadge.tsx
│       └── MetadataChip.tsx
├── lib/
│   ├── atproto/
│   │   ├── session.ts                      # createSessionAgent (browser; VITE_*)
│   │   ├── records.ts                      # typed helpers safe to run in browser
│   │   └── lexicons.ts                     # lexicon JSON (importable from either package)
│   ├── stripe/
│   │   └── client.ts                       # loadStripe(VITE_STRIPE_PUBLISHABLE_KEY)
│   ├── audio/
│   │   └── parse.ts
│   └── utils.ts
├── types/
│   ├── lexicons.ts
│   └── index.ts
└── hooks/
    ├── useAtpSession.ts
    ├── useCatalog.ts
    └── useCompletenessScore.ts
```

**Server (`packages/server/src/`):** extend the existing Hono app.

```
packages/server/src/
├── index.ts                                # existing: mount api, static, SPA fallback
├── api.ts                                  # compose route modules
├── routes/
│   ├── atproto.ts                          # OAuth callback, session, sign-in redirect
│   ├── stripe.ts                           # checkout session, webhook, connect
│   └── catalog.ts                          # optional public item resolver
└── lib/
    ├── atproto/
    │   ├── client.ts                       # service agent singleton (secrets)
    │   ├── records.ts                      # server-side writes if not duplicated in client
    │   └── sign.ts                         # appSig (Node crypto / Web Crypto on Bun)
    └── db/                                 # existing Drizzle
```

**Note:** Prefer **one** canonical place for `lexicons.ts` and generated TS types (e.g. `packages/client` + re-export from server, or a future `packages/shared`) to avoid drift.

**React Router map (illustrative):** `/` and `/item/:uri`, `/purchase/success` under `PublicLayout`; `/merchant/dashboard`, `/merchant/upload/digital`, `/merchant/upload/physical`, `/merchant/listings`, `/merchant/license`, `/merchant/settings` under `MerchantLayout` (prefix group path `/merchant` in `App.tsx`).

**Validation:** All directories and stub files exist. `npm run build` at repo root still exits 0.

---

## [GATE 0] Phase 0 complete

Assert:
- [ ] `npm run build` (repo root / Turbo) exits 0
- [ ] All directories from 0.3 exist
- [ ] `packages/client/.env` and `packages/server/.env` contain all required keys as stubs
- [ ] No real credentials in any file

---

## Phase 1 — Types, lexicons, and ATProto client

### 1.1 Lexicon definitions `[BLOCKING]`

Populate `packages/client/src/lib/atproto/lexicons.ts` (or shared package) with the full JSON lexicon objects for all schemas defined in the project context. Export each as a named constant:

```typescript
export const LEXICON_DEFS = { /* diamonds.whereditgo.bazaar.defs */ }
export const LEXICON_TRACK = { /* diamonds.whereditgo.bazaar.catalog.item.digital */ }
export const LEXICON_COLLECTION = { /* diamonds.whereditgo.bazaar.collection */ }
export const LEXICON_LISTING = { /* diamonds.whereditgo.bazaar.catalog.listing */ }
export const LEXICON_LICENSE_TERMS = { /* diamonds.whereditgo.bazaar.license.terms */ }
export const LEXICON_RECORDING = { /* diamonds.whereditgo.bazaar.catalog.recording */ }
export const LEXICON_RECEIPT = { /* diamonds.whereditgo.bazaar.purchase.receipt */ }
export const LEXICON_STOCK = { /* diamonds.whereditgo.bazaar.purchase.stock */ }
export const LEXICON_FULFILLMENT = { /* diamonds.whereditgo.bazaar.purchase.fulfillment */ }
```

---

### 1.2 TypeScript types `[BLOCKING]`

Populate `packages/client/src/types/lexicons.ts`. All types must be derived from the lexicon schemas. Key types:

```typescript
// Shared defs
export type Money = { amount: number; currency: string }
export type Dimensions = { width?: number; height?: number; depth?: number; unit: 'mm' | 'cm' | 'in' }
export type Weight = { value: number; unit: 'g' | 'kg' | 'oz' | 'lb' }
export type Variant = {
  sku: string
  attributes: Record<string, string>
  weight?: Weight
  dimensions?: Dimensions
  additionalPrice?: Money
  artworkCid?: string
}
export type ItemRef = {
  uri: string
  cid?: string
  variantSku?: string
  itemType: string
}
export type Address = {
  line1: string
  line2?: string
  city: string
  region?: string
  postalCode?: string
  countryCode: string
}

// Catalog
export type DigitalItem = {
  $type: 'diamonds.whereditgo.bazaar.catalog.item.digital'
  title: string
  artistDid: string
  itemClass: 'track' | 'album' | 'samplePack' | 'preset' | 'stems' | 'video' | 'ebook' | 'other'
  description?: string
  formats: string[]
  durationMs?: number
  releaseDate?: string
  artworkCid?: string
  genre?: string[]
  isrc?: string
  iswc?: string
  defaultLicenseUri?: string
  createdAt: string
}

export type Collection = {
  $type: 'diamonds.whereditgo.bazaar.collection'
  title: string
  artistName: string
  collectionType?: 'album' | 'ep' | 'single' | 'bundle' | 'compilation'
  releaseDate: string
  tracks: Array<{ uri: string; cid?: string; trackNumber?: number; discNumber?: number }>
  artworkCid?: string
  genre?: string[]
  upc?: string
  price?: Money
  createdAt: string
}

export type Listing = {
  $type: 'diamonds.whereditgo.bazaar.catalog.listing'
  item: ItemRef
  price: Money
  compareAtPrice?: Money
  status: 'active' | 'paused' | 'soldOut' | 'scheduled' | 'archived'
  availableFrom?: string
  availableUntil?: string
  maxPurchasesPerBuyer?: number
  createdAt: string
}

export type TerritoryCoverage = {
  scope: 'worldwide' | 'excluding' | 'only'
  territories?: string[]
}

export type LicenseTerms = {
  $type: 'diamonds.whereditgo.bazaar.license.terms'
  title: string
  tier: 'personal' | 'commercial' | 'syncMaster' | 'syncPublishing' | 'syncFull' | 'mechanical' | 'broadcast' | 'stemLicense'
  rightsType: 'master' | 'publishing' | 'both'
  version: string
  territoryCoverage: TerritoryCoverage
  term?: { durationMonths?: number; expiresAt?: string }
  usageRestrictions?: {
    allowsStreaming?: boolean
    allowsDownload?: boolean
    allowsCommercialUse?: boolean
    allowsDerivatives?: boolean
    allowsSync?: boolean
    allowsBroadcast?: boolean
    requiresAttribution?: boolean
    requiresMechanicalReporting?: boolean
  }
  proNotice?: {
    compositionPro?: string
    publishingOwnerIpi?: string
    masterOwnerDid?: string
  }
  legalMetadata?: {
    governingLaw?: string
    disputeVenue?: string
    copyrightRegistrationId?: string
    copyrightYear?: number
    proMembership?: string
  }
  humanReadableUrl?: string
  summary?: string
  editionSize?: number
  checkoutConsentRequired: boolean
  createdAt: string
}

export type PurchaseReceipt = {
  $type: 'diamonds.whereditgo.bazaar.purchase.receipt'
  item: ItemRef
  listingUri: string
  listingCid: string
  pricePaid: Money
  paymentProcessor: string
  paymentRef: string
  licenseGrantUri?: string
  licenseGrantCid?: string
  shippingAddress?: Address
  fulfillmentUri?: string
  appDid: string
  issuerScope: string
  appSig: string
  purchasedAt: string
  note?: string
}

// Derived / UI types
export type CatalogItem = DigitalItem | Collection
export type CompletenessScore = {
  score: number          // 0–100
  required: string[]     // missing required fields
  recommended: string[]  // missing recommended fields
  optional: string[]     // missing optional fields
}
```

---

### 1.3 ATProto client `[BLOCKING]`

**Server** — `packages/server/src/lib/atproto/client.ts` (service role, secrets):

```typescript
import { BskyAgent } from '@atproto/api'

let _agent: BskyAgent | null = null

export function getAgent(): BskyAgent {
  if (!_agent) {
    _agent = new BskyAgent({ service: process.env.ATPROTO_SERVICE! })
  }
  return _agent
}
```

**Client** — `packages/client/src/lib/atproto/session.ts` (merchant session in the browser):

```typescript
import { BskyAgent } from '@atproto/api'

export function createSessionAgent(accessJwt: string, refreshJwt: string, did: string): BskyAgent {
  const agent = new BskyAgent({ service: import.meta.env.VITE_ATPROTO_SERVICE })
  agent.session = { accessJwt, refreshJwt, did, handle: '', email: '' }
  return agent
}
```

Populate **`packages/client/src/lib/atproto/records.ts`** (and/or server-side duplicates only if needed) with typed wrappers:

```typescript
// Each function takes a BskyAgent and typed record payload.
// Returns the created record URI and CID.

export async function createDigitalItem(agent, record: Omit<DigitalItem, '$type' | 'createdAt'>): Promise<{ uri: string; cid: string }>
export async function createCollection(agent, record: Omit<Collection, '$type' | 'createdAt'>): Promise<{ uri: string; cid: string }>
export async function createListing(agent, record: Omit<Listing, '$type' | 'createdAt'>): Promise<{ uri: string; cid: string }>
export async function createLicenseTerms(agent, record: Omit<LicenseTerms, '$type' | 'createdAt'>): Promise<{ uri: string; cid: string }>
export async function createReceipt(agent, record: Omit<PurchaseReceipt, '$type'>): Promise<{ uri: string; cid: string }>
export async function listCatalogItems(agent, did: string): Promise<DigitalItem[]>
export async function listCollections(agent, did: string): Promise<Collection[]>
export async function listListings(agent, did: string): Promise<Listing[]>
export async function listLicenseTerms(agent, did: string): Promise<LicenseTerms[]>
```

Each function body calls `agent.api.com.atproto.repo.createRecord` or `listRecords` with the appropriate `collection` (lexicon NSID) and typed payload.

---

### 1.4 Audio file parser `[BLOCKING]`

Populate `packages/client/src/lib/audio/parse.ts`.

**`music-metadata` in the browser (`[BLOCKING]` for implementers):** The package is primarily Node-oriented. In the **Vite client** you **must** import the browser build and **`parseBlob`**, which accepts a **`Blob`** (a `File` is a `Blob`). Do **not** use `parseFile`, `parseStream`, or the default/root import — they assume Node and **will fail** in the browser bundle.

```typescript
import * as mm from 'music-metadata/browser'

export type ParsedAudioMeta = {
  durationMs: number
  format: string          // 'flac' | 'mp3' | 'wav' | 'aac' | 'ogg' | 'unknown'
  bitrate?: number
  sampleRate?: number
  channels?: number
  title?: string          // from embedded ID3/Vorbis tags if present
  artist?: string
  album?: string
  trackNumber?: number
  isrc?: string           // from ISRC tag if embedded
}

// Browser-only: File from <input type="file"> or drag-and-drop.
export async function parseAudioFile(file: File): Promise<ParsedAudioMeta> {
  const metadata = await mm.parseBlob(file)
  // Map `metadata` fields → ParsedAudioMeta (duration, format, tags, etc.)
}
```

If you ever only have an **`ArrayBuffer`**, wrap it: `new Blob([buffer], { type: mimeType })` and pass that to `parseBlob`. Server-side parsing (if added later under `packages/server`) may use Node APIs separately — do not share one implementation blindly.

Format detection priority: file MIME type → file extension → parsed metadata / magic bytes as exposed by the library.

---

### 1.5 Completeness score hook

Populate `packages/client/src/hooks/useCompletenessScore.ts`:

```typescript
// Given a partial DigitalItem or Collection, returns a CompletenessScore.
// Required fields (blocking): title, artistDid, itemClass, formats, one file
// Recommended fields (+score): artwork, description, genre, releaseDate
// Optional fields (+score): isrc, iswc, proMembership, defaultLicenseUri

export function useCompletenessScore(item: Partial<DigitalItem | Collection>): CompletenessScore
```

Score formula:
- Each required field present: contributes to base 60 points (60 / n_required per field)
- Each recommended field present: contributes to next 25 points  
- Each optional field present: contributes to final 15 points
- Score is always 0–100, integer

---

### 1.6 Platform default license templates `[BLOCKING]`

Define in `packages/client/src/lib/atproto/records.ts` (or shared module) as static constants. These are the pre-built templates for the simple license picker. They are NOT written to the PDS at this stage — they are written when the artist first selects one.

```typescript
export const LICENSE_TEMPLATES = {
  personalOnly: {
    title: 'Personal use only',
    tier: 'personal',
    rightsType: 'both',
    version: '1.0',
    territoryCoverage: { scope: 'worldwide' },
    usageRestrictions: {
      allowsStreaming: true,
      allowsDownload: true,
      allowsCommercialUse: false,
      allowsDerivatives: false,
      allowsSync: false,
      requiresAttribution: false,
    },
    checkoutConsentRequired: true,
    humanReadableUrl: `${import.meta.env.VITE_APP_URL}/licenses/personal-v1`,
    summary: 'Buyer may download and listen for personal use only. No commercial use, no derivatives, no sync.',
  },
  ccByNcNd: { /* CC BY-NC-ND 4.0 parameters */ },
  ccByNc: { /* CC BY-NC 4.0 parameters */ },
} as const

export type LicenseTemplateKey = keyof typeof LICENSE_TEMPLATES
```

---

## [GATE 1] Phase 1 complete

Assert:
- [ ] All types in `packages/client/src/types/lexicons.ts` compile with no errors
- [ ] `packages/server/src/lib/atproto/client.ts` exports `getAgent`
- [ ] `packages/client/src/lib/atproto/session.ts` exports `createSessionAgent`
- [ ] `packages/client/src/lib/atproto/records.ts` exports all 9 record functions with correct signatures (or documented split with server)
- [ ] `packages/client/src/lib/audio/parse.ts` exports `parseAudioFile` with correct return type
- [ ] `LICENSE_TEMPLATES` has `personalOnly`, `ccByNcNd`, `ccByNc` keys
- [ ] `npm run build` (repo root) exits 0

---

## Phase 2 — Public storefront

### 2.1 Public layout `packages/client/src/routes/PublicLayout.tsx`

Wire in `App.tsx` with React Router (e.g. parent route with `<Outlet />`). Minimal shell. No authentication. Renders:
- Site header: app name "bazaar", nav link to merchant login (top-right)
- Main content slot
- Footer: app name, link to artist dashboard

No auth checks in this layout.

---

### 2.2 Inventory grid `packages/client/src/routes/HomePage.tsx`

**Data source:** Reads `catalog.item.digital` and `collection` records from the artist's PDS using `listCatalogItems` and `listCollections`. The artist DID is read from env (`import.meta.env.VITE_ARTIST_DID`). Only items that have an associated `active` listing are displayed.

**Component: `InventoryGrid`**

Props:
```typescript
{ items: CatalogItem[]; listings: Record<string, Listing> }
// listings keyed by item AT-URI
```

Renders a responsive grid (2 cols mobile, 3 cols tablet, 4 cols desktop).

**Component: `ItemCard`**

Props:
```typescript
{ item: CatalogItem; listing: Listing }
```

Renders:
- Artwork image (artworkCid resolved to blob URL via ATProto, fallback to placeholder)
- Title
- Artist name
- `FormatBadge` for each available format (e.g. FLAC, MP3, WAV)
- Price from listing (formatted as `$12.00` — divide `amount` by 100, use `currency`)
- For collections: track count badge
- Click → navigates to `/item/:uri` where `uri` is the AT-URI (URL-encoded segment)

No buy button on the card. Buy only on detail page.

---

### 2.3 Item detail page `packages/client/src/routes/ItemDetailPage.tsx`

React Router param `uri` is a URL-encoded AT-URI (`useParams()`).

**Sections rendered:**

1. **Hero** — full-width artwork, title, artist name, price
2. **Metadata strip** — release date, formats, duration (if track), track count (if collection), genre tags
3. **Track list** (collections only) — `TrackList` component, shows title + duration per track
4. **Description** — markdown-rendered if present
5. **License summary** — if `defaultLicenseUri` is set, fetch and render the `summary` field from the linked `license.terms` record. If not set, render: *"Personal use license. Download and listen for your own enjoyment."*
6. **Legal identifiers** (collapsed by default) — ISRC, ISWC if present. Visible on expand.
7. **Buy section** — `BuyButton` component

**Component: `BuyButton`**

Props:
```typescript
{ listing: Listing; item: CatalogItem; licenseTerms?: LicenseTerms }
```

Behavior:
1. If `licenseTerms.checkoutConsentRequired === true` (or no licenseTerms): render a consent checkbox before the buy button is enabled.
   - Checkbox label: *"I agree to the [license terms](#) for this purchase."* — link opens license `humanReadableUrl` in new tab
   - Buy button is `disabled` until checkbox is checked
2. On click (checkbox checked): POST to `/api/stripe/checkout` (proxied to Bun in dev) with `{ listingUri, itemUri, buyerDid? }`
3. Redirect to Stripe Checkout URL returned from API

This consent step is `[BLOCKING]` — do not implement the buy flow without it.

**Hono route:** implement as `POST /stripe/checkout` mounted under `packages/server/src/api.ts` (full path `/api/stripe/checkout`).

POST handler:
- Receives `{ listingUri, itemUri }`
- Fetches listing record, resolves price
- Creates a Stripe Checkout Session (Payment mode, not subscription)
  - `line_items`: item title + price
  - `metadata`: `{ listingUri, itemUri, listingCid, licenseGrantUri, licenseGrantCid, appDid }`
  - `success_url`: `${APP_URL}/purchase/success?session_id={CHECKOUT_SESSION_ID}` (same origin as the SPA when served from Bun)
  - `cancel_url`: `${APP_URL}/item/${encodeURIComponent(itemUri)}` (or equivalent per-item path)
- Returns `{ url: string }` (Stripe Checkout URL)

---

### 2.4 Purchase success page `packages/client/src/routes/PurchaseSuccessPage.tsx`

Reads `session_id` from query params (`useSearchParams()`). Prefer confirming payment via a small **GET** `/api/stripe/session-status?session_id=` (or similar) on Hono so the Stripe secret stays server-side.

Renders:
- Confirmation message
- Item title and artwork
- Receipt AT-URI (once written — see Phase 4 webhook)
- Link to download (deferred — stub only, renders "Your download link will arrive shortly")
- Instruction: *"Your receipt has been saved to your ATProto account."* (if buyer DID was captured)

Note: receipt writing happens in the Stripe webhook handler (Phase 4), not here.

---

## [GATE 2] Phase 2 complete

Assert:
- [ ] Public home page renders without auth
- [ ] ItemCard renders for both `DigitalItem` and `Collection` types without crash
- [ ] Detail page renders all 7 sections; gracefully handles missing optional fields
- [ ] BuyButton renders consent checkbox; buy button is disabled until checked
- [ ] `POST /api/stripe/checkout` on the Bun server returns a valid-shaped response (mock Stripe call acceptable at this stage)
- [ ] `npm run build` exits 0

---

## Phase 3 — Merchant authentication and dashboard

### 3.1 ATProto OAuth flow

**`packages/server/src/routes/atproto.ts`** (mounted at `/api/atproto`) — e.g. `GET /api/atproto/callback` handles the OAuth callback from the PDS. Exchanges code for access/refresh JWT. Sets httpOnly session cookie.

**`packages/client/src/hooks/useAtpSession.ts`**

```typescript
export type AtpSession = {
  did: string
  handle: string
  accessJwt: string
  refreshJwt: string
}

export function useAtpSession(): {
  session: AtpSession | null
  loading: boolean
  signIn: () => void    // redirects to PDS OAuth
  signOut: () => void
}
```

`signIn` redirects to `${ATPROTO_SERVICE}/oauth/authorize` with correct params (e.g. `client_id` and `redirect_uri` as registered for the app — typically `redirect_uri` = `${API_ORIGIN}/api/atproto/callback` on the Bun server, not the Vite dev port). Document `VITE_API_ORIGIN=http://localhost:3000` in client `.env` for constructing auth URLs in dev.

---

### 3.2 Merchant layout auth guard `packages/client/src/routes/MerchantLayout.tsx`

Client component. Calls `useAtpSession`. If `session === null` and `loading === false`, redirect to `/` (public home) with a `?login=required` query param that triggers a sign-in prompt on the public page.

Renders:
- Merchant sidebar nav: Dashboard, Upload Track, Upload Collection, Listings, License Templates, Settings
- Main content slot

---

### 3.3 Onboarding checklist `packages/client/src/components/merchant/OnboardingChecklist.tsx`

Shown at top of Dashboard until all items complete. Items:

```typescript
type OnboardingItem = {
  id: string
  label: string
  description: string
  complete: boolean
  action: { label: string; href: string }
  blocking: boolean   // if true, items below this in the list are visually locked
}

const ONBOARDING_ITEMS: OnboardingItem[] = [
  {
    id: 'atproto',
    label: 'Connect ATProto account',
    description: 'Required to publish your catalog to the decentralized web.',
    // complete: derived from session existence
    blocking: true,
    action: { label: 'Connect', href: '/api/atproto/signin' }   # server route; use full URL if opening from external context
  },
  {
    id: 'stripe',
    label: 'Connect Stripe account',
    description: 'Required to receive payments. Takes 2–10 minutes.',
    // complete: derived from Stripe Connect account status
    blocking: true,
    action: { label: 'Connect Stripe', href: '/api/stripe/connect' }
  },
  {
    id: 'license',
    label: 'Set a default license',
    description: 'Choose how buyers may use your music. You can always customize per item.',
    blocking: false,
    action: { label: 'Set license', href: '/merchant/license' }   # React Router path
  },
  {
    id: 'first_item',
    label: 'Upload your first item',
    description: 'Add a track or collection to your storefront.',
    blocking: false,
    action: { label: 'Upload', href: '/merchant/upload/digital' }   # React Router path
  }
]
```

Checklist is collapsed/dismissible once all `blocking: true` items are complete.

---

### 3.4 Dashboard `packages/client/src/routes/DashboardPage.tsx`

Renders:
1. `OnboardingChecklist` (if not dismissed)
2. Stats strip: total items, active listings, total sales (from Stripe — stub with 0 initially)
3. Recent items table: title, type, completeness score bar, listing status, actions (Edit, View, Set price)
4. CTA if no items: large upload prompt

---

## [GATE 3] Phase 3 complete

Assert:
- [ ] Navigating to `/merchant/dashboard` without a session redirects away
- [ ] With a mocked session, dashboard renders without crash
- [ ] `OnboardingChecklist` correctly shows/hides items based on completion state
- [ ] All 5 sidebar nav links render and route correctly
- [ ] `npm run build` exits 0

---

## Phase 4 — Merchant upload forms (primary deliverable)

### 4.1 `AudioFileDropzone` component

`packages/client/src/components/shared/AudioFileDropzone.tsx`

Props:
```typescript
{
  onFile: (file: File, meta: ParsedAudioMeta) => void
  onError: (msg: string) => void
  accept?: string[]    // default: ['audio/flac', 'audio/wav', 'audio/mpeg', 'audio/aac', 'audio/ogg']
  maxSizeMb?: number   // default: 500
}
```

Behavior:
- Drag-and-drop zone + click-to-browse
- On file selection: calls `parseAudioFile(file)` → passes result to `onFile`
- Shows parsed metadata preview: duration, detected format, detected title/artist from tags if present
- Shows file size and a warning if > 100MB ("Large files may take a moment to upload")
- Error states: wrong format, file too large, parse failure

---

### 4.2 `ImageDropzone` component

`packages/client/src/components/shared/ImageDropzone.tsx`

Props:
```typescript
{
  onFile: (file: File, previewUrl: string) => void
  onError: (msg: string) => void
  aspectRatio?: '1:1' | '16:9'   // default: '1:1' (album art)
  maxSizeMb?: number              // default: 10
}
```

Renders image preview after selection. Accepts JPEG, PNG, WebP. Validates minimum dimensions: 600×600 for square.

---

### 4.3 Digital upload form `packages/client/src/routes/UploadDigitalPage.tsx`

This is the core merchant form. Implemented as a multi-step form with 4 steps. State is held in a single `useForm` instance spanning all steps using `react-hook-form` with a Zod schema.

**Master Zod schema:**

```typescript
const digitalUploadSchema = z.object({
  // Step 1 — File & basics
  audioFile: z.instanceof(File),
  parsedMeta: z.object({           // populated [AUTO] from parseAudioFile
    durationMs: z.number(),
    format: z.string(),
    isrc: z.string().optional(),
  }),
  title: z.string().min(1).max(512),
  artistName: z.string().min(1).max(512),    // display name, may differ from DID
  itemClass: z.enum(['track', 'album', 'samplePack', 'preset', 'stems', 'video', 'ebook', 'other']),
  artworkFile: z.instanceof(File).optional(),

  // Step 2 — Metadata [DEFERRED]
  description: z.string().max(4096).optional(),
  genre: z.array(z.string()).optional(),
  releaseDate: z.string().optional(),         // ISO datetime
  isrc: z.string().regex(/^[A-Z]{2}-?\w{3}-?\d{2}-?\d{5}$/).optional().or(z.literal('')),
  iswc: z.string().regex(/^T-\d{9}-\d$/).optional().or(z.literal('')),
  proAffiliation: z.string().optional(),
  coWriterIpi: z.string().optional(),

  // Step 3 — License
  licenseMode: z.enum(['template', 'custom']),
  licenseTemplateKey: z.enum(['personalOnly', 'ccByNcNd', 'ccByNc']).optional(),
  customLicense: z.object({ /* mirrors LicenseTerms fields */ }).optional(),

  // Step 4 — Listing (price)
  price: z.object({
    amount: z.number().min(0),               // in cents
    currency: z.string().length(3),
  }),
  compareAtPrice: z.object({
    amount: z.number().min(0),
    currency: z.string().length(3),
  }).optional(),
  listingStatus: z.enum(['active', 'paused', 'scheduled']).default('active'),
  availableFrom: z.string().optional(),
  availableUntil: z.string().optional(),
  maxPurchasesPerBuyer: z.number().int().positive().optional(),
})
```

**Step 1 — File & basics**

Fields rendered:
| Field | Component | Notes |
|---|---|---|
| Audio file | `AudioFileDropzone` | On file select: auto-populates `title`, `isrc`, `durationMs`, `format` from parsed tags if present. User can override. |
| Title | `Input` | Pre-filled from audio tag `title` if detected. Required. |
| Artist name | `Input` | Pre-filled from audio tag `artist` if detected, else from session handle. Required. |
| Item class | `Select` | Options: Track / Album / Sample Pack / Preset Bank / Stems / Video / Ebook / Other |
| Artwork | `ImageDropzone` | Optional at this step. If absent, show gentle nudge ("Artwork increases conversion by ~40%") but do not block. |

Step 1 is `[BLOCKING]` — cannot proceed to step 2 without: audio file, title, artist name, item class.

Auto-populated `[AUTO]` fields (not shown in UI, set in form state):
- `artistDid` — from session
- `parsedMeta.durationMs` — from audio parser
- `parsedMeta.format` — from audio parser
- `createdAt` — set at submission time

---

**Step 2 — Metadata** `[DEFERRED]`

All fields in this step are optional. Render a `CompletenessIndicator` at the top showing current score. Tapping any "incomplete" item in the indicator scrolls to that field.

Fields rendered:
| Field | Component | Notes |
|---|---|---|
| Description | `Textarea` | Max 4096 chars, char counter |
| Genre | Tag input (multi) | Free text + suggest common genres |
| Release date | `DatePicker` | Defaults to today |
| ISRC | `Input` | Format hint: CC-XXX-YY-NNNNN. Inline format validation, not blocking. Shows tooltip: "What is an ISRC?" |
| ISWC | `Input` | Format hint: T-XXXXXXXXX-C. Tooltip: "What is an ISWC?" |
| PRO affiliation | `Select` | ASCAP / BMI / SESAC / SOCAN / PRS / SUISA / GEMA / Other / None |
| Co-writer IPI | `Input` | Tooltip: "If this song has co-writers, enter their IPI number. You can add more after publishing." |

At the bottom of Step 2: a skip link labeled "Skip for now — you can add this later" that advances to Step 3 without validation.

---

**Step 3 — License**

This step is `[BLOCKING]` — cannot proceed without a license selection.

Renders two modes toggled by `licenseMode`:

**Mode A: Template picker (default)**

Renders 3 cards, one per `LICENSE_TEMPLATES` key:

```
┌─────────────────────────────────┐
│  ○  Personal use only           │
│     Download + listen. No       │
│     commercial use or remixing. │
│     Worldwide · Perpetual       │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│  ○  CC BY-NC-ND                 │
│     Same as above, with         │
│     attribution required.       │
│     Internationally recognized. │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│  ○  CC BY-NC                    │
│     Non-commercial remixes      │
│     permitted with attribution. │
└─────────────────────────────────┘
      [Customize further →]
```

"Customize further" link switches to Mode B with the selected template pre-filled.

**Mode B: Full license form**

All fields from the `LicenseTerms` type rendered as form controls. Organized into collapsible sections:

1. **Basics** — title, tier, rights type, version (auto-incremented)
2. **Territory** — scope radio + territory multi-select (only shown if scope ≠ worldwide)
3. **Term** — perpetual radio OR duration months OR expiry date
4. **Permissions** — checkbox group for all `usageRestrictions` fields
5. **Rights holders** — PRO name, IPI, masterOwnerDid
6. **Legal** — governing law, dispute venue, copyright year, copyright reg ID
7. **Human-readable URL** — link to full license text (can be blank if using a template)

"Back to simple picker" link available at top.

---

**Step 4 — Price & listing**

Fields rendered:
| Field | Component | Notes |
|---|---|---|
| Price | Currency input | Shows as "$12.00". Stored as cents (1200). Min: $0 (for free releases). |
| Compare-at price | Currency input | Optional. Only shown if "On sale" toggle is enabled. |
| Listing status | `Select` | Active (publish now) / Paused (save draft) / Scheduled |
| Available from | `DateTimePicker` | Only shown if status = Scheduled |
| Available until | `DateTimePicker` | Optional. "Remove listing after this date" |
| Max purchases | `Input` (number) | Optional. Label: "Limit copies sold (leave blank for unlimited)" |

Below the form: a summary card showing the final `CompletenessScore` for the item about to be published, with a list of any deferred fields and a note: "You can complete these any time from your dashboard."

---

**Submission handler (Step 4 "Publish" button)**

On submit, execute this sequence. Each step must succeed before the next begins. On any failure, show an error toast and halt without partial writes where possible.

```
1. Upload artwork blob to PDS (if artworkFile provided)
   → returns artworkCid [AUTO]

2. Upload audio blob to PDS
   → returns audioCid [AUTO]
   Note: audio blob is uploaded but the download URL is NOT exposed publicly.
   The blob CID is stored in a private app-layer mapping, not in the lexicon record.

3. If licenseMode === 'template':
     Check if this template has already been written to artist's repo
     If yes: use existing licenseUri
     If no: createLicenseTerms(agent, templateData) → licenseUri, licenseCid [AUTO]
   If licenseMode === 'custom':
     createLicenseTerms(agent, customData) → licenseUri, licenseCid [AUTO]

4. createDigitalItem(agent, {
     title, artistDid [AUTO], itemClass, formats [AUTO from parsedMeta],
     durationMs [AUTO from parsedMeta], releaseDate, artworkCid [AUTO],
     description, genre, isrc, iswc, defaultLicenseUri: licenseUri,
     createdAt [AUTO]
   }) → itemUri, itemCid

5. createListing(agent, {
     item: { uri: itemUri, cid: itemCid, itemType: 'diamonds.whereditgo.bazaar.catalog.item.digital' },
     price, compareAtPrice, status, availableFrom, availableUntil,
     maxPurchasesPerBuyer, createdAt [AUTO]
   }) → listingUri, listingCid

6. Navigate to /merchant/dashboard with success toast:
   "Your track is live. [View on storefront →]"
```

---

### 4.4 `TrackListBuilder` component

`packages/client/src/components/merchant/TrackListBuilder.tsx`

Used when `itemClass === 'album'` — shown inline in Step 1 after item class selection.

Props:
```typescript
{
  artistDid: string
  value: Array<{ uri: string; cid?: string; trackNumber: number }>
  onChange: (tracks: Array<{ uri: string; cid?: string; trackNumber: number }>) => void
}
```

Behavior:
- Fetches existing `catalog.item.digital` records with `itemClass === 'track'` from artist's repo
- Renders a searchable list of existing tracks + a "+ Upload new track" option
- Selected tracks appear in an ordered drag-to-reorder list
- Track numbers are auto-assigned based on order (1-indexed)
- "Upload new track" opens a modal containing a simplified version of the digital upload form (Steps 1–2 only, no license/listing — those inherit from the parent collection)

---

### 4.5 `LicensePickerSimple` component

`packages/client/src/components/merchant/LicensePickerSimple.tsx`

Standalone version of Step 3 Mode A, used from the License Templates page (`/merchant/license`). Allows the artist to pre-create license terms without being in the middle of an upload flow. Selecting a template and saving writes the `license.terms` record to their PDS immediately.

---

### 4.6 `CompletenessIndicator` component

`packages/client/src/components/merchant/CompletenessIndicator.tsx`

Props: `{ score: CompletenessScore }`

Renders:
- A progress bar (0–100) with color: red < 40, amber 40–70, green > 70
- Three collapsible sections: Required (red dot), Recommended (amber dot), Optional (gray dot)
- Each field listed as a chip; clicking a chip in the form context scrolls to that field
- On the dashboard item list, renders as a compact inline bar with no expansion

---

## [GATE 4] Phase 4 complete

Assert:
- [ ] Step 1: cannot proceed without audio file, title, artist name, item class
- [ ] Step 1: audio file drop auto-populates title/isrc/duration when tags are present
- [ ] Step 2: all fields are optional; skip link works
- [ ] Step 3: cannot proceed without a license selection (template or custom)
- [ ] Step 3: template picker renders 3 cards; "Customize further" pre-fills full form
- [ ] Step 4: price field stores as integer cents
- [ ] Submission sequence: executes all 6 steps in order; halts and shows error toast on any failure
- [ ] `TrackListBuilder` renders existing tracks from PDS; drag reorder updates track numbers
- [ ] `CompletenessIndicator` renders correct score for a fully populated item (100) and a minimal item (~60)
- [ ] `npm run build` exits 0

---

## Phase 5 — Stripe webhook and receipt writing

### 5.1 Webhook handler `packages/server` (e.g. `packages/server/src/routes/stripe.ts`)

`POST /api/stripe/webhook` on Hono. Handles `checkout.session.completed` event only at this stage.

```
On checkout.session.completed:

1. Verify Stripe webhook signature (STRIPE_WEBHOOK_SECRET)
   → If invalid: return 400

2. Extract from session.metadata:
   { listingUri, itemUri, listingCid, licenseGrantUri, licenseGrantCid, buyerDid }

3. Fetch the listing record from PDS to confirm it is still active
   → If listing.status !== 'active': log warning, continue (do not fail — payment already taken)

4. Construct canonical payload for appSig:
   SHA-256( purchasedAt + paymentRef + itemUri + listingCid + buyerDid )
   Sign with APP_SERVICE_PRIVATE_KEY → base64url string

5. If buyerDid is present:
   Create a session agent for the buyer's PDS
   Write purchase.receipt record to buyer's repo:
   {
     item: { uri: itemUri, cid: itemCid, itemType },
     listingUri, listingCid,
     pricePaid: { amount: session.amount_total, currency: session.currency.toUpperCase() },
     paymentProcessor: 'stripe',
     paymentRef: session.payment_intent,        // Stripe PaymentIntent ID
     licenseGrantUri, licenseGrantCid,
     appDid: process.env.APP_DID,
     issuerScope: artistDid,                    // from env
     appSig,
     purchasedAt: new Date().toISOString(),
   }
   → Store { receiptUri, receiptCid } in app DB (or env-scoped KV) keyed by paymentRef

6. Trigger download link generation (stub: log "would generate download link for {itemUri}")

7. Return 200
```

Note on `buyerDid`: in this phase, buyer DID is not captured at checkout (no buyer ATProto login required). The `buyerDid` metadata field will be absent. The webhook must handle this gracefully — skip step 5, log that receipt was not written to PDS, but still return 200 and mark the payment as complete. Receipt writing to buyer PDS is a Phase 6 enhancement.

---

### 5.2 `appSig` signing utility

`packages/server/src/lib/atproto/sign.ts` (server-only; uses Node/Bun `crypto`):

```typescript
import crypto from 'crypto'

export function signReceiptPayload(params: {
  purchasedAt: string
  paymentRef: string
  itemUri: string
  listingCid: string
  buyerDid: string
  privateKeyPem: string
}): string {
  const payload = [
    params.purchasedAt,
    params.paymentRef,
    params.itemUri,
    params.listingCid,
    params.buyerDid,
  ].join(':')

  const hash = crypto.createHash('sha256').update(payload).digest()
  const sig = crypto.sign('SHA256', hash, params.privateKeyPem)
  return sig.toString('base64url')
}

export function verifyReceiptPayload(params: {
  purchasedAt: string
  paymentRef: string
  itemUri: string
  listingCid: string
  buyerDid: string
  appSig: string
  publicKeyPem: string
}): boolean {
  const payload = [
    params.purchasedAt,
    params.paymentRef,
    params.itemUri,
    params.listingCid,
    params.buyerDid,
  ].join(':')

  const hash = crypto.createHash('sha256').update(payload).digest()
  return crypto.verify('SHA256', hash, params.publicKeyPem, Buffer.from(params.appSig, 'base64url'))
}
```

---

## [GATE 5] Phase 5 complete

Assert:
- [ ] Webhook handler rejects requests with invalid Stripe signatures
- [ ] Webhook handler extracts all metadata fields from Stripe session
- [ ] `signReceiptPayload` and `verifyReceiptPayload` are inverse operations (unit test: sign then verify returns true)
- [ ] Webhook handler completes without error when `buyerDid` is absent
- [ ] `npm run build` exits 0

---

## Phase 6 — Listings management page

### 6.1 Listings page `packages/client/src/routes/ListingsPage.tsx`

Fetches all `catalog.listing` records from artist's PDS. Displays a table:

| Column | Source |
|---|---|
| Item title | Resolved from `listing.item.uri` |
| Type | `itemType` badge |
| Price | `listing.price` formatted |
| Status | `listing.status` badge (color-coded) |
| Completeness | `CompletenessIndicator` inline bar |
| Actions | Edit price, Pause/Activate toggle, View on storefront |

**Edit price action:** Opens shadcn **`Sheet`** (slide-over) with the listing price fields only. On save: updates the `listing` record on PDS via `com.atproto.repo.putRecord`.

**Pause/Activate toggle:** Updates `listing.status` between `active` and `paused` with a single API call. No confirmation dialog.

**Note on PDS mutations:** `putRecord` is used for updates (not `createRecord`). The rkey (TID) of the existing record must be preserved.

---

## [GATE 6] Phase 6 complete

Assert:
- [ ] Listings page renders with correct data from PDS
- [ ] Edit price sheet opens, saves, and reflects updated price without page reload
- [ ] Pause/activate toggle updates status and re-renders badge
- [ ] `npm run build` exits 0

---

## Phase 7 — Settings and profile

### 7.1 Settings page `packages/client/src/routes/SettingsPage.tsx`

Three sections:

**Profile**
- Display name (shadcn **`Input`**)
- Storefront description (shadcn **`Textarea`**)
- Avatar upload (`ImageDropzone`, aspect 1:1)
- Storefront URL (read-only, shows `import.meta.env.VITE_APP_URL` and/or production URL as configured)
- Save → writes `diamonds.whereditgo.bazaar.actor.profile` record to PDS

**Connections**
- ATProto: shows connected DID + handle, "Disconnect" button
- Stripe: shows connection status. If not connected: "Connect Stripe →" button → redirects to Stripe Connect OAuth. If connected: shows last 4 of bank account, "Manage in Stripe →" link.

**Danger zone**
- "Unpublish all listings" — sets all `listing.status` to `paused`. Requires typed confirmation.

---

## [GATE 7] Phase 7 complete

Assert:
- [ ] Profile form saves and creates/updates `actor.profile` record on PDS
- [ ] Stripe connection status correctly reflects env state
- [ ] "Unpublish all listings" requires confirmation and updates all listing statuses
- [ ] `npm run build` exits 0

---

## Phase 8 — Polish and validation passes

### 8.1 Accessibility

- All interactive elements have `aria-label` or visible label
- All form fields have associated `<label>` (via `htmlFor` or `aria-labelledby`)
- Error messages are associated with their fields via `aria-describedby`
- Focus is managed correctly on step transitions in multi-step form (focus moves to step heading)
- Color is never the sole means of conveying information (status badges have text labels)
- `AudioFileDropzone` and `ImageDropzone` support keyboard activation

### 8.2 Error states

Every async operation in the UI must have a defined error state:
- ATProto write failure: **sonner** (or shadcn **toast**) with message "Failed to publish. Your progress has been saved." + retry button
- Audio parse failure: inline error in dropzone with suggested formats
- Stripe checkout creation failure: inline error on BuyButton with "Payment unavailable — please try again"
- Webhook failure: silent (server-side) — log to console, do not surface to buyer

### 8.3 Loading states

- Inventory grid: skeleton cards (4 × `ItemCard` skeletons) while fetching
- Item detail page: skeleton for hero + metadata strip
- Upload form submission: disable all inputs, show spinner on submit button, show step-by-step progress ("Uploading audio… ✓ Creating record… ✓ Creating listing…")

### 8.4 Empty states

- Public home: if no active listings, show: artist name, a brief message, and a "Coming soon — check back soon" state. Do not show the merchant dashboard link.
- Merchant listings page: if no listings, show prompt to upload first item with direct link to upload form.
- Merchant dashboard: if no items, show large upload CTA.

---

## [GATE 8 — FINAL] Build complete

Assert all of the following before marking build complete:

- [ ] `npm run build` exits 0 with zero TypeScript errors and zero ESLint errors
- [ ] Public storefront renders with no auth, shows items with active listings only
- [ ] Buying flow: clicking buy → consent checkbox → Stripe redirect works end-to-end (test mode)
- [ ] Merchant flow: sign in → onboarding checklist → upload digital item (all 4 steps) → item appears on public storefront
- [ ] All 6 ATProto record types are written correctly (verified by fetching from PDS after write)
- [ ] Webhook: `checkout.session.completed` triggers receipt write when `buyerDid` present
- [ ] `signReceiptPayload` / `verifyReceiptPayload` round-trip passes
- [ ] All forms handle missing optional fields without crash
- [ ] All async operations have loading, success, and error states
- [ ] Completeness score is 100 for a fully populated item, ≥ 60 for a minimal item
- [ ] No server `.env` values are bundled into the client; only `VITE_*` keys from `packages/client/.env` are exposed in the browser
- [ ] No real credentials in any committed file

---

## Deferred to future phases (out of scope for this build)

These items are explicitly excluded. The agent must NOT implement them:

- Physical goods upload form (`/merchant/upload/physical`) — stub page only
- Buyer ATProto login at checkout (buyer DID capture)
- Download link generation and delivery
- PRO royalty deduction and remittance
- Multi-artist / multi-tenant support
- `purchase.stock` record management for physical goods
- `purchase.fulfillment` record management
- Mutual verification / attestation system (per Hilke's proposal)
- Cover song / mechanical license compliance tooling
- i18n / multi-currency beyond USD display