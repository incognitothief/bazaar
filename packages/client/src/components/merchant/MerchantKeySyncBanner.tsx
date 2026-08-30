import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMerchantKeySync } from "@/hooks/useMerchantKeySync";

/**
 * Shown across the merchant panel when the storefront's signing-key history has
 * changed and the merchant's PDS `actor.merchantKeys` mirror is out of step.
 * One click writes the mirror using the merchant's live session. See ADR 0014.
 */
export function MerchantKeySyncBanner() {
  const { status, syncing, error, sync } = useMerchantKeySync();

  // Render only on confirmed drift. `null` (unconfigured / PDS unreachable) and
  // `true` (in sync) show nothing.
  if (!status || status.inSync !== false) return null;

  const changed = status.missing.length + status.extra.length;

  return (
    <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">Your storefront signing keys have changed</p>
          <p className="text-amber-800 dark:text-amber-200/90">
            Synchronize your storefront profile so buyers can still verify older
            purchases from your repo.{" "}
            {changed > 0 ? (
              <span className="text-amber-700 dark:text-amber-200/70">
                ({status.missing.length} to add
                {status.extra.length > 0
                  ? `, ${status.extra.length} to remove`
                  : ""}
                )
              </span>
            ) : null}
          </p>
          {error ? (
            <p className="text-destructive">
              {error}
              {/\b(scope|auth|unauthorized|forbidden|token)\b/i.test(error)
                ? " — sign out and back in to grant the new permission, then retry."
                : ""}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void sync()}
          disabled={syncing}
          className="shrink-0"
        >
          {syncing ? (
            <>
              <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
              Synchronizing…
            </>
          ) : (
            <>
              <Check className="mr-1.5 size-3.5" />
              Synchronize
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
