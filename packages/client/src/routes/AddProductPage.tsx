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
import { cn } from "@/lib/utils";

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
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [artworkPreview, setArtworkPreview] = useState<string | null>(null);
  const [artworkObjectId, setArtworkObjectId] = useState<string | null>(null);
  const [artworkUploading, setArtworkUploading] = useState(false);

  const [items, setItems] = useState<ItemDraftRow[]>([]);
  const [publishing, setPublishing] = useState(false);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId;
    const { sessionId: id } = await createInventorySession("product");
    setSessionId(id);
    return id;
  }, [sessionId]);

  const handleArtworkFile = useCallback(
    async (file: File, previewUrl: string) => {
      setArtworkFile(file);
      setArtworkPreview(previewUrl);
      setArtworkUploading(true);
      try {
        const id = await ensureSession();
        const { objects } = await registerInventoryObjects(id, [
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
        setArtworkObjectId(obj.objectId);
      } catch (e) {
        toast.error("Could not upload cover art", {
          description: inventoryUserFacingError(e),
        });
        setArtworkFile(null);
        setArtworkPreview(null);
      } finally {
        setArtworkUploading(false);
      }
    },
    [ensureSession],
  );

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

  const updateItem = useCallback(
    (id: string, patch: Partial<Pick<ItemDraftRow, "title" | "category" | "format">>) => {
      setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [],
  );

  const allItemsReady =
    items.length > 0 && items.every((r) => r.status === "completed");

  const publish = useCallback(async () => {
    if (!sessionId) return;
    setPublishing(true);
    try {
      await saveInventoryDraft(sessionId, {
        product: {
          title: title.trim(),
          description: description.trim() || undefined,
          artworkObjectId: artworkObjectId ?? undefined,
          productType,
          artIncludedInDownload: artworkObjectId ? artIncludedInDownload : false,
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
    artworkObjectId,
    productType,
    artIncludedInDownload,
    items,
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
            <Label>Cover art (optional)</Label>
            <ImageDropzone onFile={handleArtworkFile} onError={(m) => toast.error(m)} />
            {artworkFile && artworkPreview ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {artworkUploading ? "Uploading…" : `${artworkFile.name} uploaded`}
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={artIncludedInDownload}
                    onChange={(e) => setArtIncludedInDownload(e.target.checked)}
                  />
                  Include cover art in the buyer's download package
                </label>
              </>
            ) : null}
          </div>
          <div className="flex justify-end">
            <Button disabled={!title.trim()} onClick={() => setStep(2)}>
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
              {items.map((row) => (
                <div key={row.id} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-xs text-muted-foreground">{row.file.name}</p>
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
              {artworkFile
                ? artIncludedInDownload
                  ? " · cover art included in download"
                  : " · cover art not included in download"
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
          </div>
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)} disabled={publishing}>
              Back
            </Button>
            <Button onClick={() => void publish()} disabled={publishing}>
              {publishing ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
