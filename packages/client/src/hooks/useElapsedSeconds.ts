import { useEffect, useRef, useState } from "react";

/**
 * Whole seconds elapsed since `active` most recently became true; resets to
 * 0 whenever it's false. For surfacing "this is taking a while" during a
 * long synchronous request (e.g. a merchant save that rebuilds the product's
 * download package) where there's no real progress percentage to report --
 * an honest elapsed-time counter instead of a fake progress bar.
 */
export function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      startRef.current = null;
      return;
    }
    startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  return elapsed;
}
