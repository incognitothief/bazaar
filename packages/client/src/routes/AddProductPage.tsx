import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  createInventorySession,
  inventoryUserFacingError,
  publishProductSession,
  registerInventoryObjects,
  saveInventoryDraft,
  uploadFileToInventoryObject,
} from "@/lib/api/inventoryApi";
import { BatchFileDropzone, type BatchFileEntry } from "@/components/shared/BatchFileDropzone";
import { ImageDropzone } from "@/components/shared/ImageDropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  GENERIC_PRODUCT_TYPE,
  PRODUCT_TYPE_OPTIONS,
  productTypeConfig,
  type ProductType,
} from "@/lib/productTypes";
import { cn, moveArrayItem } from "@/lib/utils";

type ItemDraftRow = {
  id: string;
  file: File;
  title: string;
  category: string;
  format: string;
  objectId: string | null;
  status: "pending" | "uploading" | "completed" | "error";
  progress: number;
  error: string | null;
};

/**
 * Cover art -- productTypeConfig().allowMultipleCoverImages gates whether
 * dropping a new image replaces this array or appends to it; the array
 * itself always supports any length, the data model doesn't distinguish
 * single vs. slideshow (see CoverImageSlideshow.tsx).
 */
type CoverImageDraft = {
  id: string;
  file: File;
  previewUrl: string;
  objectId: string | null;
  uploading: boolean;
};

/**
 * The generic included-assets bin (catalogProductAssets) -- companion
 * files (liner notes, a poster, etc.) that are always bundled into the
 * buyer's download but aren't part of the product's public composition.
 * `label` becomes the ERP row's freeform `role` field; it's just a
 * merchant-facing description, not a fixed taxonomy.
 */
type AssetDraftRow = {
  id: string;
  file: File;
  label: string;
  objectId: string | null;
  status: "uploading" | "completed" | "error";
  error: string | null;
};

function titleFromFileName(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}

function formatFromFileName(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m?.[1] ?? "";
}

