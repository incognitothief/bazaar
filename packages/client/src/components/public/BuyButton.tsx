import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { CatalogItem, LicenseTerms, Listing } from "@/types/lexicons";
import { cn } from "@/lib/utils";

export function BuyButton({
  listingUri,
  listing,
  item,
  licenseTerms,
  className,
}: {
  listingUri: string;
  listing: Listing;
  item: CatalogItem;
  licenseTerms?: LicenseTerms | null;
  className?: string;
}) {
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsConsent =
    !licenseTerms || licenseTerms.checkoutConsentRequired === true;
  const disabled = needsConsent ? !agreed : false;

  const href =
    licenseTerms?.humanReadableUrl ?? "https://creativecommons.org/licenses/";

  async function onBuy() {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingUri,
          itemUri: listing.item.uri,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
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
      {needsConsent ? (
        <div className="flex items-start gap-2">
          <input
            id="license-consent"
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-input"
            aria-describedby="license-consent-desc"
          />
          <div className="space-y-1">
            <Label htmlFor="license-consent" className="font-normal leading-snug">
              I agree to the{" "}
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2"
              >
                license terms
              </a>{" "}
              for this purchase.
            </Label>
            <p id="license-consent-desc" className="text-xs text-muted-foreground">
              {item.title}
            </p>
          </div>
        </div>
      ) : null}
      <Button
        size="lg"
        className="w-full sm:w-auto"
        disabled={disabled || loading}
        onClick={() => void onBuy()}
        aria-busy={loading}
      >
        {loading ? "Redirecting…" : "Buy now"}
      </Button>
      {err ? (
        <p className="text-sm text-destructive" role="alert">
          Payment unavailable — please try again ({err})
        </p>
      ) : null}
    </div>
  );
}
