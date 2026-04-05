import { AtUri } from "@atproto/syntax";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Agent } from "@atproto/api";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Hono } from "hono";
import { r2ConfigFromEnv } from "../lib/r2/env";
import {
  INVENTORY_ARTWORK_OBJECT_NAME,
  inventoryObjectKey,
} from "../lib/r2/inventoryKey";
import { getR2S3Client } from "../lib/r2/s3Client";

function lexiconNs(): string {
  return process.env.LEXICON_NAMESPACE?.trim() || "diamonds.whereditgo.bazaar";
}

const COL_LISTING = `${lexiconNs()}.catalog.listing`;
const COL_DIGITAL = `${lexiconNs()}.catalog.item.digital`;
const COL_COLLECTION = `${lexiconNs()}.catalog.collection`;

type Listing = {
  item: { uri: string; itemType?: string };
  status: string;
};

type CollectionRecord = {
  items?: Array<{ uri: string; essential?: boolean }>;
};

function publicAgent(): Agent {
  return new Agent({ service: process.env.ATPROTO_SERVICE ?? "https://bsky.social" });
}

/**
 * Presigned GET for cover art on R2 when the item has an active listing (storefront-safe).
 */
export function createInventoryPublicRouter() {
  const r = new Hono();

  r.get("/artwork-url", async (c) => {
    const itemUri = c.req.query("itemUri")?.trim();
    if (!itemUri) return c.json({ error: "itemUri_required" }, 400);

    let at: AtUri;
    try {
      at = new AtUri(itemUri);
    } catch {
      return c.json({ error: "invalid_itemUri" }, 400);
    }
    if (at.collection !== COL_DIGITAL || !at.rkey)
      return c.json({ error: "not_digital_item" }, 400);

    const artistDid = at.hostname;
    const agent = publicAgent();

    const active = await hasActiveListingForItem(agent, artistDid, itemUri);
    if (!active) return c.json({ error: "no_active_listing" }, 404);

    const cfg = r2ConfigFromEnv();
    if (!cfg.ok) return c.json({ error: "r2_unconfigured" }, 503);
    const client = getR2S3Client(cfg);
    const key = inventoryObjectKey(artistDid, at.rkey, INVENTORY_ARTWORK_OBJECT_NAME);

    try {
      await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    } catch {
      return c.json({ error: "artwork_not_in_r2" }, 404);
    }

    const cmd = new GetObjectCommand({ Bucket: cfg.bucket, Key: key });
    const url = await getSignedUrl(client, cmd, { expiresIn: 3600 });
    return c.json({ url, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  });

  return r;
}

async function hasActiveListingForItem(
  agent: Agent,
  artistDid: string,
  itemUri: string,
): Promise<boolean> {
  const res = await agent.com.atproto.repo.listRecords({
    repo: artistDid,
    collection: COL_LISTING,
    limit: 100,
  });
  for (const row of res.data.records) {
    const listing = row.value as Listing;
    if (listing?.status !== "active" || !listing.item?.uri) continue;
    if (listing.item.uri === itemUri) return true;
    if (listing.item.itemType === COL_COLLECTION) {
      const contains = await collectionContainsUri(
        agent,
        listing.item.uri,
        itemUri,
      );
      if (contains) return true;
    }
  }
  return false;
}

async function collectionContainsUri(
  agent: Agent,
  collectionUri: string,
  itemUri: string,
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
  return !!val.items?.some((i) => i.uri === itemUri && i.essential !== false);
}
