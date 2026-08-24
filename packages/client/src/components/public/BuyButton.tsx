import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAtpSession } from "@/hooks/useAtpSession";
import { stripeCheckoutPostUrl } from "@/lib/checkoutApi";
import { merchantSignInUrl } from "@/lib/signInReturn";
import type { LicenseTerms, Listing } from "@/types/lexicons";
import { cn } from "@/lib/utils";

export function BuyButton({
  listingUri,
  listing,
  licenseTerms,
  className,
}: {
  listingUri: string;
  listing: Listing;
  licenseTerms?: LicenseTerms | null;
  className?: string;
}) {
  const location = useLocation();
  const { session, loading: sessionLoading } = useAtpSession();
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsConsent =
    !licenseTerms || licenseTerms.checkoutConsentRequired === true;
  const consentOk = !needsConsent || agreed;
  const disabled = !consentOk || loading;

  async function onBuy() {
    if (!session?.did) return;
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch(stripeCheckoutPostUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          listingUri,
          itemUri: listing.item.uri,
          buyerDid: session.did,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          detail?: string;
        } | null;
        const parts = [j?.error, j?.detail].filter(
          (x): x is string => typeof x === "string" && x.length > 0,
        );
        throw new Error(parts.length ? parts.join(": ") : `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error("No checkout URL");
      window.location.href = data.url;
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : "Payment unavailable — please try again",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cn("space-y-4", className)}>
      {sessionLoading ? (
        <Button size="lg" className="w-full sm:w-auto" disabled>
          Checking account…
        </Button>
      ) : !session ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Sign in with your{" "}
            <a
              href="https://atmosphereaccount.com/hosts"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              atmosphere account
            </a>{" "}
            to purchase this item.
          </p>
          <Link
            to={merchantSignInUrl(location.pathname, location.search)}
            className={cn(
              buttonVariants({ size: "lg" }),
              "inline-flex w-full sm:w-auto",
            )}
          >
            Sign in to purchase
          </Link>
        </div>
      ) : (
        <>
          {needsConsent ? (
            <div className="flex items-center gap-2">
              <input
                id="license-consent"
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="license-consent" className="font-normal">
                I agree to the license terms for this purchase.
              </Label>
            </div>
          ) : null}
          <Button
            size="lg"
            className="w-full sm:w-auto"
            disabled={disabled}
            onClick={() => void onBuy()}
            aria-busy={loading}
          >
            {loading ? "Redirecting…" : "Buy now"}
          </Button>
        </>
      )}
      {err ? (
        <p className="text-sm text-destructive" role="alert">
          Payment unavailable — please try again ({err})
        </p>
      ) : null}
    </div>
  );
}
