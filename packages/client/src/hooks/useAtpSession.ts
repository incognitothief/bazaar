import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "@/lib/apiUrl";

export type AtpSession = {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
};

const MOCK_KEY = "bazaar_mock_atp_session";

export function useAtpSession(): {
  session: AtpSession | null;
  loading: boolean;
  signIn: () => void;
  signOut: () => void;
} {
  const [session, setSession] = useState<AtpSession | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (import.meta.env.DEV) {
        const raw = localStorage.getItem(MOCK_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as AtpSession;
          if (parsed?.did && parsed?.accessJwt) {
            setSession(parsed);
            setLoading(false);
            return;
          }
        }
      }
      const res = await fetch(apiUrl("/api/atproto/session"), {
        credentials: "include",
      });
      if (!res.ok) {
        setSession(null);
        return;
      }
      const data = (await res.json()) as AtpSession | null;
      setSession(data?.did ? data : null);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signIn = useCallback(() => {
    window.location.href = apiUrl("/api/atproto/signin");
  }, []);

  const signOut = useCallback(async () => {
    if (import.meta.env.DEV) localStorage.removeItem(MOCK_KEY);
    await fetch(apiUrl("/api/atproto/signout"), {
      method: "POST",
      credentials: "include",
    });
    setSession(null);
  }, []);

  return { session, loading, signIn, signOut };
}

/** Dev-only: set a fake session so merchant routes work without OAuth. */
export function setMockAtpSessionForDev(s: AtpSession | null): void {
  if (!import.meta.env.DEV) return;
  if (s) localStorage.setItem(MOCK_KEY, JSON.stringify(s));
  else localStorage.removeItem(MOCK_KEY);
  window.location.reload();
}
