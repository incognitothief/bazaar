import { AtUri } from "@atproto/syntax";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { zipSync } from "fflate";
import { Hono } from "hono";
import type { OAuthClient } from "../lib/atproto/oauth";
import { getAgentForDid } from "../lib/atproto/resolvePds";
import { getSessionAgent } from "../lib/atproto/session";
import { appMerchantPublicKeyPemFromEnv, verifyReceiptPayload } from "../lib/atproto/sign";
import { candidatePemsForKid, getMerchantKeys } from "../lib/merchantKeys";
import { r2ConfigFromEnv } from "../lib/r2/env";
import {
  INVENTORY_MASTER_OBJECT_NAME,
  inventoryObjectKey,
  sanitizeInventoryFilename,
} from "../lib/r2/inventoryKey";
import { getR2S3Client } from "../lib/r2/s3Client";

function lexiconNs(): string {
  return process.env.LEXICON_NAMESPACE?.trim() || "diamonds.whereditgo.bazaar";
}

const COL_RECEIPT = `${lexiconNs()}.purchase.receipt`;

const MAX_COLLECTION_ZIP_TOTAL_BYTES = 250 * 1024 * 1024;
const MAX_COLLECTION_ZIP_SINGLE_BYTES = 120 * 1024 * 1024;

type ItemRef = {
  uri: string;
  cid?: string;
  itemType: string;
};

type PurchaseReceipt = {
  item: ItemRef;
  listingUri: string;
  listingCid: string;
  buyerDid?: string;
  paymentRef: string;
  purchasedAt: string;
  appSig: string;
  /** Hint for selecting the storefront key that produced `appSig` (ADR 0013). */
  kid?: string;
};

/** True when at least one storefront verification key is configured (env or key history). */
function merchantVerifyKeysAvailable(): boolean {
  return (
    getMerchantKeys().byKid.size > 0 || appMerchantPublicKeyPemFromEnv() !== null
  );
}

/** AT-URI collection NSID is authoritative; `itemType` can disagree with server LEXICON_NAMESPACE. */
function receiptItemIsCollection(itemUri: string): boolean {
  try {
    const u = new AtUri(itemUri);
    return u.collection.endsWith(".catalog.collection");
  } catch {
    return false;
  }
}

function isS3NoSuchKey(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const o = e as { name?: string; Code?: string };
  return o.name === "NoSuchKey" || o.Code === "NoSuchKey";
}

function safeVerifyReceiptForBuyer(
  rec: PurchaseReceipt,
  sessionDid: string,
): boolean {
  try {
    return verifyReceiptForBuyer(rec, sessionDid);
  } catch (e) {
    console.warn("download: receipt verify threw", e);
    return false;
  }
}

type CollectionRecord = {
  $type: string;
  title?: string;
  items: Array<{ uri: string; role?: string }>;
};

