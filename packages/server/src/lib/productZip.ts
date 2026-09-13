import { AtUri } from "@atproto/syntax";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { Zip, ZipDeflate, zipSync } from "fflate";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { catalogItems, catalogProductAssets, catalogProducts, inventoryUploadObject } from "../db/schema";
import { getR2S3Client } from "./r2/s3Client";
import { newProductPackageZipKey } from "./r2/inventoryKey";
import { r2ConfigFromEnv } from "./r2/env";
import { clearZipProgress, setZipProgress } from "./zipProgress";

const MAX_PRODUCT_ZIP_TOTAL_BYTES = 250 * 1024 * 1024;
/** R2/S3 requires every multipart part except the last to be >= 5MiB; this gives headroom. */
const MULTIPART_PART_SIZE = 8 * 1024 * 1024;

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
 * Which inventoryUploadObject ids belong in a product's package -- its
 * items' (or the entitled subset's) master files plus the generic
 * included-assets bin (cover art only if artIncludedInDownload). Shared by
 * both assembly paths below.
 */
function resolveProductZipObjectIds(
  db: Db,
  product: CatalogProductRow,
  entitledItemUris?: string[],
): string[] {
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

  return [
    ...itemRows
      .filter((row): row is typeof row & { objectId: string } => !!row.objectId)
      .map((row) => row.objectId),
    ...includedAssetRows.map((a) => a.objectId),
  ];
}

/**
 * Fetches every file a product's package should contain and zips them in
 * memory -- every file's raw bytes, plus the final compressed zip, resident
 * at once. Used by buildProductZip (buyer live-rebuild fallback + merchant
 * incident-response tool): both are low-frequency (entitlement drift or
 * manual support, not routine merchant edits), and streaming a
 * variable-length HTTP response can't cleanly reject an over-cap package
 * once bytes have already started flowing to the client, so this stays
 * simple rather than adopting streamProductZipToR2's approach below.
 * rebuildProductZipCache (the hot path -- fires on every merchant edit)
 * uses that streaming version instead. Always reads
 * inventoryUploadObject.r2Key, never webpR2Key -- the download is the
 * original file, the webp derivative is display-only.
 */
