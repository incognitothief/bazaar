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
 * `resolveHandle` convenience endpoint. Use this instead of
 * `createPublicAgent().com.atproto.identity.resolveHandle(...)`.
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
 * `com.atproto.repo.getRecord` / `listRecords` only work against the specific
 * host that has the repo — there is no single endpoint that serves every
 * repo. `createPublicAgent()` points at one fixed default
 * (`VITE_ATPROTO_SERVICE`), which only happens to work for repos hosted
 * there. This resolves the real PDS per-DID via the server (cached), falling
 * back to that same default if resolution fails so behavior never regresses
 * below the previous fixed-host baseline.
 */
export async function agentForRepo(did: string): Promise<Agent> {
  const pds = await resolvePdsForDid(did);
  return new Agent({ service: pds ?? import.meta.env.VITE_ATPROTO_SERVICE });
}