export function createDownloadRouter(oauthClient: OAuthClient) {
  const r = new Hono();

  r.get("/", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);

    const itemUriRaw = c.req.query("itemUri")?.trim();
    if (!itemUriRaw) return c.json({ error: "itemUri_required" }, 400);

    let itemAt: AtUri;
    try {
      itemAt = new AtUri(itemUriRaw);
    } catch {
      return c.json({ error: "invalid_itemUri" }, 400);
    }
    if (!itemAt.rkey || !itemAt.collection.endsWith(".catalog.item.digital")) {
      return c.json({ error: "not_digital_item" }, 400);
    }

    const cfg = r2ConfigFromEnv();
    if (!cfg.ok) return c.json({ error: "r2_unconfigured", message: cfg.reason }, 503);
    const client = getR2S3Client(cfg);

    const list = await sess.agent.com.atproto.repo.listRecords({
      repo: sess.did,
      collection: COL_RECEIPT,
      limit: 100,
    });

    if (!merchantVerifyKeysAvailable())
      return c.json({ error: "app_key_missing" }, 503);

    let entitled = false;
    let receipt: PurchaseReceipt | null = null;

    for (const row of list.data.records) {
      try {
        const rec = row.value as PurchaseReceipt;
        if (!rec?.item?.uri) continue;
        if (rec.item.uri === itemUriRaw) {
          if (!safeVerifyReceiptForBuyer(rec, sess.did)) continue;
          entitled = true;
          receipt = rec;
          break;
        }
        if (receiptItemIsCollection(rec.item.uri)) {
          if (!safeVerifyReceiptForBuyer(rec, sess.did)) continue;
          const ok = await collectionContainsDigitalMember(
            rec.item.uri,
            itemUriRaw,
          );
          if (ok) {
            entitled = true;
            receipt = rec;
            break;
          }
        }
      } catch (e) {
        console.warn("download: skip receipt row", e);
      }
    }

    if (!entitled || !receipt) return c.json({ error: "not_entitled" }, 403);

    const artistDid = itemAt.hostname;
    const rkey = itemAt.rkey;
    const key = inventoryObjectKey(artistDid, rkey, INVENTORY_MASTER_OBJECT_NAME);

    let filenameForDownload = `track_${rkey}.bin`;
    try {
      const catalogAgent = await getAgentForDid(artistDid);
      const dig = await catalogAgent.com.atproto.repo.getRecord({
        repo: artistDid,
        collection: itemAt.collection,
        rkey: itemAt.rkey,
      });
      const digital = dig.data.value as Record<string, unknown>;
      const title =
        typeof digital.title === "string" && digital.title.trim()
          ? digital.title.trim()
          : rkey;
      const formats = digital.formats as string[] | undefined;
      const ext = extensionForDigital(
        formats,
        digital.fileFormat as string | undefined,
      );
      const safeBase = sanitizeInventoryFilename(
        title.replace(/\.[^./\\]+$/g, "") || `track_${rkey}`,
      );
      filenameForDownload = `${safeBase}.${ext}`;
    } catch (e) {
      console.warn("download: could not resolve digital title for filename", e);
    }

    const disp = `attachment; filename="${filenameForDownload.replace(/"/g, "")}"`;

    try {
      const cmd = new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        ResponseContentDisposition: disp,
      });
      const url = await getSignedUrl(client, cmd, { expiresIn: 900 });
      const expiresAt = new Date(Date.now() + 900_000).toISOString();
      return c.json({ url, expiresAt, filename: filenameForDownload });
    } catch (e) {
      if (isS3NoSuchKey(e)) {
        return c.json({ error: "master_not_in_r2" }, 404);
      }
      console.error("download presign failed:", e);
      return c.json(
        { error: "download_failed", message: e instanceof Error ? e.message : String(e) },
        502,
      );
    }
  });

  /**
   * Zip of all digital member files for a purchased collection.
   * Query: collectionUri=at://...
   */
  r.get("/collection-zip", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);

    const collectionUriRaw = c.req.query("collectionUri")?.trim();
    if (!collectionUriRaw) return c.json({ error: "collectionUri_required" }, 400);

    let colAt: AtUri;
    try {
      colAt = new AtUri(collectionUriRaw);
    } catch {
      return c.json({ error: "invalid_collectionUri" }, 400);
    }
    if (!colAt.rkey || !colAt.collection.endsWith(".catalog.collection")) {
      return c.json({ error: "not_collection" }, 400);
    }

    const cfg = r2ConfigFromEnv();
    if (!cfg.ok) return c.json({ error: "r2_unconfigured", message: cfg.reason }, 503);
    const client = getR2S3Client(cfg);

    const list = await sess.agent.com.atproto.repo.listRecords({
      repo: sess.did,
      collection: COL_RECEIPT,
      limit: 100,
    });

    if (!merchantVerifyKeysAvailable())
      return c.json({ error: "app_key_missing" }, 503);

    let entitled = false;
    for (const row of list.data.records) {
      try {
        const rec = row.value as PurchaseReceipt;
        if (!rec?.item?.uri) continue;
        if (!receiptItemIsCollection(rec.item.uri)) continue;
        if (rec.item.uri !== collectionUriRaw) continue;
        if (!safeVerifyReceiptForBuyer(rec, sess.did)) continue;
        entitled = true;
        break;
      } catch (e) {
        console.warn("download collection-zip: skip receipt row", e);
      }
    }

    if (!entitled) return c.json({ error: "not_entitled" }, 403);

    let colRec;
    try {
      const catalogAgent = await getAgentForDid(colAt.hostname);
      colRec = await catalogAgent.com.atproto.repo.getRecord({
        repo: colAt.hostname,
        collection: colAt.collection,
        rkey: colAt.rkey,
      });
    } catch (e) {
      console.error("download collection-zip: getRecord collection", e);
      return c.json(
        { error: "collection_fetch_failed", message: e instanceof Error ? e.message : String(e) },
        502,
      );
    }
    const val = colRec.data.value as CollectionRecord;
    if (!val?.items?.length) return c.json({ error: "collection_empty" }, 400);

    const zipEntries: Record<string, Uint8Array> = {};
    let total = 0;
    let index = 0;

    for (const member of val.items) {
      const itemUri = member.uri;
      if (!itemUri) continue;
      let digAt: AtUri;
      try {
        digAt = new AtUri(itemUri);
      } catch {
        continue;
      }
      if (!digAt.rkey || !digAt.collection.endsWith(".catalog.item.digital")) continue;

      let dig;
      try {
        const memberAgent = await getAgentForDid(digAt.hostname);
        dig = await memberAgent.com.atproto.repo.getRecord({
          repo: digAt.hostname,
          collection: digAt.collection,
          rkey: digAt.rkey,
        });
      } catch (e) {
        console.warn("download collection-zip: skip member getRecord", itemUri, e);
        continue;
      }
      const digital = dig.data.value as Record<string, unknown>;
      const title =
        typeof digital.title === "string" && digital.title.trim()
          ? digital.title.trim()
          : digAt.rkey;
      const formats = digital.formats as string[] | undefined;
      const ext = extensionForDigital(formats, digital.fileFormat as string | undefined);
      const safeBase = sanitizeInventoryFilename(title.replace(/\.[^./\\]+$/g, "") || `item_${index}`);
      const nameInZip = `${String(++index).padStart(2, "0")}_${safeBase}.${ext}`;

      const key = inventoryObjectKey(digAt.hostname, digAt.rkey, INVENTORY_MASTER_OBJECT_NAME);
      let obj;
      try {
        obj = await client.send(
          new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
        );
      } catch (e) {
        if (isS3NoSuchKey(e)) {
          return c.json({ error: "master_not_in_r2", member: nameInZip }, 404);
        }
        console.error("download collection-zip: GetObject", key, e);
        return c.json(
          {
            error: "r2_read_failed",
            member: nameInZip,
            message: e instanceof Error ? e.message : String(e),
          },
          502,
        );
      }
      if (!obj.Body) return c.json({ error: "object_body_missing", key: nameInZip }, 502);
      const buf = await obj.Body.transformToByteArray();
      if (buf.byteLength > MAX_COLLECTION_ZIP_SINGLE_BYTES) {
        return c.json({ error: "member_too_large", path: nameInZip }, 413);
      }
      total += buf.byteLength;
      if (total > MAX_COLLECTION_ZIP_TOTAL_BYTES) {
        return c.json({ error: "collection_zip_too_large" }, 413);
      }
      zipEntries[nameInZip] = new Uint8Array(buf);
    }

    if (Object.keys(zipEntries).length === 0) {
      return c.json({ error: "no_downloadable_members" }, 400);
    }

    const zipped = zipSync(zipEntries, { level: 6 });
    const titleSafe = sanitizeInventoryFilename(
      (val.title ?? "collection").replace(/\.[^./\\]+$/g, "") || "collection",
    );
    const filename = `${titleSafe}.zip`;

    return new Response(new Uint8Array(zipped), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  });

  return r;
}

