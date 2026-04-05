import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { TID } from "@atproto/common-web";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db";
import {
  inventoryUploadObject,
  inventoryUploadPart,
  inventoryUploadSession,
} from "../db/schema";
import type { OAuthClient } from "../lib/atproto/oauth";
import { getSessionAgent } from "../lib/atproto/session";
import { cidFromSha256Digest32 } from "../lib/r2/cid";
import { r2ConfigFromEnv } from "../lib/r2/env";
import {
  INVENTORY_ARTWORK_OBJECT_NAME,
  INVENTORY_MASTER_OBJECT_NAME,
  inventoryObjectKey,
} from "../lib/r2/inventoryKey";
import {
  isR2AccessDenied,
  r2AccessDeniedHints,
} from "../lib/r2/diagnostics";
import { getR2S3Client } from "../lib/r2/s3Client";

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
    for (const o of body.objects) {
      const rkey = o.rkey?.trim() || TID.nextStr();
      const nameInKey =
        o.role === "artwork" ? INVENTORY_ARTWORK_OBJECT_NAME : INVENTORY_MASTER_OBJECT_NAME;
      const r2Key = inventoryObjectKey(sess.did, rkey, nameInKey);
      const uploadKind =
        o.byteSize != null && o.byteSize >= MULTIPART_MIN_BYTES
          ? "multipart"
          : "single_put";
      const id = randomUUID();
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
    if (obj.status === "completed") return c.json({ error: "already_completed" }, 400);

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
    if (!obj.s3UploadId) return c.json({ error: "multipart_not_init" }, 400);

    const sorted = [...body.parts].sort((a, b) => a.partNumber - b.partNumber);
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
    if (!bodyStream || typeof (bodyStream as { transformToByteArray?: unknown }).transformToByteArray !== "function") {
      return c.json({ error: "get_object_failed" }, 500);
    }
    const bytes = await (bodyStream as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
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

    if (!draft.licenseUri || !draft.licenseGrantCid)
      return c.json({ error: "license_required" }, 400);
    if (!draft.tracks?.length) return c.json({ error: "tracks_required" }, 400);

    if (draft.tracks.length > 1 && !draft.collection) {
      return c.json({ error: "multiple_tracks_require_collection" }, 400);
    }

    const masterByObjectId = new Map(masters.map((m) => [m.id, m]));
    const uriByObjectId = new Map<string, { uri: string; cid: string }>();
    const createdItems: { uri: string; cid: string; rkey: string }[] = [];

    const digitalType = col("catalog.item.digital");
    const collectionType = col("catalog.collection");
    const listingType = col("catalog.listing");

    for (const t of draft.tracks) {
      const mo = masterByObjectId.get(t.objectId);
      if (!mo) return c.json({ error: "unknown_track_object", objectId: t.objectId }, 400);
      const formats = t.formats?.length ? t.formats : inferFormats(mo.fileName, mo.contentType);
      const record: Record<string, unknown> = {
        $type: digitalType,
        title: t.title,
        artistDid: sess.did,
        itemClass: t.itemClass,
        formats,
        fileChecksum: mo.fileChecksum!,
        fileCid: mo.fileCid!,
        fileFormat: mo.contentType ?? undefined,
        durationMs: t.durationMs ?? mo.durationMs ?? undefined,
        description: t.description,
        genre: t.genre,
        releaseDate: t.releaseDate,
        defaultLicenseUri: draft.licenseUri,
        createdAt: new Date().toISOString(),
      };

      if (t.artworkObjectId) {
        const art = objects.find((o) => o.id === t.artworkObjectId && o.role === "artwork");
        if (!art || art.status !== "completed" || !art.fileCid)
          return c.json({ error: "invalid_artwork", objectId: t.artworkObjectId }, 400);
        record.artworkCid = art.fileCid;
      }

      const res = await sess.agent.com.atproto.repo.createRecord({
        repo: sess.did,
        collection: digitalType,
        rkey: mo.rkey,
        record: record,
      });
      uriByObjectId.set(t.objectId, { uri: res.data.uri, cid: res.data.cid });
      createdItems.push({ uri: res.data.uri, cid: res.data.cid, rkey: mo.rkey });
    }

    let listingItemUri = createdItems[0]!.uri;
    let listingItemCid = createdItems[0]!.cid;
    let listingItemType = digitalType;

    if (draft.collection) {
      for (const oid of draft.collection.trackObjectIds) {
        if (!uriByObjectId.has(oid))
          return c.json({ error: "collection_unknown_track", objectId: oid }, 400);
      }
      const items = draft.collection.trackObjectIds.map((oid, i) => {
        const u = uriByObjectId.get(oid)!;
        return {
          uri: u.uri,
          cid: u.cid,
          role: "track" as const,
          essential: true,
          trackNumber: i + 1,
        };
      });
      let collectionArtworkCid: string | undefined;
      if (draft.collection.artworkObjectId) {
        const ao = objects.find(
          (o) => o.id === draft.collection!.artworkObjectId && o.role === "artwork",
        );
        if (!ao || ao.status !== "completed" || !ao.fileCid)
          return c.json(
            { error: "invalid_collection_artwork", objectId: draft.collection.artworkObjectId },
            400,
          );
        collectionArtworkCid = ao.fileCid;
      }
      const colRecord: Record<string, unknown> = {
        $type: collectionType,
        title: draft.collection.title,
        artistDid: sess.did,
        releaseDate: draft.collection.releaseDate ?? new Date().toISOString(),
        items,
        defaultLicenseUri: draft.licenseUri,
        createdAt: new Date().toISOString(),
      };
      if (collectionArtworkCid) colRecord.artworkCid = collectionArtworkCid;
      const colRes = await sess.agent.com.atproto.repo.createRecord({
        repo: sess.did,
        collection: collectionType,
        record: colRecord,
      });
      listingItemUri = colRes.data.uri;
      listingItemCid = colRes.data.cid;
      listingItemType = collectionType;
    }

    const listingRecord: Record<string, unknown> = {
      $type: listingType,
      item: {
        uri: listingItemUri,
        cid: listingItemCid,
        itemType: listingItemType,
      },
      licenseUri: draft.licenseUri,
      licenseGrantCid: draft.licenseGrantCid,
      price: draft.price ?? { amount: 0, currency: "USD" },
      status: draft.listingStatus ?? "active",
      createdAt: new Date().toISOString(),
    };
    const listRes = await sess.agent.com.atproto.repo.createRecord({
      repo: sess.did,
      collection: listingType,
      record: listingRecord,
    });

    const snapshot = {
      items: createdItems,
      listingUri: listRes.data.uri,
      listingCid: listRes.data.cid,
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

  return r;
}

type PublishDraftV1 = {
  tracks: Array<{
    objectId: string;
    title: string;
    itemClass:
      | "track"
      | "album"
      | "samplePack"
      | "preset"
      | "stems"
      | "video"
      | "document"
      | "ebook"
      | "other";
    formats?: string[];
    description?: string;
    genre?: string[];
    releaseDate?: string;
    durationMs?: number;
    artworkObjectId?: string;
  }>;
  collection?: {
    title: string;
    releaseDate?: string;
    trackObjectIds: string[];
    artworkObjectId?: string;
  };
  licenseUri: string;
  licenseGrantCid: string;
  price?: { amount: number; currency: string };
  listingStatus?: "active" | "paused" | "scheduled";
};

function parsePublishDraft(raw: string | null): PublishDraftV1 {
  if (!raw) throw new Error("empty");
  const d = JSON.parse(raw) as PublishDraftV1;
  if (!d.tracks || !Array.isArray(d.tracks)) throw new Error("tracks");
  if (!d.licenseUri || !d.licenseGrantCid) throw new Error("license");
  return d;
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
