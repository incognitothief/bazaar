import { AtUri } from "@atproto/syntax";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db";
import { catalogItems, catalogProducts, inventoryUploadObject } from "../db/schema";
import type { OAuthClient } from "../lib/atproto/oauth";
import { getSessionAgent } from "../lib/atproto/session";
import { storefrontPublicKeyPemFromEnv, verifyReceiptPayload } from "../lib/atproto/sign";
import { entitlementDigest } from "../lib/atproto/entitlement";
import { candidatePemsForKid, getStorefrontKeys } from "../lib/storefrontKeys";
import { r2ConfigFromEnv } from "../lib/r2/env";
import { isS3NoSuchKey } from "../lib/r2/diagnostics";
import { getR2S3Client } from "../lib/r2/s3Client";
import {
  buildProductZip,
  entitlementMatchesCurrentItems,
  rebuildProductZipCacheByUri,
  presignCachedProductPackage,
} from "../lib/productZip";

function lexiconNs(): string {
  return process.env.LEXICON_NAMESPACE?.trim() || "diamonds.whereditgo.bazaar";
}

const COL_RECEIPT = `${lexiconNs()}.purchase.receipt`;
const COL_PRODUCT = `${lexiconNs()}.catalog.product`;
const COL_ITEM = `${lexiconNs()}.catalog.item`;

type Ref = {
  uri: string;
  cid?: string;
};

type PurchaseReceipt = {
  purchasedGood: Ref;
  listing: Ref;
  licenseGrant?: Ref;
  payment?: { processor: string; ref: string };
  purchasedAt: string;
  storefrontSig: string;
  /** Hint for selecting the storefront key that produced `storefrontSig` (ADR 0013). */
  kid?: string;
  /**
   * Frozen entitlement: the catalog.item refs this purchase covers, captured
   * at checkout. Required: a receipt without one does not verify, which
   * fall back to live product/collection membership.
   */
  grantedItems?: Ref[];
};

function frozenGrant(rec: PurchaseReceipt): Ref[] | null {
  return Array.isArray(rec.grantedItems) && rec.grantedItems.length > 0
    ? rec.grantedItems
    : null;
}

/** defs#ref carries no stored type field (redundant with the URI itself); the AT-URI's own collection segment is the only source of truth. */

/** True when at least one storefront verification key is configured (env or key history). */
function storefrontVerifyKeysAvailable(): boolean {
  return (
    getStorefrontKeys().byKid.size > 0 || storefrontPublicKeyPemFromEnv() !== null
  );
}

function receiptItemIsProduct(itemUri: string): boolean {
  try {
    return new AtUri(itemUri).collection === COL_PRODUCT;
  } catch {
    return false;
  }
}

