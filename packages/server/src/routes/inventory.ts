import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { AtUri } from "@atproto/syntax";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { TID } from "@atproto/common-web";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db";
import {
  catalogProductAssets,
  catalogProducts,
  inventoryUploadObject,
  inventoryUploadPart,
  inventoryUploadSession,
} from "../db/schema";
import type { OAuthClient } from "../lib/atproto/oauth";
import { getSessionAgent } from "../lib/atproto/session";
import { captureCatalogItem, captureCatalogProduct } from "./atproto";
import { cidFromSha256Digest32 } from "../lib/r2/cid";
import { r2ConfigFromEnv } from "../lib/r2/env";
import {
  newProductAssetKey,
  newProductItemKey,
} from "../lib/r2/inventoryKey";
import {
  isR2AccessDenied,
  r2AccessDeniedHints,
} from "../lib/r2/diagnostics";
import { getR2S3Client } from "../lib/r2/s3Client";
import { generateWebpDerivative } from "../lib/webpDerivative";
import { rebuildProductZipCacheByUri } from "../lib/productZip";

const MULTIPART_MIN_BYTES = Number(
  process.env.BAZAAR_INVENTORY_MULTIPART_MIN_BYTES ?? `${8 * 1024 * 1024}`,
);
const SINGLE_PUT_MAX_BYTES = MULTIPART_MIN_BYTES - 1;
/** Don't buffer a whole master file just to make a cover-art webp. */
const WEBP_COLLECT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * SHA-256 + byte count over an R2 GetObject body without holding the
 * object in RAM. Buffering the whole file here is what OOM-killed staging
 * (512MB) on a 2.5GB multipart complete. Optionally collect bytes only
 * when the object is small enough to be cover-art webp input.
 */
async function digestR2Body(
  body: AsyncIterable<Uint8Array>,
  collectMaxBytes: number | null,
): Promise<{ digest: Buffer; byteSize: number; collected: Buffer | null }> {
  const hash = createHash("sha256");
  let byteSize = 0;
  const chunks: Buffer[] = [];
  let collecting = collectMaxBytes != null;
  const iterator = body[Symbol.asyncIterator]();
  try {
    for (;;) {
      const { done, value } = await iterator.next();
      if (done) break;
      if (!value?.length) continue;
      const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
      hash.update(buf);
      byteSize += buf.length;
      if (collecting && collectMaxBytes != null) {
        if (byteSize > collectMaxBytes) {
          collecting = false;
          chunks.length = 0;
        } else {
          chunks.push(buf);
        }
      }
    }
  } finally {
    await iterator.return?.(undefined).catch(() => {});
  }
  return {
    digest: hash.digest(),
    byteSize,
    collected: collecting && chunks.length > 0 ? Buffer.concat(chunks) : null,
  };
}

function lexiconNs(): string {
  return process.env.LEXICON_NAMESPACE?.trim() || "diamonds.whereditgo.bazaar";
}

function col(suffix: string): string {
  return `${lexiconNs()}.${suffix}`;
}

function loadR2():
  | { ok: true; cfg: Extract<ReturnType<typeof r2ConfigFromEnv>, { ok: true }>; client: ReturnType<typeof getR2S3Client> }
  | { ok: false; reason: string } {
  const cfg = r2ConfigFromEnv();
  if (!cfg.ok) return { ok: false, reason: cfg.reason };
  return { ok: true, cfg, client: getR2S3Client(cfg) };
}

/**
 * Best-effort webp derivative, only for "artwork"-role objects (cover images
 * / the generic included-assets bin -- see newProductAssetKey). Stored as
 * `${r2Key}.webp`,
 * a sibling object -- never touches the original, and the product
 * download package always reads r2Key directly, never this.
 */
async function maybeGenerateWebpDerivative(
  r2: { cfg: { bucket: string }; client: ReturnType<typeof getR2S3Client> },
  obj: { role: string; r2Key: string },
  buf: Buffer,
): Promise<string | null> {
  if (obj.role !== "artwork") return null;
  const derivative = await generateWebpDerivative(buf);
  if (!derivative) return null;
  const webpKey = `${obj.r2Key}.webp`;
  try {
    await r2.client.send(
      new PutObjectCommand({
        Bucket: r2.cfg.bucket,
        Key: webpKey,
        Body: derivative,
        ContentType: "image/webp",
      }),
    );
    return webpKey;
  } catch (e) {
    console.warn("webp derivative upload failed:", e);
    return null;
  }
}

