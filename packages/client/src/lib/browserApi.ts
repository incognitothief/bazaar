/**
 * Browser → Bazaar API URLs.
 *
 * In Vite dev the SPA is on :5173 and `/api` is proxied to Bun (:3000). Using relative
 * `/api/...` avoids cross-origin requests and CORS failures ("Failed to fetch") when
 * `VITE_API_ORIGIN` is `http://127.0.0.1:3000` but the page is `http://localhost:5173`.
 */

/**
 * Use for `fetch()` / `uploadBlob` to this app's API. In `import.meta.env.DEV`, always
 * same-origin relative paths so the Vite proxy is used.
 */
export function browserApiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (import.meta.env.DEV) {
    return p;
  }
  const raw = import.meta.env.VITE_API_ORIGIN?.trim() ?? "";
  if (!raw) {
    return p;
  }
  const base =
    raw.startsWith("http://") || raw.startsWith("https://")
      ? raw.replace(/\/$/, "")
      : `https://${raw.replace(/\/$/, "")}`;
  if (typeof window !== "undefined") {
    try {
      if (new URL(base).origin === window.location.origin) {
        return p;
      }
    } catch {
      /* ignore */
    }
  }
  return `${base}${p}`;
}

/**
 * Build a `URL` with query params. In dev, `browserApiUrl` is origin-relative (`/api/...`);
 * `new URL("/api/...")` throws without a base — use this instead.
 */
export function createBrowserApiURL(path: string): URL {
  const resolved = browserApiUrl(path);
  if (resolved.startsWith("http://") || resolved.startsWith("https://")) {
    return new URL(resolved);
  }
  const base =
    typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1";
  return new URL(resolved, base);
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
