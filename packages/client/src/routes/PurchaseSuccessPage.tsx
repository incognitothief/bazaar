import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { browserApiUrl } from "@/lib/browserApi";
import { cn } from "@/lib/utils";

export function PurchaseSuccessPage() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const [status, setStatus] = useState<string | null>(null);
  const [fulfillNote, setFulfillNote] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    void (async () => {
      try {
        const res = await fetch(
          `${browserApiUrl("/api/stripe/session-status")}?session_id=${encodeURIComponent(sessionId)}`,
        );
        if (!res.ok) return;
        const j = (await res.json()) as { paymentStatus?: string; mock?: boolean };
        setStatus(j.paymentStatus ?? null);

        if (j.mock || sessionId.startsWith("mock_")) return;
        if (j.paymentStatus !== "paid") return;

        const maxAttempts = 24;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const fr = await fetch(browserApiUrl("/api/stripe/fulfill-session"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ session_id: sessionId }),
          });
          if (fr.status === 409) {
            const body = (await fr.json().catch(() => null)) as {
              retry_after_ms?: number;
            } | null;
            const wait = Math.min(
              8000,
              Math.max(500, body?.retry_after_ms ?? 2500),
            );
            await new Promise((r) => setTimeout(r, wait));
            continue;
          }
          if (!fr.ok) {
            const err = (await fr.json().catch(() => null)) as {
              error?: string;
              detail?: string;
            } | null;
            const parts = [err?.error, err?.detail].filter(
              (x): x is string => typeof x === "string" && x.length > 0,
            );
            setFulfillNote(
              parts.length
                ? parts.join(": ")
                : `PDS sync failed (${fr.status}). Receipt may arrive after the server processes the Stripe webhook.`,
            );
            return;
          }
          setFulfillNote(null);
          return;
        }
        setFulfillNote(
          "PDS sync is still waiting on the server (checkout may be finishing). Refresh in a minute or check the Stripe webhook.",
        );
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
      {fulfillNote ? (
        <p className="text-sm text-amber-600 dark:text-amber-500" role="status">
          {fulfillNote}
        </p>
      ) : null}
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
