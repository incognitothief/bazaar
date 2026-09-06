import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { browserApiUrl } from "@/lib/browserApi";
import { resolveHandleForDid } from "@/lib/atproto/pdsResolve";
import { pdslsRecordUrl, pdslsRepoCollectionsUrl } from "@/lib/pdsls";
import { catalogItemRkey, itemPathPretty } from "@/lib/itemPath";
import { cn } from "@/lib/utils";

type TxWindow = "all" | "7d" | "24h";

const WINDOW_LABEL: Record<TxWindow, string> = {
  all: "All time",
  "7d": "Last 7 days",
  "24h": "Last 24 hours",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Quick-filter status buttons — a subset of the fulfillment states worth pinning. */
const STATUS_QUICK_FILTERS = ["completed", "failed", "dead_letter"] as const;

function statusLabel(s: string): string {
  return s === "dead_letter"
    ? "Dead letter"
    : s.charAt(0).toUpperCase() + s.slice(1);
}

function FilterChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label} filter`}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/** A stat card that doubles as a toggle for its time-window filter. */
function StatFilterBox({
  label,
  value,
  active,
  onClick,
  className,
  title,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title ?? (active ? `Clear the ${label} filter` : `Filter to ${label}`)}
      className={cn(
        "relative rounded-lg border p-4 text-left transition-colors hover:bg-muted/40",
        active ? "border-primary ring-1 ring-primary/30" : "border-border",
        className,
      )}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      <Filter
        className={cn(
          "absolute bottom-2 right-2 size-3.5 text-muted-foreground",
          active ? "text-primary opacity-100" : "opacity-40",
        )}
        aria-hidden="true"
      />
    </button>
  );
}

export type PaymentFulfillmentRow = {
  paymentIntentId: string;
  checkoutSessionId: string | null;
  buyerDid: string | null;
  status: string;
  attemptCount: number;
  nextRetryAt: number | null;
  lastError: string | null;
  receiptUri: string | null;
  receiptCid: string | null;
  consentUri: string | null;
  itemUri: string | null;
  listingUri: string | null;
  /** ERP-first (catalogItems/catalogProducts); null for rows predating this column or a legacy digital/physical/collection sale. */
  itemTitle: string | null;
  createdAt: string;
  updatedAt: string;
};

function fmtTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtRetry(ms: number | null): string {
  if (ms == null) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function Ellipsis({ text, className }: { text: string; className?: string }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "block max-w-[14rem] truncate font-mono text-xs",
        className,
      )}
      title={text}
    >
      {text}
    </span>
  );
}

function statusPill(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300";
    case "failed":
      return "bg-amber-500/15 text-amber-900 dark:text-amber-200";
    case "dead_letter":
      return "bg-destructive/15 text-destructive";
    case "processing":
    case "receipt_written":
      return "bg-primary/10 text-primary";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function MerchantTransactionsPage() {
  const [rows, setRows] = useState<PaymentFulfillmentRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [handles, setHandles] = useState<Record<string, string | null>>({});
  const requestedDidsRef = useRef<Set<string>>(new Set());

  const [win, setWin] = useState<TxWindow>("all");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const hasFilters = win !== "all" || statusFilter !== null;
  const clearAll = () => {
    setWin("all");
    setStatusFilter(null);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(
          browserApiUrl("/api/merchant/payment-fulfillments"),
          {
            credentials: "include",
          },
        );
        const j = (await res.json().catch(() => null)) as {
          rows?: PaymentFulfillmentRow[];
          error?: string;
          detail?: string;
        } | null;
        if (cancelled) return;
        if (!res.ok) {
          const parts = [j?.error, j?.detail].filter(
            (x): x is string => typeof x === "string" && x.length > 0,
          );
          setErr(parts.join(": ") || `HTTP ${res.status}`);
          setRows([]);
          return;
        }
        setRows(Array.isArray(j?.rows) ? j.rows : []);
      } catch {
        if (!cancelled) {
          setErr("Could not load transactions.");
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Best-effort handle resolution for display — DID→handle comes from the same
  // DID-doc lookup the PDS resolver already does, so this is one extra cheap
  // call per distinct buyer. Falls back to showing the DID if it fails.
  useEffect(() => {
    const dids = Array.from(
      new Set(rows.map((r) => r.buyerDid).filter((d): d is string => !!d)),
    );
    const missing = dids.filter((d) => !requestedDidsRef.current.has(d));
    if (missing.length === 0) return;
    for (const d of missing) requestedDidsRef.current.add(d);

    let cancelled = false;
    void Promise.all(
      missing.map(
        async (did) => [did, await resolveHandleForDid(did)] as const,
      ),
    ).then((entries) => {
      if (cancelled) return;
      setHandles((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  // Counts only — computed from the rows already on the page (most recent batch, most
  // recent first), not a separate query. "Sale" = a completed fulfillment.
  const stats = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const weekMs = 7 * dayMs;
    let total = 0;
    let lastWeek = 0;
    let last24h = 0;
    for (const r of rows) {
      if (r.status !== "completed") continue;
      total += 1;
      const age = now - new Date(r.createdAt).getTime();
      if (Number.isNaN(age)) continue;
      if (age <= weekMs) lastWeek += 1;
      if (age <= dayMs) last24h += 1;
    }
    return { total, lastWeek, last24h };
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!hasFilters) return rows;
    const now = Date.now();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (win !== "all") {
        const age = now - new Date(r.createdAt).getTime();
        if (Number.isNaN(age)) return false;
        if (win === "24h" && age > DAY_MS) return false;
        if (win === "7d" && age > WEEK_MS) return false;
      }
      return true;
    });
  }, [rows, hasFilters, statusFilter, win]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sales</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Transactions and sales data.
        </p>
      </div>

      {!loading && !err ? (
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "7d", "24h"] as TxWindow[]).map((w) => (
            <Button
              key={w}
              type="button"
              size="sm"
              variant={win === w ? "default" : "outline"}
              onClick={() => setWin(w)}
            >
              {WINDOW_LABEL[w]}
            </Button>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
          {STATUS_QUICK_FILTERS.map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() =>
                setStatusFilter((cur) => (cur === s ? null : s))
              }
            >
              {statusLabel(s)}
            </Button>
          ))}
        </div>
      ) : null}

      {!loading && !err ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatFilterBox
            label="Total sales"
            value={stats.total}
            active={win === "all"}
            onClick={() => setWin("all")}
            className="col-span-2 sm:col-span-1"
            title={
              win === "all"
                ? "Showing all time"
                : "Clear the time-window filter"
            }
          />
          <StatFilterBox
            label="Last 7 days"
            value={stats.lastWeek}
            active={win === "7d"}
            onClick={() => setWin((w) => (w === "7d" ? "all" : "7d"))}
          />
          <StatFilterBox
            label="Last 24 hours"
            value={stats.last24h}
            active={win === "24h"}
            onClick={() => setWin((w) => (w === "24h" ? "all" : "24h"))}
          />
        </div>
      ) : null}

      {!loading && !err && hasFilters ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Filters
          </span>
          {win !== "all" ? (
            <FilterChip
              label={WINDOW_LABEL[win]}
              onClear={() => setWin("all")}
            />
          ) : null}
          {statusFilter ? (
            <FilterChip
              label={`Status: ${statusLabel(statusFilter)}`}
              onClear={() => setStatusFilter(null)}
            />
          ) : null}
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Clear all
          </button>
          <span className="ml-auto text-xs text-muted-foreground">
            {filteredRows.length} of {rows.length}
          </span>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : err ? (
        <p className="text-sm text-destructive" role="alert">
          {err}
        </p>
      ) : filteredRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {rows.length === 0
            ? "No payment rows yet."
            : "No transactions match the current filters."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">PaymentIntent</th>
                <th className="px-3 py-2 font-medium">Buyer</th>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Attempts</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium">Receipt</th>
                <th className="px-3 py-2 font-medium">Consent</th>
                <th className="px-3 py-2 font-medium">Last error</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr
                  key={r.paymentIntentId}
                  className="border-b border-border/80 hover:bg-muted/30"
                >
                  <td className="px-3 py-2 align-top">
                    <span
                      className={cn(
                        "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                        statusPill(r.status),
                      )}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Ellipsis text={r.paymentIntentId} />
                    {r.checkoutSessionId ? (
                      <Ellipsis
                        text={r.checkoutSessionId}
                        className="mt-0.5 text-muted-foreground"
                      />
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {r.buyerDid ? (
                      <a
                        href={pdslsRepoCollectionsUrl(r.buyerDid)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block max-w-[14rem] truncate font-mono text-xs text-primary underline-offset-2 hover:underline"
                        title={r.buyerDid}
                      >
                        {handles[r.buyerDid] ?? r.buyerDid}
                      </a>
                    ) : (
                      <Ellipsis text="" />
                    )}
                  </td>
                  <td className="px-3 py-2 align-top max-w-[12rem]">
                    {r.itemUri ? (
                      <Link
                        to={itemPathPretty(
                          catalogItemRkey(r.itemUri),
                          r.itemTitle ?? undefined,
                        )}
                        className="block truncate text-xs text-primary underline-offset-2 hover:underline"
                        title={r.itemTitle ?? r.itemUri}
                      >
                        {r.itemTitle ?? r.itemUri}
                      </Link>
                    ) : (
                      <Ellipsis text="" />
                    )}
                  </td>
                  <td className="px-3 py-2 align-top font-mono text-xs">
                    {r.attemptCount}
                    {r.nextRetryAt != null ? (
                      <span
                        className="mt-1 block text-muted-foreground"
                        title="Next retry"
                      >
                        ↻ {fmtRetry(r.nextRetryAt)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-muted-foreground whitespace-nowrap">
                    {fmtTs(r.updatedAt)}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {(() => {
                      if (!r.receiptUri) return <Ellipsis text="" />;
                      const href = pdslsRecordUrl(r.receiptUri);
                      if (!href) return <Ellipsis text={r.receiptUri} />;
                      return (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block max-w-[14rem] truncate font-mono text-xs text-primary underline-offset-2 hover:underline"
                          title={r.receiptUri}
                        >
                          {r.receiptUri}
                        </a>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {(() => {
                      if (!r.consentUri) return <Ellipsis text="" />;
                      const href = pdslsRecordUrl(r.consentUri);
                      if (!href) return <Ellipsis text={r.consentUri} />;
                      return (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block max-w-[14rem] truncate font-mono text-xs text-primary underline-offset-2 hover:underline"
                          title={r.consentUri}
                        >
                          {r.consentUri}
                        </a>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 align-top max-w-[12rem]">
                    {r.lastError ? (
                      <span
                        className="line-clamp-3 text-xs text-destructive"
                        title={r.lastError}
                      >
                        {r.lastError}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
