import { AtUri } from "@atproto/syntax";
import {
  getLicenseTemplateDefinition,
  licenseRecordMatchesTemplate,
  stripLicenseTemplateType,
  type LicenseTemplateId,
} from "@bazaar/shared";
import { browserApiUrl } from "@/lib/browserApi";
import { agentForRepo } from "./pdsResolve";
import type { ATPRepoClient } from "./session";
import type {
  ActorMerchant,
  BazaarItem,
  CatalogItem,
  Collection,
  DigitalItem,
  ItemRef,
  LicenseTerms,
  Listing,
  PhysicalItem,
  Product,
  PurchaseReceipt,
} from "@/types/lexicons";
import { BAZAAR_COLLECTION } from "./ns";

export type { LicenseTemplateId } from "@bazaar/shared";

/** Stable key for comparing AT-URIs to the same repo record. */
export function catalogItemUriKey(uri: string): string {
  try {
    const a = new AtUri(uri);
    return `${a.hostname}/${a.collection}/${a.rkey}`;
  } catch {
    return uri;
  }
}

type ListRecordsResponse = {
  data: {
    records: Array<{ uri: string; cid: string; value: unknown }>;
    cursor?: string;
  };
};

const LIST_RECORDS_PAGE_SIZE = 100;

async function listAllRecordsForCollection(
  did: string,
  collection: string,
): Promise<Array<{ uri: string; cid: string; value: unknown }>> {
  const out: Array<{ uri: string; cid: string; value: unknown }> = [];
  const agent = await agentForRepo(did);
  let cursor: string | undefined;
  for (;;) {
    const res = (await agent.com.atproto.repo.listRecords({
      repo: did,
      collection,
      limit: LIST_RECORDS_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    })) as ListRecordsResponse;
    out.push(...res.data.records);
    cursor = res.data.cursor;
    if (!cursor) break;
  }
  return out;
}

type GetRecordResponse = {
  data: { cid: string; value: unknown };
};

/** Fields for `createLicenseTerms` derived from a shared template (excludes `$type`, `createdAt`). */
export function licenseTermsPayloadFromTemplateId(
  templateId: LicenseTemplateId,
): Omit<LicenseTerms, "$type" | "createdAt"> | null {
  const def = getLicenseTemplateDefinition(templateId);
  if (!def) return null;
  return stripLicenseTemplateType(def.record) as Omit<
    LicenseTerms,
    "$type" | "createdAt"
  >;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function createListing(
  agent: ATPRepoClient,
  record: Omit<Listing, "$type" | "createdAt">,
): Promise<{ uri: string; cid: string }> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const full: Listing = {
    $type: "diamonds.whereditgo.bazaar.catalog.listing",
    ...record,
    createdAt: nowIso(),
  };
  const res = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: BAZAAR_COLLECTION.listing,
    record: full as unknown as Record<string, unknown>,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

/** archived/superseded are permanent retirements -- a listing in either state never becomes sellable again, only a fresh listing (pointed at the same item) can replace it. */
export function isTerminalListingStatus(status: Listing["status"]): boolean {
  return status === "archived" || status === "superseded";
}

export async function deleteListing(
  agent: ATPRepoClient,
  uri: string,
): Promise<void> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const at = new AtUri(uri);
  await agent.com.atproto.repo.deleteRecord({
    repo: did,
    collection: BAZAAR_COLLECTION.listing,
    rkey: at.rkey,
  });
}

export async function createLicenseTerms(
  agent: ATPRepoClient,
  record: Omit<LicenseTerms, "$type" | "createdAt">,
): Promise<{ uri: string; cid: string }> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const full: LicenseTerms = {
    $type: "diamonds.whereditgo.bazaar.license.terms",
    ...record,
    createdAt: nowIso(),
  };
  const res = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: BAZAAR_COLLECTION.licenseTerms,
    record: full as unknown as Record<string, unknown>,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

export async function createReceipt(
  agent: ATPRepoClient,
  record: Omit<PurchaseReceipt, "$type">,
): Promise<{ uri: string; cid: string }> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const full: PurchaseReceipt = {
    $type: "diamonds.whereditgo.bazaar.purchase.receipt",
    ...record,
  };
  const res = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: BAZAAR_COLLECTION.receipt,
    record: full as unknown as Record<string, unknown>,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

function isDigitalItem(v: unknown): v is DigitalItem {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as DigitalItem).$type ===
      "diamonds.whereditgo.bazaar.catalog.item.digital"
  );
}

function isPhysicalItem(v: unknown): v is PhysicalItem {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as PhysicalItem).$type ===
      "diamonds.whereditgo.bazaar.catalog.item.physical"
  );
}

