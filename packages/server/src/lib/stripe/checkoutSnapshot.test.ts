import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDb, type Db } from "../../db";
import { paymentFulfillment } from "../../db/schema";
import { entitlementDigest } from "../atproto/entitlement";
import { verifyReceiptPayload } from "../atproto/sign";

/**
 * End-to-end over POST /stripe/checkout -> fulfillCheckoutSession with a fake
 * merchant PDS that, like a real one, serves only the current version of each
 * record. Covers the merchant changing the listing between checkout and
 * payment (ADR 0024).
 */

const MERCHANT = "did:plc:merchant0000";
const BUYER = "did:plc:buyer00000000";
const COL = "diamonds.whereditgo.bazaar";
const LISTING_URI = `at://${MERCHANT}/${COL}.catalog.listing/l1`;
const PARENT_URI = `at://${MERCHANT}/${COL}.catalog.listing/parent`;
const ITEM_URI = `at://${MERCHANT}/${COL}.catalog.item/i1`;
const LICENSE = {
  uri: `at://${MERCHANT}/${COL}.license.grant/g1`,
  cid: "bafyreilicense",
};
const RECEIPT_CID = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";

// ---- fake merchant PDS: current version only ----

type Stored = { value: Record<string, unknown>; cid: string };
const pds = new Map<string, Stored>();
let cidSeq = 0;
function putRecord(uri: string, value: Record<string, unknown>): string {
  const cid = `bafyrei${String(++cidSeq).padStart(4, "0")}`;
  pds.set(uri, { value, cid });
  return cid;
}

const merchantAgent = {
  com: {
    atproto: {
      repo: {
        getRecord: async (p: {
          repo: string;
          collection: string;
          rkey: string;
          cid?: string;
        }) => {
          const uri = `at://${p.repo}/${p.collection}/${p.rkey}`;
          const rec = pds.get(uri);
          if (!rec || (p.cid && p.cid !== rec.cid)) {
            throw new Error(`Could not locate record: ${uri}`);
          }
          return { data: { uri, cid: rec.cid, value: rec.value } };
        },
      },
    },
  },
};

mock.module("../atproto/resolvePds", () => ({
  getAgentForDid: async () => merchantAgent,
}));

// ---- fake buyer PDS behind the OAuth session (Agent speaks XRPC to it) ----

let receipts: { uri: string; cid: string; value: Record<string, unknown> }[] = [];
const buyerSession = {
  did: BUYER,
  fetchHandler: async (url: string, init?: RequestInit) => {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (url.includes("com.atproto.repo.listRecords")) {
      return json({ records: receipts });
    }
    if (url.includes("com.atproto.repo.createRecord")) {
      const body = (await new Response(init?.body).json()) as {
        record: Record<string, unknown>;
      };
      const rec = {
        uri: `at://${BUYER}/${COL}.purchase.receipt/r${receipts.length + 1}`,
        cid: RECEIPT_CID,
        value: body.record,
      };
      receipts.push(rec);
      return json({ uri: rec.uri, cid: rec.cid });
    }
    return new Response("not found", { status: 404 });
  },
};
const oauthClient = { restore: async () => buyerSession } as never;

// ---- fake Stripe ----

let lastSessionMetadata: Record<string, string> = {};
let amountReceived = 0;
const stripe = {
  checkout: {
    sessions: {
      create: async (p: { metadata: Record<string, string> }) => {
        lastSessionMetadata = p.metadata;
        return { id: "cs_test_1", url: "https://checkout.stripe.test/cs_test_1" };
      },
    },
  },
  paymentIntents: {
    retrieve: async (id: string) => ({
      id,
      status: "succeeded",
      amount_received: amountReceived,
      currency: "usd",
    }),
  },
};

mock.module("./getStripe", () => ({ getStripe: async () => stripe }));

const { createStripeRouter } = await import("../../routes/stripe");
const { fulfillCheckoutSession } = await import("./fulfillCheckoutSession");

// ---- fixtures ----

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
process.env.STOREFRONT_DID = "did:web:storefront.test";
process.env.STOREFRONT_PRIVATE_KEY = privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;

let db: Db;
let itemCid: string;
let listingCid: string;

function listingValue(over: Record<string, unknown> = {}) {
  return {
    $type: `${COL}.catalog.listing`,
    item: { uri: ITEM_URI, cid: itemCid },
    price: { amount: 1500, currency: "USD" },
    licenseGrant: LICENSE,
    status: "active",
    ...over,
  };
}

beforeEach(() => {
  pds.clear();
  receipts = [];
  lastSessionMetadata = {};
  amountReceived = 1500;
  db = createDb(":memory:");
  migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
  itemCid = putRecord(ITEM_URI, { $type: `${COL}.catalog.item`, title: "Song" });
  putRecord(PARENT_URI, listingValue({ status: "active" }));
  listingCid = putRecord(LISTING_URI, listingValue({ parentListing: PARENT_URI }));
});

async function startCheckout() {
  const app = createStripeRouter(db, oauthClient);
  const res = await app.request("/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      listingUri: LISTING_URI,
      itemUri: ITEM_URI,
      buyerDid: BUYER,
    }),
  });
  expect(res.status).toBe(200);
  expect(lastSessionMetadata.checkoutSnapshotId).toBeTruthy();
}

