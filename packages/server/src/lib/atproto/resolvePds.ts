import { Agent } from "@atproto/api";
import { IdResolver } from "@atproto/identity";

const idResolver = new IdResolver();

const TTL_MS = 60 * 60 * 1000; // 1 hour — PDS migrations are rare, cache aggressively.
const cache = new Map<string, { pds: string; expiresAt: number }>();

function fallbackService(): string {
  return process.env.ATPROTO_SERVICE ?? "https://bsky.social";
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
  const hit = cache.get(did);
  if (hit && hit.expiresAt > Date.now()) return hit.pds;
  try {
    const data = await idResolver.did.resolveAtprotoData(did);
    if (!data.pds) return null;
    cache.set(did, { pds: data.pds, expiresAt: Date.now() + TTL_MS });
    return data.pds;
  } catch (e) {
    console.warn("resolvePdsForDid: resolution failed", did, e);
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
