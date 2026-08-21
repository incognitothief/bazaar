import { AtUri } from "@atproto/syntax";
import {
  getLicenseTemplateDefinition,
  licenseRecordMatchesTemplate,
  stripLicenseTemplateType,
  type LicenseTemplateId,
} from "@bazaar/shared";
import { agentForRepo } from "./pdsResolve";
import type { ATPRepoClient } from "./session";
import type {
  ActorMerchant,
  BazaarItemType,
  CatalogItem,
  Collection,
  Composition,
  DigitalItem,
  ItemRef,
  LicenseTerms,
  Listing,
  PhysicalItem,
  PurchaseConsent,
  PurchaseReceipt,
  Recording,
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

export async function createDigitalItem(
  agent: ATPRepoClient,
  record: Omit<DigitalItem, "$type" | "createdAt">,
  opts?: { rkey?: string },
): Promise<{ uri: string; cid: string }> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const full: DigitalItem = {
    $type: "diamonds.whereditgo.bazaar.catalog.item.digital",
    ...record,
    createdAt: nowIso(),
  };
  const res = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: BAZAAR_COLLECTION.digitalItem,
    record: full as unknown as Record<string, unknown>,
    ...(opts?.rkey ? { rkey: opts.rkey } : {}),
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

export async function createCollection(
  agent: ATPRepoClient,
  record: Omit<Collection, "$type" | "createdAt">,
): Promise<{ uri: string; cid: string }> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const full: Collection = {
    $type: "diamonds.whereditgo.bazaar.catalog.collection",
    ...record,
    createdAt: nowIso(),
  };
  const res = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: BAZAAR_COLLECTION.collection,
    record: full as unknown as Record<string, unknown>,
  });
  return { uri: res.data.uri, cid: res.data.cid };
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

function isRecording(v: unknown): v is Recording {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Recording).$type ===
      "diamonds.whereditgo.bazaar.catalog.recording"
  );
}

function isComposition(v: unknown): v is Composition {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Composition).$type ===
      "diamonds.whereditgo.bazaar.catalog.composition"
  );
}

function isCollection(v: unknown): v is Collection {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Collection).$type ===
      "diamonds.whereditgo.bazaar.catalog.collection"
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

function isPurchaseConsent(v: unknown): v is PurchaseConsent {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as PurchaseConsent).$type ===
      "diamonds.whereditgo.bazaar.purchase.consent"
  );
}

export type PurchaseReceiptRow = {
  uri: string;
  cid: string;
  receipt: PurchaseReceipt;
};

/** One row per Stripe payment (or per record URI if paymentRef missing). */
function dedupePurchaseReceiptRows(rows: PurchaseReceiptRow[]): PurchaseReceiptRow[] {
  const byKey = new Map<string, PurchaseReceiptRow>();
  for (const row of rows) {
    const pr = row.receipt.paymentRef?.trim();
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

export type PurchaseConsentRow = {
  uri: string;
  cid: string;
  consent: PurchaseConsent;
};

/** One consent per receipt URI (latest consentedAt wins). */
function dedupePurchaseConsentRows(rows: PurchaseConsentRow[]): PurchaseConsentRow[] {
  const byReceipt = new Map<string, PurchaseConsentRow>();
  for (const row of rows) {
    const ru = row.consent.receiptUri?.trim();
    if (!ru) continue;
    const prev = byReceipt.get(ru);
    if (
      !prev ||
      new Date(row.consent.consentedAt).getTime() >=
        new Date(prev.consent.consentedAt).getTime()
    ) {
      byReceipt.set(ru, row);
    }
  }
  return Array.from(byReceipt.values());
}

export async function listPurchaseConsentRows(
  did: string,
): Promise<PurchaseConsentRow[]> {
  const agent = await agentForRepo(did);
  const res = (await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.consent,
    limit: 100,
  })) as ListRecordsResponse;
  const rows = res.data.records
    .filter((r) => isPurchaseConsent(r.value))
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      consent: r.value as PurchaseConsent,
    }));
  return dedupePurchaseConsentRows(rows);
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

export type RecordingRow = { uri: string; cid: string; recording: Recording };

export async function listRecordingRows(
  did: string,
): Promise<RecordingRow[]> {
  const records = await listAllRecordsForCollection(
    did,
    BAZAAR_COLLECTION.recording,
  );
  return records
    .filter((r) => isRecording(r.value))
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      recording: r.value as Recording,
    }));
}

export type CompositionRow = { uri: string; cid: string; composition: Composition };

export async function listCompositionRows(
  did: string,
): Promise<CompositionRow[]> {
  const records = await listAllRecordsForCollection(
    did,
    BAZAAR_COLLECTION.composition,
  );
  return records
    .filter((r) => isComposition(r.value))
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      composition: r.value as Composition,
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

export async function listCatalogItems(did: string): Promise<DigitalItem[]> {
  const rows = await listDigitalItemRows(did);
  return rows.map((r) => r.item);
}

export async function listCollections(did: string): Promise<Collection[]> {
  const rows = await listCollectionRows(did);
  return rows.map((r) => r.item);
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

/** Resolve `item` + `cid` for a new listing from a catalog AT-URI. */
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
    return {
      uri: itemUri,
      cid: res.data.cid,
      itemType: (v as { $type: BazaarItemType }).$type,
    };
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

export async function listTracksForArtist(
  did: string,
): Promise<DigitalItem[]> {
  const items = await listCatalogItems(did);
  return items.filter((i) => i.itemClass === "track");
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
