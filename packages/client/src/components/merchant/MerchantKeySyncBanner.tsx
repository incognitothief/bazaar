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
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        <p className="min-w-0 flex-1 leading-5">
          <span className="font-medium">
            Your storefront signing keys have changed.
          </span>{" "}
          <span className="text-amber-800 dark:text-amber-200/90">
            Publish your latest key history to your PDS
          </span>{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5 align-middle text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-200/90">
            {counts}
          </code>
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void sync()}
          disabled={syncing}
          className="h-7 shrink-0 px-2"
        >
          {syncing ? (
            <>
              <RefreshCw className="mr-1 size-3.5 animate-spin" />
              Synchronizing…
            </>
          ) : (
            <>
              <Check className="mr-1 size-3.5" />
              Synchronize
            </>
          )}
        </Button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded p-1 text-amber-700 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-200/70 dark:hover:bg-amber-500/15"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {error ? (
        <p className="mt-1 pl-6 text-destructive">
          {error}
          {/\b(scope|auth|unauthorized|forbidden|token)\b/i.test(error)
            ? " — sign out and back in, then retry."
            : ""}
        </p>
      ) : null}
    </div>
  );
}
