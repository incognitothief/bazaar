/**
 * R2 object key for inventory bytes. Fixed `digital` segment is a namespace, not itemClass.
 * @see .alignment/360404-item-uploads/S3_STRATEGY.md
 */
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

export function sanitizeInventoryFilename(name: string): string {
  const base = name.replaceAll(/[/\\]/g, "_").replaceAll(/\s+/g, "_");
  const trimmed = base.slice(0, 200);
  if (!trimmed || !SAFE_SEGMENT.test(trimmed)) return "file";
  return trimmed;
}

export function inventoryObjectKey(
  artistDid: string,
  itemTid: string,
  filename: string,
): string {
  if (!artistDid.startsWith("did:")) throw new Error("Invalid artist DID");
  if (!itemTid || itemTid.length > 128) throw new Error("Invalid item rkey");
  const safe = sanitizeInventoryFilename(filename);
  return `inventory/${artistDid}/digital/${itemTid}/${safe}`;
}

/** Default master object name inside the item prefix (deterministic for download). */
export const INVENTORY_MASTER_OBJECT_NAME = "master";
export const INVENTORY_ARTWORK_OBJECT_NAME = "artwork";

/**
 * R2 key for catalog.item/catalog.product uploads -- a separate scheme
 * from inventoryObjectKey() above, not a migration of it. That function is
 * recomputed fresh on every legacy download with no DB dependency, so it
 * can never change format without breaking every past purchase; it stays
 * exactly as-is forever for catalog.item.digital/catalog.collection.
 *
 * This one keys by the upload object's own id (a randomUUID minted at
 * registration time, before any PDS record exists), not a product/item
 * rkey -- neither exists yet at upload time, and relocating into a
 * grouped-by-rkey path once one does would need an extra copy+delete step
 * per file with its own partial-failure surface. Deliberately skipped:
 * the merchant-panel download tools are the actual answer to "make this
 * easy to find," not the bucket layout. Written once, never moved.
 */
export function newInventoryAssetKey(sellerDid: string, objectId: string, filename: string): string {
  if (!sellerDid.startsWith("did:")) throw new Error("Invalid seller DID");
  if (!objectId) throw new Error("Invalid object id");
  const safe = sanitizeInventoryFilename(filename);
  return `assets/${sellerDid}/${objectId}/${safe}`;
}
