# ADR 0002: Frontend architecture and UI conventions

## Status

Accepted

## Date

2026-04-02

## Context

The Bazaar storefront is a React SPA in `packages/client`, served by the Hono server in production and developed via Vite with an `/api` proxy. The UI plan defines stack choices, env boundaries, routing shells, and component layout for public storefront and merchant tools.

## Decision

### 1. UI stack

- **React 19** + **TypeScript** + **Vite 6** (`packages/client`).
- **Tailwind CSS** + **shadcn/ui** primitives under `src/components/ui/`.
- **react-router-dom** v7 with `createBrowserRouter`; layout routes use `<Outlet />`.
- **Forms:** `react-hook-form` + Zod resolvers.
- **Toasts:** sonner (`<Toaster />` mounted once in `App.tsx`).
- **Icons:** lucide-react; conditional classes via `cn()` in `lib/utils.ts`.

### 2. Client / server boundary

- Browser code reads only `import.meta.env.VITE_*` variables.
- Secrets (Stripe secret, app signing key, OAuth) live in `packages/server` only.
- In development, Vite (`:5173`) proxies `/api` to Bun (`:3000`).
- OAuth `redirect_uri` is derived from server `APP_URL`, not the Vite port; `VITE_API_ORIGIN` and `APP_URL` must name the same public origin when using real OAuth.

### 3. Application shells and routing

Two authenticated surfaces share one SPA:

| Shell | Path prefix | Auth |
|-------|-------------|------|
| `PublicLayout` | `/`, `/item/*`, `/purchase/*`, `/dashboard`, legal pages | None (buyer dashboard uses separate session) |
| `MerchantLayout` | `/merchant/*` | ATProto OAuth session; unauthenticated users redirected |

Item URLs use **record key** (`/item/:rkey`, optional cosmetic slug). Legacy links with a full `at://` URI segment are redirected server-side (301).

### 4. Source layout

Under `packages/client/src/`:

- `routes/` — page components per route
- `components/public|merchant|shared|ui/` — feature and primitive components
- `hooks/` — session, catalog, completeness score
- `lib/atproto/` — browser-safe ATProto helpers (session agent, records, uploads)
- `lib/audio/parse.ts` — `music-metadata/browser` + `parseBlob` only (no Node APIs)
- `types/lexicons.ts` — TypeScript shapes for lexicon records (JSON defs in `@bazaar/shared`)

### 5. Payments in the browser

Checkout does **not** embed Stripe.js. The client POSTs to `/api/stripe/checkout` and redirects to the returned Stripe Checkout URL.

### 6. Audio metadata

Client-side audio inspection uses `music-metadata/browser` and `parseBlob` on `File` objects. Format detection: MIME → extension → parsed metadata.

### 7. Completeness scoring

`useCompletenessScore` scores partial catalog records (required 60%, recommended 25%, optional 15%) for upload UX; score is advisory, not a publish gate.

## Constraints

| Rule | Value / location |
|------|------------------|
| Lexicon namespace | `VITE_LEXICON_NAMESPACE` (default `diamonds.whereditgo.bazaar`) |
| Store owner DID | `VITE_ARTIST_DID` — storefront catalog source |
| Dev client port | `5173` |
| shadcn components | `packages/client/components.json` |

## Consequences

**Positive**

- Consistent component library and form patterns across merchant flows.
- Clear env boundary reduces secret leakage risk.
- rkey-based item URLs are shorter and stable for sharing.

**Negative / trade-offs**

- Dual-origin dev setup (`5173` + `3000`) requires careful OAuth URL configuration.
- Lexicon JSON and TS types can drift unless validated (`npm run lexicons:validate`).
- Large upload plan (multi-step wizard) increases bundle surface; most merchant pages load together.

**Deferred**

- Physical goods upload (stub route exists).
- Stripe.js Elements (not adopted).
- Full accessibility/polish checklist from plan Phase 8 — ongoing.
