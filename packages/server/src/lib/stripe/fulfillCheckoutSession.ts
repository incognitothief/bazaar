import {
  buildDevStubItemJson,
  devCheckoutStubAllowed,
  isDevStubListingUri,
  tryDevStubListingSnapshot,
} from "@bazaar/shared";
import { Agent } from "@atproto/api";
import { and, eq, isNull, like, lt, lte, ne, or } from "drizzle-orm";
import type Stripe from "stripe";
import { AtUri } from "@atproto/syntax";
import type { Db } from "../../db";
import { meta, paymentFulfillment } from "../../db/schema";
import type { OAuthClient } from "../atproto/oauth";
import { getAgentForDid } from "../atproto/resolvePds";
import {
  storefrontKidFromEnv,
  signConsentPayload,
  signReceiptPayload,
} from "../atproto/sign";
import {
  entitlementDigest,
  resolveGrantedItems,
} from "../atproto/entitlement";
import { getStripe } from "./getStripe";

const COL_RECEIPT = "diamonds.whereditgo.bazaar.purchase.receipt";
const COL_CONSENT = "diamonds.whereditgo.bazaar.purchase.consent";

const PROCESSING_STALE_MS = 120_000;
const MAX_FULFILLMENT_ATTEMPTS = 30;
const LAST_ERROR_CAP = 2000;
const SWEEP_BATCH = 8;

export type FulfillmentSource = "webhook" | "sweeper" | "client";

function buyerDidValid(did: string): boolean {
  return did.startsWith("did:") && did.length > 8;
}

/** The DID hosting `uri`'s repo -- catalog.item/catalog.product carry no sellerDid field, the AT-URI's own hostname already is the seller. */
function repoDidFromItemUri(uri: string): string | undefined {
  try {
    return new AtUri(uri).hostname || undefined;
  } catch {
    return undefined;
  }
}

function backoffMs(attempt: number): number {
  return Math.min(60_000 * 2 ** Math.min(Math.max(attempt, 0), 16), 3_600_000);
}

function isRetryableFulfillmentError(e: unknown): boolean {
  const s = e instanceof Error ? e.message : String(e);
  if (/duplicate|already exists|invalid.*did|invalid.*uri/i.test(s)) return false;
  if (/consent appsig empty/i.test(s)) return false;
  return true;
}

function trimError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.length > LAST_ERROR_CAP ? `${raw.slice(0, LAST_ERROR_CAP)}…` : raw;
}

/**
 * Idempotent fulfillment: client /fulfill-session and the Stripe webhook can run concurrently;
 * both may pass the DB claim while status is receipt_written with consentUri still null.
 */
async function findBuyerReceiptByPaymentRef(
  agent: Agent,
  buyerDid: string,
  paymentRef: string,
): Promise<{ uri: string; cid: string } | null> {
  let cursor: string | undefined;
  for (;;) {
    const res = await agent.com.atproto.repo.listRecords({
      repo: buyerDid,
      collection: COL_RECEIPT,
      limit: 100,
      cursor,
    });
    for (const row of res.data.records) {
      const v = row.value as { paymentRef?: string };
      if (v?.paymentRef === paymentRef && row.uri) {
        return { uri: row.uri, cid: row.cid };
      }
    }
    const cur = res.data.cursor as string | undefined;
    if (!cur) break;
    cursor = cur;
  }
  return null;
}

