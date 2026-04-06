import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import { AtUri } from "@atproto/syntax";
import { toast } from "sonner";

import { ArtworkImage } from "@/components/public/ArtworkImage";
import { CollectionMemberDownloads } from "@/components/public/TrackList";
import { FormatBadge } from "@/components/shared/FormatBadge";
import { MetadataChip } from "@/components/shared/MetadataChip";
import { Button } from "@/components/ui/button";
import { useAtpSession } from "@/hooks/useAtpSession";
import { createBrowserApiURL } from "@/lib/browserApi";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import { pdslsRecordUrl } from "@/lib/pdsls";
import { getRecordValue, listPurchaseConsentRows } from "@/lib/atproto/records";
import { createPublicAgent } from "@/lib/atproto/session";
import type {
  CatalogItem,
  Collection,
  DigitalItem,
  LicenseTerms,
  PurchaseConsent,
  PurchaseReceipt,
} from "@/types/lexicons";

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
        const res = await agent.com.atproto.repo.getRecord({
          repo: at.hostname,
          collection: at.collection,
          rkey: at.rkey,
        });
        if (cancelled) return;
        const rec = res.data.value as PurchaseReceipt;
        setReceipt(rec);
        setReceiptCid(res.data.cid ?? null);

        const consents = await listPurchaseConsentRows(agent, session.did);
        const match = consents.find((c) => c.consent.receiptUri === receiptUri);
        if (!cancelled && match) setConsent(match.consent);

        const itemUri = rec.item.uri;
        const itemVal = await getRecordValue<CatalogItem>(agent, itemUri);
        if (!cancelled) setItem(itemVal ?? null);

        if (rec.licenseGrantUri) {
          const lt = await getRecordValue<LicenseTerms>(
            agent,
            rec.licenseGrantUri,
          );
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
  }, [receiptUri, session, agent]);

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
  const blobDid = isDigital
    ? (item as DigitalItem).artistDid
    : isCollection
      ? (item as Collection).artistDid
      : receipt.issuerScope;

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
          <ArtworkImage
            agent={agent}
            did={blobDid}
            cid={item.artworkCid}
            itemUri={receipt.item.uri}
            alt=""
            className="h-full w-full"
          />
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
            Released: {new Date(item.releaseDate).toLocaleDateString()}
          </MetadataChip>
        ) : null}
        {"durationMs" in item && item.durationMs ? (
          <MetadataChip>{Math.round(item.durationMs / 60000)} min</MetadataChip>
        ) : null}
        {item.genre?.map((g) => (
          <MetadataChip key={g}>{g}</MetadataChip>
        ))}
      </section>

      {"description" in item && item.description ? (
        <section className="prose prose-neutral dark:prose-invert max-w-none text-sm">
          <h2 className="text-lg font-medium mb-2 not-prose">Description</h2>
          <Markdown>{item.description}</Markdown>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Terms at time of purchase</h2>
        <p className="text-sm text-muted-foreground">
          {license?.summary ?? "License terms could not be loaded."}
        </p>
        {consent ? (
          <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
            {consent.usageTier ? (
              <li>Tier selected: {consent.usageTier}</li>
            ) : null}
            {consent.syncProject ? (
              <li>Project: {consent.syncProject}</li>
            ) : null}
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
            agent={agent}
            collection={item as Collection}
            onDownloadItem={(u) => void downloadDigitalItemUri(u)}
            onDownloadZip={() => void downloadCollectionZip(receipt.item.uri)}
            zipBusy={zipBusy}
            itemBusyUri={itemDownloadingUri}
          />
        </section>
      ) : null}

      {isDigital ? (
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

      {!isDigital && !isCollection ? (
        <p className="text-sm text-muted-foreground">
          Download is not available for this item type.
        </p>
      ) : null}
    </article>
  );
}
