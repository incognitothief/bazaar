import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { AtUri } from "@atproto/syntax";
import type { Db } from "../db";
import { catalogItems, catalogProducts, inventoryUploadObject } from "../db/schema";
import { getAgentForDid } from "../lib/atproto/resolvePds";
import { resolveCoverImages } from "../lib/productAssets";

/** Extensionless format tokens that count as audio for a product's track count. */
const AUDIO_FORMATS = new Set([
  "flac",
  "wav",
  "wave",
  "mp3",
  "aac",
  "m4a",
  "ogg",
  "oga",
  "opus",
  "aiff",
  "aif",
  "alac",
  "wma",
]);

/** A product member is a "track" if its file is audio, by MIME or by format token. */
function isAudioMember(
  format: string | null,
  contentType: string | null | undefined,
): boolean {
  if (contentType?.toLowerCase().startsWith("audio/")) return true;
  const token = format?.trim().toLowerCase().split(/[-_ /]/)[0];
  return !!token && AUDIO_FORMATS.has(token);
}

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
    /**
     * Runtime / byte size / pixel dimensions live on the upload object
     * (ERP-only, never on the PDS record) -- same "resolve alongside the ERP
     * row" pattern as a product's coverImages. Any of them is null for a file
     * type it doesn't apply to, or for a legacy upload predating the capture.
     */
    const media = row.objectId
      ? await db
          .select({
            durationMs: inventoryUploadObject.durationMs,
            byteSize: inventoryUploadObject.byteSize,
            mediaWidth: inventoryUploadObject.mediaWidth,
            mediaHeight: inventoryUploadObject.mediaHeight,
          })
          .from(inventoryUploadObject)
          .where(eq(inventoryUploadObject.id, row.objectId))
          .get()
      : null;
    const durationMs = media?.durationMs ?? null;
    const byteSize = media?.byteSize ?? null;
    const mediaWidth = media?.mediaWidth ?? null;
    const mediaHeight = media?.mediaHeight ?? null;
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
    const tags = row.tags ? (JSON.parse(row.tags) as string[]) : null;
    return c.json({
      item: {
        ...row,
        tags,
        durationMs,
        byteSize,
        mediaWidth,
        mediaHeight,
        coverImages,
      },
    });
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
    const tags = row.tags ? (JSON.parse(row.tags) as string[]) : null;
    const itemRefs = JSON.parse(row.items) as Array<{ uri: string }>;

    /**
     * Computed on read so they always reflect the current item set (ERP-only,
     * never on the PDS record):
     * - totalBytes: sum of member master-file sizes (companion assets excluded);
     *   null when no member has a known size (all legacy uploads).
     * - trackCount: how many members are audio -- the storefront card shows this
     *   for a music release, and items.length for anything else.
     */
    let totalBytes: number | null = null;
    let trackCount = 0;
    if (itemRefs.length) {
      const itemUris = itemRefs.map((r) => r.uri);
      const members = await db
        .select({
          objectId: catalogItems.objectId,
          format: catalogItems.format,
        })
        .from(catalogItems)
        .where(inArray(catalogItems.uri, itemUris))
        .all();
      const objectIds = members
        .map((m) => m.objectId)
        .filter((id): id is string => !!id);
      const objectInfo = objectIds.length
        ? await db
            .select({
              id: inventoryUploadObject.id,
              byteSize: inventoryUploadObject.byteSize,
              contentType: inventoryUploadObject.contentType,
            })
            .from(inventoryUploadObject)
            .where(inArray(inventoryUploadObject.id, objectIds))
            .all()
        : [];
      const infoById = new Map(objectInfo.map((o) => [o.id, o]));
      for (const m of members) {
        const info = m.objectId ? infoById.get(m.objectId) : undefined;
        if (typeof info?.byteSize === "number") {
          totalBytes = (totalBytes ?? 0) + info.byteSize;
        }
        if (isAudioMember(m.format, info?.contentType)) trackCount += 1;
      }
    }

    return c.json({
      product: {
        ...row,
        items: itemRefs as unknown,
        tags,
        totalBytes,
        trackCount,
        coverImages,
      },
    });
  });

  return r;
}
