
/**
 * Origin for absolute URLs in client-rendered meta. The server injects the
 * authoritative canonical / og:url for crawlers (lib/spaHtmlMeta.ts, driven by
 * PUBLIC_WEB_ORIGIN); this only backs the Helmet tags a JS-executing client sees.
 */
export function publicSiteOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "";
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

