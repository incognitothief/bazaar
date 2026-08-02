import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import {
  listCollectionRows,
  listDigitalItemRows,
  listPhysicalItemRows,
  type CollectionRow,
  type DigitalItemRow,
  type PhysicalItemRow,
} from "@/lib/atproto/records";
import { catalogItemRkey, itemPathPretty } from "@/lib/itemPath";
import { cn } from "@/lib/utils";
import type { Collection, DigitalItem, PhysicalItem } from "@/types/lexicons";

type InventoryRow =
  | { kind: "digital"; uri: string; item: DigitalItem }
  | { kind: "collection"; uri: string; item: Collection }
  | { kind: "physical"; uri: string; item: PhysicalItem };

function mergeRows(
  digital: DigitalItemRow[],
  collections: CollectionRow[],
  physical: PhysicalItemRow[],
): InventoryRow[] {
  const merged: InventoryRow[] = [
    ...digital.map((r) => ({
      kind: "digital" as const,
      uri: r.uri,
      item: r.item,
    })),
    ...collections.map((r) => ({
      kind: "collection" as const,
      uri: r.uri,
      item: r.item,
    })),
    ...physical.map((r) => ({
      kind: "physical" as const,
      uri: r.uri,
      item: r.item,
    })),
  ];
  merged.sort(
    (a, b) =>
      new Date(b.item.createdAt).getTime() -
      new Date(a.item.createdAt).getTime(),
  );
  return merged;
}

function formatDigitalDetail(item: DigitalItem): string {
  const parts: string[] = [item.itemClass];
  if (item.formats?.length) {
    parts.push(item.formats.join(", "));
  }
  return parts.filter(Boolean).join(" · ");
}

function formatPhysicalDetail(item: PhysicalItem): string {
  const parts: string[] = [item.itemClass];
  if (item.variants?.length) {
    parts.push(
      `${item.variants.length} variant${item.variants.length === 1 ? "" : "s"}`,
    );
  }
  return parts.filter(Boolean).join(" · ");
}

export function MerchantInventoryPage() {
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!agent || !session) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [digital, collections, physical] = await Promise.all([
          listDigitalItemRows(session.did),
          listCollectionRows(session.did),
          listPhysicalItemRows(session.did),
        ]);
        if (!cancelled) {
          setRows(mergeRows(digital, collections, physical));
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(
            e instanceof Error ? e.message : "Could not load inventory.",
          );
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, session]);

  const empty = useMemo(
    () => !loading && rows.length === 0 && !loadError,
    [loading, rows.length, loadError],
  );

  if (!session || !agent) return null;

  return (
    <div className="w-full min-w-0">
      <h1 className="text-2xl font-semibold mb-6">Inventory</h1>
      <p className="mb-6 text-sm text-muted-foreground max-w-2xl">
        Catalog items in your repo. To set prices and publish to the
        storefront, use{" "}
        <Link to="/merchant/listings" className="underline underline-offset-2">
          Listings
        </Link>
        .
      </p>

      {loadError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading catalog…</p>
      ) : null}

      {empty ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          <p>No catalog items yet.</p>
          <Link
            to="/merchant/upload/tracks"
            className={cn(buttonVariants(), "mt-4 inline-flex")}
          >
            Upload tracks
          </Link>
        </div>
      ) : null}

      {!loading && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left p-3 font-medium">Title</th>
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-left p-3 font-medium">Details</th>
                <th className="text-left p-3 font-medium">Created</th>
                <th className="text-right p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.uri} className="border-b border-border">
                  <td className="p-3 font-medium">{row.item.title}</td>
                  <td className="p-3">
                    <Badge variant="outline">
                      {row.kind === "digital"
                        ? "Digital"
                        : row.kind === "collection"
                          ? "Collection"
                          : "Physical"}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {row.kind === "digital"
                      ? formatDigitalDetail(row.item)
                      : row.kind === "physical"
                        ? formatPhysicalDetail(row.item)
                        : [
                            row.item.collectionType ?? "collection",
                            `${row.item.items.length} item${
                              row.item.items.length === 1 ? "" : "s"
                            }`,
                          ].join(" · ")}
                  </td>
                  <td className="p-3 text-muted-foreground whitespace-nowrap">
                    {new Date(row.item.createdAt).toLocaleDateString(undefined, {
                      dateStyle: "medium",
                    })}
                  </td>
                  <td className="p-3 text-right">
                    <div className="inline-flex flex-wrap items-center justify-end gap-1">
                      <Link
                        to={`/merchant/inventory/edit?uri=${encodeURIComponent(row.uri)}`}
                        className={cn(
                          buttonVariants({ size: "sm", variant: "secondary" }),
                          "inline-flex",
                        )}
                      >
                        Edit
                      </Link>
                      <Link
                        to={itemPathPretty(
                          catalogItemRkey(row.uri),
                          row.item.title,
                        )}
                        className={cn(
                          buttonVariants({ size: "sm", variant: "ghost" }),
                          "inline-flex",
                        )}
                      >
                        Storefront
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
