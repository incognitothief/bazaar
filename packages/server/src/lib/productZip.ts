import { AtUri } from "@atproto/syntax";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../db";
import { catalogItems, catalogProductAssets, catalogProducts, inventoryUploadObject } from "../db/schema";
import { getR2S3Client } from "./r2/s3Client";
import { newProductPackageZipKey } from "./r2/inventoryKey";
import { r2ConfigFromEnv } from "./r2/env";
import { clearZipProgress, setZipProgress } from "./zipProgress";
import { ensureZipAutostopHold, releaseZipAutostopHold } from "./flyZipAutostopHold";

export const MAX_PRODUCT_ZIP_TOTAL_BYTES = 50 * 1024 * 1024 * 1024;
/** R2/S3 requires every multipart part except the last to be >= 5MiB; this gives headroom. */
const MULTIPART_PART_SIZE = 8 * 1024 * 1024;

/**
 * Rebuilds now run in the background after a write-path route returns its
 * response (see rebuildProductZipCacheByUri call sites) rather than
 * blocking the request on the full rebuild -- a real multi-file product's
 * rebuild can take long enough to trip a proxy/tunnel timeout well before
 * it's actually done, which then reads as a false failure to the merchant
 * and invites a retry that collides with the still-in-flight original (see
 * the ticket's staging incident). Fly Proxy autostop only counts inbound
 * edge connections, so a background promise looks like an idle machine
 * (staging: SIGINT mid-zip, then SIGKILL ~5s later). ensureZipAutostopHold
 * keeps a proxy-visible SSE open for the duration. Tracking in-flight
 * rebuilds here also lets index.ts wait on SIGINT/SIGTERM (deploys), which
 * is a 5s default kill_timeout and cannot finish a multi-GB zip on its own.
 */
const inFlightRebuilds = new Set<Promise<void>>();