export function createInventoryRouter(db: Db, oauthClient: OAuthClient) {
  const r = new Hono();

  /**
   * Verify R2 credentials can reach the configured bucket (HeadBucket).
   * Use when debugging Access Denied on upload.
   */
  r.get("/r2-status", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const r2 = loadR2();
    if (!r2.ok) {
      return c.json({ configured: false, reason: r2.reason }, 503);
    }
    const { cfg, client } = r2;
    try {
      await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
      return c.json({
        configured: true,
        bucket: cfg.bucket,
        endpoint: cfg.endpoint,
        headBucket: "ok",
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "Error";
      const message = e instanceof Error ? e.message : String(e);
      return c.json(
        {
          configured: true,
          bucket: cfg.bucket,
          endpoint: cfg.endpoint,
          headBucket: "failed",
          error: { name, message },
          ...(isR2AccessDenied(name, message)
            ? { hints: r2AccessDeniedHints(cfg.bucket) }
            : {}),
        },
        502,
      );
    }
  });

  r.post("/sessions", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const r2 = loadR2();
    if (!r2.ok) return c.json({ error: "r2_unconfigured", message: r2.reason }, 503);

    const rawBody = await c.req.json().catch(() => ({}));
    const body = rawBody as { existingProductUri?: string };

    // "product" sessions reserve a product rkey up front so every object
    // uploaded in this session (items + assets) can be R2-keyed under it
    // from the first byte -- see lib/r2/inventoryKey.ts. Either the rkey
    // of an already-existing product (adding items/assets to it) or a
    // freshly minted TID that becomes that new product's actual rkey at
    // publish time.
    let productRkey: string;
    if (body.existingProductUri) {
      const product = db
        .select()
        .from(catalogProducts)
        .where(eq(catalogProducts.uri, body.existingProductUri))
        .get();
      if (!product || product.merchantDid !== sess.did) {
        return c.json({ error: "product_not_found" }, 404);
      }
      let at: AtUri;
      try {
        at = new AtUri(body.existingProductUri);
      } catch {
        return c.json({ error: "invalid_product_uri" }, 400);
      }
      if (!at.rkey) return c.json({ error: "invalid_product_uri" }, 400);
      productRkey = at.rkey;
    } else {
      productRkey = TID.nextStr();
    }

    const id = randomUUID();
    await db.insert(inventoryUploadSession).values({
      id,
      merchantDid: sess.did,
      status: "active",
      productRkey,
    });
    // For a brand-new product, hand back the URI it'll be created at --
    // productRkey is minted here, before the record exists, so the client
    // has no other way to know it. Lets the merchant UI poll zip-progress
    // for this product from the moment publishing starts, not just after
    // the response comes back.
    const productUri = productRkey
      ? (body.existingProductUri ?? `at://${sess.did}/${col("catalog.product")}/${productRkey}`)
      : null;
    return c.json({ sessionId: id, productUri });
  });

  r.get("/sessions", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const rows = await db
      .select()
      .from(inventoryUploadSession)
      .where(
        and(
          eq(inventoryUploadSession.merchantDid, sess.did),
          eq(inventoryUploadSession.status, "active"),
        ),
      )
      .orderBy(desc(inventoryUploadSession.updatedAt));
    return c.json({ sessions: rows });
  });

  r.get("/sessions/:sessionId", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const sessionId = c.req.param("sessionId");
    const [session] = await db
      .select()
      .from(inventoryUploadSession)
      .where(eq(inventoryUploadSession.id, sessionId));
    if (!session || session.merchantDid !== sess.did)
      return c.json({ error: "not_found" }, 404);
    const objects = await db
      .select()
      .from(inventoryUploadObject)
      .where(eq(inventoryUploadObject.sessionId, sessionId));
    const oids = objects.map((o) => o.id);
    const allParts =
      oids.length === 0
        ? []
        : await db
            .select()
            .from(inventoryUploadPart)
            .where(inArray(inventoryUploadPart.objectId, oids));
    const partsByObject = new Map<string, typeof allParts>();
    for (const o of objects) partsByObject.set(o.id, []);
    for (const p of allParts) {
      partsByObject.get(p.objectId)?.push(p);
    }
    const partsOut = objects.map((o) => ({
      objectId: o.id,
      parts: partsByObject.get(o.id) ?? [],
    }));
    return c.json({ session, objects, parts: partsOut });
  });

  r.post("/sessions/:sessionId/objects", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const r2 = loadR2();
    if (!r2.ok) return c.json({ error: "r2_unconfigured", message: r2.reason }, 503);

    const sessionId = c.req.param("sessionId");
    const [session] = await db
      .select()
      .from(inventoryUploadSession)
      .where(eq(inventoryUploadSession.id, sessionId));
    if (!session || session.merchantDid !== sess.did)
      return c.json({ error: "not_found" }, 404);
    if (session.status !== "active")
      return c.json({ error: "session_not_active" }, 400);

    const body = await c.req.json<{
      objects: Array<{
        slotId: string;
        rkey?: string;
        fileName: string;
        contentType?: string;
        byteSize?: number;
        role: "master" | "artwork";
      }>;
    }>();
    if (!body.objects?.length) return c.json({ error: "objects_required" }, 400);

    if (!session.productRkey) {
      return c.json({ error: "session_missing_product_rkey" }, 500);
    }

    const out: Array<{ objectId: string; rkey: string; r2Key: string; uploadKind: string }> = [];
    let firstMasterRkeyInBatch: string | null = null;
    for (const o of body.objects) {
      let rkey: string;
      if (o.role === "master") {
        rkey = o.rkey?.trim() || TID.nextStr();
        if (firstMasterRkeyInBatch === null) firstMasterRkeyInBatch = rkey;
      } else {
        rkey = firstMasterRkeyInBatch ?? (o.rkey?.trim() || TID.nextStr());
      }
      const id = randomUUID();
      const r2Key =
        o.role === "master"
          ? newProductItemKey(sess.did, session.productRkey!, id, o.fileName)
          : newProductAssetKey(sess.did, session.productRkey!, id, o.fileName);
      const uploadKind =
        o.byteSize != null && o.byteSize >= MULTIPART_MIN_BYTES
          ? "multipart"
          : "single_put";
      await db.insert(inventoryUploadObject).values({
        id,
        sessionId,
        slotId: o.slotId,
        rkey,
        role: o.role,
        fileName: o.fileName,
        contentType: o.contentType ?? null,
        byteSize: o.byteSize ?? null,
        uploadKind,
        status: "initiated",
        r2Key,
      });
      out.push({ objectId: id, rkey, r2Key, uploadKind });
    }
    await db
      .update(inventoryUploadSession)
      .set({ updatedAt: new Date() })
      .where(eq(inventoryUploadSession.id, sessionId));
    return c.json({ objects: out });
  });

  r.post("/objects/:objectId/upload-single", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const r2 = loadR2();
    if (!r2.ok) return c.json({ error: "r2_unconfigured", message: r2.reason }, 503);
    const { cfg, client } = r2;

    const objectId = c.req.param("objectId");
    const [obj] = await db
      .select()
      .from(inventoryUploadObject)
      .where(eq(inventoryUploadObject.id, objectId));
    if (!obj) return c.json({ error: "not_found" }, 404);
    const [session] = await db
      .select()
      .from(inventoryUploadSession)
      .where(eq(inventoryUploadSession.id, obj.sessionId));
    if (!session || session.merchantDid !== sess.did)
      return c.json({ error: "forbidden" }, 403);
    if (obj.uploadKind !== "single_put")
      return c.json({ error: "use_multipart" }, 400);
    if (obj.status === "completed") {
      if (!obj.fileChecksum || !obj.fileCid)
        return c.json({ error: "already_completed_inconsistent" }, 500);
      return c.json({
        fileChecksum: obj.fileChecksum,
        fileCid: obj.fileCid,
        fileFormat: obj.contentType || "application/octet-stream",
        r2Key: obj.r2Key,
      });
    }

    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob))
      return c.json({ error: "file_required" }, 400);

    let buf: Buffer;
    try {
      buf = Buffer.from(await file.arrayBuffer());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("inventory upload-single read body:", e);
      return c.json({ error: "read_failed", message: msg }, 400);
    }
    if (buf.length > SINGLE_PUT_MAX_BYTES)
      return c.json({ error: "file_too_large_use_multipart" }, 400);

    const hash = createHash("sha256").update(buf).digest();
    const fileChecksum = hash.toString("hex");
    const fileCid = cidFromSha256Digest32(new Uint8Array(hash));
    const fileFormat =
      (file instanceof File && file.type) || "application/octet-stream";

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: obj.r2Key,
          Body: buf,
          ContentType: fileFormat,
        }),
      );
    } catch (e) {
      const name = e instanceof Error ? e.name : "Error";
      const msg = e instanceof Error ? e.message : String(e);
      console.error("inventory upload-single PutObject:", name, msg);
      await db
        .update(inventoryUploadObject)
        .set({
          status: "failed",
          error: `${name}: ${msg}`,
          updatedAt: new Date(),
        })
        .where(eq(inventoryUploadObject.id, objectId));
      return c.json(
        {
          error: "r2_put_failed",
          name,
          message: msg,
          bucket: cfg.bucket,
          ...(isR2AccessDenied(name, msg)
            ? { hints: r2AccessDeniedHints(cfg.bucket) }
            : {}),
        },
        502,
      );
    }

    const webpR2Key = await maybeGenerateWebpDerivative(
      { cfg, client },
      { role: obj.role, r2Key: obj.r2Key },
      buf,
    );

    await db
      .update(inventoryUploadObject)
      .set({
        status: "completed",
        fileChecksum,
        fileCid,
        // Authoritative byte length from the bytes we just hashed -- overrides
        // the client-declared byteSize set at object registration.
        byteSize: buf.length,
        contentType: fileFormat,
        webpR2Key,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(inventoryUploadObject.id, objectId));
    await db
      .update(inventoryUploadSession)
      .set({ updatedAt: new Date() })
      .where(eq(inventoryUploadSession.id, obj.sessionId));

    return c.json({ fileChecksum, fileCid, fileFormat, r2Key: obj.r2Key });
  });

  r.post("/objects/:objectId/multipart/init", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const r2 = loadR2();
    if (!r2.ok) return c.json({ error: "r2_unconfigured", message: r2.reason }, 503);
    const { cfg, client } = r2;

    const objectId = c.req.param("objectId");
    const [obj] = await db
      .select()
      .from(inventoryUploadObject)
      .where(eq(inventoryUploadObject.id, objectId));
    if (!obj) return c.json({ error: "not_found" }, 404);
    const [session] = await db
      .select()
      .from(inventoryUploadSession)
      .where(eq(inventoryUploadSession.id, obj.sessionId));
    if (!session || session.merchantDid !== sess.did)
      return c.json({ error: "forbidden" }, 403);
    if (obj.uploadKind !== "multipart")
      return c.json({ error: "not_multipart" }, 400);

    if (obj.s3UploadId && obj.status !== "completed") {
      try {
        await client.send(
          new AbortMultipartUploadCommand({
            Bucket: cfg.bucket,
            Key: obj.r2Key,
            UploadId: obj.s3UploadId,
          }),
        );
      } catch (e) {
        const name = e instanceof Error ? e.name : "Error";
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("inventory multipart init abort prior upload:", name, msg);
      }
    }

    const ct = obj.contentType || "application/octet-stream";
    const created = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: cfg.bucket,
        Key: obj.r2Key,
        ContentType: ct,
      }),
    );
    const uploadId = created.UploadId;
    if (!uploadId) return c.json({ error: "multipart_init_failed" }, 500);

    await db
      .update(inventoryUploadObject)
      .set({
        s3UploadId: uploadId,
        status: "uploading",
        updatedAt: new Date(),
      })
      .where(eq(inventoryUploadObject.id, objectId));

    return c.json({ uploadId });
  });

  r.post("/objects/:objectId/multipart/part-url", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const r2 = loadR2();
    if (!r2.ok) return c.json({ error: "r2_unconfigured", message: r2.reason }, 503);
    const { cfg, client } = r2;

    const objectId = c.req.param("objectId");
    const body = await c.req.json<{ partNumber: number }>();
    const partNumber = body.partNumber;
    if (!Number.isInteger(partNumber) || partNumber < 1)
      return c.json({ error: "invalid_part" }, 400);

    const [obj] = await db
      .select()
      .from(inventoryUploadObject)
      .where(eq(inventoryUploadObject.id, objectId));
    if (!obj) return c.json({ error: "not_found" }, 404);
    const [session] = await db
      .select()
      .from(inventoryUploadSession)
      .where(eq(inventoryUploadSession.id, obj.sessionId));
    if (!session || session.merchantDid !== sess.did)
      return c.json({ error: "forbidden" }, 403);
    if (!obj.s3UploadId) return c.json({ error: "multipart_not_init" }, 400);

    const cmd = new UploadPartCommand({
      Bucket: cfg.bucket,
      Key: obj.r2Key,
      UploadId: obj.s3UploadId,
      PartNumber: partNumber,
    });
    const url = await getSignedUrl(client, cmd, { expiresIn: 3600 });
    return c.json({ url, partNumber });
  });

  /**
   * Browser-friendly multipart part upload: body is raw bytes (same as S3 UploadPart).
   * Avoids CORS on R2 presigned PUT from the web app origin.
   */
  r.post("/objects/:objectId/multipart/upload-part", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const r2 = loadR2();
    if (!r2.ok) return c.json({ error: "r2_unconfigured", message: r2.reason }, 503);
    const { cfg, client } = r2;

    const objectId = c.req.param("objectId");
    const partNumberRaw = c.req.header("x-inventory-part-number");
    const partNumber = parseInt(partNumberRaw ?? "", 10);
    if (!Number.isInteger(partNumber) || partNumber < 1)
      return c.json({ error: "invalid_part", detail: "Set X-Inventory-Part-Number" }, 400);

    const [obj] = await db
      .select()
      .from(inventoryUploadObject)
      .where(eq(inventoryUploadObject.id, objectId));
    if (!obj) return c.json({ error: "not_found" }, 404);
    const [session] = await db
      .select()
      .from(inventoryUploadSession)
      .where(eq(inventoryUploadSession.id, obj.sessionId));
    if (!session || session.merchantDid !== sess.did)
      return c.json({ error: "forbidden" }, 403);
    if (!obj.s3UploadId) return c.json({ error: "multipart_not_init" }, 400);

    let buf: Buffer;
    try {
      buf = Buffer.from(await c.req.arrayBuffer());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: "read_failed", message: msg }, 400);
    }
    if (buf.length === 0) return c.json({ error: "empty_body" }, 400);

    try {
      const out = await client.send(
        new UploadPartCommand({
          Bucket: cfg.bucket,
          Key: obj.r2Key,
          UploadId: obj.s3UploadId,
          PartNumber: partNumber,
          Body: buf,
        }),
      );
      const etag = out.ETag?.replaceAll('"', "") ?? "";
      if (!etag) return c.json({ error: "missing_etag" }, 500);
      return c.json({ partNumber, etag });
    } catch (e) {
      const name = e instanceof Error ? e.name : "Error";
      const msg = e instanceof Error ? e.message : String(e);
      console.error("inventory multipart upload-part:", name, msg);
      return c.json({ error: "upload_part_failed", name, message: msg }, 502);
    }
  });

  r.post("/objects/:objectId/multipart/complete", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const r2 = loadR2();
    if (!r2.ok) return c.json({ error: "r2_unconfigured", message: r2.reason }, 503);
    const { cfg, client } = r2;

    const objectId = c.req.param("objectId");
    const body = await c.req.json<{
      parts: Array<{ partNumber: number; etag: string }>;
    }>();
    if (!body.parts?.length) return c.json({ error: "parts_required" }, 400);

    const [obj] = await db
      .select()
      .from(inventoryUploadObject)
      .where(eq(inventoryUploadObject.id, objectId));
    if (!obj) return c.json({ error: "not_found" }, 404);
    const [session] = await db
      .select()
      .from(inventoryUploadSession)
      .where(eq(inventoryUploadSession.id, obj.sessionId));
    if (!session || session.merchantDid !== sess.did)
      return c.json({ error: "forbidden" }, 403);

    if (
      obj.status === "completed" &&
      obj.fileChecksum &&
      obj.fileCid
    ) {
      return c.json({
        fileChecksum: obj.fileChecksum,
        fileCid: obj.fileCid,
        fileFormat: obj.contentType || "application/octet-stream",
        r2Key: obj.r2Key,
      });
    }

    if (!obj.s3UploadId) return c.json({ error: "multipart_not_init" }, 400);

    const sorted = [...body.parts].sort((a, b) => a.partNumber - b.partNumber);

    try {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: cfg.bucket,
          Key: obj.r2Key,
          UploadId: obj.s3UploadId,
          MultipartUpload: {
            Parts: sorted.map((p) => ({
              PartNumber: p.partNumber,
              ETag: p.etag,
            })),
          },
        }),
      );

      const getObj = await client.send(
        new GetObjectCommand({ Bucket: cfg.bucket, Key: obj.r2Key }),
      );
      const bodyStream = getObj.Body;
      if (!bodyStream) {
        const short = "Could not read object from storage after upload";
        await db
          .update(inventoryUploadObject)
          .set({
            status: "failed",
            error: short,
            updatedAt: new Date(),
          })
          .where(eq(inventoryUploadObject.id, objectId));
        return c.json(
          { error: "multipart_complete_failed", message: short },
          500,
        );
      }
      const collectMax = obj.role === "artwork" ? WEBP_COLLECT_MAX_BYTES : null;
      const { digest, byteSize, collected } = await digestR2Body(
        bodyStream as unknown as AsyncIterable<Uint8Array>,
        collectMax,
      );
      const fileChecksum = digest.toString("hex");
      const fileCid = cidFromSha256Digest32(new Uint8Array(digest));
      const fileFormat = obj.contentType || "application/octet-stream";

      await db.delete(inventoryUploadPart).where(eq(inventoryUploadPart.objectId, objectId));
      for (const p of sorted) {
        await db.insert(inventoryUploadPart).values({
          objectId,
          partNumber: p.partNumber,
          etag: p.etag,
        });
      }

      const webpR2Key = collected
        ? await maybeGenerateWebpDerivative(
            { cfg, client },
            { role: obj.role, r2Key: obj.r2Key },
            collected,
          )
        : null;

      await db
        .update(inventoryUploadObject)
        .set({
          status: "completed",
          fileChecksum,
          fileCid,
          // Authoritative byte length from the streamed object -- overrides the
          // client-declared byteSize set at object registration.
          byteSize,
          webpR2Key,
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(inventoryUploadObject.id, objectId));
      await db
        .update(inventoryUploadSession)
        .set({ updatedAt: new Date() })
        .where(eq(inventoryUploadSession.id, obj.sessionId));

      return c.json({ fileChecksum, fileCid, fileFormat, r2Key: obj.r2Key });
    } catch (e) {
      const name = e instanceof Error ? e.name : "Error";
      const msg = e instanceof Error ? e.message : String(e);
      console.error("inventory multipart complete:", name, msg, objectId);
      const short =
        msg && msg.length < 400 ? `${name}: ${msg}` : `${name} (see server logs)`;
      await db
        .update(inventoryUploadObject)
        .set({
          status: "failed",
          error: short,
          updatedAt: new Date(),
        })
        .where(eq(inventoryUploadObject.id, objectId));
      return c.json(
        {
          error: "multipart_complete_failed",
          message: short || "Multipart complete failed",
        },
        502,
      );
    }
  });

  r.put("/sessions/:sessionId/draft", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const sessionId = c.req.param("sessionId");
    const [session] = await db
      .select()
      .from(inventoryUploadSession)
      .where(eq(inventoryUploadSession.id, sessionId));
    if (!session || session.merchantDid !== sess.did)
      return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<{ draft: unknown }>();
    await db
      .update(inventoryUploadSession)
      .set({
        draftJson: JSON.stringify(body.draft ?? {}),
        updatedAt: new Date(),
      })
      .where(eq(inventoryUploadSession.id, sessionId));
    return c.json({ ok: true });
  });

  /**
   * Publish path for catalog.item/catalog.product. Creates one catalog.item per uploaded
   * item file, then one catalog.product referencing them via defs#ref[],
   * then captures both into the ERP mirror tables directly (server-side PDS
   * writes here bypass the /repo/createRecord proxy's automatic capture
   * hook, so this calls captureCatalogItem/captureCatalogProduct itself --
   * the same functions that hook and the merchant "Sync with PDS" action
   * use). No rights/composition sub-flow and no license step: catalog.item
   * has no fields for either, and licensing is chosen only when a listing
   * is created.
   */
  r.post("/sessions/:sessionId/publish-product", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const sessionId = c.req.param("sessionId");
    const [session] = await db
      .select()
      .from(inventoryUploadSession)
      .where(eq(inventoryUploadSession.id, sessionId));
    if (!session || session.merchantDid !== sess.did)
      return c.json({ error: "not_found" }, 404);
    if (session.status !== "active")
      return c.json({ error: "session_not_active" }, 400);
    if (!session.productRkey) {
      return c.json({ error: "session_missing_product_rkey" }, 500);
    }

    const objects = await db
      .select()
      .from(inventoryUploadObject)
      .where(eq(inventoryUploadObject.sessionId, sessionId));
    const masters = objects.filter((o) => o.role === "master");
    for (const m of masters) {
      if (m.status !== "completed" || !m.fileChecksum || !m.fileCid) {
        return c.json({ error: "incomplete_uploads", objectId: m.id }, 400);
      }
    }

    let draft: PublishProductDraftV1;
    try {
      draft = parsePublishProductDraft(session.draftJson);
    } catch {
      return c.json({ error: "invalid_draft" }, 400);
    }
    if (!draft.product?.title?.trim()) {
      return c.json({ error: "product_title_required" }, 400);
    }
    if (!draft.items?.length) {
      return c.json({ error: "items_required" }, 400);
    }

    const artObjs: Array<(typeof objects)[number]> = [];
    for (const artworkObjectId of draft.product.artworkObjectIds ?? []) {
      const artObj = objects.find((o) => o.id === artworkObjectId && o.role === "artwork");
      if (!artObj || artObj.status !== "completed") {
        return c.json({ error: "invalid_product_artwork", objectId: artworkObjectId }, 400);
      }
      artObjs.push(artObj);
    }

    const includedAssetObjs: Array<{ obj: (typeof objects)[number]; role: string }> = [];
    for (const asset of draft.product.includedAssets ?? []) {
      const obj = objects.find((o) => o.id === asset.objectId && o.role === "artwork");
      if (!obj || obj.status !== "completed") {
        return c.json({ error: "invalid_included_asset", objectId: asset.objectId }, 400);
      }
      includedAssetObjs.push({ obj, role: asset.role?.trim() || obj.fileName });
    }

    const masterByObjectId = new Map(masters.map((m) => [m.id, m]));
    const itemType = col("catalog.item");
    const productType = col("catalog.product");

    const createdItems: Array<{ uri: string; cid: string }> = [];
    for (const it of draft.items) {
      const mo = masterByObjectId.get(it.objectId);
      if (!mo) {
        return c.json({ error: "unknown_item_object", objectId: it.objectId }, 400);
      }
      if (!it.title?.trim()) {
        return c.json({ error: "item_title_required", objectId: it.objectId }, 400);
      }
      const record: Record<string, unknown> = {
        $type: itemType,
        title: it.title.trim(),
        merchantDid: sess.did,
        fileChecksum: mo.fileChecksum!,
        fileCid: mo.fileCid!,
        format: it.format?.trim() || inferFormat(mo.fileName, mo.contentType),
        createdAt: new Date().toISOString(),
      };
      if (it.category?.trim()) record.category = it.category.trim();
      if (it.tags?.length) record.tags = it.tags;

      let res;
      try {
        res = await sess.agent.com.atproto.repo.createRecord({
          repo: sess.did,
          collection: itemType,
          record,
        });
      } catch (e) {
        console.error("publish: item createRecord failed", it.objectId, e);
        return c.json(
          {
            error: "pds_write_failed",
            phase: "item",
            objectId: it.objectId,
            message: e instanceof Error ? e.message : String(e),
          },
          502,
        );
      }
      await captureCatalogItem(db, sess.did, record, res.data.uri, res.data.cid, {
        objectId: mo.id,
      });
      await applyUploadMediaMeta(db, mo.id, it);
      createdItems.push({ uri: res.data.uri, cid: res.data.cid });
    }

    const productRecord: Record<string, unknown> = {
      $type: productType,
      title: draft.product.title.trim(),
      merchantDid: sess.did,
      items: createdItems.map((it) => ({ uri: it.uri, cid: it.cid })),
      createdAt: new Date().toISOString(),
    };
    if (draft.product.description?.trim()) {
      productRecord.description = draft.product.description.trim().slice(0, 4096);
    }
    if (draft.product.tags?.length) productRecord.tags = draft.product.tags;

    let productRes;
    try {
      productRes = await sess.agent.com.atproto.repo.createRecord({
        repo: sess.did,
        collection: productType,
        rkey: session.productRkey,
        record: productRecord,
      });
    } catch (e) {
      // A retry after a prior attempt partially succeeded (e.g. items were
      // created but the response was lost before the client saw it) will
      // land here, since this reuses the same session.productRkey every
      // time -- the PDS rejects a second createRecord at an already-used
      // rkey. Surfacing that plainly beats an opaque 500 on retry.
      console.error("publish-product: product createRecord failed", session.productRkey, e);
      return c.json(
        {
          error: "pds_write_failed",
          phase: "product",
          message: e instanceof Error ? e.message : String(e),
        },
        502,
      );
    }
    await captureCatalogProduct(
      db,
      sess.did,
      productRecord,
      productRes.data.uri,
      productRes.data.cid,
      {
        productType: draft.product.productType,
        artIncludedInDownload: draft.product.artIncludedInDownload,
      },
    );

    for (let i = 0; i < artObjs.length; i++) {
      await db.insert(catalogProductAssets).values({
        id: randomUUID(),
        productUri: productRes.data.uri,
        objectId: artObjs[i].id,
        role: "coverArt",
        position: i,
      });
    }
    for (const { obj, role } of includedAssetObjs) {
      await db.insert(catalogProductAssets).values({
        id: randomUUID(),
        productUri: productRes.data.uri,
        objectId: obj.id,
        role,
      });
    }

    // After the asset inserts above, not right after captureCatalogProduct --
    // the cover art / included assets rows don't exist yet at that point, so
    // building the first cache entry there would miss them.
    void rebuildProductZipCacheByUri(db, productRes.data.uri);

    const snapshot = {
      productUri: productRes.data.uri,
      productCid: productRes.data.cid,
      items: createdItems,
    };
    await db
      .update(inventoryUploadSession)
      .set({
        status: "completed",
        publishedAt: new Date(),
        publishError: null,
        pdsSnapshotJson: JSON.stringify(snapshot),
        updatedAt: new Date(),
      })
      .where(eq(inventoryUploadSession.id, sessionId));

    return c.json(snapshot);
  });

  /**
   * Publish just catalog.item records with no product wrapper -- used when
   * adding a new item to an *existing* product (the product itself is
   * updated separately via a normal putRecord once the item exists). Same
   * validation/capture pattern as publish-product's item loop, factored out
   * so both endpoints stay in sync rather than duplicating the field logic.
   */
  r.post("/sessions/:sessionId/publish-items", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const sessionId = c.req.param("sessionId");
    const [session] = await db
      .select()
      .from(inventoryUploadSession)
      .where(eq(inventoryUploadSession.id, sessionId));
    if (!session || session.merchantDid !== sess.did)
      return c.json({ error: "not_found" }, 404);
    if (session.status !== "active")
      return c.json({ error: "session_not_active" }, 400);

    const objects = await db
      .select()
      .from(inventoryUploadObject)
      .where(eq(inventoryUploadObject.sessionId, sessionId));
    const masters = objects.filter((o) => o.role === "master");
    for (const m of masters) {
      if (m.status !== "completed" || !m.fileChecksum || !m.fileCid) {
        return c.json({ error: "incomplete_uploads", objectId: m.id }, 400);
      }
    }

    let draft: { items?: PublishProductDraftV1["items"] };
    try {
      draft = JSON.parse(session.draftJson ?? "null") as {
        items?: PublishProductDraftV1["items"];
      };
    } catch {
      return c.json({ error: "invalid_draft" }, 400);
    }
    if (!draft.items?.length) {
      return c.json({ error: "items_required" }, 400);
    }

    const masterByObjectId = new Map(masters.map((m) => [m.id, m]));
    const itemType = col("catalog.item");

    const createdItems: Array<{ uri: string; cid: string }> = [];
    for (const it of draft.items) {
      const mo = masterByObjectId.get(it.objectId);
      if (!mo) {
        return c.json({ error: "unknown_item_object", objectId: it.objectId }, 400);
      }
      if (!it.title?.trim()) {
        return c.json({ error: "item_title_required", objectId: it.objectId }, 400);
      }
      const record: Record<string, unknown> = {
        $type: itemType,
        title: it.title.trim(),
        merchantDid: sess.did,
        fileChecksum: mo.fileChecksum!,
        fileCid: mo.fileCid!,
        format: it.format?.trim() || inferFormat(mo.fileName, mo.contentType),
        createdAt: new Date().toISOString(),
      };
      if (it.category?.trim()) record.category = it.category.trim();
      if (it.tags?.length) record.tags = it.tags;

      let res;
      try {
        res = await sess.agent.com.atproto.repo.createRecord({
          repo: sess.did,
          collection: itemType,
          record,
        });
      } catch (e) {
        console.error("publish: item createRecord failed", it.objectId, e);
        return c.json(
          {
            error: "pds_write_failed",
            phase: "item",
            objectId: it.objectId,
            message: e instanceof Error ? e.message : String(e),
          },
          502,
        );
      }
      await captureCatalogItem(db, sess.did, record, res.data.uri, res.data.cid, {
        objectId: mo.id,
      });
      await applyUploadMediaMeta(db, mo.id, it);
      createdItems.push({ uri: res.data.uri, cid: res.data.cid });
    }

    await db
      .update(inventoryUploadSession)
      .set({
        status: "completed",
        publishedAt: new Date(),
        publishError: null,
        pdsSnapshotJson: JSON.stringify({ items: createdItems }),
        updatedAt: new Date(),
      })
      .where(eq(inventoryUploadSession.id, sessionId));

    return c.json({ items: createdItems });
  });

  return r;
}

