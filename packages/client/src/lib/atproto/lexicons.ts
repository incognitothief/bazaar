/**
 * Lexicon JSON documents for diamonds.whereditgo.bazaar.* (scaffold).
 * Canonical definitions should live in a shared package once published.
 */

const LEXICON_VERSION = 1 as const;

function recordLexicon(
  id: string,
  record: Record<string, unknown>,
): Record<string, unknown> {
  return {
    lexicon: LEXICON_VERSION,
    id,
    defs: {
      main: {
        type: "record",
        key: "tid",
        record,
      },
    },
  };
}

export const LEXICON_DEFS = {
  lexicon: LEXICON_VERSION,
  id: "diamonds.whereditgo.bazaar.defs",
  defs: {
    money: {
      type: "object",
      required: ["amount", "currency"],
      properties: {
        amount: { type: "integer" },
        currency: { type: "string", maxLength: 3 },
      },
    },
    itemRef: {
      type: "object",
      required: ["uri", "itemType"],
      properties: {
        uri: { type: "string", format: "at-uri" },
        cid: { type: "string", format: "cid" },
        variantSku: { type: "string" },
        itemType: { type: "string" },
      },
    },
  },
} as const;

export const LEXICON_TRACK = recordLexicon(
  "diamonds.whereditgo.bazaar.catalog.item.digital",
  {
    type: "object",
    required: ["title", "artistDid", "itemClass", "formats", "createdAt"],
    properties: {
      title: { type: "string", maxLength: 512 },
      artistDid: { type: "string", format: "did" },
      itemClass: { type: "string" },
      description: { type: "string", maxLength: 4096 },
      formats: { type: "array", items: { type: "string" } },
      durationMs: { type: "integer" },
      releaseDate: { type: "string", format: "datetime" },
      artworkCid: { type: "string" },
      genre: { type: "array", items: { type: "string" } },
      isrc: { type: "string" },
      iswc: { type: "string" },
      defaultLicenseUri: { type: "string", format: "at-uri" },
      createdAt: { type: "string", format: "datetime" },
    },
  },
);

export const LEXICON_COLLECTION = recordLexicon(
  "diamonds.whereditgo.bazaar.collection",
  {
    type: "object",
    required: ["title", "artistName", "releaseDate", "tracks", "createdAt"],
    properties: {
      title: { type: "string" },
      artistName: { type: "string" },
      collectionType: { type: "string" },
      releaseDate: { type: "string", format: "datetime" },
      tracks: { type: "array", items: { type: "object" } },
      artworkCid: { type: "string" },
      genre: { type: "array", items: { type: "string" } },
      upc: { type: "string" },
      price: { type: "object" },
      createdAt: { type: "string", format: "datetime" },
    },
  },
);

export const LEXICON_LISTING = recordLexicon(
  "diamonds.whereditgo.bazaar.catalog.listing",
  {
    type: "object",
    required: ["item", "price", "status", "createdAt"],
    properties: {
      item: { type: "ref", ref: "#defs/itemRef" },
      price: { type: "object" },
      compareAtPrice: { type: "object" },
      status: { type: "string" },
      availableFrom: { type: "string", format: "datetime" },
      availableUntil: { type: "string", format: "datetime" },
      maxPurchasesPerBuyer: { type: "integer" },
      createdAt: { type: "string", format: "datetime" },
    },
  },
);

export const LEXICON_LICENSE_TERMS = recordLexicon(
  "diamonds.whereditgo.bazaar.license.terms",
  {
    type: "object",
    required: [
      "title",
      "tier",
      "rightsType",
      "version",
      "territoryCoverage",
      "checkoutConsentRequired",
      "createdAt",
    ],
    properties: {
      title: { type: "string" },
      tier: { type: "string" },
      rightsType: { type: "string" },
      version: { type: "string" },
      territoryCoverage: { type: "object" },
      term: { type: "object" },
      usageRestrictions: { type: "object" },
      proNotice: { type: "object" },
      legalMetadata: { type: "object" },
      humanReadableUrl: { type: "string" },
      summary: { type: "string" },
      editionSize: { type: "integer" },
      checkoutConsentRequired: { type: "boolean" },
      createdAt: { type: "string", format: "datetime" },
    },
  },
);

export const LEXICON_RECORDING = recordLexicon(
  "diamonds.whereditgo.bazaar.catalog.recording",
  {
    type: "object",
    required: ["title", "artistDid", "createdAt"],
    properties: {
      title: { type: "string" },
      artistDid: { type: "string", format: "did" },
      isrc: { type: "string" },
      createdAt: { type: "string", format: "datetime" },
    },
  },
);

export const LEXICON_RECEIPT = recordLexicon(
  "diamonds.whereditgo.bazaar.purchase.receipt",
  {
    type: "object",
    required: [
      "item",
      "listingUri",
      "listingCid",
      "pricePaid",
      "paymentProcessor",
      "paymentRef",
      "appDid",
      "issuerScope",
      "appSig",
      "purchasedAt",
    ],
    properties: {
      item: { type: "object" },
      listingUri: { type: "string", format: "at-uri" },
      listingCid: { type: "string", format: "cid" },
      pricePaid: { type: "object" },
      paymentProcessor: { type: "string" },
      paymentRef: { type: "string" },
      licenseGrantUri: { type: "string" },
      licenseGrantCid: { type: "string" },
      shippingAddress: { type: "object" },
      fulfillmentUri: { type: "string" },
      appDid: { type: "string", format: "did" },
      issuerScope: { type: "string" },
      appSig: { type: "string" },
      purchasedAt: { type: "string", format: "datetime" },
      note: { type: "string" },
    },
  },
);

export const LEXICON_STOCK = recordLexicon(
  "diamonds.whereditgo.bazaar.purchase.stock",
  {
    type: "object",
    required: ["item", "quantity", "createdAt"],
    properties: {
      item: { type: "object" },
      quantity: { type: "integer" },
      sku: { type: "string" },
      createdAt: { type: "string", format: "datetime" },
    },
  },
);

export const LEXICON_FULFILLMENT = recordLexicon(
  "diamonds.whereditgo.bazaar.purchase.fulfillment",
  {
    type: "object",
    required: ["receiptUri", "status", "createdAt"],
    properties: {
      receiptUri: { type: "string", format: "at-uri" },
      status: { type: "string" },
      carrier: { type: "string" },
      trackingNumber: { type: "string" },
      createdAt: { type: "string", format: "datetime" },
    },
  },
);

export const LEXICON_ACTOR_PROFILE = recordLexicon(
  "diamonds.whereditgo.bazaar.actor.profile",
  {
    type: "object",
    required: ["createdAt"],
    properties: {
      displayName: { type: "string" },
      description: { type: "string" },
      avatarCid: { type: "string" },
      createdAt: { type: "string", format: "datetime" },
    },
  },
);
