/** Types aligned with diamonds.whereditgo.bazaar.* lexicons (v5). */

export type Money = { amount: number; currency: string };

export type Dimensions = {
  width?: number;
  height?: number;
  depth?: number;
  unit: "mm" | "cm" | "in";
};

export type Weight = { value: number; unit: "g" | "kg" | "oz" | "lb" };

export type Variant = {
  sku: string;
  attributes?: Record<string, string>;
  weight?: Weight;
  dimensions?: Dimensions;
  additionalPrice?: Money;
  artworkCid?: string;
};

export type BazaarItemType =
  | "diamonds.whereditgo.bazaar.catalog.item"
  | "diamonds.whereditgo.bazaar.catalog.product"
  | "diamonds.whereditgo.bazaar.catalog.item.digital"
  | "diamonds.whereditgo.bazaar.catalog.item.physical"
  | "diamonds.whereditgo.bazaar.catalog.collection";

export type ItemRef = {
  uri: string;
  cid?: string;
  variantSku?: string;
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

export type CollectionItemRole =
  | "track"
  | "video"
  | "document"
  | "artwork"
  | "bonus"
  | "other";

export type CollectionItemEntry = {
  uri: string;
  cid?: string;
  role: CollectionItemRole;
  trackNumber?: number;
  discNumber?: number;
  title?: string;
};

export type CompositionWriter = {
  name: string;
  ipi?: string;
  did?: string;
  share?: number;
  role?: string;
};

export type CompositionPublisher = {
  name: string;
  ipi?: string;
  did?: string;
  pro?: string;
  share?: number;
};

export type Composition = {
  $type: "diamonds.whereditgo.bazaar.catalog.composition";
  title: string;
  artistDid: string;
  iswc?: string;
  bazaarWid?: unknown;
  writers?: CompositionWriter[];
  publishers?: CompositionPublisher[];
  proRegistrations?: Array<{
    pro: string;
    registrationId?: string;
    territory?: string;
  }>;
  copyrightYear?: number;
  copyrightRegistrationId?: string;
  createdAt: string;
};

export type PhysicalItem = {
  $type: "diamonds.whereditgo.bazaar.catalog.item.physical";
  title: string;
  artistDid: string;
  itemClass:
    | "clothing"
    | "vinyl"
    | "cd"
    | "cassette"
    | "poster"
    | "print"
    | "accessory"
    | "hardGood"
    | "other";
  description?: string;
  variants: Variant[];
  artworkCid?: string;
  countryOfOrigin?: string;
  harmonizedCode?: string;
  requiresShipping?: boolean;
  createdAt: string;
};

export type DigitalItem = {
  $type: "diamonds.whereditgo.bazaar.catalog.item.digital";
  title: string;
  artistDid: string;
  itemClass:
    | "track"
    | "album"
    | "samplePack"
    | "preset"
    | "stems"
    | "video"
    | "document"
    | "ebook"
    | "other";
  description?: string;
  formats: string[];
  fileChecksum: string;
  fileCid: string;
  fileFormat?: string;
  durationMs?: number;
  releaseDate?: string;
  artworkCid?: string;
  genre?: string[];
  isrc?: string;
  defaultLicenseUri?: string;
  bazaarRid?: unknown;
  collectionUri?: string;
  supersedes?: string;
  createdAt: string;
};

export type Collection = {
  $type: "diamonds.whereditgo.bazaar.catalog.collection";
  title: string;
  artistDid: string;
  collectionType?: "album" | "ep" | "single" | "compilation" | "other";
  description?: string;
  releaseDate: string;
  items: CollectionItemEntry[];
  defaultLicenseUri?: string;
  artworkCid?: string;
  genre?: string[];
  upc?: string;
  bazaarPid?: unknown;
  createdAt: string;
};

/** diamonds.whereditgo.bazaar.catalog.item — successor to DigitalItem (physical excluded, no fixed itemClass taxonomy). */
export type BazaarItem = {
  $type: "diamonds.whereditgo.bazaar.catalog.item";
  title: string;
  sellerDid: string;
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
  sellerDid: string;
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
  licenseUri: string;
  licenseGrantCid: string;
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
  item: ItemRef;
  listingUri: string;
  listingCid: string;
  pricePaid: Money;
  paymentProcessor: string;
  paymentRef: string;
  /** Required for v5 records; may be absent on legacy receipts. */
  buyerDid?: string;
  licenseGrantUri?: string;
  licenseGrantCid?: string;
  shippingAddress?: Address;
  fulfillmentUri?: string;
  /**
   * Frozen download entitlement: the catalog.item URIs this purchase covers,
   * captured at checkout. Absent on legacy receipts. Later edits to a
   * product's items[] do not change it.
   */
  grantedItems?: string[];
  storefrontDid: string;
  merchantDid: string;
  appSig: string;
  purchasedAt: string;
  note?: string;
};

export type PurchaseConsent = {
  $type: "diamonds.whereditgo.bazaar.purchase.consent";
  receiptUri: string;
  receiptCid: string;
  licenseGrantUri: string;
  licenseGrantCid: string;
  buyerDid: string;
  consentedAt: string;
  appSig: string;
};

export type Recording = {
  $type: "diamonds.whereditgo.bazaar.catalog.recording";
  itemUri: string;
  itemCid: string;
  isrc?: string;
  iswc?: string;
  recordingMetaUri?: string;
  songMetaUri?: string;
  masterOwnerDid?: string;
  publishingOwnerDid?: string;
  publishingOwnerIpi?: string;
  masterLicenseTermsUri?: string;
  publishingLicenseTermsUri?: string;
  bazaarRid?: unknown;
  bazaarWid?: unknown;
  createdAt: string;
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

export type CatalogItem = DigitalItem | Collection | PhysicalItem | BazaarItem | Product;

/**
 * catalog.item/catalog.product renamed artistDid -> sellerDid; the legacy
 * types (DigitalItem, Collection, PhysicalItem) still use artistDid. Reading
 * through this everywhere means legacy records keep resolving forever with
 * no republish required.
 */
export function catalogItemSellerDid(item: CatalogItem): string {
  return "sellerDid" in item ? item.sellerDid : item.artistDid;
}

/** catalog.item (BazaarItem) has no artworkCid of its own — artwork lives at the product level for the new type. */
export function catalogItemArtworkCid(item: CatalogItem): string | undefined {
  return "artworkCid" in item ? item.artworkCid : undefined;
}
