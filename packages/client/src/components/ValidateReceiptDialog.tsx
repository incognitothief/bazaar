import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AtUri } from "@atproto/syntax";
import { SearchIcon } from "lucide-react";

import { useAtpSession } from "@/hooks/useAtpSession";
import { agentForRepo } from "@/lib/atproto/pdsResolve";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import type { Listing, PurchaseReceipt } from "@/types/lexicons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Resolves a receipt URI end-to-end (receipt exists, belongs to this
 * account, and its pinned listing CID still matches an active listing).
 * On success, the caller navigates straight to the receipt -- there's no
 * separate results page, so any failure just throws for the caller to
 * surface.
 */
async function validateReceiptUri(uri: string, buyerDid: string) {
  const receiptAt = new AtUri(uri);
  if (receiptAt.hostname !== buyerDid) {
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
  const receiptListingCid = receipt.listing?.cid;
  const receiptListingUri = receipt.listing?.uri;

  if (!receiptListingCid || !receiptListingUri) {
    throw new Error("Receipt is missing listing information.");
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
  if (listingRes.data.cid !== receiptListingCid) {
    throw new Error(
      "Listing has changed since this receipt was issued (CID mismatch).",
    );
  }
  if (listing.status !== "active") {
    throw new Error(`Listing is not active (status: ${listing.status}).`);
  }
}

export function ValidateReceiptDialog({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const { session } = useAtpSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [uri, setUri] = useState("");
  const [busy, setBusy] = useState(false);

  async function validate() {
    if (!session) return;
    const trimmed = uri.trim();
    if (!trimmed) return;

    setBusy(true);
    try {
      await validateReceiptUri(trimmed, session.did);
      setOpen(false);
      navigate(`/dashboard/purchase/${encodeURIComponent(trimmed)}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setOpen(false);
      onError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setUri("");
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <SearchIcon />
            Validate a receipt URI
          </Button>
        }
      />
      <DialogContent
        className="top-[16%] translate-y-0 rounded-none sm:max-w-lg"
        showCloseButton={false}
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void validate();
          }}
        >
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Label htmlFor="dialog-receipt-uri" className="sr-only">
                Receipt URI
              </Label>
              <Input
                id="dialog-receipt-uri"
                className="rounded-none"
                value={uri}
                placeholder="at://did:plc:.../purchase.receipt/..."
                onChange={(e) => setUri(e.target.value)}
                autoFocus
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-none"
              onClick={() => setUri("")}
            >
              Clear
            </Button>
            <Button type="submit" className="rounded-none" disabled={busy}>
              {busy ? "Validating…" : "Validate"}
            </Button>
          </div>
          <DialogHeader>
            <DialogTitle>Validate a receipt URI</DialogTitle>
          </DialogHeader>
        </form>
      </DialogContent>
    </Dialog>
  );
}
