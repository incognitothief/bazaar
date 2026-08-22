import { Link } from "react-router-dom";
import type { Agent } from "@atproto/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FormatBadge } from "@/components/shared/FormatBadge";
import { catalogItemRkey, itemPathPretty } from "@/lib/itemPath";
import { formatMoney } from "@/lib/format";
import { catalogItemArtworkCid, type CatalogItem, type Listing } from "@/types/lexicons";
import { ArtworkImage } from "./ArtworkImage";

export function ItemCard({
  agent,
  artistDid,
  itemUri,
  item,
  listing,
  preview,
}: {
  agent: Agent;
  artistDid: string;
  itemUri: string;
  item: CatalogItem;
  listing: Listing;
  /** Local-only catalog preview (not on PDS). */
  preview?: boolean;
}) {
  const title = item.title;
  const artworkCid = catalogItemArtworkCid(item);
  const trackCount =
    item.$type === "diamonds.whereditgo.bazaar.catalog.collection"
      ? item.items.filter((i) => i.role === "track").length
      : undefined;
  const to = itemPathPretty(catalogItemRkey(itemUri), title);

  return (
    <Link
      to={to}
      className="block rounded-b-xl rounded-t-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full gap-0 overflow-hidden rounded-b-xl rounded-t-none py-0 ring-border transition-shadow hover:shadow-md">
        <div className="aspect-square w-full overflow-hidden bg-muted">
          <ArtworkImage
            agent={agent}
            did={artistDid}
            cid={artworkCid}
            itemUri={itemUri}
            alt=""
            className="h-full w-full"
          />
        </div>
        <CardContent className="space-y-2 p-4">
          <h3 className="font-semibold leading-tight line-clamp-2">
            {title}
            {preview ? (
              <Badge
                variant="secondary"
                className="ml-2 align-middle text-[10px] font-normal"
              >
                Preview
              </Badge>
            ) : null}
          </h3>
          {"formats" in item && item.formats?.length ? (
            <div className="flex flex-wrap gap-1">
              {item.formats.map((f) => (
                <FormatBadge key={f} format={f} />
              ))}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{formatMoney(listing.price)}</span>
            {trackCount !== undefined ? (
              <span className="text-xs text-muted-foreground">
                {trackCount} {trackCount === 1 ? "track" : "tracks"}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
