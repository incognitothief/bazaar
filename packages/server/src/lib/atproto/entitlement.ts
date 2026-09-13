import { createHash } from "node:crypto";
import { AtUri } from "@atproto/syntax";

const COL_PRODUCT = "diamonds.whereditgo.bazaar.catalog.product";
const COL_ITEM = "diamonds.whereditgo.bazaar.catalog.item";

/** A `purchase.receipt.grantedItems` entry -- an AT-URI plus the item's CID at purchase time. */
export type GrantedItemRef = {
  uri: string;
  cid?: string;
};

/**
 * Frozen download entitlement for a purchase.
 *
 * A `purchase.receipt` carries `grantedItems`: the exact `catalog.item` refs
 * (uri + cid) the buyer paid for, captured at checkout. Later edits to a
 * product's `items[]` never change it. The list is folded into the receipt
 * `storefrontSig` via {@link entitlementDigest} so a remote verifier can confirm the
 * grant cryptographically from the receipt record alone.
 *
 * Canonical form: de-duplicated by uri, sorted by uri UTF-8 byte order. Every
 * signer and verifier MUST canonicalize identically -- the digest is part of
 * the signed payload.
 */
export function canonicalGrantedItems(
  items: readonly GrantedItemRef[],
): GrantedItemRef[] {
  const byUri = new Map<string, GrantedItemRef>();
  for (const item of items) byUri.set(item.uri, item);
  return [...byUri.values()].sort((a, b) =>
    Buffer.compare(Buffer.from(a.uri, "utf8"), Buffer.from(b.uri, "utf8")),
  );
}

/**
 * base64url(SHA-256(canonicalGrantedItems.map(i => `${i.uri}|${i.cid ?? ""}`).join("\n"))).
 *
 * "|" can't appear in an AT-URI or a CID, so the per-entry join is
 * unambiguous; "\n" can't appear in either, so the overall join is too.
 * Returns the digest of the empty list for `[]` -- callers should not sign a
 * grant with no items (a purchasable thing always entitles at least one).
 */
export function entitlementDigest(items: readonly GrantedItemRef[]): string {
  const canonical = canonicalGrantedItems(items)
    .map((i) => `${i.uri}|${i.cid ?? ""}`)
    .join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("base64url");
}

/**
 * The catalog.item refs a purchase of `purchasedUri` entitles the buyer to,
 * for `purchase.receipt.grantedItems`. `record` is the getRecord value for
 * `purchasedUri` (used only for products). `purchasedItemCid` is the pinned
 * CID of `purchasedUri` itself (from the listing at checkout time) -- used
 * only for the single-item case, since a product's member refs already carry
 * their own cid.
 *
 * - catalog.item -> itself, with `purchasedItemCid`
 * - catalog.product -> its member item refs (canonicalized)
 * - collection (legacy) / unrecognised / product with no items -> undefined,
 *   leaving the download path on live-membership resolution
 */
export function resolveGrantedItems(
  purchasedUri: string,
  record: Record<string, unknown> | null | undefined,
  purchasedItemCid?: string,
): GrantedItemRef[] | undefined {
  let collection: string;
  try {
    collection = new AtUri(purchasedUri).collection;
  } catch {
    return undefined;
  }
  if (collection === COL_ITEM) {
    return [{ uri: purchasedUri, cid: purchasedItemCid }];
  }
  if (collection === COL_PRODUCT) {
    const refs = Array.isArray(record?.items) ? record.items : [];
    const items = refs
      .map((r): GrantedItemRef | null => {
        const o = r as { uri?: unknown; cid?: unknown };
        if (typeof o?.uri !== "string" || o.uri.length === 0) return null;
        return typeof o.cid === "string" ? { uri: o.uri, cid: o.cid } : { uri: o.uri };
      })
      .filter((x): x is GrantedItemRef => x !== null);
    return items.length > 0 ? canonicalGrantedItems(items) : undefined;
  }
  return undefined;
}