function isCollection(v: unknown): v is Collection {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Collection).$type === "diamonds.whereditgo.bazaar.catalog.collection"
  );
}

function isBazaarItem(v: unknown): v is BazaarItem {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as BazaarItem).$type === BAZAAR_COLLECTION.item
  );
}

function isProduct(v: unknown): v is Product {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Product).$type === BAZAAR_COLLECTION.product
  );
}

function isListing(v: unknown): v is Listing {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Listing).$type === "diamonds.whereditgo.bazaar.catalog.listing"
  );
}

function isLicenseTerms(v: unknown): v is LicenseTerms {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as LicenseTerms).$type === "diamonds.whereditgo.bazaar.license.terms"
  );
}

function isPurchaseReceipt(v: unknown): v is PurchaseReceipt {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as PurchaseReceipt).$type ===
      "diamonds.whereditgo.bazaar.purchase.receipt"
  );
}

export type PurchaseReceiptRow = {
  uri: string;
  cid: string;
  receipt: PurchaseReceipt;
};

/** One row per Stripe payment (or per record URI if paymentRef missing). */
function dedupePurchaseReceiptRows(
  rows: PurchaseReceiptRow[],
): PurchaseReceiptRow[] {
  const byKey = new Map<string, PurchaseReceiptRow>();
  for (const row of rows) {
    const pr = row.receipt.payment?.ref?.trim();
    const key = pr && pr.length > 0 ? pr : row.uri;
    const prev = byKey.get(key);
    if (
      !prev ||
      new Date(row.receipt.purchasedAt).getTime() >=
        new Date(prev.receipt.purchasedAt).getTime()
    ) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) =>
      new Date(b.receipt.purchasedAt).getTime() -
      new Date(a.receipt.purchasedAt).getTime(),
  );
}

export async function listPurchaseReceiptRows(
  did: string,
): Promise<PurchaseReceiptRow[]> {
  const agent = await agentForRepo(did);
  const res = (await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.receipt,
    limit: 100,
  })) as ListRecordsResponse;
  const rows = res.data.records
    .filter((r) => isPurchaseReceipt(r.value))
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      receipt: r.value as PurchaseReceipt,
    }));
  return dedupePurchaseReceiptRows(rows);
}

export type DigitalItemRow = { uri: string; cid: string; item: DigitalItem };
export type PhysicalItemRow = { uri: string; cid: string; item: PhysicalItem };
export type CollectionRow = { uri: string; cid: string; item: Collection };

export async function listDigitalItemRows(
  did: string,
): Promise<DigitalItemRow[]> {
  const agent = await agentForRepo(did);
  const res = (await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.digitalItem,
    limit: 100,
  })) as ListRecordsResponse;
  return res.data.records
    .filter((r) => isDigitalItem(r.value))
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      item: r.value as DigitalItem,
    }));
}

export async function listPhysicalItemRows(
  did: string,
): Promise<PhysicalItemRow[]> {
  const agent = await agentForRepo(did);
  const res = (await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.physicalItem,
    limit: 100,
  })) as ListRecordsResponse;
  return res.data.records
    .filter((r) => isPhysicalItem(r.value))
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      item: r.value as PhysicalItem,
    }));
}

export async function listCollectionRows(
  did: string,
): Promise<CollectionRow[]> {
  const agent = await agentForRepo(did);
  const res = (await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.collection,
    limit: 100,
  })) as ListRecordsResponse;
  return res.data.records
    .filter((r) => isCollection(r.value))
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      item: r.value as Collection,
    }));
}

export type BazaarItemRow = { uri: string; cid: string; item: BazaarItem };
export type ProductRow = { uri: string; cid: string; item: Product };

/**
 * PDS-direct (not the ERP-first /api/merchant/catalog/items list), same
 * pattern as listDigitalItemRows/listCollectionRows above -- public storefront
 * pages read straight from the repo, no merchant auth. Cover art (ERP-only,
 * never on the PDS record) isn't included here; callers needing it fetch it
 * separately per product via getCatalogProduct (see useCatalog.ts).
 */
export async function listBazaarItemRows(
  did: string,
): Promise<BazaarItemRow[]> {
  const agent = await agentForRepo(did);
  const res = (await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.item,
    limit: 100,
  })) as ListRecordsResponse;
  return res.data.records
    .filter((r) => isBazaarItem(r.value))
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      item: r.value as BazaarItem,
    }));
}