function extensionForDigital(
  formats: string[] | undefined,
  fileFormat: string | undefined,
): string {
  const f0 = formats?.[0]?.toLowerCase();
  if (f0 === "flac" || f0 === "mp3" || f0 === "wav") return f0;
  if (f0 === "other" && fileFormat) {
    const m = String(fileFormat).toLowerCase();
    if (m.includes("flac")) return "flac";
    if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
    if (m.includes("wav")) return "wav";
  }
  return "bin";
}

/**
 * appSig covers `rec.item.uri` (the purchased listing item), not an individual track URI.
 *
 * Key selection (ADR 0013): if `rec.kid` names a revoked storefront key, reject outright.
 * Otherwise try the hinted key first, then every other non-revoked key (current + active +
 * retired). Falls back to the env-derived current key when no key set is configured.
 */
function verifyReceiptForBuyer(rec: PurchaseReceipt, sessionDid: string): boolean {
  const buyerDid = rec.buyerDid ?? sessionDid;
  if (buyerDid !== sessionDid) return false;

  const { revoked, pems } = candidatePemsForKid(getMerchantKeys(), rec.kid);
  if (revoked) return false;

  const candidates =
    pems.length > 0
      ? pems
      : [appMerchantPublicKeyPemFromEnv()].filter((p): p is string => !!p);

  return candidates.some((publicKeyPem) =>
    verifyReceiptPayload({
      purchasedAt: rec.purchasedAt,
      paymentRef: rec.paymentRef,
      itemUri: rec.item.uri,
      listingCid: rec.listingCid,
      buyerDid,
      appSig: rec.appSig,
      publicKeyPem,
    }),
  );
}

async function collectionContainsDigitalMember(
  collectionUri: string,
  digitalItemUri: string,
): Promise<boolean> {
  let at: AtUri;
  try {
    at = new AtUri(collectionUri);
  } catch {
    return false;
  }
  if (!at.rkey) return false;
  try {
    const agent = await getAgentForDid(at.hostname);
    const got = await agent.com.atproto.repo.getRecord({
      repo: at.hostname,
      collection: at.collection,
      rkey: at.rkey,
    });
    const val = got.data.value as CollectionRecord;
    if (!val?.items?.length) return false;
    return val.items.some((i) => i.uri === digitalItemUri);
  } catch (e) {
    console.warn("collectionContainsDigitalMember: getRecord failed", e);
    return false;
  }
}
