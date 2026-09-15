
export function publicSiteOrigin(): string {
  const u = import.meta.env.VITE_APP_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/** Base URL for `/api/*` in the browser (same as createBrowserApiURL). */
export function apiPublicBase(): string {
  const o = import.meta.env.VITE_API_ORIGIN?.trim();
  if (o) return o.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return publicSiteOrigin();
}

export function siteBrandName(): string {
  return import.meta.env.VITE_PUBLIC_SITE_NAME?.trim() || "Bazaar";
}

export function truncMeta(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** First non-empty line of catalog description for link previews (og:description, etc.). */
export function firstLineForItemMeta(
  description: string | null | undefined,
): string | null {
  if (description == null) return null;
  const first = description
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return first ?? null;
}

export function defaultOgImageAbsolute(): string {
  const custom = import.meta.env.VITE_PUBLIC_OG_DEFAULT_IMAGE?.trim();
  if (custom) return custom;
  const origin = publicSiteOrigin();
  if (origin) return `${origin}/og-default.png`;
  return "/og-default.png";
}

