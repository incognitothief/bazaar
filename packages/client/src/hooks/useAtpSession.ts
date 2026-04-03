import { useCallback, useEffect, useState } from "react";
import { getAuthRole } from "@/lib/auth";
import { createPublicAgent } from "@/lib/atproto/session";
import { safeReturnPath } from "@/lib/signInReturn";

export type AtpSession = {
  did: string;
  handle: string;
};

const MOCK_KEY = "bazaar_mock_atp_session";

function devMockSignInEnabled(): boolean {
  return (
    import.meta.env.DEV &&
    import.meta.env.VITE_DEV_MOCK_ATPROTO_SIGNIN === "true"
  );
}

function artistDid(): string {
  const d = import.meta.env.VITE_ARTIST_DID?.trim() ?? "";
  return d.startsWith("did:") ? d : "";
}

function apiOrigin(): string {
  const raw = (import.meta.env.VITE_API_ORIGIN ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  // Be forgiving in production if env is set as "example.com" without protocol.
  return `https://${raw}`;
}

function postSignInDestination(did: string): string {
  const params = new URLSearchParams(window.location.search);
  const ret = safeReturnPath(params.get("returnTo"));
  if (ret) return ret;
  return getAuthRole(did) === "merchant" ? "/merchant/dashboard" : "/dashboard";
}

export function useAtpSession(): {
  session: AtpSession | null;
  loading: boolean;
  signIn: (handle: string) => Promise<void>;
  signOut: () => Promise<void>;
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
          if (parsed?.did) {
            setSession(parsed);
            setLoading(false);
            return;
          }
        }
      }
      const origin = apiOrigin();
      if (!origin) {
        setSession(null);
        return;
      }
      const res = await fetch(`${origin}/api/atproto/session`, {
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

  const signIn = useCallback(async (handle: string) => {
    const h = handle.trim();
    if (!h) return;

    if (devMockSignInEnabled()) {
      if (!artistDid()) {
        window.alert(
          "Mock sign-in needs VITE_ARTIST_DID set to your store owner did:…",
        );
        return;
      }
      try {
        const agent = createPublicAgent();
        const { data } = await agent.com.atproto.identity.resolveHandle({
          handle: h,
        });
        const did = data.did;
        if (!did) {
          window.alert("Handle resolved but no DID was returned.");
          return;
        }
        localStorage.setItem(MOCK_KEY, JSON.stringify({ did, handle: h }));
        window.location.assign(postSignInDestination(did));
      } catch (e) {
        window.alert(
          `Could not resolve handle (check the handle and VITE_ATPROTO_SERVICE): ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
      return;
    }

    const origin = apiOrigin();
    if (!origin) {
      window.alert("Set VITE_API_ORIGIN to your API server URL.");
      return;
    }
    const qs = new URLSearchParams({ handle: h });
    const back = safeReturnPath(
      new URLSearchParams(window.location.search).get("returnTo"),
    );
    if (back) qs.set("returnTo", back);
    window.location.href = `${origin}/api/atproto/signin?${qs.toString()}`;
  }, []);

  const signOut = useCallback(async () => {
    if (import.meta.env.DEV) localStorage.removeItem(MOCK_KEY);
    const origin = apiOrigin();
    if (origin) {
      await fetch(`${origin}/api/atproto/signout`, {
        method: "POST",
        credentials: "include",
      });
    }
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
