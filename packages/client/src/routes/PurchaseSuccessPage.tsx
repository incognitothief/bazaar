import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
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
          `/api/stripe/session-status?session_id=${encodeURIComponent(sessionId)}`,
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
        Your download link will arrive shortly.
      </p>
      <p className="text-sm">
        Your receipt has been saved to your ATProto account when a buyer DID was
        captured at checkout.
      </p>
      <Link
        to="/"
        className={cn(buttonVariants({ variant: "outline" }))}
      >
        Back to storefront
      </Link>
    </div>
  );
}
