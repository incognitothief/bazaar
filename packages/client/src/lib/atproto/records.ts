import type { Agent } from "@atproto/api";
import { AtUri } from "@atproto/syntax";
import type {
  ActorProfile,
  Collection,
  DigitalItem,
  LicenseTerms,
  Listing,
  PurchaseReceipt,
} from "@/types/lexicons";
import { BAZAAR_COLLECTION } from "./ns";

const TEMPLATE_BASE = {
  rightsType: "both" as const,
  version: "1.0",
  territoryCoverage: { scope: "worldwide" as const },
  checkoutConsentRequired: true,
};

export const LICENSE_TEMPLATES = {
  personalOnly: {
    title: "Personal use only",
    tier: "personal" as const,
    ...TEMPLATE_BASE,
    usageRestrictions: {
      allowsStreaming: true,
      allowsDownload: true,
      allowsCommercialUse: false,
      allowsDerivatives: false,
      allowsSync: false,
      requiresAttribution: false,
    },
    humanReadableUrl: `${import.meta.env.VITE_APP_URL}/licenses/personal-v1`,
    summary:
      "Buyer may download and listen for personal use only. No commercial use, no derivatives, no sync.",
  },
  ccByNcNd: {
    title: "CC BY-NC-ND 4.0 (summary)",
    tier: "personal" as const,
    ...TEMPLATE_BASE,
    usageRestrictions: {
      allowsStreaming: true,
      allowsDownload: true,
      allowsCommercialUse: false,
      allowsDerivatives: false,
      allowsSync: false,
      requiresAttribution: true,
    },
    humanReadableUrl: "https://creativecommons.org/licenses/by-nc-nd/4.0/",
    summary:
      "Attribution required; non-commercial; no derivatives. See Creative Commons BY-NC-ND 4.0.",
  },
  ccByNc: {
    title: "CC BY-NC 4.0 (summary)",
    tier: "personal" as const,
    ...TEMPLATE_BASE,
    usageRestrictions: {
      allowsStreaming: true,
      allowsDownload: true,
      allowsCommercialUse: false,
      allowsDerivatives: true,
      allowsSync: false,
      requiresAttribution: true,
    },
    humanReadableUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
    summary:
      "Attribution required; non-commercial; remixes allowed if shared under the same license.",
  },
} as const;

export type LicenseTemplateKey = keyof typeof LICENSE_TEMPLATES;

function nowIso(): string {
  return new Date().toISOString();
}

export async function createDigitalItem(
  agent: Agent,
  record: Omit<DigitalItem, "$type" | "createdAt">,
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
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

export async function createCollection(
  agent: Agent,
  record: Omit<Collection, "$type" | "createdAt">,
): Promise<{ uri: string; cid: string }> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const full: Collection = {
    $type: "diamonds.whereditgo.bazaar.collection",
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
  agent: Agent,
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
  agent: Agent,
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
  agent: Agent,
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

function isCollection(v: unknown): v is Collection {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Collection).$type === "diamonds.whereditgo.bazaar.collection"
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

export type DigitalItemRow = { uri: string; cid: string; item: DigitalItem };
export type CollectionRow = { uri: string; cid: string; item: Collection };

export async function listDigitalItemRows(
  agent: Agent,
  did: string,
): Promise<DigitalItemRow[]> {
  const res = await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.digitalItem,
    limit: 100,
  });
  return res.data.records
    .filter((r) => isDigitalItem(r.value))
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      item: r.value as DigitalItem,
    }));
}

export async function listCollectionRows(
  agent: Agent,
  did: string,
): Promise<CollectionRow[]> {
  const res = await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.collection,
    limit: 100,
  });
  return res.data.records
    .filter((r) => isCollection(r.value))
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      item: r.value as Collection,
    }));
}

export async function listCatalogItems(
  agent: Agent,
  did: string,
): Promise<DigitalItem[]> {
  const rows = await listDigitalItemRows(agent, did);
  return rows.map((r) => r.item);
}

export async function listCollections(
  agent: Agent,
  did: string,
): Promise<Collection[]> {
  const rows = await listCollectionRows(agent, did);
  return rows.map((r) => r.item);
}

export async function listListings(
  agent: Agent,
  did: string,
): Promise<Listing[]> {
  const res = await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.listing,
    limit: 100,
  });
  return res.data.records.map((r) => r.value).filter(isListing);
}

export type ListingRow = { uri: string; cid: string; listing: Listing };

export async function listListingRows(
  agent: Agent,
  did: string,
): Promise<ListingRow[]> {
  const res = await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.listing,
    limit: 100,
  });
  return res.data.records
    .filter((r) => isListing(r.value))
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      listing: r.value as Listing,
    }));
}

export async function putActorProfile(
  agent: Agent,
  record: ActorProfile,
  rkey: string,
  swapCid?: string,
): Promise<void> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: BAZAAR_COLLECTION.actorProfile,
    rkey,
    ...(swapCid ? { swapRecord: swapCid } : {}),
    record: record as unknown as Record<string, unknown>,
  });
}

export async function createActorProfile(
  agent: Agent,
  record: Omit<ActorProfile, "$type" | "createdAt">,
): Promise<{ uri: string; cid: string }> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const full: ActorProfile = {
    $type: "diamonds.whereditgo.bazaar.actor.profile",
    ...record,
    createdAt: nowIso(),
  };
  const res = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: BAZAAR_COLLECTION.actorProfile,
    record: full as unknown as Record<string, unknown>,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

export async function listLicenseTerms(
  agent: Agent,
  did: string,
): Promise<LicenseTerms[]> {
  const res = await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.licenseTerms,
    limit: 100,
  });
  return res.data.records.map((r) => r.value).filter(isLicenseTerms);
}

export async function getRecordValue<T>(
  agent: Agent,
  uri: string,
): Promise<T | null> {
  try {
    const at = new AtUri(uri);
    const repo = at.hostname;
    const collection = at.collection;
    const rkey = at.rkey;
    if (!collection || !rkey) return null;
    const res = await agent.com.atproto.repo.getRecord({
      repo,
      collection,
      rkey,
    });
    return res.data.value as T;
  } catch {
    return null;
  }
}

export async function putListing(
  agent: Agent,
  uri: string,
  record: Listing,
): Promise<void> {
  const did = agent.session?.did;
  if (!did) throw new Error("Not authenticated");
  const at = new AtUri(uri);
  if (at.hostname !== did) throw new Error("Listing repo mismatch");
  const cur = await agent.com.atproto.repo.getRecord({
    repo: did,
    collection: BAZAAR_COLLECTION.listing,
    rkey: at.rkey,
  });
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: BAZAAR_COLLECTION.listing,
    rkey: at.rkey,
    swapRecord: cur.data.cid,
    record: record as unknown as Record<string, unknown>,
  });
}

export async function listTracksForArtist(
  agent: Agent,
  did: string,
): Promise<DigitalItem[]> {
  const items = await listCatalogItems(agent, did);
  return items.filter((i) => i.itemClass === "track");
}

export async function findLicenseByTemplateKey(
  agent: Agent,
  did: string,
  templateKey: LicenseTemplateKey,
): Promise<{ uri: string; cid: string } | null> {
  const template = LICENSE_TEMPLATES[templateKey];
  const res = await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: BAZAAR_COLLECTION.licenseTerms,
    limit: 100,
  });
  for (const row of res.data.records) {
    const v = row.value;
    if (!isLicenseTerms(v)) continue;
    if (v.title === template.title && v.version === template.version) {
      return { uri: row.uri, cid: row.cid };
    }
  }
  return null;
}
