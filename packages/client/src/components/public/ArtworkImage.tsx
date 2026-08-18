import { useEffect, useState } from "react";
import type { Agent } from "@atproto/api";
import artworkLoadingUrl from "@/assets/artwork-loading-combined.svg?url";
import { createBrowserApiURL } from "@/lib/browserApi";
import { fetchBlobObjectUrl } from "@/lib/atproto/blobUrl";
import { cn } from "@/lib/utils";

/**
 * Errors where trying PDS `getBlob` might still help (legacy blob-backed artwork).
 * Not used for `artwork_not_in_r2` / `no_active_listing` — those CIDs are not repo blobs.
 */
const INVENTORY_ERRORS_ALLOW_PDS_BLOB = new Set(["missing_rkey"]);

function logArtwork(step: string, detail?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  if (detail && Object.keys(detail).length > 0) {
    console.log(`[ArtworkImage] ${step}`, detail);
  } else {
    console.log(`[ArtworkImage] ${step}`);
  }
}

type LoadPhase = "missing" | "loading" | "ready";

function ArtworkLoadingSkeleton({ className }: { className?: string }) {
  return (
    <>
      <span className="sr-only">Loading artwork</span>
      <div
        className={cn(
          "flex h-full w-full min-h-0 items-center justify-center bg-muted p-4",
          className,
        )}
        role="status"
        aria-busy="true"
        aria-label="Loading artwork"
      >
        <img
          src={artworkLoadingUrl}
          alt=""
          className="max-h-full max-w-full object-contain animate-pulse"
          draggable={false}
          decoding="async"
        />
      </div>
    </>
  );
}

export function ArtworkImage({
  agent,
  did,
  cid,
  itemUri,
  alt,
  className,
}: {
  agent: Agent;
  did: string;
  cid: string | undefined;
  /** Catalog AT-URI: load cover from R2 (inventory); optional legacy PDS blob fallback. */
  itemUri?: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [phase, setPhase] = useState<LoadPhase>(() => (cid ? "loading" : "missing"));

  useEffect(() => {
    if (!cid) {
      logArtwork("skip: no cid");
      setSrc(null);
      setPhase("missing");
      return;
    }
    let blobUrl: string | null = null;
    let cancelled = false;
    const catalogItemUri = itemUri?.trim();

    setSrc(null);
    setPhase("loading");

    void (async () => {
      logArtwork("start", {
        cid: cid.slice(0, 24) + (cid.length > 24 ? "…" : ""),
        hasItemUri: Boolean(catalogItemUri),
        itemUri: catalogItemUri ?? null,
      });

      if (catalogItemUri) {
        try {
          const u = createBrowserApiURL("/api/inventory-public/artwork-url");
          u.searchParams.set("itemUri", catalogItemUri);
          logArtwork("inventory-public: request", { url: u.href });
          const r = await fetch(u.href);
          logArtwork("inventory-public: response", {
            status: r.status,
            ok: r.ok,
          });
          if (r.ok) {
            const j = (await r.json()) as { url?: string };
            if (j.url && !cancelled) {
              logArtwork("inventory-public: using presigned URL", {
                urlPrefix: j.url.slice(0, 48) + "…",
              });
              setSrc(j.url);
              setPhase("ready");
              return;
            }
            logArtwork("inventory-public: 200 but no url in JSON", {
              keys: Object.keys(j),
            });
            if (!cancelled) setPhase("missing");
            return;
          }

          let allowLegacyPdsBlob = false;
          let errBody: { error?: string } | null = null;
          try {
            errBody = (await r.json()) as { error?: string };
            if (errBody.error && INVENTORY_ERRORS_ALLOW_PDS_BLOB.has(errBody.error)) {
              allowLegacyPdsBlob = true;
            }
            logArtwork("inventory-public: error body", {
              error: errBody.error ?? null,
              allowLegacyPdsBlob,
            });
          } catch {
            logArtwork("inventory-public: error body not JSON; skip PDS blob");
          }

          if (allowLegacyPdsBlob) {
            logArtwork("legacy: getBlob fallback", { did, cidPrefix: cid.slice(0, 20) + "…" });
            blobUrl = await fetchBlobObjectUrl(agent, did, cid);
            if (!cancelled && blobUrl) {
              logArtwork("legacy: getBlob ok (object URL set)");
              setSrc(blobUrl);
              setPhase("ready");
            } else {
              logArtwork("legacy: getBlob miss or cancelled", { cancelled });
              if (!cancelled) setPhase("missing");
            }
          } else {
            logArtwork("done: no image (inventory error did not allow PDS blob)");
            if (!cancelled) setPhase("missing");
          }
          return;
        } catch (e) {
          logArtwork("inventory-public: fetch threw (no PDS fallback)", {
            message: e instanceof Error ? e.message : String(e),
          });
          if (!cancelled) setPhase("missing");
          return;
        }
      }

      logArtwork("no itemUri: PDS getBlob only", { did, cidPrefix: cid.slice(0, 20) + "…" });
      blobUrl = await fetchBlobObjectUrl(agent, did, cid);
      if (!cancelled && blobUrl) {
        logArtwork("getBlob ok (object URL set)");
        setSrc(blobUrl);
        setPhase("ready");
      } else {
        logArtwork("getBlob miss or cancelled", { cancelled });
        if (!cancelled) setPhase("missing");
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [agent, did, cid, itemUri]);

  if (phase === "ready" && src) {
    return (
      <img src={src} alt={alt} className={cn("object-cover", className)} />
    );
  }

  if (phase === "loading") {
    return <ArtworkLoadingSkeleton className={className} />;
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center bg-muted text-muted-foreground",
        className,
      )}
      aria-hidden
    >
      No artwork
    </div>
  );
}