async function assembleProductZipBytes(
  db: Db,
  r2: R2Config,
  product: CatalogProductRow,
  entitledItemUris?: string[],
): Promise<{ bytes: Uint8Array } | { error: string; status: 400 | 413 }> {
  const client = getR2S3Client(r2);
  const objectIds = resolveProductZipObjectIds(db, product, entitledItemUris);

  const zipEntries: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();
  let total = 0;
  for (const objectId of objectIds) {
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
 * Removes exactly `n` bytes from the front of a queue of chunks (splitting
 * a chunk if it straddles the boundary) and returns them as one contiguous
 * buffer, mutating `chunks`/`chunks.length` in place to hold whatever's
 * left. R2/S3 requires every non-final multipart part to be the exact same
 * size, so parts can't just be "whatever accumulated past the threshold" --
 * they have to be sliced to precise byte boundaries, carrying any remainder
 * over to the next part.
 */
function takeBytes(chunks: Uint8Array[], n: number): Uint8Array {
  const out = new Uint8Array(n);
  let offset = 0;
  let consumed = 0;
  while (offset < n) {
    const c = chunks[consumed];
    const need = n - offset;
    if (c.length <= need) {
      out.set(c, offset);
      offset += c.length;
      consumed += 1;
    } else {
      out.set(c.subarray(0, need), offset);
      chunks[consumed] = c.subarray(need);
      offset += need;
    }
  }
  chunks.splice(0, consumed);
  return out;
}

/**
 * Per-call ceiling on any single R2 operation or stream read. Without this,
 * a stalled network read just hangs forever with nothing to catch and
 * nothing to log -- exactly what happened on staging (a request silently
 * stuck, no crash, no error, until Fly's proxy gave up and dropped the
 * connection). A timeout turns that into a normal, logged, recoverable
 * failure -- rebuildProductZipCache already handles thrown errors by
 * marking packageZipStatus "failed", so this just ensures it can actually
 * get there instead of hanging indefinitely.
 */
const R2_OP_TIMEOUT_MS = 30_000;

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${R2_OP_TIMEOUT_MS}ms`)),
      R2_OP_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Same package contents as assembleProductZipBytes, but never holds more
 * than one file's raw bytes (streamed straight from R2's GetObject response
 * body) or one multipart part's worth of compressed output in memory at a
 * time -- regardless of how many files are in the product or how large the
 * total package is. This is what actually fixes the OOM: the old
 * buffer-everything-then-zipSync approach held every file simultaneously,
 * which crashed a 512MB machine on a real 10-item product (confirmed via
 * Fly's oom_killed=true machine event). Used only by rebuildProductZipCache.
 */
async function streamProductZipToR2(
  db: Db,
  r2: R2Config,
  client: ReturnType<typeof getR2S3Client>,
  product: CatalogProductRow,
  key: string,
  onProgress?: (current: number, total: number, fileName: string) => void,
): Promise<{ ok: true } | { error: string; status: 400 | 413 }> {
  const objectIds = resolveProductZipObjectIds(db, product);

  const created = await withTimeout(
    client.send(
      new CreateMultipartUploadCommand({ Bucket: r2.bucket, Key: key, ContentType: "application/zip" }),
      { abortSignal: AbortSignal.timeout(R2_OP_TIMEOUT_MS) },
    ),
    "multipart create",
  );
  const uploadId = created.UploadId;
  if (!uploadId) throw new Error("multipart_init_failed");

  const abort = () =>
    client
      .send(new AbortMultipartUploadCommand({ Bucket: r2.bucket, Key: key, UploadId: uploadId }))
      .catch((e) => console.warn("streamProductZipToR2: abort failed", key, e));

  const parts: Array<{ PartNumber: number; ETag: string }> = [];
  let partNumber = 0;
  const pending: Uint8Array[] = [];
  let pendingLen = 0;

  async function uploadPart(body: Uint8Array): Promise<void> {
    partNumber += 1;
    const out = await withTimeout(
      client.send(
        new UploadPartCommand({
          Bucket: r2.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body,
        }),
        { abortSignal: AbortSignal.timeout(R2_OP_TIMEOUT_MS) },
      ),
      `multipart upload part ${partNumber}`,
    );
    if (!out.ETag) throw new Error("multipart_missing_etag");
    parts.push({ PartNumber: partNumber, ETag: out.ETag });
  }

  /**
   * `final=false`: uploads as many exactly-MULTIPART_PART_SIZE parts as the
   * queue currently allows, leaving any remainder (< one part's worth)
   * queued. `final=true`: also flushes that remainder as the last part,
   * whatever size it is -- only the last part is allowed to be undersized.
   */
  async function flushPart(final: boolean): Promise<void> {
    while (pendingLen >= MULTIPART_PART_SIZE) {
      const body = takeBytes(pending, MULTIPART_PART_SIZE);
      pendingLen -= MULTIPART_PART_SIZE;
      await uploadPart(body);
    }
    if (final && pendingLen > 0) {
      const body = takeBytes(pending, pendingLen);
      pendingLen = 0;
      await uploadPart(body);
    }
  }

  // fflate's Zip/ZipDeflate.push() is synchronous and calls this callback
  // inline -- it only ever queues chunks. The async code below drains that
  // queue (awaiting uploads as needed) right after each push() returns.
  const zip = new Zip((err, chunk) => {
    if (err) throw err;
    if (chunk?.length) {
      pending.push(chunk);
      pendingLen += chunk.length;
    }
  });

  try {
    const usedNames = new Set<string>();
    let total = 0;
    let sawFile = false;
    let index = 0;

    for (const objectId of objectIds) {
      index += 1;
      const obj = db
        .select()
        .from(inventoryUploadObject)
        .where(eq(inventoryUploadObject.id, objectId))
        .get();
      if (!obj || obj.status !== "completed") continue;
      onProgress?.(index, objectIds.length, obj.fileName);
      let got;
      try {
        got = await withTimeout(
          client.send(
            new GetObjectCommand({ Bucket: r2.bucket, Key: obj.r2Key }),
            { abortSignal: AbortSignal.timeout(R2_OP_TIMEOUT_MS) },
          ),
          `get object ${obj.fileName}`,
        );
      } catch (e) {
        console.warn("product zip stream: skip object", objectId, e);
        continue;
      }
      if (!got.Body) continue;

      const nameInZip = uniqueZipEntryName(usedNames, safeZipEntryName(obj.fileName));
      const entry = new ZipDeflate(nameInZip, { level: 6 });
      zip.add(entry);
      sawFile = true;

      const reader = got.Body.transformToWebStream().getReader();
      let tooLarge = false;
      for (;;) {
        const { done, value } = await withTimeout(reader.read(), `read ${obj.fileName}`);
        if (done) break;
        if (!value?.length) continue;
        total += value.length;
        if (total > MAX_PRODUCT_ZIP_TOTAL_BYTES) {
          tooLarge = true;
          await reader.cancel().catch(() => {});
          break;
        }
        entry.push(value, false);
        await flushPart(false);
      }
      if (tooLarge) {
        await abort();
        return { error: "package_too_large", status: 413 };
      }
      entry.push(new Uint8Array(0), true);
      await flushPart(false);
    }

    if (!sawFile) {
      await abort();
      return { error: "no_downloadable_files", status: 400 };
    }

    zip.end();
    await flushPart(true);
    await withTimeout(
      client.send(
        new CompleteMultipartUploadCommand({
          Bucket: r2.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        }),
        { abortSignal: AbortSignal.timeout(R2_OP_TIMEOUT_MS) },
      ),
      "multipart complete",
    );
    return { ok: true };
  } catch (e) {
    await abort();
    throw e;
  }
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
    const rkey = new AtUri(product.uri).rkey;
    const key = newProductPackageZipKey(product.merchantDid, rkey);
    const client = getR2S3Client(r2);
    const result = await streamProductZipToR2(db, r2, client, product, key, (current, total, fileName) =>
      setZipProgress(product.uri, { current, total, fileName }),
    );
    if ("error" in result) {
      console.warn("rebuildProductZipCache: assembly failed", product.uri, result.error);
      await db
        .update(catalogProducts)
        .set({ packageZipStatus: "failed" })
        .where(eq(catalogProducts.uri, product.uri));
      return;
    }
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
  } finally {
    clearZipProgress(product.uri);
  }
}

/** Convenience wrapper for write-path handlers that only have a product URI in hand right after a mutation. No-ops if the product isn't found. Never throws -- same best-effort contract as rebuildProductZipCache itself, since callers await this bare, with no try/catch of their own. */
export async function rebuildProductZipCacheByUri(db: Db, productUri: string): Promise<void> {
  try {
    const row = db.select().from(catalogProducts).where(eq(catalogProducts.uri, productUri)).get();
    if (!row) return;
    await rebuildProductZipCache(db, row);
  } catch (e) {
    console.warn("rebuildProductZipCacheByUri: failed", productUri, e);
  }
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
