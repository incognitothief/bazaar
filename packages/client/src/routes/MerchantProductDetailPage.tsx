import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Download, Pencil, Tag } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CoverImageSlideshow } from "@/components/merchant/CoverImageSlideshow";
import { BatchFileDropzone, type BatchFileEntry } from "@/components/shared/BatchFileDropzone";
import { ImageDropzone } from "@/components/shared/ImageDropzone";
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
  addCatalogProductAsset,
  findStaleListingsForItem,
  getCatalogProduct,
  getCatalogProductAssets,
  listCatalogItemRows,
  listListingRows,
  putCatalogProduct,
  putListing,
  removeCatalogProductAsset,
  syncCatalogProduct,
  catalogProductDownloadUrl,
  updateCatalogProductSettings,
  type CatalogItemRow,
  type CatalogProductAssets,
  type CatalogProductRow,
  type ListingRow,
} from "@/lib/atproto/records";
import { PRODUCT_TYPE_OPTIONS, productTypeConfig } from "@/lib/productTypes";
import { cn, moveArrayItem } from "@/lib/utils";
import type { ItemRef } from "@/types/lexicons";

const titleFromFileName = (name: string) => name.replace(/\.[^./\\]+$/, "");

export function MerchantProductDetailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
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

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [staleListings, setStaleListings] = useState<ListingRow[] | null>(null);
  const [assets, setAssets] = useState<CatalogProductAssets>({
    coverImages: [],
    includedAssets: [],
  });
  const [uploadingCoverArt, setUploadingCoverArt] = useState(false);
  const [uploadingAssetIds, setUploadingAssetIds] = useState<Set<string>>(new Set());
  const [removingAssetId, setRemovingAssetId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uri) return;
    setLoading(true);
    setLoadError(null);
    const [p, allItems, productAssets] = await Promise.all([
      getCatalogProduct(uri),
      listCatalogItemRows(),
      getCatalogProductAssets(uri),
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
    setAssets(productAssets ?? { coverImages: [], includedAssets: [] });
    setLoading(false);
  }, [uri]);

  async function onSaveSettings(next: { productType?: string; artIncludedInDownload?: boolean }) {
    setSavingSettings(true);
    try {
      const updated = await updateCatalogProductSettings(uri, next);
      if (!updated) {
        toast.error("Could not save");
        return;
      }
      setProductType(updated.productType);
      setArtIncludedInDownload(updated.artIncludedInDownload);
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

  /** Cover art and included assets are ERP-only (catalogProductAssets) -- no PDS write, no CID change, so adding/removing one never affects the product's pinned CID or any listing. */
  const addCoverImage = useCallback(
    async (file: File) => {
      setUploadingCoverArt(true);
      try {
        const { sessionId } = await createInventorySession("product");
        const { objects } = await registerInventoryObjects(sessionId, [
          {
            slotId: "cover-art",
            fileName: file.name,
            contentType: file.type,
            byteSize: file.size,
            role: "artwork",
          },
        ]);
        const obj = objects[0];
        await uploadFileToInventoryObject(obj.objectId, file, obj.uploadKind);
        const updated = await addCatalogProductAsset({
          productUri: uri,
          objectId: obj.objectId,
          role: "coverArt",
        });
        if (updated) setAssets(updated);
        else toast.error("Could not add cover art");
      } catch (e) {
        toast.error("Could not add cover art", {
          description: inventoryUserFacingError(e),
        });
      } finally {
        setUploadingCoverArt(false);
      }
    },
    [uri],
  );

  const addIncludedAssetBatch = useCallback(
    async (entries: BatchFileEntry[]) => {
      setUploadingAssetIds((prev) => new Set([...prev, ...entries.map((e) => e.id)]));
      try {
        const { sessionId } = await createInventorySession("product");
        const { objects } = await registerInventoryObjects(
          sessionId,
          entries.map((entry) => ({
            slotId: entry.id,
            fileName: entry.file.name,
            contentType: entry.file.type,
            byteSize: entry.file.size,
            role: "artwork" as const,
          })),
        );
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const obj = objects[i];
          try {
            await uploadFileToInventoryObject(obj.objectId, entry.file, obj.uploadKind);
            const updated = await addCatalogProductAsset({
              productUri: uri,
              objectId: obj.objectId,
              role: titleFromFileName(entry.file.name),
            });
            if (updated) setAssets(updated);
          } catch (e) {
            toast.error(`Could not add ${entry.file.name}`, {
              description: inventoryUserFacingError(e),
            });
          } finally {
            setUploadingAssetIds((prev) => {
              const next = new Set(prev);
              next.delete(entry.id);
              return next;
            });
          }
        }
      } catch (e) {
        toast.error("Could not register files", {
          description: inventoryUserFacingError(e),
        });
        setUploadingAssetIds((prev) => {
          const next = new Set(prev);
          for (const entry of entries) next.delete(entry.id);
          return next;
        });
      }
    },
    [uri],
  );

  const removeAsset = useCallback(async (id: string) => {
    setRemovingAssetId(id);
    try {
      const updated = await removeCatalogProductAsset(id);
      if (updated) setAssets(updated);
      else toast.error("Could not remove");
    } catch (e) {
      toast.error("Could not remove", { description: inventoryUserFacingError(e) });
    } finally {
      setRemovingAssetId(null);
    }
  }, []);

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
      if (archiveTargets.length > 0) {
        toast.success("Saved — the old listing has been de-listed", {
          description: "Create a new listing to sell this product again.",
          action: {
            label: "Create listing",
            onClick: () =>
              navigate(
                `/merchant/listings/new?prefillItemUri=${encodeURIComponent(uri)}`,
              ),
          },
        });
      } else {
        toast.success("Saved");
      }
      setStaleListings(null);
      await load();
      setEditing(false);
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

  function cancelEditing() {
    if (product) {
      setTitle(product.title);
      setDescription(product.description ?? "");
      setItems(product.items as ItemRef[]);
    }
    setEditing(false);
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
      <h1 className="text-2xl font-semibold">
        {editing ? "Edit product" : "Product"}
      </h1>

      <div className="flex flex-wrap items-start gap-4">
        {product.coverImages.length > 0 ? (
          <div className="max-w-xs">
            <CoverImageSlideshow images={product.coverImages} alt={product.title} />
          </div>
        ) : null}
        <div className="ml-auto grid grid-cols-2 gap-1">
          {!editing ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Edit product"
              title="Edit product"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4" />
            </Button>
          ) : null}
          <a
            href={catalogProductDownloadUrl(uri)}
            className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }))}
            aria-label="Download package"
            title="Download package -- the same package a buyer would receive, for handing off during support/incident triage"
          >
            <Download className="size-4" />
          </a>
          {!editing ? (
            <Link
              to={`/merchant/listings/new?prefillItemUri=${encodeURIComponent(uri)}`}
              className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }))}
              aria-label="Create listing"
              title="Create listing"
            >
              <Tag className="size-4" />
            </Link>
          ) : null}
          <Link
            to="/merchant/inventory"
            className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }))}
            aria-label="Back to inventory"
            title="Back to inventory"
          >
            <ArrowLeft className="size-4" />
          </Link>
        </div>
      </div>

      {editing ? (
        <>
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
            <Label>
              {productTypeConfig(productType).allowMultipleCoverImages
                ? "Cover images"
                : "Cover art"}
            </Label>
            {assets.coverImages.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {assets.coverImages.map((img) => (
                  <div key={img.id} className="relative">
                    <img
                      src={img.url}
                      alt=""
                      className="h-20 w-20 rounded-md border border-border object-cover"
                    />
                    <button
                      type="button"
                      disabled={removingAssetId === img.id}
                      onClick={() => void removeAsset(img.id)}
                      className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground disabled:opacity-60"
                      aria-label="Remove image"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {productTypeConfig(productType).allowMultipleCoverImages ||
            assets.coverImages.length === 0 ? (
              <ImageDropzone
                onFile={(file) => void addCoverImage(file)}
                onError={(m) => toast.error(m)}
              />
            ) : null}
            {uploadingCoverArt ? (
              <p className="text-xs text-muted-foreground">Uploading…</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Included assets ({assets.includedAssets.length})</Label>
            <p className="text-xs text-muted-foreground">
              Liner notes, a poster, anything else bundled with the purchase
              but not part of the product's core items. Always included in
              the buyer's download.
            </p>
            {assets.includedAssets.length > 0 ? (
              <div className="space-y-2">
                {assets.includedAssets.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.role}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {a.fileName}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={removingAssetId === a.id}
                      onClick={() => void removeAsset(a.id)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            <BatchFileDropzone
              onBatch={(entries) => void addIncludedAssetBatch(entries)}
              onError={(m) => toast.error(m)}
              hint="Each file is included in the download as-is."
            />
            {uploadingAssetIds.size > 0 ? (
              <p className="text-xs text-muted-foreground">Uploading…</p>
            ) : null}
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

          <div className="flex items-center gap-3">
            <Button onClick={() => void onSave()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={cancelEditing}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <h2 className="text-lg font-medium">{product.title}</h2>
            {product.description ? (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {product.description}
              </p>
            ) : null}
          </div>

          <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
            <p>
              <span className="text-muted-foreground">Product type: </span>
              {productTypeConfig(product.productType).label}
            </p>
            <p>
              <span className="text-muted-foreground">Cover art in download: </span>
              {product.artIncludedInDownload ? "Yes" : "No"}
            </p>
            {assets.includedAssets.length > 0 ? (
              <p>
                <span className="text-muted-foreground">Included assets: </span>
                {assets.includedAssets.map((a) => a.role).join(", ")}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Items ({items.length})</Label>
            <div className="space-y-2">
              {items.map((ref) => {
                const info = itemsByUri[ref.uri];
                return (
                  <div
                    key={ref.uri}
                    className="rounded-lg border border-border p-3"
                  >
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
                );
              })}
            </div>
          </div>
        </>
      )}

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
                ? "1 listing will be de-listed"
                : `${staleListings?.length ?? 0} listings will be de-listed`}
            </DialogTitle>
            <DialogDescription>
              Saving changes this product's content, which invalidates the
              CID that {staleListings?.length === 1 ? "this listing" : "these listings"}{" "}
              pinned when created. To protect buyers from checking out
              against terms they never saw,{" "}
              {staleListings?.length === 1 ? "it" : "they"} will be
              permanently de-listed and can't be reactivated — create a new
              listing afterward if you want to sell this product again.
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
              {saving
                ? "Saving…"
                : "I acknowledge this item will be de-listed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
