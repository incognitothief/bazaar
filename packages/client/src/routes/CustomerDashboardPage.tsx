import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { XIcon } from "lucide-react";

import { useAtpSession } from "@/hooks/useAtpSession";
import { getAuthRole } from "@/lib/auth";
import { merchantSignInUrl } from "@/lib/signInReturn";
import { pdslsRecordUrl } from "@/lib/pdsls";
import {
  getRecordValue,
  listPurchaseReceiptRows,
  type PurchaseReceiptRow,
} from "@/lib/atproto/records";
import type { CatalogItem } from "@/types/lexicons";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ValidateReceiptDialog } from "@/components/ValidateReceiptDialog";
import { CopyButton } from "@/components/shared/CopyButton";

function formatMoney(m: { amount: number; currency: string }): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: m.currency,
  }).format(m.amount / 100);
}

export function CustomerDashboardPage() {
  const { session, loading } = useAtpSession();
  const navigate = useNavigate();
  const location = useLocation();

  const [purchases, setPurchases] = useState<PurchaseReceiptRow[]>([]);
  const [purchaseTitles, setPurchaseTitles] = useState<Record<string, string>>(
    {},
  );
  const [unresolvedItemUris, setUnresolvedItemUris] = useState<Set<string>>(
    new Set(),
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !session) return;
    if (getAuthRole(session.did) === "merchant") {
      navigate("/merchant/dashboard", { replace: true });
    }
  }, [loading, session, navigate]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void listPurchaseReceiptRows(session.did)
      .then((rows) => {
        if (cancelled) return;
        // A buyer's repo can hold purchase.receipt records from any Bazaar
        // storefront, not just this one -- issuerScope is the selling
        // merchant's own DID, stable across app-identity/key changes on our
        // side, so it's the right signal for "did this store sell it."
        const storefrontDid = import.meta.env.VITE_ARTIST_DID?.trim();
        setPurchases(
          storefrontDid
            ? rows.filter((r) => r.receipt.issuerScope === storefrontDid)
            : rows,
        );
      })
      .catch(() => {
        if (!cancelled) setPurchases([]);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session || purchases.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      const failed = new Set<string>();
      for (const row of purchases) {
        const uri = row.receipt.item.uri;
        try {
          const item = await getRecordValue<CatalogItem>(uri);
          if (item?.title) {
            next[row.uri] = item.title;
          } else {
            // Record resolved but has no title, or resolved to nothing --
            // treat the same as "couldn't find it" for display purposes.
            failed.add(row.uri);
          }
        } catch {
          // Most commonly: the merchant deleted/replaced this item after
          // the purchase was made, so it no longer resolves. The receipt
          // itself is still a real, valid record -- just orphaned.
          failed.add(row.uri);
        }
      }
      if (!cancelled) {
        setPurchaseTitles((prev) => ({ ...prev, ...next }));
        setUnresolvedItemUris(
          (prev) => new Set([...prev, ...failed]),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [purchases, session]);

  if (loading) {
    return (
      <div className="px-4 py-8 text-center text-muted-foreground sm:px-6">
        Pulling data from pds...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-lg space-y-6 px-4 py-12 text-center sm:px-6">
        <h1 className="text-2xl font-semibold">Your purchases</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to view your purchases and validate receipts.
        </p>
        <Link
          to={merchantSignInUrl(location.pathname, location.search)}
          className="underline underline-offset-4"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3 min-w-0">
        <div className="space-y-2 min-w-0">
          <h1 className="text-2xl font-semibold">Your purchases</h1>
          <p className="text-sm text-muted-foreground">
            Below is a list of items you have purchased from this bazaar.
          </p>
        </div>
        <ValidateReceiptDialog onError={setValidationError} />
      </div>

      {validationError ? (
        <div className="flex items-start justify-between gap-3 border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <p className="min-w-0 break-words">{validationError}</p>
          <button
            type="button"
            onClick={() => setValidationError(null)}
            aria-label="Dismiss"
            className="shrink-0 text-destructive/70 hover:text-destructive"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      ) : null}

      {purchases.length > 0 ? (
        <div className="rounded-lg border border-border divide-y">
          {purchases.map((row) => {
            const unresolved = unresolvedItemUris.has(row.uri);
            const receiptHref = pdslsRecordUrl(row.uri);
            return (
              <div
                key={row.uri}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 space-y-0.5">
                  {unresolved ? (
                    <>
                      <p className="font-medium text-muted-foreground">
                        Item unavailable
                      </p>
                      <div className="flex min-w-0 items-center gap-1">
                        <code
                          className="min-w-0 truncate text-[11px] text-muted-foreground"
                          title={row.receipt.item.uri}
                        >
                          {row.receipt.item.uri}
                        </code>
                        <CopyButton
                          value={row.receipt.item.uri}
                          label="Copy item URI"
                        />
                      </div>
                    </>
                  ) : (
                    <p className="font-medium truncate">
                      {purchaseTitles[row.uri] ?? row.receipt.item.uri}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {formatMoney(row.receipt.pricePaid)} ·{" "}
                    {new Date(row.receipt.purchasedAt).toLocaleString()}
                  </p>
                </div>
                {unresolved && receiptHref ? (
                  <a
                    href={receiptHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="The item behind this receipt couldn't be found -- opening the raw receipt record on pdsls instead"
                    className={cn(
                      buttonVariants({ variant: "secondary", size: "sm" }),
                    )}
                  >
                    View Receipt
                  </a>
                ) : (
                  <Link
                    to={`/dashboard/purchase/${encodeURIComponent(row.uri)}`}
                    className={cn(
                      buttonVariants({ variant: "secondary", size: "sm" }),
                    )}
                  >
                    View Receipt
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No purchase receipts found in your PDS yet.
        </p>
      )}
    </div>
  );
}
