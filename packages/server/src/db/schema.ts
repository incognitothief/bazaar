import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Stripe PaymentIntent → PDS receipt/consent fulfillment state machine. */
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
