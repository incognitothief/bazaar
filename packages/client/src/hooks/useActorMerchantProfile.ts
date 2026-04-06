import { useEffect, useState } from "react";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import { createPublicAgent } from "@/lib/atproto/session";
import type { ActorMerchant } from "@/types/lexicons";

export type ActorMerchantProfileState = {
  profile: ActorMerchant | null;
  loading: boolean;
  error: string | null;
};

/** Public `diamonds.whereditgo.bazaar.actor.merchant` for the storefront DID (displayName, description, …). */
export function useActorMerchantProfile(
  artistDid: string | undefined,
): ActorMerchantProfileState {
  const [profile, setProfile] = useState<ActorMerchant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!artistDid?.startsWith("did:")) {
      setProfile(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const agent = createPublicAgent();
        const res = await agent.com.atproto.repo.listRecords({
          repo: artistDid,
          collection: BAZAAR_COLLECTION.actorMerchant,
          limit: 1,
        });
        const row = res.data.records[0];
        const v = row?.value as ActorMerchant | undefined;
        if (!cancelled) {
          setProfile(v ?? null);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setProfile(null);
          setError(
            e instanceof Error
              ? e.message
              : "Failed to load storefront profile",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [artistDid]);

  return { profile, loading, error };
}
