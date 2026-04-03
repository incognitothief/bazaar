import { createPublicAgent } from "@/lib/atproto/session";
import { InventoryGrid, InventoryGridSkeleton } from "@/components/public/InventoryGrid";
import { buttonVariants } from "@/components/ui/button";
import { useCatalog } from "@/hooks/useCatalog";
import { apiUrl } from "@/lib/apiUrl";
import { useSearchParams } from "react-router-dom";

export function HomePage() {
  const [search] = useSearchParams();
  const artistDid = import.meta.env.VITE_ARTIST_DID;
  const { entries, listingsByItemUri, loading, error } = useCatalog(artistDid);
  const agent = createPublicAgent();
  const hasActive = entries.some((e) => listingsByItemUri[e.uri]);
  const loginRequired = search.get("login") === "required";

  return (
    <div className="space-y-8">
      {loginRequired ? (
        <div
          className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          role="status"
        >
          <p className="text-sm text-muted-foreground">
            Sign in with your ATProto account to open the merchant dashboard.
          </p>
          <a
            href={apiUrl("/api/atproto/signin")}
            className={buttonVariants({ className: "shrink-0" })}
          >
            Continue to sign in
          </a>
        </div>
      ) : null}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Storefront</h1>
        <p className="mt-2 text-muted-foreground max-w-prose">
          Music and releases from the artist catalog. Only items with an active
          listing are shown.
        </p>
      </div>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <InventoryGridSkeleton />
      ) : !artistDid?.startsWith("did:") ? (
        <p className="text-muted-foreground">
          Set <code className="text-xs">VITE_ARTIST_DID</code> in{" "}
          <code className="text-xs">packages/client/.env</code> to load catalog.
        </p>
      ) : !hasActive ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <p className="font-medium text-foreground">Coming soon — check back soon</p>
          <p className="mt-2 text-sm">
            No active listings for this artist yet.
          </p>
        </div>
      ) : (
        <InventoryGrid
          agent={agent}
          artistDid={artistDid}
          entries={entries}
          listingsByItemUri={listingsByItemUri}
        />
      )}
    </div>
  );
}
