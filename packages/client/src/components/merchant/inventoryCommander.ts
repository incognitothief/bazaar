import type { MerchantItemRow } from "@/hooks/useMerchantCatalog";
import type { ListingRow } from "@/lib/atproto/records";
import { isTerminalListingStatus } from "@/lib/atproto/records";

/** Matrix axis A: which entities to show by listing state. */
export type InventoryLiveFilter = "live" | "all";
/** Matrix axis B: which grain to show. */
export type InventoryGrainFilter = "products" | "items";

export const INVENTORY_LIVE_FILTER_KEY = "bazaar_merchant_inventory_live_filter";
export const INVENTORY_GRAIN_FILTER_KEY = "bazaar_merchant_inventory_grain_filter";
/** Products are collapsed by default; this holds the ones the merchant has expanded. */
export const INVENTORY_EXPANDED_PRODUCTS_KEY =
  "bazaar_merchant_inventory_expanded_products";

export function loadLiveFilter(): InventoryLiveFilter {
  try {
    return localStorage.getItem(INVENTORY_LIVE_FILTER_KEY) === "live"
      ? "live"
      : "all";
  } catch {
    return "all";
  }
}

export function loadGrainFilter(): InventoryGrainFilter {
  try {
    return localStorage.getItem(INVENTORY_GRAIN_FILTER_KEY) === "items"
      ? "items"
      : "products";
  } catch {
    return "products";
  }
}

export function loadExpandedProducts(): Set<string> {
  try {
    const raw = localStorage.getItem(INVENTORY_EXPANDED_PRODUCTS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? new Set(parsed.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

export function saveExpandedProducts(uris: Set<string>): void {
  try {
    localStorage.setItem(
      INVENTORY_EXPANDED_PRODUCTS_KEY,
      JSON.stringify([...uris]),
    );
  } catch {
    /* non-fatal */
  }
}

/** Products/collections group items for sale; everything else is atomic. */
export function isGroupingKind(kind: MerchantItemRow["kind"]): boolean {
  return kind === "product" || kind === "collection";
}

/** "Live" = there is a primary listing and it is currently active. */
export function isLive(listingRow: ListingRow | undefined): boolean {
  return listingRow?.listing.status === "active";
}

/** Has a listing that could still become sellable again (active or paused, not archived/superseded). */
export function hasNonTerminalListing(
  listingRow: ListingRow | undefined,
): boolean {
  return (
    !!listingRow && !isTerminalListingStatus(listingRow.listing.status)
  );
}

/** item AT-URI -> the AT-URI of the catalog.product that contains it. An item is created via exactly one product, so this is unambiguous. */
export function buildProductUriByItemUri(
  itemRows: MerchantItemRow[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const row of itemRows) {
    if (row.kind !== "product") continue;
    for (const ref of row.item.items) m.set(ref.uri, row.uri);
  }
  return m;
}

/** title lookup for any inventory row, keyed by its entity AT-URI. */
export function buildTitleByUri(
  itemRows: MerchantItemRow[],
): Record<string, string> {
  const t: Record<string, string> = {};
  for (const row of itemRows) t[row.uri] = row.item.title;
  return t;
}

export type RelationshipDescriptor =
  | { kind: "standalone"; label: string }
  | { kind: "in-product"; label: string; productUri: string }
  | { kind: "unlisted"; label: string }
  | { kind: "none"; label: string };

/**
 * How an inventory row relates to the listing graph. Only meaningful for the
 * new `item` / `product` grain -- legacy digital/physical/collection rows get
 * `none` (their pages are frozen; the list just shows their kind label).
 */
export function relationshipFor(
  row: MerchantItemRow,
  listingRow: ListingRow | undefined,
  productUriByItemUri: Map<string, string>,
  titleByUri: Record<string, string>,
): RelationshipDescriptor {
  // A product is top-level; the kind badge already says "Product", so there's
  // no separate relationship to show.
  if (row.kind !== "item") {
    return { kind: "none", label: "" };
  }
  const parentProductUri = productUriByItemUri.get(row.uri);
  const soldSeparately =
    hasNonTerminalListing(listingRow) &&
    !listingRow?.listing.parentListing;
  if (soldSeparately) {
    return { kind: "standalone", label: "Sold separately" };
  }
  if (parentProductUri) {
    const name = titleByUri[parentProductUri];
    return {
      kind: "in-product",
      label: name ? `In ${name}` : "In a product",
      productUri: parentProductUri,
    };
  }
  return { kind: "unlisted", label: "Not listed" };
}
