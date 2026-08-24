import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AtUri } from "@atproto/syntax";
import { toast } from "sonner";

import { ArtworkImage } from "@/components/public/ArtworkImage";
import { CollectionMemberDownloads } from "@/components/public/TrackList";
import { FormatBadge } from "@/components/shared/FormatBadge";
import { MarkdownBody } from "@/components/shared/MarkdownBody";
import { MetadataChip } from "@/components/shared/MetadataChip";
import { Button } from "@/components/ui/button";
import { useAtpSession } from "@/hooks/useAtpSession";
import { createBrowserApiURL } from "@/lib/browserApi";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import { pdslsRecordUrl } from "@/lib/pdsls";
import {
  getCatalogItem,
  getCatalogProduct,
  getRecordValue,
  listPurchaseConsentRows,
} from "@/lib/atproto/records";
import { createPublicAgent } from "@/lib/atproto/session";
import { agentForRepo } from "@/lib/atproto/pdsResolve";
import { productTypeConfig } from "@/lib/productTypes";
import {
  catalogItemArtworkCid,
  catalogItemSellerDid,
  type CatalogItem,
  type Collection,
  type LicenseTerms,
  type PurchaseConsent,
  type PurchaseReceipt,
} from "@/types/lexicons";

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function formatMoney(m: { amount: number; currency: string }): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: m.currency,
  }).format(m.amount / 100);
}

