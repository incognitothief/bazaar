import { getCookie } from "hono/cookie";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db";
import {
  merchantBusinessProfile,
  merchantStripeConfig,
  paymentFulfillment,
} from "../db/schema";
import {
  businessEmailFromEnv,
  businessNameFromEnv,
  businessStateFromEnv,
  getEffectiveBusinessProfile,
  getStoredBusinessProfile,
  normalizeBusinessField,
  validateBusinessEmail,
  validateBusinessName,
  validateBusinessState,
} from "../lib/businessProfile";
import {
  stripeCredentialSources,
  stripeSecretKeyFromEnv,
  stripeWebhookSecretFromEnv,
  validateStripeSecretKeyInput,
  validateStripeWebhookSecretInput,
} from "../lib/stripe/stripeCredentials";

/** Same cookie as atproto routes. */
const SESSION_COOKIE = "bazaar_atp_session";

const LIST_LIMIT = 250;

function merchantGuard(c: Context): Response | null {
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
  return null;
}

export function createMerchantRouter(db: Db) {
  const r = new Hono();

  /** Store-owner: business details for KYC pages (DB + optional env override). */
  r.get("/business-settings", (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const effective = getEffectiveBusinessProfile(db);
    const stored = getStoredBusinessProfile(db);
    return c.json({
      businessName: effective.businessName,
      businessState: effective.businessState,
      businessEmail: effective.businessEmail,
      db: {
        businessName: stored.businessName,
        businessState: stored.businessState,
        businessEmail: stored.businessEmail,
      },
      canEditBusinessName: !businessNameFromEnv(),
      canEditBusinessState: !businessStateFromEnv(),
      canEditBusinessEmail: !businessEmailFromEnv(),
    });
  });

  /**
   * Persist business fields to SQLite. Fields overridden by BUSINESS_NAME / BUSINESS_STATE /
   * BUSINESS_EMAIL are ignored (unchanged in DB).
   */
  r.post("/business-settings", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;

    const body = (await c.req.json().catch(() => null)) as {
      businessName?: unknown;
      businessState?: unknown;
      businessEmail?: unknown;
    } | null;
    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid_body" }, 400);
    }

    const hasName = "businessName" in body;
    const hasState = "businessState" in body;
    const hasEmail = "businessEmail" in body;
    if (!hasName && !hasState && !hasEmail) {
      return c.json(
        { error: "validation", detail: "Provide businessName, businessState, and/or businessEmail" },
        400,
      );
    }

    const row = db
      .select()
      .from(merchantBusinessProfile)
      .where(eq(merchantBusinessProfile.singleton, 1))
      .get();

    let nextName = row?.businessName ?? null;
    let nextState = row?.businessState ?? null;
    let nextEmail = row?.businessEmail ?? null;

    if (hasName && !businessNameFromEnv()) {
      const norm = normalizeBusinessField(body.businessName);
      if (norm === undefined) {
        return c.json({ error: "validation", detail: "businessName invalid" }, 400);
      }
      const err = validateBusinessName(norm);
      if (err) return c.json({ error: "validation", detail: err }, 400);
      nextName = norm;
    }

    if (hasState && !businessStateFromEnv()) {
      const norm = normalizeBusinessField(body.businessState);
      if (norm === undefined) {
        return c.json({ error: "validation", detail: "businessState invalid" }, 400);
      }
      const err = validateBusinessState(norm);
      if (err) return c.json({ error: "validation", detail: err }, 400);
      nextState = norm;
    }

    if (hasEmail && !businessEmailFromEnv()) {
      const norm = normalizeBusinessField(body.businessEmail);
      if (norm === undefined) {
        return c.json({ error: "validation", detail: "businessEmail invalid" }, 400);
      }
      const err = validateBusinessEmail(norm);
      if (err) return c.json({ error: "validation", detail: err }, 400);
      nextEmail = norm;
    }

    await db
      .insert(merchantBusinessProfile)
      .values({
        singleton: 1,
        businessName: nextName,
        businessState: nextState,
        businessEmail: nextEmail,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: merchantBusinessProfile.singleton,
        set: {
          businessName: nextName,
          businessState: nextState,
          businessEmail: nextEmail,
          updatedAt: new Date(),
        },
      })
      .run();

    const effective = getEffectiveBusinessProfile(db);
    const stored = getStoredBusinessProfile(db);
    return c.json({
      ok: true,
      businessName: effective.businessName,
      businessState: effective.businessState,
      businessEmail: effective.businessEmail,
      db: {
        businessName: stored.businessName,
        businessState: stored.businessState,
        businessEmail: stored.businessEmail,
      },
      canEditBusinessName: !businessNameFromEnv(),
      canEditBusinessState: !businessStateFromEnv(),
      canEditBusinessEmail: !businessEmailFromEnv(),
    });
  });

  /** Store-owner only: lists `payment_fulfillment` rows for the Stripe → PDS pipeline. */
  r.get("/payment-fulfillments", (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;

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

  /** Where Stripe keys come from (never returns secret values). */
  r.get("/stripe-settings", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const src = await stripeCredentialSources(db);
    return c.json({
      ...src,
      canEditSecretKey: !stripeSecretKeyFromEnv(),
      canEditWebhookSecret: !stripeWebhookSecretFromEnv(),
    });
  });

  /**
   * Save Stripe keys to SQLite when not overridden by environment.
   * Body fields are optional; include a key only when setting or clearing it (`""` clears DB copy).
   */
  r.post("/stripe-settings", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;

    const body = (await c.req.json().catch(() => null)) as {
      stripeSecretKey?: string | null;
      stripeWebhookSecret?: string | null;
    } | null;
    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid_body" }, 400);
    }

    const hasSk = "stripeSecretKey" in body;
    const hasWh = "stripeWebhookSecret" in body;
    if (!hasSk && !hasWh) {
      return c.json(
        { error: "validation", detail: "Provide stripeSecretKey and/or stripeWebhookSecret" },
        400,
      );
    }

    if (hasSk) {
      if (stripeSecretKeyFromEnv()) {
        return c.json(
          {
            error: "env_override",
            detail:
              "STRIPE_SECRET_KEY is set in the environment; unset it to save a dashboard secret key.",
          },
          400,
        );
      }
      if (body.stripeSecretKey !== null && body.stripeSecretKey !== "") {
        const err = validateStripeSecretKeyInput(body.stripeSecretKey);
        if (err) return c.json({ error: "validation", detail: err }, 400);
      }
    }

    if (hasWh) {
      if (stripeWebhookSecretFromEnv()) {
        return c.json(
          {
            error: "env_override",
            detail:
              "STRIPE_WEBHOOK_SECRET is set in the environment; unset it to save a dashboard webhook secret.",
          },
          400,
        );
      }
      if (body.stripeWebhookSecret !== null && body.stripeWebhookSecret !== "") {
        const err = validateStripeWebhookSecretInput(body.stripeWebhookSecret);
        if (err) return c.json({ error: "validation", detail: err }, 400);
      }
    }

    const row = db
      .select()
      .from(merchantStripeConfig)
      .where(eq(merchantStripeConfig.singleton, 1))
      .get();

    let nextSk = row?.stripeSecretKey ?? null;
    let nextWh = row?.stripeWebhookSecret ?? null;

    if (hasSk) {
      if (body.stripeSecretKey === null || body.stripeSecretKey === "") {
        nextSk = null;
      } else {
        nextSk = body.stripeSecretKey.trim();
      }
    }
    if (hasWh) {
      if (body.stripeWebhookSecret === null || body.stripeWebhookSecret === "") {
        nextWh = null;
      } else {
        nextWh = body.stripeWebhookSecret.trim();
      }
    }

    await db
      .insert(merchantStripeConfig)
      .values({
        singleton: 1,
        stripeSecretKey: nextSk,
        stripeWebhookSecret: nextWh,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: merchantStripeConfig.singleton,
        set: {
          stripeSecretKey: nextSk,
          stripeWebhookSecret: nextWh,
          updatedAt: new Date(),
        },
      })
      .run();

    const src = await stripeCredentialSources(db);
    return c.json({ ok: true, ...src });
  });

  return r;
}
