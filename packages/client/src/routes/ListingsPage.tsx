import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import {
  getRecordValue,
  listListingRows,
  putListing,
  type ListingRow,
} from "@/lib/atproto/records";
import {
  buildDummyListing,
  catalogDummyEnabled,
  DUMMY_LISTING_AT,
  isDummyListingRowUri,
  resolveDummyItemAtUri,
} from "@/lib/devCatalogDummy";
import { catalogItemRkey, itemPathPretty } from "@/lib/itemPath";
import { collectionFromAtUri } from "@/lib/atUri";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CatalogItem, Listing } from "@/types/lexicons";
import { toast } from "sonner";

function isDummyListingRow(row: ListingRow): boolean {
  return isDummyListingRowUri(row.uri);
}

function devDummyListingRow(merchantDid: string | undefined): ListingRow | null {
  if (!catalogDummyEnabled() || !merchantDid?.startsWith("did:")) return null;
  const itemUri = resolveDummyItemAtUri(merchantDid);
  if (!itemUri) return null;
  return {
    uri: DUMMY_LISTING_AT,
    cid: "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    listing: buildDummyListing(itemUri),
  };
}

/** catalog.item/catalog.product don't have a public storefront page yet -- see merchantItemDisplay.ts's hasStorefrontPage. */
function itemUriHasStorefrontPage(itemUri: string): boolean {
  const c = collectionFromAtUri(itemUri);
  return c !== BAZAAR_COLLECTION.item && c !== BAZAAR_COLLECTION.product;
}

async function loadListingTitles(
  sessionDid: string,
  list: ListingRow[],
): Promise<Record<string, string>> {
  const t: Record<string, string> = {};
  const dummyRow = devDummyListingRow(sessionDid);
  const forTitles = list.length > 0 ? list : dummyRow ? [dummyRow] : [];
  for (const r of forTitles) {
    const item = await getRecordValue<CatalogItem>(r.listing.item.uri);
    t[r.uri] =
      item?.title ??
      (isDummyListingRow(r) ? "Sample listing (dev)" : r.listing.item.uri);
  }
  return t;
}

