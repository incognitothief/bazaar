import { createPrivateKey, createPublicKey } from "node:crypto";
import { parseMultikey } from "@atproto/crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { appKeys, meta } from "../db/schema";
import { getAgentForDid } from "./atproto/resolvePds";
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
 * DID document shape:
 *   verificationMethod = the current key + every non-revoked key.
 *   assertionMethod    = the current key, only.
 *   keyHistory         = every non-current key, oldest → newest, forward-linked by `supersededBy`
 *                        (a full DID URL). An entry with `revoked: true` is hard-revoked —
 *                        signatures from it are rejected outright and it is absent from
 *                        verificationMethod. Without the flag the key is retired but still trusted
 *                        (and still in verificationMethod) for records it signed before rotation.
 *
 * `app_keys` (SQLite) is a boot-rebuilt audit mirror with zero authority.
 */

/** Fixed project vocab IRIs (identical for every deployment). Term defs live under `/ns/v1`. */
const CTX_NS = "https://bazaar.whereditgo.diamonds/ns#";
/** Hosted JSON-LD context URL — string-only `@context` entries for ATCute / Bluesky parsers. */
export const KEY_HISTORY_CONTEXT_URL = "https://bazaar.whereditgo.diamonds/ns/v1";
const DEFAULT_DID = "did:web:bazaar.whereditgo.diamonds";

/** One entry of the decoded APP_MERCHANT_KEY_HISTORY array / the served `keyHistory`. */
export type KeyHistoryEntry = {
  /** Full DID URL, e.g. did:web:…#merchant-key-2026-04-05 */
  id: string;
  type: "Multikey";
  publicKeyMultibase: string;
  /** Full DID URL of the key that became current after this one. Tail entry → the current key. */
  supersededBy: string;
  /** Present and true = hard-revoked. Absent = retired but trusted for its historical records. */
  revoked?: boolean;
};

export type MerchantKey = {
  /** Bare fragment, e.g. "merchant-key-2026-04-05" — matches a record's `kid`. */
  kid: string;
  /** Full DID URL. */
  id: string;
  publicKeyMultibase: string;
  publicKeyPem: string;
  kind: "current" | "retired";
  revoked: boolean;
  /** Full DID URL; undefined for the current key. */
  supersededBy?: string;
};

export type MerchantKeySet = {
  /** null when APP_MERCHANT_PRIVATE_KEY / _KID are unset or placeholder. */
  current: MerchantKey | null;
  /** Non-current keys, in the order supplied by APP_MERCHANT_KEY_HISTORY (oldest → newest). */
  history: MerchantKey[];
  /** current + history, keyed by bare kid fragment. */
  byKid: Map<string, MerchantKey>;
};

function isPlaceholder(v: string | undefined): boolean {
  return !v || v.includes("PLACEHOLDER");
}

/** The storefront DID. `APP_DID` when it is a did:web, else the built-in default. */
export function merchantDid(): string {
  const envDid = process.env.APP_DID?.trim();
  return envDid?.startsWith("did:web:") ? envDid : DEFAULT_DID;
}

/** Accept a full DID URL or a bare fragment; return the full DID URL. */
function toDidUrl(value: string): string {
  if (value.includes("#")) return value;
  return `${merchantDid()}#${value}`;
}

/** Bare fragment of a DID URL. */
function fragmentOf(didUrl: string): string {
  const i = didUrl.indexOf("#");
  return i >= 0 ? didUrl.slice(i + 1) : didUrl;
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
    id: `${merchantDid()}#${kid}`,
    publicKeyMultibase: derivedMultibase,
    publicKeyPem,
    kind: "current",
    revoked: false,
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
    const rawId = o.id ?? o.kid; // accept legacy "kid"
    const publicKeyMultibase = o.publicKeyMultibase;
    const supersededBy = o.supersededBy;
    if (typeof rawId !== "string" || !rawId) {
      throw new Error(`${where}: missing "id"`);
    }
    if (
      typeof publicKeyMultibase !== "string" ||
      !publicKeyMultibase.startsWith("z")
    ) {
      throw new Error(`${where}: missing/invalid "publicKeyMultibase"`);
    }
    if (typeof supersededBy !== "string" || !supersededBy) {
      throw new Error(`${where}: missing "supersededBy"`);
    }
    if (o.revoked !== undefined && typeof o.revoked !== "boolean") {
      throw new Error(`${where}: "revoked" must be a boolean`);
    }
    // Fail here rather than at verification time if the key can't be decoded.
    multibaseToSpkiPem(publicKeyMultibase);
    return {
      id: toDidUrl(rawId),
      type: "Multikey",
      publicKeyMultibase,
      supersededBy: toDidUrl(supersededBy),
      ...(o.revoked === true ? { revoked: true } : {}),
    };
  });
}

