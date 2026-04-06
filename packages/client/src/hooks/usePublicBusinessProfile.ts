import { useEffect, useState } from "react";
import { browserApiUrl } from "@/lib/browserApi";

export type PublicBusinessProfile = {
  businessName: string | null;
  businessState: string | null;
  businessEmail: string | null;
};

function parseProfile(j: unknown): PublicBusinessProfile | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const str = (k: string) => {
    const v = o[k];
    if (v === null) return null;
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" ? null : t;
  };
  return {
    businessName: str("businessName"),
    businessState: str("businessState"),
    businessEmail: str("businessEmail"),
  };
}

/** GET /api/business-profile (no auth). */
export function usePublicBusinessProfile() {
  const [profile, setProfile] = useState<PublicBusinessProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(browserApiUrl("/api/business-profile"))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        setProfile(parseProfile(j));
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return profile;
}
