import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageDropzone } from "@/components/shared/ImageDropzone";
import {
  MerchantStripeConnectPanel,
  type MerchantStripeSettings,
} from "@/components/merchant/MerchantStripeConnectPanel";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import { fetchActorAvatarByActor } from "@/lib/actorTypeahead";
import { fetchBlobObjectUrl } from "@/lib/atproto/blobUrl";
import {
  createActorMerchant,
  listListingRows,
  putActorMerchant,
  putListing,
} from "@/lib/atproto/records";
import { browserApiUrl } from "@/lib/browserApi";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import { createPublicAgent } from "@/lib/atproto/session";
import { pdslsRepoCollectionsUrl } from "@/lib/pdsls";
import {
  scrollStripeConnectPanelIntoView,
  STRIPE_CONNECT_PANEL_ID,
} from "@/lib/stripeConnectScroll";
import { cn } from "@/lib/utils";
import type { ActorMerchant, Listing } from "@/types/lexicons";
import { toast } from "sonner";

const STRIPE_HASH = `#${STRIPE_CONNECT_PANEL_ID}`;

type MerchantBusinessSettingsResponse = {
  db: {
    businessName: string | null;
    businessState: string | null;
    businessEmail: string | null;
  };
  canEditBusinessName: boolean;
  canEditBusinessState: boolean;
  canEditBusinessEmail: boolean;
};

