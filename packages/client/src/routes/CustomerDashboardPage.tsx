import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { SearchIcon } from "lucide-react";

import { useAtpSession } from "@/hooks/useAtpSession";
import { getAuthRole } from "@/lib/auth";
import { merchantSignInUrl } from "@/lib/signInReturn";
import {
  getRecordValue,
  listPurchaseReceiptRows,
  type PurchaseReceiptRow,
} from "@/lib/atproto/records";
import type { CatalogItem } from "@/types/lexicons";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

function formatMoney(m: { amount: number; currency: string }): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: m.currency,
  }).format(m.amount / 100);
}

function ValidateReceiptPopover() {
  const navigate = useNavigate();
  const [uri, setUri] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <SearchIcon />
            Validate a receipt URI
          </Button>
        }
      />
      <PopoverContent align="end">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = uri.trim();
            if (!trimmed) return;
            setOpen(false);
            navigate(`/dashboard/validate/${encodeURIComponent(trimmed)}`);
          }}
        >
          <div className="space-y-1">
            <PopoverTitle>Validate a receipt URI</PopoverTitle>
            <PopoverDescription>
              Check any purchase receipt against the listing it was issued
              for.
            </PopoverDescription>
          </div>
          <div className="space-y-2">
            <Label htmlFor="popover-receipt-uri">Receipt URI</Label>
            <Input
              id="popover-receipt-uri"
              value={uri}
              placeholder="at://did:plc:.../purchase.receipt/..."
              onChange={(e) => setUri(e.target.value)}
              autoFocus
            />
          </div>
          <Button type="submit" size="sm" className="w-full">
            Validate
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function CustomerDashboardPage() {
  const { session, loading } = useAtpSession();
  const navigate = useNavigate();
  const location = useLocation();

  const [purchases, setPurchases] = useState<PurchaseReceiptRow[]>([]);
  const [purchaseTitles, setPurchaseTitles] = useState<Record<string, string>>(
    {},
  );

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
      for (const row of purchases) {
        const uri = row.receipt.item.uri;
        try {
          const item = await getRecordValue<CatalogItem>(uri);
          if (item?.title) next[row.uri] = item.title;
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setPurchaseTitles((prev) => ({ ...prev, ...next }));
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
        <ValidateReceiptPopover />
      </div>

      {purchases.length > 0 ? (
        <div className="rounded-lg border border-border divide-y">
          {purchases.map((row) => (
            <div
              key={row.uri}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="font-medium truncate">
                  {purchaseTitles[row.uri] ?? row.receipt.item.uri}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatMoney(row.receipt.pricePaid)} ·{" "}
                  {new Date(row.receipt.purchasedAt).toLocaleString()}
                </p>
              </div>
              <Link
                to={`/dashboard/purchase/${encodeURIComponent(row.uri)}`}
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" }),
                )}
              >
                View Receipt
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No purchase receipts found in your PDS yet.
        </p>
      )}
    </div>
  );
}
