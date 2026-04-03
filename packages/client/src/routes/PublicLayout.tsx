import { useEffect } from "react";
import { Link, Outlet, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PublicHeaderAccount } from "@/components/public/PublicHeaderAccount";

const SOURCE_CODE_HREF = "https://github.com/incognitothief/bazaar";

export function PublicLayout() {
  const [search] = useSearchParams();

  useEffect(() => {
    if (search.get("login") === "required") {
      toast.message("Sign in required", {
        description:
          "Connect your ATProto account to access the dashboard and receipt validation.",
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
          <nav className="flex items-center">
            <PublicHeaderAccount />
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-border py-6 text-center text-sm text-muted-foreground">
        <p>
          bazaar ·{" "}
          <a
            href={SOURCE_CODE_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Source Code
          </a>
        </p>
      </footer>
    </div>
  );
}
