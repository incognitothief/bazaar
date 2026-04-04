import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAtpSession } from "@/hooks/useAtpSession";
import { getAuthRole } from "@/lib/auth";
import { fetchBlobObjectUrl } from "@/lib/atproto/blobUrl";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import { createPublicAgent } from "@/lib/atproto/session";
import { fetchActorAvatarByActor } from "@/lib/actorTypeahead";
import type { ActorMerchant } from "@/types/lexicons";
import { merchantSignInUrl } from "@/lib/signInReturn";
import { cn } from "@/lib/utils";

export function PublicHeaderAccount() {
  const { session, loading, signOut } = useAtpSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** Bluesky CDN (or relay) URL — do not revoke. */
  const [relayAvatarUrl, setRelayAvatarUrl] = useState<string | null>(null);
  /** Bazaar repo blob — must revoke on replace/unmount. */
  const [bazaarAvatarObjectUrl, setBazaarAvatarObjectUrl] = useState<
    string | null
  >(null);

  const [relayAvatarBroken, setRelayAvatarBroken] = useState(false);

  useEffect(() => {
    setRelayAvatarBroken(false);
  }, [relayAvatarUrl]);

  useEffect(() => {
    if (!session?.did) {
      setRelayAvatarUrl(null);
      setBazaarAvatarObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    let cancelled = false;
    const ac = new AbortController();

    setRelayAvatarUrl(null);
    setBazaarAvatarObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    void fetchActorAvatarByActor(session.did, ac.signal)
      .then((url) => {
        if (cancelled || !url) return;
        setRelayAvatarUrl(url);
      })
      .catch(() => {
        if (!cancelled) setRelayAvatarUrl(null);
      });

    void (async () => {
      try {
        const agent = createPublicAgent();
        const res = await agent.com.atproto.repo.listRecords({
          repo: session.did,
          collection: BAZAAR_COLLECTION.actorMerchant,
          limit: 1,
        });
        const row = res.data.records[0];
        const v = row?.value as ActorMerchant | undefined;
        const cid = v?.avatarCid;
        if (!cid) return;
        const url = await fetchBlobObjectUrl(agent, session.did, cid);
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        if (!url) return;
        setBazaarAvatarObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch {
        if (!cancelled) {
          setBazaarAvatarObjectUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
      setRelayAvatarUrl(null);
      setBazaarAvatarObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [session?.did]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [menuOpen]);

  if (loading) {
    return (
      <div
        className="h-8 w-28 animate-pulse rounded-md bg-muted"
        aria-hidden
      />
    );
  }

  if (!session) {
    return (
      <Link
        to={merchantSignInUrl(location.pathname, location.search)}
        className="text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        Login
      </Link>
    );
  }

  const role = getAuthRole(session.did);
  const initial = session.handle?.trim()?.charAt(0)?.toUpperCase() ?? "?";

  const menuItems =
    role === "merchant"
      ? [
          {
            kind: "link" as const,
            to: "/merchant/dashboard",
            label: "Merchant dashboard",
          },
          { kind: "signout" as const, label: "Sign out" },
        ]
      : [
          { kind: "link" as const, to: "/dashboard", label: "Purchases" },
          { kind: "signout" as const, label: "Sign out" },
        ];

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        className={cn(
          "flex max-w-[min(100vw-8rem,20rem)] items-center gap-2 rounded-md px-2 py-1.5 text-sm",
          "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        {relayAvatarUrl && !relayAvatarBroken ? (
          <img
            src={relayAvatarUrl}
            alt=""
            className="size-8 shrink-0 rounded-full object-cover"
            onError={() => setRelayAvatarBroken(true)}
          />
        ) : bazaarAvatarObjectUrl ? (
          <img
            src={bazaarAvatarObjectUrl}
            alt=""
            className="size-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
            aria-hidden
          >
            {initial}
          </span>
        )}
        <span className="truncate font-medium">{session.handle}</span>
      </button>
      {menuOpen ? (
        <div
          className="absolute right-0 z-50 mt-1 min-w-[12rem] rounded-md border border-border bg-card py-1 shadow-md"
          role="menu"
        >
          {menuItems.map((item) =>
            item.kind === "link" ? (
              <Link
                key={item.to}
                to={item.to}
                role="menuitem"
                className="block px-3 py-2 text-sm hover:bg-muted"
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setMenuOpen(false);
                  void (async () => {
                    await signOut();
                    navigate("/", { replace: true });
                  })();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
