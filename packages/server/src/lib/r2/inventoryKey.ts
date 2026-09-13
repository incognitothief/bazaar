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

/** Best-effort file extension for a legacy catalog.item.digital's master object, for a download filename -- the R2 key itself is always the literal "master", never a real filename. */
export function extensionForDigital(
  formats: string[] | undefined,
  fileFormat: string | undefined,
): string {
  const f0 = formats?.[0]?.toLowerCase();
  if (f0 === "flac" || f0 === "mp3" || f0 === "wav") return f0;
  if (f0 === "other" && fileFormat) {
    const m = String(fileFormat).toLowerCase();
    if (m.includes("flac")) return "flac";
    if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
    if (m.includes("wav")) return "wav";
  }
  return "bin";
}

/**
 * R2 keys for catalog.item/catalog.product uploads -- a separate scheme
 * from inventoryObjectKey() above, not a migration of it. That function is
 * recomputed fresh on every legacy download with no DB dependency, so it
 * can never change format without breaking every past purchase; it stays
 * exactly as-is forever for catalog.item.digital/catalog.collection.
 *
 * These key by the *product's* rkey, not the upload object's own id --
 * every catalog.item is created as part of some catalog.product (even a
 * single-item release is a one-item product), so the product's rkey is a
 * stable grouping key available at upload-registration time: it's minted
 * up front (TID.nextStr(), same pattern as the legacy itemTid reservation)
 * for a new product, or taken from the existing product's own URI when
 * adding items/assets to one already published. See
 * inventoryUploadSession.productRkey. The product's createRecord call at
 * publish time passes this same rkey explicitly rather than letting the
 * PDS assign one, so the R2 folder and the PDS record rkey always match.
 *
 * Unlike the legacy scheme, resolving one of these keys back to bytes
 * always goes through inventoryUploadObject.r2Key (a DB lookup), never
 * recomputation -- acceptable now that Bazaar is ERP-first everywhere
 * else too. What this buys back over the flat, UUID-only scheme it
 * replaced is a bucket you can actually browse: everything for one
 * product lives under one prefix, split into its items and its
 * product-level assets (cover art, included assets).
 */
export function newProductItemKey(
  merchantDid: string,
  productRkey: string,
  objectId: string,
  filename: string,
): string {
  if (!merchantDid.startsWith("did:")) throw new Error("Invalid merchant DID");
  if (!productRkey) throw new Error("Invalid product rkey");
  if (!objectId) throw new Error("Invalid object id");
  const safe = sanitizeInventoryFilename(filename);
  return `inventory/${merchantDid}/${productRkey}/items/${objectId}/${safe}`;
}

export function newProductAssetKey(
  merchantDid: string,
  productRkey: string,
  objectId: string,
  filename: string,
): string {
  if (!merchantDid.startsWith("did:")) throw new Error("Invalid merchant DID");
  if (!productRkey) throw new Error("Invalid product rkey");
  if (!objectId) throw new Error("Invalid object id");
  const safe = sanitizeInventoryFilename(filename);
  return `inventory/${merchantDid}/${productRkey}/assets/${objectId}/${safe}`;
}

/**
 * R2 key for a product's precomputed download package (see
 * productZip.ts's rebuildProductZipCache). One object per product,
 * overwritten in place on every rebuild -- unlike items/assets there's
 * nothing to key by objectId, the whole point is a single current-state
 * cache entry.
 */
export function newProductPackageZipKey(
  merchantDid: string,
  productRkey: string,
): string {
  if (!merchantDid.startsWith("did:")) throw new Error("Invalid merchant DID");
  if (!productRkey) throw new Error("Invalid product rkey");
  return `inventory/${merchantDid}/${productRkey}/package.zip`;
}
