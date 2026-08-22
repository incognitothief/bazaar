import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { AtUri } from "@atproto/syntax";
import type { Db } from "../db";
import { catalogItems, catalogProducts } from "../db/schema";
import { getAgentForDid } from "../lib/atproto/resolvePds";

/** Optional public resolver for storefront / API consumers */
export function createCatalogRouter(db: Db) {
  const r = new Hono();

  r.get("/record", async (c) => {
    const uri = c.req.query("uri");
    if (!uri) return c.json({ error: "uri required" }, 400);
    try {
      const at = new AtUri(uri);
      const agent = await getAgentForDid(at.hostname);
      const res = await agent.com.atproto.repo.getRecord({
        repo: at.hostname,
        collection: at.collection,
        rkey: at.rkey,
      });
      return c.json({ uri, cid: res.data.cid, value: res.data.value });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  });

  /**
   * ERP-first public reads for catalog.item/catalog.product -- served from
   * catalog_items/catalog_products, never the PDS. The PDS is consulted at
   * checkout time (pinned-CID check) and via the merchant's manual "Sync
   * with PDS" action, not on every storefront page load.
   */
  r.get("/items", async (c) => {
    const uri = c.req.query("uri");
    if (!uri) return c.json({ error: "uri required" }, 400);
    const row = await db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.uri, uri))
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ item: row });
  });

  r.get("/products", async (c) => {
    const uri = c.req.query("uri");
    if (!uri) return c.json({ error: "uri required" }, 400);
    const row = await db
      .select()
      .from(catalogProducts)
      .where(eq(catalogProducts.uri, uri))
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({
      product: { ...row, items: JSON.parse(row.items) as unknown },
    });
  });

  return r;
}
