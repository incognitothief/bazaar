import { useEffect, useState } from "react";
import { ChevronDown, Menu } from "lucide-react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAtpSession } from "@/hooks/useAtpSession";
import { cn } from "@/lib/utils";
import { getAuthRole } from "@/lib/auth";

const mainNav: { to: string; label: string }[] = [
  { to: "/merchant/listings", label: "Listings" },
  { to: "/merchant/license", label: "License templates" },
  { to: "/merchant/settings", label: "Settings" },
];

const inventoryLinks: { to: string; label: string; albumMode: boolean }[] = [
  { to: "/merchant/upload/digital", label: "Upload track", albumMode: false },
  {
    to: "/merchant/upload/digital?class=album",
    label: "Upload collection",
    albumMode: true,
  },
];

const salesLinks: { to: string; label: string }[] = [
  { to: "/merchant/transactions", label: "Payment activity" },
];

function UploadDigitalNavLink({
  to,
  label,
  albumMode,
  onNavigate,
}: {
  to: string;
  label: string;
  albumMode: boolean;
  onNavigate?: () => void;
}) {
  const loc = useLocation();
  const onUpload = loc.pathname === "/merchant/upload/digital";
  const classParam = new URLSearchParams(loc.search).get("class");
  const isAlbum = classParam === "album";
  const isActive = onUpload && (albumMode ? isAlbum : !isAlbum);

  return (
    <Link
      to={to}
      className={cn(
        "rounded-md px-2 py-1.5 text-sm hover:bg-muted block",
        isActive && "bg-muted font-medium",
      )}
      onClick={onNavigate}
    >
      {label}
    </Link>
  );
}

function MerchantNavPanel({
  inventoryOpen,
  setInventoryOpen,
  salesOpen,
  setSalesOpen,
  onNavigate,
  signOut,
  sheetVariant,
}: {
  inventoryOpen: boolean;
  setInventoryOpen: (v: boolean | ((b: boolean) => boolean)) => void;
  salesOpen: boolean;
  setSalesOpen: (v: boolean | ((b: boolean) => boolean)) => void;
  onNavigate?: () => void;
  signOut: () => void | Promise<void>;
  /** Extra top padding so nav clears the sheet close control. */
  sheetVariant?: boolean;
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
      <Link to="/" className="shrink-0 font-semibold" onClick={onNavigate}>
        bazaar
      </Link>
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain">
        <NavLink
          to="/merchant/dashboard"
          className={navCls}
          onClick={onNavigate}
        >
          Dashboard
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
              {inventoryLinks.map((l) => (
                <UploadDigitalNavLink
                  key={l.to}
                  to={l.to}
                  label={l.label}
                  albumMode={l.albumMode}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="shrink-0 rounded-md">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left"
            onClick={() => setSalesOpen((o) => !o)}
            aria-expanded={salesOpen}
          >
            <span className="font-medium">Sales</span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                salesOpen && "rotate-180",
              )}
            />
          </button>
          {salesOpen ? (
            <div className="mt-1 flex flex-col gap-0.5 border-l border-border ml-2 pl-2">
              {salesLinks.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-sm hover:bg-muted block",
                    location.pathname === l.to && "bg-muted font-medium",
                  )}
                  onClick={onNavigate}
                >
                  {l.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        {mainNav.map((n) => (
          <NavLink key={n.to} to={n.to} className={navCls} onClick={onNavigate}>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="shrink-0 border-t border-border pt-3">
        <button
          type="button"
          className="w-full text-left text-sm text-muted-foreground hover:text-foreground"
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
  const inventoryPathPrefix = "/merchant/upload";
  const salesPathPrefix = "/merchant/transactions";
  const [inventoryOpen, setInventoryOpen] = useState(() =>
    location.pathname.startsWith(inventoryPathPrefix),
  );
  const [salesOpen, setSalesOpen] = useState(() =>
    location.pathname.startsWith(salesPathPrefix),
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (location.pathname.startsWith(inventoryPathPrefix)) {
      setInventoryOpen(true);
    }
  }, [location.pathname, inventoryPathPrefix]);

  useEffect(() => {
    if (location.pathname.startsWith(salesPathPrefix)) {
      setSalesOpen(true);
    }
  }, [location.pathname, salesPathPrefix]);

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

      <aside className="hidden min-h-0 w-56 shrink-0 flex-col border-r border-border bg-card md:flex">
        <MerchantNavPanel
          inventoryOpen={inventoryOpen}
          setInventoryOpen={setInventoryOpen}
          salesOpen={salesOpen}
          setSalesOpen={setSalesOpen}
          signOut={signOut}
        />
      </aside>

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
            salesOpen={salesOpen}
            setSalesOpen={setSalesOpen}
            onNavigate={() => setMobileNavOpen(false)}
            signOut={signOut}
          />
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 w-full flex-col px-4 pb-4 pt-[calc(4.25rem+env(safe-area-inset-top))] sm:px-6 sm:pb-6 sm:pt-[calc(4.25rem+env(safe-area-inset-top))] md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-y-none md:p-8 md:pt-8">
        <div className="mx-auto w-full min-w-0 max-w-6xl md:flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
