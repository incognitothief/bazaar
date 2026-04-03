import { useCallback, useEffect, useState } from "react";

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

/** DID used for mock merchant session; must match VITE_ARTIST_DID / VITE_APP_DID for getAuthRole. */
function resolveDevMockMerchantDid(): string {
  const explicit = import.meta.env.VITE_DEV_MOCK_MERCHANT_DID?.trim();
  if (explicit?.startsWith("did:")) return explicit;
  const artist = import.meta.env.VITE_ARTIST_DID?.trim();
  if (artist?.startsWith("did:")) return artist;
  const app = import.meta.env.VITE_APP_DID?.trim();
  if (app?.startsWith("did:")) return app;
  return "";
}

function apiOrigin(): string {
  const raw = (import.meta.env.VITE_API_ORIGIN ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  // Be forgiving in production if env is set as "example.com" without protocol.
  return `https://${raw}`;
}

export function useAtpSession(): {
  session: AtpSession | null;
  loading: boolean;
  signIn: (handle: string) => void;
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

  // handle is passed so the server can discover the correct PDS via ATProto identity resolution
  const signIn = useCallback((handle: string) => {
    const h = handle.trim();
    if (!h) return;

    if (devMockSignInEnabled()) {
      const did = resolveDevMockMerchantDid();
      if (!did) {
        window.alert(
          "Mock sign-in needs a merchant DID: set VITE_ARTIST_DID (or VITE_DEV_MOCK_MERCHANT_DID) to a did:… value that matches your store.",
        );
        return;
      }
      localStorage.setItem(MOCK_KEY, JSON.stringify({ did, handle: h }));
      window.location.assign("/merchant/dashboard");
      return;
    }

    const origin = apiOrigin();
    if (!origin) {
      window.alert("Set VITE_API_ORIGIN to your API server URL.");
      return;
    }
    window.location.href = `${origin}/api/atproto/signin?handle=${encodeURIComponent(h)}`;
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
