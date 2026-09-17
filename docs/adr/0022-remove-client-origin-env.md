# ADR 0022: Remove `VITE_APP_URL` and `VITE_API_ORIGIN` — the client has no origin to configure

## Status

Accepted.

Supersedes the `VITE_API_ORIGIN` constraint in [ADR 0002](0002-frontend-architecture.md) §
"OAuth `redirect_uri` is derived from server `APP_URL`" and the corresponding note in
[ADR 001](001-storefront-application-architecture.md). The underlying rule those state — the
redirect URI comes from the server's `APP_URL`, never the Vite port — is unchanged and remains
in force. What is removed is the client-side variable that had to be kept in sync with it.

## Date

2026-09-17

## Context

The client bundle carried two build-time origin variables:

- `VITE_API_ORIGIN` — the origin the browser used as the base for API calls
- `VITE_APP_URL` — the storefront's public URL, used to build absolute `canonical` / `og:image`

Both were required GitHub secrets, Docker build-args, and preflight checks. Neither could
affect behaviour in any supported deployment.

**`VITE_API_ORIGIN` was unreachable in both modes.** `browserApiUrl()` returned early on
`import.meta.env.DEV` without reading it, and the Vite proxy target is hardcoded to
`127.0.0.1:3000` (`packages/client/vite.config.ts`). In production the Dockerfile copies the
client build into `/app/static` and Bun serves it via `STATIC_ROOT`, so the SPA is served *by*
the API server — `window.location.origin` is already the API origin, and the existing
origin-equality check short-circuited to a relative path.

Worse, its only reachable non-default behaviour was harmful. Set to the `fly.dev` hostname while
buyers visit the custom domain, the short-circuit does not fire: the browser then issues genuine
cross-origin requests with `credentials: "include"` against a host with no CORS configuration.
A variable whose every non-trivial value breaks the site is not configuration.

**`VITE_APP_URL` duplicated metadata the server already emits, for an audience that cannot read
it.** Its sole consumer was `publicSiteOrigin()`, backing the client-side Helmet `canonical` and
`og:image` on the storefront and item pages. But `packages/server/src/lib/spaHtmlMeta.ts` injects
the authoritative `title`, `description`, `canonical`, full `og:*` and `twitter:*` set into every
HTML response — `/` via its own handler and every SPA route via `app.notFound` — driven by
`PUBLIC_WEB_ORIGIN`. Link unfurlers do not execute JavaScript, so the server-injected tags are
the only ones they ever see. The client copy reached JS-rendering consumers only, where it could
disagree with the server's value on an alternate hostname.

## Decision

Remove both variables. The client resolves its own origin at runtime:

- `browserApiUrl()` always returns a relative path. Same-origin holds in dev (Vite proxies
  `/api`) and in production (Bun serves the client), so this is correct by construction rather
  than by configuration.
- `publicSiteOrigin()` returns `window.location.origin`. Server-side injection remains the
  authoritative source for crawlers; `PUBLIC_WEB_ORIGIN` is the single knob that pins it.

`VITE_MERCHANT_DID` is retained. It gates merchant console access (`lib/auth.ts`) and seeds
AT-URI construction before any network call, so removing it would require an asynchronous
bootstrap fetch before the app can decide access — a sequencing change, not a cleanup.

## Consequences

- Two fewer GitHub secrets, Docker build-args and preflight entries. The production and staging
  deploy jobs now check three secrets each instead of five.
- The "`VITE_API_ORIGIN` must exactly match `APP_URL`" constraint disappears, because there is no
  longer a second place to state the fact. Drift between them is no longer expressible.
- `make dev TUNNEL_URL=…` now overrides only server-side origins. The client needs no tunnel
  configuration; it reaches the API on relative paths through the Vite proxy.
- A fork that genuinely serves the SPA from a different origin than the API — no such deployment
  path exists in this repository — would need to reintroduce an absolute base in
  `browserApi.ts`, along with the CORS and cookie configuration such a split requires.
- Client-side Helmet still emits `canonical` / `og:url` alongside the server-injected tags. It
  now derives from the live origin rather than a build-time constant, so the two can still disagree on
  an alternate hostname. Collapsing that duplication — letting the server be the sole source —
  is left as follow-up.
