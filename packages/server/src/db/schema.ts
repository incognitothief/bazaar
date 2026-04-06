import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

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
