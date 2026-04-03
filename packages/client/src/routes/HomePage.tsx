import { createPublicAgent } from "@/lib/atproto/session";
import { InventoryGrid, InventoryGridSkeleton } from "@/components/public/InventoryGrid";
import { useCatalog } from "@/hooks/useCatalog";

export function HomePage() {
  const artistDid = import.meta.env.VITE_ARTIST_DID;
  const { entries, listingsByItemUri, loading, error } = useCatalog(artistDid);
  const agent = createPublicAgent();
  const hasActive = entries.some((e) => listingsByItemUri[e.uri]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Storefront</h1>
        <p className="mt-2 text-muted-foreground max-w-prose">
          Music and releases from the artist catalog. Only items with an active
          listing are shown.
        </p>
      </div>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <InventoryGridSkeleton />
      ) : !artistDid?.startsWith("did:") ? (
        <p className="text-muted-foreground">
          Set <code className="text-xs">VITE_ARTIST_DID</code> in{" "}
          <code className="text-xs">packages/client/.env</code> to load catalog.
        </p>
      ) : !hasActive ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <p className="font-medium text-foreground">Coming soon — check back soon</p>
          <p className="mt-2 text-sm">
            No active listings for this artist yet.
          </p>
        </div>
      ) : (
        <InventoryGrid
          agent={agent}
          artistDid={artistDid}
          entries={entries}
          listingsByItemUri={listingsByItemUri}
        />
      )}
    </div>
  );
}
