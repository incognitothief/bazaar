import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Package } from "lucide-react";
import { toast } from "sonner";
import { useZipActivity } from "@/hooks/useZipActivity";
import { rebuildCatalogProductZip } from "@/lib/atproto/records";

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function formatStartedAt(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Merchant-shell activity for the only background job we have today:
 * product download-package rebuilds. Live jobs come from in-process
 * progress; failures are durable (including a crash mid-rebuild, which
 * boot marks failed rather than restarting).
 */
export function PackageZipActivityBanner() {
  const { jobs, failed } = useZipActivity();
  const [retryingUri, setRetryingUri] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (jobs.length === 0) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [jobs.length]);

  if (jobs.length === 0 && failed.length === 0) return null;

  async function onRetry(uri: string) {
    if (retryingUri) return;
    setRetryingUri(uri);
    const ok = await rebuildCatalogProductZip(uri);
    if (!ok) {
      toast.error("Could not start a rebuild");
      setRetryingUri(null);
    }
    // Leave retryingUri set until the next poll moves this uri into jobs
    // or it stays failed; don't block other retries for more than a tick.
    setTimeout(() => setRetryingUri(null), 1500);
  }

  const productHref = (uri: string) =>
    `/merchant/inventory/products?uri=${encodeURIComponent(uri)}`;

  return (
    <div className="mb-3 space-y-2">
      {jobs.map((job) => {
        const startedAt = job.startedAt ?? job.updatedAt;
        return (
          <div
            key={job.uri}
            className="flex items-start gap-2.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
          >
            <Package
              className="mt-0.5 size-[18px] shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="leading-5">
                Packaging{" "}
                <Link
                  to={productHref(job.uri)}
                  className="font-medium underline underline-offset-2"
                >
                  {job.title}
                </Link>
                {job.total > 0
                  ? ` — zipping ${job.current}/${job.total}`
                  : null}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {job.fileName}
              </p>
              {startedAt ? (
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  Started {formatStartedAt(startedAt)} ·{" "}
                  {formatElapsed(now - startedAt)} elapsed
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
      {failed.map((row) => (
        <div
          key={row.uri}
          className="flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <Package
            className="mt-0.5 size-[18px] shrink-0"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="leading-5">
              Download package failed for{" "}
              <Link
                to={productHref(row.uri)}
                className="font-medium underline underline-offset-2"
              >
                {row.title}
              </Link>
              . Customers will get a slower first download until this is
              fixed.
            </p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              <button
                type="button"
                disabled={retryingUri === row.uri}
                onClick={() => void onRetry(row.uri)}
                className="font-medium underline underline-offset-2 hover:no-underline disabled:opacity-60"
              >
                {retryingUri === row.uri ? "Retrying…" : "Retry"}
              </button>
              <Link
                to={productHref(row.uri)}
                className="underline underline-offset-2 hover:no-underline"
              >
                View product
              </Link>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
