import { useMemo } from "react";
import { createProxyAgent } from "@/lib/atproto/session";
import type { ATPRepoClient } from "@/lib/atproto/session";
import type { AtpSession } from "./useAtpSession";

export function useMerchantAgent(session: AtpSession | null): ATPRepoClient | null {
  return useMemo(() => {
    if (!session) return null;
    return createProxyAgent(session.did);
  }, [session]);
}