export async function listProductRows(did: string): Promise<ProductRow[]> {
  const agent = await agentForRepo(did);
  const res = (await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.product,
    limit: 100,
  })) as ListRecordsResponse;
  return res.data.records
    .filter((r) => isProduct(r.value))
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      item: r.value as Product,
    }));
}

export async function listListings(did: string): Promise<Listing[]> {
  const agent = await agentForRepo(did);
  const res = (await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.listing,
    limit: 100,
  })) as ListRecordsResponse;
  return res.data.records.map((r) => r.value).filter(isListing);
}

export type ListingRow = { uri: string; cid: string; listing: Listing };

export async function listListingRows(did: string): Promise<ListingRow[]> {
  const agent = await agentForRepo(did);
  const res = (await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.listing,
    limit: 100,
  })) as ListRecordsResponse;
  return res.data.records
    .filter((r) => isListing(r.value))
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      listing: r.value as Listing,
    }));
}

export async function putActorMerchant(
  agent: ATPRepoClient,
  record: ActorMerchant,
  rkey: string,
  swapCid?: string,
): Promise<void> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: BAZAAR_COLLECTION.actorMerchant,
    rkey,
    ...(swapCid ? { swapRecord: swapCid } : {}),
    record: record as unknown as Record<string, unknown>,
  });
}

export async function createActorMerchant(
  agent: ATPRepoClient,
  record: Omit<ActorMerchant, "$type" | "createdAt">,
): Promise<{ uri: string; cid: string }> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const full: ActorMerchant = {
    $type: "diamonds.whereditgo.bazaar.actor.merchant",
    ...record,
    createdAt: nowIso(),
  };
  const res = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: BAZAAR_COLLECTION.actorMerchant,
    record: full as unknown as Record<string, unknown>,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

export type LicenseTermsRow = {
  uri: string;
  cid: string;
  terms: LicenseTerms;
};

export async function listLicenseTermsRows(
  did: string,
): Promise<LicenseTermsRow[]> {
  const agent = await agentForRepo(did);
  const res = (await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.licenseTerms,
    limit: 100,
  })) as ListRecordsResponse;
  return res.data.records
    .filter((r) => isLicenseTerms(r.value))
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      terms: r.value as LicenseTerms,
    }));
}

export async function listLicenseTerms(did: string): Promise<LicenseTerms[]> {
  const rows = await listLicenseTermsRows(did);
  return rows.map((r) => r.terms);
}

export type LicenseListRow = {
  cid: string;
  uri: string;
  title: string;
  version: string;
  licenseText: string;
  checkoutConsentRequired: boolean;
  capturedAt: string;
  /** True when this CID no longer resolves live on the PDS (deleted or
   * otherwise changed) — the ERP-captured copy is what's being shown. */
  retired: boolean;
};

type MerchantLicensesResponse = {
  licenses: Array<{
    cid: string;
    uri: string;
    title: string;
    version: string;
    licenseText: string;
    checkoutConsentRequired: boolean;
    capturedAt: string;
  }>;
};

/**
 * Full license history for the signed-in merchant (active and retired),
 * sourced from the ERP (`GET /api/merchant/licenses`) and cross-referenced
 * against a single live PDS listRecords call to determine which are still
 * actually offered. This is the list-view counterpart to the inspector
 * page's per-record PDS-first lookup — here we already need N rows of
 * status, so one list call to annotate all of them is the efficient
 * version of the same idea, not a repeat of the per-lookup case.
 */
export async function listLicensesWithStatus(
  did: string,
): Promise<LicenseListRow[]> {
  const [captured, live] = await Promise.all([
    fetch(browserApiUrl("/api/merchant/licenses"), {
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) return [];
        const data = (await res.json()) as MerchantLicensesResponse;
        return data.licenses;
      })
      .catch(() => [] as MerchantLicensesResponse["licenses"]),
    listAllRecordsForCollection(did, BAZAAR_COLLECTION.licenseTerms).catch(
      () => [] as Array<{ uri: string; cid: string; value: unknown }>,
    ),
  ]);
  const liveCids = new Set(live.map((r) => r.cid));
  return captured.map((row) => ({
    ...row,
    retired: !liveCids.has(row.cid),
  }));
}

/** Increments the trailing numeric segment of a version string
 * ("1.0" -> "1.1", "4.0" -> "4.1"). Falls back to an appended suffix if
 * there's no trailing digit run to increment. Used by Revive to avoid
 * a merchant having to hand-pick a version when recreating a retired
 * license — not enforced anywhere, just a sane default. */
export function incrementLicenseVersion(version: string): string {
  const match = version.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) return `${version}-2`;
  const [, prefix, num, suffix] = match;
  return `${prefix}${Number(num) + 1}${suffix}`;
}

