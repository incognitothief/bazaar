import { Hono } from "hono";
import Stripe from "stripe";
import { AtUri } from "@atproto/syntax";
import type { Db } from "../db";
import { meta } from "../db/schema";
import { getAgent } from "../lib/atproto/client";
import { signReceiptPayload } from "../lib/atproto/sign";
import { oauthAppBaseUrl } from "../lib/atproto/oauth-url";

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.includes("PLACEHOLDER")) return null;
  return new Stripe(key);
}

async function getRecordJson(uri: string): Promise<Record<string, unknown> | null> {
  try {
    const at = new AtUri(uri);
    const agent = getAgent();
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

export function createStripeRouter(db: Db) {
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
    const listingAt = new AtUri(listingUri);
    const agent = getAgent();
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
    const listing = listingRes.data.value as Record<string, unknown>;
    const item = await getRecordJson(itemUri);
    if (!item) {
      return c.json({ error: "Could not resolve item" }, 404);
    }
    const price = listing.price as { amount?: number; currency?: string } | undefined;
    if (!price?.amount || !price?.currency) {
      return c.json({ error: "Invalid listing price" }, 400);
    }
    const title = (item.title as string | undefined) ?? "Bazaar item";
    const appUrl = oauthAppBaseUrl();
    const listingCid = listingRes.data.cid;
    const metadata: Record<string, string> = {
      listingUri,
      itemUri,
      listingCid: listingCid ?? "",
      appDid: process.env.APP_DID ?? "",
      buyerDid: body?.buyerDid ?? "",
    };
    const stripe = getStripe();
    if (!stripe) {
      return c.json({
        url: `${appUrl}/purchase/success?session_id=mock_${Date.now()}`,
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
        success_url: `${appUrl}/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/item/${encodeURIComponent(itemUri)}`,
        metadata,
      });
      const url = session.url;
      if (!url) return c.json({ error: "No checkout URL" }, 500);
      return c.json({ url });
    } catch (e) {
      console.error("Stripe checkout error:", e);
      return c.json({ error: "checkout_failed" }, 502);
    }
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
    const stripe = getStripe();
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

  r.get("/account-status", (c) =>
    c.json({ connected: false, details: "stub" }),
  );

  r.get("/connect", () => {
    const stripe = getStripe();
    if (!stripe) {
      return new Response("Stripe is not configured.", { status: 503 });
    }
    return new Response(
      "Stripe Connect onboarding URL would be generated here (deferred).",
      { status: 501 },
    );
  });

  r.post("/webhook", async (c) => {
    const stripe = getStripe();
    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !whSecret || whSecret.includes("PLACEHOLDER")) {
      return c.text("Webhook not configured", 503);
    }
    const sig = c.req.header("stripe-signature");
    const rawBody = await c.req.text();
    if (!sig) return c.text("Missing signature", 400);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, whSecret);
    } catch (err) {
      console.error("Stripe webhook signature error:", err);
      return c.text("Invalid signature", 400);
    }
    if (event.type !== "checkout.session.completed") {
      return c.json({ received: true });
    }
    const session = event.data.object as Stripe.Checkout.Session;
    const md = session.metadata ?? {};
    const listingUri = md.listingUri;
    const itemUri = md.itemUri;
    const listingCid = md.listingCid;
    const buyerDid = md.buyerDid ?? "";
    if (!listingUri || !itemUri || !listingCid) {
      console.warn("checkout.session.completed missing metadata");
      return c.json({ received: true });
    }
    const listing = await getRecordJson(listingUri);
    if (listing) {
      const st = listing.status as string | undefined;
      if (st && st !== "active") {
        console.warn("Listing no longer active:", listingUri);
      }
    }
    const privateKey = process.env.APP_SERVICE_PRIVATE_KEY;
    const purchasedAt = new Date().toISOString();
    const paymentRef =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? session.id;
    let appSig = "";
    if (privateKey && !privateKey.includes("PLACEHOLDER") && buyerDid) {
      try {
        const pem = privateKey.includes("BEGIN")
          ? privateKey
          : `-----BEGIN RSA PRIVATE KEY-----\n${privateKey}\n-----END RSA PRIVATE KEY-----`;
        appSig = signReceiptPayload({
          purchasedAt,
          paymentRef,
          itemUri,
          listingCid,
          buyerDid,
          privateKeyPem: pem,
        });
      } catch (e) {
        console.warn("Receipt signing failed:", e);
      }
    } else if (!buyerDid) {
      console.info("buyerDid absent; receipt signing / PDS write skipped");
    }
    const item = await getRecordJson(itemUri);
    const issuerScope =
      (item?.artistDid as string | undefined) ??
      process.env.ARTIST_DID ??
      "";
    const receiptPayload = {
      receiptUri: null as string | null,
      itemUri,
      listingUri,
      listingCid,
      paymentRef,
      purchasedAt,
      appSig,
      issuerScope,
      amountTotal: session.amount_total,
      currency: session.currency,
    };
    // Buyer PDS receipt write requires buyer credentials (deferred); persist server-side only.
    await db
      .insert(meta)
      .values({
        key: `receipt:${paymentRef}`,
        value: JSON.stringify(receiptPayload),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: meta.key,
        set: {
          value: JSON.stringify(receiptPayload),
          updatedAt: new Date(),
        },
      });
    console.info("Would generate download link for", itemUri);
    return c.json({ received: true });
  });

  return r;
}
