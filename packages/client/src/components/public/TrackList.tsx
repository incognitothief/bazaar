import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getRecordValue } from "@/lib/atproto/records";
import { Button, buttonVariants } from "@/components/ui/button";
import { catalogItemRkey, itemPathPretty } from "@/lib/itemPath";
import { cn } from "@/lib/utils";
import type { Collection, DigitalItem, Listing } from "@/types/lexicons";

function formatMoney(m: { amount: number; currency: string }): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: m.currency,
  }).format(m.amount / 100);
}

function formatDuration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function TrackList({
  collection,
  purchaseByTrackUri,
}: {
  collection: Collection;
  /** Active per-track listings where parentListing matches the collection listing AT-URI. */
  purchaseByTrackUri?: Map<
    string,
    { listingUri: string; listing: Listing }
  >;
}) {
  const [rows, setRows] = useState<
    {
      uri: string;
      trackNumber: number;
      title: string;
      durationMs?: number;
      purchase?: { listingUri: string; listing: Listing };
      digital: DigitalItem | null;
    }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out: {
        uri: string;
        trackNumber: number;
        title: string;
        durationMs?: number;
        purchase?: { listingUri: string; listing: Listing };
        digital: DigitalItem | null;
      }[] = [];
      let trackSeq = 0;
      for (const entry of collection.items) {
        if (entry.role !== "track") continue;
        trackSeq += 1;
        const v = await getRecordValue<DigitalItem>(entry.uri);
        const purchase = purchaseByTrackUri?.get(entry.uri);
        out.push({
          uri: entry.uri,
          trackNumber: entry.trackNumber ?? trackSeq,
          title: entry.title ?? v?.title ?? "Track",
          durationMs: v?.durationMs,
          purchase,
          digital: v ?? null,
        });
      }
      if (!cancelled) setRows(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [collection, purchaseByTrackUri]);

  return (
    <ol className="list-none space-y-3 text-sm m-0 p-0">
      {rows.map((r) => (
        <li key={r.uri} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="tabular-nums text-muted-foreground shrink-0 w-7 text-right">
                {r.trackNumber}.
              </span>
              <span className="min-w-0">
                <span className="font-medium">{r.title}</span>
                <span className="text-muted-foreground tabular-nums ml-2">
                  {formatDuration(r.durationMs)}
                </span>
              </span>
            </span>
            {purchaseByTrackUri ? (
              r.purchase ? (
                <Link
                  to={itemPathPretty(catalogItemRkey(r.uri), r.title)}
                  className={cn(
                    buttonVariants({ size: "sm", variant: "outline" }),
                    "shrink-0",
                  )}
                >
                  Buy · {formatMoney(r.purchase.listing.price)}
                </Link>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Not sold separately
                </span>
              )
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function CollectionMemberDownloads({
  collection,
  onDownloadItem,
  onDownloadZip,
  zipBusy,
  itemBusyUri,
}: {
  collection: Collection;
  onDownloadItem: (digitalItemUri: string) => void;
  onDownloadZip: () => void;
  zipBusy: boolean;
  itemBusyUri: string | null;
}) {
  const [rows, setRows] = useState<
    {
      uri: string;
      title: string;
      role: string;
      trackNumber: number | null;
      durationMs?: number;
    }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out: {
        uri: string;
        title: string;
        role: string;
        trackNumber: number | null;
        durationMs?: number;
      }[] = [];
      let trackSeq = 0;
      for (const entry of collection.items) {
        const v = await getRecordValue<DigitalItem>(entry.uri);
        const isTrack = entry.role === "track";
        if (isTrack) trackSeq += 1;
        out.push({
          uri: entry.uri,
          title: entry.title ?? v?.title ?? entry.uri,
          role: entry.role,
          trackNumber: isTrack ? (entry.trackNumber ?? trackSeq) : null,
          durationMs: v?.durationMs,
        });
      }
      if (!cancelled) setRows(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [collection]);

  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={zipBusy}
        onClick={() => onDownloadZip()}
      >
        {zipBusy ? "Preparing zip…" : "Download full collection (zip)"}
      </Button>
      <ol className="list-none space-y-3 text-sm m-0 p-0">
        {rows.map((r) => (
          <li key={r.uri} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-baseline gap-2">
                {r.trackNumber != null ? (
                  <span className="tabular-nums text-muted-foreground shrink-0 w-7 text-right">
                    {r.trackNumber}.
                  </span>
                ) : (
                  <span className="w-7 shrink-0" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="font-medium">{r.title}</span>
                  {r.role !== "track" ? (
                    <span className="text-muted-foreground text-xs ml-2">
                      {r.role}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground tabular-nums ml-2">
                    {formatDuration(r.durationMs)}
                  </span>
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={itemBusyUri === r.uri}
                onClick={() => onDownloadItem(r.uri)}
              >
                {itemBusyUri === r.uri ? "…" : "Download"}
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