export type CatalogItemRow = {
  uri: string;
  cid: string;
  merchantDid: string;
  title: string;
  category: string | null;
  description: string | null;
  tags: string[] | null;
  format: string | null;
  fileChecksum: string | null;
  fileCid: string | null;
  supersedes: string | null;
  /** The owning product's cover images (an item has none of its own) -- see merchant.ts's GET /catalog/items. */
  coverImages: Array<{ objectId: string; url: string }>;
  /** Audio/video runtime from the upload object (ERP-only), null for other types or legacy uploads with no parsed duration. */
  durationMs: number | null;
  /** Authoritative file size in bytes from the upload object (ERP-only), null for legacy uploads. */
  byteSize: number | null;
  /** Raster image pixel dimensions from the upload object (ERP-only), null for non-image / vector / legacy uploads. */
  mediaWidth: number | null;
  mediaHeight: number | null;
  recordCreatedAt: string | null;
  capturedAt: string;
  updatedAt: string;
};

export type CatalogProductRow = {
  uri: string;
  cid: string;
  merchantDid: string;
  title: string;
  description: string | null;
  tags: string[] | null;
  items: Array<{ uri: string; cid?: string; variantSku?: string }>;
  /** UI-only classification (e.g. "music", "generic") -- never on the PDS record. */
  productType: string | null;
  /** Whether cover art is bundled into the buyer's download package -- also UI-only. */
  artIncludedInDownload: boolean;
  /** Presigned URLs, in slideshow order. Any number -- single-image types just have one. */
  coverImages: Array<{ objectId: string; url: string }>;
  /**
   * Aggregate download size in bytes, summed across member items' master files
   * and computed on read so it tracks the current item set (ERP-only). Null
   * when no member has a known byte size.
   */
  totalBytes: number | null;
  /** How many members are audio files -- the storefront card shows this for a music release. Computed on read. */
  trackCount: number;
  /**
   * ERP-only package-zip cache state. null = never built; "ready" = safe
   * to list / presign; "failed" = last rebuild errored. Already on the
   * product GET/list payloads via `...row`; the client just didn't read it.
   */
  packageZipStatus: "ready" | "failed" | null;
  /** Last successful rebuild time, when status is "ready". */
  packageZipUpdatedAt: string | null;
  recordCreatedAt: string | null;
  capturedAt: string;
  updatedAt: string;
};