async function pay(metadata = lastSessionMetadata) {
  await fulfillCheckoutSession({
    db,
    stripe: stripe as never,
    oauthClient,
    session: {
      id: "cs_test_1",
      metadata,
      payment_intent: "pi_test_1",
      amount_total: amountReceived,
      currency: "usd",
    } as never,
    source: "webhook",
  });
  return db
    .select()
    .from(paymentFulfillment)
    .where(eq(paymentFulfillment.paymentIntentId, "pi_test_1"))
    .get();
}

/** The receipt names the checkout-time listing CID and its signature verifies over it. */
function expectReceiptForCheckedOutListing(pinnedItemCid = itemCid) {
  expect(receipts).toHaveLength(1);
  const r = receipts[0].value as {
    listing: { uri: string; cid: string };
    purchasedGood: { uri: string; cid?: string };
    pricePaid: { amount: number; currency: string };
    grantedItems: { uri: string; cid?: string }[];
    storefrontSig: string;
    purchasedAt: string;
    payment: { ref: string };
  };
  expect(r.listing).toEqual({ uri: LISTING_URI, cid: listingCid });
  expect(r.purchasedGood).toEqual({ uri: ITEM_URI, cid: pinnedItemCid });
  expect(r.pricePaid).toEqual({ amount: 1500, currency: "USD" });
  expect(
    verifyReceiptPayload({
      purchasedAt: r.purchasedAt,
      paymentRef: r.payment.ref,
      itemUri: ITEM_URI,
      listingCid,
      buyerDid: BUYER,
      licenseGrantCid: LICENSE.cid,
      entitlementDigest: entitlementDigest(r.grantedItems),
      storefrontSig: r.storefrontSig,
      publicKeyPem,
    }),
  ).toBe(true);
}

describe("checkout snapshot fulfillment", () => {
  test("unchanged listing produces a receipt", async () => {
    await startCheckout();
    const row = await pay();
    expect(row?.status).toBe("completed");
    expectReceiptForCheckedOutListing();
  });

  test("listing edited mid-checkout (price change) still produces a receipt at the checked-out CID", async () => {
    await startCheckout();
    putRecord(
      LISTING_URI,
      listingValue({ parentListing: PARENT_URI, price: { amount: 2500, currency: "USD" } }),
    );
    const row = await pay();
    expect(row?.status).toBe("completed");
    expect(row?.lastError).toBeNull();
    expectReceiptForCheckedOutListing();
  });

  test("item edit + listing re-pin mid-checkout still produces a receipt for the checked-out item", async () => {
    await startCheckout();
    const checkedOutItemCid = itemCid;
    itemCid = putRecord(ITEM_URI, { $type: `${COL}.catalog.item`, title: "Song (remaster)" });
    putRecord(LISTING_URI, listingValue({ parentListing: PARENT_URI }));
    const row = await pay();
    expect(row?.status).toBe("completed");
    expectReceiptForCheckedOutListing(checkedOutItemCid);
  });

  test("listing paused mid-checkout still produces a receipt", async () => {
    await startCheckout();
    putRecord(LISTING_URI, listingValue({ parentListing: PARENT_URI, status: "paused" }));
    const row = await pay();
    expect(row?.status).toBe("completed");
    expectReceiptForCheckedOutListing();
  });

  test("parent listing paused mid-checkout still produces a receipt", async () => {
    await startCheckout();
    putRecord(PARENT_URI, listingValue({ status: "paused" }));
    const row = await pay();
    expect(row?.status).toBe("completed");
    expectReceiptForCheckedOutListing();
  });

  test("checkout still refuses a paused listing up front", async () => {
    putRecord(LISTING_URI, listingValue({ parentListing: PARENT_URI, status: "paused" }));
    const app = createStripeRouter(db, oauthClient);
    const res = await app.request("/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ listingUri: LISTING_URI, itemUri: ITEM_URI, buyerDid: BUYER }),
    });
    expect(res.status).toBe(400);
  });

  test("payment that doesn't match the snapshot price is dead-lettered", async () => {
    await startCheckout();
    amountReceived = 999;
    const row = await pay();
    expect(row?.status).toBe("dead_letter");
    expect(row?.lastError).toBe("amount_currency_mismatch");
    expect(receipts).toHaveLength(0);
  });

  test("snapshot that disagrees with session metadata is dead-lettered", async () => {
    await startCheckout();
    const row = await pay({ ...lastSessionMetadata, listingCid: "bafyreiforged" });
    expect(row?.status).toBe("dead_letter");
    expect(row?.lastError).toBe("checkout_snapshot_mismatch");
    expect(receipts).toHaveLength(0);
  });

  test("pre-snapshot session falls back to the at-CID fetch", async () => {
    await startCheckout();
    const { checkoutSnapshotId: _, ...legacy } = lastSessionMetadata;
    const row = await pay(legacy);
    expect(row?.status).toBe("completed");
    expectReceiptForCheckedOutListing();
  });
});
