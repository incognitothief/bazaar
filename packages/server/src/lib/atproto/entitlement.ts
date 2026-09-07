import { createHash } from "node:crypto";
import { AtUri } from "@atproto/syntax";

const COL_PRODUCT = "diamonds.whereditgo.bazaar.catalog.product";
const COL_ITEM = "diamonds.whereditgo.bazaar.catalog.item";

/**
 * Frozen download entitlement for a purchase.
 *
 * A `purchase.receipt` carries `grantedItems`: the exact `catalog.item` AT-URIs
 * the buyer paid for, captured at checkout. Later edits to a product's
 * `items[]` never change it. The list is folded into the receipt `appSig` via
 * {@link entitlementDigest} so a remote verifier can confirm the grant
 * cryptographically from the receipt record alone.
 *
 * Canonical form: de-duplicated, sorted by UTF-8 byte order. Every signer and
 * verifier MUST canonicalize identically -- the digest is part of the signed
 * payload.
 */
export function canonicalGrantedItems(uris: readonly string[]): string[] {
  return [...new Set(uris)].sort((a, b) =>
    Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")),
  );
}

/**
 * base64url(SHA-256(canonicalGrantedItems.join("\n"))).
 *
 * "\n" can't appear in an AT-URI, so the join is unambiguous. Returns the
 * digest of the empty list for `[]` -- callers should not sign a grant with no
 * items (a purchasable thing always entitles at least one).
 */
export function entitlementDigest(grantedItems: readonly string[]): string {
  return createHash("sha256")
    .update(canonicalGrantedItems(grantedItems).join("\n"), "utf8")
    .digest("base64url");
}

/**
 * The catalog.item URIs a purchase of `purchasedUri` entitles the buyer to,
 * for `purchase.receipt.grantedItems`. `record` is the getRecord value for
 * `purchasedUri` (used only for products).
 *
 * - catalog.item -> itself
 * - catalog.product -> its member item URIs (canonicalized)
 * - collection (legacy) / unrecognised / product with no items -> undefined,
 *   leaving the download path on live-membership resolution
 */
export function resolveGrantedItems(
  purchasedUri: string,
  record: Record<string, unknown> | null | undefined,
): string[] | undefined {
  let collection: string;
  try {
    collection = new AtUri(purchasedUri).collection;
  } catch {
    return undefined;
  }
  if (collection === COL_ITEM) return [purchasedUri];
  if (collection === COL_PRODUCT) {
    const refs = Array.isArray(record?.items) ? record.items : [];
    const uris = refs
      .map((r) => (r as { uri?: unknown })?.uri)
      .filter((u): u is string => typeof u === "string" && u.length > 0);
    return uris.length > 0 ? canonicalGrantedItems(uris) : undefined;
  }
  return undefined;
}
