/** Types aligned with diamonds.whereditgo.bazaar.* lexicons */

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
  attributes: Record<string, string>;
  weight?: Weight;
  dimensions?: Dimensions;
  additionalPrice?: Money;
  artworkCid?: string;
};

export type ItemRef = {
  uri: string;
  cid?: string;
  variantSku?: string;
  itemType: string;
};

export type Address = {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  countryCode: string;
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
    | "ebook"
    | "other";
  description?: string;
  formats: string[];
  durationMs?: number;
  releaseDate?: string;
  artworkCid?: string;
  genre?: string[];
  isrc?: string;
  iswc?: string;
  defaultLicenseUri?: string;
  createdAt: string;
};

export type Collection = {
  $type: "diamonds.whereditgo.bazaar.collection";
  title: string;
  artistName: string;
  description?: string;
  formats?: string[];
  collectionType?: "album" | "ep" | "single" | "bundle" | "compilation";
  releaseDate: string;
  tracks: Array<{
    uri: string;
    cid?: string;
    trackNumber?: number;
    discNumber?: number;
  }>;
  artworkCid?: string;
  genre?: string[];
  upc?: string;
  price?: Money;
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
    | "archived";
  availableFrom?: string;
  availableUntil?: string;
  maxPurchasesPerBuyer?: number;
  createdAt: string;
};

export type TerritoryCoverage = {
  scope: "worldwide" | "excluding" | "only";
  territories?: string[];
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

/** Master recording reference (lexicon stub for future use) */
export type Recording = {
  $type: "diamonds.whereditgo.bazaar.catalog.recording";
  title: string;
  artistDid: string;
  isrc?: string;
  createdAt: string;
};

export type Stock = {
  $type: "diamonds.whereditgo.bazaar.purchase.stock";
  item: ItemRef;
  quantity: number;
  sku?: string;
  createdAt: string;
};

export type Fulfillment = {
  $type: "diamonds.whereditgo.bazaar.purchase.fulfillment";
  receiptUri: string;
  status: "pending" | "shipped" | "delivered" | "cancelled";
  carrier?: string;
  trackingNumber?: string;
  createdAt: string;
};

export type ActorProfile = {
  $type: "diamonds.whereditgo.bazaar.actor.profile";
  displayName?: string;
  description?: string;
  avatarCid?: string;
  createdAt: string;
};

export type CatalogItem = DigitalItem | Collection;

export type CompletenessScore = {
  score: number;
  required: string[];
  recommended: string[];
  optional: string[];
};
