import { createPrivateKey, createPublicKey } from "node:crypto";
import { parseMultikey } from "@atproto/crypto";
import type { Db } from "../db";
import { appKeys } from "../db/schema";
import { normalizeAppMerchantPrivateKey } from "./atproto/sign";
import { publicSpkiPemToMultibase } from "./publicKeyMultibase";

/**
 * Merchant (storefront) signing keys. See `docs/adr/0013-key-rotation-and-did-document-v2.md`.
 *
 * Source of truth is the environment, nothing else:
 *   APP_MERCHANT_PRIVATE_KEY      current signing key (secret PEM)
 *   APP_MERCHANT_KID              current key fragment, e.g. merchant-key-2026-08-29[-N]
 *   APP_MERCHANT_PUBLIC_MULTIBASE current public key `z…` (optional; derived from the PEM)
 *   APP_MERCHANT_KEY_HISTORY      base64(JSON array) of every NON-current key (see KeyHistoryEntry)
 *
 * `app_keys` (SQLite) is a boot-rebuilt audit mirror with zero authority.
 */

export type MerchantKeyStatus = "current" | "active" | "retired" | "revoked";

/** One entry of the decoded APP_MERCHANT_KEY_HISTORY array / the served `keyHistory`. */
export type KeyHistoryEntry = {
  kid: string;
  publicKeyMultibase: string;
  /** In env / served history this is one of "active" | "retired" | "revoked" (never "current"). */
  status: Exclude<MerchantKeyStatus, "current">;
  /** kid that became current after this one. The tail entry points at the current kid. */
  supersededBy: string;
  activatedAt?: string;
  retiredAt?: string;
  notes?: string;
};

export type MerchantKey = {
  kid: string;
  publicKeyMultibase: string;
  publicKeyPem: string;
  status: MerchantKeyStatus;
  supersededBy?: string;
  activatedAt?: string;
  retiredAt?: string;
  notes?: string;
};

export type MerchantKeySet = {
  /** null when APP_MERCHANT_PRIVATE_KEY / _KID are unset or placeholder. */
  current: MerchantKey | null;
  /** Non-current keys, in the order supplied by APP_MERCHANT_KEY_HISTORY (oldest → newest). */
  history: MerchantKey[];
  /** current + history, keyed by kid. */
  byKid: Map<string, MerchantKey>;
};

const CTX_NS = "https://bazaar.whereditgo.diamonds/ns#";
const HISTORY_STATUSES = new Set(["active", "retired", "revoked"]);

function isPlaceholder(v: string | undefined): boolean {
  return !v || v.includes("PLACEHOLDER");
}

/** Uncompressed P-256 point (`0x04 || X || Y`) → SPKI PEM. */
function multibaseToSpkiPem(multibase: string): string {
  const { jwtAlg, keyBytes } = parseMultikey(multibase);
  if (jwtAlg !== "ES256") {
    throw new Error(`unsupported key alg in multibase: ${jwtAlg}`);
  }
  if (keyBytes.length !== 65 || keyBytes[0] !== 0x04) {
    throw new Error("expected an uncompressed P-256 point from parseMultikey");
  }
  const x = Buffer.from(keyBytes.subarray(1, 33)).toString("base64url");
  const y = Buffer.from(keyBytes.subarray(33, 65)).toString("base64url");
  const key = createPublicKey({
    key: { kty: "EC", crv: "P-256", x, y },
    format: "jwk",
  });
  return key.export({ type: "spki", format: "pem" }) as string;
}

function currentKeyFromEnv(): MerchantKey | null {
  const rawPriv = process.env.APP_MERCHANT_PRIVATE_KEY?.trim();
  const kid = process.env.APP_MERCHANT_KID?.trim();
  if (isPlaceholder(rawPriv) || !kid) return null;

  const priv = createPrivateKey(normalizeAppMerchantPrivateKey(rawPriv!));
  const pub = createPublicKey(priv);
  const publicKeyPem = pub.export({ type: "spki", format: "pem" }) as string;

  const derivedMultibase = publicSpkiPemToMultibase(publicKeyPem);
  const envMultibase = process.env.APP_MERCHANT_PUBLIC_MULTIBASE?.trim();
  if (envMultibase && envMultibase !== derivedMultibase) {
    throw new Error(
      "APP_MERCHANT_PUBLIC_MULTIBASE does not match APP_MERCHANT_PRIVATE_KEY",
    );
  }

  return {
    kid,
    publicKeyMultibase: derivedMultibase,
    publicKeyPem,
    status: "current",
  };
}

