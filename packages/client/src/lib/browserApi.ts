/**
 * Browser → Bazaar API URLs.
 *
 * The API is always same-origin with the SPA, in both modes:
 *   - dev:  Vite serves :5173 and proxies /api to Bun on :3000 (vite.config.ts)
 *   - prod: Bun serves the built client itself from STATIC_ROOT (Dockerfile)
 * So relative `/api/...` is always correct, and avoids the CORS + cookie failures
 * that an absolute cross-origin base would cause with `credentials: "include"`.
 */

/** Use for `fetch()` / `uploadBlob` to this app's API. */
export function browserApiUrl(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Build a `URL` with query params. `browserApiUrl` is origin-relative, and
 * `new URL("/api/...")` throws without a base — use this instead.
 */
export function createBrowserApiURL(path: string): URL {
  const base =
    typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1";
  return new URL(browserApiUrl(path), base);
}

/**
 * Start a file download from a URL (e.g. R2 presigned GET with
 * `Content-Disposition: attachment` from `/api/download`) without replacing the SPA tab.
 */
export function triggerFileDownload(signedUrl: string, filename?: string): void {
  const a = document.createElement("a");
  a.href = signedUrl;
  if (filename) {
    a.setAttribute("download", filename);
  }
  a.rel = "noopener noreferrer";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