function buildKeySet(): MerchantKeySet {
  const current = currentKeyFromEnv();
  const history: MerchantKey[] = parseKeyHistoryEnv(
    process.env.APP_MERCHANT_KEY_HISTORY,
  ).map((h) => ({
    kid: fragmentOf(h.id),
    id: h.id,
    publicKeyMultibase: h.publicKeyMultibase,
    publicKeyPem: multibaseToSpkiPem(h.publicKeyMultibase),
    kind: "retired",
    revoked: h.revoked === true,
    supersededBy: h.supersededBy,
  }));

  const byKid = new Map<string, MerchantKey>();
  for (const k of history) {
    if (byKid.has(k.kid)) {
      throw new Error(`APP_MERCHANT_KEY_HISTORY has a duplicate key id: ${k.kid}`);
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
 * - `revoked: true` — the record's `kid` names a hard-revoked key. Reject outright,
 *   do not attempt any signature check.
 * - Otherwise `pems` is the hinted key first (if `kid` resolves and is not revoked),
 *   then the current key, then every non-revoked history key newest → oldest.
 */
export function candidatePemsForKid(
  keys: MerchantKeySet,
  kid: string | undefined,
): { revoked: boolean; pems: string[] } {
  if (kid && keys.byKid.get(kid)?.revoked) {
    return { revoked: true, pems: [] };
  }

  const ordered: MerchantKey[] = [];
  const push = (k: MerchantKey | undefined) => {
    if (k && !k.revoked && !ordered.includes(k)) ordered.push(k);
  };

  if (kid) push(keys.byKid.get(kid));
  push(keys.current ?? undefined);
  for (let i = keys.history.length - 1; i >= 0; i--) push(keys.history[i]);

  return { revoked: false, pems: ordered.map((k) => k.publicKeyPem) };
}

/**
 * JSON-LD context document for Bazaar DID extensions (`keyHistory`, `supersededBy`, `revoked`).
 * Served at `GET /ns/v1` and referenced by URL from the DID `@context` array (no inline object —
 * ATCute / Bluesky DID parsers reject non-string context entries).
 */
export function keyHistoryContextDocument(): Record<string, unknown> {
  return {
    "@context": {
      keyHistory: { "@id": `${CTX_NS}keyHistory`, "@container": "@list" },
      supersededBy: { "@id": `${CTX_NS}supersededBy`, "@type": "@id" },
      revoked: {
        "@id": `${CTX_NS}revoked`,
        "@type": "http://www.w3.org/2001/XMLSchema#boolean",
      },
    },
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
      id: k.id,
      publicKeyMultibase: k.publicKeyMultibase,
      publicKeyPem: k.publicKeyPem,
      status: k.revoked ? "revoked" : k.kind,
      supersededBy: k.supersededBy ?? null,
      revoked: k.revoked,
      firstSeenAt: firstSeen.get(k.kid) ?? now,
    })),
  );
}

/**
 * Assemble the served DID document from a key set and a base `@context` array.
 *
 * verificationMethod = the current key + every non-revoked key (a standard resolver can verify
 *                      records signed by any of them, including retired keys).
 * assertionMethod    = the current key, only.
 * keyHistory         = every non-current key (oldest → newest), each a full Multikey entry
 *                      (id, type, controller, publicKeyMultibase) plus a full-URL `supersededBy`
 *                      and an optional `revoked: true`. Revoked keys are present here (as
 *                      tombstones) but absent from verificationMethod.
 * authentication     = omitted.
 */
export function buildServiceDidDocument(
  keys: MerchantKeySet,
  contextBase: unknown[],
): Record<string, unknown> {
  const id = merchantDid();

  const vmEntry = (k: MerchantKey) => ({
    id: k.id,
    type: "Multikey" as const,
    controller: id,
    publicKeyMultibase: k.publicKeyMultibase,
  });

  const verificationMethod: unknown[] = [];
  const assertionMethod: string[] = [];
  if (keys.current) {
    verificationMethod.push(vmEntry(keys.current));
    assertionMethod.push(keys.current.id);
  }
  for (const k of keys.history) {
    if (!k.revoked) verificationMethod.push(vmEntry(k));
  }

  const keyHistory = keys.history.map((k) => ({
    id: k.id,
    type: "Multikey" as const,
    controller: id,
    publicKeyMultibase: k.publicKeyMultibase,
    supersededBy: k.supersededBy,
    ...(k.revoked ? { revoked: true } : {}),
  }));

  return {
    "@context": [...contextBase, KEY_HISTORY_CONTEXT_URL],
    id,
    verificationMethod,
    assertionMethod,
    keyHistory,
  };
}

// --- Merchant-side mirror (diamonds.whereditgo.bazaar.actor.merchantKeys) — ADR 0014 ---

const MERCHANT_KEYS_COLLECTION = "diamonds.whereditgo.bazaar.actor.merchantKeys";
const SYNC_META_KEY = "merchant_keys_sync";

