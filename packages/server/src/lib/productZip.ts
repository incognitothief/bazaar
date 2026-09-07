import { GetObjectCommand } from "@aws-sdk/client-s3";
import { zipSync } from "fflate";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { catalogItems, catalogProductAssets, inventoryUploadObject } from "../db/schema";
import { getR2S3Client } from "./r2/s3Client";
import type { r2ConfigFromEnv } from "./r2/env";

const MAX_PRODUCT_ZIP_TOTAL_BYTES = 250 * 1024 * 1024;

/**
 * Only fixes characters that would actually break a zip entry / filesystem
 * path ("/" and "\" would create unintended subfolders, control characters
 * aren't valid in most filesystems) -- everything else in the original
 * upload filename (spaces, punctuation, accents, emoji, ...) passes through
 * unchanged. Deliberately NOT sanitizeInventoryFilename: that function's
 * whole-name-to-"file" fallback on any disallowed character is correct for
 * R2 storage keys (recomputed deterministically forever, never shown to a
 * buyer) but wrong here -- it would silently discard real filenames instead
 * of just neutralizing the handful of characters that are actually unsafe.
 */
function safeZipEntryName(name: string): string {
  // eslint-disable-next-line no-control-regex -- stripping literal control chars is the point
  const cleaned = name.replaceAll(/[/\\]/g, "_").replace(/[\x00-\x1f\x7f]/g, "").trim();
  return cleaned || "file";
}

/** Appends " (2)", " (3)", ... only when two entries would otherwise collide -- never renames the common case. */
function uniqueZipEntryName(used: Set<string>, desired: string): string {
  if (!used.has(desired)) {
    used.add(desired);
    return desired;
  }
  const dot = desired.lastIndexOf(".");
  const base = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : "";
  let n = 2;
  let candidate = `${base} (${n})${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${base} (${n})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

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
  /**
   * Restrict the package to these item URIs -- the buyer's frozen
   * `purchase.receipt.grantedItems`. Items removed from the product since the
   * sale are still included; items added since are not. Omit for the merchant
   * incident-response path, which packages the whole current product.
   */
  entitledItemUris?: string[],
): Promise<Response | { error: string; status: 400 | 413 }> {
  const client = getR2S3Client(r2);

  const itemRefs = JSON.parse(product.items) as Array<{ uri: string }>;
  const itemUris = entitledItemUris ?? itemRefs.map((ref) => ref.uri);
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

  const toFetch: Array<{ objectId: string }> = [
    ...itemRows
      .filter((row): row is typeof row & { objectId: string } => !!row.objectId)
      .map((row) => ({ objectId: row.objectId })),
    ...includedAssetRows.map((a) => ({ objectId: a.objectId })),
  ];

  const zipEntries: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();
  let total = 0;
  for (const { objectId } of toFetch) {
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
    const nameInZip = uniqueZipEntryName(usedNames, safeZipEntryName(obj.fileName));
    zipEntries[nameInZip] = new Uint8Array(buf);
  }

  if (Object.keys(zipEntries).length === 0) {
    return { error: "no_downloadable_files", status: 400 };
  }

  const zipped = zipSync(zipEntries, { level: 6 });
  const zipFilename = safeZipEntryName(product.title || "product").replaceAll('"', "");
  return new Response(new Uint8Array(zipped), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipFilename}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
