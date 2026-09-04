import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  INVENTORY_VIEW_MODE_KEY,
  InventoryViewToggle,
  loadInventoryViewMode,
  type InventoryViewMode,
} from "@/components/merchant/InventoryViewToggle";
import { MerchantItemCard } from "@/components/merchant/MerchantItemCard";
import { MerchantItemRow } from "@/components/merchant/MerchantItemRow";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import {
  useMerchantCatalog,
  type MerchantItemRow as MerchantItemRowData,
} from "@/hooks/useMerchantCatalog";
import { putListing, type ListingRow } from "@/lib/atproto/records";
import { collectionFromAtUri } from "@/lib/atUri";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import { createPublicAgent } from "@/lib/atproto/session";
import { cn } from "@/lib/utils";
import type { Listing } from "@/types/lexicons";

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4" aria-busy>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-lg animate-pulse">
          <div className="aspect-square bg-muted" />
          <div className="space-y-2 p-3">
            <div className="h-4 w-3/4 rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="rounded-lg border border-border" aria-busy>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border px-2 py-2 last:border-b-0 animate-pulse"
        >
          <div className="h-10 w-10 shrink-0 rounded-md bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-1/3 rounded bg-muted" />
            <div className="h-3 w-1/4 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Products/collections group items for sale; everything else is an atomic item. */
function isGroupingKind(kind: MerchantItemRowData["kind"]): boolean {
  return kind === "product" || kind === "collection";
}

export function MerchantInventoryPage() {
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);
  const artworkAgent = useMemo(() => createPublicAgent(), []);
  const {
    itemRows,
    listingRows,
    listingRowByItemUri,
    loading,
    error,
    applyListingUpdates,
  } = useMerchantCatalog(session?.did);
  const [view, setView] = useState<InventoryViewMode>(() => loadInventoryViewMode());
  const [pendingUris, setPendingUris] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"products" | "items">("products");

  const handleViewChange = useCallback((mode: InventoryViewMode) => {
    setView(mode);
    localStorage.setItem(INVENTORY_VIEW_MODE_KEY, mode);
  }, []);

  const toggleStatus = useCallback(
    async (listingRow: ListingRow) => {
      if (!agent) return;
      const nextStatus: Listing["status"] =
        listingRow.listing.status === "active" ? "paused" : "active";
      const next: Listing = { ...listingRow.listing, status: nextStatus };
      const isCollectionListing =
        collectionFromAtUri(listingRow.listing.item.uri) ===
        BAZAAR_COLLECTION.collection;
      const activeChildren = listingRows.filter(
        (x) =>
          x.listing.parentListing === listingRow.uri && x.listing.status === "active",
      );

      setPendingUris((prev) => new Set(prev).add(listingRow.uri));
      try {
        const updated: ListingRow[] = [];
        if (nextStatus === "paused" && isCollectionListing) {
          for (const child of activeChildren) {
            const paused: Listing = { ...child.listing, status: "paused" };
            await putListing(agent, child.uri, paused);
            updated.push({ ...child, listing: paused });
          }
        }
        await putListing(agent, listingRow.uri, next);
        updated.push({ ...listingRow, listing: next });
        applyListingUpdates(updated);
      } catch (e) {
        toast.error("Could not update status", {
          description: e instanceof Error ? e.message : undefined,
        });
      } finally {
        setPendingUris((prev) => {
          const n = new Set(prev);
          n.delete(listingRow.uri);
          return n;
        });
      }
    },
    [agent, listingRows, applyListingUpdates],
  );

  const productRows = useMemo(
    () => itemRows.filter((r) => isGroupingKind(r.kind)),
    [itemRows],
  );
  const flatItemRows = useMemo(
    () => itemRows.filter((r) => !isGroupingKind(r.kind)),
    [itemRows],
  );

  if (!session || !agent) return null;

  function renderRows(rows: MerchantItemRowData[]) {
    if (view === "grid") {
      return (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {rows.map((row) => (
            <MerchantItemCard
              key={row.uri}
              agent={artworkAgent}
              merchantDid={session!.did}
              row={row}
              listingRow={listingRowByItemUri[row.uri]}
              pending={
                listingRowByItemUri[row.uri]
                  ? pendingUris.has(listingRowByItemUri[row.uri]!.uri)
                  : false
              }
              onToggleStatus={() => {
                const lr = listingRowByItemUri[row.uri];
                if (lr) void toggleStatus(lr);
              }}
            />
          ))}
        </div>
      );
    }
    return (
      <div className="overflow-hidden rounded-lg border border-border">
        {rows.map((row) => (
          <MerchantItemRow
            key={row.uri}
            agent={artworkAgent}
            merchantDid={session!.did}
            row={row}
            listingRow={listingRowByItemUri[row.uri]}
            pending={
              listingRowByItemUri[row.uri]
                ? pendingUris.has(listingRowByItemUri[row.uri]!.uri)
                : false
            }
            onToggleStatus={() => {
              const lr = listingRowByItemUri[row.uri];
              if (lr) void toggleStatus(lr);
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Prices and status come from{" "}
          <Link to="/merchant/listings" className="underline underline-offset-2">
            Listings
          </Link>{" "}
          — pause or activate an existing listing right here.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "products" | "items")}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <TabsList>
            <TabsTrigger value="products">Products</TabsTrigger>
            <TabsTrigger value="items">All items</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            {!loading && itemRows.length > 0 ? (
              <InventoryViewToggle value={view} onChange={handleViewChange} />
            ) : null}
            {activeTab === "products" ? (
              <Link to="/merchant/inventory/new" className={cn(buttonVariants())}>
                + Add a product
              </Link>
            ) : null}
          </div>
        </div>

        <TabsContent value="products" className="space-y-4">
          {loading ? (
            view === "grid" ? (
              <GridSkeleton />
            ) : (
              <ListSkeleton />
            )
          ) : productRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
              <p>No products yet.</p>
              <Link
                to="/merchant/inventory/new"
                className={cn(buttonVariants(), "mt-4 inline-flex")}
              >
                + Add a product
              </Link>
            </div>
          ) : (
            renderRows(productRows)
          )}
        </TabsContent>

        <TabsContent value="items" className="space-y-4">
          {loading ? (
            view === "grid" ? (
              <GridSkeleton />
            ) : (
              <ListSkeleton />
            )
          ) : flatItemRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
              <p>
                No items yet — items are created as part of adding a
                product.
              </p>
            </div>
          ) : (
            renderRows(flatItemRows)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
