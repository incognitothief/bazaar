import { Link } from "react-router-dom";
import type { Agent } from "@atproto/api";
import { Card, CardContent } from "@/components/ui/card";
import { FormatBadge } from "@/components/shared/FormatBadge";
import type { CatalogItem, Listing } from "@/types/lexicons";
import { ArtworkImage } from "./ArtworkImage";

function formatMoney(m: { amount: number; currency: string }): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: m.currency,
  }).format(m.amount / 100);
}

export function ItemCard({
  agent,
  artistDid,
  itemUri,
  item,
  listing,
}: {
  agent: Agent;
  artistDid: string;
  itemUri: string;
  item: CatalogItem;
  listing: Listing;
}) {
  const title = item.title;
  const artistName =
    item.$type === "diamonds.whereditgo.bazaar.collection"
      ? item.artistName
      : item.artistDid;
  const artworkCid = item.artworkCid;
  const trackCount =
    item.$type === "diamonds.whereditgo.bazaar.collection"
      ? item.tracks.length
      : undefined;
  const to = `/item/${encodeURIComponent(itemUri)}`;

  return (
    <Link to={to} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
      <Card className="overflow-hidden transition-shadow hover:shadow-md h-full">
        <div className="aspect-square w-full overflow-hidden bg-muted">
          <ArtworkImage
            agent={agent}
            did={artistDid}
            cid={artworkCid}
            alt=""
            className="h-full w-full"
          />
        </div>
        <CardContent className="p-4 space-y-2">
          <div>
            <h3 className="font-semibold leading-tight line-clamp-2">{title}</h3>
            <p className="text-sm text-muted-foreground line-clamp-1">
              {artistName}
            </p>
          </div>
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
                {trackCount} tracks
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