/** ERP-first: the merchant's full catalog.item list, from GET /api/merchant/catalog/items. */
export async function listCatalogItemRows(): Promise<CatalogItemRow[]> {
  const res = await fetch(browserApiUrl("/api/merchant/catalog/items"), {
    credentials: "include",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { items: CatalogItemRow[] };
  return data.items;
}

/** ERP-first: the merchant's full catalog.product list, from GET /api/merchant/catalog/products. */
export async function listCatalogProductRows(): Promise<CatalogProductRow[]> {
  const res = await fetch(browserApiUrl("/api/merchant/catalog/products"), {
    credentials: "include",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { products: CatalogProductRow[] };
  return data.products;
}

/**
 * True when the merchant has at least one completed payment fulfillment for
 * `entityUri` (a product or item URI). Used to warn before leaving a newly
 * added product member unlisted -- past buyers' entitlement is frozen.
 */
export async function hasCompletedSale(entityUri: string): Promise<boolean> {
  try {
    const res = await fetch(
      browserApiUrl("/api/merchant/payment-fulfillments"),
      { credentials: "include" },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as {
      rows?: Array<{ itemUri: string | null; status: string }>;
    };
    return (data.rows ?? []).some(
      (r) => r.itemUri === entityUri && r.status === "completed",
    );
  } catch {
    return false;
  }
}

/** ERP-first, public: a single catalog.item by URI (no auth needed, same data storefront reads use). */
export async function getCatalogItem(
  uri: string,
): Promise<CatalogItemRow | null> {
  const res = await fetch(
    browserApiUrl(`/api/catalog/items?uri=${encodeURIComponent(uri)}`),
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { item: CatalogItemRow };
  return data.item;
}

/** ERP-first, public: a single catalog.product by URI. */
export async function getCatalogProduct(
  uri: string,
): Promise<CatalogProductRow | null> {
  const res = await fetch(
    browserApiUrl(`/api/catalog/products?uri=${encodeURIComponent(uri)}`),
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { product: CatalogProductRow };
  return data.product;
}

/** Manual "Sync with PDS": re-fetches live and refreshes the ERP row. */
export async function syncCatalogItem(
  uri: string,
): Promise<CatalogItemRow | null> {
  const res = await fetch(browserApiUrl("/api/merchant/catalog/items/sync"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uri }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { item: CatalogItemRow | null };
  return data.item;
}

/** Manual "Sync with PDS" for a product. */
export async function syncCatalogProduct(
  uri: string,
): Promise<CatalogProductRow | null> {
  const res = await fetch(
    browserApiUrl("/api/merchant/catalog/products/sync"),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uri }),
    },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { product: CatalogProductRow | null };
  return data.product;
}

/**
 * Updates productType/artIncludedInDownload -- both are ERP-only columns,
 * never on the PDS record, so this never touches the CID and can never
 * make a listing's pinned CID go stale.
 */
export async function updateCatalogProductSettings(
  uri: string,
  settings: { productType?: string | null; artIncludedInDownload?: boolean },
): Promise<CatalogProductRow | null> {
  const res = await fetch(
    browserApiUrl("/api/merchant/catalog/products/settings"),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uri, ...settings }),
    },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { product: CatalogProductRow | null };
  return data.product;
}

export type ZipProgress = {
  current: number;
  total: number;
  fileName: string;
  /** Raw source bytes read so far. */
  bytesRead?: number;
  /** Sum of known source byteSize; 0/absent if unknown. */
  bytesTotal?: number;
  /** Epoch ms when this rebuild first reported progress. */
  startedAt?: number;
  updatedAt: number;
};

export type ZipActivityJob = ZipProgress & {
  uri: string;
  title: string;
};

export type ZipActivityFailed = {
  uri: string;
  title: string;
};

export type ZipActivity = {
  jobs: ZipActivityJob[];
  failed: ZipActivityFailed[];
};

/** Kick a package-zip rebuild without re-syncing the PDS record. Returns immediately; poll getZipProgress / getCatalogProduct for status. */
export async function rebuildCatalogProductZip(uri: string): Promise<boolean> {
  const res = await fetch(
    browserApiUrl("/api/merchant/catalog/products/rebuild-zip"),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uri }),
    },
  );
  return res.ok;
}

/** Live "zipping item N of M" state for a product's in-flight package rebuild -- poll while a save/publish request is in flight. Null once nothing's in progress (or nothing has started yet). */
export async function getZipProgress(productUri: string): Promise<ZipProgress | null> {
  const res = await fetch(
    browserApiUrl(
      `/api/merchant/catalog/products/zip-progress?uri=${encodeURIComponent(productUri)}`,
    ),
    { credentials: "include" },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { progress: ZipProgress | null };
  return data.progress;
}

/** All in-flight package rebuilds in this process, plus products whose last rebuild failed. */
export async function listZipActivity(): Promise<ZipActivity> {
  const res = await fetch(
    browserApiUrl("/api/merchant/catalog/products/zip-progress"),
    { credentials: "include" },
  );
  if (!res.ok) return { jobs: [], failed: [] };
  const data = (await res.json()) as Partial<ZipActivity>;
  return {
    jobs: Array.isArray(data.jobs) ? data.jobs : [],
    failed: Array.isArray(data.failed) ? data.failed : [],
  };
}

export type CatalogProductAssets = {
  coverImages: Array<{ id: string; objectId: string; url: string }>;
  includedAssets: Array<{
    id: string;
    objectId: string;
    role: string;
    fileName: string;
  }>;
};

/** Store-owner: cover art + included assets for one product, each with its own asset-row id (for removal). */
export async function getCatalogProductAssets(
  productUri: string,
): Promise<CatalogProductAssets | null> {
  const res = await fetch(
    browserApiUrl(
      `/api/merchant/catalog/products/assets?uri=${encodeURIComponent(productUri)}`,
    ),
    { credentials: "include" },
  );
  if (!res.ok) return null;
  return (await res.json()) as CatalogProductAssets;
}

/** Links an already-uploaded object to a product as cover art (role "coverArt") or an included asset (role is the merchant's freeform label). */
export async function addCatalogProductAsset(params: {
  productUri: string;
  objectId: string;
  role: string;
}): Promise<CatalogProductAssets | null> {
  const res = await fetch(
    browserApiUrl("/api/merchant/catalog/products/assets"),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
  );
  if (!res.ok) return null;
  return (await res.json()) as CatalogProductAssets;
}

/** Detaches one cover-art or included-asset row from its product. */
export async function removeCatalogProductAsset(
  id: string,
): Promise<CatalogProductAssets | null> {
  const res = await fetch(
    browserApiUrl("/api/merchant/catalog/products/assets/remove"),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    },
  );
  if (!res.ok) return null;
  return (await res.json()) as CatalogProductAssets;
}

/**
 * Presigned URL for a single catalog.item's file -- an incident-response
 * tool for the merchant dashboard, not the buyer-facing download path.
 */
export async function getCatalogItemDownloadUrl(
  uri: string,
): Promise<{ url: string; fileName: string } | null> {
  const res = await fetch(
    browserApiUrl(
      `/api/merchant/catalog/items/download?uri=${encodeURIComponent(uri)}`,
    ),
    { credentials: "include" },
  );
  if (!res.ok) return null;
  return (await res.json()) as { url: string; fileName: string };
}

/** URL for the full product package zip (same content a buyer's download would have). */
export function catalogProductDownloadUrl(uri: string): string {
  return browserApiUrl(
    `/api/merchant/catalog/products/download?uri=${encodeURIComponent(uri)}`,
  );
}

/**
 * Presigned URL for a single legacy catalog.item.digital's master file --
 * an incident-response tool for the merchant dashboard, not the
 * buyer-facing download path.
 */
export async function getLegacyDigitalDownloadUrl(
  uri: string,
): Promise<{ url: string; fileName: string } | null> {
  const res = await fetch(
    browserApiUrl(
      `/api/merchant/catalog/legacy/item-download?uri=${encodeURIComponent(uri)}`,
    ),
    { credentials: "include" },
  );
  if (!res.ok) return null;
  return (await res.json()) as { url: string; fileName: string };
}

/** URL for a legacy catalog.collection's full zip (same content a buyer's download would have). */
export function legacyCollectionDownloadUrl(uri: string): string {
  return browserApiUrl(
    `/api/merchant/catalog/legacy/collection-download?uri=${encodeURIComponent(uri)}`,
  );
}

/**
 * Listings currently pinned to itemUri's CID -- i.e. the ones a save is
 * about to invalidate. A record's post-edit CID isn't knowable ahead of
 * the actual putRecord (it's content-addressed), so the check works off
 * the *current* CID instead: any listing accurately pinned to it right now
 * is exactly the set that will go stale the moment this save succeeds
 * (the checkout-time pin check in stripe.ts /checkout would otherwise
 * reject them cold for a buyer with no warning). Terminal statuses are
 * excluded since they're already not purchasable for unrelated reasons.
 */
export function findStaleListingsForItem(
  listingRows: ListingRow[],
  itemUri: string,
  currentCid: string,
): ListingRow[] {
  return listingRows.filter((row) => {
    const status = row.listing.status;
    if (
      status === "archived" ||
      status === "soldOut" ||
      status === "superseded"
    ) {
      return false;
    }
    return (
      row.listing.item.uri === itemUri && row.listing.item.cid === currentCid
    );
  });
}

/**
 * Resolve storefront catalog item AT-URI from record key (TID) in the artist repo.
 * Tries digital → collection → physical (same order as storefront catalog).
 */
export async function resolveCatalogItemUriFromRkey(
  repoDid: string,
  rkey: string,
): Promise<string | null> {
  if (!repoDid.startsWith("did:") || !rkey) return null;
  const collections = [
    BAZAAR_COLLECTION.digitalItem,
    BAZAAR_COLLECTION.collection,
    BAZAAR_COLLECTION.physicalItem,
    BAZAAR_COLLECTION.item,
    BAZAAR_COLLECTION.product,
  ] as const;
  const agent = await agentForRepo(repoDid);
  for (const collection of collections) {
    try {
      await agent.com.atproto.repo.getRecord({
        repo: repoDid,
        collection,
        rkey,
      });
      return `at://${repoDid}/${collection}/${rkey}`;
    } catch {
      continue;
    }
  }
  return null;
}

export async function getRecordValue<T>(uri: string): Promise<T | null> {
  try {
    const at = new AtUri(uri);
    const repo = at.hostname;
    const collection = at.collection;
    const rkey = at.rkey;
    if (!collection || !rkey) return null;
    const agent = await agentForRepo(repo);
    const res = (await agent.com.atproto.repo.getRecord({
      repo,
      collection,
      rkey,
    })) as GetRecordResponse;
    return res.data.value as T;
  } catch {
    return null;
  }
}

/** Same as `getRecordValue`, but also returns the record's CID. */
export async function getRecordValueWithCid<T>(
  uri: string,
): Promise<{ value: T; cid: string } | null> {
  try {
    const at = new AtUri(uri);
    const repo = at.hostname;
    const collection = at.collection;
    const rkey = at.rkey;
    if (!collection || !rkey) return null;
    const agent = await agentForRepo(repo);
    const res = (await agent.com.atproto.repo.getRecord({
      repo,
      collection,
      rkey,
    })) as GetRecordResponse;
    return { value: res.data.value as T, cid: res.data.cid };
  } catch {
    return null;
  }
}

/** Resolve `item` + `cid` (for listing-time CID pinning) for a catalog AT-URI. */
export async function buildItemRefFromUri(
  itemUri: string,
): Promise<ItemRef | null> {
  try {
    const at = new AtUri(itemUri);
    if (!at.collection || !at.rkey) return null;
    const agent = await agentForRepo(at.hostname);
    const res = (await agent.com.atproto.repo.getRecord({
      repo: at.hostname,
      collection: at.collection,
      rkey: at.rkey,
    })) as GetRecordResponse;
    const v = res.data.value as CatalogItem;
    if (!v || typeof v !== "object" || !("$type" in v)) return null;
    return { uri: itemUri, cid: res.data.cid };
  } catch {
    return null;
  }
}

export async function putListing(
  agent: ATPRepoClient,
  uri: string,
  record: Listing,
): Promise<void> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const at = new AtUri(uri);
  if (at.hostname !== did) throw new Error("Listing repo mismatch");
  const readAgent = await agentForRepo(did);
  const cur = (await readAgent.com.atproto.repo.getRecord({
    repo: did,
    collection: BAZAAR_COLLECTION.listing,
    rkey: at.rkey,
  })) as GetRecordResponse;
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: BAZAAR_COLLECTION.listing,
    rkey: at.rkey,
    swapRecord: cur.data.cid,
    record: record as unknown as Record<string, unknown>,
  });
}

