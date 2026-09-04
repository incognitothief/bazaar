import { catalogItemUriKey } from "@/lib/atproto/records";
import type {
  BazaarItem,
  Collection,
  DigitalItem,
  PhysicalItem,
  Product,
} from "@/types/lexicons";

export type CatalogEntryForSort = {
  uri: string;
  cid: string;
  item: DigitalItem | Collection | PhysicalItem | BazaarItem | Product;
};

function parseIsoMs(s: string | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Storefront ordering: newest first. Digital items use item `releaseDate`, else
 * their parent collection's `releaseDate` when `collectionUri` is set, else
 * `createdAt`. Collections use `releaseDate`. Physical items use `createdAt`.
 */
function storefrontSortMs(
  entry: CatalogEntryForSort,
  collectionReleaseByUriKey: Map<string, string>,
): number {
  const { item } = entry;
  if (item.$type === "diamonds.whereditgo.bazaar.catalog.collection") {
    return parseIsoMs(item.releaseDate);
  }
  if (item.$type === "diamonds.whereditgo.bazaar.catalog.item.physical") {
    return parseIsoMs(item.createdAt);
  }
  if (
    item.$type === "diamonds.whereditgo.bazaar.catalog.item" ||
    item.$type === "diamonds.whereditgo.bazaar.catalog.product"
  ) {
    return parseIsoMs(item.createdAt);
  }
  const own = item.releaseDate;
  if (own) return parseIsoMs(own);
  if (item.collectionUri) {
    const col = collectionReleaseByUriKey.get(
      catalogItemUriKey(item.collectionUri),
    );
    if (col) return parseIsoMs(col);
  }
  return parseIsoMs(item.createdAt);
}

export function sortCatalogEntriesByRelease(
  entries: CatalogEntryForSort[],
): CatalogEntryForSort[] {
  const collectionReleaseByUriKey = new Map<string, string>();
  for (const e of entries) {
    if (e.item.$type === "diamonds.whereditgo.bazaar.catalog.collection") {
      collectionReleaseByUriKey.set(catalogItemUriKey(e.uri), e.item.releaseDate);
    }
  }
  return [...entries].sort((a, b) => {
    const ma = storefrontSortMs(a, collectionReleaseByUriKey);
    const mb = storefrontSortMs(b, collectionReleaseByUriKey);
    if (mb !== ma) return mb - ma;
    return a.uri.localeCompare(b.uri);
  });
}
