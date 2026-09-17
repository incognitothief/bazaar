import { randomUUID } from "node:crypto";
import { getCookie } from "hono/cookie";
import { AtUri } from "@atproto/syntax";
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db";
import {
  catalogItems,
  catalogProductAssets,
  catalogProducts,
  inventoryUploadObject,
  inventoryUploadSession,
  licenses,
  merchantBusinessProfile,
  merchantStripeConfig,
  paymentFulfillment,
} from "../db/schema";
import type { OAuthClient } from "../lib/atproto/oauth";
import { getAgentForDid } from "../lib/atproto/resolvePds";
import { getSessionAgent } from "../lib/atproto/session";
import {
  buildDeletionManifest,
  executeDeletion,
} from "../lib/deleteCatalogEntry";
import { r2ConfigFromEnv } from "../lib/r2/env";
import { isS3NoSuchKey } from "../lib/r2/diagnostics";
import { getR2S3Client } from "../lib/r2/s3Client";
import { resolveCoverImages } from "../lib/productAssets";
import { buildProductZip, rebuildProductZipCache, rebuildProductZipCacheByUri, presignCachedProductPackage } from "../lib/productZip";
import { getZipProgress, listZipProgress } from "../lib/zipProgress";
import { captureCatalogItem, captureCatalogProduct } from "./atproto";
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
  checkStorefrontKeySync,
  expectedStorefrontKeyRecords,
  readStorefrontKeySyncStatus,
} from "../lib/storefrontKeys";
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
  const owner = process.env.MERCHANT_DID?.trim();
  if (!owner?.startsWith("did:")) {
    return c.json(
      { error: "server_misconfigured", detail: "MERCHANT_DID not set" },
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

export function createMerchantRouter(db: Db, oauthClient: OAuthClient) {
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

  /** Store-owner: full captured license history (ERP source for list views — active and retired). */
  r.get("/licenses", (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const owner = process.env.MERCHANT_DID!.trim();
    const rows = db
      .select()
      .from(licenses)
      .where(eq(licenses.merchantDid, owner))
      .orderBy(desc(licenses.capturedAt))
      .all();
    return c.json({ licenses: rows });
  });

  /**
   * Storefront key mirror status: does the merchant PDS's `actor.storefrontKeys` collection
   * match the current storefront key history? `expected` is the exact record set the client
   * should `putRecord` (rkey = kid). Computed on boot; this returns the stored result, or
   * recomputes if none is stored yet.
   */
  r.get("/key-sync-status", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const status =
      (await readStorefrontKeySyncStatus(db)) ?? (await checkStorefrontKeySync(db));
    return c.json({ ...status, expected: expectedStorefrontKeyRecords() });
  });

  /** Re-run the mirror diff (call after the client finishes a sync). */
  r.post("/key-sync-status/recheck", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const status = await checkStorefrontKeySync(db);
    return c.json({ ...status, expected: expectedStorefrontKeyRecords() });
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

    /** ERP-first title lookup -- covers every catalog.item/catalog.product sale with no PDS round trip. Rows from before this pipeline recorded itemUri fall back to null and the client shows the raw URI. */
    const itemUris = Array.from(
      new Set(rows.map((r) => r.itemUri).filter((u): u is string => !!u)),
    );
    const titleByUri = new Map<string, string>();
    if (itemUris.length > 0) {
      for (const row of db
        .select({ uri: catalogItems.uri, title: catalogItems.title })
        .from(catalogItems)
        .where(inArray(catalogItems.uri, itemUris))
        .all()) {
        titleByUri.set(row.uri, row.title);
      }
      for (const row of db
        .select({ uri: catalogProducts.uri, title: catalogProducts.title })
        .from(catalogProducts)
        .where(inArray(catalogProducts.uri, itemUris))
        .all()) {
        titleByUri.set(row.uri, row.title);
      }
    }

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
        itemUri: row.itemUri,
        listingUri: row.listingUri,
        itemTitle: row.itemUri ? (titleByUri.get(row.itemUri) ?? null) : null,
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
      if (body.stripeSecretKey != null && body.stripeSecretKey !== "") {
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
      if (body.stripeWebhookSecret != null && body.stripeWebhookSecret !== "") {
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
      if (body.stripeSecretKey == null || body.stripeSecretKey === "") {
        nextSk = null;
      } else {
        nextSk = body.stripeSecretKey.trim();
      }
    }
    if (hasWh) {
      if (body.stripeWebhookSecret == null || body.stripeWebhookSecret === "") {
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

  /**
   * Store-owner: ERP-first catalog.item list (the primary read path for
   * merchant item views). An item has no cover art of its own -- it lives
   * on the parent catalog.product (catalogProductAssets) -- so this resolves
   * each item's owning product by scanning products' items[] for a matching
   * the product's item refs, then reuses its already-resolved cover images.
   */
  r.get("/catalog/items", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const owner = process.env.MERCHANT_DID!.trim();
    const rows = db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.merchantDid, owner))
      .orderBy(desc(catalogItems.capturedAt))
      .all();

    const productRows = db
      .select()
      .from(catalogProducts)
      .where(eq(catalogProducts.merchantDid, owner))
      .all();
    const productUriByItemUri = new Map<string, string>();
    for (const p of productRows) {
      const refs = JSON.parse(p.items) as Array<{ uri: string }>;
      for (const ref of refs) productUriByItemUri.set(ref.uri, p.uri);
    }
    const coverImagesByProductUri = new Map<
      string,
      Awaited<ReturnType<typeof resolveCoverImages>>
    >();
    const items = await Promise.all(
      rows.map(async (row) => {
        const productUri = productUriByItemUri.get(row.uri);
        let coverImages: Awaited<ReturnType<typeof resolveCoverImages>> = [];
        if (productUri) {
          let resolved = coverImagesByProductUri.get(productUri);
          if (!resolved) {
            resolved = await resolveCoverImages(db, productUri);
            coverImagesByProductUri.set(productUri, resolved);
          }
          coverImages = resolved;
        }
        const tags = row.tags ? (JSON.parse(row.tags) as string[]) : null;
        return { ...row, tags, coverImages };
      }),
    );
    return c.json({ items });
  });

  /** Store-owner: ERP-first catalog.product list. */
  r.get("/catalog/products", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const owner = process.env.MERCHANT_DID!.trim();
    const rows = db
      .select()
      .from(catalogProducts)
      .where(eq(catalogProducts.merchantDid, owner))
      .orderBy(desc(catalogProducts.capturedAt))
      .all();
    const products = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        items: JSON.parse(row.items) as unknown,
        tags: row.tags ? (JSON.parse(row.tags) as string[]) : null,
        coverImages: await resolveCoverImages(db, row.uri),
      })),
    );
    return c.json({ products });
  });

  /**
   * Store-owner: manual "Sync with PDS" for one catalog.item -- live
   * getRecord + upsert into catalog_items. The event-triggered half of
   * "PDS as keep-me-honest" (the other half is the checkout-time CID
   * check); no background reconciliation job.
   */
  r.post("/catalog/items/sync", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const owner = process.env.MERCHANT_DID!.trim();
    const body = (await c.req.json().catch(() => null)) as { uri?: string } | null;
    const uri = body?.uri;
    if (!uri) return c.json({ error: "uri required" }, 400);
    let at: AtUri;
    try {
      at = new AtUri(uri);
    } catch {
      return c.json({ error: "invalid_uri" }, 400);
    }
    if (at.hostname !== owner) {
      return c.json({ error: "forbidden", detail: "uri does not belong to this deployment's MERCHANT_DID" }, 403);
    }
    try {
      const agent = await getAgentForDid(owner);
      const res = await agent.com.atproto.repo.getRecord({
        repo: at.hostname,
        collection: at.collection,
        rkey: at.rkey,
      });
      await captureCatalogItem(db, owner, res.data.value, res.data.uri, res.data.cid!);
    } catch {
      return c.json({ error: "sync_failed" }, 502);
    }
    const row = db.select().from(catalogItems).where(eq(catalogItems.uri, uri)).get();
    return c.json({
      item: row
        ? { ...row, tags: row.tags ? (JSON.parse(row.tags) as string[]) : null }
        : null,
    });
  });

  /** Store-owner: manual "Sync with PDS" for one catalog.product. Same shape as the item sync above. */
  r.post("/catalog/products/sync", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const owner = process.env.MERCHANT_DID!.trim();
    const body = (await c.req.json().catch(() => null)) as { uri?: string } | null;
    const uri = body?.uri;
    if (!uri) return c.json({ error: "uri required" }, 400);
    let at: AtUri;
    try {
      at = new AtUri(uri);
    } catch {
      return c.json({ error: "invalid_uri" }, 400);
    }
    if (at.hostname !== owner) {
      return c.json({ error: "forbidden", detail: "uri does not belong to this deployment's MERCHANT_DID" }, 403);
    }
    try {
      const agent = await getAgentForDid(owner);
      const res = await agent.com.atproto.repo.getRecord({
        repo: at.hostname,
        collection: at.collection,
        rkey: at.rkey,
      });
      await captureCatalogProduct(db, owner, res.data.value, res.data.uri, res.data.cid!);
      void rebuildProductZipCacheByUri(db, res.data.uri);
    } catch {
      return c.json({ error: "sync_failed" }, 502);
    }
    const row = db.select().from(catalogProducts).where(eq(catalogProducts.uri, uri)).get();
    return c.json({
      product: row
        ? {
            ...row,
            items: JSON.parse(row.items) as unknown,
            tags: row.tags ? (JSON.parse(row.tags) as string[]) : null,
          }
        : null,
    });
  });

  /**
   * Store-owner: update productType/artIncludedInDownload -- both are
   * UI-only ERP columns, never on the PDS record (see captureCatalogProduct),
   * so this is a plain DB update with no PDS interaction, no CID change, and
   * therefore no stale-listing concern.
   */
  r.post("/catalog/products/settings", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const owner = process.env.MERCHANT_DID!.trim();
    const body = (await c.req.json().catch(() => null)) as {
      uri?: string;
      productType?: string | null;
      artIncludedInDownload?: boolean;
    } | null;
    const uri = body?.uri;
    if (!uri) return c.json({ error: "uri required" }, 400);
    const existing = db
      .select()
      .from(catalogProducts)
      .where(eq(catalogProducts.uri, uri))
      .get();
    if (!existing || existing.merchantDid !== owner) {
      return c.json({ error: "not_found" }, 404);
    }
    const set: Partial<typeof catalogProducts.$inferInsert> = { updatedAt: new Date() };
    if ("productType" in (body ?? {})) set.productType = body?.productType ?? null;
    if ("artIncludedInDownload" in (body ?? {})) {
      set.artIncludedInDownload = Boolean(body?.artIncludedInDownload);
    }
    db.update(catalogProducts).set(set).where(eq(catalogProducts.uri, uri)).run();
    const row = db.select().from(catalogProducts).where(eq(catalogProducts.uri, uri)).get();
    // Only artIncludedInDownload affects zip contents -- a productType-only edit needn't rebuild.
    if (row && "artIncludedInDownload" in (body ?? {})) {
      void rebuildProductZipCache(db, row);
    }
    return c.json({
      product: row
        ? {
            ...row,
            items: JSON.parse(row.items) as unknown,
            tags: row.tags ? (JSON.parse(row.tags) as string[]) : null,
          }
        : null,
    });
  });

  /** Cover art + the generic included-assets bin for one product, for the merchant edit page -- includes each row's own id (unlike the public /api/catalog/products read) since managing an asset means being able to remove that exact row. */
  async function loadProductAssets(productUri: string) {
    const coverImages = await resolveCoverImages(db, productUri);
    const includedRows = db
      .select()
      .from(catalogProductAssets)
      .innerJoin(
        inventoryUploadObject,
        eq(catalogProductAssets.objectId, inventoryUploadObject.id),
      )
      .where(eq(catalogProductAssets.productUri, productUri))
      .all()
      .filter((r) => r.catalog_product_assets.role !== "coverArt");
    const includedAssets = includedRows.map((r) => ({
      id: r.catalog_product_assets.id,
      objectId: r.catalog_product_assets.objectId,
      role: r.catalog_product_assets.role,
      fileName: r.inventory_upload_object.fileName,
    }));
    return { coverImages, includedAssets };
  }

  /**
   * Store-owner: live "zipping item N of M" progress for an in-flight
   * package rebuild. `uri` may name a product that doesn't exist yet -- the
   * very first publish captures the PDS record before the zip step runs, so
   * early polls during that window are expected and just get {progress: null}.
   * Omit `uri` to list every in-flight job in this process plus products
   * whose last rebuild failed (for the merchant-shell activity banner).
   */
  r.get("/catalog/products/zip-progress", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const owner = process.env.MERCHANT_DID!.trim();
    const uri = c.req.query("uri");
    if (!uri) {
      const inflight = listZipProgress();
      const inflightUris = new Set(inflight.map((j) => j.productUri));
      const jobs = inflight.map((j) => {
        const product = db.select().from(catalogProducts).where(eq(catalogProducts.uri, j.productUri)).get();
        if (product && product.merchantDid !== owner) return null;
        return {
          uri: j.productUri,
          title: product?.title ?? j.productUri,
          current: j.current,
          total: j.total,
          fileName: j.fileName,
          bytesRead: j.bytesRead,
          bytesTotal: j.bytesTotal,
          startedAt: j.startedAt,
          updatedAt: j.updatedAt,
        };
      }).filter((j): j is NonNullable<typeof j> => j != null);
      const failedRows = db
        .select({ uri: catalogProducts.uri, title: catalogProducts.title })
        .from(catalogProducts)
        .where(and(eq(catalogProducts.merchantDid, owner), eq(catalogProducts.packageZipStatus, "failed")))
        .all()
        .filter((r) => !inflightUris.has(r.uri));
      return c.json({
        jobs,
        failed: failedRows.map((r) => ({ uri: r.uri, title: r.title })),
      });
    }
    const product = db.select().from(catalogProducts).where(eq(catalogProducts.uri, uri)).get();
    if (product && product.merchantDid !== owner) return c.json({ error: "not_found" }, 404);
    return c.json({ progress: getZipProgress(uri) });
  });

  /**
   * Store-owner: kick a package-zip rebuild without re-syncing the PDS
   * record. Fire-and-forget -- the merchant UI polls zip-progress and
   * packageZipStatus the same way a save does.
   */
  r.post("/catalog/products/rebuild-zip", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const owner = process.env.MERCHANT_DID!.trim();
    const body = (await c.req.json().catch(() => null)) as { uri?: string } | null;
    const uri = body?.uri;
    if (!uri) return c.json({ error: "uri required" }, 400);
    const product = db.select().from(catalogProducts).where(eq(catalogProducts.uri, uri)).get();
    if (!product || product.merchantDid !== owner) return c.json({ error: "not_found" }, 404);
    void rebuildProductZipCacheByUri(db, uri);
    return c.json({ ok: true });
  });

  /** Store-owner: cover art + included assets for one product (see loadProductAssets). */
  r.get("/catalog/products/assets", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const owner = process.env.MERCHANT_DID!.trim();
    const uri = c.req.query("uri");
    if (!uri) return c.json({ error: "uri required" }, 400);
    const product = db.select().from(catalogProducts).where(eq(catalogProducts.uri, uri)).get();
    if (!product || product.merchantDid !== owner) return c.json({ error: "not_found" }, 404);
    return c.json(await loadProductAssets(uri));
  });

  /**
   * Store-owner: attach an already-uploaded object to a product as either
   * cover art (role "coverArt") or an included asset (role is the
   * merchant's freeform label, same convention as publish-product's
   * includedAssets). The object must already exist and belong to this
   * merchant -- this endpoint only links it, uploading happens through the
   * ordinary inventory session endpoints first.
   */
  r.post("/catalog/products/assets", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const owner = process.env.MERCHANT_DID!.trim();
    const body = (await c.req.json().catch(() => null)) as {
      productUri?: string;
      objectId?: string;
      role?: string;
    } | null;
    const productUri = body?.productUri;
    const objectId = body?.objectId;
    const role = body?.role?.trim();
    if (!productUri || !objectId || !role) {
      return c.json({ error: "productUri_objectId_role_required" }, 400);
    }
    const product = db.select().from(catalogProducts).where(eq(catalogProducts.uri, productUri)).get();
    if (!product || product.merchantDid !== owner) return c.json({ error: "not_found" }, 404);
    const obj = db
      .select({
        id: inventoryUploadObject.id,
        status: inventoryUploadObject.status,
        merchantDid: inventoryUploadSession.merchantDid,
      })
      .from(inventoryUploadObject)
      .innerJoin(
        inventoryUploadSession,
        eq(inventoryUploadObject.sessionId, inventoryUploadSession.id),
      )
      .where(eq(inventoryUploadObject.id, objectId))
      .get();
    if (!obj || obj.merchantDid !== owner || obj.status !== "completed") {
      return c.json({ error: "invalid_object" }, 400);
    }
    const existing = db
      .select()
      .from(catalogProductAssets)
      .where(eq(catalogProductAssets.productUri, productUri))
      .all();
    const position =
      role === "coverArt"
        ? existing.filter((r) => r.role === "coverArt").length
        : 0;
    db.insert(catalogProductAssets)
      .values({
        id: randomUUID(),
        productUri,
        objectId,
        role,
        position,
      })
      .run();
    void rebuildProductZipCache(db, product);
    return c.json(await loadProductAssets(productUri));
  });

  /**
   * Store-owner: detach one asset (cover art or included asset) from a
   * product. Also reclaims the underlying upload -- deletes the R2 bytes
   * (and any webp derivative) and the inventoryUploadObject row -- as long
   * as nothing else still references that object id (another
   * catalogProductAssets link, or a catalogItems row using it as its own
   * file). R2 cleanup is best-effort: the link is already gone from the
   * product regardless of whether the bytes actually get reclaimed, so a
   * failure here is logged, not surfaced as a request failure.
   */
  r.post("/catalog/products/assets/remove", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const owner = process.env.MERCHANT_DID!.trim();
    const body = (await c.req.json().catch(() => null)) as { id?: string } | null;
    const id = body?.id;
    if (!id) return c.json({ error: "id_required" }, 400);
    const row = db.select().from(catalogProductAssets).where(eq(catalogProductAssets.id, id)).get();
    if (!row) return c.json({ error: "not_found" }, 404);
    const product = db
      .select()
      .from(catalogProducts)
      .where(eq(catalogProducts.uri, row.productUri))
      .get();
    if (!product || product.merchantDid !== owner) return c.json({ error: "not_found" }, 404);

    db.delete(catalogProductAssets).where(eq(catalogProductAssets.id, id)).run();
    void rebuildProductZipCache(db, product);

    const stillLinked =
      db
        .select({ id: catalogProductAssets.id })
        .from(catalogProductAssets)
        .where(eq(catalogProductAssets.objectId, row.objectId))
        .get() != null ||
      db
        .select({ uri: catalogItems.uri })
        .from(catalogItems)
        .where(eq(catalogItems.objectId, row.objectId))
        .get() != null;

    if (!stillLinked) {
      const obj = db
        .select()
        .from(inventoryUploadObject)
        .where(eq(inventoryUploadObject.id, row.objectId))
        .get();
      if (obj) {
        const r2 = r2ConfigFromEnv();
        if (r2.ok) {
          const client = getR2S3Client(r2);
          try {
            await client.send(
              new DeleteObjectCommand({ Bucket: r2.bucket, Key: obj.r2Key }),
            );
            if (obj.webpR2Key) {
              await client.send(
                new DeleteObjectCommand({ Bucket: r2.bucket, Key: obj.webpR2Key }),
              );
            }
          } catch (e) {
            console.warn("assets/remove: R2 cleanup failed:", e);
          }
        }
        db.delete(inventoryUploadObject).where(eq(inventoryUploadObject.id, row.objectId)).run();
      }
    }

    return c.json(await loadProductAssets(row.productUri));
  });

  /**
   * Store-owner: presigned download for a single catalog.item's file. An
   * incident-response tool, not a buyer-facing route -- no purchase/
   * entitlement check, just "does this item belong to me." Resolves via
   * catalogItems.objectId -> inventoryUploadObject.r2Key, the only way to
   * find a new-scheme item's file (see newProductItemKey).
   */
  r.get("/catalog/items/download", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const owner = process.env.MERCHANT_DID!.trim();
    const uri = c.req.query("uri");
    if (!uri) return c.json({ error: "uri required" }, 400);
    const item = db.select().from(catalogItems).where(eq(catalogItems.uri, uri)).get();
    if (!item || item.merchantDid !== owner) return c.json({ error: "not_found" }, 404);
    if (!item.objectId) return c.json({ error: "no_file" }, 404);
    const obj = db
      .select()
      .from(inventoryUploadObject)
      .where(eq(inventoryUploadObject.id, item.objectId))
      .get();
    if (!obj || obj.status !== "completed") return c.json({ error: "object_not_found" }, 404);
    const r2 = r2ConfigFromEnv();
    if (!r2.ok) return c.json({ error: "r2_unconfigured", message: r2.reason }, 503);
    const client = getR2S3Client(r2);
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: r2.bucket, Key: obj.r2Key }),
      { expiresIn: 3600 },
    );
    return c.json({ url, fileName: obj.fileName });
  });

  /**
   * Store-owner: the same package a buyer would receive for this product.
   * When the cache is ready, 302 to a presigned R2 URL (same bytes, Bun
   * off the data path). Otherwise live-assemble and kick a rebuild so
   * the next click can presign. Ownership check only — not entitlement.
   */
  r.get("/catalog/products/download", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const owner = process.env.MERCHANT_DID!.trim();
    const uri = c.req.query("uri");
    if (!uri) return c.json({ error: "uri required" }, 400);
    const product = db.select().from(catalogProducts).where(eq(catalogProducts.uri, uri)).get();
    if (!product || product.merchantDid !== owner) return c.json({ error: "not_found" }, 404);

    const r2 = r2ConfigFromEnv();
    if (!r2.ok) return c.json({ error: "r2_unconfigured", message: r2.reason }, 503);

    const signed = await presignCachedProductPackage(db, r2, product, 3600);
    if (signed) return c.redirect(signed.url, 302);

    if (product.packageZipStatus !== "ready" || !product.packageZipKey) {
      void rebuildProductZipCacheByUri(db, product.uri);
    }

    const result = await buildProductZip(db, r2, product);
    if (result instanceof Response) return result;
    return c.json({ error: result.error }, result.status);
  });


  /**
   * Store-owner: enumerate exactly what deleting `uri` would destroy, without
   * destroying any of it. Backs the confirmation dialog -- the merchant sees
   * this list before the irreversible call, and the same manifest is rebuilt
   * server-side on the actual delete (never trusted from the client).
   */
  r.post("/catalog/entry/delete-manifest", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const owner = process.env.MERCHANT_DID!.trim();

    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "unauthorized" }, 401);

    const body = (await c.req.json().catch(() => null)) as { uri?: unknown } | null;
    const uri = typeof body?.uri === "string" ? body.uri.trim() : "";
    if (!uri) return c.json({ error: "invalid_body" }, 400);

    const manifest = await buildDeletionManifest(db, sess.agent, owner, uri);
    if ("error" in manifest) return c.json({ error: manifest.error }, manifest.status);
    return c.json(manifest);
  });

  /**
   * Store-owner: PERMANENTLY delete a catalog entry -- PDS record(s), R2
   * bytes, ERP rows. Irreversible, with no undo and no migration path.
   *
   * `confirm` must be the entry's exact title, mirroring what the UI asks the
   * merchant to type. That is a deliberate second gate on top of the session
   * check: a mistyped or replayed URI cannot delete the wrong thing.
   */
  r.post("/catalog/entry/delete", async (c) => {
    const denied = merchantGuard(c);
    if (denied) return denied;
    const owner = process.env.MERCHANT_DID!.trim();

    const sess = await getSessionAgent(c, oauthClient);
    if (!sess) return c.json({ error: "unauthorized" }, 401);

    const body = (await c.req.json().catch(() => null)) as {
      uri?: unknown;
      confirm?: unknown;
    } | null;
    const uri = typeof body?.uri === "string" ? body.uri.trim() : "";
    const confirm = typeof body?.confirm === "string" ? body.confirm.trim() : "";
    if (!uri) return c.json({ error: "invalid_body" }, 400);

    // Rebuilt, never accepted from the client -- the client's copy may be
    // stale (a listing added since it was fetched must still block).
    const manifest = await buildDeletionManifest(db, sess.agent, owner, uri);
    if ("error" in manifest) return c.json({ error: manifest.error }, manifest.status);

    if (confirm !== manifest.title) {
      return c.json({ error: "confirmation_mismatch", expected: manifest.title }, 400);
    }
    if (manifest.blockers.length > 0) {
      return c.json({ error: "blocked_by_listings", blockers: manifest.blockers }, 409);
    }

    const r2 = r2ConfigFromEnv();
    if (!r2.ok) return c.json({ error: "r2_unconfigured", message: r2.reason }, 503);

    const result = await executeDeletion(
      db,
      sess.agent,
      owner,
      manifest,
      getR2S3Client(r2),
      r2.bucket,
    );
    if ("error" in result) return c.json({ error: result.error }, result.status);

    console.warn(
      `catalog/entry/delete: ${owner} permanently deleted ${uri} ` +
        `(${result.deletedRecords.length} record(s), ${result.deletedObjects.length} object(s))`,
    );
    return c.json({ ok: true, ...result, manifest });
  });

  return r;
}
