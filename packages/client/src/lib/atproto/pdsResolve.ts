import { Agent } from "@atproto/api";
import { browserApiUrl } from "@/lib/browserApi";

const TTL_MS = 60 * 60 * 1000; // 1 hour — PDS migrations are rare, cache aggressively.
const cache = new Map<string, { pds: string; expiresAt: number }>();

async function resolvePdsForDid(did: string): Promise<string | null> {
  const hit = cache.get(did);
  if (hit && hit.expiresAt > Date.now()) return hit.pds;
  try {
    const res = await fetch(
      browserApiUrl(`/api/atproto/resolve-pds?did=${encodeURIComponent(did)}`),
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { pds?: string };
    if (!data.pds) return null;
    cache.set(did, { pds: data.pds, expiresAt: Date.now() + TTL_MS });
    return data.pds;
  } catch {
    return null;
  }
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
