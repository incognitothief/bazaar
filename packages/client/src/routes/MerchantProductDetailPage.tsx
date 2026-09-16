import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Download,
  Pencil,
  Tag,
  Trash2,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  BatchFileDropzone,
  type BatchFileEntry,
} from "@/components/shared/BatchFileDropzone";
import { ImageDropzone } from "@/components/shared/ImageDropzone";
import { MarkdownBody } from "@/components/shared/MarkdownBody";
import { MetadataChip } from "@/components/shared/MetadataChip";
import { TagsInput } from "@/components/shared/TagsInput";
import { TagTokens } from "@/components/shared/TagTokens";
import {
  createInventorySession,
  inventoryUserFacingError,
  publishItemsSession,
  registerInventoryObjects,
  saveInventoryDraft,
  uploadFileToInventoryObject,
} from "@/lib/api/inventoryApi";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DetailToolbar, type ToolAction } from "@/components/merchant/detailTools";
import { DeleteEntryDialog } from "@/components/merchant/DeleteEntryDialog";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useElapsedSeconds } from "@/hooks/useElapsedSeconds";
import { useZipProgress } from "@/hooks/useZipProgress";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import {
  addCatalogProductAsset,
  buildItemRefFromUri,
  catalogProductDownloadUrl,
  getCatalogItem,
  getCatalogProduct,
  getCatalogProductAssets,
  getRecordValueWithCid,
  listListingRows,
  putCatalogProduct,
  putListing,
  rebuildCatalogProductZip,
  removeCatalogProductAsset,
  syncCatalogProduct,
  updateCatalogProductSettings,
  type CatalogItemRow,
  type CatalogProductAssets,
  type CatalogProductRow,
} from "@/lib/atproto/records";
import { PRODUCT_TYPE_OPTIONS, productTypeConfig } from "@/lib/productTypes";
import { contentClassFromFormat } from "@/lib/itemContentClass";
import { itemMetaLabel, isAudioMeta } from "@/lib/itemMetaLabel";
import { formatMoney } from "@/lib/format";
import { probeImageSize, probeVideoDuration } from "@/lib/media/probe";
import { cn, formatBytes, moveArrayItem } from "@/lib/utils";
import type { Ref, LicenseTerms, Listing } from "@/types/lexicons";

