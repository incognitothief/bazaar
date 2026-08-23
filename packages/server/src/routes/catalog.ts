import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { AtUri } from "@atproto/syntax";
import type { Db } from "../db";
import { catalogItems, catalogProducts, inventoryUploadObject } from "../db/schema";
import { getAgentForDid } from "../lib/atproto/resolvePds";
import { resolveCoverImages } from "../lib/productAssets";

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
    /** Audio duration lives on the upload object (ERP-only, never on the PDS record) -- same "resolve alongside the ERP row" pattern as a product's coverImages. */
    const durationMs = row.objectId
      ? ((
          await db
            .select({ durationMs: inventoryUploadObject.durationMs })
            .from(inventoryUploadObject)
            .where(eq(inventoryUploadObject.id, row.objectId))
            .get()
        )?.durationMs ?? null)
      : null;
    /**
     * An item has no cover art of its own -- it lives on the owning
     * product (catalogProductAssets). Find that product by scanning the
     * seller's products for one whose items[] contains this item's uri
     * (same lookup merchant.ts's GET /catalog/items list uses), and reuse
     * its already-resolved cover images. A standalone single still gets
     * the album/product art this way.
     */
    let coverImages: Awaited<ReturnType<typeof resolveCoverImages>> = [];
    const sellerProducts = await db
      .select()
      .from(catalogProducts)
      .where(eq(catalogProducts.sellerDid, row.sellerDid))
      .all();
    for (const p of sellerProducts) {
      const refs = JSON.parse(p.items) as Array<{ uri: string }>;
      if (refs.some((ref) => ref.uri === uri)) {
        coverImages = await resolveCoverImages(db, p.uri);
        break;
      }
    }
    return c.json({ item: { ...row, durationMs, coverImages } });
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
    const coverImages = await resolveCoverImages(db, uri);
    return c.json({
      product: { ...row, items: JSON.parse(row.items) as unknown, coverImages },
    });
  });

  return r;
}
