import { useEffect, useState } from "react";
import type { Agent } from "@atproto/api";
import { browserApiUrl } from "@/lib/browserApi";
import { fetchBlobObjectUrl } from "@/lib/atproto/blobUrl";
import { cn } from "@/lib/utils";

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
  /** When set, try R2 presign for inventory artwork (active listing) before PDS blob. */
  itemUri?: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!cid) return;
    let blobUrl: string | null = null;
    let cancelled = false;
    void (async () => {
      if (itemUri) {
        try {
          const u = new URL(browserApiUrl("/api/inventory-public/artwork-url"));
          u.searchParams.set("itemUri", itemUri);
          const r = await fetch(u.toString());
          if (r.ok) {
            const j = (await r.json()) as { url?: string };
            if (j.url && !cancelled) {
              setSrc(j.url);
              return;
            }
          }
        } catch {
          /* fall through to blob */
        }
      }
      blobUrl = await fetchBlobObjectUrl(agent, did, cid);
      if (!cancelled && blobUrl) setSrc(blobUrl);
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
