import { Link, useNavigate } from "react-router-dom";
import type { Agent } from "@atproto/api";
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pause,
  Play,
  SquareArrowOutUpRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  rowArtworkCid,
  rowCoverImageUrl,
  storefrontHref,
} from "./merchantItemDisplay";
import { RelationshipBadge } from "./RelationshipBadge";
import type { RelationshipDescriptor } from "./inventoryCommander";

export type MerchantRowActions = {
  relationship: RelationshipDescriptor;
  canCreateListing: boolean;
  onCreateListing: () => void;
  /** Item grain with an existing listing -> reach its create-or-edit listing pane. */
  canEditListing: boolean;
  onEditListing: () => void;
  onDeleteListing: () => void;
};

export function MerchantItemRow({
  agent,
  merchantDid,
  row,
  listingRow,
  pending,
  onToggleStatus,
  actions,
  indent = false,
  collapse,
  showKind = true,
  showRelationship = true,
}: {
  agent: Agent;
  merchantDid: string;
  row: MerchantItemRowData;
  listingRow: ListingRow | undefined;
  pending: boolean;
  onToggleStatus: () => void;
  actions: MerchantRowActions;
  indent?: boolean;
  collapse?: { collapsed: boolean; onToggle: () => void; childCount: number };
  showKind?: boolean;
  showRelationship?: boolean;
}) {
  const navigate = useNavigate();
  const title = row.item.title;
  const listing = listingRow?.listing;

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-border px-2 py-2 last:border-b-0",
        indent && "border-l-2 border-l-border/70 py-1.5 pl-9 text-muted-foreground",
      )}
    >
      {collapse ? (
        <button
          type="button"
          aria-label={collapse.collapsed ? "Expand" : "Collapse"}
          aria-expanded={!collapse.collapsed}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={collapse.onToggle}
        >
          {collapse.collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>
      ) : null}

      {indent ? null : (
        <Link
          to={editHref(row)}
          className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
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
        </Link>
      )}

      <div className="min-w-0 flex-1">
        <Link
          to={editHref(row)}
          className="block truncate text-sm font-medium hover:underline focus-visible:outline-none"
        >
          {title}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {showKind ? (
            <Badge variant="outline" className="text-[10px]">
              {kindLabel(row.kind)}
            </Badge>
          ) : null}
          {showRelationship ? (
            <RelationshipBadge relationship={actions.relationship} />
          ) : null}
          {collapse && collapse.childCount > 0 ? (
            <span className="text-[11px]">
              {collapse.childCount} item{collapse.childCount === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="truncate">{itemDetailText(row)}</span>
          )}
        </div>
      </div>

      <div
        className={cn(
          "hidden w-20 shrink-0 text-right text-sm tabular-nums sm:block",
          listing &&
            listing.status !== "active" &&
            "text-muted-foreground opacity-70",
        )}
      >
        {listing ? formatMoney(listing.price) : "—"}
      </div>

      <div className="w-24 shrink-0">
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

      <div className="flex shrink-0 items-center gap-1">
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

        {listing && listing.status !== "archived" && listing.status !== "superseded" ? (
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

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More actions"
            className={cn(buttonVariants({ variant: "ghost", size: "icon-xs" }))}
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
              <DropdownMenuItem destructive onSelect={actions.onDeleteListing}>
                Delete listing
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
