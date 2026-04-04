import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AtUri } from "@atproto/syntax";
import { toast } from "sonner";

import { useAtpSession } from "@/hooks/useAtpSession";
import { getAuthRole } from "@/lib/auth";
import { merchantSignInUrl } from "@/lib/signInReturn";
import { createPublicAgent } from "@/lib/atproto/session";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import type { Listing, PurchaseReceipt } from "@/types/lexicons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

function formatMoney(m: { amount: number; currency: string }): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: m.currency,
  }).format(m.amount / 100);
}

type ReceiptValidationResult = {
  receiptOk: boolean;
  listingOk: boolean;
  listingActive: boolean;
  listingCidMatches: boolean;
  receiptListingCid?: string;
  receiptListingUri?: string;
  listingStatus?: Listing["status"];
  listingPrice?: Listing["price"];
  listingItemType?: string;
  listingItemUri?: string;
  error?: string;
};

export function CustomerDashboardPage() {
  const { session, loading, signOut } = useAtpSession();
  const navigate = useNavigate();
  const location = useLocation();
  const agent = useMemo(() => createPublicAgent(), []);

  const [receiptUri, setReceiptUri] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReceiptValidationResult | null>(null);

  useEffect(() => {
    if (loading || !session) return;
    if (getAuthRole(session.did) === "merchant") {
      navigate("/merchant/dashboard", { replace: true });
    }
  }, [loading, session, navigate]);

  async function validate() {
    if (!session) return;
    const input = receiptUri.trim();
    if (!input) return;

    setBusy(true);
    setResult(null);

    try {
      const receiptAt = new AtUri(input);
      if (receiptAt.hostname !== session.did) {
        throw new Error("That receipt is not in your account.");
      }
      if (receiptAt.collection !== BAZAAR_COLLECTION.receipt) {
        throw new Error("That URI is not a Bazaar purchase receipt.");
      }
      if (!receiptAt.rkey) throw new Error("Invalid receipt URI.");

      const receiptRes = await agent.com.atproto.repo.getRecord({
        repo: receiptAt.hostname,
        collection: receiptAt.collection,
        rkey: receiptAt.rkey,
      });

      const receipt = receiptRes.data.value as PurchaseReceipt;
      const receiptListingCid = receipt.listingCid;
      const receiptListingUri = receipt.listingUri;

      if (!receiptListingCid || !receiptListingUri) {
        throw new Error("Receipt is missing listing information.");
      }
      if (receipt.buyerDid && receipt.buyerDid !== session.did) {
        throw new Error("Receipt buyerDid does not match your account.");
      }

      const listingAt = new AtUri(receiptListingUri);
      if (listingAt.collection !== BAZAAR_COLLECTION.listing) {
        throw new Error("Receipt points to a non-Bazaar listing.");
      }
      if (!listingAt.rkey) throw new Error("Invalid listing URI.");

      const listingRes = await agent.com.atproto.repo.getRecord({
        repo: listingAt.hostname,
        collection: listingAt.collection,
        rkey: listingAt.rkey,
      });

      const listing = listingRes.data.value as Listing;
      const listingCid = listingRes.data.cid;

      const listingCidMatches = listingCid === receiptListingCid;
      const listingActive = listing.status === "active";

      setResult({
        receiptOk: true,
        listingOk: true,
        listingActive,
        listingCidMatches,
        receiptListingCid,
        receiptListingUri,
        listingStatus: listing.status,
        listingPrice: listing.price,
        listingItemType: listing.item.itemType,
        listingItemUri: listing.item.uri,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error("Receipt validation failed", { description: message });
      setResult({
        receiptOk: false,
        listingOk: false,
        listingActive: false,
        listingCidMatches: false,
        error: message,
      });
    } finally {
      setBusy(false);
    }
  }

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
        <h1 className="text-2xl font-semibold">Receipt validation</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to validate your purchase receipts against available listings.
        </p>
        <Link
          to={merchantSignInUrl(location.pathname, location.search)}
          className="underline underline-offset-4"
        >
          Login
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2 min-w-0">
          <h1 className="text-2xl font-semibold">Receipt validation</h1>
          <p className="text-sm text-muted-foreground">
            Paste your Bazaar <code className="text-xs">purchase.receipt</code>{" "}
            URI. We will verify the receipt and confirm the referenced listing
            is still available.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={() => void signOut()}
        >
          Sign out
        </Button>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void validate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="receipt-uri">Receipt URI</Label>
          <Input
            id="receipt-uri"
            value={receiptUri}
            placeholder="at://did:plc:.../diamonds.whereditgo.bazaar.purchase.receipt/..."
            onChange={(e) => setReceiptUri(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Validating…" : "Validate"}
        </Button>
      </form>

      {result ? (
        <div className="rounded-lg border border-border p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Listing status</p>
              {result.listingActive ? (
                <p className="text-lg font-semibold">Active</p>
              ) : (
                <p className="text-lg font-semibold">Not active</p>
              )}
            </div>
            <Badge variant={result.listingActive ? "default" : "secondary"}>
              {result.listingStatus ?? "unknown"}
            </Badge>
          </div>

          {result.listingOk && result.receiptListingUri ? (
            <div className="text-sm space-y-1">
              <p className="text-muted-foreground">
                Listing CID match:{" "}
                <span className="font-medium">
                  {result.listingCidMatches ? "Yes" : "No"}
                </span>
              </p>
              {result.listingPrice ? (
                <p className="text-muted-foreground">
                  Price:{" "}
                  <span className="font-medium">
                    {formatMoney(result.listingPrice)}
                  </span>
                </p>
              ) : null}
              {result.listingItemType ? (
                <p className="text-muted-foreground">
                  Item type:{" "}
                  <span className="font-medium">{result.listingItemType}</span>
                </p>
              ) : null}
              {result.listingItemUri ? (
                <p className="pt-2">
                  <Link
                    to={`/item/${encodeURIComponent(result.listingItemUri)}`}
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    View item
                  </Link>
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-destructive">
              {result.error ?? "Invalid receipt"}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
