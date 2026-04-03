/**
 * Validates a post-login redirect target: same-origin path only (open-redirect safe).
 */
export function safeReturnPath(
  raw: string | null | undefined,
): string | null {
  if (raw == null || raw === "") return null;
  let s: string;
  try {
    s = decodeURIComponent(raw.trim());
  } catch {
    return null;
  }
  if (s.length > 2048) return null;
  if (!s.startsWith("/")) return null;
  if (s.startsWith("//")) return null;
  if (s.includes("://")) return null;
  if (s.includes("\\")) return null;
  if (s.startsWith("/merchant/signin")) return null;
  return s;
}

/** `/merchant/signin` with optional `returnTo` for the current location. */
export function merchantSignInUrl(pathname: string, search = ""): string {
  const here = `${pathname}${search}`;
  if (pathname.startsWith("/merchant/signin")) {
    return "/merchant/signin";
  }
  return `/merchant/signin?returnTo=${encodeURIComponent(here)}`;
}
