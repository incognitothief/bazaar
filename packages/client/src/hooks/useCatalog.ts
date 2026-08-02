import { useCallback, useEffect, useState } from "react";
import {
  listCollectionRows,
  listDigitalItemRows,
  listListingRows,
  listPhysicalItemRows,
  type ListingRow,
} from "@/lib/atproto/records";
import { sortCatalogEntriesByRelease } from "@/lib/catalogSort";
import type { Collection, DigitalItem, Listing, PhysicalItem } from "@/types/lexicons";

export type CatalogEntry =
  | { uri: string; cid: string; item: DigitalItem }
  | { uri: string; cid: string; item: Collection }
  | { uri: string; cid: string; item: PhysicalItem };

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

export function useCatalog(artistDid: string | undefined): CatalogState {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [listingsByItemUri, setListingsByItemUri] = useState<
    Record<string, Listing>
  >({});
  const [listingRows, setListingRows] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!artistDid?.startsWith("did:")) {
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
      const [digitalRows, collectionRows, physicalRows, listings] =
        await Promise.all([
          listDigitalItemRows(artistDid),
          listCollectionRows(artistDid),
          listPhysicalItemRows(artistDid),
          listListingRows(artistDid),
        ]);
      const byItem = indexActiveListings(listings);
      const merged: CatalogEntry[] = [
        ...digitalRows.map((r) => ({
          uri: r.uri,
          cid: r.cid,
          item: r.item,
        })),
        ...collectionRows.map((r) => ({
          uri: r.uri,
          cid: r.cid,
          item: r.item,
        })),
        ...physicalRows.map((r) => ({
          uri: r.uri,
          cid: r.cid,
          item: r.item,
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
  }, [artistDid]);

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
