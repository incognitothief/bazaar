import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "./db";
import { meta } from "./db/schema";

export function createApiRouter(db: Db) {
  const api = new Hono();

  api.get("/health", (c) =>
    c.json({ ok: true, service: "bazaar-server" }),
  );

  api.get("/meta/:key", async (c) => {
    const key = c.req.param("key");
    const row = await db.select().from(meta).where(eq(meta.key, key)).get();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ key: row.key, value: row.value, updatedAt: row.updatedAt });
  });

  api.notFound((c) => c.json({ error: "not_found" }, 404));

  return api;
}
