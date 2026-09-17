import { GetObjectCommand } from "@aws-sdk/client-s3";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { AtUri } from "@atproto/syntax";
import type { Db } from "../db";
import { catalogItems, catalogProducts, inventoryUploadObject } from "../db/schema";
import { getAgentForDid } from "../lib/atproto/resolvePds";
import {
  resolveCoverArtObject,
  resolveCoverImages,
  resolveCoverProductUri,
} from "../lib/productAssets";
import { r2ConfigFromEnv } from "../lib/r2/env";
import { getR2S3Client } from "../lib/r2/s3Client";

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
     * type it doesn't apply to, or for an upload predating the capture.
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
     * merchant's products for one whose items[] contains this item's uri
     * (same lookup merchant.ts's GET /catalog/items list uses), and reuse
     * its already-resolved cover images. A standalone single still gets
     * the album/product art this way.
     */
    let coverImages: Awaited<ReturnType<typeof resolveCoverImages>> = [];
    const merchantProducts = await db
      .select()
      .from(catalogProducts)
      .where(eq(catalogProducts.merchantDid, row.merchantDid))
      .all();
    for (const p of merchantProducts) {
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

  /**
   * Public cover art for an /item/:rkey page, proxied from R2 through this
   * origin. This is what `og:image` points at (lib/spaHtmlMeta.ts).
   *
   * Unauthenticated by design: link unfurlers have no session. It exposes only
   * cover art -- a `catalogProductAssets` row whose role is "coverArt" -- and
   * never reaches an inventory object by key, so it cannot serve the goods the
   * store is selling.
   *
   * Proxying rather than redirecting to a presigned URL is deliberate: some
   * unfurlers cache the redirect *target*, which would expire in an hour and
   * reintroduce the broken-image problem this endpoint exists to fix.
   */
  r.get("/cover/:rkey", async (c) => {
    const rkey = c.req.param("rkey");
    const merchantDid = process.env.MERCHANT_DID?.trim() ?? "";
    if (!rkey || !merchantDid.startsWith("did:")) {
      return c.json({ error: "not_found" }, 404);
    }

    // Local ERP lookup, shared with the og:image builder so the two agree.
    // The PDS probe spaHtmlMeta uses for titles would add a network round trip
    // to every image fetch.
    const coverProductUri = resolveCoverProductUri(db, merchantDid, rkey);
    if (!coverProductUri) return c.json({ error: "not_found" }, 404);

    const asset = resolveCoverArtObject(db, coverProductUri);
    if (!asset) return c.json({ error: "not_found" }, 404);

    const r2 = r2ConfigFromEnv();
    if (!r2.ok) return c.json({ error: "not_found" }, 404);

    const inm = c.req.header("if-none-match");
    try {
      const obj = await getR2S3Client(r2).send(
        new GetObjectCommand({
          Bucket: r2.bucket,
          Key: asset.key,
          ...(inm ? { IfNoneMatch: inm } : {}),
        }),
      );
      if (!obj.Body) return c.json({ error: "not_found" }, 404);
      const headers: Record<string, string> = {
        "Content-Type": obj.ContentType ?? asset.contentType ?? "image/webp",
        // Cover art can be replaced for a given rkey, so this is revalidated
        // rather than immutable; the ETag makes that revalidation cheap.
        "Cache-Control": "public, max-age=3600",
      };
      if (obj.ETag) headers.ETag = obj.ETag;
      if (obj.ContentLength != null) {
        headers["Content-Length"] = String(obj.ContentLength);
      }
      return new Response(obj.Body.transformToWebStream(), { headers });
    } catch (err) {
      // R2 answers a matching IfNoneMatch with 304, which the SDK raises.
      const status = (err as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (status === 304) {
        return new Response(null, {
          status: 304,
          headers: inm ? { ETag: inm, "Cache-Control": "public, max-age=3600" } : {},
        });
      }
      console.error("cover art fetch failed", asset.key, err);
      return c.json({ error: "not_found" }, 404);
    }
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
     *   null when no member has a known size (all predate byte-size capture).
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
