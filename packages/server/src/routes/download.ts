import { AtUri } from "@atproto/syntax";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db";
import { catalogItems, catalogProducts, inventoryUploadObject } from "../db/schema";
import type { OAuthClient } from "../lib/atproto/oauth";
import { getAgentForDid } from "../lib/atproto/resolvePds";
import { getSessionAgent } from "../lib/atproto/session";
import { appMerchantPublicKeyPemFromEnv, verifyReceiptPayload } from "../lib/atproto/sign";
import { entitlementDigest } from "../lib/atproto/entitlement";
import { candidatePemsForKid, getMerchantKeys } from "../lib/merchantKeys";
import { r2ConfigFromEnv } from "../lib/r2/env";
import { isS3NoSuchKey } from "../lib/r2/diagnostics";
import {
  extensionForDigital,
  INVENTORY_MASTER_OBJECT_NAME,
  inventoryObjectKey,
  sanitizeInventoryFilename,
} from "../lib/r2/inventoryKey";
import { getR2S3Client } from "../lib/r2/s3Client";
import { buildProductZip } from "../lib/productZip";
import { buildLegacyCollectionZip } from "../lib/legacyCollectionZip";

function lexiconNs(): string {
  return process.env.LEXICON_NAMESPACE?.trim() || "diamonds.whereditgo.bazaar";
}

const COL_RECEIPT = `${lexiconNs()}.purchase.receipt`;
const COL_PRODUCT = `${lexiconNs()}.catalog.product`;
const COL_ITEM = `${lexiconNs()}.catalog.item`;

type ItemRef = {
  uri: string;
  cid?: string;
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
  /**
   * Frozen entitlement: the catalog.item URIs this purchase covers, captured
   * at checkout. Present on current receipts; absent on legacy ones, which
   * fall back to live product/collection membership.
   */
  grantedItems?: string[];
};

function frozenGrant(rec: PurchaseReceipt): string[] | null {
  return Array.isArray(rec.grantedItems) && rec.grantedItems.length > 0
    ? rec.grantedItems
    : null;
}

/** itemRef no longer carries a stored type field (removed as redundant with the URI itself); the AT-URI's own collection segment is the only source of truth. */

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

function receiptItemIsProduct(itemUri: string): boolean {
  try {
    return new AtUri(itemUri).collection === COL_PRODUCT;
  } catch {
    return false;
  }
}

