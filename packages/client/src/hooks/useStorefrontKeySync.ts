import { useCallback, useEffect, useState } from "react";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import { browserApiUrl } from "@/lib/browserApi";
import { useAtpSession } from "./useAtpSession";
import { useMerchantAgent } from "./useMerchantAgent";

type ExpectedEntry = { rkey: string; record: Record<string, unknown> };

export type StorefrontKeySyncStatus = {
  /** true = PDS mirror matches; false = drift; null = not checkable. */
  inSync: boolean | null;
  /** rkeys (= kids) whose mirror record must be (re)written. */
  missing: string[];
  /** rkeys on the PDS not in the current key history — deleted on sync. */
  extra: string[];
  expectedCount: number;
  pdsCount: number;
  checkedAt?: string;
  error?: string;
  status?: string;
  /** Exact `actor.storefrontKeys` record values the client should `putRecord`. */
  expected: ExpectedEntry[];
};

/**
 * Storefront key mirror status for the merchant panel: is the merchant's
 * `actor.storefrontKeys` collection in step with the storefront's current key
 * history? `sync()` writes/deletes records to bring it back in step. See ADR 0014 / 0015.
 */
export function useStorefrontKeySync() {
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);
  const [status, setStatus] = useState<StorefrontKeySyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (path: string, method: "GET" | "POST") => {
    const res = await fetch(browserApiUrl(path), {
      method,
      credentials: "include",
    });
    if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
    return (await res.json()) as StorefrontKeySyncStatus;
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await load("/api/merchant/key-sync-status", "GET"));
      setError(null);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const sync = useCallback(async () => {
    if (!agent || !session || !status) return;
    setSyncing(true);
    setError(null);
    try {
      const repo = session.did;
      const collection = BAZAAR_COLLECTION.actorStorefrontKeys;
      for (const e of status.expected) {
        await agent.com.atproto.repo.putRecord({
          repo,
          collection,
          rkey: e.rkey,
          record: { ...e.record, syncedAt: new Date().toISOString() },
        });
      }
      for (const rkey of status.extra) {
        await agent.com.atproto.repo.deleteRecord({ repo, collection, rkey });
      }
      setStatus(await load("/api/merchant/key-sync-status/recheck", "POST"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [agent, session, status, load]);

  return { status, loading, syncing, error, sync, refetch };
}
