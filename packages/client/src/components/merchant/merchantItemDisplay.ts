import { catalogItemRkey, itemPathPretty } from "@/lib/itemPath";
import type { MerchantItemRow } from "@/hooks/useMerchantCatalog";
import type { Listing } from "@/types/lexicons";

export function kindLabel(kind: MerchantItemRow["kind"]): string {
  switch (kind) {
    case "digital":
      return "Digital";
    case "collection":
      return "Collection";
    case "physical":
      return "Physical";
    case "item":
      return "Item";
    case "product":
      return "Product";
  }
}

export function itemDetailText(row: MerchantItemRow): string {
  if (row.kind === "digital") {
    const parts: string[] = [row.item.itemClass];
    if (row.item.formats?.length) parts.push(row.item.formats.join(", "));
    return parts.filter(Boolean).join(" · ");
  }
  if (row.kind === "physical") {
    const parts: string[] = [row.item.itemClass];
    if (row.item.variants?.length) {
      parts.push(
        `${row.item.variants.length} variant${row.item.variants.length === 1 ? "" : "s"}`,
      );
    }
    return parts.filter(Boolean).join(" · ");
  }
  if (row.kind === "item") {
    return [row.item.category, row.item.format].filter(Boolean).join(" · ");
  }
  if (row.kind === "product") {
    const count = row.item.items.length;
    return `${count} item${count === 1 ? "" : "s"}`;
  }
  const count = row.item.items.length;
  return [
    row.item.collectionType ?? "collection",
    `${count} item${count === 1 ? "" : "s"}`,
  ].join(" · ");
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

/** catalog.item/catalog.product don't have a public storefront page yet -- no link to show. */
export function hasStorefrontPage(kind: MerchantItemRow["kind"]): boolean {
  return kind !== "item" && kind !== "product";
}

/** catalog.item has no artworkCid of its own; catalog.product's cover art lives in catalogProductAssets, not this list row. */
export function rowArtworkCid(row: MerchantItemRow): string | undefined {
  if (row.kind === "item" || row.kind === "product") return undefined;
  return row.item.artworkCid;
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
    case "scheduled":
    case "archived":
    case "superseded":
      return "secondary";
  }
}
