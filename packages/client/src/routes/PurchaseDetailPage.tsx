import { ArtworkPlaceholder } from "@/components/shared/ArtworkPlaceholder";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { AtUri } from "@atproto/syntax";
import { toast } from "sonner";

import { CopyButton } from "@/components/shared/CopyButton";
import { MarkdownBody } from "@/components/shared/MarkdownBody";
import { TagTokens } from "@/components/shared/TagTokens";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAtpSession } from "@/hooks/useAtpSession";
import { createBrowserApiURL } from "@/lib/browserApi";
import { inventoryHttpErrorMessage } from "@/lib/api/inventoryApi";
import { merchantSignInUrl } from "@/lib/signInReturn";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import { pdslsRecordUrl } from "@/lib/pdsls";
import {
  getCatalogItem,
  getCatalogProduct,
  getRecordValue,
} from "@/lib/atproto/records";
import { agentForRepo } from "@/lib/atproto/pdsResolve";
import { productTypeConfig } from "@/lib/productTypes";
import {
  type CatalogItem,
  type LicenseTerms,
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

/**
 * Label + copyable raw value + optional pdsls link, for the "something
 * didn't resolve" states below -- meant to be readable and actionable by
 * either the buyer or merchant support looking into a broken purchase, not
 * just a developer.
 */
function TriageField({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string | null;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-start gap-1.5">
        <code className="min-w-0 flex-1 break-all text-[11px]">{value}</code>
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
      </div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[11px] text-primary underline-offset-2 hover:underline"
        >
          Open on pdsls ↗
        </a>
      ) : null}
    </div>
  );
}

