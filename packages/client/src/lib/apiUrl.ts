/**
 * API base URL. Empty = same origin (production behind Bun, or Vite dev with `/api` proxy).
 */
export function getApiOrigin(): string {
  return (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");
}

/** Absolute or same-origin path for API calls (always starts with `/api` when path does). */
export function apiUrl(path: string): string {
  const base = getApiOrigin();
  const p = path.startsWith("/") ? path : `/${path}`;
  return base === "" ? p : `${base}${p}`;
}
