# ADR 0023: Serve cover art from our own origin for link previews

## Status

Accepted.

Completes the per-item `og:image` left unimplemented by
[ADR 0007](0007-digital-inventory-r2.md), which moved product cover art into R2 without a public
read path. Does not change how inventory bytes are stored or authorized.

## Date

2026-09-17

## Context

Item pages unfurled with the generic site image instead of the product's cover art. The cause was
not a missing wire-up but a shape mismatch: `resolveCoverImages` returns **presigned R2 URLs with
`expiresIn: 3600`**. That is correct for the SPA, which re-resolves them on every load, and unusable
as `og:image`:

- Unfurlers cache the image URL for days or weeks; the link dies after an hour.
- The signature lives in the query string, so the URL changes on every render and defeats any
  downstream cache.
- Any re-fetch after expiry returns 403, so a link shared once degrades silently over time.

Pointing `og:image` at the existing function would therefore have produced embeds that break
within the hour — worse than the generic image, because the failure is invisible to the merchant.

## Decision

Add `GET /api/catalog/cover/:rkey`, public and unauthenticated, which streams the product's first
cover-art object from R2 through our own origin. Both the server-injected meta
(`lib/spaHtmlMeta.ts`) and the client-side Helmet tag point at it.

**Proxy, not redirect.** A 302 to a freshly presigned URL is cheaper, but some unfurlers cache the
redirect *target* rather than the redirect — which expires in an hour and reintroduces exactly the
bug this endpoint exists to fix.

**The bucket stays private.** Making cover art public at the bucket or prefix level would be
cheaper still — Cloudflare's CDN would serve it directly — and is rejected: the same bucket holds
the inventory the store sells. A public read path on that bucket is a data-leak surface, not a
performance tuning knob.

**The endpoint cannot address arbitrary objects.** It takes an item rkey, never a key. It resolves
that rkey to a product through the ERP rows, then to a `catalogProductAssets` row whose `role` is
`"coverArt"`. There is no input that walks it to an inventory object, which is what makes serving
it without a session safe.

**Resolution is local.** `resolveCoverProductUri` reads the ERP tables rather than probing the PDS
the way `spaHtmlMeta` does for titles, so an image fetch costs no network round trip. It is shared
by the meta builder and the endpoint specifically so the two cannot disagree — a mismatch would
mean advertising an image URL that 404s, or falling back to the site image when real art exists.

**webp is preferred.** `webpDerivative.ts` already caps the derivative at 1600px, which is the
right shape for a link preview; the original is served when no derivative was produced.

**`twitter:card` becomes `summary`.** Cover art is square and `summary_large_image` centre-crops it
to roughly 1200x628, cutting the art. The square card shows it intact.

## Consequences

- Cover-art bytes flow through the app server rather than direct from R2. Mitigated with
  `Cache-Control: public, max-age=3600` and an `ETag`; conditional requests are passed to R2 as
  `IfNoneMatch` and answered 304 without transferring the body.
- Cover art is readable by anyone who can guess or read an item rkey. This is intended — the same
  art is already visible to any visitor on the public item page.
- A product whose art is replaced keeps the same URL, so the response is revalidated rather than
  immutable.
- Link previews still lag a merchant's art change by up to an hour on our side, and by whatever
  the unfurler caches on theirs. Purging third-party unfurl caches is out of scope.
