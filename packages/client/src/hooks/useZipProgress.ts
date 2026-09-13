import { useEffect, useRef, useState } from "react";
import { getZipProgress, type ZipProgress } from "@/lib/atproto/records";

/**
 * Polls live "zipping item N of M" progress for a product while `active`
 * is true (a save/publish request is in flight), so the merchant UI can
 * show real per-item status instead of just an elapsed-time counter. Polls
 * rather than streams the save/publish response itself: those requests
 * already pass through a Cloudflare tunnel and Fly's own proxy, both of
 * which can buffer a chunked response and silently defeat a "live" stream --
 * a plain poll is a complete request/response each time, immune to that.
 * Null while there's no product yet (still in the pre-zip PDS-write phase)
 * or nothing in progress.
 */
export function useZipProgress(
  productUri: string | null,
  active: boolean,
): ZipProgress | null {
  const [progress, setProgress] = useState<ZipProgress | null>(null);
  const uriRef = useRef(productUri);
  uriRef.current = productUri;

  useEffect(() => {
    if (!active || !productUri) {
      setProgress(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const p = await getZipProgress(productUri);
        if (!cancelled && uriRef.current === productUri) setProgress(p);
      } catch {
        // Best-effort visibility only -- a failed poll just means the next
        // tick tries again; it never affects the actual save/publish request.
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 700);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, productUri]);

  return active ? progress : null;
}
