import { AtUri } from "@atproto/syntax";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { zipSync } from "fflate";
import { getAgentForDid } from "./atproto/resolvePds";
import { isS3NoSuchKey } from "./r2/diagnostics";
import type { r2ConfigFromEnv } from "./r2/env";
import {
  extensionForDigital,
  INVENTORY_MASTER_OBJECT_NAME,
  inventoryObjectKey,
  sanitizeInventoryFilename,
} from "./r2/inventoryKey";

const MAX_COLLECTION_ZIP_TOTAL_BYTES = 250 * 1024 * 1024;
const MAX_COLLECTION_ZIP_SINGLE_BYTES = 120 * 1024 * 1024;

type CollectionRecord = {
  $type: string;
  title?: string;
  items: Array<{ uri: string; role?: string }>;
};

/**
 * Zips every catalog.item.digital member's master file for a legacy
 * catalog.collection. Shared between the buyer-facing /collection-zip
 * route (gated on an entitlement check) and the merchant incident-response
 * download route (gated on ownership instead) -- same split as
 * lib/productZip.ts for the new catalog.item/catalog.product scheme.
 * Fetches the collection and every member live via getRecord -- legacy has
 * no ERP mirror to read from instead.
 */
export async function buildLegacyCollectionZip(
  client: S3Client,
  cfg: Extract<ReturnType<typeof r2ConfigFromEnv>, { ok: true }>,
  collectionUri: string,
): Promise<Response | { error: string; status: 400 | 404 | 413 | 502 }> {
  let colAt: AtUri;
  try {
    colAt = new AtUri(collectionUri);
  } catch {
    return { error: "invalid_collectionUri", status: 400 };
  }
  if (!colAt.rkey || !colAt.collection.endsWith(".catalog.collection")) {
    return { error: "not_collection", status: 400 };
  }

  let val: CollectionRecord;
  try {
    const catalogAgent = await getAgentForDid(colAt.hostname);
    const colRec = await catalogAgent.com.atproto.repo.getRecord({
      repo: colAt.hostname,
      collection: colAt.collection,
      rkey: colAt.rkey,
    });
    val = colRec.data.value as CollectionRecord;
  } catch (e) {
    console.error("buildLegacyCollectionZip: getRecord collection", e);
    return { error: "collection_fetch_failed", status: 502 };
  }
  if (!val?.items?.length) return { error: "collection_empty", status: 400 };

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
      console.warn("buildLegacyCollectionZip: skip member getRecord", itemUri, e);
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
      obj = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    } catch (e) {
      if (isS3NoSuchKey(e)) {
        return { error: `master_not_in_r2: ${nameInZip}`, status: 404 };
      }
      console.error("buildLegacyCollectionZip: GetObject", key, e);
      return { error: "r2_read_failed", status: 502 };
    }
    if (!obj.Body) return { error: "object_body_missing", status: 502 };
    const buf = await obj.Body.transformToByteArray();
    if (buf.byteLength > MAX_COLLECTION_ZIP_SINGLE_BYTES) {
      return { error: `member_too_large: ${nameInZip}`, status: 413 };
    }
    total += buf.byteLength;
    if (total > MAX_COLLECTION_ZIP_TOTAL_BYTES) {
      return { error: "collection_zip_too_large", status: 413 };
    }
    zipEntries[nameInZip] = new Uint8Array(buf);
  }

  if (Object.keys(zipEntries).length === 0) {
    return { error: "no_downloadable_members", status: 400 };
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
}
