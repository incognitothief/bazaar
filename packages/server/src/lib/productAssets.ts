import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db";
import { catalogProductAssets, inventoryUploadObject } from "../db/schema";
import { r2ConfigFromEnv } from "./r2/env";
import { getR2S3Client } from "./r2/s3Client";

export type CoverImage = { objectId: string; url: string };

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
      out.push({ objectId: row.catalog_product_assets.objectId, url });
    } catch {
      // Best-effort -- skip a single broken image rather than fail the whole read.
    }
  }
  return out;
}
