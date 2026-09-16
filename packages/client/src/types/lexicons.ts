/** Types aligned with diamonds.whereditgo.bazaar.* lexicons (v5). */

import { repoDidFromAtUri } from "@/lib/atUri";

export type Money = { amount: number; currency: string };

/** Which payment system settled a receipt, plus its opaque reference in that system. */
export type Payment = { processor: string; ref: string };

export type BazaarItemType =
  | "diamonds.whereditgo.bazaar.catalog.item"
  | "diamonds.whereditgo.bazaar.catalog.product";

/**
 * An AT-URI + CID pointer to another record — mirrors `defs#ref`.
 *
 * Used for every record-to-record pointer: a receipt's purchasedGood, listing, licenseGrant
 * and grantedItems entries, a listing's item, a product's items. The AT-URI's own collection
 * segment says what it points to, so no type field is carried.
 */
export type Ref = {
  uri: string;
  cid?: string;
};

export type TerritoryCoverage = {
  scope: "worldwide" | "excluding" | "only";
  territories?: string[];
};

/** diamonds.whereditgo.bazaar.catalog.item — a single sellable file or dispensable item. */
export type BazaarItem = {
  $type: "diamonds.whereditgo.bazaar.catalog.item";
  title: string;
  category?: string;
  description?: string;
  tags?: string[];
  /** Absent for non-file (dispensable) items — see catalog.item.json. */
  format?: string;
  fileChecksum?: string;
  fileCid?: string;
  supersedes?: string;
  createdAt: string;
};

/** diamonds.whereditgo.bazaar.catalog.product — the public declaration of a composite of one or more catalog.item records. */
export type Product = {
  $type: "diamonds.whereditgo.bazaar.catalog.product";
  title: string;
  description?: string;
  tags?: string[];
  items: Ref[];
  createdAt: string;
};

export type Listing = {
  $type: "diamonds.whereditgo.bazaar.catalog.listing";
  item: Ref;
  price: Money;
  /** Retiring a listing deletes the record, so there is no terminal state. */
  status: "active" | "paused";
  licenseGrant: Ref;
  /** Parent product listing AT-URI when this listing sells a member item individually. */
  parentListing?: string;
  createdAt: string;
};

export type LicenseTerms = {
  $type: "diamonds.whereditgo.bazaar.license.terms";
  title: string;
  version: string;
  licenseText: string;
  checkoutConsentRequired: boolean;
  createdAt: string;
};

export type PurchaseReceipt = {
  $type: "diamonds.whereditgo.bazaar.purchase.receipt";
  /** The catalog.item or catalog.product purchased. */
  purchasedGood: Ref;
  /** Listing purchased. cid is pinned at checkout as the immutable price anchor. */
  listing: Ref;
  pricePaid: Money;
  payment: Payment;
  /** License terms in effect at time of purchase. cid is folded into storefrontSig -- freezes the license atomically with the purchase, no separate consent record. */
  licenseGrant: Ref;
  /**
   * Frozen download entitlement: the catalog.item refs this purchase covers,
   * captured at checkout. Later edits to a product's items[] do not change it.
   *
   * Required by the lexicon, and part of the signed payload (ADR 0019): a
   * receipt without it does not verify and grants no downloads. Kept optional
   * here on purpose -- these records live in buyers' own repos, so a malformed
   * or pre-2026-09 one can still be read back, and the UI should render it
   * rather than crash.
   */
  grantedItems?: Ref[];
  storefrontDid: string;
  merchantDid: string;
  storefrontSig: string;
  purchasedAt: string;
  note?: string;
};

export type ActorMerchant = {
  $type: "diamonds.whereditgo.bazaar.actor.merchant";
  displayName: string;
  description?: string;
  storefrontUrl?: string;
  avatarCid?: string;
  bannerCid?: string;
  createdAt: string;
};

/**
 * Merchant-side mirror of one non-current storefront key (a keyHistory entry of the
 * storefrontDid DID document). rkey = the bare kid fragment. See ADR 0013 / ADR 0014 / ADR 0015.
 */
export type ActorStorefrontKeys = {
  $type: "diamonds.whereditgo.bazaar.actor.storefrontKeys";
  storefrontDid: string;
  id: string;
  type: "Multikey";
  controller?: string;
  publicKeyMultibase: string;
  supersededBy: string;
  revoked?: boolean;
  syncedAt?: string;
};

export type CatalogItem = BazaarItem | Product;

/**
 * catalog.item and catalog.product carry no merchant field: their own repo
 * (at://merchantDid/{collection}/rkey) already identifies the merchant, so it
 * is derived from `itemUri` -- which is why this takes the URI at all.
 */
export function catalogItemMerchantDid(_item: CatalogItem, itemUri: string): string {
  return repoDidFromAtUri(itemUri) ?? "";
}


