import { useCallback, useEffect, useState } from "react";
import {
  getCatalogItem,
  getCatalogProduct,
  listBazaarItemRows,
  listListingRows,
  listProductRows,
  type ListingRow,
} from "@/lib/atproto/records";
import { sortCatalogEntriesByRelease } from "@/lib/catalogSort";
import type { BazaarItem, Listing, Product } from "@/types/lexicons";

export type CatalogEntry = {
  uri: string;
  cid: string;
  item: BazaarItem | Product;
  /** catalog.product only -- ERP-only presigned R2 URLs, never on the PDS record (see resolveCoverImages server-side). */
  coverImages?: Array<{ objectId: string; url: string }>;
  /** catalog.product only -- ERP-only UI classification ("music", "generic", ...). */
  productType?: string | null;
  /** catalog.product only -- audio member count, computed on read. */
  trackCount?: number;
};

export type CatalogState = {
  entries: CatalogEntry[];
  listingsByItemUri: Record<string, Listing>;
  listingRows: ListingRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

function indexActiveListings(rows: ListingRow[]): Record<string, Listing> {
  const map: Record<string, Listing> = {};
  for (const { listing } of rows) {
    if (listing.status !== "active") continue;
    if (listing.parentListing) continue;
    map[listing.item.uri] = listing;
  }
  return map;
}

export function useCatalog(merchantDid: string | undefined): CatalogState {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [listingsByItemUri, setListingsByItemUri] = useState<
    Record<string, Listing>
  >({});
  const [listingRows, setListingRows] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!merchantDid?.startsWith("did:")) {
      setEntries([]);
      setListingsByItemUri({});
      setListingRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [bazaarItemRows, productRows, listings] = await Promise.all([
        listBazaarItemRows(merchantDid),
        listProductRows(merchantDid),
        listListingRows(merchantDid),
      ]);
      const byItem = indexActiveListings(listings);
      const productCoverImages = await Promise.all(
        productRows.map((r) => getCatalogProduct(r.uri)),
      );
      /** A catalog.item single has no cover art of its own -- borrowed from its owning product, resolved server-side (see catalog.ts's GET /items). */
      const bazaarItemCoverImages = await Promise.all(
        bazaarItemRows.map((r) => getCatalogItem(r.uri)),
      );
      const merged: CatalogEntry[] = [
        ...bazaarItemRows.map((r, i) => ({
          uri: r.uri,
          cid: r.cid,
          item: r.item,
          coverImages: bazaarItemCoverImages[i]?.coverImages,
        })),
        ...productRows.map((r, i) => ({
          uri: r.uri,
          cid: r.cid,
          item: r.item,
          coverImages: productCoverImages[i]?.coverImages,
          productType: productCoverImages[i]?.productType ?? null,
          trackCount: productCoverImages[i]?.trackCount,
        })),
      ];
      setListingRows(listings);
      setListingsByItemUri(byItem);
      setEntries(sortCatalogEntriesByRelease(merged));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load catalog");
      setEntries([]);
      setListingsByItemUri({});
      setListingRows([]);
    } finally {
      setLoading(false);
    }
  }, [merchantDid]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    entries,
    listingsByItemUri,
    listingRows,
    loading,
    error,
    refetch,
  };
}
