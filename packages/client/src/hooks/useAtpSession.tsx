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
import { browserApiUrl } from "@/lib/browserApi";
import { resolveDidForHandle } from "@/lib/atproto/pdsResolve";
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

function merchantDid(): string {
  const d = import.meta.env.VITE_MERCHANT_DID?.trim() ?? "";
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
      if (!merchantDid()) {
        throw new Error(
          "Mock sign-in needs VITE_MERCHANT_DID set to your store owner did:…",
        );
      }
      // Protocol-level resolution (DNS TXT / well-known, bidirectionally verified)
      // via the server's generic resolver — not a fixed AppView's resolveHandle.
      const did = await resolveDidForHandle(h);
      if (!did) {
        throw new Error(
          `Could not resolve handle "${h}" — check that its DNS TXT record or ` +
            "/.well-known/atproto-did is set up and matches this handle.",
        );
      }
      localStorage.setItem(MOCK_KEY, JSON.stringify({ did, handle: h }));
      window.location.assign(postSignInDestination(did));
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
    // purchase.receipt). Defaults to the narrower buyer scope
    // when ambiguous — the real DID/role isn't known until after OAuth completes.
    const role = (back ?? window.location.pathname).startsWith("/merchant/")
      ? "merchant"
      : "buyer";
    qs.set("role", role);
    // Always same-origin (Vite /api proxy in dev, Bun static in prod). An absolute
    // cross-origin base here used to throw on a stale trycloudflare host and surface
    // as "Could not reach your PDS".
    const url = browserApiUrl(`/api/atproto/signin?${qs.toString()}`);

    // The success path here is a redirect to the user's PDS — a real top-level
    // navigation, not something `fetch` can complete (it needs the browser's own
    // cookie jar and address bar). But navigating straight there with
    // `window.location.href` means any server-side failure (bad handle, PDS
    // discovery error) dumps the user on a bare error page outside the SPA. So:
    // preflight with `redirect: "manual"` to distinguish "this would have
    // redirected" (opaque response, can't read where — don't need to) from "this
    // is a real error we can read and show inline" before committing to the
    // navigation. Costs one extra /signin call (a second, unused OAuth authorize
    // request the PDS will let expire) in exchange for never losing the user to
    // a blank error page.
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", credentials: "include" });
    } catch {
      throw new Error(
        "Could not reach the Bazaar API to start sign-in. Open the cloudflared URL (Vite must be on :5173) and try again.",
      );
    }
    if (res.type !== "opaqueredirect" && !res.ok) {
      const text = (await res.text().catch(() => "")).trim();
      throw new Error(text || `Sign-in failed (${res.status}).`);
    }
    window.location.href = url;
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

