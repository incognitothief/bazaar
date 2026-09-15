import type { Agent } from "@atproto/api";
import { AtUri } from "@atproto/syntax";
import { DeleteObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import type { Db } from "../db";
import {
  catalogItems,
  catalogProductAssets,
  catalogProducts,
  inventoryUploadObject,
  paymentFulfillment,
} from "../db/schema";
import { isS3NotFound } from "./r2/diagnostics";

function lexiconNs(): string {
  return process.env.LEXICON_NAMESPACE?.trim() || "diamonds.whereditgo.bazaar";
}

/**
 * Permanent deletion of one storefront catalog entry: its PDS record(s), its
 * R2 bytes, and its ERP rows.
 *
 * Written against an AT-URI rather than a record type. A product and a
 * standalone catalog.item differ only in what they fan out to -- a product
 * cascades to its member items and product assets, an item is itself -- so
 * ownership, listing checks, byte resolution, verification and record
 * deletion are a single path.
 *
 * The legacy branch this originally carried (ADR 0017) is gone with the
 * legacy record types; both remaining kinds resolve bytes the same way,
 * through catalogItems.objectId -> inventory_upload_object.r2Key.
 *
 * ORDER IS LOAD-BEARING. See executeDeletion.
 */

export type EntryKind = "product" | "item";

export type PdsRecordRef = {
  uri: string;
  collection: string;
  rkey: string;
  label: string;
};

/** Every object is backed by an inventory_upload_object row. */
export type R2ObjectRef = {
  key: string;
  label: string;
  source: "indexed";
};

export type DeletionBlocker = {
  kind: "listing";
  /** The listing record itself. */
  uri: string;
  status: string;
  /** What the listing points at -- the entry or one of its children. */
  targetUri: string;
};

export type DeletionManifest = {
  entryUri: string;
  entryKind: EntryKind;
  title: string;
  /** Non-empty means the delete must be refused. Merchant unlists first. */
  blockers: DeletionBlocker[];
  pdsRecords: PdsRecordRef[];
  r2Objects: R2ObjectRef[];
  /** inventory_upload_object ids to drop once bytes are confirmed gone. */
  objectIds: string[];
  /** Child items left alive because another product still composes them. */
  sharedItemsSkipped: { uri: string; reason: string }[];
  /** Buyers whose downloads this delete permanently breaks. */
  receiptCount: number;
};

type ItemRef = { uri: string; cid?: string };

function parseItemRefs(raw: string | null | undefined): ItemRef[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((e): e is ItemRef => !!e && typeof e.uri === "string");
  } catch {
    return [];
  }
}

/** Every product (other than `excludeUri`) that still composes `itemUri`. */
function otherProductsComposing(db: Db, ownerDid: string, itemUri: string, excludeUri: string): string[] {
  const rows = db
    .select({ uri: catalogProducts.uri, items: catalogProducts.items })
    .from(catalogProducts)
    .where(eq(catalogProducts.merchantDid, ownerDid))
    .all();
  return rows
    .filter((r) => r.uri !== excludeUri && parseItemRefs(r.items).some((i) => i.uri === itemUri))
    .map((r) => r.uri);
}

/** Objects indexed under one inventory_upload_object row, plus any webp derivative. */
function objectRefsForRow(
  row: { id: string; r2Key: string; webpR2Key: string | null; fileName: string },
  label: string,
): { refs: R2ObjectRef[]; objectId: string } {
  const refs: R2ObjectRef[] = [{ key: row.r2Key, label: `${label} (${row.fileName})`, source: "indexed" }];
  if (row.webpR2Key) {
    refs.push({ key: row.webpR2Key, label: `${label} — webp derivative`, source: "indexed" });
  }
  return { refs, objectId: row.id };
}

/** Listings on the merchant's PDS that point at `uris`. */
async function findBlockingListings(
  agent: Agent,
  ownerDid: string,
  uris: Set<string>,
): Promise<DeletionBlocker[]> {
  const collection = `${lexiconNs()}.catalog.listing`;
  const blockers: DeletionBlocker[] = [];
  let cursor: string | undefined;

  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo: ownerDid,
      collection,
      limit: 100,
      cursor,
    });
    for (const rec of res.data.records) {
      const val = rec.value as { item?: { uri?: string }; status?: string };
      const target = val?.item?.uri;
      if (!target || !uris.has(target)) continue;
      blockers.push({
        kind: "listing",
        uri: rec.uri,
        status: val.status ?? "unknown",
        targetUri: target,
      });
    }
    cursor = res.data.cursor;
  } while (cursor);

  return blockers;
}

function countAffectedReceipts(db: Db, uris: Set<string>): number {
  const rows = db
    .select({ itemUri: paymentFulfillment.itemUri, receiptUri: paymentFulfillment.receiptUri })
    .from(paymentFulfillment)
    .all();
  return rows.filter((r) => !!r.receiptUri && !!r.itemUri && uris.has(r.itemUri)).length;
}

