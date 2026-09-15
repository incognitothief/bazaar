import { useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { createPublicAgent } from "@/lib/atproto/session";
import {
  buildDummyProduct,
  buildDummyListing,
  catalogDummyEnabled,
  resolveDummyItemAtUri,
} from "@/lib/devCatalogDummy";
import {
  InventoryGrid,
  InventoryGridSkeleton,
} from "@/components/public/InventoryGrid";
import { useActorMerchantProfile } from "@/hooks/useActorMerchantProfile";
import { useCatalog } from "@/hooks/useCatalog";
import type { CatalogEntry } from "@/hooks/useCatalog";
import {
  defaultOgImageAbsolute,
  publicSiteOrigin,
  siteBrandName,
  truncMeta,
} from "@/lib/seo";

const DEFAULT_STOREFRONT_TITLE = "Storefront";
const DEFAULT_STOREFRONT_DESCRIPTION =
  "Music and releases from the artist catalog. Only items with an active listing are shown.";

export function HomePage() {
  const merchantDid = import.meta.env.VITE_MERCHANT_DID;
  const { profile: merchantProfile, loading: merchantProfileLoading } =
    useActorMerchantProfile(merchantDid);
  const { entries, listingsByItemUri, loading, error } = useCatalog(merchantDid);
  const agent = createPublicAgent();

  const merchantHeaderPending =
    merchantProfileLoading && merchantDid?.startsWith("did:");
  const storefrontTitle =
    merchantProfile?.displayName?.trim() || DEFAULT_STOREFRONT_TITLE;
  const storefrontDescription =
    merchantProfile?.description?.trim() || DEFAULT_STOREFRONT_DESCRIPTION;
  const hasActive = entries.some((e) => listingsByItemUri[e.uri]);

  const dummyItemUri = useMemo(
    () =>
      merchantDid?.startsWith("did:") ? resolveDummyItemAtUri(merchantDid) : null,
    [merchantDid],
  );
  const showStorefrontDummy =
    catalogDummyEnabled() &&
    !!merchantDid?.startsWith("did:") &&
    !!dummyItemUri &&
    !hasActive;

  const gridEntries: CatalogEntry[] = useMemo(() => {
    if (!showStorefrontDummy || !dummyItemUri) return entries;
    const item = buildDummyProduct(dummyItemUri, merchantDid!);
    const synthetic: CatalogEntry = {
      uri: dummyItemUri,
      cid: "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      item,
    };
    return [synthetic];
  }, [showStorefrontDummy, dummyItemUri, entries, merchantDid]);

  const gridListings = useMemo(() => {
    if (!showStorefrontDummy || !dummyItemUri) return listingsByItemUri;
    return {
      ...listingsByItemUri,
      [dummyItemUri]: buildDummyListing(dummyItemUri),
    };
  }, [showStorefrontDummy, dummyItemUri, listingsByItemUri]);

  const pageTitle = `${storefrontTitle} · ${siteBrandName()}`;
  const canonicalAbs = `${publicSiteOrigin()}/`;
  const ogImage = defaultOgImageAbsolute();
  const twSite = import.meta.env.VITE_PUBLIC_TWITTER_SITE?.trim();

  return (
    <div className="space-y-8">
      <Helmet>
        <title>{pageTitle}</title>
        <meta
          name="description"
          content={truncMeta(storefrontDescription, 160)}
        />
        <link rel="canonical" href={canonicalAbs} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={siteBrandName()} />
        <meta property="og:title" content={pageTitle} />
        <meta
          property="og:description"
          content={truncMeta(storefrontDescription, 200)}
        />
        <meta property="og:url" content={canonicalAbs} />
        <meta property="og:image" content={ogImage} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta
          name="twitter:description"
          content={truncMeta(storefrontDescription, 200)}
        />
        <meta name="twitter:image" content={ogImage} />
        {twSite ? (
          <meta
            name="twitter:site"
            content={twSite.startsWith("@") ? twSite : `@${twSite}`}
          />
        ) : null}
      </Helmet>
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
      ) : !merchantDid?.startsWith("did:") ? (
        <p className="text-muted-foreground">
          Set <code className="text-xs">VITE_MERCHANT_DID</code> in{" "}
          <code className="text-xs">packages/client/.env</code> to load catalog.
        </p>
      ) : !hasActive && !showStorefrontDummy ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <p className="font-medium text-foreground">
            Coming soon — check back later
          </p>
          <p className="mt-2 text-sm">
            No active listings for this artist yet.
          </p>
        </div>
      ) : (
        <>
          {showStorefrontDummy ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
              Preview-only item: not on your PDS. For test checkout without real
              listings, set{" "}
              <code className="text-xs">BAZAAR_DEV_CHECKOUT_STUB=true</code> on
              the server; otherwise publish real catalog records. Optional:{" "}
              <code className="text-xs">VITE_DEV_DUMMY_ITEM_URI</code>.
            </p>
          ) : null}
          <InventoryGrid
            agent={agent}
            artistDid={merchantDid}
            entries={gridEntries}
            listingsByItemUri={gridListings}
            previewItemUri={showStorefrontDummy ? dummyItemUri : null}
          />
        </>
      )}
    </div>
  );
}