export function PurchaseDetailPage() {
  const location = useLocation();
  const { receiptUri: enc } = useParams<{ receiptUri: string }>();
  const receiptUri = enc ? decodeURIComponent(enc) : "";
  const { session, loading } = useAtpSession();

  const [receipt, setReceipt] = useState<PurchaseReceipt | null>(null);
  const [receiptCid, setReceiptCid] = useState<string | null>(null);
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
  const [artworkPreviewOpen, setArtworkPreviewOpen] = useState(false);

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

        const itemUri = rec.purchasedGood.uri;
        const itemVal = await getRecordValue<CatalogItem>(itemUri);
        if (!cancelled) setItem(itemVal ?? null);

        if (
          itemVal?.$type === BAZAAR_COLLECTION.product &&
          "items" in itemVal
        ) {
          // Resolve metadata for the union of current members and the frozen
          // grant, so a member removed since the sale still gets a title.
          const metaUris = [
            ...new Set([
              ...itemVal.items.map((ref) => ref.uri),
              ...(Array.isArray(rec.grantedItems)
                ? rec.grantedItems.map((g) => g.uri)
                : []),
            ]),
          ];
          const [p, resolvedItems] = await Promise.all([
            getCatalogProduct(itemUri),
            Promise.all(metaUris.map((uri) => getCatalogItem(uri))),
          ]);
          if (!cancelled) {
            setCoverImages(p?.coverImages ?? []);
            setProductType(p?.productType ?? null);
            setProductItemMeta(
              Object.fromEntries(
                metaUris.map((uri, i) => [
                  uri,
                  {
                    title: resolvedItems[i]?.title ?? uri,
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

        if (rec.licenseGrant?.uri) {
          const lt = await getRecordValue<LicenseTerms>(rec.licenseGrant.uri);
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
        throw new Error(await inventoryHttpErrorMessage(res));
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
        throw new Error(await inventoryHttpErrorMessage(res));
      }
      // A precomputed package answers as JSON with a presigned R2 URL (server
      // is out of the data path); otherwise this is the live-rebuilt zip
      // bytes directly, same as before.
      if ((res.headers.get("Content-Type") ?? "").includes("application/json")) {
        const { url: signed } = (await res.json()) as { url: string };
        window.location.href = signed;
        return;
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

  if (loading || pageLoading) {
    return (
      <div className="px-4 py-8 text-muted-foreground sm:px-6">Loading…</div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center">
        <p className="text-muted-foreground">Sign in to view this purchase.</p>
        <Link
          to={merchantSignInUrl(location.pathname, location.search)}
          className="underline mt-4 inline-block"
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="mx-auto max-w-lg space-y-6 px-4 py-12">
        <p className="text-muted-foreground">
          This receipt could not be loaded. It may not exist, may belong to a
          different account, or the URI may be incomplete.
        </p>
        {receiptUri ? (
          <TriageField
            label="Receipt URI"
            value={receiptUri}
            href={pdslsRecordUrl(receiptUri)}
          />
        ) : null}
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Purchases
        </Link>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="mx-auto max-w-lg space-y-6 px-4 py-12">
        <div className="space-y-1">
          <h1 className="text-lg font-medium">Item record not found</h1>
          <p className="text-sm text-muted-foreground">
            The purchase itself is real -- this receipt exists and was issued by
            this store -- but the item it references no longer resolves. This
            usually means the merchant removed or replaced it after the purchase
            was made. If you're following up with support, these are the exact
            values to share.
          </p>
        </div>
        <div className="space-y-4 rounded-lg border border-border p-4">
          <TriageField
            label="Receipt URI"
            value={receiptUri}
            href={pdslsRecordUrl(receiptUri)}
          />
          {receiptCid ? (
            <TriageField label="Receipt record CID" value={receiptCid} />
          ) : null}
          <TriageField
            label="Item URI (not found)"
            value={receipt.purchasedGood.uri}
            href={pdslsRecordUrl(receipt.purchasedGood.uri)}
          />
          {receipt.purchasedGood.cid ? (
            <TriageField
              label="Item CID (at purchase)"
              value={receipt.purchasedGood.cid}
            />
          ) : null}
          {receipt.listing?.uri ? (
            <TriageField
              label="Listing URI"
              value={receipt.listing.uri}
              href={pdslsRecordUrl(receipt.listing.uri)}
            />
          ) : null}
        </div>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Purchases
        </Link>
      </div>
    );
  }

  const isProduct = item.$type === BAZAAR_COLLECTION.product;
  const isMusicProduct =
    isProduct && productTypeConfig(productType).value === "music";
  const isCatalogItemSingle = item.$type === BAZAAR_COLLECTION.item;
  // What this receipt actually entitles: the frozen grant. The fallback to
  // every current member only catches a receipt with no grant, which cannot
  // verify and so cannot download anyway (ADR 0019) -- display only.
  const entitledMemberUris =
    isProduct && "items" in item
      ? Array.isArray(receipt.grantedItems) && receipt.grantedItems.length > 0
        ? receipt.grantedItems.map((g) => g.uri)
        : item.items.map((r) => r.uri)
      : [];
  const coverUrl = coverImages[0]?.url;
  const hasArtwork = !!coverUrl;

  return (
    <article className="mx-auto w-full min-w-0 max-w-2xl space-y-8 px-4 sm:px-6 pb-8">
      <div>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Purchases
        </Link>
      </div>

      <section className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-start">
        {hasArtwork ? (
          <button
            type="button"
            onClick={() => setArtworkPreviewOpen(true)}
            aria-label="View full-size artwork"
            className="block overflow-hidden rounded-xl border border-border bg-muted aspect-square max-h-64 cursor-zoom-in transition-opacity hover:opacity-90"
          >
            {coverUrl ? (
              <img
                src={coverUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : null}
          </button>
        ) : (
          <ArtworkPlaceholder className="max-h-64" />
        )}
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
          {receipt.licenseGrant?.cid && receipt.licenseGrant.uri ? (
            <PdslsCidLink
              cid={receipt.licenseGrant.cid}
              recordUri={receipt.licenseGrant.uri}
              label="License terms (at purchase) CID:"
            />
          ) : receipt.licenseGrant?.cid ? (
            <p className="text-xs text-muted-foreground">
              License terms (at purchase) CID:{" "}
              <code className="text-[11px] break-all">
                {receipt.licenseGrant.cid}
              </code>
            </p>
          ) : null}
          <hr className="my-3 border-border" />
          {receipt.listing.cid && receipt.listing.uri ? (
            <PdslsCidLink
              cid={receipt.listing.cid}
              recordUri={receipt.listing.uri}
              label="Listing (at purchase) CID:"
            />
          ) : null}
          {receipt.purchasedGood.cid ? (
            <PdslsCidLink
              cid={receipt.purchasedGood.cid}
              recordUri={receipt.purchasedGood.uri}
              label="Item (at purchase) CID:"
            />
          ) : null}
        </div>
      </section>

      {"tags" in item && item.tags?.length ? (
        <TagTokens tags={item.tags} part="tokens" />
      ) : null}

      <section className="flex flex-wrap gap-2" aria-label="Metadata">
        {"tags" in item && item.tags?.length ? (
          <TagTokens tags={item.tags} part="plain" />
        ) : null}
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
      </section>

      {isProduct && "items" in item ? (
        <section className="space-y-4">
          <h2 className="text-lg font-medium">Your downloads</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={zipBusy}
            onClick={() => void downloadProductZip(receipt.purchasedGood.uri)}
          >
            {zipBusy ? "Preparing…" : "Download all (.zip)"}
          </Button>
          <ol className="list-none space-y-2 text-sm m-0 p-0">
            {entitledMemberUris.map((uri, index) => {
              const meta = productItemMeta[uri];
              return (
                <li
                  key={uri}
                  className="flex items-center justify-between gap-2 py-1.5"
                >
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    {isMusicProduct ? (
                      <span className="tabular-nums text-muted-foreground shrink-0 w-5 text-right">
                        {index + 1}.
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <span className="font-medium">{meta?.title ?? uri}</span>
                      {meta?.durationMs != null ? (
                        <span className="ml-2 text-muted-foreground tabular-nums">
                          {formatDuration(meta.durationMs)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={itemDownloadingUri === uri}
                    onClick={() => void downloadDigitalItemUri(uri)}
                  >
                    {itemDownloadingUri === uri ? "Preparing…" : "Download"}
                  </Button>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {isCatalogItemSingle ? (
        <section>
          <Button
            type="button"
            disabled={itemDownloadingUri !== null}
            onClick={() => void downloadDigitalItemUri(receipt.purchasedGood.uri)}
          >
            {itemDownloadingUri ? "Preparing…" : "Download"}
          </Button>
        </section>
      ) : null}

      {!isProduct && !isCatalogItemSingle ? (
        <p className="text-sm text-muted-foreground">
          Download is not available for this item type.
        </p>
      ) : null}

      <Dialog open={artworkPreviewOpen} onOpenChange={setArtworkPreviewOpen}>
        <DialogContent
          overlayClassName="bg-black/90 backdrop-blur-sm"
          className="flex w-auto max-w-[95vw] items-center justify-center border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-[95vw]"
          showCloseButton={false}
        >
          <div className="bg-muted leading-none">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt=""
                className="block max-h-[85vh] max-w-[85vw] object-contain"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </article>
  );
}
