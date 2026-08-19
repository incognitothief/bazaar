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
  const count = row.item.items.length;
  return [
    row.item.collectionType ?? "collection",
    `${count} item${count === 1 ? "" : "s"}`,
  ].join(" · ");
}

export function editHref(uri: string): string {
  return `/merchant/inventory/edit?uri=${encodeURIComponent(uri)}`;
}

export function storefrontHref(uri: string, title: string): string {
  return itemPathPretty(catalogItemRkey(uri), title);
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
