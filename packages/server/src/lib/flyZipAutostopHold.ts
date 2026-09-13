import { oauthAppBaseUrl } from "./atproto/oauth-url";

/**
 * Fly Proxy autostop only counts inbound connections through the edge.
 * A zip rebuild is in-process work after the triggering request has
 * already returned, so the proxy sees an idle machine and SIGINT/SIGTERM
 * it (kill_timeout default 5s) — far too short to finish a multi-GB
 * package. This module opens a long-lived SSE request to our own public
 * origin so the proxy keeps the machine in the serving set until the
 * rebuild ends. Localhost / non-Fly is a no-op.
 *
 * The hold token is process-lifetime random; the route rejects anything
 * else so this path cannot be used as a public keep-alive.
 */
export const ZIP_AUTOSTOP_HOLD_PATH = "/api/internal/zip-autostop-hold";
export const ZIP_AUTOSTOP_HOLD_HEADER = "x-bazaar-zip-hold";

const HOLD_TOKEN = crypto.randomUUID();
const PING_MS = 10_000;

let wantHold = false;
let loopRunning = false;
let holdAbort: AbortController | null = null;

export function zipAutostopHoldToken(): string {
  return HOLD_TOKEN;
}

export function isZipAutostopHoldWanted(): boolean {
  return wantHold;
}

function onFly(): boolean {
  return Boolean(process.env.FLY_MACHINE_ID?.trim());
}

/** Call when the first in-flight zip rebuild starts. */
export function ensureZipAutostopHold(): void {
  wantHold = true;
  if (!onFly()) return;
  if (loopRunning) return;
  loopRunning = true;
  void runHoldLoop().finally(() => {
    loopRunning = false;
  });
}

/** Call when the last in-flight zip rebuild finishes. */
export function releaseZipAutostopHold(): void {
  wantHold = false;
  holdAbort?.abort();
}

async function runHoldLoop(): Promise<void> {
  const origin = oauthAppBaseUrl();
  console.log(`zip autostop hold: opening Fly proxy connection via ${origin}`);
  while (wantHold) {
    const ac = new AbortController();
    holdAbort = ac;
    try {
      const res = await fetch(`${origin}${ZIP_AUTOSTOP_HOLD_PATH}`, {
        headers: { [ZIP_AUTOSTOP_HOLD_HEADER]: HOLD_TOKEN },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`hold HTTP ${res.status}`);
      }
      await res.body.pipeTo(
        new WritableStream({ write() {} }),
        { signal: ac.signal },
      );
    } catch (e) {
      if (!wantHold || ac.signal.aborted) break;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("zip autostop hold: lost connection, retrying", msg);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  holdAbort = null;
  console.log("zip autostop hold: released");
}

/** SSE body for the hold route: ping until the caller aborts or the rebuild ends. */
export function zipAutostopHoldStream(requestAbort: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      const ping = () => {
        if (!wantHold || requestAbort.aborted) {
          cleanup();
          return;
        }
        try {
          controller.enqueue(encoder.encode(": hold\n\n"));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        clearInterval(id);
        requestAbort.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      ping();
      const id = setInterval(ping, PING_MS);
      requestAbort.addEventListener("abort", cleanup);
    },
  });
}
