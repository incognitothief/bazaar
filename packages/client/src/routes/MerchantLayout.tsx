import { useEffect } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAtpSession } from "@/hooks/useAtpSession";
import { cn } from "@/lib/utils";
import { getAuthRole } from "@/lib/auth";

const nav = [
  { to: "/merchant/dashboard", label: "Dashboard" },
  { to: "/merchant/upload/digital", label: "Upload track" },
  {
    to: "/merchant/upload/digital?class=album",
    label: "Upload collection",
  },
  { to: "/merchant/listings", label: "Listings" },
  { to: "/merchant/license", label: "License templates" },
  { to: "/merchant/settings", label: "Settings" },
];

export function MerchantLayout() {
  const { session, loading, signOut } = useAtpSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) {
      navigate("/?login=required", { replace: true });
    }
    if (!loading && session) {
      const role = getAuthRole(session.did);
      if (role !== "merchant") {
        navigate("/dashboard", { replace: true });
      }
    }
  }, [loading, session, navigate]);

  if (loading) {
    return (
      <div className="p-8 text-center text-muted-foreground">Loading…</div>
    );
  }

  if (!session) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Redirecting…
      </div>
    );
  }

  if (getAuthRole(session.did) !== "merchant") {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Redirecting…
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-border bg-card p-4 flex flex-col gap-6">
        <Link to="/" className="font-semibold">
          bazaar
        </Link>
        <nav className="flex flex-col gap-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                  isActive && "bg-muted font-medium",
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          className="mt-auto text-left text-sm text-muted-foreground hover:text-foreground"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </aside>
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
