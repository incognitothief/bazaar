import { useEffect, useState } from "react";
import type { Agent } from "@atproto/api";
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

  useEffect(() => {
    if (!cid) {
      logArtwork("skip: no cid");
      return;
    }
    let blobUrl: string | null = null;
    let cancelled = false;
    const catalogItemUri = itemUri?.trim();

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
              return;
            }
            logArtwork("inventory-public: 200 but no url in JSON", { keys: Object.keys(j) });
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
            } else {
              logArtwork("legacy: getBlob miss or cancelled", { cancelled });
            }
          } else {
            logArtwork("done: no image (inventory error did not allow PDS blob)");
          }
          return;
        } catch (e) {
          logArtwork("inventory-public: fetch threw (no PDS fallback)", {
            message: e instanceof Error ? e.message : String(e),
          });
          return;
        }
      }

      logArtwork("no itemUri: PDS getBlob only", { did, cidPrefix: cid.slice(0, 20) + "…" });
      blobUrl = await fetchBlobObjectUrl(agent, did, cid);
      if (!cancelled && blobUrl) {
        logArtwork("getBlob ok (object URL set)");
        setSrc(blobUrl);
      } else {
        logArtwork("getBlob miss or cancelled", { cancelled });
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [agent, did, cid, itemUri]);

  if (!cid || !src) {
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

  return (
    <img src={src} alt={alt} className={cn("object-cover", className)} />
  );
}
