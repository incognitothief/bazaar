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

/** Stripe PaymentIntent → PDS receipt/consent fulfillment state machine. */
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
  error: text("error"),
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
 * Merchant (storefront) signing keys — a boot-rebuilt audit mirror of the environment
 * (`APP_MERCHANT_PRIVATE_KEY` / `_KID` / `_PUBLIC_MULTIBASE` / `_KEY_HISTORY`). Zero authority:
 * `reconcileMerchantKeys()` truncates and repopulates it on every startup. Verification reads
 * the in-memory key set, not this table. See `docs/adr/0013-key-rotation-and-did-document-v2.md`.
 */
export const appKeys = sqliteTable("app_keys", {
  kid: text("kid").primaryKey(),
  publicKeyMultibase: text("public_key_multibase").notNull(),
  publicKeyPem: text("public_key_pem").notNull(),
  /** "current" | "active" | "retired" | "revoked" */
  status: text("status").notNull(),
  supersededBy: text("superseded_by"),
  activatedAt: text("activated_at"),
  retiredAt: text("retired_at"),
  notes: text("notes"),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  /** Bumped when a signature verifies against this key. Deferred — not wired yet (ADR 0013). */
  lastVerifiedAt: integer("last_verified_at", { mode: "timestamp" }),
});

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
  consentUri: text("consent_uri"),
  payloadSnapshot: text("payload_snapshot"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