/** ERP-first (catalogProducts.items), not a PDS getRecord -- products are ERP-first everywhere else, and checkout already pinned the CID this receipt was issued against. */
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
    const isCatalogItem = !!itemAt.rkey && itemAt.collection === COL_ITEM;
    if (!isCatalogItem) {
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

    if (!storefrontVerifyKeysAvailable())
      return c.json({ error: "app_key_missing" }, 503);

    let entitled = false;
    let receipt: PurchaseReceipt | null = null;

    for (const row of list.data.records) {
      try {
        const rec = row.value as PurchaseReceipt;
        if (!rec?.purchasedGood?.uri) continue;

        // Entitlement is exactly the frozen grant. A later edit to the
        // product's items[] cannot add or remove access. A receipt with no
        // frozen grant no longer verifies at all (ADR 0019), so there is no
        // live-membership fallback behind this.
        const grant = frozenGrant(rec);
        if (!grant) continue;
        if (!grant.some((g) => g.uri === itemUriRaw)) continue;
        if (!safeVerifyReceiptForBuyer(rec, sess.did)) continue;
        entitled = true;
        receipt = rec;
        break;
      } catch (e) {
        console.warn("download: skip receipt row", e);
      }
    }

    if (!entitled || !receipt) return c.json({ error: "not_entitled" }, 403);
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

    if (!storefrontVerifyKeysAvailable())
      return c.json({ error: "app_key_missing" }, 503);

    let entitledReceipt: PurchaseReceipt | null = null;
    for (const row of list.data.records) {
      try {
        const rec = row.value as PurchaseReceipt;
        if (!rec?.purchasedGood?.uri) continue;
        if (!receiptItemIsProduct(rec.purchasedGood.uri)) continue;
        if (rec.purchasedGood.uri !== productUriRaw) continue;
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

    // The zip packages exactly the frozen grant. entitledReceipt verified, and
    // verification requires a frozen grant (ADR 0019), so this is always set.
    const grant = frozenGrant(entitledReceipt);
    const entitledUris = grant?.map((g) => g.uri);

    // Precomputed cache always represents the product's *current* contents,
    // so it can only answer for a buyer whose entitlement still matches
    // that exactly (see entitlementMatchesCurrentItems). Anyone whose grant
    // has drifted (items added/removed since their purchase) falls back to
    // the live per-request rebuild below, unchanged from today.
    if (
      product.packageZipStatus === "ready" &&
      product.packageZipKey &&
      entitlementMatchesCurrentItems(product, entitledUris)
    ) {
      const signed = await presignCachedProductPackage(db, cfg, product, 900);
      if (signed) {
        return c.json({
          url: signed.url,
          expiresAt: signed.expiresAt,
          filename: signed.filename,
        });
      }
      console.warn("product-zip: cache presign failed, falling back to live rebuild");
    }

    // Self-heal a broken/missing cache so the next buyer can hit the
    // presign path. Don't rebuild when status is already "ready" -- that
    // case is entitlement drift (a different zip than the cache) or a
    // transient presign failure, neither of which means the current-contents
    // cache is wrong.
    if (product.packageZipStatus !== "ready" || !product.packageZipKey) {
      void rebuildProductZipCacheByUri(db, product.uri);
    }

    const result = await buildProductZip(db, cfg, product, entitledUris);
    if (result instanceof Response) return result;
    return c.json({ error: result.error }, result.status);
  });

  return r;
}

/**
 * storefrontSig covers `rec.purchasedGood.uri` (the purchased listing item), not an individual
 * track URI. buyerDid is not a stored field -- the receipt lives in `sessionDid`'s own
 * repo (this is only ever called on rows from `sess.did`'s own listRecords), so that IS
 * the buyer, and it's what gets fed into the signed payload for reconstruction.
 *
 * Key selection (ADR 0013): if `rec.kid` names a revoked storefront key, reject outright.
 * Otherwise try the hinted key first, then every other non-revoked key (current + active +
 * retired). Falls back to the env-derived current key when no key set is configured.
 */
function verifyReceiptForBuyer(rec: PurchaseReceipt, sessionDid: string): boolean {
  const { revoked, pems } = candidatePemsForKid(getStorefrontKeys(), rec.kid);
  if (revoked) return false;

  const candidates =
    pems.length > 0
      ? pems
      : [storefrontPublicKeyPemFromEnv()].filter((p): p is string => !!p);

  // The signed payload is a fixed seven fields (ADR 0019). A receipt without
  // a frozen grant or a licenseGrant cid cannot reconstruct it, so it does not
  // verify -- no five- or six-field fallback any more.
  const grant = frozenGrant(rec);
  const licenseGrantCid = rec.licenseGrant?.cid;
  if (!grant || !licenseGrantCid) return false;
  const digest = entitlementDigest(grant);

  return candidates.some((publicKeyPem) =>
    verifyReceiptPayload({
      purchasedAt: rec.purchasedAt,
      paymentRef: rec.payment?.ref ?? "",
      itemUri: rec.purchasedGood.uri,
      listingCid: rec.listing.cid ?? "",
      buyerDid: sessionDid,
      licenseGrantCid,
      entitlementDigest: digest,
      storefrontSig: rec.storefrontSig,
      publicKeyPem,
    }),
  );
}

