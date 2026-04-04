import { getCookie } from "hono/cookie";
import { desc } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db";
import { paymentFulfillment } from "../db/schema";

/** Same cookie as atproto routes. */
const SESSION_COOKIE = "bazaar_atp_session";

const LIST_LIMIT = 250;

export function createMerchantRouter(db: Db) {
  const r = new Hono();

  /** Store-owner only: lists `payment_fulfillment` rows for the Stripe → PDS pipeline. */
  r.get("/payment-fulfillments", (c) => {
    const owner = process.env.ARTIST_DID?.trim();
    if (!owner?.startsWith("did:")) {
      return c.json(
        { error: "server_misconfigured", detail: "ARTIST_DID not set" },
        503,
      );
    }
    const did = getCookie(c, SESSION_COOKIE);
    if (!did) {
      return c.json({ error: "unauthorized" }, 401);
    }
    if (did !== owner) {
      return c.json({ error: "forbidden" }, 403);
    }

    const rows = db
      .select()
      .from(paymentFulfillment)
      .orderBy(desc(paymentFulfillment.updatedAt))
      .limit(LIST_LIMIT)
      .all();

    return c.json({
      rows: rows.map((row) => ({
        paymentIntentId: row.paymentIntentId,
        checkoutSessionId: row.checkoutSessionId,
        buyerDid: row.buyerDid,
        status: row.status,
        attemptCount: row.attemptCount,
        nextRetryAt: row.nextRetryAt,
        lastError: row.lastError,
        receiptUri: row.receiptUri,
        receiptCid: row.receiptCid,
        consentUri: row.consentUri,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  });

  return r;
}
