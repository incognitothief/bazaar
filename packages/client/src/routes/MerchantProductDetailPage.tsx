import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CoverImageSlideshow } from "@/components/merchant/CoverImageSlideshow";
import {
  createInventorySession,
  inventoryUserFacingError,
  publishItemsSession,
  registerInventoryObjects,
  saveInventoryDraft,
  uploadFileToInventoryObject,
} from "@/lib/api/inventoryApi";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import {
  findStaleListingsForItem,
  getCatalogProduct,
  listCatalogItemRows,
  listListingRows,
  putCatalogProduct,
  putListing,
  syncCatalogProduct,
  catalogProductDownloadUrl,
  updateCatalogProductSettings,
  type CatalogItemRow,
  type CatalogProductRow,
  type ListingRow,
} from "@/lib/atproto/records";
import { PRODUCT_TYPE_OPTIONS } from "@/lib/productTypes";
import { cn, moveArrayItem } from "@/lib/utils";
import type { ItemRef } from "@/types/lexicons";

export function MerchantProductDetailPage() {
  const [searchParams] = useSearchParams();
  const uriParam = searchParams.get("uri")?.trim() ?? "";
  const uri = useMemo(() => {
    try {
      return decodeURIComponent(uriParam);
    } catch {
      return uriParam;
    }
  }, [uriParam]);

  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [product, setProduct] = useState<CatalogProductRow | null>(null);
  const [itemsByUri, setItemsByUri] = useState<Record<string, CatalogItemRow>>({});

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<ItemRef[]>([]);
  const [productType, setProductType] = useState<string | null>(null);
  const [artIncludedInDownload, setArtIncludedInDownload] = useState(false);

  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [staleListings, setStaleListings] = useState<ListingRow[] | null>(null);

  const load = useCallback(async () => {
    if (!uri) return;
    setLoading(true);
    setLoadError(null);
    const [p, allItems] = await Promise.all([
      getCatalogProduct(uri),
      listCatalogItemRows(),
    ]);
    if (!p) {
      setProduct(null);
      setLoadError("Could not load this product.");
      setLoading(false);
      return;
    }
    setProduct(p);
    setTitle(p.title);
    setDescription(p.description ?? "");
    setItems(p.items as ItemRef[]);
    setProductType(p.productType);
    setArtIncludedInDownload(p.artIncludedInDownload);
    setItemsByUri(Object.fromEntries(allItems.map((r) => [r.uri, r])));
    setLoading(false);
  }, [uri]);

  async function onSaveSettings(next: { productType?: string; artIncludedInDownload?: boolean }) {
    setSavingSettings(true);
    try {
      const updated = await updateCatalogProductSettings(uri, next);
      if (updated) {
        setProductType(updated.productType);
        setArtIncludedInDownload(updated.artIncludedInDownload);
      }
      toast.success("Saved");
    } catch (e) {
      toast.error("Could not save", { description: inventoryUserFacingError(e) });
    } finally {
      setSavingSettings(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  const removeItem = useCallback((itemUri: string) => {
    setItems((prev) => prev.filter((r) => r.uri !== itemUri));
  }, []);

  const moveItem = useCallback((index: number, direction: -1 | 1) => {
    setItems((prev) => moveArrayItem(prev, index, direction));
  }, []);

  const addItemFromFile = useCallback(
    async (file: File) => {
      setAddingItem(true);
      try {
        const { sessionId } = await createInventorySession("product");
        const { objects } = await registerInventoryObjects(sessionId, [
          {
            slotId: "new-item",
            fileName: file.name,
            contentType: file.type,
            byteSize: file.size,
            role: "master",
          },
        ]);
        const obj = objects[0];
        await uploadFileToInventoryObject(obj.objectId, file, obj.uploadKind);
        await saveInventoryDraft(sessionId, {
          items: [
            {
              objectId: obj.objectId,
              title: file.name.replace(/\.[^./\\]+$/, ""),
            },
          ],
        });
        const { items: created } = await publishItemsSession(sessionId);
        const newRefs: ItemRef[] = created.map((it) => ({
          uri: it.uri,
          cid: it.cid,
        }));
        setItems((prev) => [...prev, ...newRefs]);
        const fresh = await listCatalogItemRows();
        setItemsByUri(Object.fromEntries(fresh.map((r) => [r.uri, r])));
        toast.success("Item added — save to publish the updated product");
      } catch (e) {
        toast.error("Could not add item", {
          description: inventoryUserFacingError(e),
        });
      } finally {
        setAddingItem(false);
      }
    },
    [],
  );

  async function doSave(archiveTargets: ListingRow[]) {
    if (!agent || !product) return;
    setSaving(true);
    try {
      await putCatalogProduct(agent, uri, {
        title: title.trim(),
        description: description.trim() || undefined,
        items,
      });
      for (const listing of archiveTargets) {
        await putListing(agent, listing.uri, {
          ...listing.listing,
          status: "archived",
        });
      }
      await syncCatalogProduct(uri);
      toast.success("Saved");
      await load();
    } catch (e) {
      toast.error("Could not save changes", {
        description: inventoryUserFacingError(e),
      });
    } finally {
      setSaving(false);
    }
  }

  async function onSave() {
    if (!product) return;
    if (items.length === 0) {
      toast.error("A product needs at least one item");
      return;
    }
    const listings = await listListingRows(product.sellerDid).catch(() => []);
    const stale = findStaleListingsForItem(listings, product.uri, product.cid);
    if (stale.length > 0) {
      setStaleListings(stale);
      return;
    }
    await doSave([]);
  }

  async function onSync() {
    setSyncing(true);
    try {
      await syncCatalogProduct(uri);
      await load();
      toast.success("Synced with PDS");
    } catch (e) {
      toast.error("Sync failed", { description: inventoryUserFacingError(e) });
    } finally {
      setSyncing(false);
    }
  }

  if (!session || !agent) return null;

  if (!uri) {
    return (
      <div className="w-full min-w-0 space-y-4">
        <p className="text-sm text-destructive">Missing ?uri= (AT-URI).</p>
        <Link to="/merchant/inventory" className={cn(buttonVariants())}>
          Back to inventory
        </Link>
      </div>
    );
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading product…</p>;
  }

  if (loadError || !product) {
    return (
      <div className="w-full min-w-0 space-y-4">
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {loadError ?? "Unknown error."}
        </div>
        <Link to="/merchant/inventory" className={cn(buttonVariants())}>
          Back to inventory
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Edit product</h1>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={syncing}
          onClick={() => void onSync()}
        >
          {syncing ? "Syncing…" : "Sync with PDS"}
        </Button>
        <a
          href={catalogProductDownloadUrl(uri)}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          title="The same package a buyer would receive -- for handing off during support/incident triage"
        >
          Download package
        </a>
        <Link
          to="/merchant/inventory"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "ml-auto",
          )}
        >
          Cancel
        </Link>
      </div>

      {product.coverImages.length > 0 ? (
        <div className="max-w-xs">
          <CoverImageSlideshow images={product.coverImages} alt={product.title} />
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="prod-title">Title</Label>
        <Input
          id="prod-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={512}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="prod-desc">Description</Label>
        <Textarea
          id="prod-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          maxLength={4096}
        />
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <Label>Product type</Label>
        <p className="text-xs text-muted-foreground">
          UI-only — never part of the public record, so changing it doesn't
          affect any existing listing.
        </p>
        <div className="flex flex-wrap gap-2">
          {PRODUCT_TYPE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              size="sm"
              variant={productType === opt.value ? "default" : "outline"}
              disabled={savingSettings}
              onClick={() => void onSaveSettings({ productType: opt.value })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={artIncludedInDownload}
            disabled={savingSettings}
            onChange={(e) =>
              void onSaveSettings({ artIncludedInDownload: e.target.checked })
            }
          />
          Include cover art in the buyer's download package
        </label>
      </div>

      <div className="space-y-2">
        <Label>Items ({items.length})</Label>
        <p className="text-xs text-muted-foreground">
          Order here is display order on the storefront.
        </p>
        <div className="space-y-2">
          {items.map((ref, index) => {
            const info = itemsByUri[ref.uri];
            return (
              <div
                key={ref.uri}
                className="flex items-center justify-between gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex flex-col">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => moveItem(index, -1)}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Move down"
                    disabled={index === items.length - 1}
                    onClick={() => moveItem(index, 1)}
                  >
                    <ChevronDown />
                  </Button>
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/merchant/inventory/edit?uri=${encodeURIComponent(ref.uri)}`}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {info?.title ?? ref.uri}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {[info?.category, info?.format].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeItem(ref.uri)}
                >
                  Remove
                </Button>
              </div>
            );
          })}
        </div>
        <label
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "cursor-pointer",
            addingItem && "pointer-events-none opacity-60",
          )}
        >
          {addingItem ? "Adding…" : "Add item"}
          <input
            type="file"
            className="sr-only"
            disabled={addingItem}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void addItemFromFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <Button onClick={() => void onSave()} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>

      <Dialog
        open={!!staleListings}
        onOpenChange={(open) => {
          if (!open) setStaleListings(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {staleListings?.length === 1
                ? "1 listing will be archived"
                : `${staleListings?.length ?? 0} listings will be archived`}
            </DialogTitle>
            <DialogDescription>
              Saving changes this product's content, which invalidates the
              CID that {staleListings?.length === 1 ? "this listing" : "these listings"}{" "}
              pinned when created. To protect buyers from checking out
              against terms they never saw,{" "}
              {staleListings?.length === 1 ? "it" : "they"} will be archived.
              Create a new listing afterward if you want to sell this
              product again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setStaleListings(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void doSave(staleListings ?? [])}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save and archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