/** For index.ts's SIGINT/SIGTERM handler: waits (up to timeoutMs) for any rebuilds still running so a scale-to-zero stop or deploy doesn't cut one off mid-flight. */
export async function waitForInFlightZipRebuilds(timeoutMs: number): Promise<void> {
  if (inFlightRebuilds.size === 0) return;
  console.log(`waitForInFlightZipRebuilds: waiting on ${inFlightRebuilds.size} in-flight rebuild(s)`);
  await Promise.race([
    Promise.allSettled([...inFlightRebuilds]),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

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

export type ZipObjectSize = {
  status: string;
  byteSize: number | null;
};

export type ProductZipCapResult = { ok: true } | { error: string; status: 400 | 413 };

/**
 * Decide whether a set of inventory objects can be packaged, using
 * already-known byteSize so callers can reject with a clean 413/400
 * before opening an HTTP stream or starting a multipart upload.
 * Incomplete objects are ignored. Null byteSize on a completed object
 * counts as 0 (completed objects are reconciled to real size by
 * download time; a missing value just doesn't contribute to the sum).
 * The caller is responsible for passing the entitled subset when the
 * live fallback is assembling a frozen grant rather than the full product.
 */
export function checkProductZipCap(objects: ZipObjectSize[]): ProductZipCapResult {
  const completed = objects.filter((o) => o.status === "completed");
  if (completed.length === 0) {
    return { error: "no_downloadable_files", status: 400 };
  }
  let total = 0;
  for (const o of completed) {
    total += o.byteSize ?? 0;
  }
  if (total > MAX_PRODUCT_ZIP_TOTAL_BYTES) {
    return { error: "package_too_large", status: 413 };
  }
  return { ok: true };
}

type ZipSourceObject = ZipObjectSize & {
  id: string;
  r2Key: string;
  fileName: string;
  contentType: string | null;
};

export function isAlreadyZipFile(fileName: string, contentType?: string | null): boolean {
  const name = fileName.toLowerCase();
  if (name.endsWith(".zip")) return true;
  const ct = (contentType ?? "").toLowerCase().split(";")[0]?.trim();
  return (
    ct === "application/zip" ||
    ct === "application/x-zip-compressed" ||
    ct === "application/zip-compressed"
  );
}

/**
 * Members that are already compressed: ZIP STORE (fflate ZipPassThrough,
 * method 0) instead of deflate. Deflating mp3/mp4/zip/jpeg burns CPU for
 * almost no size win — that was the 20-minute wrap of a 2.5GB zip.
 * Uncompressed masters (wav, tiff, txt) still use ZipDeflate level 6.
 */
const STORE_EXTENSIONS = new Set([
  "zip",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "zst",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "heic",
  "heif",
  "avif",
  "jxl",
  "mp3",
  "aac",
  "m4a",
  "ogg",
  "oga",
  "opus",
  "wma",
  "flac",
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "avi",
  "pdf",
  "docx",
  "xlsx",
  "pptx",
]);

const STORE_CONTENT_TYPES = new Set([
  "application/gzip",
  "application/x-gzip",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/opus",
  "audio/flac",
  "audio/x-flac",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
]);

export function shouldStoreZipMember(fileName: string, contentType?: string | null): boolean {
  if (isAlreadyZipFile(fileName, contentType)) return true;
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext && STORE_EXTENSIONS.has(ext)) return true;
  const ct = (contentType ?? "").toLowerCase().split(";")[0]?.trim();
  return !!ct && STORE_CONTENT_TYPES.has(ct);
}

function zipEntryFor(nameInZip: string, fileName: string, contentType?: string | null): ZipDeflate | ZipPassThrough {
  if (shouldStoreZipMember(fileName, contentType)) {
    return new ZipPassThrough(nameInZip);
  }
  return new ZipDeflate(nameInZip, { level: 6 });
}

/**
 * A product whose downloadable set is exactly one already-zipped file
 * (one item, no extra assets in the package). Wrapping that in another
 * zip is zip-in-zip: slower to build, no smaller, worse for the buyer.
 */
export function passthroughExistingZip<T extends { status: string; fileName: string; contentType?: string | null }>(
  objects: T[],
): T | null {
  const completed = objects.filter((o) => o.status === "completed");
  if (completed.length !== 1) return null;
  const only = completed[0]!;
  return isAlreadyZipFile(only.fileName, only.contentType) ? only : null;
}

function loadZipSourceObjects(
  db: Db,
  product: CatalogProductRow,
  entitledItemUris?: string[],
): ZipSourceObject[] {
  const objectIds = resolveProductZipObjectIds(db, product, entitledItemUris);
  const out: ZipSourceObject[] = [];
  for (const objectId of objectIds) {
    const obj = db
      .select()
      .from(inventoryUploadObject)
      .where(eq(inventoryUploadObject.id, objectId))
      .get();
    if (!obj) continue;
    out.push({
      id: obj.id,
      status: obj.status,
      byteSize: obj.byteSize,
      r2Key: obj.r2Key,
      fileName: obj.fileName,
      contentType: obj.contentType,
    });
  }
  return out;
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
 * Per-call ceiling on a discrete R2 command (multipart create / upload
 * part / complete) or on one idle gap between GetObject body chunks.
 * Without this, a stalled network read hangs forever -- staging saw a
 * request silently stuck until Fly's proxy dropped it.
 *
 * This must NOT wrap an entire GetObject (headers + body) in
 * AbortSignal.timeout: that aborts a healthy multi-GB download after 30s
 * (`aborted` / ECONNRESET) even though chunks are still flowing. GetObject
 * send() is timed until headers arrive; each body chunk is timed
 * separately so a stall still fails and a long file can finish.
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

type ZipSink = {
  write(chunk: Uint8Array): Promise<void>;
  finalize(): Promise<void>;
  abort(): Promise<void>;
};

/**
 * Shared fetch-stream-compress loop. Never holds more than one file's raw
 * bytes (streamed straight from R2's GetObject response body) plus whatever
 * the sink itself buffers -- for R2 that's one multipart part; for HTTP
 * that's TransformStream backpressure. Cap is checked by the caller via
 * checkProductZipCap *before* creating the sink so an over-size package
 * can still be a clean 413. abortOnOverCap is a running-total backstop for
 * the R2 sink only (null byteSize on a completed object, or a lie); HTTP
 * cannot change the status code once the body has started.
 */
type ZipBuildProgress = {
  current: number;
  total: number;
  fileName: string;
  bytesRead: number;
  bytesTotal: number;
};

async function streamIntoSink(
  client: ReturnType<typeof getR2S3Client>,
  r2: R2Config,
  objects: ZipSourceObject[],
  sink: ZipSink,
  opts: {
    abortOnOverCap: boolean;
    onProgress?: (p: ZipBuildProgress) => void;
    log: (msg: string) => void;
  },
): Promise<{ ok: true } | { error: string; status: 400 | 413 }> {
  const { abortOnOverCap, onProgress, log } = opts;
  const pending: Uint8Array[] = [];
  const bytesTotal = objects
    .filter((o) => o.status === "completed")
    .reduce((n, o) => n + (o.byteSize ?? 0), 0);
  let lastProgressAt = 0;

  function report(
    p: Omit<ZipBuildProgress, "bytesRead" | "bytesTotal"> & { bytesRead: number },
    force: boolean,
  ): void {
    const now = Date.now();
    if (!force && now - lastProgressAt < 250) return;
    lastProgressAt = now;
    onProgress?.({ ...p, bytesTotal });
  }

  async function drain(): Promise<void> {
    while (pending.length) {
      const chunk = pending.shift()!;
      await sink.write(chunk);
    }
  }

  // fflate's Zip/ZipDeflate.push() is synchronous and calls this callback
  // inline -- it only ever queues chunks. The async code below drains that
  // queue (awaiting the sink, which applies backpressure) right after each
  // push() returns.
  const zip = new Zip((err, chunk) => {
    if (err) throw err;
    if (chunk?.length) pending.push(chunk);
  });

  try {
    const usedNames = new Set<string>();
    let total = 0;
    let sawFile = false;
    let index = 0;

    for (const obj of objects) {
      index += 1;
      if (obj.status !== "completed") continue;
      report(
        { current: index, total: objects.length, fileName: obj.fileName, bytesRead: total },
        true,
      );
      log(`fetching ${index}/${objects.length}: ${obj.fileName}`);
      let got;
      try {
        // No abortSignal on GetObject: the SDK applies it to the whole
        // download, not just the header round-trip. A 2.5GB source is a
        // many-minute read; 30s wall-clock abort is what marked this
        // package failed with ECONNRESET after ~32 healthy 8MB parts.
        got = await withTimeout(
          client.send(new GetObjectCommand({ Bucket: r2.bucket, Key: obj.r2Key })),
          `get object ${obj.fileName}`,
        );
      } catch (e) {
        console.warn(`product zip: get object failed, skipping`, obj.fileName, e);
        continue;
      }
      if (!got.Body) continue;
      log(`got response for ${obj.fileName} (contentLength=${got.ContentLength ?? "unknown"}), reading...`);

      const nameInZip = uniqueZipEntryName(usedNames, safeZipEntryName(obj.fileName));
      const store = shouldStoreZipMember(obj.fileName, obj.contentType);
      const entry = zipEntryFor(nameInZip, obj.fileName, obj.contentType);
      zip.add(entry);
      sawFile = true;
      log(
        `packing ${obj.fileName} as ${store ? "store (already compressed)" : "deflate"}`,
      );

      // Iterate got.Body directly as the async-iterable stream the SDK
      // already gives us (a Node Readable under Bun/Node) rather than going
      // through transformToWebStream().getReader() -- that conversion layer
      // is the leading suspect for a real staging hang: no crash, no
      // timeout ever tripped, just a request that silently never finished,
      // which fits a stream that never resolves `done` rather than any
      // single slow operation.
      const iterator = (got.Body as unknown as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
      let tooLarge = false;
      let emptyReadsInARow = 0;
      try {
        for (;;) {
          const { done, value } = await withTimeout(iterator.next(), `read ${obj.fileName}`);
          if (done) break;
          if (!value?.length) {
            // Defense in depth: a stream that yields empty chunks forever
            // without ever signaling done would spin past the size cap
            // and past any single-read timeout without ever failing --
            // this bounds that specific failure mode too.
            emptyReadsInARow += 1;
            if (emptyReadsInARow > 1000) {
              throw new Error(`stream for ${obj.fileName} stalled: 1000 consecutive empty reads`);
            }
            continue;
          }
          emptyReadsInARow = 0;
          total += value.length;
          if (abortOnOverCap && total > MAX_PRODUCT_ZIP_TOTAL_BYTES) {
            tooLarge = true;
            break;
          }
          entry.push(value, false);
          await drain();
          report(
            { current: index, total: objects.length, fileName: obj.fileName, bytesRead: total },
            false,
          );
        }
      } finally {
        await iterator.return?.(undefined).catch(() => {});
      }
      if (tooLarge) {
        log(`aborting: total exceeded MAX_PRODUCT_ZIP_TOTAL_BYTES at ${obj.fileName}`);
        await sink.abort();
        return { error: "package_too_large", status: 413 };
      }
      entry.push(new Uint8Array(0), true);
      await drain();
      report(
        { current: index, total: objects.length, fileName: obj.fileName, bytesRead: total },
        true,
      );
      log(`finished ${obj.fileName} (${total} bytes read so far)`);
    }

    if (!sawFile) {
      log("no downloadable files found, aborting");
      await sink.abort();
      return { error: "no_downloadable_files", status: 400 };
    }

    zip.end();
    await drain();
    await sink.finalize();
    log(`done (${total} raw bytes read)`);
    return { ok: true };
  } catch (e) {
    log(`failed: ${e instanceof Error ? e.message : String(e)}`);
    await sink.abort();
    throw e;
  }
}

async function createR2MultipartSink(
  client: ReturnType<typeof getR2S3Client>,
  r2: R2Config,
  key: string,
  log: (msg: string) => void,
): Promise<ZipSink> {
  const created = await withTimeout(
    client.send(
      new CreateMultipartUploadCommand({ Bucket: r2.bucket, Key: key, ContentType: "application/zip" }),
      { abortSignal: AbortSignal.timeout(R2_OP_TIMEOUT_MS) },
    ),
    "multipart create",
  );
  const uploadId = created.UploadId;
  if (!uploadId) throw new Error("multipart_init_failed");
  log(`multipart upload ${uploadId} created`);

  const parts: Array<{ PartNumber: number; ETag: string }> = [];
  let partNumber = 0;
  const pending: Uint8Array[] = [];
  let pendingLen = 0;
  let settled = false;

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
    log(`uploaded part ${partNumber} (${body.length} bytes)`);
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

  return {
    async write(chunk) {
      pending.push(chunk);
      pendingLen += chunk.length;
      await flushPart(false);
    },
    async finalize() {
      await flushPart(true);
      log(`completing multipart upload: ${parts.length} part(s)`);
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
      settled = true;
    },
    async abort() {
      if (settled) return;
      settled = true;
      await client
        .send(new AbortMultipartUploadCommand({ Bucket: r2.bucket, Key: key, UploadId: uploadId }))
        .catch((e) => console.warn("streamProductZipToR2: abort failed", key, e));
    },
  };
}

function createHttpZipSink(): { sink: ZipSink; readable: ReadableStream<Uint8Array> } {
  const transform = new TransformStream<Uint8Array, Uint8Array>();
  const writer = transform.writable.getWriter();
  let settled = false;
  return {
    readable: transform.readable,
    sink: {
      async write(chunk) {
        // Copy: fflate may reuse the callback buffer; the stream consumer
        // reads asynchronously and TransformStream write() applies backpressure
        // so a slow client cannot balloon process memory.
        await writer.write(chunk.slice());
      },
      async finalize() {
        if (settled) return;
        settled = true;
        await writer.close();
      },
      async abort() {
        if (settled) return;
        settled = true;
        try {
          await writer.abort();
        } catch {
          // already closed
        }
      },
    },
  };
}

/**
 * Same package contents as the live HTTP path, streamed into R2 via
 * multipart upload so a cache rebuild never holds more than one file's
 * raw bytes or one multipart part of compressed output at a time.
 */
async function streamProductZipToR2(
  db: Db,
  r2: R2Config,
  client: ReturnType<typeof getR2S3Client>,
  product: CatalogProductRow,
  key: string,
  onProgress?: (p: ZipBuildProgress) => void,
): Promise<{ ok: true } | { error: string; status: 400 | 413 }> {
  const log = (msg: string) => console.log(`[zip ${key}]`, msg);
  const objects = loadZipSourceObjects(db, product);
  log(`starting: ${objects.length} object(s) to package`);
  const cap = checkProductZipCap(objects);
  if ("error" in cap) return cap;

  const sink = await createR2MultipartSink(client, r2, key, log);
  return streamIntoSink(client, r2, objects, sink, {
    abortOnOverCap: true,
    onProgress,
    log,
  });
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
 *
 * The 50GB cap is summed from inventoryUploadObject.byteSize *before* the
 * Response body opens, so an over-cap package is still a clean 413. The
 * body itself is a backpressured TransformStream of compressed chunks --
 * not an in-memory zipSync of every file at once.
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
  const objects = loadZipSourceObjects(db, product, entitledItemUris);
  const cap = checkProductZipCap(objects);
  if ("error" in cap) return cap;

  const client = getR2S3Client(r2);
  const pass = passthroughExistingZip(objects);
  if (pass) {
    return streamOriginalZipResponse(client, r2, pass);
  }

  const { sink, readable } = createHttpZipSink();
  const log = (msg: string) => console.log(`[zip live ${product.uri}]`, msg);
  void streamIntoSink(client, r2, objects, sink, { abortOnOverCap: false, log }).then(
    (result) => {
      if ("error" in result) {
        console.warn("buildProductZip: stream ended with", result.error, product.uri);
      }
    },
    (e) => {
      console.warn("buildProductZip: stream failed", product.uri, e);
    },
  );

  const zipFilename = zipFilenameFor(product);
  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipFilename}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function streamOriginalZipResponse(
  client: ReturnType<typeof getR2S3Client>,
  r2: R2Config,
  obj: ZipSourceObject,
): Promise<Response | { error: string; status: 400 | 413 }> {
  let got;
  try {
    got = await withTimeout(
      client.send(new GetObjectCommand({ Bucket: r2.bucket, Key: obj.r2Key })),
      `get object ${obj.fileName}`,
    );
  } catch (e) {
    console.warn("buildProductZip: passthrough get object failed", obj.fileName, e);
    return { error: "no_downloadable_files", status: 400 };
  }
  if (!got.Body) return { error: "no_downloadable_files", status: 400 };
  const filename = safeZipEntryName(obj.fileName).replaceAll('"', "");
  const headers: Record<string, string> = {
    "Content-Type": obj.contentType || "application/zip",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
  };
  if (got.ContentLength != null) headers["Content-Length"] = String(got.ContentLength);
  return new Response(got.Body as ReadableStream<Uint8Array>, {
    status: 200,
    headers,
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
  const p = runRebuildProductZipCache(db, product);
  inFlightRebuilds.add(p);
  ensureZipAutostopHold();
  try {
    await p;
  } finally {
    inFlightRebuilds.delete(p);
    if (inFlightRebuilds.size === 0) releaseZipAutostopHold();
  }
}

async function runRebuildProductZipCache(
  db: Db,
  product: CatalogProductRow,
): Promise<void> {
  console.log(`rebuildProductZipCache: starting for ${product.uri}`);
  const r2 = r2ConfigFromEnv();
  if (!r2.ok) {
    console.warn("rebuildProductZipCache: R2 not configured, skipping", r2.reason);
    return;
  }
  try {
    const objects = loadZipSourceObjects(db, product);
    const cap = checkProductZipCap(objects);
    if ("error" in cap) {
      console.warn("rebuildProductZipCache: assembly failed", product.uri, cap.error);
      await db
        .update(catalogProducts)
        .set({ packageZipStatus: "failed", packageZipRebuildStartedAt: null })
        .where(eq(catalogProducts.uri, product.uri));
      return;
    }

    const pass = passthroughExistingZip(objects);
    if (pass) {
      console.log(
        `rebuildProductZipCache: passthrough existing zip ${pass.fileName} for ${product.uri}`,
      );
      await db
        .update(catalogProducts)
        .set({
          packageZipKey: pass.r2Key,
          packageZipStatus: "ready",
          packageZipUpdatedAt: new Date(),
          packageZipRebuildStartedAt: null,
        })
        .where(eq(catalogProducts.uri, product.uri));
      return;
    }

    const rkey = new AtUri(product.uri).rkey;
    const key = newProductPackageZipKey(product.merchantDid, rkey);
    const client = getR2S3Client(r2);
    await db
      .update(catalogProducts)
      .set({ packageZipRebuildStartedAt: new Date() })
      .where(eq(catalogProducts.uri, product.uri));
    setZipProgress(product.uri, {
      current: 0,
      total: 1,
      fileName: "Preparing package…",
      bytesRead: 0,
      bytesTotal: 0,
    });
    const result = await streamProductZipToR2(db, r2, client, product, key, (p) =>
      setZipProgress(product.uri, p),
    );
    if ("error" in result) {
      console.warn("rebuildProductZipCache: assembly failed", product.uri, result.error);
      await db
        .update(catalogProducts)
        .set({ packageZipStatus: "failed", packageZipRebuildStartedAt: null })
        .where(eq(catalogProducts.uri, product.uri));
      return;
    }
    await db
      .update(catalogProducts)
      .set({
        packageZipKey: key,
        packageZipStatus: "ready",
        packageZipUpdatedAt: new Date(),
        packageZipRebuildStartedAt: null,
      })
      .where(eq(catalogProducts.uri, product.uri));
  } catch (e) {
    console.warn("rebuildProductZipCache: failed", product.uri, e);
    try {
      await db
        .update(catalogProducts)
        .set({ packageZipStatus: "failed", packageZipRebuildStartedAt: null })
        .where(eq(catalogProducts.uri, product.uri));
    } catch {
      // Best-effort -- if even the status update fails, the stale/absent
      // key is still gated off since download.ts requires status "ready".
    }
  } finally {
    clearZipProgress(product.uri);
  }
}

/**
 * Boot hook: any rebuild that was in flight when the process last died is
 * marked failed. Does not start a new rebuild — a machine that crashes
 * mid-zip would otherwise boot-loop the same job forever.
 */
export function markInterruptedZipRebuildsFailed(db: Db): void {
  const rows = db
    .select({ uri: catalogProducts.uri })
    .from(catalogProducts)
    .where(isNotNull(catalogProducts.packageZipRebuildStartedAt))
    .all();
  if (rows.length === 0) return;
  console.warn(
    `markInterruptedZipRebuildsFailed: ${rows.length} rebuild(s) were in flight when the process last died; marking failed (not restarting)`,
  );
  db.update(catalogProducts)
    .set({ packageZipStatus: "failed", packageZipRebuildStartedAt: null })
    .where(isNotNull(catalogProducts.packageZipRebuildStartedAt))
    .run();
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
 * case the precomputed cache is allowed to answer for. `undefined` means no
 * frozen grant was supplied, which no longer reaches here from download.ts --
 * a receipt without one does not verify (ADR 0019) -- but is kept as a
 * permissive default for other callers. Order-independent; ignores each ref's
 * cid.
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

/** Buyer/merchant attachment name: original upload name when the cache *is* that file (passthrough zip), otherwise `{title}.zip`. */
export function packageAttachmentFilename(
  product: Pick<CatalogProductRow, "title">,
  storedFileName?: string | null,
): string {
  if (storedFileName?.trim()) return safeZipEntryName(storedFileName).replaceAll('"', "");
  return `${zipFilenameFor(product)}.zip`;
}

/** Presign the cached package when status is ready. Null if missing, not ready, or R2 errors (caller falls back to live assembly). */
export async function presignCachedProductPackage(
  db: Db,
  r2: R2Config,
  product: CatalogProductRow,
  expiresInSec: number,
): Promise<{ url: string; filename: string; expiresAt: string } | null> {
  if (product.packageZipStatus !== "ready" || !product.packageZipKey) return null;
  const stored = db
    .select({ fileName: inventoryUploadObject.fileName })
    .from(inventoryUploadObject)
    .where(eq(inventoryUploadObject.r2Key, product.packageZipKey))
    .get();
  const filename = packageAttachmentFilename(product, stored?.fileName);
  try {
    const client = getR2S3Client(r2);
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: r2.bucket,
        Key: product.packageZipKey,
        ResponseContentDisposition: `attachment; filename="${filename.replaceAll('"', "")}"`,
      }),
      { expiresIn: expiresInSec },
    );
    return {
      url,
      filename,
      expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    };
  } catch (e) {
    console.warn("presignCachedProductPackage failed", product.uri, e);
    return null;
  }
}
