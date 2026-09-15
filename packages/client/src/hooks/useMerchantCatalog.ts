import { useCallback, useEffect, useState } from "react";
import {
  listCatalogItemRows,
  listCatalogProductRows,
  listListingRows,
  type CatalogItemRow,
  type CatalogProductRow,
  type ListingRow,
} from "@/lib/atproto/records";

export type MerchantItemRow =
  | { kind: "item"; uri: string; cid: string; item: CatalogItemRow }
  | { kind: "product"; uri: string; cid: string; item: CatalogProductRow };

function rowCreatedAtMs(row: MerchantItemRow): number {
  return new Date(row.item.recordCreatedAt ?? row.item.capturedAt).getTime();
}

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
 * The listing that best represents an item's current state -- one per item
 * URI. A standalone listing (no parentListing) outranks a sold-under-product
 * child listing; a live/paused listing outranks an archived/superseded one;
 * ties break on newest. Child listings are included so an item that only
 * sells inside a product still shows a status (and can't be re-listed on top).
 */
function listingRank(r: ListingRow): number {
  const terminal =
    r.listing.status === "archived" || r.listing.status === "superseded";
  return (terminal ? 0 : 4) + (r.listing.parentListing ? 0 : 2);
}

function indexPrimaryListings(rows: ListingRow[]): Record<string, ListingRow> {
  const byItem: Record<string, ListingRow> = {};
  for (const row of rows) {
    const itemUri = row.listing.item.uri;
    const existing = byItem[itemUri];
    if (!existing) {
      byItem[itemUri] = row;
      continue;
    }
    const de = listingRank(existing);
    const dr = listingRank(row);
    if (dr > de) {
      byItem[itemUri] = row;
      continue;
    }
    if (
      dr === de &&
      Date.parse(row.listing.createdAt) > Date.parse(existing.listing.createdAt)
    ) {
      byItem[itemUri] = row;
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
      const [catalogItems, catalogProducts, listings] = await Promise.all([
        listCatalogItemRows(),
        listCatalogProductRows(),
        listListingRows(merchantDid),
      ]);
      const merged: MerchantItemRow[] = [
        ...catalogItems.map((r) => ({
          kind: "item" as const,
          uri: r.uri,
          cid: r.cid,
          item: r,
        })),
        ...catalogProducts.map((r) => ({
          kind: "product" as const,
          uri: r.uri,
          cid: r.cid,
          item: r,
        })),
      ];
      merged.sort((a, b) => rowCreatedAtMs(b) - rowCreatedAtMs(a));
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
