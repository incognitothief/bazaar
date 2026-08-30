import { useEffect, useState } from "react";
import { ChevronDown, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { MerchantKeySyncBanner } from "@/components/merchant/MerchantKeySyncBanner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAtpSession } from "@/hooks/useAtpSession";
import { cn } from "@/lib/utils";
import { getAuthRole } from "@/lib/auth";

const SIDEBAR_COLLAPSED_KEY = "bazaar_merchant_sidebar_collapsed";

function isMerchantInventorySection(path: string): boolean {
  return (
    path.startsWith("/merchant/upload") ||
    path.startsWith("/merchant/inventory")
  );
}

const mainNav: { to: string; label: string }[] = [
  { to: "/merchant/listings", label: "Listings" },
  { to: "/merchant/license", label: "Licenses" },
  { to: "/merchant/settings", label: "Settings" },
];

function MerchantNavPanel({
  inventoryOpen,
  setInventoryOpen,
  onNavigate,
  signOut,
  sheetVariant,
  onCollapse,
}: {
  inventoryOpen: boolean;
  setInventoryOpen: (v: boolean | ((b: boolean) => boolean)) => void;
  onNavigate?: () => void;
  signOut: () => void | Promise<void>;
  /** Extra top padding so nav clears the sheet close control. */
  sheetVariant?: boolean;
  /** Desktop only — omit to hide the collapse control (e.g. inside the mobile sheet). */
  onCollapse?: () => void;
}) {
  const location = useLocation();
  const navCls = ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-md px-2 py-1.5 text-sm hover:bg-muted",
      isActive && "bg-muted font-medium",
    );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 p-4",
        sheetVariant && "pt-14",
      )}
    >
      <div className="flex shrink-0 items-center justify-between">
        <Link to="/" className="font-semibold" onClick={onNavigate}>
          bazaar
        </Link>
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse navigation"
            title="Collapse navigation (⌘B)"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PanelLeftClose className="size-4" />
          </button>
        ) : null}
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

        <div className="shrink-0 rounded-md">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left"
            onClick={() => setInventoryOpen((o) => !o)}
            aria-expanded={inventoryOpen}
          >
            <span className="font-medium">Inventory</span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                inventoryOpen && "rotate-180",
              )}
            />
          </button>
          {inventoryOpen ? (
            <div className="mt-1 flex flex-col gap-0.5 border-l border-border ml-2 pl-2">
              <Link
                to="/merchant/inventory"
                className={cn(
                  "rounded-md px-2 py-1.5 text-sm hover:bg-muted block",
                  location.pathname.startsWith("/merchant/inventory") &&
                    "bg-muted font-medium",
                )}
                onClick={onNavigate}
              >
                All items
              </Link>
              <Link
                to="/merchant/upload/tracks"
                className={cn(
                  "rounded-md px-2 py-1.5 text-sm hover:bg-muted block",
                  location.pathname === "/merchant/upload/tracks" &&
                    "bg-muted font-medium",
                )}
                onClick={onNavigate}
              >
                Upload tracks
              </Link>
            </div>
          ) : null}
        </div>

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
  const location = useLocation();
  const [inventoryOpen, setInventoryOpen] = useState(() =>
    isMerchantInventorySection(location.pathname),
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true",
  );

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "b") return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setSidebarCollapsed((c) => !c);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (isMerchantInventorySection(location.pathname)) {
      setInventoryOpen(true);
    }
  }, [location.pathname]);

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
    <div className="flex min-h-dvh flex-col bg-background md:h-dvh md:flex-row md:overflow-hidden">
      <header className="fixed top-0 left-0 right-0 z-40 flex shrink-0 items-center justify-between border-b border-border bg-card/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-[0_2px_14px_-6px_rgba(0,0,0,0.07)] backdrop-blur-sm supports-[backdrop-filter]:bg-card/80 md:hidden">
        <Link to="/" className="font-semibold">
          bazaar
        </Link>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Open navigation menu"
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu className="size-5" />
        </Button>
      </header>

      {sidebarCollapsed ? (
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          aria-label="Expand navigation"
          title="Expand navigation (⌘B)"
          className="fixed left-4 top-4 z-30 hidden items-center justify-center rounded-md border border-border bg-card p-2 text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground md:flex"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      ) : (
        <aside className="hidden min-h-0 w-56 shrink-0 flex-col border-r border-border bg-card md:flex">
          <MerchantNavPanel
            inventoryOpen={inventoryOpen}
            setInventoryOpen={setInventoryOpen}
            signOut={signOut}
            onCollapse={() => setSidebarCollapsed(true)}
          />
        </aside>
      )}

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          showCloseButton
          className="flex w-[min(100%,18rem)] flex-col gap-0 overflow-hidden p-0"
        >
          <MerchantNavPanel
            sheetVariant
            inventoryOpen={inventoryOpen}
            setInventoryOpen={setInventoryOpen}
            onNavigate={() => setMobileNavOpen(false)}
            signOut={signOut}
          />
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 w-full flex-col px-4 pb-4 pt-[calc(4.25rem+env(safe-area-inset-top))] sm:px-6 sm:pb-6 sm:pt-[calc(4.25rem+env(safe-area-inset-top))] md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-y-none md:p-8 md:pt-8">
        <div className="mx-auto w-full min-w-0 max-w-6xl md:flex-1">
          <MerchantKeySyncBanner />
          <Outlet />
        </div>
      </main>
    </div>
  );
}
