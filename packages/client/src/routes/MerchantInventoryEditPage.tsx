import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Pencil, Tag } from "lucide-react";
import { AtUri } from "@atproto/syntax";
import { Link, useSearchParams } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { CategoryField } from "@/components/merchant/CategoryField";
import {
  DetailToolbar,
  type ToolAction,
} from "@/components/merchant/detailTools";
import { MarkdownBody } from "@/components/shared/MarkdownBody";
import { MetadataChip } from "@/components/shared/MetadataChip";
import { TagTokens } from "@/components/shared/TagTokens";
import { Input } from "@/components/ui/input";
import { TagsInput } from "@/components/shared/TagsInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import {
  buildItemRefFromUri,
  getCatalogItem,
  getRecordValue,
  getRecordValueWithCid,
  isTerminalListingStatus,
  listCatalogProductRows,
  listListingRows,
  putCatalogItem,
  putListing,
  getCatalogItemDownloadUrl,
  syncCatalogItem,
  type CatalogItemRow,
} from "@/lib/atproto/records";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import type { ATPRepoClient } from "@/lib/atproto/session";
import { formatMoney } from "@/lib/format";
import { formatRuntime } from "@/lib/itemMetaLabel";
import { cn, formatBytes } from "@/lib/utils";
import type {
  CatalogItem,
  LicenseTerms,
  Listing,
} from "@/types/lexicons";
import { toast } from "sonner";

