import { Link, NavLink, Outlet } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { useAtpSession } from "@/hooks/useAtpSession";
import { apiUrl } from "@/lib/apiUrl";
import { cn } from "@/lib/utils";

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

  if (loading) {
    return (
      <div className="p-8 text-center text-muted-foreground">Loading…</div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            Merchant sign in
          </h1>
          <p className="text-sm text-muted-foreground">
            Open the ATProto provider sign-in page to connect your account. You
            need a session before the dashboard can load.
          </p>
        </div>
        <a
          href={apiUrl("/api/atproto/signin")}
          className={buttonVariants({ size: "lg" })}
        >
          Continue to sign in
        </a>
        <Link
          to="/"
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Back to storefront
        </Link>
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
