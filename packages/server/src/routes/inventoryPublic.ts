import { AtUri } from "@atproto/syntax";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
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

const COL_DIGITAL = `${lexiconNs()}.catalog.item.digital`;
const COL_COLLECTION = `${lexiconNs()}.catalog.collection`;

/**
 * Presigned GET for cover art on R2. Public if the object exists (catalog item URI is public on ATProto).
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
    if (!at.rkey) return c.json({ error: "missing_rkey" }, 400);
    if (at.collection !== COL_DIGITAL && at.collection !== COL_COLLECTION) {
      return c.json({ error: "unsupported_item_type" }, 400);
    }

    const artistDid = at.hostname;
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