export function MerchantInventoryEditPage() {
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

/**
 * catalog.item is ERP-first (getCatalogItem), not PDS-direct -- consistent
 * with "ERP-first everywhere." Only title/category/description are editable;
 * fileCid/fileChecksum/format/merchantDid are preserved as-authored (see
 * putCatalogItem).
 */
function CatalogItemEditForm({
  uri,
  agent,
}: {
  uri: string;
  agent: ATPRepoClient;
}) {
  const [searchParams] = useSearchParams();
  /** `?from=<productAtUri>` set on links from the product page -- return there instead of the inventory list. */
  const from = useMemo(() => {
    const raw = searchParams.get("from");
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [searchParams]);
  const cameFromProduct =
    !!from && from.includes("/diamonds.whereditgo.bazaar.catalog.product/");
  const backHref = cameFromProduct
    ? `/merchant/inventory/products?uri=${encodeURIComponent(from)}`
    : "/merchant/inventory";
  const backLabel = cameFromProduct ? "Back to product" : "Back to inventory";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [row, setRow] = useState<CatalogItemRow | null>(null);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  /** This item's own non-terminal listing (standalone or sold-under-product), if any. */
  const [listing, setListing] = useState<Listing | null>(null);
  const [listingUri, setListingUri] = useState<string | null>(null);
  const [parentProductUri, setParentProductUri] = useState<string | null>(null);
  const [parentProductTitle, setParentProductTitle] = useState<string | null>(
    null,
  );
  const [license, setLicense] = useState<LicenseTerms | null>(null);
  const [licenseCid, setLicenseCid] = useState<string | null>(null);
  /** True when the license shown is inherited from the parent product's listing. */
  const [licenseInherited, setLicenseInherited] = useState(false);

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
    setTags(r.tags ?? []);

    const [listings, productRows] = await Promise.all([
      listListingRows(r.merchantDid).catch(() => []),
      listCatalogProductRows().catch(() => []),
    ]);

    const parentProduct = productRows.find((p) =>
      p.items.some((ref) => ref.uri === uri),
    );
    setParentProductUri(parentProduct?.uri ?? null);
    setParentProductTitle(parentProduct?.title ?? null);

    const own = listings.find(
      (l) =>
        l.listing.item.uri === uri &&
        !isTerminalListingStatus(l.listing.status),
    );
    setListing(own?.listing ?? null);
    setListingUri(own?.uri ?? null);

    const parentListing = parentProduct
      ? listings.find(
          (l) =>
            l.listing.item.uri === parentProduct.uri &&
            !l.listing.parentListing &&
            !isTerminalListingStatus(l.listing.status),
        )
      : undefined;

    // Defer to the item's own license; otherwise inherit the parent product
    // listing's license (an item with no listing of its own still sells under
    // the product, under the product's terms).
    const licUri =
      own?.listing.licenseGrant?.uri ?? parentListing?.listing.licenseGrant?.uri;
    const inherited = !own && !!parentListing?.listing.licenseGrant?.uri;
    if (licUri) {
      const lt = await getRecordValueWithCid<LicenseTerms>(licUri).catch(
        () => null,
      );
      setLicense(lt?.value ?? null);
      setLicenseCid(lt?.cid ?? null);
      setLicenseInherited(inherited);
    } else {
      setLicense(null);
      setLicenseCid(null);
      setLicenseInherited(false);
    }

    setLoading(false);
  }, [uri]);

  useEffect(() => {
    void load();
  }, [load]);

  const paramsChanged = useCallback((): boolean => {
    if (!row) return false;
    return (
      title.trim() !== row.title ||
      (category.trim() || "") !== (row.category ?? "") ||
      (description.trim() || "") !== (row.description ?? "") ||
      JSON.stringify(tags) !== JSON.stringify(row.tags ?? [])
    );
  }, [row, title, category, description, tags]);

  /**
   * Save the item record. A metadata change re-pins the listing's `item.cid`
   * in place (same URI) so checkout doesn't reject it as "item_changed" --
   * price and terms are edited from the listing tool, not here.
   */
  async function doSave() {
    if (!row) return;
    setSaving(true);
    try {
      const repin = paramsChanged();
      await putCatalogItem(agent, uri, {
        title: title.trim(),
        category: category.trim() || undefined,
        description: description.trim() || undefined,
        tags: tags.length ? tags : undefined,
      });

      if (repin && listing && listingUri) {
        const freshRef = await buildItemRefFromUri(uri);
        await putListing(agent, listingUri, {
          ...listing,
          item: freshRef ?? listing.item,
        });
      }

      await syncCatalogItem(uri);
      toast.success("Saved");
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

  async function onSave() {
    if (!row) return;
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    await doSave();
  }

  function cancelEditing() {
    if (row) {
      setTitle(row.title);
      setCategory(row.category ?? "");
      setDescription(row.description ?? "");
      setTags(row.tags ?? []);
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
    return <p className="text-sm text-muted-foreground">Loading item…</p>;
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

  const coverUrl = row.coverImages[0]?.url;
  const runtimeLabel = row.durationMs ? formatRuntime(row.durationMs) : null;
  const sizeLabel = row.byteSize ? formatBytes(row.byteSize) : null;
  const dimsLabel =
    row.mediaWidth && row.mediaHeight
      ? `${row.mediaWidth} × ${row.mediaHeight}`
      : null;

  const toolActions: ToolAction[] = [
    ...(!editing
      ? [
          {
            key: "edit",
            Icon: Pencil,
            label: "Edit item",
            onClick: () => setEditing(true),
          },
        ]
      : []),
    {
      key: "download",
      Icon: Download,
      label: downloading ? "Preparing…" : "Download file",
      onClick: () => void onDownload(),
      disabled: downloading,
      disabledHint: "Preparing…",
    },
    ...(!editing
      ? [
          {
            key: "list",
            Icon: Tag,
            label: listing ? "Edit listing" : "Create listing",
            href: `/merchant/listings/new?uri=${encodeURIComponent(uri)}`,
          },
        ]
      : []),
  ];

  return (
    <div className="w-full min-w-0 max-w-5xl space-y-8">
      <div className="flex items-center justify-between gap-4">
        <Link
          to={backHref}
          className="inline-flex items-center gap-1.5 pt-4 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {backLabel}
        </Link>
        {editing ? (
          <div className="flex items-center gap-2">
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
        ) : null}
      </div>

      {/* Hero — mirrors the storefront single-item layout */}
      <section className="grid gap-8 lg:grid-cols-[1fr_minmax(0,24rem)] lg:items-start">
        <div className="space-y-3">
          <div className="aspect-square max-h-[min(70vw,28rem)] overflow-hidden rounded-xl border border-border bg-muted">
            {coverUrl ? (
              <img src={coverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                No cover art
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            {editing ? (
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="ci-title">Title</Label>
                <Input
                  id="ci-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={512}
                />
              </div>
            ) : (
              <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
            )}
            <DetailToolbar actions={toolActions} panelTitle="Item controls" />
          </div>

          {listing ? (
            <p className="text-2xl font-medium">{formatMoney(listing.price)}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {parentProductTitle ? "Not sold separately" : "Not listed"}
            </p>
          )}

          {editing ? (
            <div className="space-y-1.5">
              <Label htmlFor="ci-tags">Tags</Label>
              <TagsInput
                id="ci-tags"
                tags={tags}
                onChange={setTags}
                placeholder="e.g. lofi, drum loop, 90bpm"
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
        {editing ? (
          <div className="w-full space-y-1.5">
            <Label htmlFor="ci-category">Category</Label>
            <CategoryField
              id="ci-category"
              value={category}
              onChange={setCategory}
            />
          </div>
        ) : (
          <>
            {row.category ? <MetadataChip>{row.category}</MetadataChip> : null}
            {runtimeLabel ? <MetadataChip>{runtimeLabel}</MetadataChip> : null}
            {dimsLabel ? <MetadataChip>{dimsLabel}</MetadataChip> : null}
            {sizeLabel ? <MetadataChip>{sizeLabel}</MetadataChip> : null}
            {row.format ? <MetadataChip>{row.format}</MetadataChip> : null}
            {tags.length ? <TagTokens tags={tags} part="plain" /> : null}
            {parentProductTitle && parentProductUri ? (
              <Link
                to={`/merchant/inventory/products?uri=${encodeURIComponent(parentProductUri)}`}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                In {parentProductTitle}
              </Link>
            ) : null}
          </>
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

      {/* License — the item's own terms, or inherited from the product listing */}
      {license ? (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">License</h2>
          {licenseInherited ? (
            <p className="text-xs text-muted-foreground">
              Inherited from {parentProductTitle ?? "the product"} listing
            </p>
          ) : null}
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
    </div>
  );
}
