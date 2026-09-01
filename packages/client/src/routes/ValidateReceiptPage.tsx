import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { AtUri } from "@atproto/syntax";
import { toast } from "sonner";

import { useAtpSession } from "@/hooks/useAtpSession";
import { merchantSignInUrl } from "@/lib/signInReturn";
import { catalogItemRkey, itemPathCanonical } from "@/lib/itemPath";
import { agentForRepo } from "@/lib/atproto/pdsResolve";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import type { Listing, PurchaseReceipt } from "@/types/lexicons";
import { Badge } from "@/components/ui/badge";
import { ValidateReceiptDialog } from "@/components/ValidateReceiptDialog";

type ReceiptValidationResult = {
  receiptOk: boolean;
  listingOk: boolean;
  listingActive: boolean;
  listingCidMatches: boolean;
  receiptListingCid?: string;
  receiptListingUri?: string;
  listingStatus?: Listing["status"];
  listingPrice?: Listing["price"];
  listingItemCollection?: string;
  listingItemUri?: string;
  error?: string;
};

function formatMoney(m: { amount: number; currency: string }): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: m.currency,
  }).format(m.amount / 100);
}

export function ValidateReceiptPage() {
  const { session, loading } = useAtpSession();
  const location = useLocation();
  const { receiptUri: encoded } = useParams<{ receiptUri?: string }>();
  const uriFromRoute = encoded ? decodeURIComponent(encoded) : "";

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReceiptValidationResult | null>(null);

  async function validate(uri: string) {
    if (!session) return;
    const trimmed = uri.trim();
    if (!trimmed) return;

    setBusy(true);
    setResult(null);

    try {
      const receiptAt = new AtUri(trimmed);
      if (receiptAt.hostname !== session.did) {
        throw new Error("That receipt is not in your account.");
      }
      if (receiptAt.collection !== BAZAAR_COLLECTION.receipt) {
        throw new Error("That URI is not a Bazaar purchase receipt.");
      }
      if (!receiptAt.rkey) {
        throw new Error(
          "URI is missing its record key -- it points at the collection, not one receipt. It should end in .../purchase.receipt/<rkey>.",
        );
      }

      const receiptAgent = await agentForRepo(receiptAt.hostname);
      const receiptRes = await receiptAgent.com.atproto.repo.getRecord({
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

      const listingAgent = await agentForRepo(listingAt.hostname);
      const listingRes = await listingAgent.com.atproto.repo.getRecord({
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
        listingItemCollection: new AtUri(listing.item.uri).collection,
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

  useEffect(() => {
    if (session && uriFromRoute) void validate(uriFromRoute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uriFromRoute, session]);

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
        <h1 className="text-2xl font-semibold">Validate receipt URI</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to validate your purchase receipts against available
          listings.
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
      <div className="space-y-2 min-w-0">
        <Link
          to="/dashboard"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Your purchases
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 min-w-0">
        <div className="space-y-2 min-w-0">
          <h1 className="text-2xl font-semibold">Validate receipt URI</h1>
          <p className="text-sm text-muted-foreground">
            Check a purchase receipt's AT-URI against the listing it was
            issued for.
          </p>
        </div>
        <ValidateReceiptDialog initialUri={uriFromRoute} />
      </div>

      {busy ? (
        <p className="text-sm text-muted-foreground">Validating…</p>
      ) : result ? (
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
              {result.listingItemCollection ? (
                <p className="text-muted-foreground">
                  Item type:{" "}
                  <span className="font-medium">
                    {result.listingItemCollection}
                  </span>
                </p>
              ) : null}
              {result.listingItemUri ? (
                <p className="pt-2">
                  <Link
                    to={itemPathCanonical(
                      catalogItemRkey(result.listingItemUri),
                    )}
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
      ) : (
        <p className="text-sm text-muted-foreground">
          No receipt validated yet. Use "Validate a receipt URI" above.
        </p>
      )}
    </div>
  );
}
