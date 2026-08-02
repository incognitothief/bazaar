import {
  buildDevStubItemJson,
  buildDevStubListingJson,
  DEV_STUB_LISTING_CID,
  devCheckoutStubAllowed,
  isDevStubListingUri,
} from "@bazaar/shared";
import { eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { Hono } from "hono";
import Stripe from "stripe";
import { AtUri } from "@atproto/syntax";
import type { Db } from "../db";
import { paymentFulfillment } from "../db/schema";
import type { OAuthClient } from "../lib/atproto/oauth";
import { storefrontWebOrigin } from "../lib/atproto/oauth-url";
import {
  fulfillCheckoutSession,
  parentListingAllowsSale,
} from "../lib/stripe/fulfillCheckoutSession";
import { getStripe } from "../lib/stripe/getStripe";
import {
  resolveStripeWebhookSecret,
} from "../lib/stripe/stripeCredentials";
import { getAgentForDid } from "../lib/atproto/resolvePds";

/** Same as `bazaar_atp_session` in atproto routes — buyer must match checkout metadata. */
const SESSION_COOKIE = "bazaar_atp_session";

function buyerDidValid(did: string): boolean {
  return did.startsWith("did:") && did.length > 8;
}

function fulfillmentRowForCheckoutSession(
  db: Db,
  session: Stripe.Checkout.Session,
): typeof paymentFulfillment.$inferSelect | undefined {
  const bySession = db
    .select()
    .from(paymentFulfillment)
    .where(eq(paymentFulfillment.checkoutSessionId, session.id))
    .get();
  if (bySession) return bySession;
  const piRef =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!piRef) return undefined;
  return db
    .select()
    .from(paymentFulfillment)
    .where(eq(paymentFulfillment.paymentIntentId, piRef))
    .get();
}

