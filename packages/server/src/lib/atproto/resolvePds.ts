import { Agent } from "@atproto/api";
import { IdResolver } from "@atproto/identity";

const idResolver = new IdResolver();

const TTL_MS = 60 * 60 * 1000; // 1 hour — PDS migrations (and handle changes) are rare, cache aggressively.
const cache = new Map<string, { pds: string; handle: string; expiresAt: number }>();
const handleCache = new Map<string, { did: string; expiresAt: number }>();

function fallbackService(): string {
  return process.env.ATPROTO_SERVICE ?? "https://bsky.social";
}

/**
 * Resolves the DID document once and caches both fields it yields — PDS
 * endpoint and (DID-doc-claimed, unverified) handle — since one resolution
 * call already produces both. Internal; callers use the two functions below.
 */
async function resolveIdentity(
  did: string,
): Promise<{ pds: string; handle: string } | null> {
  const hit = cache.get(did);
  if (hit && hit.expiresAt > Date.now()) return hit;
  try {
    const data = await idResolver.did.resolveAtprotoData(did);
    if (!data.pds) return null;
    const entry = { pds: data.pds, handle: data.handle, expiresAt: Date.now() + TTL_MS };
    cache.set(did, entry);
    return entry;
  } catch (e) {
    console.warn("resolveIdentity: resolution failed", did, e);
    return null;
  }
}

/**
 * Resolves the PDS service endpoint that actually hosts `did`'s repo.
 *
 * `com.atproto.repo.getRecord` / `listRecords` are PDS-hosted endpoints: they
 * only return data for repos physically hosted on the queried server. A
 * single fixed "service" URL (e.g. the default ATPROTO_SERVICE) only works
 * for repos that happen to live on that one host — every other DID 404s.
 * This does the real DID→PDS lookup atproto expects (resolving the DID
 * document), with an in-memory cache since PDS migrations are rare.
 *
 * Returns null on resolution failure so callers can fall back gracefully.
 */
export async function resolvePdsForDid(did: string): Promise<string | null> {
  const identity = await resolveIdentity(did);
  return identity?.pds ?? null;
}

/**
 * Resolves the handle `did`'s DID document currently claims. Display-only —
 * this is not bidirectionally verified (the handle's own DNS/`.well-known`
 * isn't checked back against the DID), so treat it as a friendly label, not
 * an authenticated identity. Returns null on resolution failure.
 */
export async function resolveHandleForDid(did: string): Promise<string | null> {
  const identity = await resolveIdentity(did);
  return identity?.handle ?? null;
}

/**
 * Resolves a handle to its DID using the protocol-level mechanism only — a
 * DNS TXT record at `_atproto.<handle>`, or `/.well-known/atproto-did` on the
 * handle's own domain (`IdResolver.handle`, from `@atproto/identity`; plain
 * DNS + a fetch to the handle's own host, no third-party AppView involved).
 * We deliberately don't call any AppView's `com.atproto.identity.resolveHandle`
 * (e.g. bsky.social's) — that only works because that particular AppView
 * happens to index arbitrary handles as a convenience; it isn't a resolution
 * authority and there's no guarantee it indexes a given handle at all. Doing
 * the DNS/well-known lookup ourselves has no dependency on any single service
 * being up or willing to serve the query.
 *
 * Bidirectionally verifies the result: the resolved DID's own document must
 * claim this same handle back, or the lookup is treated as failed. Without
 * this check, a stale or attacker-controlled DNS/well-known record could
 * claim a DID that isn't actually associated with the handle.
 *
 * Note: the DID-document side of this (for `did:plc:*`, the common case)
 * still resolves against `plc.directory` — the sole registry for that DID
 * method, unavoidable for anyone including third-party resolvers, not a
 * convenience dependency on Bluesky specifically. `did:web:*` DIDs resolve
 * straight from their own domain and never touch `plc.directory` at all.
 *
 * Returns null if the handle doesn't resolve, or resolves to a DID whose
 * document doesn't claim it back.
 */
export async function resolveDidForHandle(handle: string): Promise<string | null> {
  const normalized = handle.trim().toLowerCase();
  const hit = handleCache.get(normalized);
  if (hit && hit.expiresAt > Date.now()) return hit.did;
  try {
    const did = await idResolver.handle.resolve(normalized);
    if (!did) return null;
    const identity = await resolveIdentity(did);
    if (!identity || identity.handle.toLowerCase() !== normalized) {
      console.warn("resolveDidForHandle: bidirectional verification failed", {
        handle: normalized,
        did,
        claimedHandle: identity?.handle,
      });
      return null;
    }
    handleCache.set(normalized, { did, expiresAt: Date.now() + TTL_MS });
    return did;
  } catch (e) {
    console.warn("resolveDidForHandle: resolution failed", normalized, e);
    return null;
  }
}

/**
 * Unauthenticated Agent bound to the PDS that actually hosts `did`'s repo.
 * Falls back to ATPROTO_SERVICE (or https://bsky.social) if resolution fails,
 * so behavior never regresses below the previous fixed-host baseline.
 */
export async function getAgentForDid(did: string): Promise<Agent> {
  const pds = await resolvePdsForDid(did);
  return new Agent({ service: pds ?? fallbackService() });
}