const titleFromFileName = (name: string) => name.replace(/\.[^./\\]+$/, "");

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

  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [product, setProduct] = useState<CatalogProductRow | null>(null);
  const [itemsByUri, setItemsByUri] = useState<Record<string, CatalogItemRow>>(
    {},
  );
  const [listing, setListing] = useState<Listing | null>(null);
  const [listingUri, setListingUri] = useState<string | null>(null);
  const [license, setLicense] = useState<LicenseTerms | null>(null);
  const [licenseCid, setLicenseCid] = useState<string | null>(null);
  /** Non-terminal listing per member-item AT-URI — drives the per-row Create/View listing action. */
  const [childListingByUri, setChildListingByUri] = useState<
    Record<string, Listing>
  >({});

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [items, setItems] = useState<Ref[]>([]);
  const [productType, setProductType] = useState<string | null>(null);
  const [artIncludedInDownload, setArtIncludedInDownload] = useState(false);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const savingElapsed = useElapsedSeconds(saving);
  const settingsElapsed = useElapsedSeconds(savingSettings);
  const savingZipProgress = useZipProgress(uri, saving);
  const settingsZipProgress = useZipProgress(uri, savingSettings);
  const [retryingZip, setRetryingZip] = useState(false);
  const retryZipProgress = useZipProgress(uri, retryingZip);
  const sawRetryProgressRef = useRef(false);
  const [assets, setAssets] = useState<CatalogProductAssets>({
    coverImages: [],
    includedAssets: [],
  });
  const [uploadingCoverArt, setUploadingCoverArt] = useState(false);
  const [uploadingAssetIds, setUploadingAssetIds] = useState<Set<string>>(
    new Set(),
  );
  const [removingAssetId, setRemovingAssetId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uri) return;
    setLoading(true);
    setLoadError(null);
    const [p, productAssets] = await Promise.all([
      getCatalogProduct(uri),
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
    setTags(p.tags ?? []);
    setItems(p.items as Ref[]);
    setProductType(p.productType);
    setArtIncludedInDownload(p.artIncludedInDownload);
    setAssets(productAssets ?? { coverImages: [], includedAssets: [] });

    // Per-member fetch: the bulk item list has no media metadata (runtime /
    // size / dimensions) -- only this endpoint joins the upload object, same
    // as the storefront product page.
    const memberMetas = await Promise.all(
      (p.items as Ref[]).map((ref) => getCatalogItem(ref.uri)),
    );
    setItemsByUri(
      Object.fromEntries(
        memberMetas
          .filter((m): m is CatalogItemRow => !!m)
          .map((m) => [m.uri, m]),
      ),
    );

    const rows = await listListingRows(p.merchantDid).catch(() => []);
    const primary = rows
      .filter((r) => r.listing.item.uri === uri && !r.listing.parentListing)
      .sort(
        (a, b) =>
          Date.parse(b.listing.createdAt) - Date.parse(a.listing.createdAt),
      )[0];
    setListing(primary?.listing ?? null);
    setListingUri(primary?.uri ?? null);
    if (primary?.listing.licenseGrant?.uri) {
      const lt = await getRecordValueWithCid<LicenseTerms>(
        primary.listing.licenseGrant.uri,
      ).catch(() => null);
      setLicense(lt?.value ?? null);
      setLicenseCid(lt?.cid ?? null);
    } else {
      setLicense(null);
      setLicenseCid(null);
    }

    const memberUris = new Set((p.items as Ref[]).map((r) => r.uri));
    const byItem: Record<string, Listing> = {};
    for (const r of rows) {
      if (r.listing.item.uri === uri) continue;
      if (!memberUris.has(r.listing.item.uri)) continue;
      byItem[r.listing.item.uri] = r.listing;
    }
    setChildListingByUri(byItem);

    setLoading(false);
  }, [uri]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!retryingZip) {
      sawRetryProgressRef.current = false;
      return;
    }
    if (retryZipProgress) sawRetryProgressRef.current = true;
  }, [retryingZip, retryZipProgress]);

  useEffect(() => {
    if (!retryingZip) return;
    let cancelled = false;

    const finish = async () => {
      const p = await getCatalogProduct(uri);
      if (cancelled) return;
      if (p) setProduct(p);
      setRetryingZip(false);
      if (p?.packageZipStatus === "ready") {
        toast.success("Download package rebuilt");
      }
    };

    if (retryZipProgress) return () => {
      cancelled = true;
    };

    if (sawRetryProgressRef.current) {
      void finish();
      return () => {
        cancelled = true;
      };
    }

    const interval = setInterval(() => {
      void getCatalogProduct(uri).then((p) => {
        if (cancelled || !p) return;
        if (p.packageZipStatus === "ready") {
          setProduct(p);
          setRetryingZip(false);
          toast.success("Download package rebuilt");
        }
      });
    }, 700);
    const failSafe = setTimeout(() => {
      if (!sawRetryProgressRef.current) void finish();
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(failSafe);
    };
  }, [retryingZip, retryZipProgress, uri]);

  async function onRetryPackageZip() {
    if (retryingZip) return;
    setRetryingZip(true);
    const ok = await rebuildCatalogProductZip(uri);
    if (!ok) {
      toast.error("Could not start a rebuild");
      setRetryingZip(false);
    }
  }

  async function onSaveSettings(next: {
    productType?: string;
    artIncludedInDownload?: boolean;
  }) {
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
      toast.error("Could not save", {
        description: inventoryUserFacingError(e),
      });
    } finally {
      setSavingSettings(false);
    }
  }

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
        const { sessionId } = await createInventorySession(uri);
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

        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        const cls = contentClassFromFormat(ext);
        let durationMs: number | undefined;
        let width: number | undefined;
        let height: number | undefined;
        if (cls === "video") {
          durationMs = (await probeVideoDuration(file)) ?? undefined;
        } else if (cls === "graphic") {
          const size = await probeImageSize(file);
          width = size?.width;
          height = size?.height;
        }

        await saveInventoryDraft(sessionId, {
          items: [
            {
              objectId: obj.objectId,
              title: titleFromFileName(file.name),
              durationMs,
              width,
              height,
            },
          ],
        });
        const { items: created } = await publishItemsSession(sessionId);
        const newRefs: Ref[] = created.map((it) => ({
          uri: it.uri,
          cid: it.cid,
        }));
        setItems((prev) => [...prev, ...newRefs]);
        const freshMetas = await Promise.all(
          newRefs.map((r) => getCatalogItem(r.uri)),
        );
        setItemsByUri((prev) => ({
          ...prev,
          ...Object.fromEntries(
            freshMetas
              .filter((m): m is CatalogItemRow => !!m)
              .map((m) => [m.uri, m]),
          ),
        }));
        toast.success("Item added — save to publish the updated product");
      } catch (e) {
        toast.error("Could not add item", {
          description: inventoryUserFacingError(e),
        });
      } finally {
        setAddingItem(false);
      }
    },
    [uri],
  );

  /** Cover art and included assets are ERP-only (catalogProductAssets) -- no PDS write, no CID change, so adding/removing one never affects the product's pinned CID or any listing. */
  const addCoverImage = useCallback(
    async (file: File) => {
      setUploadingCoverArt(true);
      try {
        const { sessionId } = await createInventorySession(uri);
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
      setUploadingAssetIds(
        (prev) => new Set([...prev, ...entries.map((e) => e.id)]),
      );
      try {
        const { sessionId } = await createInventorySession(uri);
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
            await uploadFileToInventoryObject(
              obj.objectId,
              entry.file,
              obj.uploadKind,
            );
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
      toast.error("Could not remove", {
        description: inventoryUserFacingError(e),
      });
    } finally {
      setRemovingAssetId(null);
    }
  }, []);

  const paramsChanged = useCallback((): boolean => {
    if (!product) return false;
    const sameItems =
      items.length === product.items.length &&
      items.every((r, i) => r.uri === (product.items as Ref[])[i]?.uri);
    return (
      title.trim() !== product.title ||
      (description.trim() || "") !== (product.description ?? "") ||
      JSON.stringify(tags) !== JSON.stringify(product.tags ?? []) ||
      !sameItems
    );
  }, [product, title, description, tags, items]);

  /**
   * Save the product record. A metadata change re-pins the listing's
   * `item.cid` in place (same URI) so checkout doesn't reject it as
   * "item_changed" -- price and terms are edited from the listing tool, not
   * here.
   */
  async function doSave() {
    if (!agent || !product) return;
    setSaving(true);
    try {
      const repin = paramsChanged();
      await putCatalogProduct(agent, uri, {
        title: title.trim(),
        description: description.trim() || undefined,
        tags: tags.length ? tags : undefined,
        items,
      });

      if (repin && listing && listingUri) {
        const freshRef = await buildItemRefFromUri(uri);
        await putListing(agent, listingUri, {
          ...listing,
          item: freshRef ?? listing.item,
        });
      }

      await syncCatalogProduct(uri);
      toast.success("Saved");
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
    await doSave();
  }

  function cancelEditing() {
    if (product) {
      setTitle(product.title);
      setDescription(product.description ?? "");
      setTags(product.tags ?? []);
      setItems(product.items as Ref[]);
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

  const cfg = productTypeConfig(productType);
  const isMusic = cfg.value === "music";
  const coverImages = assets.coverImages;

  const toolActions: ToolAction[] = [
    ...(!editing
      ? [
          {
            key: "edit",
            Icon: Pencil,
            label: "Edit product",
            onClick: () => setEditing(true),
          },
        ]
      : []),
    {
      key: "download",
      Icon: Download,
      label: "Download package",
      externalHref: catalogProductDownloadUrl(uri),
    },
    ...(!editing
      ? [
          {
            key: "list",
            Icon: Tag,
            label: listing ? "Manage listings" : "Create listing",
            href: `/merchant/listings/new?uri=${encodeURIComponent(uri)}`,
          },
        ]
      : []),
    ...(!editing
      ? [
          {
            key: "delete",
            Icon: Trash2,
            label: "Delete permanently",
            onClick: () => setDeleteTarget(uri),
            // A live listing blocks deletion server-side regardless; surfacing
            // it here saves the merchant a round trip into the dialog.
            disabled: !!listing,
            disabledHint: "Unlist this product before deleting it",
          },
        ]
      : []),
  ];

  // Music product: audio members are the numbered "Tracks"; any non-audio
  // member drops to "Also included". Bonus files (catalogProductAssets) are
  // never listed here -- same split the storefront uses.
  const musicTracks = isMusic
    ? items.filter((r) => isAudioMeta(itemsByUri[r.uri]))
    : [];
  const musicAlsoIncluded = isMusic
    ? items.filter((r) => !isAudioMeta(itemsByUri[r.uri]))
    : [];

  const renderItemRow = (
    ref: Ref,
    marker: number | "bullet" | null,
    index: number,
  ) => {
    const info = itemsByUri[ref.uri];
    const metaLabel = itemMetaLabel(info);
    const childListing = childListingByUri[ref.uri];
    const editHref = `/merchant/inventory/edit?uri=${encodeURIComponent(
      ref.uri,
    )}&from=${encodeURIComponent(uri)}`;
    return (
      <li
        key={ref.uri}
        className="flex items-center justify-between gap-6 py-1.5"
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          {marker != null ? (
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {marker === "bullet" ? "•" : `${marker}.`}
            </span>
          ) : null}
          {editing ? (
            <span className="flex shrink-0 flex-col">
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
            </span>
          ) : null}
          <span
            className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm"
            style={{
              maskImage:
                "linear-gradient(to right, black 70%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to right, black 70%, transparent 100%)",
            }}
          >
            <Link
              to={editHref}
              className="font-medium underline-offset-2 hover:underline"
            >
              {info?.title ?? ref.uri}
            </Link>
            {metaLabel ? (
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {metaLabel}
              </span>
            ) : null}
          </span>
        </span>
        {editing ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => removeItem(ref.uri)}
          >
            Remove
          </Button>
        ) : childListing ? (
          <Link
            to={editHref}
            className={cn(
              buttonVariants({ size: "sm", variant: "outline" }),
              "shrink-0",
            )}
          >
            View listing
          </Link>
        ) : (
          <Link
            to={`/merchant/listings/new?uri=${encodeURIComponent(ref.uri)}`}
            className={cn(
              buttonVariants({ size: "sm", variant: "outline" }),
              "shrink-0",
            )}
          >
            Create listing
          </Link>
        )}
      </li>
    );
  };

  return (
    <div className="w-full min-w-0 max-w-5xl space-y-8">
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/merchant/inventory"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground pt-4"
        >
          <ArrowLeft className="size-4" />
          Back to inventory
        </Link>
        {editing ? (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <Button onClick={() => void onSave()} disabled={saving}>
                {saving
                  ? savingZipProgress
                    ? `Zipping ${savingZipProgress.current}/${savingZipProgress.total}…`
                    : savingElapsed >= 2
                      ? `Saving… (${savingElapsed}s)`
                      : "Saving…"
                  : "Save"}
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
            {saving && items.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {savingZipProgress
                  ? `Repackaging ${savingZipProgress.fileName}`
                  : "Repackaging the download bundle for buyers — this can take longer for larger products."}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Hero — mirrors the storefront product layout */}
      <section className="grid gap-8 lg:grid-cols-[1fr_minmax(0,24rem)] lg:items-start">
        <div className="space-y-3">
          <div className="aspect-square max-h-[min(70vw,28rem)] overflow-hidden rounded-xl border border-border bg-muted">
            {coverImages[0] ? (
              <img
                src={coverImages[0].url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                No cover art
              </div>
            )}
          </div>
          {editing ? (
            <div className="space-y-2">
              {coverImages.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {coverImages.map((img) => (
                    <div key={img.id} className="relative">
                      <img
                        src={img.url}
                        alt=""
                        className="h-16 w-16 rounded-md border border-border object-cover"
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
              {cfg.allowMultipleCoverImages || coverImages.length === 0 ? (
                <ImageDropzone
                  onFile={(file) => void addCoverImage(file)}
                  onError={(m) => toast.error(m)}
                />
              ) : null}
              {uploadingCoverArt ? (
                <p className="text-xs text-muted-foreground">Uploading…</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            {editing ? (
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="prod-title">Title</Label>
                <Input
                  id="prod-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={512}
                />
              </div>
            ) : (
              <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
            )}
            <DetailToolbar actions={toolActions} panelTitle="Product controls" />
            <DeleteEntryDialog
              entryUri={deleteTarget}
              onClose={() => setDeleteTarget(null)}
              onDeleted={() => {
                navigate("/merchant/inventory", { replace: true });
              }}
            />
          </div>

          {listing ? (
            <p className="text-2xl font-medium">{formatMoney(listing.price)}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Not listed yet</p>
          )}

          {editing ? (
            <div className="space-y-1.5">
              <Label htmlFor="prod-tags">Tags</Label>
              <TagsInput
                id="prod-tags"
                tags={tags}
                onChange={setTags}
                placeholder="e.g. lofi, instrumental, album"
              />
            </div>
          ) : tags.length ? (
            <TagTokens tags={tags} part="tokens" className="pt-1" />
          ) : null}
        </div>
      </section>

      {/* Metadata */}
      <section
        className="flex flex-wrap items-center gap-2"
        aria-label="Metadata"
      >
        <MetadataChip>{cfg.label}</MetadataChip>
        <MetadataChip>
          {items.length}{" "}
          {isMusic
            ? items.length === 1
              ? "track"
              : "tracks"
            : items.length === 1
              ? "item"
              : "items"}
        </MetadataChip>
        {product.totalBytes ? (
          <MetadataChip>{formatBytes(product.totalBytes)}</MetadataChip>
        ) : null}
        {!editing && tags.length ? (
          <TagTokens tags={tags} part="plain" />
        ) : null}
      </section>

      {product.packageZipStatus === "failed" || retryingZip ? (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p>
              This product's download package failed to build — customers will
              get a slower first download until this is fixed.
            </p>
            {retryingZip ? (
              <p className="text-xs text-muted-foreground">
                {retryZipProgress
                  ? `Repackaging ${retryZipProgress.fileName}`
                  : "Retrying the download bundle…"}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={retryingZip}
            onClick={() => void onRetryPackageZip()}
          >
            {retryingZip
              ? retryZipProgress
                ? `Zipping ${retryZipProgress.current}/${retryZipProgress.total}…`
                : "Retrying…"
              : "Retry"}
          </Button>
        </div>
      ) : null}

      {/* Items */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">
            {isMusic ? "Tracks" : "Items"}
          </h2>
          {editing ? (
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
          ) : null}
        </div>
        {editing ? (
          <p className="text-xs text-muted-foreground">
            Order here is display order on the storefront. Removing an item
            drops it from the bundle.
          </p>
        ) : null}

        {editing ? (
          <ol className="m-0 list-none space-y-2 p-0 text-sm">
            {items.map((ref, i) => renderItemRow(ref, i + 1, i))}
          </ol>
        ) : isMusic ? (
          <>
            <ol className="m-0 list-none space-y-2 p-0 text-sm">
              {musicTracks.map((ref, i) =>
                renderItemRow(ref, i + 1, items.indexOf(ref)),
              )}
            </ol>
            {musicAlsoIncluded.length > 0 ? (
              <div className="space-y-3 pt-4">
                <h3 className="text-base font-medium">Also included</h3>
                <ul className="m-0 list-none space-y-2 p-0 text-sm">
                  {musicAlsoIncluded.map((ref) =>
                    renderItemRow(ref, "bullet", items.indexOf(ref)),
                  )}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <ol className="m-0 list-none space-y-2 p-0 text-sm">
            {items.map((ref, i) => renderItemRow(ref, null, i))}
          </ol>
        )}
      </section>

      {/* Description */}
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Description</h2>
        {editing ? (
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={4096}
            placeholder="Shown on the storefront. Markdown supported."
          />
        ) : description ? (
          <div className="max-w-none text-sm text-foreground">
            <MarkdownBody>{description}</MarkdownBody>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No description</p>
        )}
      </section>

      {/* License — the terms the current listing was created against */}
      {listing && license ? (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">License</h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {typeof license.licenseText === "string"
              ? license.licenseText
              : "License text unavailable — see full terms."}
          </p>
          {licenseCid ? (
            <a
              href={`/license/${encodeURIComponent(licenseCid)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm text-primary underline-offset-2 hover:underline"
            >
              View full license →
            </a>
          ) : null}
        </section>
      ) : null}

      {/* Merchant-only settings */}
      {editing ? (
        <section className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
          <div>
            <h2 className="text-sm font-medium">
              Merchant settings — not shown to buyers
            </h2>
            <p className="text-xs text-muted-foreground">
              These save immediately and never touch the public record or any
              listing.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Product type</Label>
            <div className="flex flex-wrap gap-2">
              {PRODUCT_TYPE_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  type="button"
                  size="sm"
                  variant={productType === opt.value ? "default" : "outline"}
                  disabled={savingSettings}
                  onClick={() =>
                    void onSaveSettings({ productType: opt.value })
                  }
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
                  void onSaveSettings({
                    artIncludedInDownload: e.target.checked,
                  })
                }
              />
              Include cover art in the buyer's download package
            </label>
            {savingSettings ? (
              <p className="text-xs text-muted-foreground">
                {settingsZipProgress
                  ? `Zipping ${settingsZipProgress.current}/${settingsZipProgress.total} — ${settingsZipProgress.fileName}`
                  : `Saving${settingsElapsed >= 2 ? ` (${settingsElapsed}s)` : "…"} — repackaging the download bundle for buyers.`}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Included assets ({assets.includedAssets.length})</Label>
            <p className="text-xs text-muted-foreground">
              Liner notes, a poster, anything bundled with the purchase but not
              a core item. Always in the buyer's download.
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
        </section>
      ) : null}
    </div>
  );
}
