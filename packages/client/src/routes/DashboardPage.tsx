import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Boxes,
  FileText,
  Receipt,
  Settings as SettingsIcon,
} from "lucide-react";
import { OnboardingChecklist } from "@/components/merchant/OnboardingChecklist";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import { browserApiUrl } from "@/lib/browserApi";
import {
  listDigitalItemRows,
  listLicenseTerms,
  listListingRows,
} from "@/lib/atproto/records";
import type { PaymentFulfillmentRow } from "@/routes/MerchantTransactionsPage";
import type { DigitalItem } from "@/types/lexicons";

const quickActions: {
  to: string;
  label: string;
  description: string;
  icon: typeof Boxes;
}[] = [
  {
    to: "/merchant/transactions",
    label: "Sales",
    description: "Track completed orders and payouts from buyers.",
    icon: Receipt,
  },
  {
    to: "/merchant/inventory",
    label: "Inventory",
    description:
      "Publish new work, then price, list, pause, or retire it — products and items, all in one place.",
    icon: Boxes,
  },
  {
    to: "/merchant/license",
    label: "Licenses",
    description: "Define the terms buyers agree to when they check out.",
    icon: FileText,
  },
  {
    to: "/merchant/settings",
    label: "Settings",
    description: "Connect Stripe and manage your merchant account.",
    icon: SettingsIcon,
  },
];

export function DashboardPage() {
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);
  const [items, setItems] = useState<
    { uri: string; item: DigitalItem }[]
  >([]);
  const [listingCount, setListingCount] = useState(0);
  const [totalSales, setTotalSales] = useState(0);
  const [stripeConnected, setStripeConnected] = useState(false);
  const [hasLicense, setHasLicense] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(browserApiUrl("/api/stripe/account-status"), {
          credentials: "include",
        });
        if (r.ok) {
          const j = (await r.json()) as { connected?: boolean };
          setStripeConnected(!!j.connected);
        } else {
          setStripeConnected(false);
        }
      } catch {
        setStripeConnected(false);
      }
    })();
  }, []);

  // "Sale" = a completed payment fulfillment -- same definition as the Sales page's Total sales card.
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(browserApiUrl("/api/merchant/payment-fulfillments"), {
          credentials: "include",
        });
        if (!r.ok) return;
        const j = (await r.json()) as { rows?: PaymentFulfillmentRow[] };
        const rows = Array.isArray(j.rows) ? j.rows : [];
        setTotalSales(rows.filter((row) => row.status === "completed").length);
      } catch {
        setTotalSales(0);
      }
    })();
  }, []);

  useEffect(() => {
    if (!agent || !session) return;
    void (async () => {
      const [rows, listings, licenses] = await Promise.all([
        listDigitalItemRows(session.did),
        listListingRows(session.did),
        listLicenseTerms(session.did),
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
          <p className="text-2xl font-semibold">{totalSales}</p>
        </div>
      </div>
      <div>
        <h2 className="text-lg font-semibold mb-1">Quick actions</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Overview of merchant tools
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quickActions.map(({ to, label, description, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="group rounded-lg border border-border p-4 transition-colors hover:border-foreground/20 hover:bg-muted/40"
            >
              <div className="mb-3 flex size-9 items-center justify-center rounded-md bg-muted text-foreground">
                <Icon className="size-4.5" />
              </div>
              <p className="font-medium">{label}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