/** ERP-first (catalogProducts.items), not a PDS getRecord -- products are ERP-first everywhere else, and checkout already pinned the CID this receipt was issued against. */
function productContainsItem(db: Db, productUri: string, itemUri: string): boolean {
  const row = db.select().from(catalogProducts).where(eq(catalogProducts.uri, productUri)).get();
  if (!row) return false;
  try {
    const refs = JSON.parse(row.items) as Array<{ uri: string }>;
    return refs.some((ref) => ref.uri === itemUri);
  } catch {
    return false;
  }
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

export function createDownloadRouter(db: Db, oauthClient: OAuthClient) {
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
    const isLegacyDigital =
      !!itemAt.rkey && itemAt.collection.endsWith(".catalog.item.digital");
    const isCatalogItem = !!itemAt.rkey && itemAt.collection === COL_ITEM;
    if (!isLegacyDigital && !isCatalogItem) {
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

        // Current receipts: entitlement is exactly the frozen grant. A later
        // edit to the product's items[] cannot add or remove access.
        const grant = frozenGrant(rec);
        if (grant) {
          if (!grant.includes(itemUriRaw)) continue;
          if (!safeVerifyReceiptForBuyer(rec, sess.did)) continue;
          entitled = true;
          receipt = rec;
          break;
        }

        // Legacy receipts (no grantedItems): resolve against live membership.
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
        if (isCatalogItem && receiptItemIsProduct(rec.item.uri)) {
          if (!safeVerifyReceiptForBuyer(rec, sess.did)) continue;
          if (productContainsItem(db, rec.item.uri, itemUriRaw)) {
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

    if (isCatalogItem) {
      const itemRow = db.select().from(catalogItems).where(eq(catalogItems.uri, itemUriRaw)).get();
      if (!itemRow?.objectId) return c.json({ error: "no_file" }, 404);
      const obj = db
        .select()
        .from(inventoryUploadObject)
        .where(eq(inventoryUploadObject.id, itemRow.objectId))
        .get();
      if (!obj || obj.status !== "completed") return c.json({ error: "object_not_found" }, 404);
      const disp = `attachment; filename="${obj.fileName.replace(/"/g, "")}"`;
      try {
        const cmd = new GetObjectCommand({
          Bucket: cfg.bucket,
          Key: obj.r2Key,
          ResponseContentDisposition: disp,
        });
        const url = await getSignedUrl(client, cmd, { expiresIn: 900 });
        const expiresAt = new Date(Date.now() + 900_000).toISOString();
        return c.json({ url, expiresAt, filename: obj.fileName });
      } catch (e) {
        if (isS3NoSuchKey(e)) return c.json({ error: "master_not_in_r2" }, 404);
        console.error("download presign failed:", e);
        return c.json(
          { error: "download_failed", message: e instanceof Error ? e.message : String(e) },
          502,
        );
      }
    }

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

    const result = await buildLegacyCollectionZip(client, cfg, collectionUriRaw);
    if (result instanceof Response) return result;
    return c.json({ error: result.error }, result.status);
  });

  /**
   * Zip of all downloadable files for a purchased product (items + the
   * generic included-assets bin, cover art gated by artIncludedInDownload).
   * Assembly itself lives in lib/productZip.ts, shared with the merchant
   * incident-response route -- only the entitlement check differs.
   * Query: productUri=at://...
   */
  r.get("/product-zip", async (c) => {
    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "Unauthorized" }, 401);

    const productUriRaw = c.req.query("productUri")?.trim();
    if (!productUriRaw) return c.json({ error: "productUri_required" }, 400);

    let prodAt: AtUri;
    try {
      prodAt = new AtUri(productUriRaw);
    } catch {
      return c.json({ error: "invalid_productUri" }, 400);
    }
    if (!prodAt.rkey || prodAt.collection !== COL_PRODUCT) {
      return c.json({ error: "not_product" }, 400);
    }

    const cfg = r2ConfigFromEnv();
    if (!cfg.ok) return c.json({ error: "r2_unconfigured", message: cfg.reason }, 503);

    const list = await sess.agent.com.atproto.repo.listRecords({
      repo: sess.did,
      collection: COL_RECEIPT,
      limit: 100,
    });

    if (!merchantVerifyKeysAvailable())
      return c.json({ error: "app_key_missing" }, 503);

    let entitledReceipt: PurchaseReceipt | null = null;
    for (const row of list.data.records) {
      try {
        const rec = row.value as PurchaseReceipt;
        if (!rec?.item?.uri) continue;
        if (!receiptItemIsProduct(rec.item.uri)) continue;
        if (rec.item.uri !== productUriRaw) continue;
        if (!safeVerifyReceiptForBuyer(rec, sess.did)) continue;
        entitledReceipt = rec;
        break;
      } catch (e) {
        console.warn("download product-zip: skip receipt row", e);
      }
    }

    if (!entitledReceipt) return c.json({ error: "not_entitled" }, 403);

    const product = db
      .select()
      .from(catalogProducts)
      .where(eq(catalogProducts.uri, productUriRaw))
      .get();
    if (!product) return c.json({ error: "not_found" }, 404);

    // Current receipts package exactly the frozen grant; legacy receipts
    // package the live product.
    const grant = frozenGrant(entitledReceipt);
    const result = await buildProductZip(
      db,
      cfg,
      product,
      grant ?? undefined,
    );
    if (result instanceof Response) return result;
    return c.json({ error: result.error }, result.status);
  });

  return r;
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

  // Current receipts fold the grantedItems digest into appSig as a sixth
  // payload field; legacy receipts sign only the five-field payload.
  const grant = frozenGrant(rec);
  const digest = grant ? entitlementDigest(grant) : undefined;

  return candidates.some((publicKeyPem) =>
    verifyReceiptPayload({
      purchasedAt: rec.purchasedAt,
      paymentRef: rec.paymentRef,
      itemUri: rec.item.uri,
      listingCid: rec.listingCid,
      buyerDid,
      entitlementDigest: digest,
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
