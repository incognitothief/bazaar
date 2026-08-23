import { GetObjectCommand } from "@aws-sdk/client-s3";
import { zipSync } from "fflate";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { catalogItems, catalogProductAssets, inventoryUploadObject } from "../db/schema";
import { sanitizeInventoryFilename } from "./r2/inventoryKey";
import { getR2S3Client } from "./r2/s3Client";
import type { r2ConfigFromEnv } from "./r2/env";

const MAX_PRODUCT_ZIP_TOTAL_BYTES = 250 * 1024 * 1024;

type CatalogProductRow = typeof import("../db/schema").catalogProducts.$inferSelect;

/**
 * Assembles a product's download package: its items' master files plus the
 * generic included-assets bin (cover art only if artIncludedInDownload).
 * Shared by the merchant incident-response tool (no entitlement check, just
 * ownership) and the buyer-facing download route (entitlement-checked) --
 * same package either way, only the caller's access check differs. Always
 * reads inventoryUploadObject.r2Key, never webpR2Key -- the download is the
 * original file, the webp derivative is display-only.
 */
export async function buildProductZip(
  db: Db,
  r2: Extract<ReturnType<typeof r2ConfigFromEnv>, { ok: true }>,
  product: CatalogProductRow,
): Promise<Response | { error: string; status: 400 | 413 }> {
  const client = getR2S3Client(r2);

  const itemRefs = JSON.parse(product.items) as Array<{ uri: string }>;
  const itemUris = itemRefs.map((ref) => ref.uri);
  const itemRows = itemUris.length
    ? db.select().from(catalogItems).where(inArray(catalogItems.uri, itemUris)).all()
    : [];

  const assetRows = db
    .select()
    .from(catalogProductAssets)
    .where(eq(catalogProductAssets.productUri, product.uri))
    .all();
  const includedAssetRows = assetRows.filter(
    (a) => a.role !== "coverArt" || product.artIncludedInDownload,
  );

  const toFetch: Array<{ objectId: string; label: string }> = [
    ...itemRows
      .filter((row): row is typeof row & { objectId: string } => !!row.objectId)
      .map((row) => ({ objectId: row.objectId, label: row.title })),
    ...includedAssetRows.map((a) => ({ objectId: a.objectId, label: a.role })),
  ];

  const zipEntries: Record<string, Uint8Array> = {};
  let total = 0;
  let index = 0;
  for (const { objectId, label } of toFetch) {
    const obj = db
      .select()
      .from(inventoryUploadObject)
      .where(eq(inventoryUploadObject.id, objectId))
      .get();
    if (!obj || obj.status !== "completed") continue;
    let got;
    try {
      got = await client.send(new GetObjectCommand({ Bucket: r2.bucket, Key: obj.r2Key }));
    } catch (e) {
      console.warn("product zip: skip object", objectId, e);
      continue;
    }
    if (!got.Body) continue;
    const buf = await got.Body.transformToByteArray();
    total += buf.byteLength;
    if (total > MAX_PRODUCT_ZIP_TOTAL_BYTES) {
      return { error: "package_too_large", status: 413 };
    }
    const ext = obj.fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
    const safeBase = sanitizeInventoryFilename(
      label.replace(/\.[^./\\]+$/, "") || `file_${index}`,
    );
    zipEntries[`${String(++index).padStart(2, "0")}_${safeBase}${ext}`] = new Uint8Array(buf);
  }

  if (Object.keys(zipEntries).length === 0) {
    return { error: "no_downloadable_files", status: 400 };
  }

  const zipped = zipSync(zipEntries, { level: 6 });
  const titleSafe = sanitizeInventoryFilename(product.title || "product");
  return new Response(new Uint8Array(zipped), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${titleSafe}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
