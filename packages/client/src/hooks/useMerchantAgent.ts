import { useMemo } from "react";
import { createSessionAgent } from "@/lib/atproto/session";
import type { AtpSession } from "./useAtpSession";

export function useMerchantAgent(session: AtpSession | null) {
  return useMemo(() => {
    if (!session) return null;
    return createSessionAgent(
      session.accessJwt,
      session.refreshJwt,
      session.did,
    );
  }, [session]);
}