/** Updates a digital item; immutable fields are always taken from the current record. */
export async function putDigitalItem(
  agent: ATPRepoClient,
  uri: string,
  draft: DigitalItem,
): Promise<void> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const at = new AtUri(uri);
  if (!at.rkey || !at.collection) throw new Error("Invalid URI");
  if (at.hostname !== did) throw new Error("Record must be in your repo");
  if (at.collection !== BAZAAR_COLLECTION.digitalItem) {
    throw new Error("Not a digital item record");
  }
  const readAgent = await agentForRepo(did);
  const cur = (await readAgent.com.atproto.repo.getRecord({
    repo: did,
    collection: at.collection,
    rkey: at.rkey,
  })) as GetRecordResponse;
  const prev = cur.data.value as DigitalItem;
  if (prev.$type !== "diamonds.whereditgo.bazaar.catalog.item.digital") {
    throw new Error("Invalid record type");
  }
  const merged: DigitalItem = {
    ...draft,
    artistDid: prev.artistDid,
    itemClass: prev.itemClass,
    formats: prev.formats,
    fileChecksum: prev.fileChecksum,
    fileCid: prev.fileCid,
    fileFormat: prev.fileFormat,
    durationMs: prev.durationMs,
    supersedes: prev.supersedes,
    createdAt: prev.createdAt,
    bazaarRid: prev.bazaarRid,
  };
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: at.collection,
    rkey: at.rkey,
    swapRecord: cur.data.cid,
    record: merged as unknown as Record<string, unknown>,
  });
}

