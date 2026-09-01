import { AtUri } from "@atproto/syntax";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getAgentForDid } from "./atproto/resolvePds";
import { r2ConfigFromEnv } from "./r2/env";
import {
  INVENTORY_ARTWORK_OBJECT_NAME,
  inventoryObjectKey,
} from "./r2/inventoryKey";
import { getR2S3Client } from "./r2/s3Client";

function lexiconNs(): string {
  return process.env.LEXICON_NAMESPACE?.trim() || "diamonds.whereditgo.bazaar";
}

const COL_DIGITAL = () => `${lexiconNs()}.catalog.item.digital`;
const COL_COLLECTION = () => `${lexiconNs()}.catalog.collection`;

export type ArtworkPresignResult =
  | { ok: true; url: string }
  | { ok: false; status: 400 | 404 | 503; error: string };

/**
 * Presigned GET for catalog artwork on R2 (same resolution rules as inventory-public artwork-url).
 */
export async function presignInventoryArtworkGet(
  itemUri: string,
): Promise<ArtworkPresignResult> {
  let at: AtUri;
  try {
    at = new AtUri(itemUri);
  } catch {
    return { ok: false, status: 400, error: "invalid_itemUri" };
  }
  if (!at.rkey) return { ok: false, status: 400, error: "missing_rkey" };
  const colDigital = COL_DIGITAL();
  const colCollection = COL_COLLECTION();
  if (at.collection !== colDigital && at.collection !== colCollection) {
    return { ok: false, status: 400, error: "unsupported_item_type" };
  }

  const artistDid = at.hostname;
  const cfg = r2ConfigFromEnv();
  if (!cfg.ok) return { ok: false, status: 503, error: "r2_unconfigured" };
  const client = getR2S3Client(cfg);
  let key = inventoryObjectKey(artistDid, at.rkey, INVENTORY_ARTWORK_OBJECT_NAME);

  try {
    await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
  } catch {
    if (at.collection === colDigital) {
      try {
        const agent = await getAgentForDid(artistDid);
        const rec = await agent.com.atproto.repo.getRecord({
          repo: artistDid,
          collection: colDigital,
          rkey: at.rkey,
        });
        const val = rec.data.value as { collectionUri?: string };
        const colUri =
          typeof val.collectionUri === "string" ? val.collectionUri.trim() : "";
        if (colUri) {
          const colAt = new AtUri(colUri);
          if (
            colAt.rkey &&
            colAt.hostname === artistDid &&
            colAt.collection === colCollection
          ) {
            const colKey = inventoryObjectKey(
              artistDid,
              colAt.rkey,
              INVENTORY_ARTWORK_OBJECT_NAME,
            );
            try {
              await client.send(
                new HeadObjectCommand({ Bucket: cfg.bucket, Key: colKey }),
              );
              key = colKey;
            } catch {
              return { ok: false, status: 404, error: "artwork_not_in_r2" };
            }
          } else {
            return { ok: false, status: 404, error: "artwork_not_in_r2" };
          }
        } else {
          return { ok: false, status: 404, error: "artwork_not_in_r2" };
        }
      } catch {
        return { ok: false, status: 404, error: "artwork_not_in_r2" };
      }
    } else {
      return { ok: false, status: 404, error: "artwork_not_in_r2" };
    }
  }

  const cmd = new GetObjectCommand({ Bucket: cfg.bucket, Key: key });
  const url = await getSignedUrl(client, cmd, { expiresIn: 3600 });
  return { ok: true, url };
}
