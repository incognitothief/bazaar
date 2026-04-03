import { useEffect } from "react";
import { Link, Outlet, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

export function PublicLayout() {
  const [search] = useSearchParams();

  useEffect(() => {
    if (search.get("login") === "required") {
      toast.message("Sign in required", {
        description: "Connect your ATProto account to open the merchant dashboard.",
      });
    }
  }, [search]);

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
              to="/merchant/signin"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Merchant login
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
          <Link to="/merchant/signin" className="underline underline-offset-2">
            Artist dashboard
          </Link>
        </p>
      </footer>
    </div>
  );
}
