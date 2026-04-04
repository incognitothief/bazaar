import type { Agent } from "@atproto/api";
import { ItemCard } from "./ItemCard";
import type { CatalogEntry } from "@/hooks/useCatalog";
import type { Listing } from "@/types/lexicons";

export function InventoryGrid({
  agent,
  artistDid,
  entries,
  listingsByItemUri,
  previewItemUri,
}: {
  agent: Agent;
  artistDid: string;
  entries: CatalogEntry[];
  listingsByItemUri: Record<string, Listing>;
  /** Mark this item’s card as a local preview (see devCatalogDummy). */
  previewItemUri?: string | null;
}) {
  const visible = entries.filter((e) => listingsByItemUri[e.uri]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {visible.map((e) => (
        <ItemCard
          key={e.uri}
          agent={agent}
          artistDid={artistDid}
          itemUri={e.uri}
          item={e.item}
          listing={listingsByItemUri[e.uri]!}
          preview={previewItemUri != null && e.uri === previewItemUri}
        />
      ))}
    </div>
  );
}

export function InventoryGridSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" aria-busy>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border overflow-hidden animate-pulse"
        >
          <div className="aspect-square bg-muted" />
          <div className="p-4 space-y-2">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-3 bg-muted rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
