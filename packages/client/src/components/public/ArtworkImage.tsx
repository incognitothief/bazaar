import { useEffect, useState } from "react";
import type { Agent } from "@atproto/api";
import { fetchBlobObjectUrl } from "@/lib/atproto/blobUrl";
import { cn } from "@/lib/utils";

export function ArtworkImage({
  agent,
  did,
  cid,
  alt,
  className,
}: {
  agent: Agent;
  did: string;
  cid: string | undefined;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!cid) return;
    let url: string | null = null;
    let cancelled = false;
    void (async () => {
      url = await fetchBlobObjectUrl(agent, did, cid);
      if (!cancelled && url) setSrc(url);
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [agent, did, cid]);

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
