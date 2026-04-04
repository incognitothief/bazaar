import {
  buildDevStubItemJson,
  buildDevStubListingJson,
  DEV_STUB_LISTING_CID,
  devCheckoutStubAllowed,
  isDevStubListingUri,
  tryDevStubListingSnapshot,
} from "@bazaar/shared";
import { Agent } from "@atproto/api";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import Stripe from "stripe";
import { AtUri } from "@atproto/syntax";
import type { Db } from "../db";
import { meta } from "../db/schema";
import { getAgent } from "../lib/atproto/client";
import type { OAuthClient } from "../lib/atproto/oauth";
import { storefrontWebOrigin } from "../lib/atproto/oauth-url";
import { signConsentPayload, signReceiptPayload } from "../lib/atproto/sign";

const COL_RECEIPT = "diamonds.whereditgo.bazaar.purchase.receipt";
const COL_CONSENT = "diamonds.whereditgo.bazaar.purchase.consent";

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.includes("PLACEHOLDER")) return null;
  return new Stripe(key);
}

function buyerDidValid(did: string): boolean {
  return did.startsWith("did:") && did.length > 8;
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

async function getListingAtCid(
  listingUri: string,
  listingCid: string,
): Promise<{ listing: Record<string, unknown>; cid: string } | null> {
  try {
    const at = new AtUri(listingUri);
    const agent = getAgent();
    const res = await agent.com.atproto.repo.getRecord({
      repo: at.hostname,
      collection: at.collection,
      rkey: at.rkey,
      cid: listingCid,
    });
    const cid = res.data.cid;
    if (!cid) return null;
    return {
      listing: res.data.value as Record<string, unknown>,
      cid,
    };
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
    const stripe = getStripe();
    if (stripe && !buyerDidValid(body?.buyerDid ?? "")) {
      return c.json({ error: "buyerDid required (signed-in ATProto DID)" }, 400);
    }
    let listing: Record<string, unknown>;
    let listingCid: string;
    if (devCheckoutStubAllowed() && isDevStubListingUri(listingUri)) {
      listing = buildDevStubListingJson(itemUri);
      listingCid = DEV_STUB_LISTING_CID;
    } else {
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
      event = await stripe.webhooks.constructEventAsync(rawBody, sig, whSecret);
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
    const listingCidMeta = md.listingCid;
    const buyerDid = md.buyerDid ?? "";
    if (!listingUri || !itemUri || !listingCidMeta) {
      console.warn("checkout.session.completed missing metadata");
      return c.json({ received: true });
    }

    const piRef =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!piRef) {
      console.warn("checkout.session.completed: no payment_intent");
      return c.json({ received: true });
    }

    const idemRow = await db
      .select()
      .from(meta)
      .where(eq(meta.key, `purchase_pds:${piRef}`))
      .get();
    if (idemRow?.value) {
      try {
        const parsed = JSON.parse(idemRow.value) as { receiptUri?: string };
        if (parsed.receiptUri) {
          return c.json({ received: true });
        }
      } catch {
        /* continue */
      }
    }

    let pi: Stripe.PaymentIntent;
    try {
      pi = await stripe.paymentIntents.retrieve(piRef);
    } catch (e) {
      console.error("PaymentIntent retrieve failed:", e);
      return c.json({ received: true });
    }
    if (pi.status !== "succeeded") {
      console.warn("PaymentIntent not succeeded:", pi.id, pi.status);
      return c.json({ received: true });
    }

    const paymentRef = pi.id;
    const purchasedAt = new Date().toISOString();

    const snap =
      tryDevStubListingSnapshot(listingUri, listingCidMeta, itemUri) ??
      (await getListingAtCid(listingUri, listingCidMeta));
    if (!snap) {
      console.warn("Listing snapshot CID mismatch or missing:", listingUri);
      return c.json({ received: true });
    }
    const { listing, cid: resolvedListingCid } = snap;
    const listStatus = listing.status as string | undefined;
    if (listStatus && listStatus !== "active") {
      console.warn("Listing not active at webhook:", listingUri);
      return c.json({ received: true });
    }
    if (!listingHasV5License(listing)) {
      console.warn("Listing missing license fields:", listingUri);
      return c.json({ received: true });
    }
    const listPrice = listing.price as { amount?: number; currency?: string };
    if (
      listPrice?.amount == null ||
      !listPrice.currency ||
      pi.amount_received == null ||
      !pi.currency
    ) {
      console.warn("Missing price data for verification");
      return c.json({ received: true });
    }
    if (
      pi.amount_received !== listPrice.amount ||
      pi.currency.toLowerCase() !== listPrice.currency.toLowerCase()
    ) {
      console.warn("Payment amount/currency does not match listing:", {
        pi: pi.amount_received,
        listing: listPrice.amount,
      });
      return c.json({ received: true });
    }

    const itemRefRaw = listing.item as Record<string, unknown> | undefined;
    const itemRefUri = itemRefRaw?.uri as string | undefined;
    const itemRefType = itemRefRaw?.itemType as string | undefined;
    if (!itemRefRaw || !itemRefUri || !itemRefType) {
      console.warn("Listing item ref invalid");
      return c.json({ received: true });
    }
    if (itemRefUri !== itemUri) {
      console.warn("itemUri metadata does not match listing.item.uri");
      return c.json({ received: true });
    }

    const licenseGrantUri = listing.licenseUri as string;
    const licenseGrantCid = listing.licenseGrantCid as string;

    let item = await getRecordJson(itemUri);
    if (
      !item &&
      devCheckoutStubAllowed() &&
      isDevStubListingUri(listingUri)
    ) {
      item = buildDevStubItemJson(itemUri);
    }
    const issuerScope =
      (item?.artistDid as string | undefined) ??
      process.env.ARTIST_DID ??
      "";

    const appDid = process.env.APP_DID ?? "";
    const privateKeyRaw = process.env.APP_SERVICE_PRIVATE_KEY;

    const ref = itemRefRaw;
    const receiptItem: Record<string, unknown> = {
      uri: itemRefUri,
      itemType: itemRefType,
    };
    const itemCid = ref.cid as string | undefined;
    if (typeof itemCid === "string" && itemCid.length > 0) {
      receiptItem.cid = itemCid;
    }
    const variantSku = ref.variantSku as string | undefined;
    if (typeof variantSku === "string" && variantSku.length > 0) {
      receiptItem.variantSku = variantSku;
    }

    let appSigReceipt = "";
    if (
      privateKeyRaw &&
      !privateKeyRaw.includes("PLACEHOLDER") &&
      buyerDidValid(buyerDid)
    ) {
      try {
        appSigReceipt = signReceiptPayload({
          purchasedAt,
          paymentRef,
          itemUri,
          listingCid: resolvedListingCid,
          buyerDid,
          privateKeyPem: privateKeyRaw,
        });
      } catch (e) {
        console.warn("Receipt signing failed:", e);
      }
    }

    const receiptRecord: Record<string, unknown> = {
      $type: COL_RECEIPT,
      item: receiptItem,
      listingUri,
      listingCid: resolvedListingCid,
      pricePaid: {
        amount: pi.amount_received,
        currency: pi.currency.toUpperCase(),
      },
      paymentProcessor: "stripe",
      paymentRef,
      licenseGrantUri,
      licenseGrantCid,
      buyerDid,
      appDid,
      issuerScope,
      appSig: appSigReceipt,
      purchasedAt,
    };

    const receiptPayload = {
      receiptUri: null as string | null,
      consentUri: null as string | null,
      itemUri,
      listingUri,
      listingCid: resolvedListingCid,
      paymentRef,
      purchasedAt,
      appSig: appSigReceipt,
      issuerScope,
      amountTotal: session.amount_total,
      currency: session.currency,
      pdsError: null as string | null,
    };

    if (!buyerDidValid(buyerDid)) {
      receiptPayload.pdsError = "buyerDid missing or invalid in metadata";
      console.info(receiptPayload.pdsError);
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
      return c.json({ received: true });
    }

    if (!appDid) {
      receiptPayload.pdsError = "APP_DID not configured";
      await persistReceiptMeta(db, paymentRef, receiptPayload);
      return c.json({ received: true });
    }

    if (!appSigReceipt) {
      receiptPayload.pdsError =
        "APP_SERVICE_PRIVATE_KEY missing or receipt signing failed";
      await persistReceiptMeta(db, paymentRef, receiptPayload);
      return c.json({ received: true });
    }

    let buyerSession: Awaited<ReturnType<OAuthClient["restore"]>>;
    try {
      buyerSession = await oauthClient.restore(buyerDid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      receiptPayload.pdsError = `oauth restore failed: ${msg}`;
      console.warn(receiptPayload.pdsError);
      await persistReceiptMeta(db, paymentRef, receiptPayload);
      return c.json({ received: true });
    }

    const writeAgent = new Agent(buyerSession);
    let receiptUri = "";
    let receiptCidStr = "";
    try {
      const created = await writeAgent.com.atproto.repo.createRecord({
        repo: buyerDid,
        collection: COL_RECEIPT,
        record: receiptRecord,
      });
      receiptUri = created.data.uri;
      const rcid = created.data.cid;
      receiptCidStr = typeof rcid === "string" ? rcid : String(rcid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      receiptPayload.pdsError = `receipt createRecord failed: ${msg}`;
      console.error(receiptPayload.pdsError);
      await persistReceiptMeta(db, paymentRef, receiptPayload);
      return c.json({ received: true });
    }

    receiptPayload.receiptUri = receiptUri;

    let consentSig = "";
    if (privateKeyRaw && !privateKeyRaw.includes("PLACEHOLDER")) {
      try {
        consentSig = signConsentPayload({
          buyerDid,
          licenseGrantCid,
          receiptCid: receiptCidStr,
          consentedAt: purchasedAt,
          privateKeyPem: privateKeyRaw,
        });
      } catch (e) {
        console.warn("Consent signing failed:", e);
      }
    }

    const consentRecord: Record<string, unknown> = {
      $type: COL_CONSENT,
      receiptUri,
      receiptCid: receiptCidStr,
      licenseGrantUri,
      licenseGrantCid,
      buyerDid,
      consentedAt: purchasedAt,
      appSig: consentSig,
    };

    let consentUri = "";
    try {
      if (!consentSig) throw new Error("consent appSig empty");
      const createdConsent = await writeAgent.com.atproto.repo.createRecord({
        repo: buyerDid,
        collection: COL_CONSENT,
        record: consentRecord,
      });
      consentUri = createdConsent.data.uri;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      receiptPayload.pdsError = `consent createRecord failed: ${msg}`;
      console.error(receiptPayload.pdsError);
      await persistReceiptMeta(db, paymentRef, receiptPayload);
      return c.json({ received: true });
    }

    receiptPayload.consentUri = consentUri;
    receiptPayload.pdsError = null;

    await db
      .insert(meta)
      .values({
        key: `purchase_pds:${paymentRef}`,
        value: JSON.stringify({
          receiptUri,
          receiptCid: receiptCidStr,
          consentUri,
        }),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: meta.key,
        set: {
          value: JSON.stringify({
            receiptUri,
            receiptCid: receiptCidStr,
            consentUri,
          }),
          updatedAt: new Date(),
        },
      });

    await persistReceiptMeta(db, paymentRef, receiptPayload);
    return c.json({ received: true });
  });

  return r;
}

async function persistReceiptMeta(
  db: Db,
  paymentRef: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db
    .insert(meta)
    .values({
      key: `receipt:${paymentRef}`,
      value: JSON.stringify(payload),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: meta.key,
      set: {
        value: JSON.stringify(payload),
        updatedAt: new Date(),
      },
    });
}