async function findBuyerConsentByReceiptUri(
  agent: Agent,
  buyerDid: string,
  receiptUri: string,
): Promise<{ uri: string } | null> {
  let cursor: string | undefined;
  for (;;) {
    const res = await agent.com.atproto.repo.listRecords({
      repo: buyerDid,
      collection: COL_CONSENT,
      limit: 100,
      cursor,
    });
    for (const row of res.data.records) {
      const v = row.value as { receiptUri?: string };
      if (v?.receiptUri === receiptUri && row.uri) {
        return { uri: row.uri };
      }
    }
    const cur = res.data.cursor as string | undefined;
    if (!cur) break;
    cursor = cur;
  }
  return null;
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

async function getListingAtCid(
  listingUri: string,
  listingCid: string,
): Promise<{ listing: Record<string, unknown>; cid: string } | null> {
  try {
    const at = new AtUri(listingUri);
    const agent = await getAgentForDid(at.hostname);
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

/** Child singles require an active parent collection listing when parentListing is set. */
export async function parentListingAllowsSale(
  parentListingUri: string,
): Promise<boolean> {
  if (isDevStubListingUri(parentListingUri)) return true;
  try {
    const at = new AtUri(parentListingUri);
    if (!at.rkey) return false;
    const agent = await getAgentForDid(at.hostname);
    const res = await agent.com.atproto.repo.getRecord({
      repo: at.hostname,
      collection: at.collection,
      rkey: at.rkey,
    });
    const parent = res.data.value as Record<string, unknown>;
    const st = parent.status as string | undefined;
    return st === "active";
  } catch {
    return false;
  }
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
    })
    .run();
}

type ClaimResult =
  | { action: "skip"; reason: string }
  | { action: "run"; paymentIntentId: string };

function claimFulfillmentWork(
  db: Db,
  paymentIntentId: string,
  checkoutSessionId: string,
  source: FulfillmentSource,
  buyerDidFromCheckout: string | null,
  itemUri: string,
  listingUri: string,
): ClaimResult {
  const now = new Date();
  const nowMs = now.getTime();

  return db.transaction(
    (tx) => {
      const existing = tx
        .select()
        .from(paymentFulfillment)
        .where(eq(paymentFulfillment.paymentIntentId, paymentIntentId))
        .get();

      if (!existing) {
        tx
          .insert(paymentFulfillment)
          .values({
            paymentIntentId,
            checkoutSessionId,
            buyerDid: buyerDidFromCheckout,
            itemUri,
            listingUri,
            status: "processing",
            attemptCount: 1,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        return { action: "run", paymentIntentId };
      }

      if (
        (!existing.buyerDid && buyerDidFromCheckout) ||
        !existing.itemUri ||
        !existing.listingUri
      ) {
        tx.update(paymentFulfillment)
          .set({
            buyerDid: existing.buyerDid ?? buyerDidFromCheckout,
            itemUri: existing.itemUri ?? itemUri,
            listingUri: existing.listingUri ?? listingUri,
            updatedAt: now,
          })
          .where(eq(paymentFulfillment.paymentIntentId, paymentIntentId))
          .run();
      }

      if (existing.status === "completed") {
        return { action: "skip", reason: "completed" };
      }

      if (existing.status === "dead_letter") {
        return { action: "skip", reason: "dead_letter" };
      }

      if (existing.consentUri) {
        return { action: "skip", reason: "completed" };
      }

      if (existing.status === "processing") {
        const age = nowMs - existing.updatedAt.getTime();
        if (age < PROCESSING_STALE_MS) {
          return { action: "skip", reason: "locked" };
        }
        const nextAttempt = existing.attemptCount + 1;
        if (nextAttempt >= MAX_FULFILLMENT_ATTEMPTS) {
          tx.update(paymentFulfillment)
            .set({
              status: "dead_letter",
              lastError: "max_attempts",
              updatedAt: now,
            })
            .where(eq(paymentFulfillment.paymentIntentId, paymentIntentId))
            .run();
          return { action: "skip", reason: "max_attempts" };
        }
        tx.update(paymentFulfillment)
          .set({
            attemptCount: nextAttempt,
            updatedAt: now,
          })
          .where(eq(paymentFulfillment.paymentIntentId, paymentIntentId))
          .run();
        return { action: "run", paymentIntentId };
      }

      if (existing.status === "receipt_written") {
        const nextAttempt = existing.attemptCount + 1;
        if (nextAttempt >= MAX_FULFILLMENT_ATTEMPTS) {
          tx.update(paymentFulfillment)
            .set({
              status: "dead_letter",
              lastError: "max_attempts",
              updatedAt: now,
            })
            .where(eq(paymentFulfillment.paymentIntentId, paymentIntentId))
            .run();
          return { action: "skip", reason: "max_attempts" };
        }
        tx.update(paymentFulfillment)
          .set({
            status: "processing",
            attemptCount: nextAttempt,
            updatedAt: now,
          })
          .where(eq(paymentFulfillment.paymentIntentId, paymentIntentId))
          .run();
        return { action: "run", paymentIntentId };
      }

      if (existing.status === "failed") {
        if (
          source === "sweeper" &&
          existing.nextRetryAt != null &&
          existing.nextRetryAt > nowMs
        ) {
          return { action: "skip", reason: "backoff" };
        }
        const nextAttempt = existing.attemptCount + 1;
        if (nextAttempt >= MAX_FULFILLMENT_ATTEMPTS) {
          tx.update(paymentFulfillment)
            .set({
              status: "dead_letter",
              lastError: existing.lastError ?? "max_attempts",
              updatedAt: now,
            })
            .where(eq(paymentFulfillment.paymentIntentId, paymentIntentId))
            .run();
          return { action: "skip", reason: "max_attempts" };
        }
        tx.update(paymentFulfillment)
          .set({
            status: "processing",
            attemptCount: nextAttempt,
            nextRetryAt: null,
            updatedAt: now,
          })
          .where(eq(paymentFulfillment.paymentIntentId, paymentIntentId))
          .run();
        return { action: "run", paymentIntentId };
      }

      return { action: "skip", reason: `status:${existing.status}` };
    },
    { behavior: "immediate" },
  );
}

async function markDeadLetter(
  db: Db,
  paymentIntentId: string,
  err: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(paymentFulfillment)
    .set({
      status: "dead_letter",
      lastError: err.slice(0, LAST_ERROR_CAP),
      updatedAt: now,
    })
    .where(eq(paymentFulfillment.paymentIntentId, paymentIntentId))
    .run();
}

async function markFailedRetryable(
  db: Db,
  paymentIntentId: string,
  attemptCount: number,
  err: string,
): Promise<void> {
  const now = new Date();
  const nowMs = now.getTime();
  await db
    .update(paymentFulfillment)
    .set({
      status: "failed",
      lastError: err.slice(0, LAST_ERROR_CAP),
      nextRetryAt: nowMs + backoffMs(attemptCount),
      updatedAt: now,
    })
    .where(eq(paymentFulfillment.paymentIntentId, paymentIntentId))
    .run();
}

async function readFulfillmentRow(
  db: Db,
  paymentIntentId: string,
): Promise<typeof paymentFulfillment.$inferSelect | undefined> {
  return db
    .select()
    .from(paymentFulfillment)
    .where(eq(paymentFulfillment.paymentIntentId, paymentIntentId))
    .get();
}

/**
 * Checkout.session.completed → verify PI + listing, write receipt then consent to buyer PDS.
 * Idempotent per PaymentIntent via payment_fulfillment + row claim.
 *
 * @returns When the row claim short-circuits, the skip reason (e.g. `locked`, `completed`);
 *   otherwise `undefined` after the handler runs (success, dead-letter, or early validation exit).
 */
export async function fulfillCheckoutSession(opts: {
  db: Db;
  stripe: Stripe;
  oauthClient: OAuthClient;
  session: Stripe.Checkout.Session;
  source: FulfillmentSource;
}): Promise<string | undefined> {
  const { db, stripe, oauthClient, session, source } = opts;
  const md = session.metadata ?? {};
  const listingUri = md.listingUri;
  const itemUri = md.itemUri;
  const listingCidMeta = md.listingCid;
  const buyerDid = md.buyerDid ?? "";

  if (!listingUri || !itemUri || !listingCidMeta) {
    console.warn("checkout.session.completed missing metadata");
    return;
  }

  const piRef =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!piRef) {
    console.warn("checkout.session.completed: no payment_intent");
    return;
  }

  const buyerDidHint = buyerDid.trim() || null;
  const claim = claimFulfillmentWork(
    db,
    piRef,
    session.id,
    source,
    buyerDidHint,
    itemUri,
    listingUri,
  );
  if (claim.action === "skip") {
    return claim.reason;
  }

  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.retrieve(piRef);
  } catch (e) {
    console.error("PaymentIntent retrieve failed:", e);
    const row = await readFulfillmentRow(db, piRef);
    const ac = row?.attemptCount ?? 1;
    if (isRetryableFulfillmentError(e)) {
      await markFailedRetryable(db, piRef, ac, trimError(e));
    } else {
      await markDeadLetter(db, piRef, trimError(e));
    }
    return;
  }

  if (pi.status !== "succeeded") {
    console.warn("PaymentIntent not succeeded:", pi.id, pi.status);
    await markDeadLetter(db, piRef, `pi_not_succeeded:${pi.status}`);
    return;
  }

  const paymentRef = pi.id;
  const purchasedAt = new Date().toISOString();

  const snap =
    tryDevStubListingSnapshot(listingUri, listingCidMeta, itemUri) ??
    (await getListingAtCid(listingUri, listingCidMeta));
  if (!snap) {
    console.warn("Listing snapshot CID mismatch or missing:", listingUri);
    await markDeadLetter(db, paymentRef, "listing_snapshot_mismatch");
    return;
  }

  const { listing, cid: resolvedListingCid } = snap;
  const listStatus = listing.status as string | undefined;
  if (listStatus && listStatus !== "active") {
    console.warn("Listing not active at webhook:", listingUri);
    await markDeadLetter(db, paymentRef, "listing_not_active");
    return;
  }
  const parentListingUri = listing.parentListing as string | undefined;
  if (typeof parentListingUri === "string" && parentListingUri.length > 0) {
    const parentOk = await parentListingAllowsSale(parentListingUri);
    if (!parentOk) {
      console.warn("Parent listing not active:", parentListingUri);
      await markDeadLetter(db, paymentRef, "listing_parent_not_active");
      return;
    }
  }
  if (!listingHasV5License(listing)) {
    console.warn("Listing missing license fields:", listingUri);
    await markDeadLetter(db, paymentRef, "listing_missing_license");
    return;
  }

  const listPrice = listing.price as { amount?: number; currency?: string };
  if (
    listPrice?.amount == null ||
    !listPrice.currency ||
    pi.amount_received == null ||
    !pi.currency
  ) {
    console.warn("Missing price data for verification");
    await markDeadLetter(db, paymentRef, "missing_price_data");
    return;
  }
  if (
    pi.amount_received !== listPrice.amount ||
    pi.currency.toLowerCase() !== listPrice.currency.toLowerCase()
  ) {
    console.warn("Payment amount/currency does not match listing");
    await markDeadLetter(db, paymentRef, "amount_currency_mismatch");
    return;
  }

  const itemRefRaw = listing.item as Record<string, unknown> | undefined;
  const itemRefUri = itemRefRaw?.uri as string | undefined;
  if (!itemRefRaw || !itemRefUri) {
    console.warn("Listing item ref invalid");
    await markDeadLetter(db, paymentRef, "listing_item_ref_invalid");
    return;
  }
  if (itemRefUri !== itemUri) {
    console.warn("itemUri metadata does not match listing.item.uri");
    await markDeadLetter(db, paymentRef, "item_uri_mismatch");
    return;
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
  const merchantDid = repoDidFromItemUri(itemUri) ?? process.env.MERCHANT_DID ?? "";

  const ref = itemRefRaw;
  const purchasedGood: Record<string, unknown> = { uri: itemRefUri };
  const itemCid = ref.cid as string | undefined;
  if (typeof itemCid === "string" && itemCid.length > 0) {
    purchasedGood.cid = itemCid;
  }
  const variantSku = ref.variantSku as string | undefined;
  if (typeof variantSku === "string" && variantSku.length > 0) {
    purchasedGood.variantSku = variantSku;
  }

  // Frozen download entitlement -- captured now, folded into appSig, and
  // written onto the receipt so later product edits can't move it.
  const grantedItems = resolveGrantedItems(itemUri, item, itemCid);
  const grantedDigest = grantedItems
    ? entitlementDigest(grantedItems)
    : undefined;

  const storefrontDid = process.env.STOREFRONT_DID ?? "";
  const privateKeyRaw = process.env.STOREFRONT_PRIVATE_KEY;

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
        entitlementDigest: grantedDigest,
        privateKeyPem: privateKeyRaw,
      });
    } catch (e) {
      console.warn("Receipt signing failed:", e);
    }
  }

  const receiptKidEnv = storefrontKidFromEnv();
  const receiptKid =
    appSigReceipt && receiptKidEnv ? receiptKidEnv : undefined;

  const receiptRecord: Record<string, unknown> = {
    $type: COL_RECEIPT,
    purchasedGood,
    listing: { uri: listingUri, cid: resolvedListingCid },
    pricePaid: {
      amount: pi.amount_received,
      currency: pi.currency.toUpperCase(),
    },
    paymentProcessor: "stripe",
    paymentRef,
    licenseGrant: { uri: licenseGrantUri, cid: licenseGrantCid },
    ...(grantedItems ? { grantedItems } : {}),
    storefrontDid,
    merchantDid,
    appSig: appSigReceipt,
    purchasedAt,
    ...(receiptKid ? { kid: receiptKid } : {}),
  };

  const receiptPayload: Record<string, unknown> = {
    receiptUri: null,
    consentUri: null,
    itemUri,
    listingUri,
    listingCid: resolvedListingCid,
    paymentRef,
    purchasedAt,
    appSig: appSigReceipt,
    merchantDid,
    amountTotal: session.amount_total,
    currency: session.currency,
    pdsError: null,
  };

  const rowNow = await readFulfillmentRow(db, paymentRef);
  let receiptUri = rowNow?.receiptUri ?? "";
  let receiptCidStr = rowNow?.receiptCid ?? "";

  if (!buyerDidValid(buyerDid)) {
    receiptPayload.pdsError = "buyerDid missing or invalid in metadata";
    console.info(receiptPayload.pdsError);
    await persistReceiptMeta(db, paymentRef, receiptPayload);
    await markDeadLetter(db, paymentRef, receiptPayload.pdsError as string);
    return;
  }

  if (!storefrontDid) {
    receiptPayload.pdsError = "STOREFRONT_DID not configured";
    await persistReceiptMeta(db, paymentRef, receiptPayload);
    await markDeadLetter(db, paymentRef, receiptPayload.pdsError as string);
    return;
  }

  if (!appSigReceipt) {
    receiptPayload.pdsError =
      "STOREFRONT_PRIVATE_KEY missing or receipt signing failed";
    await persistReceiptMeta(db, paymentRef, receiptPayload);
    await markDeadLetter(db, paymentRef, receiptPayload.pdsError as string);
    return;
  }

  let buyerSession: Awaited<ReturnType<OAuthClient["restore"]>>;
  try {
    buyerSession = await oauthClient.restore(buyerDid);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    receiptPayload.pdsError = `oauth restore failed: ${msg}`;
    console.warn(receiptPayload.pdsError);
    await persistReceiptMeta(db, paymentRef, receiptPayload);
    const ac = rowNow?.attemptCount ?? 1;
    if (isRetryableFulfillmentError(e)) {
      await markFailedRetryable(db, paymentRef, ac, trimError(e));
    } else {
      await markDeadLetter(db, paymentRef, trimError(e));
    }
    return;
  }

  const writeAgent = new Agent(buyerSession);

  if (!receiptUri) {
    const preExisting = await findBuyerReceiptByPaymentRef(
      writeAgent,
      buyerDid,
      paymentRef,
    );
    if (preExisting) {
      receiptUri = preExisting.uri;
      receiptCidStr = preExisting.cid;
    } else {
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
        const recovered = await findBuyerReceiptByPaymentRef(
          writeAgent,
          buyerDid,
          paymentRef,
        );
        if (recovered) {
          receiptUri = recovered.uri;
          receiptCidStr = recovered.cid;
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          receiptPayload.pdsError = `receipt createRecord failed: ${msg}`;
          console.error(receiptPayload.pdsError);
          await persistReceiptMeta(db, paymentRef, receiptPayload);
          const ac = (await readFulfillmentRow(db, paymentRef))?.attemptCount ?? 1;
          if (isRetryableFulfillmentError(e)) {
            await markFailedRetryable(db, paymentRef, ac, trimError(e));
          } else {
            await markDeadLetter(db, paymentRef, trimError(e));
          }
          return;
        }
      }
    }

    const nowReceipt = new Date();
    db.update(paymentFulfillment)
      .set({
        receiptUri,
        receiptCid: receiptCidStr,
        status: "receipt_written",
        updatedAt: nowReceipt,
      })
      .where(eq(paymentFulfillment.paymentIntentId, paymentRef))
      .run();
  }

  receiptPayload.receiptUri = receiptUri;

  const rowMid = await readFulfillmentRow(db, paymentRef);
  let consentUri = rowMid?.consentUri?.trim() ?? "";

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

  const consentKidEnv = storefrontKidFromEnv();
  const consentKid = consentSig && consentKidEnv ? consentKidEnv : undefined;

  const consentRecord: Record<string, unknown> = {
    $type: COL_CONSENT,
    receiptUri,
    receiptCid: receiptCidStr,
    licenseGrant: { uri: licenseGrantUri, cid: licenseGrantCid },
    consentedAt: purchasedAt,
    appSig: consentSig,
    ...(consentKid ? { kid: consentKid } : {}),
  };

  if (!consentUri) {
    const preConsent = await findBuyerConsentByReceiptUri(
      writeAgent,
      buyerDid,
      receiptUri,
    );
    if (preConsent) {
      consentUri = preConsent.uri;
    } else {
      try {
        if (!consentSig) throw new Error("consent appSig empty");
        const createdConsent = await writeAgent.com.atproto.repo.createRecord({
          repo: buyerDid,
          collection: COL_CONSENT,
          record: consentRecord,
        });
        consentUri = createdConsent.data.uri;
      } catch (e) {
        const recovered = await findBuyerConsentByReceiptUri(
          writeAgent,
          buyerDid,
          receiptUri,
        );
        if (recovered) {
          consentUri = recovered.uri;
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          receiptPayload.pdsError = `consent createRecord failed: ${msg}`;
          console.error(receiptPayload.pdsError);
          await persistReceiptMeta(db, paymentRef, receiptPayload);
          const ac = (await readFulfillmentRow(db, paymentRef))?.attemptCount ?? 1;
          if (isRetryableFulfillmentError(e)) {
            await markFailedRetryable(db, paymentRef, ac, trimError(e));
          } else {
            await markDeadLetter(db, paymentRef, trimError(e));
          }
          return;
        }
      }
    }
  }

  receiptPayload.consentUri = consentUri;
  receiptPayload.pdsError = null;

  const now = new Date();
  db.update(paymentFulfillment)
    .set({
      consentUri,
      status: "completed",
      lastError: null,
      nextRetryAt: null,
      updatedAt: now,
    })
    .where(eq(paymentFulfillment.paymentIntentId, paymentRef))
    .run();

  db.insert(meta)
    .values({
      key: `purchase_pds:${paymentRef}`,
      value: JSON.stringify({
        receiptUri,
        receiptCid: receiptCidStr,
        consentUri,
      }),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: meta.key,
      set: {
        value: JSON.stringify({
          receiptUri,
          receiptCid: receiptCidStr,
          consentUri,
        }),
        updatedAt: now,
      },
    })
    .run();

  await persistReceiptMeta(db, paymentRef, receiptPayload);
}

