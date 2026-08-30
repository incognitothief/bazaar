import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMerchantKeySync } from "@/hooks/useMerchantKeySync";

/**
 * Shown across the merchant panel when the storefront's signing-key history has
 * changed and the merchant's PDS `actor.merchantKeys` mirror is out of step.
 * One click writes the mirror using the merchant's live session. See ADR 0014.
 *
 * Dismissible for the current session; reappears on reload or on a fresh drift.
 *
 * Layout: one row on >=sm (icon · text · Sync · dismiss). On mobile it stacks —
 * text with the icon on its right, then a 50/50 Sync / Dismiss row.
 */
export function MerchantKeySyncBanner() {
  const { status, syncing, error, sync } = useMerchantKeySync();
  const [dismissed, setDismissed] = useState(false);

  const drift =
    status && status.inSync === false
      ? `${[...status.missing].sort().join(",")}|${[...status.extra].sort().join(",")}`
      : "";
  const lastDrift = useRef(drift);
  useEffect(() => {
    if (drift !== lastDrift.current) {
      lastDrift.current = drift;
      setDismissed(false);
    }
  }, [drift]);

  if (!status || status.inSync !== false || dismissed) return null;

  const counts =
    `(${status.missing.length} to add` +
    (status.extra.length > 0 ? `, ${status.extra.length} to remove` : "") +
    ")";

  return (
    <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        {/* text + icon (icon right on mobile, left on >=sm) */}
        <div className="flex items-center gap-2 sm:contents">
          <p className="min-w-0 flex-1 leading-5 sm:order-2">
            <span className="font-medium">
              Your storefront signing keys have changed.
            </span>{" "}
            <span className="text-amber-800 dark:text-amber-200/90">
              Sync your latest key history with your PDS?
            </span>{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 align-middle text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-200/90">
              {counts}
            </code>
          </p>
          <AlertTriangle className="size-4 shrink-0 sm:order-1" />
        </div>

        {/* actions: own 50/50 row on mobile, inline on >=sm */}
        <div className="flex gap-2 sm:contents">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void sync()}
            disabled={syncing}
            className="h-7 flex-1 px-2 sm:order-3 sm:flex-none sm:shrink-0"
          >
            {syncing ? (
              <>
                <RefreshCw className="mr-1 size-3.5 animate-spin" />
                Synchronizing…
              </>
            ) : (
              <>
                <Check className="mr-1 size-3.5" />
                Sync
              </>
            )}
          </Button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
            className="flex h-7 flex-1 items-center justify-center gap-1 rounded px-2 text-amber-700 hover:bg-amber-100 hover:text-amber-900 sm:order-4 sm:h-auto sm:flex-none sm:shrink-0 sm:p-1 dark:text-amber-200/70 dark:hover:bg-amber-500/15"
          >
            <X className="size-3.5" />
            <span className="sm:hidden">Dismiss</span>
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-1 text-destructive sm:pl-6">
          {error}
          {/\b(scope|auth|unauthorized|forbidden|token)\b/i.test(error)
            ? " — sign out and back in, then retry."
            : ""}
        </p>
      ) : null}
    </div>
  );
}
