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
