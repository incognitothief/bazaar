import { ArtworkPlaceholder } from "@/components/shared/ArtworkPlaceholder";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import { catalogItemRkey, itemPathPretty } from "@/lib/itemPath";
import { formatMoney } from "@/lib/format";
import { productTypeConfig } from "@/lib/productTypes";
import type { CatalogItem, Listing } from "@/types/lexicons";

export function ItemCard({
  itemUri,
  item,
  coverImages,
  productType,
  trackCount,
  listing,
  preview,
}: {
  itemUri: string;
  item: CatalogItem;
  /** catalog.product only -- presigned R2 cover URLs. */
  coverImages?: Array<{ objectId: string; url: string }>;
  /** catalog.product only -- ERP-only classification ("music", "generic", ...). */
  productType?: string | null;
  /** catalog.product only -- audio member count, from GET /products. */
  trackCount?: number;
  listing: Listing;
  /** Local-only catalog preview (not on PDS). */
  preview?: boolean;
}) {
  const title = item.title;
  const coverUrl = coverImages?.[0]?.url;

  // Bottom-right count: a music release counts tracks (audio members),
  // anything else counts items.
  const count: { n: number; unit: "track" | "item" } | undefined = (() => {
    if (item.$type === BAZAAR_COLLECTION.product) {
      return productTypeConfig(productType).value === "music"
        ? { n: trackCount ?? 0, unit: "track" }
        : { n: item.items.length, unit: "item" };
    }
    return undefined;
  })();
  const to = itemPathPretty(catalogItemRkey(itemUri), title);

  return (
    <Link
      to={to}
      className="block rounded-b-xl rounded-t-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full gap-0 overflow-hidden rounded-b-xl rounded-t-none py-0 ring-border transition-shadow hover:shadow-md">
        <div className="aspect-square w-full overflow-hidden bg-muted">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ArtworkPlaceholder className="p-8" />
          )}
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
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{formatMoney(listing.price)}</span>
            {count ? (
              <span className="text-xs text-muted-foreground">
                {count.n} {count.n === 1 ? count.unit : `${count.unit}s`}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
