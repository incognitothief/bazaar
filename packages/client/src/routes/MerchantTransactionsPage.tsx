import { useEffect, useState } from "react";
import { browserApiUrl } from "@/lib/browserApi";
import { cn } from "@/lib/utils";

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

/** pdsls explorer: repo collections for this DID. */
function buyerDidPdslsUrl(did: string): string {
  return `https://pdsls.dev/at://${did}#collections`;
}

function Ellipsis({ text, className }: { text: string; className?: string }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("block max-w-[14rem] truncate font-mono text-xs", className)} title={text}>
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(browserApiUrl("/api/merchant/payment-fulfillments"), {
          credentials: "include",
        });
        const j = (await res.json().catch(() => null)) as
          | { rows?: PaymentFulfillmentRow[]; error?: string; detail?: string }
          | null;
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payment activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Stripe PaymentIntent fulfillment state (PDS receipt and consent writes). Newest first.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : err ? (
        <p className="text-sm text-destructive" role="alert">
          {err}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payment rows yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">PaymentIntent</th>
                <th className="px-3 py-2 font-medium">Buyer DID</th>
                <th className="px-3 py-2 font-medium">Attempts</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium">Receipt</th>
                <th className="px-3 py-2 font-medium">Consent</th>
                <th className="px-3 py-2 font-medium">Last error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.paymentIntentId} className="border-b border-border/80 hover:bg-muted/30">
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
                      <Ellipsis text={r.checkoutSessionId} className="mt-0.5 text-muted-foreground" />
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {r.buyerDid ? (
                      <a
                        href={buyerDidPdslsUrl(r.buyerDid)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block max-w-[14rem] truncate font-mono text-xs text-primary underline-offset-2 hover:underline"
                        title={r.buyerDid}
                      >
                        {r.buyerDid}
                      </a>
                    ) : (
                      <Ellipsis text="" />
                    )}
                  </td>
                  <td className="px-3 py-2 align-top font-mono text-xs">
                    {r.attemptCount}
                    {r.nextRetryAt != null ? (
                      <span className="mt-1 block text-muted-foreground" title="Next retry">
                        ↻ {fmtRetry(r.nextRetryAt)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-muted-foreground whitespace-nowrap">
                    {fmtTs(r.updatedAt)}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Ellipsis text={r.receiptUri ?? ""} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Ellipsis text={r.consentUri ?? ""} />
                  </td>
                  <td className="px-3 py-2 align-top max-w-[12rem]">
                    {r.lastError ? (
                      <span className="line-clamp-3 text-xs text-destructive" title={r.lastError}>
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
