import { Link } from "react-router-dom";
import type { Agent } from "@atproto/api";
import { Pause, Pencil, Play, SquareArrowOutUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArtworkImage } from "@/components/public/ArtworkImage";
import type { MerchantItemRow } from "@/hooks/useMerchantCatalog";
import type { ListingRow } from "@/lib/atproto/records";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  editHref,
  itemDetailText,
  kindLabel,
  listingStatusBadgeVariant,
  rowArtworkCid,
  rowCoverImageUrl,
  storefrontHref,
} from "./merchantItemDisplay";

export function MerchantItemCard({
  agent,
  merchantDid,
  row,
  listingRow,
  pending,
  onToggleStatus,
}: {
  agent: Agent;
  merchantDid: string;
  row: MerchantItemRow;
  listingRow: ListingRow | undefined;
  pending: boolean;
  onToggleStatus: () => void;
}) {
  const title = row.item.title;
  const listing = listingRow?.listing;

  return (
    <Card className="h-full gap-0 overflow-hidden py-0 ring-border transition-shadow hover:shadow-md">
      <Link to={editHref(row)} className="block focus-visible:outline-none">
        <div className="aspect-square w-full overflow-hidden bg-muted">
          {row.kind === "product" || row.kind === "item" ? (
            rowCoverImageUrl(row) ? (
              <img
                src={rowCoverImageUrl(row)}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : null
          ) : (
            <ArtworkImage
              agent={agent}
              did={merchantDid}
              cid={rowArtworkCid(row)}
              itemUri={row.uri}
              alt=""
              className="h-full w-full"
            />
          )}
        </div>
      </Link>
      <CardContent className="space-y-1.5 p-3">
        <Link
          to={editHref(row)}
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          <h3 className="text-sm font-medium leading-tight line-clamp-2 hover:underline">
            {title}
          </h3>
        </Link>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className="text-[10px]">
            {kindLabel(row.kind)}
          </Badge>
          {listing ? (
            <Badge
              variant={listingStatusBadgeVariant(listing.status)}
              className="text-[10px]"
            >
              {listing.status}
            </Badge>
          ) : (
            <span className="text-[11px] text-muted-foreground">No listing</span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {itemDetailText(row)}
        </p>
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="text-sm font-medium">
            {listing ? formatMoney(listing.price) : "—"}
          </span>
          <div className="flex items-center gap-0.5">
            <Link
              to={editHref(row)}
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
      </CardContent>
    </Card>
  );
}
