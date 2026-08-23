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
  inventoryPrefillLog,
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
  INVENTORY_ARTWORK_OBJECT_NAME,
  INVENTORY_MASTER_OBJECT_NAME,
  inventoryObjectKey,
  newInventoryAssetKey,
} from "../lib/r2/inventoryKey";
import {
  isR2AccessDenied,
  r2AccessDeniedHints,
} from "../lib/r2/diagnostics";
import { getR2S3Client } from "../lib/r2/s3Client";
import {
  buildBazaarPid,
  buildBazaarRid,
  buildBazaarWid,
  identifiersSigningConfigured,
  type WidWriterInput,
} from "../lib/bazaarIdentifiers";

const MULTIPART_MIN_BYTES = Number(
  process.env.BAZAAR_INVENTORY_MULTIPART_MIN_BYTES ?? `${8 * 1024 * 1024}`,
);
const SINGLE_PUT_MAX_BYTES = MULTIPART_MIN_BYTES - 1;

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
    const body = rawBody as { inventoryKind?: string };
    const id = randomUUID();
    await db.insert(inventoryUploadSession).values({
      id,
      merchantDid: sess.did,
      inventoryKind: body.inventoryKind ?? "digital",
      status: "active",
    });
    return c.json({ sessionId: id });
  });

  r.get("/prefill/latest", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);
    const row = await db
      .select()
      .from(inventoryPrefillLog)
      .where(eq(inventoryPrefillLog.merchantDid, sess.did))
      .orderBy(desc(inventoryPrefillLog.createdAt))
      .limit(1)
      .get();
    if (!row) return c.json({ prefill: null });
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payloadJson);
    } catch {
      return c.json({ error: "prefill_corrupt" }, 500);
    }
    return c.json({
      prefill: parsed,
      id: row.id,
      createdAt: row.createdAt?.toISOString?.() ?? null,
    });
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
        session.inventoryKind === "product"
          ? newInventoryAssetKey(sess.did, id, o.fileName)
          : inventoryObjectKey(
              sess.did,
              rkey,
              o.role === "artwork" ? INVENTORY_ARTWORK_OBJECT_NAME : INVENTORY_MASTER_OBJECT_NAME,
            );
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

    await db
      .update(inventoryUploadObject)
      .set({
        status: "completed",
        fileChecksum,
        fileCid,
        contentType: fileFormat,
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
      if (
        !bodyStream ||
        typeof (bodyStream as { transformToByteArray?: unknown }).transformToByteArray !==
          "function"
      ) {
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
      const bytes = await (
        bodyStream as { transformToByteArray: () => Promise<Uint8Array> }
      ).transformToByteArray();
      const digest = createHash("sha256").update(Buffer.from(bytes)).digest();
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

      await db
        .update(inventoryUploadObject)
        .set({
          status: "completed",
          fileChecksum,
          fileCid,
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

  r.post("/sessions/:sessionId/publish", async (c) => {
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

    let draft: PublishDraftV1;
    try {
      draft = parsePublishDraft(session.draftJson);
    } catch {
      return c.json({ error: "invalid_draft" }, 400);
    }

    if (
      (draft.licenseUri && !draft.licenseGrantCid) ||
      (!draft.licenseUri && draft.licenseGrantCid)
    ) {
      return c.json({ error: "invalid_license_fields" }, 400);
    }
    if (!draft.tracks?.length) return c.json({ error: "tracks_required" }, 400);

    if (!draft.collection) {
      return c.json({ error: "collection_required" }, 400);
    }
    if (!draft.licenseUri || !draft.licenseGrantCid) {
      return c.json({ error: "license_required" }, 400);
    }
    if (!identifiersSigningConfigured()) {
      return c.json({ error: "identifiers_unconfigured" }, 503);
    }

    const masterByObjectId = new Map(masters.map((m) => [m.id, m]));
    const uriByObjectId = new Map<string, { uri: string; cid: string }>();
    const createdItems: { uri: string; cid: string; rkey: string }[] = [];

    const digitalType = col("catalog.item.digital");
    const collectionType = col("catalog.collection");
    const compositionType = col("catalog.composition");
    const recordingType = col("catalog.recording");

    const rel = draft.collection!;
    let collectionArtworkCid: string | undefined;
    if (rel.artworkObjectId) {
      const ao = objects.find(
        (o) => o.id === rel.artworkObjectId && o.role === "artwork",
      );
      if (!ao || ao.status !== "completed" || !ao.fileCid) {
        return c.json(
          {
            error: "invalid_collection_artwork",
            objectId: rel.artworkObjectId,
          },
          400,
        );
      }
      collectionArtworkCid = ao.fileCid;
    }
    const collectionReleaseIso = rel.releaseDate ?? new Date().toISOString();

    const WRITER_ROLES = new Set([
      "composer",
      "lyricist",
      "composerLyricist",
      "arranger",
      "adapter",
    ]);

    for (const t of draft.tracks) {
      const mo = masterByObjectId.get(t.objectId);
      if (!mo)
        return c.json(
          { error: "unknown_track_object", objectId: t.objectId },
          400,
        );
      if (!t.title?.trim()) {
        return c.json(
          { error: "track_title_required", objectId: t.objectId },
          400,
        );
      }
      const formats = t.formats?.length
        ? t.formats
        : inferFormats(mo.fileName, mo.contentType);
      const createdAt = new Date().toISOString();
      let bazaarRid: ReturnType<typeof buildBazaarRid>;
      try {
        bazaarRid = buildBazaarRid({
          artistDid: sess.did,
          fileCid: mo.fileCid!,
          fileChecksum: mo.fileChecksum!,
          createdAt,
        });
      } catch (e) {
        console.error("buildBazaarRid:", e);
        return c.json({ error: "identifier_sign_failed", phase: "rid" }, 500);
      }

      const record: Record<string, unknown> = {
        $type: digitalType,
        title: t.title.trim(),
        artistDid: sess.did,
        itemClass: t.itemClass,
        formats,
        fileChecksum: mo.fileChecksum!,
        fileCid: mo.fileCid!,
        fileFormat: mo.contentType ?? undefined,
        durationMs: t.durationMs ?? mo.durationMs ?? undefined,
        description: t.description,
        genre: t.genre,
        releaseDate: collectionReleaseIso,
        createdAt,
        bazaarRid,
      };
      if (t.isrc?.trim()) record.isrc = t.isrc.trim();
      record.defaultLicenseUri = draft.licenseUri;

      if (t.artworkObjectId) {
        const art = objects.find(
          (o) => o.id === t.artworkObjectId && o.role === "artwork",
        );
        if (!art || art.status !== "completed" || !art.fileCid)
          return c.json(
            { error: "invalid_artwork", objectId: t.artworkObjectId },
            400,
          );
        record.artworkCid = art.fileCid;
      } else if (
        collectionArtworkCid &&
        AUDIO_DIGITAL_ITEM_CLASSES.has(t.itemClass)
      ) {
        record.artworkCid = collectionArtworkCid;
      }

      const res = await sess.agent.com.atproto.repo.createRecord({
        repo: sess.did,
        collection: digitalType,
        rkey: mo.rkey,
        record: record,
      });
      uriByObjectId.set(t.objectId, { uri: res.data.uri, cid: res.data.cid });
      createdItems.push({ uri: res.data.uri, cid: res.data.cid, rkey: mo.rkey });

      if (t.itemClass !== "track") continue;

      const rights = t.rights;
      const masterDid = rights?.masterOwnerDid?.trim() || sess.did;
      const pubDid = rights?.publishingOwnerDid?.trim() || sess.did;
      const pubIpi = rights?.publishingOwnerIpi?.trim();

      let songMetaUri: string | undefined;
      let compositionBazaarWid: Record<string, unknown> | null = null;

      const pathExisting =
        rights?.compositionPath === "existing" &&
        !!rights.existingCompositionUri?.trim();

      if (pathExisting) {
        songMetaUri = rights!.existingCompositionUri!.trim();
        const snap = parseBazaarIdentifierFromDraft(rights?.existingBazaarWid);
        if (snap) compositionBazaarWid = snap as unknown as Record<string, unknown>;
      } else {
        const compTitle =
          rights?.compositionTitle?.trim() || t.title.trim();
        const compCreatedAt = new Date().toISOString();
        let bazaarWid: ReturnType<typeof buildBazaarWid>;
        try {
          bazaarWid = buildBazaarWid({
            artistDid: sess.did,
            compositionTitle: compTitle,
            writers: widInputsFromDraftWriters(rights?.writers),
            createdAt: compCreatedAt,
          });
        } catch (e) {
          console.error("buildBazaarWid:", e);
          return c.json({ error: "identifier_sign_failed", phase: "wid" }, 500);
        }
        compositionBazaarWid = bazaarWid as unknown as Record<string, unknown>;

        const compRecord: Record<string, unknown> = {
          $type: compositionType,
          title: compTitle,
          artistDid: sess.did,
          createdAt: compCreatedAt,
          bazaarWid,
        };
        if (rights?.iswc?.trim()) compRecord.iswc = rights.iswc.trim();
        const ws = (rights?.writers ?? [])
          .filter((w) => w.name?.trim())
          .map((w) => {
            const row: Record<string, unknown> = { name: w.name!.trim() };
            if (w.ipi?.trim()) row.ipi = w.ipi.trim();
            if (w.did?.trim()) row.did = w.did.trim();
            if (typeof w.share === "number" && Number.isFinite(w.share))
              row.share = w.share;
            const role = w.role?.trim();
            if (role && WRITER_ROLES.has(role)) row.role = role;
            return row;
          });
        if (ws.length) compRecord.writers = ws;
        const pubs = (rights?.publishers ?? [])
          .filter((p) => p.name?.trim())
          .map((p) => {
            const row: Record<string, unknown> = { name: p.name!.trim() };
            if (p.ipi?.trim()) row.ipi = p.ipi.trim();
            if (p.did?.trim()) row.did = p.did.trim();
            if (p.pro?.trim()) row.pro = p.pro.trim();
            if (typeof p.share === "number" && Number.isFinite(p.share))
              row.share = p.share;
            return row;
          });
        if (pubs.length) compRecord.publishers = pubs;
        const prs = (rights?.proRegistrations ?? [])
          .filter((r) => r.pro?.trim())
          .map((r) => {
            const row: Record<string, unknown> = { pro: r.pro!.trim() };
            if (r.registrationId?.trim())
              row.registrationId = r.registrationId.trim();
            if (r.territory?.trim()) row.territory = r.territory.trim();
            return row;
          });
        if (prs.length) compRecord.proRegistrations = prs;
        if (
          typeof rights?.copyrightYear === "number" &&
          Number.isFinite(rights.copyrightYear)
        ) {
          compRecord.copyrightYear = rights.copyrightYear;
        }
        if (rights?.copyrightRegistrationId?.trim()) {
          compRecord.copyrightRegistrationId =
            rights.copyrightRegistrationId.trim();
        }

        const compRes = await sess.agent.com.atproto.repo.createRecord({
          repo: sess.did,
          collection: compositionType,
          record: compRecord,
        });
        songMetaUri = compRes.data.uri;
      }

      const recCreatedAt = new Date().toISOString();
      const recRecord: Record<string, unknown> = {
        $type: recordingType,
        itemUri: res.data.uri,
        itemCid: res.data.cid,
        createdAt: recCreatedAt,
        bazaarRid,
        masterOwnerDid: masterDid,
        publishingOwnerDid: pubDid,
      };
      if (songMetaUri) recRecord.songMetaUri = songMetaUri;
      if (compositionBazaarWid) recRecord.bazaarWid = compositionBazaarWid;
      if (t.isrc?.trim()) recRecord.isrc = t.isrc.trim();
      if (rights?.iswc?.trim()) recRecord.iswc = rights.iswc.trim();
      if (pubIpi) recRecord.publishingOwnerIpi = pubIpi;

      await sess.agent.com.atproto.repo.createRecord({
        repo: sess.did,
        collection: recordingType,
        record: recRecord,
      });
    }

    let primaryItemUri = createdItems[0]!.uri;

    {
      const slots: CollectionItemSlotV1[] =
        rel.itemSlots?.length
          ? rel.itemSlots
          : buildLegacyTrackSlots(rel.trackObjectIds);
      if (!slots.length) {
        return c.json({ error: "collection_items_required" }, 400);
      }
      for (const slot of slots) {
        if (!uriByObjectId.has(slot.objectId)) {
          return c.json(
            { error: "collection_unknown_object", objectId: slot.objectId },
            400,
          );
        }
      }
      const items = slots.map((slot) => {
        const u = uriByObjectId.get(slot.objectId)!;
        const entry: Record<string, unknown> = {
          uri: u.uri,
          cid: u.cid,
          role: slot.role,
        };
        if (slot.trackNumber != null) entry.trackNumber = slot.trackNumber;
        if (slot.discNumber != null) entry.discNumber = slot.discNumber;
        if (slot.title?.trim()) entry.title = slot.title.trim();
        return entry;
      });
      const colRecord: Record<string, unknown> = {
        $type: collectionType,
        title: rel.title,
        artistDid: sess.did,
        releaseDate: rel.releaseDate ?? new Date().toISOString(),
        items,
        createdAt: new Date().toISOString(),
        defaultLicenseUri: draft.licenseUri,
      };
      if (rel.collectionType) colRecord.collectionType = rel.collectionType;
      if (rel.description?.trim())
        colRecord.description = rel.description.trim().slice(0, 4096);
      if (rel.genre?.length) colRecord.genre = rel.genre;
      if (rel.upc?.trim()) colRecord.upc = rel.upc.trim();
      if (collectionArtworkCid) colRecord.artworkCid = collectionArtworkCid;
      const colRes = await sess.agent.com.atproto.repo.createRecord({
        repo: sess.did,
        collection: collectionType,
        record: colRecord,
      });
      primaryItemUri = colRes.data.uri;
      const collectionUri = colRes.data.uri;

      const individualPurchaseTrackUris: string[] = [];
      for (const slot of slots) {
        if (slot.allowIndividualPurchase !== true) continue;
        const u = uriByObjectId.get(slot.objectId);
        if (u) individualPurchaseTrackUris.push(u.uri);
      }
      await db.insert(inventoryPrefillLog).values({
        id: randomUUID(),
        merchantDid: sess.did,
        payloadJson: JSON.stringify({
          v: 1,
          primaryItemUri: collectionUri,
          collectionUri,
          licenseUri: draft.licenseUri,
          licenseGrantCid: draft.licenseGrantCid,
          priceUsd: "9.99",
          individualPurchaseTrackUris,
        }),
      });
      const colAtUri = new AtUri(collectionUri);
      const collectionRkeyForPid = colAtUri.rkey;
      if (!collectionRkeyForPid) {
        return c.json({ error: "missing_collection_rkey" }, 500);
      }

      let bazaarPid: ReturnType<typeof buildBazaarPid>;
      try {
        bazaarPid = buildBazaarPid({
          artistDid: sess.did,
          collectionUri,
          releaseDate: rel.releaseDate ?? new Date().toISOString(),
        });
      } catch (e) {
        console.error("buildBazaarPid:", e);
        return c.json({ error: "identifier_sign_failed", phase: "pid" }, 500);
      }

      const colFetched = await sess.agent.com.atproto.repo.getRecord({
        repo: sess.did,
        collection: collectionType,
        rkey: collectionRkeyForPid,
      });
      const colValue = colFetched.data.value as Record<string, unknown>;
      await sess.agent.com.atproto.repo.putRecord({
        repo: sess.did,
        collection: collectionType,
        rkey: collectionRkeyForPid,
        swapRecord: colFetched.data.cid,
        record: { ...colValue, bazaarPid },
      });

      for (const item of createdItems) {
        const itemAt = new AtUri(item.uri);
        const itemRkey = itemAt.rkey;
        if (!itemRkey) continue;
        const cur = await sess.agent.com.atproto.repo.getRecord({
          repo: sess.did,
          collection: digitalType,
          rkey: itemRkey,
        });
        const v = cur.data.value as Record<string, unknown>;
        await sess.agent.com.atproto.repo.putRecord({
          repo: sess.did,
          collection: digitalType,
          rkey: itemRkey,
          swapRecord: cur.data.cid,
          record: { ...v, collectionUri },
        });
      }

      if (collectionArtworkCid) {
        const r2 = loadR2();
        if (!r2.ok) {
          return c.json({ error: "r2_unconfigured", message: r2.reason }, 503);
        }
        try {
          const colAt = new AtUri(colRes.data.uri);
          const collectionRkey = colAt.rkey;
          if (!collectionRkey) throw new Error("missing_collection_rkey");
          const artObj = objects.find(
            (o) => o.id === rel.artworkObjectId && o.role === "artwork",
          );
          if (!artObj) throw new Error("missing_artwork_object");
          const srcKey = inventoryObjectKey(
            sess.did,
            artObj.rkey,
            INVENTORY_ARTWORK_OBJECT_NAME,
          );
          const dstKey = inventoryObjectKey(
            sess.did,
            collectionRkey,
            INVENTORY_ARTWORK_OBJECT_NAME,
          );
          const copySource = `${r2.cfg.bucket}/${srcKey
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`;
          await r2.client.send(
            new CopyObjectCommand({
              Bucket: r2.cfg.bucket,
              Key: dstKey,
              CopySource: copySource,
            }),
          );
        } catch (e) {
          console.error("inventory publish collection artwork copy:", e);
          return c.json(
            {
              error: "artwork_copy_failed",
              message: e instanceof Error ? e.message : String(e),
            },
            500,
          );
        }
      }
    }

    const snapshot = {
      items: createdItems,
      primaryItemUri,
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
   * Publish path for catalog.item/catalog.product -- parallel to /publish
   * above, not a replacement for it. Creates one catalog.item per uploaded
   * item file, then one catalog.product referencing them via itemRef[],
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

    let artObj: (typeof objects)[number] | undefined;
    if (draft.product.artworkObjectId) {
      artObj = objects.find(
        (o) => o.id === draft.product.artworkObjectId && o.role === "artwork",
      );
      if (!artObj || artObj.status !== "completed") {
        return c.json(
          { error: "invalid_product_artwork", objectId: draft.product.artworkObjectId },
          400,
        );
      }
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
        sellerDid: sess.did,
        fileChecksum: mo.fileChecksum!,
        fileCid: mo.fileCid!,
        format: it.format?.trim() || inferFormat(mo.fileName, mo.contentType),
        createdAt: new Date().toISOString(),
      };
      if (it.category?.trim()) record.category = it.category.trim();

      const res = await sess.agent.com.atproto.repo.createRecord({
        repo: sess.did,
        collection: itemType,
        record,
      });
      await captureCatalogItem(db, sess.did, record, res.data.uri, res.data.cid, {
        objectId: mo.id,
      });
      createdItems.push({ uri: res.data.uri, cid: res.data.cid });
    }

    const productRecord: Record<string, unknown> = {
      $type: productType,
      title: draft.product.title.trim(),
      sellerDid: sess.did,
      items: createdItems.map((it) => ({ uri: it.uri, cid: it.cid })),
      createdAt: new Date().toISOString(),
    };
    if (draft.product.description?.trim()) {
      productRecord.description = draft.product.description.trim().slice(0, 4096);
    }

    const productRes = await sess.agent.com.atproto.repo.createRecord({
      repo: sess.did,
      collection: productType,
      record: productRecord,
    });
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

    if (artObj) {
      await db.insert(catalogProductAssets).values({
        id: randomUUID(),
        productUri: productRes.data.uri,
        objectId: artObj.id,
        role: "coverArt",
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
        sellerDid: sess.did,
        fileChecksum: mo.fileChecksum!,
        fileCid: mo.fileCid!,
        format: it.format?.trim() || inferFormat(mo.fileName, mo.contentType),
        createdAt: new Date().toISOString(),
      };
      if (it.category?.trim()) record.category = it.category.trim();

      const res = await sess.agent.com.atproto.repo.createRecord({
        repo: sess.did,
        collection: itemType,
        record,
      });
      await captureCatalogItem(db, sess.did, record, res.data.uri, res.data.cid, {
        objectId: mo.id,
      });
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

type CollectionItemSlotV1 = {
  objectId: string;
  role: "track" | "video" | "document" | "artwork" | "bonus" | "other";
  /** When true, merchant intends per-track listings; stored in prefill log only. */
  allowIndividualPurchase?: boolean;
  trackNumber?: number;
  discNumber?: number;
  title?: string;
};

function buildLegacyTrackSlots(
  trackObjectIds: string[] | undefined,
): CollectionItemSlotV1[] {
  if (!trackObjectIds?.length) return [];
  return trackObjectIds.map((objectId, i) => ({
    objectId,
    role: "track" as const,
    trackNumber: i + 1,
  }));
}

type PublishDraftRightsWriter = {
  name: string;
  ipi?: string;
  did?: string;
  share?: number;
  role?: string;
};

type PublishDraftRightsPublisher = {
  name: string;
  ipi?: string;
  did?: string;
  pro?: string;
  share?: number;
};

type PublishDraftRightsProReg = {
  pro: string;
  registrationId?: string;
  territory?: string;
};

type PublishDraftTrackRights = {
  compositionPath?: "new" | "existing";
  existingCompositionUri?: string;
  existingCompositionCid?: string;
  existingBazaarWid?: unknown;
  compositionTitle?: string;
  copyrightYear?: number;
  copyrightRegistrationId?: string;
  masterOwnerDid?: string;
  publishingOwnerDid?: string;
  publishingOwnerIpi?: string;
  iswc?: string;
  writers?: PublishDraftRightsWriter[];
  publishers?: PublishDraftRightsPublisher[];
  proRegistrations?: PublishDraftRightsProReg[];
};

type PublishDraftTrackClass =
  | "track"
  | "album"
  | "samplePack"
  | "preset"
  | "stems"
  | "video"
  | "document"
  | "ebook"
  | "other";

type PublishDraftV1 = {
  tracks: Array<{
    objectId: string;
    title: string;
    itemClass: PublishDraftTrackClass;
    formats?: string[];
    description?: string;
    genre?: string[];
    releaseDate?: string;
    durationMs?: number;
    artworkObjectId?: string;
    isrc?: string;
    rights?: PublishDraftTrackRights;
  }>;
  collection?: {
    title: string;
    releaseDate?: string;
    collectionType?: "single" | "ep" | "album" | "compilation" | "other";
    description?: string;
    genre?: string[];
    upc?: string;
    trackObjectIds?: string[];
    itemSlots?: CollectionItemSlotV1[];
    artworkObjectId?: string;
  };
  licenseUri?: string;
  licenseGrantCid?: string;
};

const AUDIO_DIGITAL_ITEM_CLASSES = new Set<PublishDraftTrackClass>([
  "track",
  "album",
  "samplePack",
  "preset",
  "stems",
]);

function widInputsFromDraftWriters(
  writers: PublishDraftRightsWriter[] | undefined,
): WidWriterInput[] {
  return (writers ?? []).map((w) => ({
    name: w.name?.trim(),
    ipi: w.ipi?.trim(),
    did: w.did?.trim(),
  }));
}

function parseBazaarIdentifierFromDraft(v: unknown): {
  id: string;
  sig: string;
  generatedAt: string;
} | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.id === "string" &&
    typeof o.sig === "string" &&
    typeof o.generatedAt === "string"
  ) {
    return { id: o.id, sig: o.sig, generatedAt: o.generatedAt };
  }
  return null;
}

function parsePublishDraft(raw: string | null): PublishDraftV1 {
  if (!raw) throw new Error("empty");
  const d = JSON.parse(raw) as PublishDraftV1;
  if (!d.tracks || !Array.isArray(d.tracks)) throw new Error("tracks");
  return d;
}

type PublishProductDraftV1 = {
  product: {
    title: string;
    description?: string;
    artworkObjectId?: string;
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
    format?: string;
  }>;
};

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

function inferFormats(fileName: string, contentType?: string | null): string[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".flac")) return ["flac"];
  if (lower.endsWith(".mp3")) return ["mp3"];
  if (lower.endsWith(".wav")) return ["wav"];
  if (contentType?.includes("mpeg")) return ["mp3"];
  if (contentType?.includes("flac")) return ["flac"];
  return ["other"];
}