/** Decode APP_MERCHANT_KEY_HISTORY (base64(JSON) or bare JSON). Throws loudly on anything malformed. */
export function parseKeyHistoryEnv(raw: string | undefined): KeyHistoryEntry[] {
  const trimmed = raw?.trim();
  if (!trimmed || isPlaceholder(trimmed)) return [];

  let jsonText = trimmed;
  if (!trimmed.startsWith("[")) {
    try {
      jsonText = Buffer.from(trimmed, "base64").toString("utf8");
    } catch {
      throw new Error("APP_MERCHANT_KEY_HISTORY is neither JSON nor base64(JSON)");
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(
      `APP_MERCHANT_KEY_HISTORY is not valid JSON: ${(e as Error).message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("APP_MERCHANT_KEY_HISTORY must decode to a JSON array");
  }

  return parsed.map((v, i) => {
    const o = v as Record<string, unknown>;
    const where = `APP_MERCHANT_KEY_HISTORY[${i}]`;
    const kid = o.kid;
    const publicKeyMultibase = o.publicKeyMultibase;
    const status = o.status;
    const supersededBy = o.supersededBy;
    if (typeof kid !== "string" || !kid) {
      throw new Error(`${where}: missing "kid"`);
    }
    if (typeof publicKeyMultibase !== "string" || !publicKeyMultibase.startsWith("z")) {
      throw new Error(`${where}: missing/invalid "publicKeyMultibase"`);
    }
    if (typeof status !== "string" || !HISTORY_STATUSES.has(status)) {
      throw new Error(
        `${where}: "status" must be "active" | "retired" | "revoked"`,
      );
    }
    if (typeof supersededBy !== "string" || !supersededBy) {
      throw new Error(`${where}: missing "supersededBy"`);
    }
    // Fail here rather than at verification time if the key can't be decoded.
    multibaseToSpkiPem(publicKeyMultibase);
    return {
      kid,
      publicKeyMultibase,
      status: status as KeyHistoryEntry["status"],
      supersededBy,
      activatedAt: typeof o.activatedAt === "string" ? o.activatedAt : undefined,
      retiredAt: typeof o.retiredAt === "string" ? o.retiredAt : undefined,
      notes: typeof o.notes === "string" ? o.notes : undefined,
    };
  });
}

function buildKeySet(): MerchantKeySet {
  const current = currentKeyFromEnv();
  const history: MerchantKey[] = parseKeyHistoryEnv(
    process.env.APP_MERCHANT_KEY_HISTORY,
  ).map((h) => ({
    kid: h.kid,
    publicKeyMultibase: h.publicKeyMultibase,
    publicKeyPem: multibaseToSpkiPem(h.publicKeyMultibase),
    status: h.status,
    supersededBy: h.supersededBy,
    activatedAt: h.activatedAt,
    retiredAt: h.retiredAt,
    notes: h.notes,
  }));

  const byKid = new Map<string, MerchantKey>();
  for (const k of history) {
    if (byKid.has(k.kid)) {
      throw new Error(`APP_MERCHANT_KEY_HISTORY has a duplicate kid: ${k.kid}`);
    }
    byKid.set(k.kid, k);
  }
  if (current) {
    if (byKid.has(current.kid)) {
      throw new Error(
        `current key ${current.kid} also appears in APP_MERCHANT_KEY_HISTORY`,
      );
    }
    byKid.set(current.kid, current);
  }

  return { current, history, byKid };
}

let cached: MerchantKeySet | null = null;

/** Parsed merchant key set from the environment, memoised. */
export function getMerchantKeys(): MerchantKeySet {
  if (!cached) cached = buildKeySet();
  return cached;
}

/** Test hook — drop the memoised key set so the next getMerchantKeys() re-reads env. */
export function resetMerchantKeysCache(): void {
  cached = null;
}

/**
 * Ordered public-key PEMs to try when verifying a record's `appSig`.
 *
 * - `revoked: true` means the record names a kid whose key is revoked — reject outright,
 *   do not attempt any signature check.
 * - Otherwise `pems` is the hinted key first (if the `kid` resolves), then every other
 *   non-revoked key newest → oldest.
 */
export function candidatePemsForKid(
  keys: MerchantKeySet,
  kid: string | undefined,
): { revoked: boolean; pems: string[] } {
  if (kid) {
    const hinted = keys.byKid.get(kid);
    if (hinted?.status === "revoked") return { revoked: true, pems: [] };
  }

  const nonRevoked: MerchantKey[] = [];
  if (keys.current) nonRevoked.push(keys.current);
  // history is oldest → newest; try newest first
  for (let i = keys.history.length - 1; i >= 0; i--) {
    const k = keys.history[i]!;
    if (k.status !== "revoked") nonRevoked.push(k);
  }

  const ordered: MerchantKey[] = [];
  if (kid) {
    const hinted = keys.byKid.get(kid);
    if (hinted && hinted.status !== "revoked") ordered.push(hinted);
  }
  for (const k of nonRevoked) {
    if (!ordered.includes(k)) ordered.push(k);
  }

  return { revoked: false, pems: ordered.map((k) => k.publicKeyPem) };
}

/** The inline JSON-LD `@context` object that declares `keyHistory` and its terms. */
export function keyHistoryContext(): Record<string, unknown> {
  return {
    keyHistory: { "@id": `${CTX_NS}keyHistory`, "@container": "@list" },
    kid: `${CTX_NS}kid`,
    status: `${CTX_NS}status`,
    supersededBy: `${CTX_NS}supersededBy`,
    activatedAt: `${CTX_NS}activatedAt`,
    retiredAt: `${CTX_NS}retiredAt`,
    notes: `${CTX_NS}notes`,
  };
}

/**
 * Rebuild the `app_keys` audit mirror from the environment. Zero-authority: the table is
 * truncated and repopulated on every boot, so it can never be the thing that is stale.
 * Preserves `first_seen_at` for kids already present. Call once at startup.
 */
export async function reconcileMerchantKeys(db: Db): Promise<void> {
  const keys = getMerchantKeys();
  const rows: MerchantKey[] = [
    ...(keys.current ? [keys.current] : []),
    ...keys.history,
  ];

  const existing = await db.select().from(appKeys);
  const firstSeen = new Map(existing.map((r) => [r.kid, r.firstSeenAt]));

  await db.delete(appKeys);
  if (rows.length === 0) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("reconcileMerchantKeys: no merchant keys configured in env");
    }
    return;
  }

  const now = new Date();
  await db.insert(appKeys).values(
    rows.map((k) => ({
      kid: k.kid,
      publicKeyMultibase: k.publicKeyMultibase,
      publicKeyPem: k.publicKeyPem,
      status: k.status,
      supersededBy: k.supersededBy ?? null,
      activatedAt: k.activatedAt ?? null,
      retiredAt: k.retiredAt ?? null,
      notes: k.notes ?? null,
      firstSeenAt: firstSeen.get(k.kid) ?? now,
      lastVerifiedAt: null,
    })),
  );
}

type Skeleton = { "@context": unknown[]; id: string };

/**
 * Assemble the served DID document from a key set and a `{ "@context", id }` skeleton.
 *
 * verificationMethod = current key + every `status:"active"` history key.
 * assertionMethod    = the current key only.
 * keyHistory         = every non-current key, as supplied (oldest → newest).
 * authentication     = omitted.
 */
export function buildServiceDidDocument(
  keys: MerchantKeySet,
  skeleton: Skeleton,
): Record<string, unknown> {
  const envDid = process.env.APP_DID?.trim();
  if (envDid && !envDid.startsWith("did:web:") && process.env.NODE_ENV !== "test") {
    console.warn(
      `service DID: APP_DID "${envDid}" is not a did:web — using ${skeleton.id} for the document id`,
    );
  }
  const id = envDid?.startsWith("did:web:") ? envDid : skeleton.id;

  const vmEntry = (k: { kid: string; publicKeyMultibase: string }) => ({
    id: `${id}#${k.kid}`,
    type: "Multikey",
    controller: id,
    publicKeyMultibase: k.publicKeyMultibase,
  });

  const verificationMethod: unknown[] = [];
  const assertionMethod: string[] = [];
  if (keys.current) {
    verificationMethod.push(vmEntry(keys.current));
    assertionMethod.push(`${id}#${keys.current.kid}`);
  }
  for (const k of keys.history) {
    if (k.status === "active") verificationMethod.push(vmEntry(k));
  }

  const keyHistory = keys.history.map((k) => {
    const e: Record<string, unknown> = {
      kid: k.kid,
      publicKeyMultibase: k.publicKeyMultibase,
      status: k.status,
      supersededBy: k.supersededBy,
    };
    if (k.activatedAt) e.activatedAt = k.activatedAt;
    if (k.retiredAt) e.retiredAt = k.retiredAt;
    if (k.notes) e.notes = k.notes;
    return e;
  });

  return {
    "@context": [...skeleton["@context"], keyHistoryContext()],
    id,
    verificationMethod,
    assertionMethod,
    keyHistory,
  };
}
