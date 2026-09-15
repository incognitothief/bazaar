/** Types aligned with diamonds.whereditgo.bazaar.* lexicons (v5). */

import { repoDidFromAtUri } from "@/lib/atUri";

export type Money = { amount: number; currency: string };

/** Which payment system settled a receipt, plus its opaque reference in that system. */
export type Payment = { processor: string; ref: string };

export type BazaarItemType =
  | "diamonds.whereditgo.bazaar.catalog.item"
  | "diamonds.whereditgo.bazaar.catalog.product";

export type ItemRef = {
  uri: string;
  cid?: string;
  variantSku?: string;
};

/** A plain AT-URI + CID pointer, used where ItemRef's variantSku doesn't apply. */
export type Ref = {
  uri: string;
  cid?: string;
};

export type Address = {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  countryCode: string;
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
  items: ItemRef[];
  createdAt: string;
};

export type Listing = {
  $type: "diamonds.whereditgo.bazaar.catalog.listing";
  item: ItemRef;
  price: Money;
  compareAtPrice?: Money;
  status:
    | "active"
    | "paused"
    | "soldOut"
    | "scheduled"
    | "archived"
    | "superseded";
  licenseGrant: Ref;
  /** Parent collection listing AT-URI when this listing is a per-track single under that album. */
  parentListing?: string;
  supersededBy?: string;
  availableFrom?: string;
  availableUntil?: string;
  maxPurchasesPerBuyer?: number;
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
  purchasedGood: ItemRef;
  /** Listing purchased. cid is pinned at checkout as the immutable price anchor. */
  listing: Ref;
  pricePaid: Money;
  payment: Payment;
  /** License terms in effect at time of purchase. cid is folded into storefrontSig -- freezes the license atomically with the purchase, no separate consent record. */
  licenseGrant: Ref;
  shippingAddress?: Address;
  fulfillmentUri?: string;
  /**
   * Frozen download entitlement: the catalog.item refs this purchase covers,
   * captured at checkout. Absent on legacy receipts. Later edits to a
   * product's items[] do not change it.
   */
  grantedItems?: Ref[];
  storefrontDid: string;
  merchantDid: string;
  storefrontSig: string;
  purchasedAt: string;
  note?: string;
};

export type Stock = {
  $type: "diamonds.whereditgo.bazaar.purchase.stock";
  itemUri: string;
  itemCid: string;
  variantSku: string;
  quantityAvailable: number;
  quantityReserved?: number;
  quantitySold?: number;
  isUnlimited?: boolean;
  lowStockThreshold?: number;
  updatedAt: string;
};

export type Fulfillment = {
  $type: "diamonds.whereditgo.bazaar.purchase.fulfillment";
  receiptUri: string;
  receiptCid: string;
  status:
    | "pending"
    | "processing"
    | "shipped"
    | "inTransit"
    | "delivered"
    | "returned"
    | "cancelled";
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
  shippedAt?: string;
  deliveredAt?: string;
  events?: Array<{
    status: string;
    location?: string;
    timestamp: string;
    note?: string;
  }>;
  createdAt: string;
  updatedAt?: string;
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
 * is derived from `itemUri`. (The legacy types used to carry their own
 * artistDid, which is why this takes the URI at all.)
 */
export function catalogItemMerchantDid(_item: CatalogItem, itemUri: string): string {
  return repoDidFromAtUri(itemUri) ?? "";
}


