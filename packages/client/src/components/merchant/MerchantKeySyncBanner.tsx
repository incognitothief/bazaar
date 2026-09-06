import { useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { useMerchantKeySync } from "@/hooks/useMerchantKeySync";

/**
 * Shown across the merchant panel when the storefront's signing-key history has
 * changed and the merchant's PDS `actor.merchantKeys` mirror is out of step.
 * "Publish" writes the mirror using the merchant's live session. See ADR 0014.
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
    `${status.missing.length} to add` +
    (status.extra.length > 0 ? `, ${status.extra.length} to remove` : "");

  const link =
    "underline underline-offset-2 hover:no-underline disabled:no-underline disabled:opacity-60";

  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-md border border-amber-200/70 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
      <KeyRound
        className="mt-0.5 size-[18px] shrink-0 text-amber-700 dark:text-amber-300"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
          <p className="leading-5">
            Your storefront signing keys changed.{" "}
            <span className="text-amber-700/70 dark:text-amber-200/60">
              ({counts})
            </span>
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 sm:ml-auto sm:shrink-0">
            <button
              type="button"
              onClick={() => void sync()}
              disabled={syncing}
              className={`font-medium text-amber-800 hover:text-amber-900 dark:text-amber-200 ${link}`}
            >
              {syncing ? "Publishing…" : "Publish to PDS"}
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className={`text-amber-700/80 hover:text-amber-900 dark:text-amber-200/70 ${link}`}
            >
              Dismiss
            </button>
          </div>
        </div>
        {error ? (
          <p className="mt-1 text-xs text-destructive">
            {error}
            {/\b(scope|auth|unauthorized|forbidden|token)\b/i.test(error)
              ? " — sign out and back in, then retry."
              : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
