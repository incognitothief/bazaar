import { useMemo } from "react";
import { createPublicAgent } from "@/lib/atproto/session";
import {
  buildDummyDigitalItem,
  buildDummyListing,
  catalogDummyEnabled,
  resolveDummyItemAtUri,
} from "@/lib/devCatalogDummy";
import { InventoryGrid, InventoryGridSkeleton } from "@/components/public/InventoryGrid";
import { useCatalog } from "@/hooks/useCatalog";
import type { CatalogEntry } from "@/hooks/useCatalog";

export function HomePage() {
  const artistDid = import.meta.env.VITE_ARTIST_DID;
  const { entries, listingsByItemUri, loading, error } = useCatalog(artistDid);
  const agent = createPublicAgent();
  const hasActive = entries.some((e) => listingsByItemUri[e.uri]);

  const dummyItemUri = useMemo(
    () => (artistDid?.startsWith("did:") ? resolveDummyItemAtUri(artistDid) : null),
    [artistDid],
  );
  const showStorefrontDummy =
    catalogDummyEnabled() &&
    !!artistDid?.startsWith("did:") &&
    !!dummyItemUri &&
    !hasActive;

  const gridEntries: CatalogEntry[] = useMemo(() => {
    if (!showStorefrontDummy || !dummyItemUri) return entries;
    const item = buildDummyDigitalItem(dummyItemUri, artistDid!);
    const synthetic: CatalogEntry = {
      uri: dummyItemUri,
      cid: "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      item,
    };
    return [synthetic];
  }, [showStorefrontDummy, dummyItemUri, entries, artistDid]);

  const gridListings = useMemo(() => {
    if (!showStorefrontDummy || !dummyItemUri) return listingsByItemUri;
    return {
      ...listingsByItemUri,
      [dummyItemUri]: buildDummyListing(dummyItemUri),
    };
  }, [showStorefrontDummy, dummyItemUri, listingsByItemUri]);

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
      ) : !hasActive && !showStorefrontDummy ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <p className="font-medium text-foreground">Coming soon — check back soon</p>
          <p className="mt-2 text-sm">
            No active listings for this artist yet.
          </p>
          <p className="mt-3 text-xs">
            In dev, run <code className="text-foreground">npm run dev</code> or set{" "}
            <code className="text-foreground">VITE_SHOW_LISTINGS_DUMMY=true</code>{" "}
            to show a preview card.
          </p>
        </div>
      ) : (
        <>
          {showStorefrontDummy ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
              Preview-only item: not on your PDS. Stripe checkout will fail until
              you publish a real item, license, and listing. Override the item URI
              with <code className="text-xs">VITE_DEV_DUMMY_ITEM_URI</code> if needed.
            </p>
          ) : null}
          <InventoryGrid
            agent={agent}
            artistDid={artistDid}
            entries={gridEntries}
            listingsByItemUri={gridListings}
            previewItemUri={showStorefrontDummy ? dummyItemUri : null}
          />
        </>
      )}
    </div>
  );
}
