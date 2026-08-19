import { Link } from "react-router-dom";
import type { Agent } from "@atproto/api";
import { Pause, Pencil, Play, SquareArrowOutUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ArtworkImage } from "@/components/public/ArtworkImage";
import type { MerchantItemRow as MerchantItemRowData } from "@/hooks/useMerchantCatalog";
import type { ListingRow } from "@/lib/atproto/records";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  editHref,
  itemDetailText,
  kindLabel,
  listingStatusBadgeVariant,
  storefrontHref,
} from "./merchantItemDisplay";

export function MerchantItemRow({
  agent,
  merchantDid,
  row,
  listingRow,
  pending,
  onToggleStatus,
}: {
  agent: Agent;
  merchantDid: string;
  row: MerchantItemRowData;
  listingRow: ListingRow | undefined;
  pending: boolean;
  onToggleStatus: () => void;
}) {
  const title = row.item.title;
  const listing = listingRow?.listing;

  return (
    <div className="flex items-center gap-3 border-b border-border px-2 py-2 last:border-b-0">
      <Link
        to={editHref(row.uri)}
        className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArtworkImage
          agent={agent}
          did={merchantDid}
          cid={row.item.artworkCid}
          itemUri={row.uri}
          alt=""
          className="h-full w-full"
        />
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          to={editHref(row.uri)}
          className="block truncate text-sm font-medium hover:underline focus-visible:outline-none"
        >
          {title}
        </Link>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline" className="text-[10px]">
            {kindLabel(row.kind)}
          </Badge>
          <span className="truncate">{itemDetailText(row)}</span>
        </div>
      </div>

      <div className="hidden w-20 shrink-0 text-right text-sm tabular-nums sm:block">
        {listing ? formatMoney(listing.price) : "—"}
      </div>

      <div className="w-24 shrink-0">
        {listing ? (
          <Badge variant={listingStatusBadgeVariant(listing.status)} className="text-[10px]">
            {listing.status}
          </Badge>
        ) : (
          <span className="text-[11px] text-muted-foreground">No listing</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Link
          to={editHref(row.uri)}
          className={cn(buttonVariants({ variant: "ghost", size: "icon-xs" }))}
          title="Edit"
          aria-label="Edit"
        >
          <Pencil />
        </Link>
        <Link
          to={storefrontHref(row.uri, title)}
          className={cn(buttonVariants({ variant: "ghost", size: "icon-xs" }))}
          title="View on storefront"
          aria-label="View on storefront"
        >
          <SquareArrowOutUpRight />
        </Link>
        {listing ? (
          <button
            type="button"
            className={cn(buttonVariants({ variant: "ghost", size: "icon-xs" }))}
            disabled={pending}
            title={listing.status === "active" ? "Pause listing" : "Activate listing"}
            aria-label={
              listing.status === "active" ? "Pause listing" : "Activate listing"
            }
            onClick={onToggleStatus}
          >
            {listing.status === "active" ? <Pause /> : <Play />}
          </button>
        ) : null}
      </div>
    </div>
  );
}
