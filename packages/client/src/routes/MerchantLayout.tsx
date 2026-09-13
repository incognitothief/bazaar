import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { StorefrontKeySyncBanner } from "@/components/merchant/StorefrontKeySyncBanner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAtpSession } from "@/hooks/useAtpSession";
import { cn } from "@/lib/utils";
import { getAuthRole } from "@/lib/auth";

const mainNav: { to: string; label: string }[] = [
  { to: "/merchant/inventory", label: "Inventory" },
  { to: "/merchant/license", label: "Licenses" },
  { to: "/merchant/settings", label: "Settings" },
];

function MerchantNavPanel({
  onNavigate,
  signOut,
}: {
  onNavigate?: () => void;
  signOut: () => void | Promise<void>;
}) {
  const navCls = ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-md px-2 py-1.5 text-sm hover:bg-muted",
      isActive && "bg-muted font-medium",
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
      {/* h-7 + pt-3 lines this up exactly with the sheet's own top-3/right-3 close button. */}
      <div className="flex h-7 shrink-0 items-center pt-3">
        {/* Text glyph-box center doesn't match its line-box center for this font, hence the manual nudge -- measured/calibrated against the sheet's close button, not a guess. */}
        <Link
          to="/"
          className="relative top-[6px] font-semibold leading-none"
          onClick={onNavigate}
        >
          bazaar
        </Link>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain">
        <NavLink
          to="/merchant/dashboard"
          className={navCls}
          onClick={onNavigate}
        >
          Dashboard
        </NavLink>

        <NavLink
          to="/merchant/transactions"
          className={navCls}
          onClick={onNavigate}
        >
          Sales
        </NavLink>

        {mainNav.map((n) => (
          <NavLink key={n.to} to={n.to} className={navCls} onClick={onNavigate}>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="shrink-0 space-y-2 border-t border-border pt-3">
        <Link
          to="/"
          onClick={onNavigate}
          className="block text-sm text-muted-foreground hover:text-foreground"
        >
          Back to storefront
        </Link>
        <button
          type="button"
          className="w-full text-left text-sm text-destructive hover:text-destructive/80"
          onClick={() => {
            onNavigate?.();
            void signOut();
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

export function MerchantLayout() {
  const { session, loading, signOut } = useAtpSession();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [desktopNavOpen, setDesktopNavOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setDesktopNavOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!loading && !session) {
      navigate("/", { replace: true });
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
      <div className="p-8 text-center text-muted-foreground">
        Pulling data from pds...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-8 text-center text-muted-foreground">Redirecting…</div>
    );
  }

  if (getAuthRole(session.did) !== "merchant") {
    return (
      <div className="p-8 text-center text-muted-foreground">Redirecting…</div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="fixed top-0 left-0 right-0 z-40 flex shrink-0 items-center justify-between border-b border-border bg-card/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-[0_2px_14px_-6px_rgba(0,0,0,0.07)] backdrop-blur-sm supports-[backdrop-filter]:bg-card/80">
        <Link to="/" className="font-semibold">
          bazaar
        </Link>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Open navigation menu"
          onClick={() => setMobileNavOpen(true)}
          className="md:hidden"
        >
          <Menu className="size-5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Open navigation menu"
          onClick={() => setDesktopNavOpen(true)}
          className="hidden md:inline-flex"
        >
          <Menu className="size-5" />
        </Button>
      </header>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          showCloseButton
          overlayClassName="bg-black/50"
          className="flex w-[min(100%,18rem)] flex-col gap-0 overflow-hidden p-0"
        >
          <MerchantNavPanel
            onNavigate={() => setMobileNavOpen(false)}
            signOut={signOut}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={desktopNavOpen} onOpenChange={setDesktopNavOpen}>
        <SheetContent
          side="right"
          showCloseButton
          overlayClassName="bg-black/50"
          className="flex w-[min(100%,18rem)] flex-col gap-0 overflow-hidden p-0"
        >
          <MerchantNavPanel
            onNavigate={() => setDesktopNavOpen(false)}
            signOut={signOut}
          />
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 w-full flex-col px-4 pb-4 pt-[calc(4.25rem+env(safe-area-inset-top))] sm:px-6 sm:pb-6 md:px-8 md:pb-8">
        <div className="mx-auto w-full min-w-0 max-w-6xl">
          <StorefrontKeySyncBanner />
          <Outlet />
        </div>
      </main>
    </div>
  );
}