/** Updates a collection; immutable fields are always taken from the current record. */
export async function putCollection(
  agent: ATPRepoClient,
  uri: string,
  draft: Collection,
): Promise<void> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const at = new AtUri(uri);
  if (!at.rkey || !at.collection) throw new Error("Invalid URI");
  if (at.hostname !== did) throw new Error("Record must be in your repo");
  if (at.collection !== BAZAAR_COLLECTION.collection) {
    throw new Error("Not a collection record");
  }
  const readAgent = await agentForRepo(did);
  const cur = (await readAgent.com.atproto.repo.getRecord({
    repo: did,
    collection: at.collection,
    rkey: at.rkey,
  })) as GetRecordResponse;
  const prev = cur.data.value as Collection;
  if (prev.$type !== "diamonds.whereditgo.bazaar.catalog.collection") {
    throw new Error("Invalid record type");
  }
  const merged: Collection = {
    ...draft,
    artistDid: prev.artistDid,
    createdAt: prev.createdAt,
    bazaarPid: prev.bazaarPid,
  };
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: at.collection,
    rkey: at.rkey,
    swapRecord: cur.data.cid,
    record: merged as unknown as Record<string, unknown>,
  });
}

/** Updates a physical item; immutable fields are always taken from the current record. */
export async function putPhysicalItem(
  agent: ATPRepoClient,
  uri: string,
  draft: PhysicalItem,
): Promise<void> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const at = new AtUri(uri);
  if (!at.rkey || !at.collection) throw new Error("Invalid URI");
  if (at.hostname !== did) throw new Error("Record must be in your repo");
  if (at.collection !== BAZAAR_COLLECTION.physicalItem) {
    throw new Error("Not a physical item record");
  }
  const readAgent = await agentForRepo(did);
  const cur = (await readAgent.com.atproto.repo.getRecord({
    repo: did,
    collection: at.collection,
    rkey: at.rkey,
  })) as GetRecordResponse;
  const prev = cur.data.value as PhysicalItem;
  if (prev.$type !== "diamonds.whereditgo.bazaar.catalog.item.physical") {
    throw new Error("Invalid record type");
  }
  const merged: PhysicalItem = {
    ...draft,
    artistDid: prev.artistDid,
    itemClass: prev.itemClass,
    createdAt: prev.createdAt,
  };
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: at.collection,
    rkey: at.rkey,
    swapRecord: cur.data.cid,
    record: merged as unknown as Record<string, unknown>,
  });
}