/**
 * Enumerate everything a delete would destroy, without destroying any of it.
 * This is what backs the confirmation UI -- the merchant sees this exact list
 * before the irreversible call.
 */
export async function buildDeletionManifest(
  db: Db,
  agent: Agent,
  ownerDid: string,
  entryUri: string,
): Promise<DeletionManifest | { error: string; status: 400 | 404 }> {
  let at: AtUri;
  try {
    at = new AtUri(entryUri);
  } catch {
    return { error: "invalid_entry_uri", status: 400 };
  }
  if (!at.rkey || at.hostname !== ownerDid) {
    return { error: "not_owner", status: 404 };
  }

  const ns = lexiconNs();
  const isProduct = at.collection === `${ns}.catalog.product`;

  const pdsRecords: PdsRecordRef[] = [];
  const r2Objects: R2ObjectRef[] = [];
  const objectIds: string[] = [];
  const sharedItemsSkipped: { uri: string; reason: string }[] = [];
  /** Everything a listing or receipt could name: the entry plus its children. */
  const referenceable = new Set<string>([entryUri]);

  let title = at.rkey;
  let entryKind: EntryKind;

  if (isProduct) {
    entryKind = "product";
    const product = db.select().from(catalogProducts).where(eq(catalogProducts.uri, entryUri)).get();
    if (!product || product.merchantDid !== ownerDid) return { error: "not_found", status: 404 };
    title = product.title;

    pdsRecords.push({
      uri: entryUri,
      collection: at.collection,
      rkey: at.rkey,
      label: `Product: ${product.title}`,
    });

    for (const ref of parseItemRefs(product.items)) {
      const shared = otherProductsComposing(db, ownerDid, ref.uri, entryUri);
      if (shared.length > 0) {
        sharedItemsSkipped.push({
          uri: ref.uri,
          reason: `Still composed by ${shared.length} other product(s)`,
        });
        continue;
      }
      referenceable.add(ref.uri);

      let itemAt: AtUri;
      try {
        itemAt = new AtUri(ref.uri);
      } catch {
        continue;
      }
      if (!itemAt.rkey) continue;

      const itemRow = db.select().from(catalogItems).where(eq(catalogItems.uri, ref.uri)).get();
      pdsRecords.push({
        uri: ref.uri,
        collection: itemAt.collection,
        rkey: itemAt.rkey,
        label: `Item: ${itemRow?.title ?? itemAt.rkey}`,
      });

      if (itemRow?.objectId) {
        const obj = db
          .select()
          .from(inventoryUploadObject)
          .where(eq(inventoryUploadObject.id, itemRow.objectId))
          .get();
        if (obj) {
          const r = objectRefsForRow(obj, `Item file: ${itemRow.title}`);
          r2Objects.push(...r.refs);
          objectIds.push(r.objectId);
        }
      }
    }

    const assets = db
      .select()
      .from(catalogProductAssets)
      .where(eq(catalogProductAssets.productUri, entryUri))
      .all();
    for (const asset of assets) {
      const obj = db
        .select()
        .from(inventoryUploadObject)
        .where(eq(inventoryUploadObject.id, asset.objectId))
        .get();
      if (!obj) continue;
      const r = objectRefsForRow(obj, `Product asset (${asset.role ?? "asset"})`);
      r2Objects.push(...r.refs);
      objectIds.push(r.objectId);
    }

    if (product.packageZipKey) {
      r2Objects.push({
        key: product.packageZipKey,
        label: "Precomputed download package",
        source: "indexed",
      });
    }
  } else {
    entryKind = "item";
    const itemRow = db.select().from(catalogItems).where(eq(catalogItems.uri, entryUri)).get();
    if (!itemRow || itemRow.merchantDid !== ownerDid) return { error: "not_found", status: 404 };
    title = itemRow.title;

    pdsRecords.push({
      uri: entryUri,
      collection: at.collection,
      rkey: at.rkey,
      label: `Item: ${itemRow.title}`,
    });

    if (itemRow.objectId) {
      const obj = db
        .select()
        .from(inventoryUploadObject)
        .where(eq(inventoryUploadObject.id, itemRow.objectId))
        .get();
      if (obj) {
        const r = objectRefsForRow(obj, `Item file: ${itemRow.title}`);
        r2Objects.push(...r.refs);
        objectIds.push(r.objectId);
      }
    }
  }

  const blockers = await findBlockingListings(agent, ownerDid, referenceable);

  return {
    entryUri,
    entryKind,
    title,
    blockers,
    pdsRecords,
    r2Objects,
    objectIds: [...new Set(objectIds)],
    sharedItemsSkipped,
    receiptCount: countAffectedReceipts(db, referenceable),
  };
}

