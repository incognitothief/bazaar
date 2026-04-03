import { useEffect } from "react";
import { Link, Outlet, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAtpSession } from "@/hooks/useAtpSession";
import { getAuthRole } from "@/lib/auth";

export function PublicLayout() {
  const [search] = useSearchParams();
  const { session, loading } = useAtpSession();

  useEffect(() => {
    if (search.get("login") === "required") {
      toast.message("Sign in required", {
        description:
          "Connect your ATProto account to access the dashboard and receipt validation.",
      });
    }
  }, [search]);

  const headerLink =
    !loading && session
      ? getAuthRole(session.did) === "merchant"
        ? { to: "/merchant/dashboard", label: "Merchant Dashboard" }
        : { to: "/dashboard", label: "Dashboard" }
      : { to: "/merchant/signin", label: "Login" };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link
            to="/"
            className="text-lg font-semibold tracking-tight"
          >
            bazaar
          </Link>
          <nav>
            <Link
              to={headerLink.to}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {headerLink.label}
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-border py-6 text-center text-sm text-muted-foreground">
        <p>
          bazaar ·{" "}
          <Link
            to={
              !loading && session && getAuthRole(session.did) === "merchant"
                ? "/merchant/dashboard"
                : "/merchant/signin"
            }
            className="underline underline-offset-2"
          >
            Merchant Dashboard
          </Link>
        </p>
      </footer>
    </div>
  );
}