async function getRecordJson(uri: string): Promise<Record<string, unknown> | null> {
  try {
    const at = new AtUri(uri);
    const agent = await getAgentForDid(at.hostname);
    const res = await agent.com.atproto.repo.getRecord({
      repo: at.hostname,
      collection: at.collection,
      rkey: at.rkey,
    });
    return res.data.value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function listingHasV5License(listing: Record<string, unknown>): boolean {
  const licUri = listing.licenseUri;
  const licCid = listing.licenseGrantCid;
  return (
    typeof licUri === "string" &&
    licUri.length > 0 &&
    typeof licCid === "string" &&
    licCid.length > 0
  );
}

export function createStripeRouter(db: Db, oauthClient: OAuthClient) {
  const r = new Hono();

  r.post("/checkout", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      listingUri?: string;
      itemUri?: string;
      buyerDid?: string;
    } | null;
    const listingUri = body?.listingUri;
    const itemUri = body?.itemUri;
    if (!listingUri || !itemUri) {
      return c.json({ error: "listingUri and itemUri required" }, 400);
    }
    const stripe = await getStripe(db);
    const buyerDidBody = body?.buyerDid ?? "";
    if (stripe && !buyerDidValid(buyerDidBody)) {
      return c.json({ error: "buyerDid required (signed-in ATProto DID)" }, 400);
    }
    if (stripe && buyerDidValid(buyerDidBody)) {
      try {
        await oauthClient.restore(buyerDidBody);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return c.json(
          {
            error: "oauth_session_required",
            detail:
              "The server needs a stored ATProto OAuth session for your DID to write receipts after payment. Use Sign in with ATProto (not dev mock sign-in), and use the same host as checkout (prefer http://127.0.0.1:5173 in dev, not localhost).",
            cause: msg,
          },
          401,
        );
      }
    }
    let listing: Record<string, unknown>;
    let listingCid: string;
    if (devCheckoutStubAllowed() && isDevStubListingUri(listingUri)) {
      listing = buildDevStubListingJson(itemUri);
      listingCid = DEV_STUB_LISTING_CID;
    } else {
      const listingAt = new AtUri(listingUri);
      const agent = await getAgentForDid(listingAt.hostname);
      let listingRes;
      try {
        listingRes = await agent.com.atproto.repo.getRecord({
          repo: listingAt.hostname,
          collection: listingAt.collection,
          rkey: listingAt.rkey,
        });
      } catch {
        return c.json({ error: "Could not resolve listing" }, 404);
      }
      const cid = listingRes.data.cid;
      if (!cid) {
        return c.json({ error: "Listing has no CID" }, 500);
      }
      listing = listingRes.data.value as Record<string, unknown>;
      listingCid = cid;
    }
    if (!listingHasV5License(listing)) {
      return c.json(
        { error: "Listing must include licenseUri and licenseGrantCid" },
        400,
      );
    }
    const st = listing.status as string | undefined;
    if (st && st !== "active") {
      return c.json({ error: "Listing is not active" }, 400);
    }
    const parentListingUri = listing.parentListing as string | undefined;
    if (typeof parentListingUri === "string" && parentListingUri.length > 0) {
      const parentOk = await parentListingAllowsSale(parentListingUri);
      if (!parentOk) {
        return c.json({ error: "Parent collection listing is not active" }, 400);
      }
    }
    let item = await getRecordJson(itemUri);
    if (
      !item &&
      devCheckoutStubAllowed() &&
      isDevStubListingUri(listingUri)
    ) {
      item = buildDevStubItemJson(itemUri);
    }
    if (!item) {
      return c.json({ error: "Could not resolve item" }, 404);
    }
    const price = listing.price as { amount?: number; currency?: string } | undefined;
    if (!price?.amount || !price?.currency) {
      return c.json({ error: "Invalid listing price" }, 400);
    }
    const title = (item.title as string | undefined) ?? "Bazaar item";
    const webOrigin = storefrontWebOrigin();
    const metadata: Record<string, string> = {
      listingUri,
      itemUri,
      listingCid,
      appDid: process.env.APP_DID ?? "",
      buyerDid: body?.buyerDid ?? "",
    };
    if (!stripe) {
      return c.json({
        url: `${webOrigin}/purchase/success?session_id=mock_${Date.now()}`,
        mock: true,
      });
    }
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: price.currency.toLowerCase(),
              unit_amount: price.amount,
              product_data: { name: title },
            },
            quantity: 1,
          },
        ],
        success_url: `${webOrigin}/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${webOrigin}/item/${encodeURIComponent(itemUri)}`,
        metadata,
      });
      const url = session.url;
      if (!url) return c.json({ error: "No checkout URL" }, 500);
      return c.json({ url });
    } catch (e) {
      console.error("Stripe checkout error:", e);
      const detail =
        e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : e instanceof Error
            ? e.message
            : String(e);
      return c.json({ error: "checkout_failed", detail }, 502);
    }
  });

  /**
   * After redirect from Stripe Checkout, the browser can call this so PDS writes run even when
   * the webhook is misconfigured, delayed, or unreachable (common in local dev).
   * Requires an httpOnly session cookie whose DID matches `metadata.buyerDid` on the session.
   */
  r.post("/fulfill-session", async (c) => {
    const stripe = await getStripe(db);
    if (!stripe) {
      return c.json({ error: "stripe_not_configured" }, 503);
    }
    const cookieDid = getCookie(c, SESSION_COOKIE);
    const body = (await c.req.json().catch(() => null)) as {
      session_id?: string;
    } | null;
    const sessionId = body?.session_id?.trim();
    if (!sessionId) {
      return c.json({ error: "session_id required" }, 400);
    }
    if (sessionId.startsWith("mock_")) {
      return c.json(
        {
          error: "mock_checkout",
          detail:
            "Dev mock checkout does not create Stripe sessions or PDS records; use real Stripe or the webhook path.",
        },
        400,
      );
    }
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch {
      return c.json({ error: "session_not_found" }, 404);
    }
    if (session.payment_status !== "paid") {
      return c.json(
        {
          error: "not_paid",
          payment_status: session.payment_status,
        },
        400,
      );
    }
    const buyerDid = session.metadata?.buyerDid ?? "";
    if (!buyerDidValid(buyerDid)) {
      return c.json({ error: "checkout_missing_buyer_did" }, 400);
    }
    if (cookieDid && cookieDid !== buyerDid) {
      return c.json({ error: "buyer_mismatch" }, 403);
    }
    const skipReason = await fulfillCheckoutSession({
      db,
      stripe,
      oauthClient,
      session,
      source: "client",
    });
    if (skipReason === "locked") {
      return c.json(
        { ok: false, retry_after_ms: 2500, reason: "locked" },
        409,
      );
    }
    const row = fulfillmentRowForCheckoutSession(db, session);
    const buyerCookieOk = !!(cookieDid && cookieDid === buyerDid);
    const itemUriMeta = session.metadata?.itemUri;
    const showPds =
      buyerCookieOk &&
      row &&
      (row.receiptUri?.length || row.consentUri?.length);
    return c.json({
      ok: true,
      ...(skipReason ? { note: `claim_skipped:${skipReason}` } : {}),
      ...(buyerCookieOk &&
      typeof itemUriMeta === "string" &&
      itemUriMeta.startsWith("at://")
        ? { itemUri: itemUriMeta }
        : {}),
      ...(showPds
        ? {
            pds: {
              receiptUri: row.receiptUri ?? null,
              consentUri: row.consentUri ?? null,
              receiptCid: row.receiptCid ?? null,
            },
          }
        : {}),
    });
  });

  r.get("/session-status", async (c) => {
    const sessionId = c.req.query("session_id");
    if (!sessionId?.length) {
      return c.json({ error: "session_id required" }, 400);
    }
    if (sessionId.startsWith("mock_")) {
      return c.json({
        status: "complete",
        mock: true,
        paymentStatus: "paid",
      });
    }
    const stripe = await getStripe(db);
    if (!stripe) {
      return c.json({ error: "stripe_not_configured" }, 503);
    }
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      return c.json({
        status: session.status,
        paymentStatus: session.payment_status,
        amountTotal: session.amount_total,
        currency: session.currency,
      });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  });

  r.get("/account-status", async (c) => {
    const stripe = await getStripe(db);
    const whSecret = await resolveStripeWebhookSecret(db);
    const webhookConfigured = !!(
      whSecret && !whSecret.includes("PLACEHOLDER")
    );
    return c.json({
      connected: !!stripe,
      webhookConfigured,
    });
  });

  r.get("/connect", async () => {
    const stripe = await getStripe(db);
    if (!stripe) {
      return new Response(
        "Stripe is not configured. Add STRIPE_SECRET_KEY to the environment or save keys from the merchant dashboard.",
        { status: 503 },
      );
    }
    return new Response(
      "Stripe Connect onboarding URL would be generated here (deferred).",
      { status: 501 },
    );
  });

  r.post("/webhook", async (c) => {
    const stripe = await getStripe(db);
    const whSecret = await resolveStripeWebhookSecret(db);
    if (!stripe || !whSecret || whSecret.includes("PLACEHOLDER")) {
      return c.text("Webhook not configured", 503);
    }
    const sig = c.req.header("stripe-signature");
    const rawBody = await c.req.text();
    if (!sig) return c.text("Missing signature", 400);
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, sig, whSecret);
    } catch (err) {
      console.error("Stripe webhook signature error:", err);
      return c.text("Invalid signature", 400);
    }
    if (event.type !== "checkout.session.completed") {
      return c.json({ received: true });
    }
    const session = event.data.object as Stripe.Checkout.Session;
    await fulfillCheckoutSession({
      db,
      stripe,
      oauthClient,
      session,
      source: "webhook",
    });
    return c.json({ received: true });
  });

  return r;
}
