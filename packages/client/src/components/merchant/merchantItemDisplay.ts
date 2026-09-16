import { catalogItemRkey, itemPathPretty } from "@/lib/itemPath";
import type { MerchantItemRow } from "@/hooks/useMerchantCatalog";
import type { Listing } from "@/types/lexicons";

export function kindLabel(kind: MerchantItemRow["kind"]): string {
  switch (kind) {
    case "item":
      return "Item";
    case "product":
      return "Product";
  }
}

export function itemDetailText(row: MerchantItemRow): string {
  if (row.kind === "item") {
    return [row.item.category, row.item.format].filter(Boolean).join(" · ");
  }
  const count = row.item.items.length;
  return `${count} item${count === 1 ? "" : "s"}`;
}

/** Products drill into their own detail page; everything else uses the shared edit page. */
export function editHref(row: MerchantItemRow): string {
  if (row.kind === "product") {
    return `/merchant/inventory/products?uri=${encodeURIComponent(row.uri)}`;
  }
  return `/merchant/inventory/edit?uri=${encodeURIComponent(row.uri)}`;
}

export function storefrontHref(uri: string, title: string): string {
  return itemPathPretty(catalogItemRkey(uri), title);
}

/**
 * The presigned URL for a product's (or a product's item's) first cover
 * image, if any. Cover art lives in catalogProductAssets / R2, never as a
 * PDS blob, so it is a plain <img src> rather than a CID resolution. An
 * item's coverImages come from its owning product (see merchant.ts's GET
 * /catalog/items); an item with no product yet (or whose product has no
 * cover art) simply has none.
 */
export function rowCoverImageUrl(row: MerchantItemRow): string | undefined {
  return row.item.coverImages[0]?.url;
}

export type ListingStatusBadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline";

export function listingStatusBadgeVariant(
  status: Listing["status"],
): ListingStatusBadgeVariant {
  switch (status) {
    case "active":
      return "default";
    case "soldOut":
      return "destructive";
    case "paused":
    case "archived":
    case "superseded":
      return "secondary";
  }
}
