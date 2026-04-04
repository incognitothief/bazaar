import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CompletenessIndicator } from "@/components/merchant/CompletenessIndicator";
import {
  MerchantStripeConnectPanel,
  type MerchantStripeSettings,
} from "@/components/merchant/MerchantStripeConnectPanel";
import { OnboardingChecklist } from "@/components/merchant/OnboardingChecklist";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import { browserApiUrl } from "@/lib/browserApi";
import {
  listDigitalItemRows,
  listLicenseTerms,
  listListingRows,
} from "@/lib/atproto/records";
import { scoreCompleteness } from "@/hooks/useCompletenessScore";
import {
  scrollStripeConnectPanelIntoView,
  STRIPE_CONNECT_PANEL_ID,
} from "@/lib/stripeConnectScroll";
import type { DigitalItem } from "@/types/lexicons";

const STRIPE_HASH = `#${STRIPE_CONNECT_PANEL_ID}`;

export function DashboardPage() {
  const location = useLocation();
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);
  const [items, setItems] = useState<
    { uri: string; item: DigitalItem }[]
  >([]);
  const [listingCount, setListingCount] = useState(0);
  const [stripeConnected, setStripeConnected] = useState(false);
  const [stripeSettings, setStripeSettings] = useState<MerchantStripeSettings | null>(null);
  const [stripeLoading, setStripeLoading] = useState(true);
  const [stripeSettingsError, setStripeSettingsError] = useState<string | null>(null);
  const [hasLicense, setHasLicense] = useState(false);

  const loadStripeState = useCallback(async () => {
    setStripeLoading(true);
    setStripeSettingsError(null);
    try {
      const [statusRes, settingsRes] = await Promise.all([
        fetch(browserApiUrl("/api/stripe/account-status"), { credentials: "include" }),
        fetch(browserApiUrl("/api/merchant/stripe-settings"), { credentials: "include" }),
      ]);
      if (statusRes.ok) {
        const j = (await statusRes.json()) as { connected?: boolean };
        setStripeConnected(!!j.connected);
      } else {
        setStripeConnected(false);
      }
      if (settingsRes.ok) {
        setStripeSettings((await settingsRes.json()) as MerchantStripeSettings);
      } else {
        setStripeSettings(null);
        const j = (await settingsRes.json().catch(() => null)) as
          | { error?: string; detail?: string }
          | null;
        const parts = [j?.error, j?.detail].filter(
          (x): x is string => typeof x === "string" && x.length > 0,
        );
        setStripeSettingsError(
          parts.join(": ") ||
            (settingsRes.status === 401
              ? "Sign in as the configured store owner to manage Stripe keys."
              : `Could not load Stripe settings (HTTP ${settingsRes.status}).`),
        );
      }
    } catch {
      setStripeConnected(false);
      setStripeSettings(null);
      setStripeSettingsError("Could not load Stripe settings.");
    } finally {
      setStripeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStripeState();
  }, [loadStripeState]);

  /**
   * Full reload: hash is in URL before React mounts. Client `<Link>`: React Router may restore
   * scroll after hash-only navigation — use layout effect + shared scroll helper (also used on link click).
   */
  useLayoutEffect(() => {
    if (!session || !agent) return;
    if (location.hash !== STRIPE_HASH) return;
    scrollStripeConnectPanelIntoView();
  }, [session, agent, location.hash, stripeLoading]);

  useEffect(() => {
    if (!agent || !session) return;
    void (async () => {
      const [rows, listings, licenses] = await Promise.all([
        listDigitalItemRows(agent, session.did),
        listListingRows(agent, session.did),
        listLicenseTerms(agent, session.did),
      ]);
      setItems(rows.map((r) => ({ uri: r.uri, item: r.item })));
      setListingCount(listings.filter((l) => l.listing.status === "active").length);
      setHasLicense(licenses.length > 0);
    })();
  }, [agent, session]);

  if (!session || !agent) return null;

  return (
    <div className="w-full min-w-0">
      <h1 className="text-2xl font-semibold mb-6">Dashboard</h1>
      <OnboardingChecklist
        session={session}
        stripeConnected={stripeConnected}
        defaultLicenseSet={hasLicense}
        hasItem={items.length > 0}
      />
      <MerchantStripeConnectPanel
        settings={stripeSettings}
        loading={stripeLoading}
        loadError={stripeSettingsError}
        onUpdated={() => void loadStripeState()}
      />
      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">Items</p>
          <p className="text-2xl font-semibold">{items.length}</p>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">Active listings</p>
          <p className="text-2xl font-semibold">{listingCount}</p>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">Total sales</p>
          <p className="text-2xl font-semibold">0</p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <p className="text-lg font-medium mb-4">Upload your first release</p>
          <Link
            to="/merchant/upload/digital"
            className={cn(buttonVariants())}
          >
            Start upload
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left p-3 font-medium">Title</th>
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-left p-3 font-medium">Completeness</th>
                <th className="text-right p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(({ uri, item }) => (
                <tr key={uri} className="border-b border-border last:border-0">
                  <td className="p-3 font-medium">{item.title}</td>
                  <td className="p-3 capitalize">{item.itemClass}</td>
                  <td className="p-3 min-w-[140px]">
                    <CompletenessIndicator
                      compact
                      score={scoreCompleteness({
                        ...item,
                        hasAudioFile: true,
                      })}
                    />
                  </td>
                  <td className="p-3 text-right space-x-2">
                    <Link
                      to={`/item/${encodeURIComponent(uri)}`}
                      className={cn(buttonVariants({ size: "sm", variant: "outline" }), "inline-flex")}
                    >
                      View
                    </Link>
                    <Link
                      to="/merchant/listings"
                      className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "inline-flex")}
                    >
                      Listings
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
