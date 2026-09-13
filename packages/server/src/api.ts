import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "./db";
import { meta } from "./db/schema";
import { getEffectiveBusinessProfile } from "./lib/businessProfile";
import { createAtprotoRouter } from "./routes/atproto";
import { createCatalogRouter } from "./routes/catalog";
import { createDownloadRouter } from "./routes/download";
import {
  ZIP_AUTOSTOP_HOLD_HEADER,
  zipAutostopHoldStream,
  zipAutostopHoldToken,
} from "./lib/flyZipAutostopHold";
import { createIdentifiersRouter } from "./routes/identifiers";
import { createInventoryRouter } from "./routes/inventory";
import { createInventoryPublicRouter } from "./routes/inventoryPublic";
import { createLicensesRouter } from "./routes/licenses";
import { createMerchantRouter } from "./routes/merchant";
import { createStripeRouter } from "./routes/stripe";
import type { OAuthClient } from "./lib/atproto/oauth";

export function createApiRouter(db: Db, oauthClient: OAuthClient) {
  const api = new Hono();

  api.get("/health", (c) =>
    c.json({ ok: true, service: "bazaar-server" }),
  );

  /**
   * Opened by flyZipAutostopHold against this process's public origin so
   * Fly Proxy sees an inbound connection while a zip rebuild is in flight.
   * Token is process-lifetime; not a merchant route.
   */
  api.get("/internal/zip-autostop-hold", (c) => {
    if (c.req.header(ZIP_AUTOSTOP_HOLD_HEADER) !== zipAutostopHoldToken()) {
      return c.json({ error: "forbidden" }, 403);
    }
    return new Response(zipAutostopHoldStream(c.req.raw.signal), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  });

  api.get("/meta/:key", async (c) => {
    const key = c.req.param("key");
    const row = await db.select().from(meta).where(eq(meta.key, key)).get();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({
      key: row.key,
      value: row.value,
      updatedAt: row.updatedAt,
    });
  });

  /** Public KYC / legal: merged BUSINESS_* env + SQLite (no auth). */
  api.get("/business-profile", (c) => {
    const p = getEffectiveBusinessProfile(db);
    return c.json({
      businessName: p.businessName,
      businessState: p.businessState,
      businessEmail: p.businessEmail,
    });
  });

  api.route("/atproto", createAtprotoRouter(db, oauthClient));
  api.route("/stripe", createStripeRouter(db, oauthClient));
  api.route("/catalog", createCatalogRouter(db));
  api.route("/merchant", createMerchantRouter(db));
  api.route("/identifiers", createIdentifiersRouter(oauthClient));
  api.route("/inventory", createInventoryRouter(db, oauthClient));
  api.route("/inventory-public", createInventoryPublicRouter());
  api.route("/licenses", createLicensesRouter(db));
  api.route("/download", createDownloadRouter(db, oauthClient));

  api.notFound((c) => c.json({ error: "not_found" }, 404));

  return api;
}
