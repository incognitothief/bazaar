import type { BazaarItem, Product } from "@/types/lexicons";

export type CatalogEntryForSort = {
  uri: string;
  cid: string;
  item: BazaarItem | Product;
};

function parseIsoMs(s: string | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Storefront ordering: newest first by `createdAt`, ties broken by URI so the
 * order is stable across reloads.
 *
 * This used to fan out per record type -- collections sorted by their own
 * `releaseDate`, digital items by theirs or their parent collection's, physical
 * items by `createdAt`. catalog.item and catalog.product have no releaseDate,
 * so all of that collapsed when the legacy types were removed.
 */
export function sortCatalogEntriesByRelease(
  entries: CatalogEntryForSort[],
): CatalogEntryForSort[] {
  return [...entries].sort((a, b) => {
    const delta = parseIsoMs(b.item.createdAt) - parseIsoMs(a.item.createdAt);
    if (delta !== 0) return delta;
    return a.uri.localeCompare(b.uri);
  });
}
