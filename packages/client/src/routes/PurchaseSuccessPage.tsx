import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { browserApiUrl } from "@/lib/browserApi";
import { catalogItemRkey, itemPathCanonical } from "@/lib/itemPath";
import { pdslsRecordUrl } from "@/lib/pdsls";
import { cn } from "@/lib/utils";

type PdsFulfillment = {
  receiptUri: string | null;
  consentUri: string | null;
  receiptCid?: string | null;
};

function PdslsAtUriLink({ uri }: { uri: string }) {
  const href = pdslsRecordUrl(uri);
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-sm font-mono text-primary break-all underline-offset-2 hover:underline leading-snug"
      >
        {uri}
      </a>
    );
  }
  return (
    <code className="block text-[11px] text-muted-foreground break-all leading-snug">
      {uri}
    </code>
  );
}

export function PurchaseSuccessPage() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const [status, setStatus] = useState<string | null>(null);
  const [fulfillNote, setFulfillNote] = useState<string | null>(null);
  const [pds, setPds] = useState<PdsFulfillment | null>(null);
  const [itemUri, setItemUri] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    void (async () => {
      try {
        const res = await fetch(
          `${browserApiUrl("/api/stripe/session-status")}?session_id=${encodeURIComponent(sessionId)}`,
        );
        if (!res.ok) return;
        const j = (await res.json()) as {
          paymentStatus?: string;
          mock?: boolean;
        };
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
                ? `We couldn't finish writing your receipt and license consent to your PDS yet. If you were charged, wait a moment and refresh, or open My purchases. (${parts.join(": ")})`
                : `We couldn't finish writing to your PDS yet (something went wrong on our side). If you were charged, try refreshing in a minute; records usually land shortly after payment.`,
            );
            return;
          }
          const okBody = (await fr.json().catch(() => null)) as {
            pds?: PdsFulfillment;
            itemUri?: string;
          } | null;
          if (
            typeof okBody?.itemUri === "string" &&
            okBody.itemUri.startsWith("at://")
          ) {
            setItemUri(okBody.itemUri);
          }
          if (okBody?.pds?.receiptUri || okBody?.pds?.consentUri) {
            setPds(okBody.pds);
          }
          setFulfillNote(null);
          return;
        }
        setFulfillNote(
          "We're still writing your receipt and license consent to your PDS. Refresh in a minute or open My purchases; they should appear in your repo soon.",
        );
      } catch {
        /* ignore */
      }
    })();
  }, [sessionId]);

  const headline =
    status === "paid"
      ? "Your payment went through."
      : status
        ? `We're processing your payment (${status}).`
        : "We're confirming your payment.";

  let itemHref: string | null = null;
  if (itemUri) {
    try {
      itemHref = itemPathCanonical(catalogItemRkey(itemUri));
    } catch {
      itemHref = null;
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 text-center py-12">
      <h1 className="text-2xl font-semibold">Thank you for your purchase</h1>
      <p className="text-muted-foreground">{headline}</p>
      {sessionId ? (
        <p className="text-xs text-muted-foreground break-all">
          Reference for support: {sessionId}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Bazaar records your purchase receipt and licensing agreement in{" "}
        <span className="text-foreground/90">your PDS</span>. You can view your
        records below.
      </p>
      {pds?.receiptUri || pds?.consentUri ? (
        <div className="rounded-lg border bg-card px-4 py-3 text-left space-y-3">
          <p className="text-sm font-medium text-foreground">
            Your purchase records
          </p>
          {pds.receiptUri ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Purchase receipt</p>
              <PdslsAtUriLink uri={pds.receiptUri} />
              {pds.receiptCid ? (
                <p className="text-[11px] text-muted-foreground">
                  CID{" "}
                  <span className="font-mono break-all">{pds.receiptCid}</span>
                </p>
              ) : null}
            </div>
          ) : null}
          {pds.consentUri ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">License consent</p>
              <PdslsAtUriLink uri={pds.consentUri} />
            </div>
          ) : null}
        </div>
      ) : null}
      {fulfillNote ? (
        <p className="text-sm text-amber-600 dark:text-amber-500" role="status">
          {fulfillNote}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        You can download your purchase now, or return to this storefront at a
        later time to access your purchase again.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center sm:flex-wrap">
        <Link
          to="/dashboard"
          className={cn(buttonVariants({ variant: "default" }))}
        >
          My purchases
        </Link>
        {itemHref ? (
          <Link
            to={itemHref}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            View item
          </Link>
        ) : null}
        <Link to="/" className={cn(buttonVariants({ variant: "outline" }))}>
          Back to storefront
        </Link>
      </div>
    </div>
  );
}
