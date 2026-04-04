import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { browserApiUrl } from "@/lib/browserApi";
import { cn } from "@/lib/utils";

export function PurchaseSuccessPage() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    void (async () => {
      try {
        const res = await fetch(
          `${browserApiUrl("/api/stripe/session-status")}?session_id=${encodeURIComponent(sessionId)}`,
        );
        if (!res.ok) return;
        const j = (await res.json()) as { paymentStatus?: string };
        setStatus(j.paymentStatus ?? null);
      } catch {
        /* ignore */
      }
    })();
  }, [sessionId]);

  return (
    <div className="mx-auto max-w-lg space-y-6 text-center py-12">
      <h1 className="text-2xl font-semibold">Thank you</h1>
      <p className="text-muted-foreground">
        Your purchase is confirmed
        {status ? ` (${status})` : ""}.
      </p>
      {sessionId ? (
        <p className="text-xs text-muted-foreground break-all">
          Session: {sessionId}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        After Stripe confirms payment, the app writes a{" "}
        <code className="text-xs">purchase.receipt</code> and{" "}
        <code className="text-xs">purchase.consent</code> to your PDS. That
        requires you to have signed in with Bazaar before checkout so the server
        can complete those records on your behalf.
      </p>
      <p className="text-sm text-muted-foreground">
        Download access will show up here once delivery is wired; your purchases
        also appear on the dashboard when receipts are in your repo.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link
          to="/dashboard"
          className={cn(buttonVariants({ variant: "default" }))}
        >
          View purchases
        </Link>
        <Link to="/" className={cn(buttonVariants({ variant: "outline" }))}>
          Back to storefront
        </Link>
      </div>
    </div>
  );
}
