import { AtUri } from "@atproto/syntax";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Hono } from "hono";
import type { OAuthClient } from "../lib/atproto/oauth";
import { appServicePublicKeyPemFromEnv, verifyReceiptPayload } from "../lib/atproto/sign";
import { getSessionAgent } from "../lib/atproto/session";
import { r2ConfigFromEnv } from "../lib/r2/env";
import {
  INVENTORY_MASTER_OBJECT_NAME,
  inventoryObjectKey,
} from "../lib/r2/inventoryKey";
import { getR2S3Client } from "../lib/r2/s3Client";

function lexiconNs(): string {
  return process.env.LEXICON_NAMESPACE?.trim() || "diamonds.whereditgo.bazaar";
}

const COL_RECEIPT = `${lexiconNs()}.purchase.receipt`;
const COL_DIGITAL = `${lexiconNs()}.catalog.item.digital`;
const COL_COLLECTION = `${lexiconNs()}.catalog.collection`;

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
};

type CollectionRecord = {
  $type: string;
  items: Array<{ uri: string; essential?: boolean; role?: string }>;
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
    if (itemAt.collection !== COL_DIGITAL || !itemAt.rkey)
      return c.json({ error: "not_digital_item" }, 400);

    const cfg = r2ConfigFromEnv();
    if (!cfg.ok) return c.json({ error: "r2_unconfigured", message: cfg.reason }, 503);
    const client = getR2S3Client(cfg);

    const list = await sess.agent.com.atproto.repo.listRecords({
      repo: sess.did,
      collection: COL_RECEIPT,
      limit: 100,
    });

    const publicKeyPem = appServicePublicKeyPemFromEnv();
    if (!publicKeyPem) return c.json({ error: "app_key_missing" }, 503);

    let entitled = false;
    let receipt: PurchaseReceipt | null = null;

    for (const row of list.data.records) {
      const rec = row.value as PurchaseReceipt;
      if (!rec?.item?.uri) continue;
      if (rec.item.uri === itemUriRaw) {
        if (!verifyReceiptForBuyer(rec, sess.did, publicKeyPem)) continue;
        entitled = true;
        receipt = rec;
        break;
      }
      if (rec.item.itemType === COL_COLLECTION) {
        if (!verifyReceiptForBuyer(rec, sess.did, publicKeyPem)) continue;
        const ok = await collectionContainsEssentialDigital(
          sess.agent,
          rec.item.uri,
          itemUriRaw,
        );
        if (ok) {
          entitled = true;
          receipt = rec;
          break;
        }
      }
    }

    if (!entitled || !receipt) return c.json({ error: "not_entitled" }, 403);

    const artistDid = itemAt.hostname;
    const rkey = itemAt.rkey;
    const key = inventoryObjectKey(artistDid, rkey, INVENTORY_MASTER_OBJECT_NAME);

    const cmd = new GetObjectCommand({ Bucket: cfg.bucket, Key: key });
    const url = await getSignedUrl(client, cmd, { expiresIn: 900 });
    const expiresAt = new Date(Date.now() + 900_000).toISOString();
    return c.json({ url, expiresAt });
  });

  return r;
}

/** appSig covers `rec.item.uri` (the purchased listing item), not an individual track URI. */
function verifyReceiptForBuyer(
  rec: PurchaseReceipt,
  sessionDid: string,
  publicKeyPem: string,
): boolean {
  const buyerDid = rec.buyerDid ?? sessionDid;
  if (buyerDid !== sessionDid) return false;
  return verifyReceiptPayload({
    purchasedAt: rec.purchasedAt,
    paymentRef: rec.paymentRef,
    itemUri: rec.item.uri,
    listingCid: rec.listingCid,
    buyerDid,
    appSig: rec.appSig,
    publicKeyPem,
  });
}

async function collectionContainsEssentialDigital(
  agent: import("@atproto/api").Agent,
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
  const got = await agent.com.atproto.repo.getRecord({
    repo: at.hostname,
    collection: at.collection,
    rkey: at.rkey,
  });
  const val = got.data.value as CollectionRecord;
  if (!val?.items?.length) return false;
  return val.items.some(
    (i) => i.uri === digitalItemUri && (i.essential !== false),
  );
}
