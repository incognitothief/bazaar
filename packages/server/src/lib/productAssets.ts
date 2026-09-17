import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db";
import {
  catalogItems,
  catalogProducts,
  catalogProductAssets,
  inventoryUploadObject,
} from "../db/schema";
import { col } from "@bazaar/shared";
import { r2ConfigFromEnv } from "./r2/env";
import { getR2S3Client } from "./r2/s3Client";

export type CoverImage = { id: string; objectId: string; url: string };

/**
 * Presigned URLs for a product's cover art, in slideshow order (position).
 * A product can have any number of "coverArt" rows -- the UI decides
 * single-image vs. slideshow (see productTypes.ts on the client), the data
 * model doesn't care. Best-effort: R2 misconfiguration or a missing object
 * just yields fewer images, never an error -- cover art is decorative, not
 * load-bearing.
 */
export async function resolveCoverImages(
  db: Db,
  productUri: string,
): Promise<CoverImage[]> {
  const r2 = r2ConfigFromEnv();
  if (!r2.ok) return [];
  const client = getR2S3Client(r2);

  const rows = db
    .select()
    .from(catalogProductAssets)
    .innerJoin(
      inventoryUploadObject,
      eq(catalogProductAssets.objectId, inventoryUploadObject.id),
    )
    .where(
      and(
        eq(catalogProductAssets.productUri, productUri),
        eq(catalogProductAssets.role, "coverArt"),
        eq(inventoryUploadObject.status, "completed"),
      ),
    )
    .orderBy(asc(catalogProductAssets.position))
    .all();

  const out: CoverImage[] = [];
  for (const row of rows) {
    try {
      // Storefront/dashboard display prefers the webp derivative when one
      // exists; the download package (merchant.ts) never reads this column,
      // it always serves r2Key -- see webpDerivative.ts.
      const key = row.inventory_upload_object.webpR2Key ?? row.inventory_upload_object.r2Key;
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: r2.bucket,
          Key: key,
        }),
        { expiresIn: 3600 },
      );
      out.push({
        id: row.catalog_product_assets.id,
        objectId: row.catalog_product_assets.objectId,
        url,
      });
    } catch {
      // Best-effort -- skip a single broken image rather than fail the whole read.
    }
  }
  return out;
}

/** One cover-art object in R2, addressed by key rather than by a presigned URL. */
export type CoverArtObject = { key: string; contentType: string | null };

/**
 * The R2 key of a product's first cover image, for serving through our own
 * origin (see catalog.ts's GET /cover/:rkey).
 *
 * Deliberately NOT `resolveCoverImages`: that returns presigned URLs which
 * expire in an hour and carry their signature in the query string. Those are
 * right for the SPA, which re-resolves them on every load, and wrong for an
 * og:image — unfurlers cache the URL for days and would re-fetch a dead link,
 * and a URL that changes every render defeats their cache entirely.
 *
 * Prefers the webp derivative for the same reason the storefront does: it is
 * resized to at most 1600px (webpDerivative.ts), so it is the right shape for
 * a link preview. Falls back to the original when no derivative was produced.
 */
export function resolveCoverArtObject(
  db: Db,
  productUri: string,
): CoverArtObject | null {
  const row = db
    .select()
    .from(catalogProductAssets)
    .innerJoin(
      inventoryUploadObject,
      eq(catalogProductAssets.objectId, inventoryUploadObject.id),
    )
    .where(
      and(
        eq(catalogProductAssets.productUri, productUri),
        eq(catalogProductAssets.role, "coverArt"),
        eq(inventoryUploadObject.status, "completed"),
      ),
    )
    .orderBy(asc(catalogProductAssets.position))
    .get();
  if (!row) return null;
  const obj = row.inventory_upload_object;
  const webp = obj.webpR2Key;
  return webp
    ? { key: webp, contentType: "image/webp" }
    : { key: obj.r2Key, contentType: obj.contentType ?? null };
}

/**
 * The product whose cover art an `/item/:rkey` page should display, looked up
 * locally from the ERP rows.
 *
 * Shared by the og:image builder (lib/spaHtmlMeta.ts) and the endpoint that
 * serves the bytes (routes/catalog.ts) so the two cannot disagree about
 * whether a page has art -- a mismatch would mean advertising an image URL
 * that 404s, or falling back to the site image when real art exists.
 *
 * A single carries no cover art of its own; it borrows the owning product's,
 * the same way GET /items does.
 */
export function resolveCoverProductUri(
  db: Db,
  merchantDid: string,
  rkey: string,
): string | null {
  if (!merchantDid.startsWith("did:") || !rkey) return null;

  const productUri = `at://${merchantDid}/${col("catalog.product")}/${rkey}`;
  const product = db
    .select()
    .from(catalogProducts)
    .where(eq(catalogProducts.uri, productUri))
    .get();
  if (product) return product.uri;

  const itemUri = `at://${merchantDid}/${col("catalog.item")}/${rkey}`;
  const item = db
    .select()
    .from(catalogItems)
    .where(eq(catalogItems.uri, itemUri))
    .get();
  if (!item) return null;

  const owned = db
    .select()
    .from(catalogProducts)
    .where(eq(catalogProducts.merchantDid, item.merchantDid))
    .all();
  for (const p of owned) {
    const refs = JSON.parse(p.items) as Array<{ uri: string }>;
    if (refs.some((ref) => ref.uri === itemUri)) return p.uri;
  }
  return null;
}
