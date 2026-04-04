/**
 * ATProto OAuth client metadata validation (RFC 8252) disallows the hostname
 * "localhost" in redirect_uris — use the loopback IP instead.
 */
export function normalizeOAuthUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "localhost") u.hostname = "127.0.0.1";
    return u.href;
  } catch {
    return url;
  }
}

/** Public origin for redirects and client_uri (no trailing path). */
export function oauthAppBaseUrl(): string {
  const raw = process.env.APP_URL ?? "http://127.0.0.1:3000";
  try {
    const u = new URL(raw);
    if (u.hostname === "localhost") u.hostname = "127.0.0.1";
    return u.origin;
  } catch {
    return raw;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "[::1]"
  );
}

/**
 * Vite's default dev server is HTTP on :5173. If PUBLIC_WEB_APP_URL is mistakenly set to
 * `https://127.0.0.1:5173`, Stripe redirects to HTTPS and the browser cannot load the app
 * (no TLS listener). Downgrade to http for loopback unless explicitly allowed.
 */
function normalizeStorefrontProtocol(u: URL): void {
  const allowHttps =
    process.env.PUBLIC_WEB_APP_URL_ALLOW_LOOPBACK_HTTPS === "true" ||
    process.env.PUBLIC_WEB_APP_URL_ALLOW_LOOPBACK_HTTPS === "1";
  if (
    !allowHttps &&
    u.protocol === "https:" &&
    isLoopbackHost(u.hostname)
  ) {
    u.protocol = "http:";
  }
}

/**
 * Origin where buyers load the SPA (Stripe success/cancel URLs).
 * When the API runs on :3000 and Vite on :5173, set PUBLIC_WEB_APP_URL=http://127.0.0.1:5173
 * so Checkout returns to the dev server that has the React app.
 */
export function storefrontWebOrigin(): string {
  const explicit = process.env.PUBLIC_WEB_APP_URL?.trim();
  const raw = explicit || process.env.APP_URL || "http://127.0.0.1:3000";
  try {
    const u = new URL(normalizeOAuthUrl(raw));
    if (u.hostname === "localhost") u.hostname = "127.0.0.1";
    normalizeStorefrontProtocol(u);
    return u.origin;
  } catch {
    return oauthAppBaseUrl();
  }
}

export function oauthRedirectUri(): string {
  const explicit = process.env.ATPROTO_OAUTH_REDIRECT_URI;
  if (explicit) return normalizeOAuthUrl(explicit);
  return `${oauthAppBaseUrl()}/api/atproto/callback`;
}

/** True when APP_URL is local dev (localhost or 127.0.0.1). */
export function isOAuthLoopbackDev(): boolean {
  const raw = process.env.APP_URL ?? "http://127.0.0.1:3000";
  try {
    const u = new URL(raw);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}