/** Periodic retry of failed / partial fulfillments (requires Stripe + checkout_session_id on row). */
export async function sweepPaymentFulfillment(
  db: Db,
  oauthClient: OAuthClient,
): Promise<void> {
  const stripe = await getStripe(db);
  if (!stripe) return;

  const now = new Date();
  const nowMs = now.getTime();
  const staleBefore = new Date(nowMs - PROCESSING_STALE_MS);

  const candidates = db
    .select()
    .from(paymentFulfillment)
    .where(
      and(
        isNull(paymentFulfillment.consentUri),
        ne(paymentFulfillment.status, "dead_letter"),
        lt(paymentFulfillment.attemptCount, MAX_FULFILLMENT_ATTEMPTS),
        or(
          eq(paymentFulfillment.status, "receipt_written"),
          and(
            eq(paymentFulfillment.status, "failed"),
            or(
              isNull(paymentFulfillment.nextRetryAt),
              lte(paymentFulfillment.nextRetryAt, nowMs),
            ),
          ),
          and(
            eq(paymentFulfillment.status, "processing"),
            lte(paymentFulfillment.updatedAt, staleBefore),
          ),
        ),
      ),
    )
    .limit(SWEEP_BATCH)
    .all();

  for (const row of candidates) {
    if (!row.checkoutSessionId) continue;
    try {
      const session = await stripe.checkout.sessions.retrieve(row.checkoutSessionId);
      await fulfillCheckoutSession({
        db,
        stripe,
        oauthClient,
        session,
        source: "sweeper",
      });
    } catch (e) {
      console.warn("sweepPaymentFulfillment row failed:", row.paymentIntentId, e);
    }
  }
}

/** Copy legacy meta `purchase_pds:pi_*` rows into payment_fulfillment as completed. */
export async function backfillPaymentFulfillmentFromMeta(db: Db): Promise<void> {
  const rows = db
    .select()
    .from(meta)
    .where(like(meta.key, "purchase_pds:%"))
    .all();
  const now = new Date();
  for (const r of rows) {
    const pi = r.key.slice("purchase_pds:".length);
    if (!pi.startsWith("pi_")) continue;
    let parsed: { receiptUri?: string; consentUri?: string; receiptCid?: string };
    try {
      parsed = JSON.parse(r.value) as typeof parsed;
    } catch {
      continue;
    }
    if (!parsed.receiptUri) continue;
    await db
      .insert(paymentFulfillment)
      .values({
        paymentIntentId: pi,
        checkoutSessionId: null,
        status: "completed",
        attemptCount: 1,
        receiptUri: parsed.receiptUri,
        receiptCid: parsed.receiptCid ?? null,
        consentUri: parsed.consentUri ?? null,
        nextRetryAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }
}
