import { AtUri } from "@atproto/syntax";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { zipSync } from "fflate";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { catalogItems, catalogProductAssets, catalogProducts, inventoryUploadObject } from "../db/schema";
import { getR2S3Client } from "./r2/s3Client";
import { newProductPackageZipKey } from "./r2/inventoryKey";
import { r2ConfigFromEnv } from "./r2/env";

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
type R2Config = Extract<ReturnType<typeof r2ConfigFromEnv>, { ok: true }>;

function zipFilenameFor(product: Pick<CatalogProductRow, "title">): string {
  return safeZipEntryName(product.title || "product").replaceAll('"', "");
}

/**
 * Fetches every file a product's package should contain and zips them in
 * memory. Shared by buildProductZip (buyer/merchant-facing, wraps this in
 * an HTTP Response) and rebuildProductZipCache (writes the bytes to R2
 * instead). Always reads inventoryUploadObject.r2Key, never webpR2Key --
 * the download is the original file, the webp derivative is display-only.
 */
async function assembleProductZipBytes(
  db: Db,
  r2: R2Config,
  product: CatalogProductRow,
  entitledItemUris?: string[],
): Promise<{ bytes: Uint8Array } | { error: string; status: 400 | 413 }> {
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

  return { bytes: zipSync(zipEntries, { level: 6 }) };
}

/**
 * Assembles a product's download package as an HTTP Response: its items'
 * master files plus the generic included-assets bin (cover art only if
 * artIncludedInDownload). Shared by the merchant incident-response tool (no
 * entitlement check, just ownership) and the buyer-facing download route's
 * live-rebuild fallback (entitlement-checked, used when the precomputed
 * cache in catalogProducts.packageZipKey doesn't apply -- see
 * rebuildProductZipCache and download.ts's entitlementMatchesCurrentItems)
 * -- same package either way, only the caller's access check differs.
 */
export async function buildProductZip(
  db: Db,
  r2: R2Config,
  product: CatalogProductRow,
  /**
   * Restrict the package to these item URIs -- the buyer's frozen
   * `purchase.receipt.grantedItems`. Items removed from the product since the
   * sale are still included; items added since are not. Omit for the merchant
   * incident-response path, which packages the whole current product.
   */
  entitledItemUris?: string[],
): Promise<Response | { error: string; status: 400 | 413 }> {
  const result = await assembleProductZipBytes(db, r2, product, entitledItemUris);
  if ("error" in result) return result;

  const zipFilename = zipFilenameFor(product);
  return new Response(result.bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipFilename}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Precomputes a product's *current* package (no entitlement restriction --
 * the cache only ever represents live contents) and stores it as a single
 * R2 object, then records the result on catalogProducts so the buyer-facing
 * download route can presign straight to it instead of rebuilding.
 *
 * Best-effort and self-contained by design: called synchronously, inline,
 * from every merchant write path that can change a product's zip contents
 * (item add/remove, item-file replace-via-republish, asset add/remove,
 * artIncludedInDownload toggle -- see the ticket's dependency map). Never
 * throws -- a failed rebuild just leaves packageZipStatus as "failed",
 * which keeps the buyer-facing route falling back to live assembly rather
 * than ever serving stale or wrong bytes.
 */
export async function rebuildProductZipCache(
  db: Db,
  product: CatalogProductRow,
): Promise<void> {
  const r2 = r2ConfigFromEnv();
  if (!r2.ok) {
    console.warn("rebuildProductZipCache: R2 not configured, skipping", r2.reason);
    return;
  }
  try {
    const result = await assembleProductZipBytes(db, r2, product);
    if ("error" in result) {
      console.warn("rebuildProductZipCache: assembly failed", product.uri, result.error);
      await db
        .update(catalogProducts)
        .set({ packageZipStatus: "failed" })
        .where(eq(catalogProducts.uri, product.uri));
      return;
    }
    const rkey = new AtUri(product.uri).rkey;
    const key = newProductPackageZipKey(product.merchantDid, rkey);
    const client = getR2S3Client(r2);
    await client.send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: key,
        Body: result.bytes,
        ContentType: "application/zip",
      }),
    );
    await db
      .update(catalogProducts)
      .set({ packageZipKey: key, packageZipStatus: "ready", packageZipUpdatedAt: new Date() })
      .where(eq(catalogProducts.uri, product.uri));
  } catch (e) {
    console.warn("rebuildProductZipCache: failed", product.uri, e);
    try {
      await db
        .update(catalogProducts)
        .set({ packageZipStatus: "failed" })
        .where(eq(catalogProducts.uri, product.uri));
    } catch {
      // Best-effort -- if even the status update fails, the stale/absent
      // key is still gated off since download.ts requires status "ready".
    }
  }
}

/** Convenience wrapper for write-path handlers that only have a product URI in hand right after a mutation. No-ops if the product isn't found. */
export async function rebuildProductZipCacheByUri(db: Db, productUri: string): Promise<void> {
  const row = db.select().from(catalogProducts).where(eq(catalogProducts.uri, productUri)).get();
  if (!row) return;
  await rebuildProductZipCache(db, row);
}

/**
 * True when a buyer's frozen entitlement (from `purchase.receipt.
 * grantedItems`) covers exactly the product's *current* items[] -- the only
 * case the precomputed cache is allowed to answer for. `undefined` means a
 * legacy receipt with no frozen grant, which already resolves against live
 * product membership (see download.ts), so it always matches "current" by
 * definition. Order-independent; ignores each ref's cid.
 */
export function entitlementMatchesCurrentItems(
  product: Pick<CatalogProductRow, "items">,
  entitledItemUris?: string[],
): boolean {
  if (!entitledItemUris) return true;
  const currentUris = new Set(
    (JSON.parse(product.items) as Array<{ uri: string }>).map((ref) => ref.uri),
  );
  const entitledSet = new Set(entitledItemUris);
  if (currentUris.size !== entitledSet.size) return false;
  for (const uri of entitledSet) {
    if (!currentUris.has(uri)) return false;
  }
  return true;
}

export { zipFilenameFor };
