import { Agent } from "@atproto/api";
import { browserApiUrl } from "@/lib/browserApi";

const TTL_MS = 60 * 60 * 1000; // 1 hour — PDS migrations (and handle changes) are rare, cache aggressively.
type Identity = { pds: string; handle: string | null };
const cache = new Map<string, { value: Identity; expiresAt: number }>();
const inFlight = new Map<string, Promise<Identity | null>>();
const handleCache = new Map<string, { did: string; expiresAt: number }>();
const handleInFlight = new Map<string, Promise<string | null>>();

async function resolveIdentity(did: string): Promise<Identity | null> {
  const hit = cache.get(did);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const existing = inFlight.get(did);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(
        browserApiUrl(`/api/atproto/resolve-pds?did=${encodeURIComponent(did)}`),
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { pds?: string; handle?: string | null };
      if (!data.pds) return null;
      const value: Identity = { pds: data.pds, handle: data.handle ?? null };
      cache.set(did, { value, expiresAt: Date.now() + TTL_MS });
      return value;
    } catch {
      return null;
    } finally {
      inFlight.delete(did);
    }
  })();
  inFlight.set(did, promise);
  return promise;
}

async function resolvePdsForDid(did: string): Promise<string | null> {
  const identity = await resolveIdentity(did);
  return identity?.pds ?? null;
}

/**
 * Handle the DID document currently claims (display-only — not bidirectionally
 * verified). Returns null if resolution fails or the DID doc has no handle.
 */
export async function resolveHandleForDid(did: string): Promise<string | null> {
  const identity = await resolveIdentity(did);
  return identity?.handle ?? null;
}

/**
 * Resolves a handle to its DID via the server's generic resolver — protocol-level
 * DNS/well-known lookup with bidirectional verification (see resolveDidForHandle
 * in packages/server/src/lib/atproto/resolvePds.ts), never a fixed AppView's
 * `resolveHandle` convenience endpoint.
 *
 * Also opportunistically warms the DID-keyed identity cache from the same
 * response, since the server already resolved pds+handle for that did too.
 *
 * Returns null if the handle doesn't resolve or fails verification.
 */
export async function resolveDidForHandle(handle: string): Promise<string | null> {
  const normalized = handle.trim().toLowerCase();
  const hit = handleCache.get(normalized);
  if (hit && hit.expiresAt > Date.now()) return hit.did;

  const existing = handleInFlight.get(normalized);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(
        browserApiUrl(`/api/atproto/resolve-pds?handle=${encodeURIComponent(normalized)}`),
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        did?: string;
        pds?: string;
        handle?: string | null;
      };
      if (!data.did || !data.pds) return null;
      handleCache.set(normalized, { did: data.did, expiresAt: Date.now() + TTL_MS });
      cache.set(data.did, {
        value: { pds: data.pds, handle: data.handle ?? null },
        expiresAt: Date.now() + TTL_MS,
      });
      return data.did;
    } catch {
      return null;
    } finally {
      handleInFlight.delete(normalized);
    }
  })();
  handleInFlight.set(normalized, promise);
  return promise;
}

/**
 * Unauthenticated Agent bound to the PDS that actually hosts `did`'s repo.
 *
 * `com.atproto.repo.getRecord` / `listRecords` / `com.atproto.sync.getBlob`
 * are PDS-hosted: they answer only for repos physically on the queried host.
 * There is no endpoint that serves every repo, so the host has to be resolved
 * per DID (cached for an hour above).
 *
 * **Throws when resolution fails rather than falling back to a fixed host.**
 * The fixed-host fallback this replaces looked conservative and was not: it
 * turned "we could not resolve this DID" into a lookup against a server that
 * almost certainly does not have the repo, which comes back as an ordinary
 * empty result. Callers then render "no such record" for data that exists.
 * A thrown error is the honest outcome — callers that already treat failure
 * as absence still do, without the misleading round-trip.
 */
export async function agentForRepo(did: string): Promise<Agent> {
  const pds = await resolvePdsForDid(did);
  if (!pds) {
    throw new Error(`Could not resolve a PDS for ${did}`);
  }
  return new Agent({ service: pds });
}