function PdslsCidLink({
  cid,
  recordUri,
  label,
}: {
  cid: string;
  recordUri: string;
  label: string;
}) {
  const href = pdslsRecordUrl(recordUri);
  if (!href) {
    return (
      <p className="text-xs text-muted-foreground">
        {label} <code className="text-[11px] break-all">{cid}</code>
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      {label}{" "}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title="Open record in pdsls"
        className="break-all font-mono text-[11px] text-primary underline-offset-2 hover:underline"
      >
        {cid}
      </a>
    </p>
  );
}

export function PurchaseDetailPage() {
  const { receiptUri: enc } = useParams<{ receiptUri: string }>();
  const receiptUri = enc ? decodeURIComponent(enc) : "";
  const { session, loading } = useAtpSession();
  const agent = useMemo(() => createPublicAgent(), []);

  const [receipt, setReceipt] = useState<PurchaseReceipt | null>(null);
  const [receiptCid, setReceiptCid] = useState<string | null>(null);
  const [consent, setConsent] = useState<PurchaseConsent | null>(null);
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [coverImages, setCoverImages] = useState<
    Array<{ objectId: string; url: string }>
  >([]);
  const [productType, setProductType] = useState<string | null>(null);
  const [productItemMeta, setProductItemMeta] = useState<
    Record<string, { title: string; durationMs: number | null }>
  >({});
  const [license, setLicense] = useState<LicenseTerms | null>(null);
  const [zipBusy, setZipBusy] = useState(false);
  const [itemDownloadingUri, setItemDownloadingUri] = useState<string | null>(
    null,
  );
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    if (!receiptUri || !session) {
      setPageLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setPageLoading(true);
      try {
        const at = new AtUri(receiptUri);
        if (at.hostname !== session.did) {
          toast.error("Receipt is not in your account");
          setReceipt(null);
          return;
        }
        if (at.collection !== BAZAAR_COLLECTION.receipt || !at.rkey) {
          toast.error("Invalid receipt URI");
          setReceipt(null);
          return;
        }
        const receiptAgent = await agentForRepo(at.hostname);
        const res = await receiptAgent.com.atproto.repo.getRecord({
          repo: at.hostname,
          collection: at.collection,
          rkey: at.rkey,
        });
        if (cancelled) return;
        const rec = res.data.value as PurchaseReceipt;
        setReceipt(rec);
        setReceiptCid(res.data.cid ?? null);

        const consents = await listPurchaseConsentRows(session.did);
        const match = consents.find((c) => c.consent.receiptUri === receiptUri);
        if (!cancelled && match) setConsent(match.consent);

        const itemUri = rec.item.uri;
        const itemVal = await getRecordValue<CatalogItem>(itemUri);
        if (!cancelled) setItem(itemVal ?? null);

        if (itemVal?.$type === BAZAAR_COLLECTION.product && "items" in itemVal) {
          const [p, resolvedItems] = await Promise.all([
            getCatalogProduct(itemUri),
            Promise.all(itemVal.items.map((ref) => getCatalogItem(ref.uri))),
          ]);
          if (!cancelled) {
            setCoverImages(p?.coverImages ?? []);
            setProductType(p?.productType ?? null);
            setProductItemMeta(
              Object.fromEntries(
                itemVal.items.map((ref, i) => [
                  ref.uri,
                  {
                    title: resolvedItems[i]?.title ?? ref.uri,
                    durationMs: resolvedItems[i]?.durationMs ?? null,
                  },
                ]),
              ),
            );
          }
        } else if (itemVal?.$type === BAZAAR_COLLECTION.item) {
          const it = await getCatalogItem(itemUri);
          if (!cancelled) setCoverImages(it?.coverImages ?? []);
        }

        if (rec.licenseGrantUri) {
          const lt = await getRecordValue<LicenseTerms>(rec.licenseGrantUri);
          if (!cancelled) setLicense(lt);
        }
      } catch {
        if (!cancelled) toast.error("Failed to load purchase");
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [receiptUri, session]);

  async function downloadDigitalItemUri(itemUri: string) {
    if (!session) return;
    setItemDownloadingUri(itemUri);
    try {
      const url = createBrowserApiURL("/api/download");
      url.searchParams.set("itemUri", itemUri);
      const res = await fetch(url.href, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const { url: signed } = (await res.json()) as { url: string };
      window.location.href = signed;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setItemDownloadingUri(null);
    }
  }

  async function downloadProductZip(productUri: string) {
    if (!session) return;
    setZipBusy(true);
    try {
      const url = createBrowserApiURL("/api/download/product-zip");
      url.searchParams.set("productUri", productUri);
      const res = await fetch(url.href, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const blob = await res.blob();
      const dispo = res.headers.get("Content-Disposition");
      const match = dispo?.match(/filename="([^"]+)"/);
      const name = match?.[1] ?? "product.zip";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setZipBusy(false);
    }
  }

  async function downloadCollectionZip(collectionUri: string) {
    if (!session) return;
    setZipBusy(true);
    try {
      const url = createBrowserApiURL("/api/download/collection-zip");
      url.searchParams.set("collectionUri", collectionUri);
      const res = await fetch(url.href, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const blob = await res.blob();
      const dispo = res.headers.get("Content-Disposition");
      const match = dispo?.match(/filename="([^"]+)"/);
      const name = match?.[1] ?? "collection.zip";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setZipBusy(false);
    }
  }

  if (loading || pageLoading) {
    return (
      <div className="px-4 py-8 text-muted-foreground sm:px-6">Loading…</div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center">
        <p className="text-muted-foreground">Sign in to view this purchase.</p>
        <Link to="/dashboard" className="underline mt-4 inline-block">
          Dashboard
        </Link>
      </div>
    );
  }

  if (!receipt || !item) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-muted-foreground">
        Purchase not found.
      </div>
    );
  }

  const isDigital = item.$type === BAZAAR_COLLECTION.digitalItem;
  const isCollection = item.$type === BAZAAR_COLLECTION.collection;
  const isProduct = item.$type === BAZAAR_COLLECTION.product;
  const isMusicProduct = isProduct && productTypeConfig(productType).value === "music";
  const isCatalogItemSingle = item.$type === BAZAAR_COLLECTION.item;
  const blobDid = catalogItemSellerDid(item);

  return (
    <article className="mx-auto w-full min-w-0 max-w-2xl space-y-8 px-4 sm:px-6 py-8">
      <div>
        <Link
          to="/dashboard"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Purchases
        </Link>
      </div>

      <section className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-start">
        <div className="overflow-hidden rounded-xl border border-border bg-muted aspect-square max-h-64">
          {coverImages[0] ? (
            <img
              src={coverImages[0].url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <ArtworkImage
              agent={agent}
              did={blobDid}
              cid={catalogItemArtworkCid(item)}
              itemUri={receipt.item.uri}
              alt=""
              className="h-full w-full"
            />
          )}
        </div>
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold">{item.title}</h1>
          <p className="text-sm text-muted-foreground">
            Purchased {formatMoney(receipt.pricePaid)} ·{" "}
            {new Date(receipt.purchasedAt).toLocaleString()}
          </p>
          {receiptCid ? (
            <PdslsCidLink
              cid={receiptCid}
              recordUri={receiptUri}
              label="Receipt record CID:"
            />
          ) : null}
          {receipt.licenseGrantCid && receipt.licenseGrantUri ? (
            <PdslsCidLink
              cid={receipt.licenseGrantCid}
              recordUri={receipt.licenseGrantUri}
              label="License terms (at purchase) CID:"
            />
          ) : receipt.licenseGrantCid ? (
            <p className="text-xs text-muted-foreground">
              License terms (at purchase) CID:{" "}
              <code className="text-[11px] break-all">
                {receipt.licenseGrantCid}
              </code>
            </p>
          ) : null}
          <hr className="my-3 border-border" />
          {receipt.listingCid && receipt.listingUri ? (
            <PdslsCidLink
              cid={receipt.listingCid}
              recordUri={receipt.listingUri}
              label="Listing (at purchase) CID:"
            />
          ) : null}
          {receipt.item.cid ? (
            <PdslsCidLink
              cid={receipt.item.cid}
              recordUri={receipt.item.uri}
              label="Item (at purchase) CID:"
            />
          ) : null}
        </div>
      </section>

      {isDigital && "formats" in item && item.formats?.length ? (
        <div className="flex flex-wrap gap-2">
          {item.formats.map((f: string) => (
            <FormatBadge key={f} format={f} />
          ))}
        </div>
      ) : null}

      <section className="flex flex-wrap gap-2" aria-label="Metadata">
        {"releaseDate" in item && item.releaseDate ? (
          <MetadataChip>
            Released:{" "}
            {new Date(item.releaseDate).toLocaleDateString("en-US", {
              timeZone: "UTC",
            })}
          </MetadataChip>
        ) : null}
        {"durationMs" in item && item.durationMs ? (
          <MetadataChip>{Math.round(item.durationMs / 60000)} min</MetadataChip>
        ) : null}
        {"genre" in item
          ? item.genre?.map((g) => <MetadataChip key={g}>{g}</MetadataChip>)
          : null}
      </section>

      {"description" in item && item.description ? (
        <section className="max-w-none text-sm text-foreground">
          <h2 className="mb-2 text-lg font-medium">Description</h2>
          <MarkdownBody>{item.description}</MarkdownBody>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Terms at time of purchase</h2>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {license?.licenseText ?? "License terms could not be loaded."}
        </p>
        {consent ? (
          <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
            <li>
              Consented at: {new Date(consent.consentedAt).toLocaleString()}
            </li>
          </ul>
        ) : null}
      </section>

      {isCollection ? (
        <section className="space-y-4">
          <h2 className="text-lg font-medium">Your downloads</h2>
          <CollectionMemberDownloads
            collection={item as Collection}
            onDownloadItem={(u) => void downloadDigitalItemUri(u)}
            onDownloadZip={() => void downloadCollectionZip(receipt.item.uri)}
            zipBusy={zipBusy}
            itemBusyUri={itemDownloadingUri}
          />
        </section>
      ) : null}

      {isProduct && "items" in item ? (
        <section className="space-y-4">
          <h2 className="text-lg font-medium">Your downloads</h2>
          <ol className="list-none space-y-2 m-0 p-0">
            {item.items.map((ref, index) => {
              const meta = productItemMeta[ref.uri];
              return (
                <li
                  key={ref.uri}
                  className="flex items-center justify-between gap-2 py-1.5"
                >
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    {isMusicProduct ? (
                      <span className="tabular-nums text-muted-foreground shrink-0 w-5 text-right">
                        {index + 1}.
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {meta?.title ?? ref.uri}
                    </span>
                    {meta?.durationMs != null ? (
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {formatDuration(meta.durationMs)}
                      </span>
                    ) : null}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={itemDownloadingUri === ref.uri}
                    onClick={() => void downloadDigitalItemUri(ref.uri)}
                  >
                    {itemDownloadingUri === ref.uri ? "Preparing…" : "Download"}
                  </Button>
                </li>
              );
            })}
          </ol>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={zipBusy}
            onClick={() => void downloadProductZip(receipt.item.uri)}
          >
            {zipBusy ? "Preparing…" : "Download all (.zip)"}
          </Button>
        </section>
      ) : null}

      {isDigital || isCatalogItemSingle ? (
        <section>
          <Button
            type="button"
            disabled={itemDownloadingUri !== null}
            onClick={() => void downloadDigitalItemUri(receipt.item.uri)}
          >
            {itemDownloadingUri ? "Preparing…" : "Download"}
          </Button>
        </section>
      ) : null}

      {!isDigital && !isCollection && !isProduct && !isCatalogItemSingle ? (
        <p className="text-sm text-muted-foreground">
          Download is not available for this item type.
        </p>
      ) : null}
    </article>
  );
}