export function SettingsPage() {
  const location = useLocation();
  const { session, signOut } = useAtpSession();
  const agent = useMerchantAgent(session);
  const [storefrontName, setStorefrontName] = useState("");
  const [description, setDescription] = useState("");
  const [profileRkey, setProfileRkey] = useState<string | null>(null);
  const [profileCid, setProfileCid] = useState<string | null>(null);
  const [profileCreatedAt, setProfileCreatedAt] = useState<string>(() =>
    new Date().toISOString(),
  );
  const [unpub, setUnpub] = useState("");
  const [stripeSettings, setStripeSettings] =
    useState<MerchantStripeSettings | null>(null);
  const [stripeLoading, setStripeLoading] = useState(true);
  const [stripeSettingsError, setStripeSettingsError] = useState<string | null>(
    null,
  );
  const [relayAvatarUrl, setRelayAvatarUrl] = useState<string | null>(null);
  const [bazaarAvatarObjectUrl, setBazaarAvatarObjectUrl] = useState<
    string | null
  >(null);
  const [relayAvatarBroken, setRelayAvatarBroken] = useState(false);
  const [bizName, setBizName] = useState("");
  const [bizState, setBizState] = useState("");
  const [bizEmail, setBizEmail] = useState("");
  const [bizCanEditName, setBizCanEditName] = useState(true);
  const [bizCanEditState, setBizCanEditState] = useState(true);
  const [bizCanEditEmail, setBizCanEditEmail] = useState(true);
  const [bizLoading, setBizLoading] = useState(true);
  const [bizError, setBizError] = useState<string | null>(null);

  const loadStripeState = useCallback(async () => {
    setStripeLoading(true);
    setStripeSettingsError(null);
    try {
      const settingsRes = await fetch(
        browserApiUrl("/api/merchant/stripe-settings"),
        { credentials: "include" },
      );
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
      setStripeSettings(null);
      setStripeSettingsError("Could not load Stripe settings.");
    } finally {
      setStripeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStripeState();
  }, [loadStripeState]);

  const loadBusinessSettings = useCallback(async () => {
    setBizLoading(true);
    setBizError(null);
    try {
      const res = await fetch(browserApiUrl("/api/merchant/business-settings"), {
        credentials: "include",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string; detail?: string }
          | null;
        const parts = [j?.error, j?.detail].filter(
          (x): x is string => typeof x === "string" && x.length > 0,
        );
        setBizError(
          parts.join(": ") ||
            (res.status === 401
              ? "Sign in as the configured store owner to manage business details."
              : `Could not load business settings (HTTP ${res.status}).`),
        );
        return;
      }
      const data = (await res.json()) as MerchantBusinessSettingsResponse;
      setBizName(data.db.businessName ?? "");
      setBizState(data.db.businessState ?? "");
      setBizEmail(data.db.businessEmail ?? "");
      setBizCanEditName(data.canEditBusinessName);
      setBizCanEditState(data.canEditBusinessState);
      setBizCanEditEmail(data.canEditBusinessEmail);
    } catch {
      setBizError("Could not load business settings.");
    } finally {
      setBizLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session || !agent) return;
    void loadBusinessSettings();
  }, [session, agent, loadBusinessSettings]);

  useLayoutEffect(() => {
    if (!session || !agent) return;
    if (location.hash !== STRIPE_HASH) return;
    scrollStripeConnectPanelIntoView();
  }, [session, agent, location.hash, stripeLoading]);

  useEffect(() => {
    if (!agent || !session) return;
    void (async () => {
      const res = (await agent.com.atproto.repo.listRecords({
        repo: session.did,
        collection: BAZAAR_COLLECTION.actorMerchant,
        limit: 1,
      })) as {
        data: { records: Array<{ uri: string; cid: string; value: unknown }> };
      };
      const row = res.data.records[0];
      if (!row) return;
      setProfileRkey(row.uri.split("/").pop() ?? null);
      setProfileCid(row.cid);
      const v = row.value as ActorMerchant;
      setStorefrontName(v.displayName ?? "");
      setDescription(v.description ?? "");
      setProfileCreatedAt(v.createdAt);
    })();
  }, [agent, session]);

  useEffect(() => {
    setRelayAvatarBroken(false);
  }, [relayAvatarUrl]);

  useEffect(() => {
    if (!session?.did) {
      setRelayAvatarUrl(null);
      setBazaarAvatarObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    let cancelled = false;
    const ac = new AbortController();

    setRelayAvatarUrl(null);
    setBazaarAvatarObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    void fetchActorAvatarByActor(session.did, ac.signal)
      .then((url) => {
        if (cancelled || !url) return;
        setRelayAvatarUrl(url);
      })
      .catch(() => {
        if (!cancelled) setRelayAvatarUrl(null);
      });

    void (async () => {
      try {
        const pub = createPublicAgent();
        const res = await pub.com.atproto.repo.listRecords({
          repo: session.did,
          collection: BAZAAR_COLLECTION.actorMerchant,
          limit: 1,
        });
        const row = res.data.records[0];
        const v = row?.value as ActorMerchant | undefined;
        const cid = v?.avatarCid;
        if (!cid) return;
        const url = await fetchBlobObjectUrl(pub, session.did, cid);
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        if (!url) return;
        setBazaarAvatarObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch {
        if (!cancelled) {
          setBazaarAvatarObjectUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
      setRelayAvatarUrl(null);
      setBazaarAvatarObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [session?.did]);

  async function saveBusinessDetails() {
    try {
      const res = await fetch(browserApiUrl("/api/merchant/business-settings"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: bizName.trim() === "" ? "" : bizName.trim(),
          businessState: bizState.trim() === "" ? "" : bizState.trim(),
          businessEmail: bizEmail.trim() === "" ? "" : bizEmail.trim(),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string; detail?: string }
          | null;
        const parts = [j?.error, j?.detail].filter(
          (x): x is string => typeof x === "string" && x.length > 0,
        );
        toast.error("Could not save business details", {
          description: parts.join(": ") || `HTTP ${res.status}`,
        });
        return;
      }
      const data = (await res.json()) as MerchantBusinessSettingsResponse;
      setBizName(data.db.businessName ?? "");
      setBizState(data.db.businessState ?? "");
      setBizEmail(data.db.businessEmail ?? "");
      setBizCanEditName(data.canEditBusinessName);
      setBizCanEditState(data.canEditBusinessState);
      setBizCanEditEmail(data.canEditBusinessEmail);
      toast.success("Business details saved");
    } catch (e) {
      toast.error("Could not save business details", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  async function saveProfile() {
    if (!agent || !session) return;
    const record: ActorMerchant = {
      $type: "diamonds.whereditgo.bazaar.actor.merchant",
      displayName: storefrontName.trim() || "Storefront",
      description: description || undefined,
      createdAt: profileCreatedAt,
    };
    try {
      if (profileRkey && profileCid) {
        await putActorMerchant(agent, record, profileRkey, profileCid);
      } else {
        const created = await createActorMerchant(agent, {
          displayName: storefrontName.trim() || "Storefront",
          description: description || undefined,
        });
        setProfileRkey(created.uri.split("/").pop() ?? null);
        setProfileCid(created.cid);
      }
      toast.success("Profile saved");
    } catch (e) {
      toast.error("Could not save profile", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  async function unpublishAll() {
    if (unpub !== "UNPUBLISH") {
      toast.error("Type UNPUBLISH to confirm");
      return;
    }
    if (!agent || !session) return;
    const rows = await listListingRows(agent, session.did);
    try {
      for (const row of rows) {
        if (row.listing.status !== "active") continue;
        const next: Listing = { ...row.listing, status: "paused" };
        await putListing(agent, row.uri, next);
      }
      toast.success("All listings paused");
      setUnpub("");
    } catch {
      toast.error("Failed to unpublish some listings");
    }
  }

  if (!session || !agent) return null;

  const accountInitial =
    session.handle?.trim()?.charAt(0)?.toUpperCase() ?? "?";

  return (
    <div className="w-full min-w-0 max-w-xl space-y-12">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Merchant Profile</h2>
        <div className="space-y-2">
          <Label htmlFor="storefront-name">Storefront name</Label>
          <Input
            id="storefront-name"
            value={storefrontName}
            onChange={(e) => setStorefrontName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sd">Storefront description</Label>
          <Textarea
            id="sd"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Avatar</Label>
          <ImageDropzone
            aspectRatio="1:1"
            onFile={() =>
              toast.message(
                "Avatar upload saves CID on profile save (wire in save).",
              )
            }
            onError={(m) => toast.error(m)}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Storefront URL: {import.meta.env.VITE_APP_URL}
        </p>
        <button
          type="button"
          className={cn(buttonVariants())}
          onClick={() => void saveProfile()}
        >
          Save profile
        </button>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Business details</h2>
        <p className="text-sm text-muted-foreground">
          Shown on the public Terms and Refunds pages. Optional fields can also
          be set as{" "}
          <code className="text-xs rounded bg-muted px-1 py-0.5">
            BUSINESS_NAME
          </code>
          ,{" "}
          <code className="text-xs rounded bg-muted px-1 py-0.5">
            BUSINESS_STATE
          </code>
          , and{" "}
          <code className="text-xs rounded bg-muted px-1 py-0.5">
            BUSINESS_EMAIL
          </code>{" "}
          on the server (each overrides the value saved here).
        </p>
        {bizLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : bizError ? (
          <p className="text-sm text-destructive">{bizError}</p>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="biz-name">Business name</Label>
              <Input
                id="biz-name"
                value={bizName}
                disabled={!bizCanEditName}
                onChange={(e) => setBizName(e.target.value)}
              />
              {!bizCanEditName ? (
                <p className="text-xs text-muted-foreground">
                  Managed by <code className="text-xs">BUSINESS_NAME</code> in
                  the server environment.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="biz-state">Business state / region</Label>
              <Input
                id="biz-state"
                value={bizState}
                disabled={!bizCanEditState}
                onChange={(e) => setBizState(e.target.value)}
                placeholder="e.g. CA or California"
              />
              {!bizCanEditState ? (
                <p className="text-xs text-muted-foreground">
                  Managed by <code className="text-xs">BUSINESS_STATE</code> in
                  the server environment.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="biz-email">Business email</Label>
              <Input
                id="biz-email"
                type="email"
                autoComplete="email"
                value={bizEmail}
                disabled={!bizCanEditEmail}
                onChange={(e) => setBizEmail(e.target.value)}
              />
              {!bizCanEditEmail ? (
                <p className="text-xs text-muted-foreground">
                  Managed by <code className="text-xs">BUSINESS_EMAIL</code> in
                  the server environment.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className={cn(buttonVariants())}
              onClick={() => void saveBusinessDetails()}
            >
              Save business details
            </button>
          </>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Connections</h2>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3">
          {relayAvatarUrl && !relayAvatarBroken ? (
            <img
              src={relayAvatarUrl}
              alt=""
              className="size-12 shrink-0 rounded-full object-cover ring-1 ring-border"
              onError={() => setRelayAvatarBroken(true)}
            />
          ) : bazaarAvatarObjectUrl ? (
            <img
              src={bazaarAvatarObjectUrl}
              alt=""
              className="size-12 shrink-0 rounded-full object-cover ring-1 ring-border"
            />
          ) : (
            <span
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground ring-1 ring-border"
              aria-hidden
            >
              {accountInitial}
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">ATProto</p>
            <p className="text-sm">
              <a
                href={pdslsRepoCollectionsUrl(session.did)}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all font-mono text-xs text-primary underline-offset-2 hover:underline"
                title="Open repo in pdsls"
              >
                {session.did}
              </a>
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {session.handle}
            </p>
          </div>
        </div>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline" }))}
          onClick={() => void signOut()}
        >
          Disconnect
        </button>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Stripe</h2>
        <MerchantStripeConnectPanel
          settings={stripeSettings}
          loading={stripeLoading}
          loadError={stripeSettingsError}
          onUpdated={() => void loadStripeState()}
        />
      </section>

      <section className="space-y-4 rounded-lg border border-destructive/30 p-4">
        <h2 className="text-lg font-medium text-destructive">Danger zone</h2>
        <p className="text-sm text-muted-foreground">
          Pauses every active listing. Type UNPUBLISH to confirm.
        </p>
        <Input
          value={unpub}
          onChange={(e) => setUnpub(e.target.value)}
          placeholder="UNPUBLISH"
          className="max-w-xs"
        />
        <button
          type="button"
          className={cn(buttonVariants({ variant: "destructive" }))}
          onClick={() => void unpublishAll()}
        >
          Unpublish all listings
        </button>
      </section>
    </div>
  );
}
