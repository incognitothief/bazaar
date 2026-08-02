import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getAuthRole } from "@/lib/auth";
import { apiServerOrigin, browserApiUrl } from "@/lib/browserApi";
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

function postSignInDestination(did: string): string {
  const params = new URLSearchParams(window.location.search);
  const ret = safeReturnPath(params.get("returnTo"));
  if (ret) return ret;
  return getAuthRole(did) === "merchant" ? "/merchant/dashboard" : "/dashboard";
}

type AtpSessionContextValue = {
  session: AtpSession | null;
  loading: boolean;
  signIn: (handle: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AtpSessionContext = createContext<AtpSessionContextValue | null>(null);

export function AtpSessionProvider({ children }: { children: ReactNode }) {
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
      const res = await fetch(browserApiUrl("/api/atproto/session"), {
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

    const origin = apiServerOrigin();
    if (!origin) {
      window.alert("Set VITE_API_ORIGIN to your API server URL.");
      return;
    }
    const qs = new URLSearchParams({ handle: h });
    const back = safeReturnPath(
      new URLSearchParams(window.location.search).get("returnTo"),
    );
    if (back) qs.set("returnTo", back);
    // Least-privilege OAuth scope: infer buyer vs. merchant from where this
    // sign-in will land. A destination under /merchant/ is the merchant's own
    // dashboard flow (needs full catalog/listing/license/profile write scopes);
    // anything else is a buyer completing a purchase (only ever needs
    // purchase.receipt/purchase.consent). Defaults to the narrower buyer scope
    // when ambiguous — the real DID/role isn't known until after OAuth completes.
    const role = (back ?? window.location.pathname).startsWith("/merchant/")
      ? "merchant"
      : "buyer";
    qs.set("role", role);
    window.location.href = `${origin}/api/atproto/signin?${qs.toString()}`;
  }, []);

  const signOut = useCallback(async () => {
    if (import.meta.env.DEV) localStorage.removeItem(MOCK_KEY);
    setSession(null);
    try {
      await fetch(browserApiUrl("/api/atproto/signout"), {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Local session is already cleared; server cookie may persist until refresh.
    }
  }, []);

  const value = useMemo(
    () => ({
      session,
      loading,
      signIn,
      signOut,
    }),
    [session, loading, signIn, signOut],
  );

  return (
    <AtpSessionContext.Provider value={value}>
      {children}
    </AtpSessionContext.Provider>
  );
}

export function useAtpSession(): AtpSessionContextValue {
  const ctx = useContext(AtpSessionContext);
  if (!ctx) {
    throw new Error("useAtpSession must be used within AtpSessionProvider");
  }
  return ctx;
}

/** Dev-only: set a fake session so merchant routes work without OAuth. */
export function setMockAtpSessionForDev(s: AtpSession | null): void {
  if (!import.meta.env.DEV) return;
  if (s) localStorage.setItem(MOCK_KEY, JSON.stringify(s));
  else localStorage.removeItem(MOCK_KEY);
  window.location.reload();
}
