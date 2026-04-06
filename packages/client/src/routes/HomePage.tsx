import { useMemo } from "react";
import { createPublicAgent } from "@/lib/atproto/session";
import {
  buildDummyDigitalItem,
  buildDummyListing,
  catalogDummyEnabled,
  resolveDummyItemAtUri,
} from "@/lib/devCatalogDummy";
import { InventoryGrid, InventoryGridSkeleton } from "@/components/public/InventoryGrid";
import { useActorMerchantProfile } from "@/hooks/useActorMerchantProfile";
import { useCatalog } from "@/hooks/useCatalog";
import type { CatalogEntry } from "@/hooks/useCatalog";

const DEFAULT_STOREFRONT_TITLE = "Storefront";
const DEFAULT_STOREFRONT_DESCRIPTION =
  "Music and releases from the artist catalog. Only items with an active listing are shown.";

export function HomePage() {
  const artistDid = import.meta.env.VITE_ARTIST_DID;
  const {
    profile: merchantProfile,
    loading: merchantProfileLoading,
  } = useActorMerchantProfile(artistDid);
  const { entries, listingsByItemUri, loading, error } = useCatalog(artistDid);
  const agent = createPublicAgent();

  const merchantHeaderPending =
    merchantProfileLoading && artistDid?.startsWith("did:");
  const storefrontTitle =
    merchantProfile?.displayName?.trim() || DEFAULT_STOREFRONT_TITLE;
  const storefrontDescription =
    merchantProfile?.description?.trim() || DEFAULT_STOREFRONT_DESCRIPTION;
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
      <div aria-busy={merchantHeaderPending || undefined}>
        {merchantHeaderPending ? (
          <div className="space-y-3">
            <div
              className="h-9 max-w-xs animate-pulse rounded-md bg-muted"
              aria-hidden
            />
            <div className="max-w-prose space-y-2">
              <div
                className="h-4 w-full animate-pulse rounded bg-muted"
                aria-hidden
              />
              <div
                className="h-4 w-4/5 animate-pulse rounded bg-muted"
                aria-hidden
              />
            </div>
          </div>
        ) : (
          <>
            <h1 className="text-3xl font-semibold tracking-tight">
              {storefrontTitle}
            </h1>
            <p className="mt-2 max-w-prose whitespace-pre-wrap text-muted-foreground">
              {storefrontDescription}
            </p>
          </>
        )}
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
              Preview-only item: not on your PDS. For test checkout without real
              listings, set{" "}
              <code className="text-xs">BAZAAR_DEV_CHECKOUT_STUB=true</code> on the
              server; otherwise publish real catalog records. Optional:{" "}
              <code className="text-xs">VITE_DEV_DUMMY_ITEM_URI</code>.
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
