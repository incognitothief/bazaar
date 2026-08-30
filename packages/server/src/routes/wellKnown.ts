import { Hono } from "hono";
import { loadServiceDidDocument } from "../lib/serviceDidDocument";

/**
 * Built once on first request (not at import) so a malformed `APP_MERCHANT_KEY_HISTORY`
 * surfaces through `reconcileMerchantKeys()` at boot with a clear message, not as an
 * import-time stack trace. The env is the source of truth and changes only on redeploy,
 * so a single cached build is correct.
 */
let cached: string | null = null;

export const wellKnown = new Hono();

wellKnown.get("/did.json", (c) => {
  if (cached === null) cached = JSON.stringify(loadServiceDidDocument());
  return c.body(cached, 200, {
    "Content-Type": "application/did+ld+json",
    "Cache-Control": "public, max-age=3600",
  });
});