export function AddProductPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [productType, setProductType] = useState<ProductType>(GENERIC_PRODUCT_TYPE);
  const [artIncludedInDownload, setArtIncludedInDownload] = useState(
    () => productTypeConfig(GENERIC_PRODUCT_TYPE).defaultArtIncludedInDownload,
  );
  const allowMultipleCoverImages = productTypeConfig(productType).allowMultipleCoverImages;
  const [coverImages, setCoverImages] = useState<CoverImageDraft[]>([]);

  const [items, setItems] = useState<ItemDraftRow[]>([]);
  const [assets, setAssets] = useState<AssetDraftRow[]>([]);
  const [publishing, setPublishing] = useState(false);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId;
    const { sessionId: id } = await createInventorySession("product");
    setSessionId(id);
    return id;
  }, [sessionId]);

  const handleCoverImageFile = useCallback(
    async (file: File, previewUrl: string) => {
      const draftId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const draft: CoverImageDraft = {
        id: draftId,
        file,
        previewUrl,
        objectId: null,
        uploading: true,
      };
      setCoverImages((prev) => (allowMultipleCoverImages ? [...prev, draft] : [draft]));
      try {
        const id = await ensureSession();
        const { objects } = await registerInventoryObjects(id, [
          {
            slotId: `cover-art-${draftId}`,
            fileName: file.name,
            contentType: file.type,
            byteSize: file.size,
            role: "artwork",
          },
        ]);
        const obj = objects[0];
        await uploadFileToInventoryObject(obj.objectId, file, obj.uploadKind);
        setCoverImages((prev) =>
          prev.map((img) =>
            img.id === draftId ? { ...img, objectId: obj.objectId, uploading: false } : img,
          ),
        );
      } catch (e) {
        toast.error("Could not upload cover art", {
          description: inventoryUserFacingError(e),
        });
        setCoverImages((prev) => prev.filter((img) => img.id !== draftId));
      }
    },
    [ensureSession, allowMultipleCoverImages],
  );

  const removeCoverImage = useCallback((id: string) => {
    setCoverImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const allCoverImagesReady = coverImages.every((img) => !img.uploading);

  const handleItemBatch = useCallback(
    async (entries: BatchFileEntry[]) => {
      const id = await ensureSession().catch((e) => {
        toast.error("Could not start upload session", {
          description: inventoryUserFacingError(e),
        });
        return null;
      });
      if (!id) return;

      const rows: ItemDraftRow[] = entries.map((entry) => ({
        id: entry.id,
        file: entry.file,
        title: titleFromFileName(entry.file.name),
        category: "",
        format: formatFromFileName(entry.file.name),
        objectId: null,
        status: "pending",
        progress: 0,
        error: null,
      }));
      setItems((prev) => [...prev, ...rows]);

      try {
        const { objects } = await registerInventoryObjects(
          id,
          entries.map((entry) => ({
            slotId: entry.id,
            fileName: entry.file.name,
            contentType: entry.file.type,
            byteSize: entry.file.size,
            role: "master" as const,
          })),
        );
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const obj = objects[i];
          setItems((prev) =>
            prev.map((r) =>
              r.id === entry.id
                ? { ...r, objectId: obj.objectId, status: "uploading" }
                : r,
            ),
          );
          try {
            await uploadFileToInventoryObject(
              obj.objectId,
              entry.file,
              obj.uploadKind,
              (progress) => {
                const pct = progress.total
                  ? Math.round((progress.loaded / progress.total) * 100)
                  : 0;
                setItems((prev) =>
                  prev.map((r) => (r.id === entry.id ? { ...r, progress: pct } : r)),
                );
              },
            );
            setItems((prev) =>
              prev.map((r) =>
                r.id === entry.id ? { ...r, status: "completed", progress: 100 } : r,
              ),
            );
          } catch (e) {
            setItems((prev) =>
              prev.map((r) =>
                r.id === entry.id
                  ? { ...r, status: "error", error: inventoryUserFacingError(e) }
                  : r,
              ),
            );
          }
        }
      } catch (e) {
        toast.error("Could not register files", {
          description: inventoryUserFacingError(e),
        });
        setItems((prev) => prev.filter((r) => !entries.some((entry) => entry.id === r.id)));
      }
    },
    [ensureSession],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const moveItem = useCallback((index: number, direction: -1 | 1) => {
    setItems((prev) => moveArrayItem(prev, index, direction));
  }, []);

  const updateItem = useCallback(
    (id: string, patch: Partial<Pick<ItemDraftRow, "title" | "category" | "format">>) => {
      setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [],
  );

  const allItemsReady =
    items.length > 0 && items.every((r) => r.status === "completed");

  const handleAssetBatch = useCallback(
    async (entries: BatchFileEntry[]) => {
      const id = await ensureSession().catch((e) => {
        toast.error("Could not start upload session", {
          description: inventoryUserFacingError(e),
        });
        return null;
      });
      if (!id) return;

      const rows: AssetDraftRow[] = entries.map((entry) => ({
        id: entry.id,
        file: entry.file,
        label: titleFromFileName(entry.file.name),
        objectId: null,
        status: "uploading",
        error: null,
      }));
      setAssets((prev) => [...prev, ...rows]);

      try {
        const { objects } = await registerInventoryObjects(
          id,
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
          setAssets((prev) =>
            prev.map((r) => (r.id === entry.id ? { ...r, objectId: obj.objectId } : r)),
          );
          try {
            await uploadFileToInventoryObject(obj.objectId, entry.file, obj.uploadKind);
            setAssets((prev) =>
              prev.map((r) => (r.id === entry.id ? { ...r, status: "completed" } : r)),
            );
          } catch (e) {
            setAssets((prev) =>
              prev.map((r) =>
                r.id === entry.id
                  ? { ...r, status: "error", error: inventoryUserFacingError(e) }
                  : r,
              ),
            );
          }
        }
      } catch (e) {
        toast.error("Could not register files", {
          description: inventoryUserFacingError(e),
        });
        setAssets((prev) => prev.filter((r) => !entries.some((entry) => entry.id === r.id)));
      }
    },
    [ensureSession],
  );

  const removeAsset = useCallback((id: string) => {
    setAssets((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const updateAssetLabel = useCallback((id: string, label: string) => {
    setAssets((prev) => prev.map((r) => (r.id === id ? { ...r, label } : r)));
  }, []);

  const allAssetsReady = assets.every((r) => r.status === "completed");

  const publish = useCallback(async () => {
    if (!sessionId) return;
    setPublishing(true);
    try {
      const artworkObjectIds = coverImages
        .map((img) => img.objectId)
        .filter((id): id is string => !!id);
      await saveInventoryDraft(sessionId, {
        product: {
          title: title.trim(),
          description: description.trim() || undefined,
          artworkObjectIds,
          productType,
          artIncludedInDownload: artworkObjectIds.length > 0 ? artIncludedInDownload : false,
          includedAssets: assets.map((a) => ({
            objectId: a.objectId,
            role: a.label.trim() || a.file.name,
          })),
        },
        items: items.map((r) => ({
          objectId: r.objectId,
          title: r.title.trim(),
          category: r.category.trim() || undefined,
          format: r.format.trim() || undefined,
        })),
      });
      await publishProductSession(sessionId);
      toast.success("Product published");
      navigate("/merchant/inventory");
    } catch (e) {
      toast.error("Could not publish product", {
        description: inventoryUserFacingError(e),
      });
    } finally {
      setPublishing(false);
    }
  }, [
    sessionId,
    title,
    description,
    coverImages,
    productType,
    artIncludedInDownload,
    items,
    assets,
    navigate,
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a product</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A product is one or more items sold or released together — a single
          track counts too, as a one-item product.
        </p>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={step === 1 ? "font-medium text-foreground" : undefined}>
          1. Details
        </span>
        <span>→</span>
        <span className={step === 2 ? "font-medium text-foreground" : undefined}>
          2. Items
        </span>
        <span>→</span>
        <span className={step === 3 ? "font-medium text-foreground" : undefined}>
          3. Review
        </span>
      </div>

      {step === 1 ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Product type</Label>
            <div className="flex flex-wrap gap-2">
              {PRODUCT_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setProductType(opt.value);
                    setArtIncludedInDownload(opt.defaultArtIncludedInDownload);
                    if (!opt.allowMultipleCoverImages) {
                      setCoverImages((prev) => prev.slice(0, 1));
                    }
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    productType === opt.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/40",
                  )}
                >
                  <span className="block font-medium">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {opt.description}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Customizes this onboarding flow and how the storefront presents
              the product — never part of the public record itself.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="product-title">Title</Label>
            <Input
              id="product-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Product title"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="product-description">Description</Label>
            <Textarea
              id="product-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{allowMultipleCoverImages ? "Cover images (optional)" : "Cover art (optional)"}</Label>
            {allowMultipleCoverImages || coverImages.length === 0 ? (
              <ImageDropzone onFile={handleCoverImageFile} onError={(m) => toast.error(m)} />
            ) : null}
            {coverImages.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {coverImages.map((img) => (
                  <div key={img.id} className="relative">
                    <img
                      src={img.previewUrl}
                      alt=""
                      className="h-20 w-20 rounded-md border border-border object-cover"
                    />
                    {img.uploading ? (
                      <span className="absolute inset-0 flex items-center justify-center rounded-md bg-background/70 text-[10px] text-muted-foreground">
                        Uploading…
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => removeCoverImage(img.id)}
                        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground"
                        aria-label="Remove image"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
            {coverImages.length > 0 ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={artIncludedInDownload}
                  onChange={(e) => setArtIncludedInDownload(e.target.checked)}
                />
                Include cover art in the buyer's download package
              </label>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label>Included assets (optional)</Label>
            <p className="text-xs text-muted-foreground">
              Liner notes, a poster, anything else bundled with the
              purchase but not part of the product's core items. Always
              included in the buyer's download — cover art is the only
              asset with its own toggle.
            </p>
            <BatchFileDropzone
              onBatch={(entries) => void handleAssetBatch(entries)}
              onError={(m) => toast.error(m)}
              hint="Each file is included in the download as-is."
            />
            {assets.length > 0 ? (
              <div className="space-y-2">
                {assets.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-xs text-muted-foreground">
                        {row.file.name}
                      </p>
                      <Input
                        value={row.label}
                        onChange={(e) => updateAssetLabel(row.id, e.target.value)}
                        placeholder="Label (e.g. Liner notes)"
                      />
                      {row.status === "error" ? (
                        <p className="text-xs text-destructive">{row.error}</p>
                      ) : row.status === "completed" ? (
                        <p className="text-xs text-muted-foreground">Uploaded</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Uploading…</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAsset(row.id)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex justify-end">
            <Button
              disabled={!title.trim() || !allAssetsReady || !allCoverImagesReady}
              onClick={() => setStep(2)}
            >
              Next: Add items
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <BatchFileDropzone onBatch={(entries) => void handleItemBatch(entries)} onError={(m) => toast.error(m)} />
          {items.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Order here is display order on the storefront.
              </p>
              {items.map((row, index) => (
                <div key={row.id} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1">
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
                      <p className="truncate text-xs text-muted-foreground">{row.file.name}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(row.id)}
                    >
                      Remove
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={row.title}
                      onChange={(e) => updateItem(row.id, { title: e.target.value })}
                      placeholder="Item title"
                    />
                    <Input
                      value={row.category}
                      onChange={(e) => updateItem(row.id, { category: e.target.value })}
                      placeholder="Category (optional)"
                    />
                  </div>
                  <Input
                    value={row.format}
                    onChange={(e) => updateItem(row.id, { format: e.target.value })}
                    placeholder="Format (e.g. flac, pdf, zip)"
                    className="max-w-40"
                  />
                  {row.status === "uploading" ? (
                    <Progress value={row.progress} />
                  ) : row.status === "error" ? (
                    <p className="text-xs text-destructive">{row.error}</p>
                  ) : row.status === "completed" ? (
                    <p className="text-xs text-muted-foreground">Uploaded</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button disabled={!allItemsReady} onClick={() => setStep(3)}>
              Next: Review
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-border p-4 space-y-2">
            <p className="font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">
              {productTypeConfig(productType).label}
              {coverImages.length > 0
                ? `${coverImages.length > 1 ? ` · ${coverImages.length} cover images` : " · cover art"}${
                    artIncludedInDownload ? " (included in download)" : " (not included in download)"
                  }`
                : ""}
            </p>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {items.length} item{items.length === 1 ? "" : "s"}
            </p>
            <ul className="text-sm text-muted-foreground list-disc pl-4">
              {items.map((r) => (
                <li key={r.id}>{r.title}</li>
              ))}
            </ul>
            {assets.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {assets.length} included asset{assets.length === 1 ? "" : "s"}
                </p>
                <ul className="text-sm text-muted-foreground list-disc pl-4">
                  {assets.map((a) => (
                    <li key={a.id}>{a.label || a.file.name}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)} disabled={publishing}>
              Back
            </Button>
            <Button
              onClick={() => void publish()}
              disabled={publishing || !allAssetsReady || !allCoverImagesReady}
            >
              {publishing ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
