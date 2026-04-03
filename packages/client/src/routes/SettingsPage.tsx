import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageDropzone } from "@/components/shared/ImageDropzone";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import {
  createActorProfile,
  listListingRows,
  putActorProfile,
  putListing,
} from "@/lib/atproto/records";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import { cn } from "@/lib/utils";
import type { ActorProfile, Listing } from "@/types/lexicons";
import { toast } from "sonner";

export function SettingsPage() {
  const { session, signOut } = useAtpSession();
  const agent = useMerchantAgent(session);
  const [storefrontName, setStorefrontName] = useState("");
  const [description, setDescription] = useState("");
  const [profileRkey, setProfileRkey] = useState<string | null>(null);
  const [profileCid, setProfileCid] = useState<string | null>(null);
  const [profileCreatedAt, setProfileCreatedAt] = useState<string>(
    () => new Date().toISOString(),
  );
  const [stripeConnected, setStripeConnected] = useState(false);
  const [unpub, setUnpub] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(
          `${import.meta.env.VITE_API_ORIGIN}/api/stripe/account-status`,
          { credentials: "include" },
        );
        if (r.ok) {
          const j = (await r.json()) as { connected?: boolean };
          setStripeConnected(!!j.connected);
        }
      } catch {
        setStripeConnected(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!agent || !session) return;
    void (async () => {
      const res = (await agent.com.atproto.repo.listRecords({
        repo: session.did,
        collection: BAZAAR_COLLECTION.actorProfile,
        limit: 1,
      })) as {
        data: { records: Array<{ uri: string; cid: string; value: unknown }> };
      };
      const row = res.data.records[0];
      if (!row) return;
      setProfileRkey(row.uri.split("/").pop() ?? null);
      setProfileCid(row.cid);
      const v = row.value as ActorProfile;
      setStorefrontName(v.displayName ?? "");
      setDescription(v.description ?? "");
      setProfileCreatedAt(v.createdAt);
    })();
  }, [agent, session]);

  async function saveProfile() {
    if (!agent || !session) return;
    const record: ActorProfile = {
      $type: "diamonds.whereditgo.bazaar.actor.profile",
      displayName: storefrontName || undefined,
      description: description || undefined,
      createdAt: profileCreatedAt,
    };
    try {
      if (profileRkey && profileCid) {
        await putActorProfile(agent, record, profileRkey, profileCid);
      } else {
        const created = await createActorProfile(agent, {
          displayName: storefrontName || undefined,
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
      toast.error('Type UNPUBLISH to confirm');
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

  return (
    <div className="w-full min-w-0 max-w-xl space-y-12">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Profile</h2>
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
            onFile={() => toast.message("Avatar upload saves CID on profile save (wire in save).")}
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
        <h2 className="text-lg font-medium">Connections</h2>
        <p className="text-sm">
          ATProto: <span className="font-mono text-xs">{session.did}</span> (
          {session.handle})
        </p>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline" }))}
          onClick={() => void signOut()}
        >
          Disconnect
        </button>
        <div className="border-t border-border pt-4 mt-4">
          <p className="text-sm font-medium">Stripe</p>
          <p className="text-sm text-muted-foreground mt-1">
            {stripeConnected
              ? "Connected (stub — manage in Stripe Dashboard)."
              : "Not connected."}
          </p>
          <a
            href={`${import.meta.env.VITE_API_ORIGIN}/api/stripe/connect`}
            className={cn(buttonVariants({ variant: "secondary" }), "mt-2 inline-flex")}
          >
            Connect Stripe
          </a>
        </div>
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