export type DeletionOutcome = {
  deletedObjects: string[];
  deletedRecords: string[];
  /** Keys that were already absent -- treated as success, not failure. */
  alreadyGone: string[];
};

/**
 * Perform the deletion the manifest describes.
 *
 * The order below is the whole safety argument, so it is spelled out:
 *
 *   1. delete R2 bytes
 *   2. VERIFY every byte is gone  <- abort here leaves EVERYTHING intact
 *   3. drop ERP rows
 *   4. delete PDS records          <- the last pointer, so it dies last
 *
 * A failure at 1 or 2 aborts with the records untouched, which is recoverable:
 * the merchant retries and the manifest still resolves. The inverse order --
 * record first, bytes second -- fails unrecoverably, because for a legacy
 * entry the record's rkey is the only thing that can regenerate its R2 key.
 * Bytes without a record are invisible garbage; a record without bytes is a
 * visible, retryable inconsistency. We fail toward the latter.
 *
 * This is deliberately NOT the order used by merchant.ts's assets/remove,
 * which drops its index row even when the R2 delete throws.
 */
export async function executeDeletion(
  db: Db,
  agent: Agent,
  ownerDid: string,
  manifest: DeletionManifest,
  client: Pick<S3Client, "send">,
  bucket: string,
): Promise<DeletionOutcome | { error: string; status: 400 | 409 | 502 }> {
  if (manifest.blockers.length > 0) {
    return { error: "blocked_by_listings", status: 409 };
  }

  const deletedObjects: string[] = [];
  const alreadyGone: string[] = [];

  // 1. bytes. DeleteObject is idempotent -- S3/R2 answer 204 for a key that
  // was never there -- so a throw here is a real failure, never "missing".
  for (const obj of manifest.r2Objects) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.key }));
    } catch (e) {
      if (isS3NotFound(e)) {
        alreadyGone.push(obj.key);
        continue;
      }
      console.error("executeDeletion: R2 delete failed", obj.key, e);
      return { error: "r2_delete_failed", status: 502 };
    }
  }

  // 2. verify -- a delete that silently no-ops must not reach step 4.
  //
  // HeadObject signals absence with `NotFound` (404), NOT `NoSuchKey`: a HEAD
  // has no response body to carry an error code, so the SDK synthesizes one.
  // This is the same check the SDK's waitUntilObjectNotExists waiter makes.
  for (const obj of manifest.r2Objects) {
    if (alreadyGone.includes(obj.key)) continue;
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: obj.key }));
    } catch (e) {
      if (isS3NotFound(e)) {
        deletedObjects.push(obj.key);
        continue;
      }
      // Distinct from the case below: we could not determine the object's
      // state at all (permissions, network, throttling). Retrying is safe.
      console.error("executeDeletion: R2 verify errored", obj.key, e);
      return { error: "r2_verify_failed", status: 502 };
    }
    // Head succeeded: the object survived a delete that reported success.
    // Usually a credential that can read but not delete, or a bucket mismatch.
    console.error("executeDeletion: object still present after delete", obj.key);
    return { error: "r2_delete_incomplete", status: 502 };
  }

  // 3. ERP rows
  for (const id of manifest.objectIds) {
    db.delete(inventoryUploadObject).where(eq(inventoryUploadObject.id, id)).run();
  }
  if (manifest.entryKind === "product") {
    db.delete(catalogProductAssets).where(eq(catalogProductAssets.productUri, manifest.entryUri)).run();
    for (const rec of manifest.pdsRecords) {
      if (rec.uri !== manifest.entryUri) {
        db.delete(catalogItems).where(eq(catalogItems.uri, rec.uri)).run();
      }
    }
    db.delete(catalogProducts).where(eq(catalogProducts.uri, manifest.entryUri)).run();
  } else {
    db.delete(catalogItems).where(eq(catalogItems.uri, manifest.entryUri)).run();
  }

  // 4. PDS records, children before parent
  const deletedRecords: string[] = [];
  const ordered = [...manifest.pdsRecords].sort((a, b) =>
    a.uri === manifest.entryUri ? 1 : b.uri === manifest.entryUri ? -1 : 0,
  );
  for (const rec of ordered) {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: ownerDid,
        collection: rec.collection,
        rkey: rec.rkey,
      });
      deletedRecords.push(rec.uri);
    } catch (e) {
      // Bytes and ERP rows are already gone; surface the partial rather than
      // pretending it completed. Re-running resolves a smaller manifest.
      console.error("executeDeletion: deleteRecord failed", rec.uri, e);
      return { error: "record_delete_failed", status: 502 };
    }
  }

  return { deletedObjects, deletedRecords, alreadyGone };
}
