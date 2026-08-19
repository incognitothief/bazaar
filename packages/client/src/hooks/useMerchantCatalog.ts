import { useCallback, useEffect, useState } from "react";
import {
  listCollectionRows,
  listDigitalItemRows,
  listListingRows,
  listPhysicalItemRows,
  type ListingRow,
} from "@/lib/atproto/records";
import type { Collection, DigitalItem, PhysicalItem } from "@/types/lexicons";

export type MerchantItemRow =
  | { kind: "digital"; uri: string; cid: string; item: DigitalItem }
  | { kind: "collection"; uri: string; cid: string; item: Collection }
  | { kind: "physical"; uri: string; cid: string; item: PhysicalItem };

export type MerchantCatalogState = {
  itemRows: MerchantItemRow[];
  listingRows: ListingRow[];
  listingRowByItemUri: Record<string, ListingRow>;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  applyListingUpdates: (updated: ListingRow[]) => void;
};

/**
 * A listing may have superseded/archived history for the same item. Prefer the
 * newest non-superseded, top-level (no parentListing) listing so merchants see
 * the listing that actually controls the item's storefront price/status.
 */
function indexPrimaryListings(rows: ListingRow[]): Record<string, ListingRow> {
  const byItem: Record<string, ListingRow> = {};
  for (const row of rows) {
    if (row.listing.parentListing) continue;
    const itemUri = row.listing.item.uri;
    const existing = byItem[itemUri];
    if (!existing) {
      byItem[itemUri] = row;
      continue;
    }
    const existingIsSuperseded = existing.listing.status === "superseded";
    const rowIsSuperseded = row.listing.status === "superseded";
    if (existingIsSuperseded && !rowIsSuperseded) {
      byItem[itemUri] = row;
      continue;
    }
    if (existingIsSuperseded === rowIsSuperseded) {
      const existingMs = Date.parse(existing.listing.createdAt);
      const rowMs = Date.parse(row.listing.createdAt);
      if (rowMs > existingMs) byItem[itemUri] = row;
    }
  }
  return byItem;
}

export function useMerchantCatalog(
  merchantDid: string | undefined,
): MerchantCatalogState {
  const [itemRows, setItemRows] = useState<MerchantItemRow[]>([]);
  const [listingRows, setListingRows] = useState<ListingRow[]>([]);
  const [listingRowByItemUri, setListingRowByItemUri] = useState<
    Record<string, ListingRow>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!merchantDid?.startsWith("did:")) {
      setItemRows([]);
      setListingRows([]);
      setListingRowByItemUri({});
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [digital, collections, physical, listings] = await Promise.all([
        listDigitalItemRows(merchantDid),
        listCollectionRows(merchantDid),
        listPhysicalItemRows(merchantDid),
        listListingRows(merchantDid),
      ]);
      const merged: MerchantItemRow[] = [
        ...digital.map((r) => ({
          kind: "digital" as const,
          uri: r.uri,
          cid: r.cid,
          item: r.item,
        })),
        ...collections.map((r) => ({
          kind: "collection" as const,
          uri: r.uri,
          cid: r.cid,
          item: r.item,
        })),
        ...physical.map((r) => ({
          kind: "physical" as const,
          uri: r.uri,
          cid: r.cid,
          item: r.item,
        })),
      ];
      merged.sort(
        (a, b) =>
          new Date(b.item.createdAt).getTime() -
          new Date(a.item.createdAt).getTime(),
      );
      setItemRows(merged);
      setListingRows(listings);
      setListingRowByItemUri(indexPrimaryListings(listings));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load inventory.");
      setItemRows([]);
      setListingRows([]);
      setListingRowByItemUri({});
    } finally {
      setLoading(false);
    }
  }, [merchantDid]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const applyListingUpdates = useCallback((updated: ListingRow[]) => {
    if (updated.length === 0) return;
    const byUri = new Map(updated.map((r) => [r.uri, r]));
    setListingRows((prev) =>
      prev.map((r) => byUri.get(r.uri) ?? r),
    );
    setListingRowByItemUri((prev) => {
      const next = { ...prev };
      for (const row of updated) next[row.listing.item.uri] = row;
      return next;
    });
  }, []);

  return {
    itemRows,
    listingRows,
    listingRowByItemUri,
    loading,
    error,
    refetch,
    applyListingUpdates,
  };
}
