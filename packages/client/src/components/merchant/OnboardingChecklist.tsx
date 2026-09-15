import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AtpSession } from "@/hooks/useAtpSession";
import {
  scrollStripeConnectPanelIntoView,
  STRIPE_CONNECT_PANEL_ID,
} from "@/lib/stripeConnectScroll";
import { merchantSignInUrl } from "@/lib/signInReturn";
import { cn } from "@/lib/utils";

export type OnboardingItem = {
  id: string;
  label: string;
  description: string;
  complete: boolean;
  action: { label: string; href: string };
  blocking: boolean;
};

export function OnboardingChecklist({
  session,
  stripeConnected,
  defaultLicenseSet,
  hasItem,
}: {
  session: AtpSession | null;
  stripeConnected: boolean;
  defaultLicenseSet: boolean;
  hasItem: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const { pathname, search } = useLocation();
  const signInHref = merchantSignInUrl(pathname, search);

  const items: OnboardingItem[] = [
    {
      id: "atproto",
      label: "Connect ATProto account",
      description: "Required to publish your catalog to the decentralized web.",
      complete: !!session,
      blocking: true,
      action: {
        label: "Connect",
        href: signInHref,
      },
    },
    {
      id: "stripe",
      label: "Connect Stripe account",
      description:
        "Add your Stripe secret key and webhook signing secret in Settings (or set them in server environment).",
      complete: stripeConnected,
      blocking: true,
      action: {
        label: "Set up Stripe",
        href: `/merchant/settings#${STRIPE_CONNECT_PANEL_ID}`,
      },
    },
    {
      id: "license",
      label: "Set a default license",
      description:
        "Choose how buyers may use your music. You can always customize per item.",
      complete: defaultLicenseSet,
      blocking: false,
      action: { label: "Set license", href: "/merchant/license" },
    },
    {
      id: "first_item",
      label: "Upload your first item",
      description: "Add a track or collection to your storefront.",
      complete: hasItem,
      blocking: false,
      action: { label: "Upload", href: "/merchant/inventory/new" },
    },
  ];

  const blockingDone = items.filter((i) => i.blocking).every((i) => i.complete);
  const allDone = items.every((i) => i.complete);

  if (dismissed || allDone) return null;

  const lockAfter = items.findIndex((i) => i.blocking && !i.complete);

  return (
    <Card className="mb-8">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Getting started</CardTitle>
        {blockingDone ? (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setDismissed(true)}
          >
            Dismiss
          </button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {items.map((item, idx) => {
          const isLocked = lockAfter >= 0 && idx > lockAfter;
          return (
            <div
              key={item.id}
              className={cn(
                "flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4 last:border-0 last:pb-0",
                isLocked && "opacity-50 pointer-events-none",
              )}
            >
              <div>
                <p className="font-medium">{item.label}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {item.description}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-xs font-medium",
                    item.complete ? "text-emerald-600" : "text-muted-foreground",
                  )}
                >
                  {item.complete ? "Done" : "To do"}
                </span>
                {item.complete ? null : item.action.href.startsWith("/") ? (
                  <Link
                    to={item.action.href}
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                    preventScrollReset={item.action.href.includes(
                      `#${STRIPE_CONNECT_PANEL_ID}`,
                    )}
                    onClick={
                      item.action.href.includes(`#${STRIPE_CONNECT_PANEL_ID}`)
                        ? () => scrollStripeConnectPanelIntoView()
                        : undefined
                    }
                  >
                    {item.action.label}
                  </Link>
                ) : (
                  <a
                    href={item.action.href}
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {item.action.label}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