type PublishProductDraftV1 = {
  product: {
    title: string;
    description?: string;
    tags?: string[];
    /** One or more cover images, in slideshow order -- single-image types just send one. */
    artworkObjectIds?: string[];
    /** UI-only classification (e.g. "music", "generic") -- see captureCatalogProduct. */
    productType?: string;
    /** Whether the cover art asset is bundled into the buyer's download package. */
    artIncludedInDownload?: boolean;
    /**
     * The generic included-assets bin (catalogProductAssets) -- companion
     * files always bundled into the download, distinct from cover art
     * (which has its own toggle) and from `items` (the public composition).
     */
    includedAssets?: Array<{ objectId: string; role: string }>;
  };
  items: Array<{
    objectId: string;
    title: string;
    category?: string;
    tags?: string[];
    format?: string;
    /** Parsed client-side from the audio/video file itself; absent for other types or when parsing failed. */
    durationMs?: number;
    /** Pixel dimensions parsed client-side for raster images; absent otherwise. */
    width?: number;
    height?: number;
  }>;
};

/**
 * Persist the client-parsed media metadata (runtime, pixel dimensions) for an
 * item's master upload object. ERP-only -- never touches the PDS record. A
 * no-op when the client couldn't parse anything.
 */
async function applyUploadMediaMeta(
  db: Db,
  objectId: string,
  meta: { durationMs?: number; width?: number; height?: number },
): Promise<void> {
  const set: Partial<{
    durationMs: number;
    mediaWidth: number;
    mediaHeight: number;
  }> = {};
  if (typeof meta.durationMs === "number" && meta.durationMs > 0)
    set.durationMs = Math.round(meta.durationMs);
  if (typeof meta.width === "number" && meta.width > 0)
    set.mediaWidth = Math.round(meta.width);
  if (typeof meta.height === "number" && meta.height > 0)
    set.mediaHeight = Math.round(meta.height);
  if (Object.keys(set).length === 0) return;
  await db
    .update(inventoryUploadObject)
    .set(set)
    .where(eq(inventoryUploadObject.id, objectId));
}

function parsePublishProductDraft(raw: string | null): PublishProductDraftV1 {
  if (!raw) throw new Error("empty");
  const d = JSON.parse(raw) as PublishProductDraftV1;
  if (!d.product || typeof d.product !== "object") throw new Error("product");
  if (!d.items || !Array.isArray(d.items)) throw new Error("items");
  return d;
}

/** Generic, non-audio-specific single-format guess: file extension, falling back to the MIME subtype. */
function inferFormat(fileName: string, contentType?: string | null): string {
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext) return ext;
  const subtype = contentType?.split("/")[1];
  return subtype || "other";
}

