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
