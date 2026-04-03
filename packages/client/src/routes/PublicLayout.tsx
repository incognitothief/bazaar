import { Link, Outlet } from "react-router-dom";
import { useAtpSession } from "@/hooks/useAtpSession";
import { apiUrl } from "@/lib/apiUrl";

function MerchantHeaderLink() {
  const { session, loading } = useAtpSession();
  if (loading) {
    return (
      <span className="text-sm text-muted-foreground tabular-nums">…</span>
    );
  }
  if (session) {
    return (
      <Link
        to="/merchant/dashboard"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        Merchant dashboard
      </Link>
    );
  }
  return (
    <a
      href={apiUrl("/api/atproto/signin")}
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      Merchant sign in
    </a>
  );
}

export function PublicLayout() {
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
            <MerchantHeaderLink />
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-border py-6 text-center text-sm text-muted-foreground">
        <p>
          bazaar ·{" "}
          <Link to="/merchant/dashboard" className="underline underline-offset-2">
            Artist dashboard
          </Link>
        </p>
      </footer>
    </div>
  );
}
