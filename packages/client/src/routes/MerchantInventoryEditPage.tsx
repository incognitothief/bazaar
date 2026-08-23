import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { AtUri } from "@atproto/syntax";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
  getCatalogItem,
  getRecordValue,
  listListingRows,
  putCatalogItem,
  putCollection,
  putDigitalItem,
  putListing,
  putPhysicalItem,
  getCatalogItemDownloadUrl,
  syncCatalogItem,
  type CatalogItemRow,
  type ListingRow,
} from "@/lib/atproto/records";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import type { ATPRepoClient } from "@/lib/atproto/session";
import { uploadBlob } from "@/lib/atproto/upload";
import { cn } from "@/lib/utils";
import type {
  CatalogItem,
  Collection,
  CollectionItemEntry,
  CollectionItemRole,
  DigitalItem,
  PhysicalItem,
  Variant,
} from "@/types/lexicons";
import { toast } from "sonner";

const COLLECTION_ROLES: CollectionItemRole[] = [
  "track",
  "video",
  "document",
  "artwork",
  "bonus",
  "other",
];

const COLLECTION_TYPES: NonNullable<Collection["collectionType"]>[] = [
  "album",
  "ep",
  "single",
  "compilation",
  "other",
];

function isoToDatetimeLocal(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(local: string): string | undefined {
  if (!local.trim()) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function emptyCollectionRow(): CollectionItemEntry {
  return { uri: "", role: "track" };
}

export function MerchantInventoryEditPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const uriParam = searchParams.get("uri")?.trim() ?? "";
  const itemUri = useMemo(() => {
    try {
      return decodeURIComponent(uriParam);
    } catch {
      return uriParam;
    }
  }, [uriParam]);

  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);

  const isCatalogItemUri = useMemo(() => {
    if (!itemUri) return false;
    try {
      return new AtUri(itemUri).collection === BAZAAR_COLLECTION.item;
    } catch {
      return false;
    }
  }, [itemUri]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [record, setRecord] = useState<CatalogItem | null>(null);

  const load = useCallback(async () => {
    if (!agent || !itemUri) return;
    // catalog.item is ERP-first (see CatalogItemEditForm below), not PDS-direct.
    if (isCatalogItemUri) return;
    setLoading(true);
    setLoadError(null);
    try {
      const v = await getRecordValue<CatalogItem>(itemUri);
      if (!v || typeof v !== "object" || !("$type" in v)) {
        setRecord(null);
        setLoadError("Could not load this record.");
        return;
      }
      setRecord(v);
    } catch (e) {
      setRecord(null);
      setLoadError(
        e instanceof Error ? e.message : "Could not load this record.",
      );
    } finally {
      setLoading(false);
    }
  }, [agent, itemUri, isCatalogItemUri]);

  useEffect(() => {
    void load();
  }, [load]);

  const [saving, setSaving] = useState(false);

  if (!session || !agent) return null;

  if (!itemUri) {
    return (
      <div className="w-full min-w-0 space-y-4">
        <p className="text-sm text-destructive">Missing ?uri= (AT-URI).</p>
        <Link to="/merchant/inventory" className={cn(buttonVariants())}>
          Back to inventory
        </Link>
      </div>
    );
  }

  if (isCatalogItemUri) {
    return <CatalogItemEditForm uri={itemUri} agent={agent} />;
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Loading catalog record…</p>
    );
  }

  if (loadError || !record) {
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

  const type = record.$type;

  if (type === "diamonds.whereditgo.bazaar.catalog.item.digital") {
    return (
      <DigitalEditForm
        uri={itemUri}
        initial={record}
        agent={agent}
        saving={saving}
        setSaving={setSaving}
        onSaved={() => navigate("/merchant/inventory")}
        onReload={load}
      />
    );
  }

  if (type === "diamonds.whereditgo.bazaar.catalog.collection") {
    return (
      <CollectionEditForm
        uri={itemUri}
        initial={record}
        agent={agent}
        saving={saving}
        setSaving={setSaving}
        onSaved={() => navigate("/merchant/inventory")}
        onReload={load}
      />
    );
  }

  if (type === "diamonds.whereditgo.bazaar.catalog.item.physical") {
    return (
      <PhysicalEditForm
        uri={itemUri}
        initial={record}
        agent={agent}
        saving={saving}
        setSaving={setSaving}
        onSaved={() => navigate("/merchant/inventory")}
        onReload={load}
      />
    );
  }

  return (
    <div className="w-full min-w-0 space-y-4">
      <p className="text-sm text-muted-foreground">
        Editing this record type is not supported here.
      </p>
      <Link to="/merchant/inventory" className={cn(buttonVariants())}>
        Back to inventory
      </Link>
    </div>
  );
}

function DigitalEditForm({
  uri,
  initial,
  agent,
  saving,
  setSaving,
  onSaved,
  onReload,
}: {
  uri: string;
  initial: DigitalItem;
  agent: ATPRepoClient;
  saving: boolean;
  setSaving: (v: boolean) => void;
  onSaved: () => void;
  onReload: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [releaseLocal, setReleaseLocal] = useState(
    isoToDatetimeLocal(initial.releaseDate),
  );
  const [genreLine, setGenreLine] = useState(
    (initial.genre ?? []).join(", "),
  );
  const [artworkCid, setArtworkCid] = useState(initial.artworkCid ?? "");
  const [isrc, setIsrc] = useState(initial.isrc ?? "");
  const [defaultLicenseUri, setDefaultLicenseUri] = useState(
    initial.defaultLicenseUri ?? "",
  );
  const [collectionUri, setCollectionUri] = useState(
    initial.collectionUri ?? "",
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const genre = genreLine
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);
      const releaseDate = datetimeLocalToIso(releaseLocal);
      const draft: DigitalItem = {
        ...initial,
        title: title.trim(),
        description: description.trim() || undefined,
        releaseDate,
        artworkCid: artworkCid.trim() || undefined,
        genre: genre.length ? genre : undefined,
        isrc: isrc.trim() || undefined,
        defaultLicenseUri: defaultLicenseUri.trim() || undefined,
        collectionUri: collectionUri.trim() || undefined,
      };
      await putDigitalItem(agent, uri, draft);
      toast.success("Saved");
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save changes.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full min-w-0 max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Edit digital item</h1>
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

      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm space-y-1">
        <p>
          <span className="text-muted-foreground">Item class</span>{" "}
          <span className="font-medium">{initial.itemClass}</span> (read-only)
        </p>
        <p className="text-muted-foreground text-xs">
          File identity (formats, checksum, CID, etc.) is immutable — upload a
          new file via a replace flow to change the asset.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="dig-title">Title</Label>
        <Input
          id="dig-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={512}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dig-desc">Description</Label>
        <Textarea
          id="dig-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          maxLength={4096}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dig-rel">Release date</Label>
        <Input
          id="dig-rel"
          type="datetime-local"
          value={releaseLocal}
          onChange={(e) => setReleaseLocal(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dig-genre">Genres (comma-separated)</Label>
        <Input
          id="dig-genre"
          value={genreLine}
          onChange={(e) => setGenreLine(e.target.value)}
          placeholder="electronic, ambient"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dig-art">Artwork CID</Label>
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            id="dig-art"
            value={artworkCid}
            onChange={(e) => setArtworkCid(e.target.value)}
            placeholder="bafy…"
            className="flex-1 min-w-[12rem]"
          />
          <label className="cursor-pointer">
            <span
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "inline-flex",
              )}
            >
              Upload image
            </span>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={async (ev) => {
                const f = ev.target.files?.[0];
                if (!f) return;
                try {
                  const cid = await uploadBlob(agent, f);
                  setArtworkCid(cid);
                  toast.success("Artwork uploaded");
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Upload failed",
                  );
                }
                ev.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="dig-isrc">ISRC</Label>
        <Input
          id="dig-isrc"
          value={isrc}
          onChange={(e) => setIsrc(e.target.value)}
          maxLength={16}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dig-lic">Default license AT-URI</Label>
        <Input
          id="dig-lic"
          value={defaultLicenseUri}
          onChange={(e) => setDefaultLicenseUri(e.target.value)}
          placeholder="at://…"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dig-col">Collection AT-URI</Label>
        <Input
          id="dig-col"
          value={collectionUri}
          onChange={(e) => setCollectionUri(e.target.value)}
          placeholder="at://…"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          className={cn(buttonVariants())}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline" }))}
          onClick={() => void onReload()}
        >
          Reload
        </button>
      </div>
    </form>
  );
}

function CollectionEditForm({
  uri,
  initial,
  agent,
  saving,
  setSaving,
  onSaved,
  onReload,
}: {
  uri: string;
  initial: Collection;
  agent: ATPRepoClient;
  saving: boolean;
  setSaving: (v: boolean) => void;
  onSaved: () => void;
  onReload: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [collectionType, setCollectionType] = useState<string>(
    initial.collectionType ?? "",
  );
  const [releaseLocal, setReleaseLocal] = useState(
    isoToDatetimeLocal(initial.releaseDate),
  );
  const [genreLine, setGenreLine] = useState(
    (initial.genre ?? []).join(", "),
  );
  const [artworkCid, setArtworkCid] = useState(initial.artworkCid ?? "");
  const [defaultLicenseUri, setDefaultLicenseUri] = useState(
    initial.defaultLicenseUri ?? "",
  );
  const [upc, setUpc] = useState(initial.upc ?? "");
  const [itemRows, setItemRows] = useState<CollectionItemEntry[]>(() =>
    initial.items.length ? [...initial.items] : [emptyCollectionRow()],
  );

  function updateRow(
    index: number,
    patch: Partial<CollectionItemEntry>,
  ): void {
    setItemRows((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned: CollectionItemEntry[] = itemRows
      .map((r) => ({
        uri: r.uri.trim(),
        role: r.role,
        cid: r.cid?.trim() || undefined,
        trackNumber:
          r.trackNumber !== undefined && r.trackNumber !== null
            ? Number(r.trackNumber)
            : undefined,
        discNumber:
          r.discNumber !== undefined && r.discNumber !== null
            ? Number(r.discNumber)
            : undefined,
        title: r.title?.trim() || undefined,
      }))
      .filter((r) => r.uri.length > 0);

    if (cleaned.length < 1) {
      toast.error("Add at least one item with an AT-URI.");
      return;
    }

    for (const r of cleaned) {
      if (!r.uri.startsWith("at://")) {
        toast.error("Each item URI must be an at:// URI.");
        return;
      }
    }

    setSaving(true);
    try {
      const genre = genreLine
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);
      const releaseDate = datetimeLocalToIso(releaseLocal);
      if (!releaseDate) {
        toast.error("Release date is required.");
        setSaving(false);
        return;
      }
      const draft: Collection = {
        ...initial,
        title: title.trim(),
        description: description.trim() || undefined,
        collectionType:
          collectionType === ""
            ? undefined
            : (collectionType as NonNullable<Collection["collectionType"]>),
        releaseDate,
        items: cleaned,
        artworkCid: artworkCid.trim() || undefined,
        genre: genre.length ? genre : undefined,
        defaultLicenseUri: defaultLicenseUri.trim() || undefined,
        upc: upc.trim() || undefined,
      };
      await putCollection(agent, uri, draft);
      toast.success("Saved");
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save changes.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full min-w-0 max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Edit collection</h1>
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="col-title">Title</Label>
          <Input
            id="col-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={512}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="col-desc">Description</Label>
          <Textarea
            id="col-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={4096}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="col-type">Collection type</Label>
          <select
            id="col-type"
            className={cn(
              "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm",
            )}
            value={collectionType}
            onChange={(e) => setCollectionType(e.target.value)}
          >
            <option value="">—</option>
            {COLLECTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="col-rel">Release date</Label>
          <Input
            id="col-rel"
            type="datetime-local"
            value={releaseLocal}
            onChange={(e) => setReleaseLocal(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="col-genre">Genres (comma-separated)</Label>
          <Input
            id="col-genre"
            value={genreLine}
            onChange={(e) => setGenreLine(e.target.value)}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="col-art">Artwork CID</Label>
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              id="col-art"
              value={artworkCid}
              onChange={(e) => setArtworkCid(e.target.value)}
              className="flex-1 min-w-[12rem]"
            />
            <label className="cursor-pointer">
              <span
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" }),
                  "inline-flex",
                )}
              >
                Upload image
              </span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={async (ev) => {
                  const f = ev.target.files?.[0];
                  if (!f) return;
                  try {
                    const cid = await uploadBlob(agent, f);
                    setArtworkCid(cid);
                    toast.success("Artwork uploaded");
                  } catch (err) {
                    toast.error(
                      err instanceof Error ? err.message : "Upload failed",
                    );
                  }
                  ev.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="col-lic">Default license AT-URI</Label>
          <Input
            id="col-lic"
            value={defaultLicenseUri}
            onChange={(e) => setDefaultLicenseUri(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="col-upc">UPC</Label>
          <Input
            id="col-upc"
            value={upc}
            onChange={(e) => setUpc(e.target.value)}
            maxLength={20}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-base">Items</Label>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            onClick={() =>
              setItemRows((rows) => [...rows, emptyCollectionRow()])
            }
          >
            Add row
          </button>
        </div>
        <div className="space-y-4 rounded-lg border border-border p-4">
          {itemRows.map((row, i) => (
            <div
              key={i}
              className="grid gap-2 border-b border-border pb-4 last:border-0 last:pb-0 sm:grid-cols-12"
            >
              <div className="sm:col-span-5 space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Item AT-URI
                </Label>
                <Input
                  value={row.uri}
                  onChange={(e) => updateRow(i, { uri: e.target.value })}
                  placeholder="at://…"
                />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">Role</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                  value={row.role}
                  onChange={(e) =>
                    updateRow(i, {
                      role: e.target.value as CollectionItemRole,
                    })
                  }
                >
                  {COLLECTION_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">Track #</Label>
                <Input
                  type="number"
                  value={row.trackNumber ?? ""}
                  onChange={(e) =>
                    updateRow(i, {
                      trackNumber: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    })
                  }
                />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">Disc #</Label>
                <Input
                  type="number"
                  value={row.discNumber ?? ""}
                  onChange={(e) =>
                    updateRow(i, {
                      discNumber: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    })
                  }
                />
              </div>
              <div className="sm:col-span-12 space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Title override (optional)
                </Label>
                <Input
                  value={row.title ?? ""}
                  onChange={(e) =>
                    updateRow(i, { title: e.target.value || undefined })
                  }
                />
              </div>
              <div className="sm:col-span-10 space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Item CID (optional)
                </Label>
                <Input
                  value={row.cid ?? ""}
                  onChange={(e) =>
                    updateRow(i, { cid: e.target.value || undefined })
                  }
                />
              </div>
              <div className="sm:col-span-2 flex items-end justify-end">
                <button
                  type="button"
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "text-destructive",
                  )}
                  onClick={() =>
                    setItemRows((rows) =>
                      rows.filter((_, j) => j !== i),
                    )
                  }
                  disabled={itemRows.length <= 1}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          className={cn(buttonVariants())}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline" }))}
          onClick={() => void onReload()}
        >
          Reload
        </button>
      </div>
    </form>
  );
}

function PhysicalEditForm({
  uri,
  initial,
  agent,
  saving,
  setSaving,
  onSaved,
  onReload,
}: {
  uri: string;
  initial: PhysicalItem;
  agent: ATPRepoClient;
  saving: boolean;
  setSaving: (v: boolean) => void;
  onSaved: () => void;
  onReload: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [artworkCid, setArtworkCid] = useState(initial.artworkCid ?? "");
  const [countryOfOrigin, setCountryOfOrigin] = useState(
    initial.countryOfOrigin ?? "",
  );
  const [harmonizedCode, setHarmonizedCode] = useState(
    initial.harmonizedCode ?? "",
  );
  const [requiresShipping, setRequiresShipping] = useState(
    initial.requiresShipping !== false,
  );
  const [variantRows, setVariantRows] = useState<
    { sku: string; attrsJson: string; base?: Variant }[]
  >(() =>
    initial.variants.length > 0
      ? initial.variants.map((v) => ({
          sku: v.sku,
          attrsJson: v.attributes
            ? JSON.stringify(v.attributes, null, 0)
            : "",
          base: v,
        }))
      : [{ sku: "", attrsJson: "" }],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const variants: Variant[] = [];
    for (const row of variantRows) {
      const sku = row.sku.trim();
      if (!sku) {
        toast.error("Each variant needs a SKU.");
        return;
      }
      let attributes: Record<string, string> | undefined;
      if (row.attrsJson.trim()) {
        try {
          const parsed = JSON.parse(row.attrsJson) as unknown;
          if (
            parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
          ) {
            attributes = Object.fromEntries(
              Object.entries(parsed as Record<string, unknown>).map(
                ([k, val]) => [k, String(val)],
              ),
            );
          } else {
            toast.error("Variant attributes must be a JSON object.");
            return;
          }
        } catch {
          toast.error("Invalid JSON in variant attributes.");
          return;
        }
      }
      const base = row.base;
      const next: Variant = {
        ...(base ?? { sku }),
        sku,
      };
      if (attributes && Object.keys(attributes).length > 0) {
        next.attributes = attributes;
      } else {
        delete next.attributes;
      }
      variants.push(next);
    }
    if (variants.length < 1) {
      toast.error("At least one variant is required.");
      return;
    }

    setSaving(true);
    try {
      const draft: PhysicalItem = {
        ...initial,
        title: title.trim(),
        description: description.trim() || undefined,
        artworkCid: artworkCid.trim() || undefined,
        countryOfOrigin: countryOfOrigin.trim().slice(0, 2) || undefined,
        harmonizedCode: harmonizedCode.trim() || undefined,
        requiresShipping,
        variants,
      };
      await putPhysicalItem(agent, uri, draft);
      toast.success("Saved");
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save changes.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full min-w-0 max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Edit physical item</h1>
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

      <p className="text-sm text-muted-foreground rounded-lg border border-border bg-muted/30 px-3 py-2">
        Item class <span className="font-medium">{initial.itemClass}</span> is
        read-only. Changing SKUs may affect listings and fulfillment.
      </p>

      <div className="space-y-2">
        <Label htmlFor="ph-title">Title</Label>
        <Input
          id="ph-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ph-desc">Description</Label>
        <Textarea
          id="ph-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ph-art">Artwork CID</Label>
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            id="ph-art"
            value={artworkCid}
            onChange={(e) => setArtworkCid(e.target.value)}
            className="flex-1 min-w-[12rem]"
          />
          <label className="cursor-pointer">
            <span
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "inline-flex",
              )}
            >
              Upload image
            </span>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={async (ev) => {
                const f = ev.target.files?.[0];
                if (!f) return;
                try {
                  const cid = await uploadBlob(agent, f);
                  setArtworkCid(cid);
                  toast.success("Artwork uploaded");
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Upload failed",
                  );
                }
                ev.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ph-co">Country of origin (ISO-3166-1 alpha-2)</Label>
          <Input
            id="ph-co"
            value={countryOfOrigin}
            onChange={(e) =>
              setCountryOfOrigin(e.target.value.toUpperCase().slice(0, 2))
            }
            maxLength={2}
            placeholder="US"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ph-hs">Harmonized code</Label>
          <Input
            id="ph-hs"
            value={harmonizedCode}
            onChange={(e) => setHarmonizedCode(e.target.value)}
            maxLength={16}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="ph-ship"
          checked={requiresShipping}
          onChange={(e) => setRequiresShipping(e.target.checked)}
        />
        <Label htmlFor="ph-ship">Requires shipping</Label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-base">Variants</Label>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            onClick={() =>
              setVariantRows((rows) => [...rows, { sku: "", attrsJson: "" }])
            }
          >
            Add variant
          </button>
        </div>
        {variantRows.map((row, i) => (
          <div
            key={i}
            className="rounded-lg border border-border p-3 space-y-2"
          >
            <div className="flex gap-2 items-end">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">SKU</Label>
                <Input
                  value={row.sku}
                  onChange={(e) =>
                    setVariantRows((rows) =>
                      rows.map((r, j) =>
                        j === i ? { ...r, sku: e.target.value } : r,
                      ),
                    )
                  }
                  required
                />
              </div>
              <button
                type="button"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "text-destructive shrink-0",
                )}
                onClick={() =>
                  setVariantRows((rows) => rows.filter((_, j) => j !== i))
                }
                disabled={variantRows.length <= 1}
              >
                Remove
              </button>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Attributes (JSON object, optional)
              </Label>
              <Textarea
                value={row.attrsJson}
                onChange={(e) =>
                  setVariantRows((rows) =>
                    rows.map((r, j) =>
                      j === i ? { ...r, attrsJson: e.target.value } : r,
                    ),
                  )
                }
                rows={2}
                placeholder='{"size":"L","color":"black"}'
                className="font-mono text-xs"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          className={cn(buttonVariants())}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline" }))}
          onClick={() => void onReload()}
        >
          Reload
        </button>
      </div>
    </form>
  );
}

/**
 * catalog.item is ERP-first (getCatalogItem), not PDS-direct like the
 * three legacy forms above -- consistent with "ERP-first everywhere."
 * Only title/category/description are editable; fileCid/fileChecksum/
 * format/sellerDid are preserved as-authored (see putCatalogItem).
 */
function CatalogItemEditForm({
  uri,
  agent,
}: {
  uri: string;
  agent: ATPRepoClient;
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [row, setRow] = useState<CatalogItemRow | null>(null);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [staleListings, setStaleListings] = useState<ListingRow[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const r = await getCatalogItem(uri);
    if (!r) {
      setRow(null);
      setLoadError("Could not load this item.");
      setLoading(false);
      return;
    }
    setRow(r);
    setTitle(r.title);
    setCategory(r.category ?? "");
    setDescription(r.description ?? "");
    setLoading(false);
  }, [uri]);

  useEffect(() => {
    void load();
  }, [load]);

  async function doSave(archiveTargets: ListingRow[]) {
    if (!row) return;
    setSaving(true);
    try {
      await putCatalogItem(agent, uri, {
        title: title.trim(),
        category: category.trim() || undefined,
        description: description.trim() || undefined,
      });
      for (const listing of archiveTargets) {
        await putListing(agent, listing.uri, {
          ...listing.listing,
          status: "archived",
        });
      }
      await syncCatalogItem(uri);
      if (archiveTargets.length > 0) {
        toast.success("Saved — the old listing has been de-listed", {
          description: "Create a new listing to sell this item again.",
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
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save changes.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    const listings = await listListingRows(row.sellerDid).catch(() => []);
    const stale = findStaleListingsForItem(listings, row.uri, row.cid);
    if (stale.length > 0) {
      setStaleListings(stale);
      return;
    }
    await doSave([]);
  }

  function cancelEditing() {
    if (row) {
      setTitle(row.title);
      setCategory(row.category ?? "");
      setDescription(row.description ?? "");
    }
    setEditing(false);
  }

  /** Incident-response tool: get this file directly, not the buyer-facing download path. */
  async function onDownload() {
    setDownloading(true);
    try {
      const result = await getCatalogItemDownloadUrl(uri);
      if (!result) {
        toast.error("Could not get a download link for this item.");
        return;
      }
      window.location.href = result.url;
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Loading item…</p>
    );
  }

  if (loadError || !row) {
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
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="w-full min-w-0 max-w-2xl space-y-6"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          {editing ? "Edit item" : "Item"}
        </h1>
        {!editing ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Edit item"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-4" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={downloading}
          onClick={() => void onDownload()}
          title="Get this file directly -- for support/incident handoff, not the buyer-facing download"
        >
          {downloading ? "Preparing…" : "Download"}
        </Button>
        {!editing ? (
          <Link
            to={`/merchant/listings/new?prefillItemUri=${encodeURIComponent(uri)}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Create listing
          </Link>
        ) : null}
        <Link
          to="/merchant/inventory"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "ml-auto",
          )}
        >
          Back to inventory
        </Link>
      </div>

      {editing ? (
        <>
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm space-y-1">
            <p className="text-muted-foreground text-xs">
              File identity (format, checksum, CID) is immutable — upload a new
              file via a replace flow to change the asset.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ci-title">Title</Label>
            <Input
              id="ci-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={512}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ci-category">Category</Label>
            <Input
              id="ci-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Freeform, e.g. track, ebook, sample pack"
              maxLength={64}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ci-desc">Description</Label>
            <Textarea
              id="ci-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={4096}
            />
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" className={cn(buttonVariants())} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={cn(buttonVariants({ variant: "ghost" }))}
              onClick={cancelEditing}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">{row.title}</h2>
            {row.description ? (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {row.description}
              </p>
            ) : null}
          </div>
          <p className="text-sm">
            <span className="text-muted-foreground">Category: </span>
            {row.category || "—"}
          </p>
        </div>
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
              Saving changes this item's content, which invalidates the CID
              that {staleListings?.length === 1 ? "this listing" : "these listings"}{" "}
              pinned when created. To protect buyers from checking out
              against terms they never saw,{" "}
              {staleListings?.length === 1 ? "it" : "they"} will be
              permanently de-listed and can't be reactivated — create a new
              listing afterward if you want to sell this item again.
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
    </form>
  );
}
