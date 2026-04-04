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
  | "diamonds.whereditgo.bazaar.catalog.item.digital"
  | "diamonds.whereditgo.bazaar.catalog.item.physical"
  | "diamonds.whereditgo.bazaar.catalog.item.bundle"
  | "diamonds.whereditgo.bazaar.catalog.collection";

export type ItemRef = {
  uri: string;
  cid?: string;
  variantSku?: string;
  itemType: BazaarItemType;
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
  essential?: boolean;
  trackNumber?: number;
  discNumber?: number;
  title?: string;
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
  supersededBy?: string;
  availableFrom?: string;
  availableUntil?: string;
  maxPurchasesPerBuyer?: number;
  createdAt: string;
};

export type LicenseTerms = {
  $type: "diamonds.whereditgo.bazaar.license.terms";
  title: string;
  tier:
    | "personal"
    | "commercial"
    | "syncMaster"
    | "syncPublishing"
    | "syncFull"
    | "mechanical"
    | "broadcast"
    | "stemLicense";
  rightsType: "master" | "publishing" | "both";
  version: string;
  territoryCoverage: TerritoryCoverage;
  term?: { durationMonths?: number; expiresAt?: string };
  usageRestrictions?: {
    allowsStreaming?: boolean;
    allowsDownload?: boolean;
    allowsCommercialUse?: boolean;
    allowsDerivatives?: boolean;
    allowsSync?: boolean;
    allowsBroadcast?: boolean;
    requiresAttribution?: boolean;
    requiresMechanicalReporting?: boolean;
    requiresShareAlike?: boolean;
  };
  proNotice?: {
    compositionPro?: string;
    publishingOwnerIpi?: string;
    masterOwnerDid?: string;
  };
  legalMetadata?: {
    governingLaw?: string;
    disputeVenue?: string;
    copyrightRegistrationId?: string;
    copyrightYear?: number;
    proMembership?: string;
  };
  humanReadableUrl?: string;
  summary?: string;
  editionSize?: number;
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
  appDid: string;
  issuerScope: string;
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
  usageTier?: "personal" | "commercial" | "sync";
  syncProject?: string;
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

export type CatalogItem = DigitalItem | Collection;

export type CompletenessScore = {
  score: number;
  required: string[];
  recommended: string[];
  optional: string[];
};