export function ListingsPage() {
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);
  const [rows, setRows] = useState<ListingRow[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [editRow, setEditRow] = useState<ListingRow | null>(null);
  const [editDollars, setEditDollars] = useState("");

  const refreshListings = useCallback(async () => {
    if (!agent || !session) return;
    const list = await listListingRows(session.did);
    setRows(list);
    setTitles(await loadListingTitles(session.did, list));
  }, [agent, session]);

  useEffect(() => {
    void refreshListings();
  }, [refreshListings]);

  async function savePrice() {
    if (!agent || !editRow) return;
    const dollars = parseFloat(editDollars);
    if (!Number.isFinite(dollars) || dollars < 0) {
      toast.error("Invalid price");
      return;
    }
    const cents = Math.round(dollars * 100);
    const next: Listing = {
      ...editRow.listing,
      price: { ...editRow.listing.price, amount: cents },
    };
    try {
      await putListing(agent, editRow.uri, next);
      setRows((prev) =>
        prev.map((x) =>
          x.uri === editRow.uri ? { ...x, listing: next } : x,
        ),
      );
      setEditRow(null);
      toast.success("Price updated");
    } catch (e) {
      toast.error("Update failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  async function toggleStatus(row: ListingRow) {
    if (!agent) return;
    if (isDummyListingRow(row)) return;
    const nextStatus =
      row.listing.status === "active" ? "paused" : "active";
    const next: Listing = { ...row.listing, status: nextStatus };
    const rowCollection = collectionFromAtUri(row.listing.item.uri);
    const isParentListing =
      rowCollection === BAZAAR_COLLECTION.collection ||
      rowCollection === BAZAAR_COLLECTION.product;
    const activeChildren = rows.filter(
      (x) =>
        x.listing.parentListing === row.uri && x.listing.status === "active",
    );
    try {
      if (nextStatus === "paused" && isParentListing) {
        for (const ch of activeChildren) {
          const paused: Listing = { ...ch.listing, status: "paused" };
          await putListing(agent, ch.uri, paused);
        }
      }
      await putListing(agent, row.uri, next);
      setRows((prev) =>
        prev.map((x) => {
          if (x.uri === row.uri) return { ...x, listing: next };
          if (
            nextStatus === "paused" &&
            isParentListing &&
            activeChildren.some((c) => c.uri === x.uri)
          ) {
            return { ...x, listing: { ...x.listing, status: "paused" } };
          }
          return x;
        }),
      );
    } catch (e) {
      toast.error("Could not update status");
    }
  }

  if (!session || !agent) return null;

  const dummy = devDummyListingRow(session.did);
  const displayRows = rows.length > 0 ? rows : dummy ? [dummy] : [];
  const showingListingsDummy = rows.length === 0 && dummy != null;

  return (
    <div className="w-full min-w-0 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Listings</h1>
        <Link to="/merchant/listings/new" className={cn(buttonVariants())}>
          Create new listing
        </Link>
      </div>

      {showingListingsDummy ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
          Preview row only (not stored in your repo). Uses your signed-in DID for the
          sample item URI unless <code className="text-xs">VITE_DEV_DUMMY_ITEM_URI</code>{" "}
          or <code className="text-xs">VITE_ARTIST_DID</code> is set. Create a real
          listing here after you publish catalog items from Upload.
        </p>
      ) : null}
      {displayRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          <p>No listings yet.</p>
          <p className="mt-2 text-xs">
            Run <code className="text-foreground">npm run dev</code> (Vite dev mode) to
            see a dummy row here, or set{" "}
            <code className="text-foreground">VITE_SHOW_LISTINGS_DUMMY=true</code> for
            preview/production builds.
          </p>
          <Link
            to="/merchant/listings/new"
            className={cn(buttonVariants(), "mt-4 inline-flex")}
          >
            Create new listing
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left p-3 font-medium">Item</th>
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-left p-3 font-medium">Price</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-right p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={row.uri} className="border-b border-border">
                  <td className="p-3">
                    {isDummyListingRow(row)
                      ? (titles[row.uri] ?? "Sample listing (dev)")
                      : (titles[row.uri] ?? "…")}
                    {isDummyListingRow(row) ? (
                      <Badge variant="secondary" className="ml-2 align-middle text-[10px]">
                        dev
                      </Badge>
                    ) : null}
                  </td>
                  <td className="p-3">
                    <Badge variant="outline">
                      {collectionFromAtUri(row.listing.item.uri) ?? "unknown"}
                    </Badge>
                  </td>
                  <td className="p-3">
                    {formatMoney(row.listing.price)}
                  </td>
                  <td className="p-3">
                    <Badge
                      variant={
                        row.listing.status === "active" ? "default" : "secondary"
                      }
                    >
                      {row.listing.status}
                    </Badge>
                  </td>
                  <td className="p-3 text-right space-x-2">
                    {isDummyListingRow(row) ? null : (
                      <>
                        <button
                          type="button"
                          className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                          onClick={() => {
                            setEditRow(row);
                            setEditDollars(
                              (row.listing.price.amount / 100).toFixed(2),
                            );
                          }}
                        >
                          Edit price
                        </button>
                        <button
                          type="button"
                          className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
                          onClick={() => void toggleStatus(row)}
                        >
                          {row.listing.status === "active" ? "Pause" : "Activate"}
                        </button>
                      </>
                    )}
                    {itemUriHasStorefrontPage(row.listing.item.uri) ? (
                      <Link
                        to={itemPathPretty(
                          catalogItemRkey(row.listing.item.uri),
                          titles[row.uri],
                        )}
                        className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "inline-flex")}
                      >
                        Storefront
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Sheet open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit price</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div>
              <Label htmlFor="edit-price">Price (USD)</Label>
              <Input
                id="edit-price"
                value={editDollars}
                onChange={(e) => setEditDollars(e.target.value)}
                className="mt-1"
              />
            </div>
            <button
              type="button"
              className={cn(buttonVariants())}
              onClick={() => void savePrice()}
            >
              Save
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
