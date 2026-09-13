import { useEffect, useState } from "react";
import {
  listZipActivity,
  type ZipActivity,
} from "@/lib/atproto/records";

const EMPTY: ZipActivity = { jobs: [], failed: [] };

/**
 * Polls every in-flight package rebuild plus durable failures for the
 * merchant-shell banner. Same 700ms poll as useZipProgress — a complete
 * request each tick, not a stream that a proxy might buffer.
 */
export function useZipActivity(): ZipActivity {
  const [activity, setActivity] = useState<ZipActivity>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await listZipActivity();
        if (!cancelled) setActivity(next);
      } catch {
        // Best-effort visibility — a failed poll just waits for the next tick.
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 700);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return activity;
}
