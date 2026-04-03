import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "./db";
import { meta } from "./db/schema";
import { createAtprotoRouter } from "./routes/atproto";
import { createCatalogRouter } from "./routes/catalog";
import { createStripeRouter } from "./routes/stripe";

export function createApiRouter(db: Db) {
  const api = new Hono();

  api.get("/health", (c) =>
    c.json({ ok: true, service: "bazaar-server" }),
  );

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

  api.route("/atproto", createAtprotoRouter());
  api.route("/stripe", createStripeRouter(db));
  api.route("/catalog", createCatalogRouter());

  api.notFound((c) => c.json({ error: "not_found" }, 404));

  return api;
}