/** One `actor.merchantKeys` record value, mirroring a `keyHistory` entry. `syncedAt` is added by the client. */
export type MerchantKeyMirrorRecord = {
  $type: "diamonds.whereditgo.bazaar.actor.merchantKeys";
  appDid: string;
  id: string;
  type: "Multikey";
  controller: string;
  publicKeyMultibase: string;
  supersededBy: string;
  revoked?: boolean;
};

export type MerchantKeySyncStatus = {
  /** true = PDS matches; false = drift; null = not checkable (unconfigured / PDS unreachable). */
  inSync: boolean | null;
  /** rkeys (= kids) whose mirror record is absent or stale and must be (re)written. */
  missing: string[];
  /** rkeys present on the PDS that are not in the current key history and should be deleted. */
  extra: string[];
  expectedCount: number;
  pdsCount: number;
  artistDid: string | null;
  checkedAt: string;
  error?: string;
  status?: "unconfigured";
};

/** The `actor.merchantKeys` records the merchant repo should contain: one per non-current key. */
export function expectedMerchantKeyRecords(): {
  rkey: string;
  record: MerchantKeyMirrorRecord;
}[] {
  const did = merchantDid();
  return getMerchantKeys().history.map((k) => ({
    rkey: k.kid,
    record: {
      $type: "diamonds.whereditgo.bazaar.actor.merchantKeys",
      appDid: did,
      id: k.id,
      type: "Multikey",
      controller: did,
      publicKeyMultibase: k.publicKeyMultibase,
      supersededBy: k.supersededBy as string,
      ...(k.revoked ? { revoked: true } : {}),
    },
  }));
}

function mirrorMatches(
  pds: Record<string, unknown>,
  want: MerchantKeyMirrorRecord,
): boolean {
  return (
    pds.id === want.id &&
    pds.publicKeyMultibase === want.publicKeyMultibase &&
    pds.supersededBy === want.supersededBy &&
    Boolean(pds.revoked) === Boolean(want.revoked)
  );
}

/** Compare the current key history against the merchant PDS's `actor.merchantKeys` collection. */
export function diffMerchantKeyMirror(
  pdsRecords: { uri: string; value: unknown }[],
): { missing: string[]; extra: string[]; pdsCount: number } {
  const byRkey = new Map<string, Record<string, unknown>>();
  for (const rec of pdsRecords) {
    const rkey = rec.uri.split("/").pop() ?? "";
    if (rkey) byRkey.set(rkey, (rec.value ?? {}) as Record<string, unknown>);
  }
  const expected = expectedMerchantKeyRecords();
  const expectedRkeys = new Set(expected.map((e) => e.rkey));
  const missing = expected
    .filter((e) => {
      const cur = byRkey.get(e.rkey);
      return !cur || !mirrorMatches(cur, e.record);
    })
    .map((e) => e.rkey);
  const extra = [...byRkey.keys()].filter((k) => !expectedRkeys.has(k));
  return { missing, extra, pdsCount: byRkey.size };
}

/**
 * Runs on every boot (from `index.ts`, after `reconcileMerchantKeys`). Best-effort: resolves the
 * merchant PDS, lists `actor.merchantKeys`, diffs it against the current key history, and stores
 * the result in `meta` for the merchant panel to read. Never throws.
 */
export async function checkMerchantKeySync(db: Db): Promise<MerchantKeySyncStatus> {
  const checkedAt = new Date().toISOString();
  const artistDid = process.env.ARTIST_DID?.trim() ?? null;
  const expectedCount = expectedMerchantKeyRecords().length;

  let status: MerchantKeySyncStatus;
  if (!artistDid?.startsWith("did:")) {
    status = {
      inSync: null,
      missing: [],
      extra: [],
      expectedCount,
      pdsCount: 0,
      artistDid: null,
      checkedAt,
      status: "unconfigured",
    };
  } else {
    try {
      const agent = await getAgentForDid(artistDid);
      const res = await agent.com.atproto.repo.listRecords({
        repo: artistDid,
        collection: MERCHANT_KEYS_COLLECTION,
        limit: 100,
      });
      const { missing, extra, pdsCount } = diffMerchantKeyMirror(res.data.records);
      status = {
        inSync: missing.length === 0 && extra.length === 0,
        missing,
        extra,
        expectedCount,
        pdsCount,
        artistDid,
        checkedAt,
      };
    } catch (e) {
      status = {
        inSync: null,
        missing: [],
        extra: [],
        expectedCount,
        pdsCount: 0,
        artistDid,
        checkedAt,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const value = JSON.stringify(status);
  await db
    .insert(meta)
    .values({ key: SYNC_META_KEY, value })
    .onConflictDoUpdate({
      target: meta.key,
      set: { value, updatedAt: new Date() },
    });
  return status;
}

/** The last stored `checkMerchantKeySync` result. */
export async function readMerchantKeySyncStatus(
  db: Db,
): Promise<MerchantKeySyncStatus | null> {
  const row = await db.select().from(meta).where(eq(meta.key, SYNC_META_KEY)).get();
  return row ? (JSON.parse(row.value) as MerchantKeySyncStatus) : null;
}
