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
    <div className="flex min-h-dvh flex-col">
      <header className="fixed top-0 left-0 right-0 z-40 border-b border-border bg-card/95 pt-[env(safe-area-inset-top)] shadow-[0_2px_14px_-6px_rgba(0,0,0,0.07)] backdrop-blur-sm supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-[4.25rem] max-w-6xl items-center justify-between gap-4 px-4">
          <Link
            to="/"
            className="shrink-0 text-lg font-semibold tracking-tight"
          >
            bazaar
          </Link>
          <nav className="flex min-w-0 shrink items-center justify-end">
            <PublicHeaderAccount />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl grow px-4 pb-8 pt-[calc(4.25rem+env(safe-area-inset-top)+2rem)]">
        <Outlet />
      </main>
      <footer className="shrink-0 border-t border-border py-6 text-center text-sm text-muted-foreground">
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <span>bazaar</span>
          <span aria-hidden>·</span>
          <Link
            to="/terms"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Terms
          </Link>
          <span aria-hidden>·</span>
          <Link
            to="/refunds"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Refunds
          </Link>
          <span aria-hidden>·</span>
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
