import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Single-row KYC / storefront business details (optional env override per field). */
export const merchantBusinessProfile = sqliteTable("merchant_business_profile", {
  singleton: integer("singleton").primaryKey({ autoIncrement: false }).default(1),
  businessName: text("business_name"),
  businessState: text("business_state"),
  businessEmail: text("business_email"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Single-row Stripe API keys when not set via environment (see stripeCredentials). */
export const merchantStripeConfig = sqliteTable("merchant_stripe_config", {
  singleton: integer("singleton").primaryKey({ autoIncrement: false }).default(1),
  stripeSecretKey: text("stripe_secret_key"),
  stripeWebhookSecret: text("stripe_webhook_secret"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Stripe PaymentIntent → PDS receipt fulfillment state machine. */
/** Resumable inventory uploads + deferred PDS publish (digital first; discriminator for future physical). */
export const inventoryUploadSession = sqliteTable("inventory_upload_session", {
  id: text("id").primaryKey(),
  merchantDid: text("merchant_did").notNull(),
  /** e.g. digital — reserved for physical expansion */
  inventoryKind: text("inventory_kind").notNull().default("digital"),
  status: text("status").notNull().default("active"),
  draftJson: text("draft_json"),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  publishError: text("publish_error"),
  pdsSnapshotJson: text("pds_snapshot_json"),
  /**
   * inventoryKind "product" sessions only. Either a fresh TID minted at
   * session creation (new product -- becomes that catalog.product record's
   * actual rkey at publish, passed explicitly rather than left to the PDS
   * to assign) or the rkey of an already-existing product (adding items /
   * assets to it). Every object uploaded in this session keys its R2
   * object under this rkey -- see lib/r2/inventoryKey.ts.
   */
  productRkey: text("product_rkey"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const inventoryUploadObject = sqliteTable("inventory_upload_object", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => inventoryUploadSession.id, { onDelete: "cascade" }),
  slotId: text("slot_id").notNull(),
  rkey: text("rkey").notNull(),
  role: text("role").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type"),
  byteSize: integer("byte_size"),
  uploadKind: text("upload_kind").notNull().default("single_put"),
  s3UploadId: text("s3_upload_id"),
  status: text("status").notNull().default("initiated"),
  r2Key: text("r2_key").notNull(),
  fileChecksum: text("file_checksum"),
  fileCid: text("file_cid"),
  durationMs: integer("duration_ms"),
  /**
   * Pixel dimensions for raster image masters, read client-side at upload
   * (createImageBitmap) and passed through the publish draft -- ERP-only,
   * never on the PDS record, same lifecycle as durationMs. Null for
   * non-image files, vector art (no intrinsic px size), or legacy uploads.
   */
  mediaWidth: integer("media_width"),
  mediaHeight: integer("media_height"),
  error: text("error"),
  /**
   * R2 key of a webp derivative for this object, if one was generated
   * (best-effort, "artwork"-role objects only -- see lib/webpDerivative.ts).
   * Null means either generation wasn't attempted (legacy upload, non-image
   * file) or it failed; either way the read path falls back to r2Key.
   * Never used for the product download package, only storefront display.
   */
  webpR2Key: text("webp_r2_key"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Append-only publish hints for merchant listings UI (not lexicon). */
export const inventoryPrefillLog = sqliteTable(
  "inventory_prefill_log",
  {
    id: text("id").primaryKey(),
    merchantDid: text("merchant_did").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    payloadJson: text("payload_json").notNull(),
  },
  (t) => ({
    merchantCreatedIdx: index("idx_inventory_prefill_merchant_created").on(
      t.merchantDid,
      t.createdAt,
    ),
  }),
);

export const inventoryUploadPart = sqliteTable(
  "inventory_upload_part",
  {
    objectId: text("object_id")
      .notNull()
      .references(() => inventoryUploadObject.id, { onDelete: "cascade" }),
    partNumber: integer("part_number").notNull(),
    etag: text("etag").notNull(),
    size: integer("size"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.objectId, t.partNumber] }),
  }),
);

/**
 * Write-time capture of license.terms content, keyed by CID. license.terms
 * has no update scope (create-only), so a given CID's content is permanent —
 * a repeat capture of the same CID is a no-op, not a new historical state.
 * This is what the public license inspector reads from; it never re-fetches
 * from the PDS, so a license stays viewable even if the merchant later
 * retires the record it came from.
 */
export const licenses = sqliteTable("licenses", {
  cid: text("cid").primaryKey(),
  uri: text("uri").notNull(),
  merchantDid: text("merchant_did").notNull(),
  title: text("title").notNull(),
  version: text("version").notNull(),
  licenseText: text("license_text").notNull(),
  checkoutConsentRequired: integer("checkout_consent_required", {
    mode: "boolean",
  }).notNull(),
  capturedAt: integer("captured_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * ERP-first mirror of catalog.item content, keyed by URI (not CID) — unlike
 * license.terms, catalog.item supports putRecord, so a given URI's row is
 * upserted on every create/put/sync rather than accumulating one row per
 * CID. `cid` tracks the current live CID for checkout-time pinning checks.
 * This table is the primary read path for storefront/merchant item views;
 * the PDS is consulted at checkout time and via the manual "Sync with PDS"
 * action, not on every read.
 */
export const catalogItems = sqliteTable("catalog_items", {
  uri: text("uri").primaryKey(),
  cid: text("cid").notNull(),
  merchantDid: text("merchant_did").notNull(),
  title: text("title").notNull(),
  category: text("category"),
  description: text("description"),
  /** JSON-serialized string[] -- freeform, seller-authored, no taxonomy. Mirrors catalog.item's own tags field. */
  tags: text("tags"),
  format: text("format"),
  fileChecksum: text("file_checksum"),
  fileCid: text("file_cid"),
  supersedes: text("supersedes"),
  /**
   * Links back to inventoryUploadObject.id -- the only way to resolve this
   * item's own R2 file (see lib/r2/inventoryKey.ts's newAssetKey). Not on
   * the PDS record, so set once at creation (via captureCatalogItem's opts)
   * and preserved on every later capture, same as catalogProducts.productType.
   */
  objectId: text("object_id"),
  /** The record's own createdAt field, as authored (immutable on the PDS). */
  recordCreatedAt: text("record_created_at"),
  capturedAt: integer("captured_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Merchant (storefront) signing keys — a boot-rebuilt audit mirror of the environment
 * (`STOREFRONT_PRIVATE_KEY` / `_KID` / `_PUBLIC_MULTIBASE` / `_KEY_HISTORY`). Zero authority:
 * `reconcileStorefrontKeys()` truncates and repopulates it on every startup. Verification reads
 * the in-memory key set, not this table. See `docs/adr/0013-key-rotation-and-did-document-v2.md`.
 */
export const appKeys = sqliteTable("app_keys", {
  /** Bare fragment, e.g. storefront-key-2026-08-29. */
  kid: text("kid").primaryKey(),
  /** Full DID URL. */
  id: text("id").notNull(),
  publicKeyMultibase: text("public_key_multibase").notNull(),
  publicKeyPem: text("public_key_pem").notNull(),
  /** Derived: "current" | "retired" | "revoked". */
  status: text("status").notNull(),
  /** Full DID URL of the key that superseded this one; null for the current key. */
  supersededBy: text("superseded_by"),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** ERP-first mirror of catalog.product content. Same upsert-by-URI shape as catalogItems. */
export const catalogProducts = sqliteTable("catalog_products", {
  uri: text("uri").primaryKey(),
  cid: text("cid").notNull(),
  merchantDid: text("merchant_did").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  /** JSON-serialized string[] -- freeform, seller-authored, no taxonomy. Mirrors catalog.item's own tags field. */
  tags: text("tags"),
  /** JSON-serialized itemRef[] — the product's declared composition. */
  items: text("items").notNull(),
  /**
   * UI-only classification (e.g. "music", "generic") -- deliberately NOT on
   * the PDS record. It's not part of what the product publicly *is*, just
   * how our own onboarding/storefront customize themselves; a buyer
   * attesting a purchase never needs it. Set once at creation, preserved
   * (never overwritten) by every later capture -- see captureCatalogProduct.
   */
  productType: text("product_type"),
  /**
   * Whether cover art (a catalogProductAssets row with role "coverArt")
   * gets bundled into the buyer's download package. Also ERP-only -- same
   * reasoning as productType. Everything else in catalogProductAssets is
   * always included; this is the one asset with a toggle.
   */
  artIncludedInDownload: integer("art_included_in_download", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  recordCreatedAt: text("record_created_at"),
  capturedAt: integer("captured_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  /**
   * R2 key of the precomputed download package.zip for this product's
   * *current* contents (see productZip.ts's rebuildProductZipCache). Only
   * trustworthy when packageZipStatus is "ready" -- a buyer download falls
   * back to live assembly whenever it isn't, so a stale/missing key here
   * never results in wrong bytes being served, just a slower request.
   */
  packageZipKey: text("package_zip_key"),
  /** null = never built. "ready" = packageZipKey is current and safe to presign. "failed" = last rebuild attempt errored (e.g. hit MAX_PRODUCT_ZIP_TOTAL_BYTES); packageZipKey (if any) is stale and must not be served. */
  packageZipStatus: text("package_zip_status"),
  packageZipUpdatedAt: integer("package_zip_updated_at", { mode: "timestamp" }),
});

/**
 * Permanent link between a catalog.product and an internal-only companion
 * asset (cover art, liner notes) uploaded via the existing inventory
 * upload mechanism. Unlike inventoryUploadObject's normal lifecycle
 * (staging en route to a PDS publish), these objects are never meant to
 * become their own PDS record -- they aren't essential to the product's
 * public identity, just internal metadata served from the ERP.
 */
export const catalogProductAssets = sqliteTable(
  "catalog_product_assets",
  {
    id: text("id").primaryKey(),
    productUri: text("product_uri").notNull(),
    objectId: text("object_id")
      .notNull()
      .references(() => inventoryUploadObject.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    /** Display order among assets sharing a role -- e.g. slideshow order for multiple "coverArt" rows. Meaningless for a single asset. */
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    productUriIdx: index("idx_catalog_product_assets_product_uri").on(
      t.productUri,
    ),
  }),
);

export const paymentFulfillment = sqliteTable("payment_fulfillment", {
  paymentIntentId: text("payment_intent_id").primaryKey(),
  checkoutSessionId: text("checkout_session_id"),
  /** Purchaser repo DID (from Checkout Session metadata); nullable for legacy rows. */
  buyerDid: text("buyer_did"),
  status: text("status").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  /** Unix ms; when set, sweeper waits until this time for status failed. */
  nextRetryAt: integer("next_retry_at"),
  lastError: text("last_error"),
  receiptUri: text("receipt_uri"),
  receiptCid: text("receipt_cid"),
  /** From the Checkout Session metadata that seeded this row -- lets the Sales page show what was bought without a PDS round trip. */
  itemUri: text("item_uri"),
  listingUri: text("listing_uri"),
  payloadSnapshot: text("payload_snapshot"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
