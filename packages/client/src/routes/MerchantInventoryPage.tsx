import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InventoryViewToggle,
  loadInventoryViewMode,
  INVENTORY_VIEW_MODE_KEY,
  type InventoryViewMode,
} from "@/components/merchant/InventoryViewToggle";
import { MerchantItemCard } from "@/components/merchant/MerchantItemCard";
import {
  MerchantItemRow,
  type MerchantRowActions,
} from "@/components/merchant/MerchantItemRow";
import {
  buildProductUriByItemUri,
  buildTitleByUri,
  hasNonTerminalListing,
  isGroupingKind,
  isLive,
  loadExpandedProducts,
  loadGrainFilter,
  loadLiveFilter,
  relationshipFor,
  saveExpandedProducts,
  INVENTORY_GRAIN_FILTER_KEY,
  INVENTORY_LIVE_FILTER_KEY,
  type InventoryGrainFilter,
  type InventoryLiveFilter,
} from "@/components/merchant/inventoryCommander";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import {
  useMerchantCatalog,
  type MerchantItemRow as MerchantItemRowData,
} from "@/hooks/useMerchantCatalog";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import {
  deleteListing,
  putListing,
  type ListingRow,
} from "@/lib/atproto/records";
import { collectionFromAtUri } from "@/lib/atUri";
import { createPublicAgent } from "@/lib/atproto/session";
import { cn } from "@/lib/utils";
import type { Listing } from "@/types/lexicons";

function GridSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4"
      aria-busy
    >
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

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5 text-sm"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
            value === o.value && "bg-background text-foreground shadow-sm",
          )}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MerchantInventoryPage() {
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);
  const navigate = useNavigate();
  const artworkAgent = useMemo(() => createPublicAgent(), []);
  const {
    itemRows,
    listingRows,
    listingRowByItemUri,
    loading,
    error,
    refetch,
    applyListingUpdates,
  } = useMerchantCatalog(session?.did);

  const [view, setView] = useState<InventoryViewMode>(() =>
    loadInventoryViewMode(),
  );
  const [liveFilter, setLiveFilter] = useState<InventoryLiveFilter>(() =>
    loadLiveFilter(),
  );
  const [grainFilter, setGrainFilter] = useState<InventoryGrainFilter>(() =>
    loadGrainFilter(),
  );
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    loadExpandedProducts(),
  );
  const [pendingUris, setPendingUris] = useState<Set<string>>(new Set());

  const [deleteRow, setDeleteRow] = useState<ListingRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const productUriByItemUri = useMemo(
    () => buildProductUriByItemUri(itemRows),
    [itemRows],
  );
  const titleByUri = useMemo(() => buildTitleByUri(itemRows), [itemRows]);

  const setLiveFilterPersist = useCallback((next: InventoryLiveFilter) => {
    setLiveFilter(next);
    try {
      localStorage.setItem(INVENTORY_LIVE_FILTER_KEY, next);
    } catch {
      /* non-fatal */
    }
  }, []);
  const setGrainFilterPersist = useCallback((next: InventoryGrainFilter) => {
    setGrainFilter(next);
    try {
      localStorage.setItem(INVENTORY_GRAIN_FILTER_KEY, next);
    } catch {
      /* non-fatal */
    }
  }, []);
  const handleViewChange = useCallback((mode: InventoryViewMode) => {
    setView(mode);
    try {
      localStorage.setItem(INVENTORY_VIEW_MODE_KEY, mode);
    } catch {
      /* non-fatal */
    }
  }, []);

  const toggleExpanded = useCallback((uri: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      saveExpandedProducts(next);
      return next;
    });
  }, []);

  const openCreateListing = useCallback(
    (row: MerchantItemRowData) => {
      navigate(
        `/merchant/listings/new?uri=${encodeURIComponent(row.uri)}`,
      );
    },
    [navigate],
  );

  const toggleStatus = useCallback(
    async (listingRow: ListingRow) => {
      if (!agent) return;
      const nextStatus: Listing["status"] =
        listingRow.listing.status === "active" ? "paused" : "active";
      const next: Listing = { ...listingRow.listing, status: nextStatus };
      const rowCollection = collectionFromAtUri(listingRow.listing.item.uri);
      const isParentListing =
        rowCollection === BAZAAR_COLLECTION.collection ||
        rowCollection === BAZAAR_COLLECTION.product;
      const activeChildren = listingRows.filter(
        (x) =>
          x.listing.parentListing === listingRow.uri &&
          x.listing.status === "active",
      );

      setPendingUris((prev) => new Set(prev).add(listingRow.uri));
      try {
        const updated: ListingRow[] = [];
        if (nextStatus === "paused" && isParentListing) {
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

  const confirmDelete = useCallback(async () => {
    if (!agent || !deleteRow) return;
    setDeleting(true);
    try {
      await deleteListing(agent, deleteRow.uri);
      toast.success("Listing deleted");
      setDeleteRow(null);
      await refetch();
    } catch (e) {
      toast.error("Failed to delete listing", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  }, [agent, deleteRow, refetch]);

  const buildActions = useCallback(
    (row: MerchantItemRowData): MerchantRowActions => {
      const lr = listingRowByItemUri[row.uri];
      const isOurGrain = row.kind === "item" || row.kind === "product";
      return {
        relationship: relationshipFor(
          row,
          lr,
          productUriByItemUri,
          titleByUri,
        ),
        canCreateListing: isOurGrain && !hasNonTerminalListing(lr),
        onCreateListing: () => openCreateListing(row),
        onDeleteListing: () => {
          if (lr) setDeleteRow(lr);
        },
      };
    },
    [listingRowByItemUri, productUriByItemUri, titleByUri, openCreateListing],
  );

  const productRows = useMemo(
    () => itemRows.filter((r) => isGroupingKind(r.kind)),
    [itemRows],
  );
  const itemGrainRows = useMemo(
    () => itemRows.filter((r) => r.kind === "item"),
    [itemRows],
  );

  const childrenByProductUri = useMemo(() => {
    const m = new Map<string, MerchantItemRowData[]>();
    for (const item of itemGrainRows) {
      const p = productUriByItemUri.get(item.uri);
      if (!p) continue;
      const arr = m.get(p) ?? [];
      arr.push(item);
      m.set(p, arr);
    }
    return m;
  }, [itemGrainRows, productUriByItemUri]);

  const visibleProducts = useMemo(
    () =>
      liveFilter === "all"
        ? productRows
        : productRows.filter((r) => isLive(listingRowByItemUri[r.uri])),
    [productRows, liveFilter, listingRowByItemUri],
  );
  const visibleItems = useMemo(
    () =>
      liveFilter === "all"
        ? itemGrainRows
        : itemGrainRows.filter((r) => isLive(listingRowByItemUri[r.uri])),
    [itemGrainRows, liveFilter, listingRowByItemUri],
  );

  if (!session || !agent) return null;

  const showEmptyProducts = !loading && visibleProducts.length === 0;
  const showEmptyItems = !loading && visibleItems.length === 0;

  /**
   * Badge context:
   * - `nested`  — a child row under its parent product; the grouping already
   *   shows the parent, so drop the relationship badge, keep the kind badge.
   * - `flatItem` — the flat Items table; every row is an item, so the kind
   *   badge is noise. Show the parent relationship instead.
   * - `default` — product rows: just the kind badge.
   */
  function rowProps(
    row: MerchantItemRowData,
    context: "default" | "nested" | "flatItem" = "default",
  ) {
    const lr = listingRowByItemUri[row.uri];
    return {
      agent: artworkAgent,
      merchantDid: session!.did,
      row,
      listingRow: lr,
      pending: lr ? pendingUris.has(lr.uri) : false,
      onToggleStatus: () => {
        if (lr) void toggleStatus(lr);
      },
      actions: buildActions(row),
      showKind: context !== "flatItem",
      showRelationship: context === "flatItem",
    };
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Every product and item you've uploaded. Create, price, pause, or
          retire a listing from its row.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<InventoryGrainFilter>
            label="Grain"
            value={grainFilter}
            onChange={setGrainFilterPersist}
            options={[
              { value: "products", label: "Products" },
              { value: "items", label: "Items" },
            ]}
          />
          <Segmented<InventoryLiveFilter>
            label="Listing state"
            value={liveFilter}
            onChange={setLiveFilterPersist}
            options={[
              { value: "all", label: "All" },
              { value: "live", label: "Live" },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          {!loading && itemRows.length > 0 ? (
            <InventoryViewToggle value={view} onChange={handleViewChange} />
          ) : null}
          <Link
            to="/merchant/inventory/new"
            className={cn(buttonVariants())}
          >
            + Add a product
          </Link>
        </div>
      </div>

      {grainFilter === "products" ? (
        loading ? (
          view === "grid" ? (
            <GridSkeleton />
          ) : (
            <ListSkeleton />
          )
        ) : showEmptyProducts ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
            <p>
              {liveFilter === "live"
                ? "No products have a live listing."
                : "No products yet."}
            </p>
            <Link
              to="/merchant/inventory/new"
              className={cn(buttonVariants(), "mt-4 inline-flex")}
            >
              + Add a product
            </Link>
          </div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {visibleProducts.map((row) => (
              <MerchantItemCard key={row.uri} {...rowProps(row)} />
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            {visibleProducts.map((product) => {
              const kids =
                product.kind === "product"
                  ? (childrenByProductUri.get(product.uri) ?? [])
                  : [];
              const isCollapsed = !expanded.has(product.uri);
              return (
                <div key={product.uri}>
                  <MerchantItemRow
                    {...rowProps(product)}
                    collapse={
                      kids.length > 0
                        ? {
                            collapsed: isCollapsed,
                            onToggle: () => toggleExpanded(product.uri),
                            childCount: kids.length,
                          }
                        : undefined
                    }
                  />
                  {!isCollapsed
                    ? kids.map((kid) => (
                        <MerchantItemRow
                          key={kid.uri}
                          {...rowProps(kid, "nested")}
                          indent
                        />
                      ))
                    : null}
                </div>
              );
            })}
          </div>
        )
      ) : loading ? (
        view === "grid" ? (
          <GridSkeleton />
        ) : (
          <ListSkeleton />
        )
      ) : showEmptyItems ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          <p>
            {liveFilter === "live"
              ? "No items have a live listing."
              : "No items yet — items are created as part of adding a product."}
          </p>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {visibleItems.map((row) => (
            <MerchantItemCard key={row.uri} {...rowProps(row, "flatItem")} />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {visibleItems.map((row) => (
            <MerchantItemRow key={row.uri} {...rowProps(row, "flatItem")} />
          ))}
        </div>
      )}

      <Dialog
        open={!!deleteRow}
        onOpenChange={(open) => {
          if (!open) setDeleteRow(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete listing for "
              {deleteRow ? (titleByUri[deleteRow.listing.item.uri] ?? "") : ""}"?
            </DialogTitle>
            <DialogDescription>
              This removes the listing record. It stops appearing here and on
              your storefront immediately. Buyers who already purchased through
              it keep their receipts and downloads — deleting a listing never
              affects a completed sale.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteRow(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete listing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
