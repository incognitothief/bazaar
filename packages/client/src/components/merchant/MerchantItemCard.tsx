import { Link, useNavigate } from "react-router-dom";
import {
  MoreHorizontal,
  Pause,
  Play,
  SquareArrowOutUpRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MerchantItemRow } from "@/hooks/useMerchantCatalog";
import type { ListingRow } from "@/lib/atproto/records";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  editHref,
  itemDetailText,
  kindLabel,
  listingStatusBadgeVariant,
  rowCoverImageUrl,
  storefrontHref,
} from "./merchantItemDisplay";
import { RelationshipBadge } from "./RelationshipBadge";
import type { MerchantRowActions } from "./MerchantItemRow";

export function MerchantItemCard({
  row,
  listingRow,
  pending,
  onToggleStatus,
  actions,
  showKind = true,
  showRelationship = true,
}: {
  row: MerchantItemRow;
  listingRow: ListingRow | undefined;
  pending: boolean;
  onToggleStatus: () => void;
  actions: MerchantRowActions;
  showKind?: boolean;
  showRelationship?: boolean;
}) {
  const navigate = useNavigate();
  const title = row.item.title;
  const listing = listingRow?.listing;

  return (
    <Card className="h-full gap-0 overflow-hidden py-0 ring-border transition-shadow hover:shadow-md">
      <Link to={editHref(row)} className="block focus-visible:outline-none">
        <div className="aspect-square w-full overflow-hidden bg-muted">
          {rowCoverImageUrl(row) ? (
            <img
              src={rowCoverImageUrl(row)}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
      </Link>
      <CardContent className="space-y-1.5 p-3">
        <Link
          to={editHref(row)}
          className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h3 className="line-clamp-2 text-sm font-medium leading-tight hover:underline">
            {title}
          </h3>
        </Link>
        <div className="flex flex-wrap items-center gap-1">
          {showKind ? (
            <Badge variant="outline" className="text-[10px]">
              {kindLabel(row.kind)}
            </Badge>
          ) : null}
          {showRelationship ? (
            <RelationshipBadge relationship={actions.relationship} />
          ) : null}
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
          <span
            className={cn(
              "text-sm font-medium",
              listing &&
                listing.status !== "active" &&
                "text-muted-foreground opacity-70",
            )}
          >
            {listing ? formatMoney(listing.price) : "—"}
          </span>
          <div className="flex items-center gap-0.5">
            {actions.canCreateListing ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={actions.onCreateListing}
              >
                List
              </Button>
            ) : null}
            {listing &&
            listing.status !== "archived" &&
            listing.status !== "superseded" ? (
              <button
                type="button"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon-xs" }),
                )}
                disabled={pending}
                title={
                  listing.status === "active"
                    ? "Pause listing"
                    : "Activate listing"
                }
                aria-label={
                  listing.status === "active"
                    ? "Pause listing"
                    : "Activate listing"
                }
                onClick={onToggleStatus}
              >
                {listing.status === "active" ? <Pause /> : <Play />}
              </button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="More actions"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon-xs" }),
                )}
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => navigate(editHref(row))}>
                  Edit details
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    window.open(storefrontHref(row.uri, title), "_blank");
                  }}
                >
                  <SquareArrowOutUpRight className="size-3.5" />
                  View on storefront
                </DropdownMenuItem>
                {actions.canEditListing || listing ? (
                  <DropdownMenuSeparator />
                ) : null}
                {actions.canEditListing ? (
                  <DropdownMenuItem onSelect={actions.onEditListing}>
                    Edit listing
                  </DropdownMenuItem>
                ) : null}
                {listing ? (
                  <DropdownMenuItem
                    destructive
                    onSelect={actions.onDeleteListing}
                  >
                    Delete listing
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