/** Only title/category/description are editable -- fileCid/fileChecksum/format/merchantDid are preserved as-authored. */
export async function putCatalogItem(
  agent: ATPRepoClient,
  uri: string,
  draft: {
    title: string;
    category?: string;
    description?: string;
    tags?: string[];
  },
): Promise<{ cid: string }> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const at = new AtUri(uri);
  if (!at.rkey || !at.collection) throw new Error("Invalid URI");
  if (at.hostname !== did) throw new Error("Record must be in your repo");
  if (at.collection !== BAZAAR_COLLECTION.item) {
    throw new Error("Not a catalog.item record");
  }
  const readAgent = await agentForRepo(did);
  const cur = (await readAgent.com.atproto.repo.getRecord({
    repo: did,
    collection: at.collection,
    rkey: at.rkey,
  })) as GetRecordResponse;
  const prev = cur.data.value as BazaarItem;
  if (prev.$type !== "diamonds.whereditgo.bazaar.catalog.item") {
    throw new Error("Invalid record type");
  }
  const merged: BazaarItem = {
    ...prev,
    title: draft.title,
    category: draft.category,
    description: draft.description,
    tags: draft.tags,
  };
  const res = (await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: at.collection,
    rkey: at.rkey,
    swapRecord: cur.data.cid,
    record: merged as unknown as Record<string, unknown>,
  })) as { cid: string };
  return { cid: res.cid };
}

/** title/description/tags/items are all editable -- items[] is mutable (see catalog.product.json). merchantDid/createdAt are preserved. */
export async function putCatalogProduct(
  agent: ATPRepoClient,
  uri: string,
  draft: {
    title: string;
    description?: string;
    tags?: string[];
    items: ItemRef[];
  },
): Promise<{ cid: string }> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const at = new AtUri(uri);
  if (!at.rkey || !at.collection) throw new Error("Invalid URI");
  if (at.hostname !== did) throw new Error("Record must be in your repo");
  if (at.collection !== BAZAAR_COLLECTION.product) {
    throw new Error("Not a catalog.product record");
  }
  const readAgent = await agentForRepo(did);
  const cur = (await readAgent.com.atproto.repo.getRecord({
    repo: did,
    collection: at.collection,
    rkey: at.rkey,
  })) as GetRecordResponse;
  const prev = cur.data.value as Product;
  if (prev.$type !== "diamonds.whereditgo.bazaar.catalog.product") {
    throw new Error("Invalid record type");
  }
  if (draft.items.length === 0) {
    throw new Error("A product needs at least one item");
  }
  const merged: Product = {
    ...prev,
    title: draft.title,
    description: draft.description,
    tags: draft.tags,
    items: draft.items,
  };
  const res = (await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: at.collection,
    rkey: at.rkey,
    swapRecord: cur.data.cid,
    record: merged as unknown as Record<string, unknown>,
  })) as { cid: string };
  return { cid: res.cid };
}

export async function findLicenseByTemplateId(
  did: string,
  templateId: LicenseTemplateId,
): Promise<{ uri: string; cid: string } | null> {
  const def = getLicenseTemplateDefinition(templateId);
  if (!def) return null;
  const agent = await agentForRepo(did);
  const res = (await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.licenseTerms,
    limit: 100,
  })) as ListRecordsResponse;
  for (const row of res.data.records) {
    const v = row.value;
    if (!isLicenseTerms(v)) continue;
    if (licenseRecordMatchesTemplate(v, def)) {
      return { uri: row.uri, cid: row.cid };
    }
  }
  return null;
}
