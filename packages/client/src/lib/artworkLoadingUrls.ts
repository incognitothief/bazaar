/**
 * Numbered SVGs in `src/assets/artwork-loading/` (e.g. `1.svg` … `6.svg`).
 * Replace files freely; names are sorted by the trailing integer before `.svg`.
 */
const modules = import.meta.glob<string>("@/assets/artwork-loading/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

function trailingNumber(path: string): number {
  const m = path.match(/(\d+)\.svg$/i);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

export const ARTWORK_LOADING_SVG_URLS: readonly string[] = Object.entries(modules)
  .sort(([a], [b]) => {
    const na = trailingNumber(a);
    const nb = trailingNumber(b);
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  })
  .map(([, url]) => url);
