import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listingStatusBadgeVariant } from "@/components/merchant/merchantItemDisplay";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import { fetchLatestInventoryPrefill } from "@/lib/api/inventoryApi";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import {
  buildItemRefFromUri,
  createListing,
  isTerminalListingStatus,
  listCatalogItemRows,
  listCatalogProductRows,
  listLicensesWithStatus,
  listListingRows,
  putListing,
  type LicenseListRow,
  type ListingRow,
} from "@/lib/atproto/records";
import { collectionFromAtUri } from "@/lib/atUri";
import { cn } from "@/lib/utils";
import type { Listing } from "@/types/lexicons";

type EntityKind = "item" | "product" | "other";

export function CreateListingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);

  const uriParam = useMemo(() => {
    const raw = searchParams.get("uri")?.trim() ?? "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [searchParams]);
  const source = searchParams.get("source");

  const [loading, setLoading] = useState(true);
  const [entity, setEntity] = useState<{
    uri: string;
    title: string;
    kind: EntityKind;
  } | null>(null);
  const [listingRows, setListingRows] = useState<ListingRow[]>([]);
  const [productUriByItemUri, setProductUriByItemUri] = useState<
    Map<string, string>
  >(new Map());
  const [titleByUri, setTitleByUri] = useState<Record<string, string>>({});
  const [licenseRows, setLicenseRows] = useState<LicenseListRow[]>([]);

  const [licenseUri, setLicenseUri] = useState("");
  const [licenseCid, setLicenseCid] = useState("");
  const [priceUsd, setPriceUsd] = useState("9.99");
  /** Item toggle: true = independent listing (no parentListing); false = sells under the product listing. */
  const [standalone, setStandalone] = useState(true);
  const [busy, setBusy] = useState(false);

  /** Product-only: batch-create listings for the product's member items. */
  const [productItems, setProductItems] = useState<
    { uri: string; title: string }[]
  >([]);
  const [batchEnabled, setBatchEnabled] = useState(false);
  const [bulkItemPrice, setBulkItemPrice] = useState("1.99");
  const [itemSelected, setItemSelected] = useState<Record<string, boolean>>({});
  /** Per-row price overrides; a row not in here follows `bulkItemPrice`. */
  const [itemPriceOverride, setItemPriceOverride] = useState<
    Record<string, string>
  >({});
  /**
   * Product manage view: per-member "list as standalone" toggle.
   * true = independent (no parentListing); false = sells under the product listing.
   * A member not in here follows its listing's current link, or false when unlisted.
   */
  const [childStandalone, setChildStandalone] = useState<Record<string, boolean>>(
    {},
  );

  const load = useCallback(async () => {
    if (!agent || !session?.did) return;
    setLoading(true);
    try {
      let targetUri = uriParam;
      let prefill: {
        licenseUri?: string;
        licenseGrantCid?: string;
        priceUsd?: string;
      } | null = null;
      if (!targetUri && source === "upload") {
        const { prefill: p } = await fetchLatestInventoryPrefill().catch(() => ({
          prefill: null,
        }));
        if (p?.primaryItemUri) {
          targetUri = p.primaryItemUri;
          prefill = p;
        }
      }
      if (!targetUri) {
        setEntity(null);
        setLoading(false);
        return;
      }

      const [rows, productRows, itemRows, licenses] = await Promise.all([
        listListingRows(session.did).catch(() => []),
        listCatalogProductRows().catch(() => []),
        listCatalogItemRows().catch(() => []),
        listLicensesWithStatus(session.did).catch(() => []),
      ]);

      const pbi = new Map<string, string>();
      const tb: Record<string, string> = {};
      for (const p of productRows) {
        tb[p.uri] = p.title;
        for (const ref of p.items) pbi.set(ref.uri, p.uri);
      }
      for (const it of itemRows) tb[it.uri] = it.title;

      const coll = collectionFromAtUri(targetUri);
      const kind: EntityKind =
        coll === BAZAAR_COLLECTION.product
          ? "product"
          : coll === BAZAAR_COLLECTION.item
            ? "item"
            : "other";

      setEntity({ uri: targetUri, title: tb[targetUri] ?? targetUri, kind });
      setListingRows(rows);
      setProductUriByItemUri(pbi);
      setTitleByUri(tb);
      setLicenseRows(licenses.filter((l) => !l.retired));

      if (kind === "product") {
        const p = productRows.find((x) => x.uri === targetUri);
        const members = (p?.items ?? []).map((ref) => ({
          uri: ref.uri,
          title: tb[ref.uri] ?? ref.uri,
        }));
        setProductItems(members);

        // Manage view: seed each member row from its live listing.
        const attach: Record<string, boolean> = {};
        const rowPrice: Record<string, string> = {};
        for (const m of members) {
          const childRow = rows.find(
            (r) =>
              r.listing.item.uri === m.uri &&
              !isTerminalListingStatus(r.listing.status),
          );
          if (childRow) {
            attach[m.uri] = !childRow.listing.parentListing;
            rowPrice[m.uri] = (childRow.listing.price.amount / 100).toFixed(2);
          }
        }
        setChildStandalone(attach);
        setItemPriceOverride(rowPrice);
      } else {
        setProductItems([]);
        setChildStandalone({});
      }

      const parentUri = pbi.get(targetUri);
      const productListing = parentUri
        ? rows.find(
            (r) =>
              r.listing.item.uri === parentUri &&
              !r.listing.parentListing &&
              !isTerminalListingStatus(r.listing.status),
          )
        : undefined;
      const own = rows.find(
        (r) =>
          r.listing.item.uri === targetUri &&
          !isTerminalListingStatus(r.listing.status),
      );

      if (own) {
        // Edit an existing item listing.
        setStandalone(!own.listing.parentListing);
        setPriceUsd((own.listing.price.amount / 100).toFixed(2));
        setLicenseUri(own.listing.licenseUri ?? "");
        setLicenseCid(own.listing.licenseGrantCid ?? "");
      } else {
        // New listing: default to selling under the product when it's listed,
        // otherwise standalone. Seed the license from the product's listing.
        setStandalone(!productListing);
        if (productListing?.listing.licenseUri) {
          setLicenseUri(productListing.listing.licenseUri);
          setLicenseCid(productListing.listing.licenseGrantCid ?? "");
        }
      }

      if (prefill) {
        setLicenseUri(prefill.licenseUri ?? "");
        setLicenseCid(prefill.licenseGrantCid ?? "");
        if (prefill.priceUsd) setPriceUsd(prefill.priceUsd);
      }
    } finally {
      setLoading(false);
    }
  }, [agent, session?.did, uriParam, source]);

  useEffect(() => {
    void load();
  }, [load]);

  const parentProductUri =
    entity?.kind === "item" ? productUriByItemUri.get(entity.uri) : undefined;

  const parentProductListing = useMemo(() => {
    if (!parentProductUri) return undefined;
    return listingRows.find(
      (r) =>
        r.listing.item.uri === parentProductUri &&
        !r.listing.parentListing &&
        !isTerminalListingStatus(r.listing.status),
    );
  }, [listingRows, parentProductUri]);

  const canSellUnderProduct = Boolean(parentProductUri && parentProductListing);

  const existingListing = useMemo(() => {
    if (!entity) return undefined;
    return listingRows.find(
      (r) =>
        r.listing.item.uri === entity.uri &&
        !isTerminalListingStatus(r.listing.status),
    );
  }, [listingRows, entity]);

  /** Item listing edit: the item grain, an existing listing to modify. */
  const editMode = entity?.kind === "item" && !!existingListing;

  /** Product grain with a live listing -> manage the product + its items' listings. */
  const manageMode = entity?.kind === "product" && !!existingListing;
  const productListing = manageMode ? existingListing : undefined;
  const productListingActive = productListing?.listing.status === "active";

  const memberListing = useCallback(
    (itemUri: string) =>
      listingRows.find(
        (r) =>
          r.listing.item.uri === itemUri &&
          !isTerminalListingStatus(r.listing.status),
      ),
    [listingRows],
  );

  const priceValid = useMemo(() => {
    const n = parseFloat(priceUsd);
    return Number.isFinite(n) && n >= 0;
  }, [priceUsd]);

  const childHasListing = useCallback(
    (itemUri: string) =>
      listingRows.some(
        (r) =>
          r.listing.item.uri === itemUri &&
          !isTerminalListingStatus(r.listing.status),
      ),
    [listingRows],
  );

  /** A row is included in the batch unless already listed or explicitly deselected. */
  const rowIncluded = useCallback(
    (itemUri: string) =>
      !childHasListing(itemUri) && (itemSelected[itemUri] ?? true),
    [childHasListing, itemSelected],
  );

  const priceForRow = useCallback(
    (itemUri: string) => itemPriceOverride[itemUri] ?? bulkItemPrice,
    [itemPriceOverride, bulkItemPrice],
  );

  const batchValid = useMemo(() => {
    if (!batchEnabled) return true;
    return productItems.every((it) => {
      if (!rowIncluded(it.uri)) return true;
      const n = parseFloat(priceForRow(it.uri));
      return Number.isFinite(n) && n >= 0;
    });
  }, [batchEnabled, productItems, rowIncluded, priceForRow]);

  /** Item can only attach to a product listing that exists. */
  const attachBlocked =
    entity?.kind === "item" && !standalone && !canSellUnderProduct;

  const canSubmit =
    !!entity &&
    !busy &&
    (editMode || !existingListing) &&
    !attachBlocked &&
    priceValid &&
    batchValid &&
    Boolean(licenseUri && licenseCid);

  async function submit() {
    if (!entity || !agent || !canSubmit) return;
    setBusy(true);
    try {
      const itemRef = await buildItemRefFromUri(entity.uri);
      if (!itemRef?.cid) {
        toast.error("Could not load this inventory record");
        return;
      }
      const cents = Math.round(parseFloat(priceUsd) * 100);
      const parentListing =
        entity.kind === "item" && !standalone && parentProductListing
          ? parentProductListing.uri
          : undefined;

      if (editMode && existingListing) {
        const rec: Listing = {
          ...existingListing.listing,
          item: itemRef,
          price: {
            amount: cents,
            currency: existingListing.listing.price.currency,
          },
          licenseUri,
          licenseGrantCid: licenseCid,
        };
        if (parentListing) rec.parentListing = parentListing;
        else delete rec.parentListing;
        await putListing(agent, existingListing.uri, rec);
        toast.success("Listing updated");
        navigate(
          `/merchant/inventory/edit?uri=${encodeURIComponent(entity.uri)}`,
        );
        return;
      }

      const { uri: createdListingUri } = await createListing(agent, {
        item: itemRef,
        price: { amount: cents, currency: "USD" },
        status: "active",
        licenseUri,
        licenseGrantCid: licenseCid,
        parentListing,
      });

      let childCreated = 0;
      let childSkipped = 0;
      if (entity.kind === "product" && batchEnabled) {
        for (const it of productItems) {
          if (!rowIncluded(it.uri)) continue;
          const n = parseFloat(priceForRow(it.uri));
          if (!Number.isFinite(n) || n < 0) {
            childSkipped += 1;
            continue;
          }
          const ref = await buildItemRefFromUri(it.uri);
          if (!ref?.cid) {
            childSkipped += 1;
            continue;
          }
          await createListing(agent, {
            item: ref,
            price: { amount: Math.round(n * 100), currency: "USD" },
            status: "active",
            licenseUri,
            licenseGrantCid: licenseCid,
            parentListing: createdListingUri,
          });
          childCreated += 1;
        }
      }

      toast.success(
        childCreated > 0
          ? `Product listing created with ${childCreated} item listing${childCreated === 1 ? "" : "s"}${childSkipped > 0 ? ` (${childSkipped} skipped)` : ""}.`
          : "Listing created",
      );
      // Back to the page the merchant came from (its product / item page),
      // falling back to the inventory list for other grains.
      const back =
        entity.kind === "product"
          ? `/merchant/inventory/products?uri=${encodeURIComponent(entity.uri)}`
          : entity.kind === "item"
            ? `/merchant/inventory/edit?uri=${encodeURIComponent(entity.uri)}`
            : "/merchant/inventory";
      navigate(back);
    } catch (e) {
      toast.error("Could not create listing", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  const parsePrice = (raw: string): number | null => {
    const n = parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
  };

  /**
   * Product manage view. Patches the product listing (price / license) in
   * place, then walks every member row: re-prices or attaches/detaches an
   * existing item listing, and creates one for a selected unlisted member.
   * New child listings inherit the product listing's license; an existing
   * child's own license is left untouched (bespoke licenses are edited from
   * that item's listing tool).
   */
  async function saveManage() {
    if (!entity || !agent || !productListing) return;
    setBusy(true);
    try {
      const cur = productListing.listing;
      const prodCents = parsePrice(priceUsd);
      if (prodCents == null) {
        toast.error("Enter a valid product price");
        return;
      }
      if (!licenseUri || !licenseCid) {
        toast.error("Pick a license for the product");
        return;
      }
      const priceChanged = prodCents !== cur.price.amount;
      const licenseChanged =
        licenseUri !== cur.licenseUri || licenseCid !== cur.licenseGrantCid;
      if (priceChanged || licenseChanged) {
        const freshRef = await buildItemRefFromUri(entity.uri);
        await putListing(agent, productListing.uri, {
          ...cur,
          item: freshRef ?? cur.item,
          price: { amount: prodCents, currency: cur.price.currency },
          licenseUri,
          licenseGrantCid: licenseCid,
        });
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;
      for (const it of productItems) {
        const childRow = memberListing(it.uri);
        const wantStandalone =
          childStandalone[it.uri] ??
          (childRow ? !childRow.listing.parentListing : false);

        if (childRow) {
          const c = childRow.listing;
          const rowCents = parsePrice(
            itemPriceOverride[it.uri] ?? (c.price.amount / 100).toFixed(2),
          );
          const curStandalone = !c.parentListing;
          const attachChanged = wantStandalone !== curStandalone;
          const priceMoved = rowCents != null && rowCents !== c.price.amount;
          if (!attachChanged && !priceMoved) continue;
          if (attachChanged && !wantStandalone && !productListingActive) {
            skipped += 1;
            continue;
          }
          const ref = await buildItemRefFromUri(it.uri);
          const rec: Listing = {
            ...c,
            item: ref ?? c.item,
            price:
              rowCents != null
                ? { amount: rowCents, currency: c.price.currency }
                : c.price,
          };
          if (wantStandalone) delete rec.parentListing;
          else rec.parentListing = productListing.uri;
          await putListing(agent, childRow.uri, rec);
          updated += 1;
        } else {
          if (!(itemSelected[it.uri] ?? false)) continue;
          const cents = parsePrice(itemPriceOverride[it.uri] ?? bulkItemPrice);
          const ref = cents == null ? null : await buildItemRefFromUri(it.uri);
          if (cents == null || !ref?.cid) {
            skipped += 1;
            continue;
          }
          await createListing(agent, {
            item: ref,
            price: { amount: cents, currency: "USD" },
            status: "active",
            licenseUri,
            licenseGrantCid: licenseCid,
            parentListing: wantStandalone ? undefined : productListing.uri,
          });
          created += 1;
        }
      }

      const parts = [
        priceChanged || licenseChanged ? "product listing updated" : null,
        created > 0
          ? `${created} item listing${created === 1 ? "" : "s"} created`
          : null,
        updated > 0 ? `${updated} updated` : null,
        skipped > 0 ? `${skipped} skipped` : null,
      ].filter(Boolean);
      toast.success(parts.length ? `Saved — ${parts.join(", ")}.` : "No changes");
      navigate(
        `/merchant/inventory/products?uri=${encodeURIComponent(entity.uri)}`,
      );
    } catch (e) {
      toast.error("Could not save listings", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  if (!session || !agent) return null;

  const backLink = (
    <Link
      to="/merchant/inventory"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Inventory
    </Link>
  );

  if (loading) {
    return (
      <div className="w-full min-w-0 max-w-xl space-y-6">
        {backLink}
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="w-full min-w-0 max-w-xl space-y-6">
        {backLink}
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Couldn't find an inventory item to list. Open one from Inventory and
          use its Create listing action.
        </div>
      </div>
    );
  }

  const blockCard = !!existingListing && entity.kind === "other";

  const licensePicker = (
    <div className="space-y-2">
      <Label>License</Label>
      {entity.kind === "item" ? (
        <p className="text-xs text-muted-foreground">
          Items normally sell under their product's license. Setting a different
          license here is deliberate — buyers who purchase this item on its own
          agree to <em>these</em> terms, not the product's.
        </p>
      ) : null}
      {licenseRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No licenses yet.{" "}
          <Link to="/merchant/license" className="underline underline-offset-2">
            Create one
          </Link>
          .
        </p>
      ) : (
        <div className="grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2">
          {licenseRows.map((row) => {
            const picked = licenseUri === row.uri && licenseCid === row.cid;
            return (
              <button
                key={row.uri}
                type="button"
                onClick={() => {
                  setLicenseUri(row.uri);
                  setLicenseCid(row.cid);
                }}
                className={cn(
                  "rounded-lg border p-3 text-left text-sm transition-colors",
                  picked && "bg-muted/40 ring-2 ring-ring",
                )}
              >
                <span className="font-medium">{row.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {row.version}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {licenseRows.length > 0 ? (
        <Link
          to="/merchant/license"
          className="text-sm text-primary underline-offset-2 hover:underline"
        >
          Don't see the right license? Create one
        </Link>
      ) : null}
    </div>
  );

  return (
    <div className="w-full min-w-0 max-w-xl space-y-6">
      {backLink}
      <h1 className="text-2xl font-semibold">
        {manageMode
          ? "Manage listings"
          : editMode
            ? "Edit listing"
            : "Create listing"}
      </h1>

      {blockCard ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{entity.title}</span>{" "}
            already has a listing (currently {existingListing!.listing.status}).
            Edit its price and terms from the product page.
            <div className="mt-4">
              <Link
                to="/merchant/inventory"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                Back to inventory
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : manageMode && productListing ? (
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-lg">{entity.title}</CardTitle>
              <Badge
                variant={listingStatusBadgeVariant(
                  productListing.listing.status,
                )}
                className="shrink-0 text-[10px]"
              >
                {productListing.listing.status}
              </Badge>
            </div>
            <CardDescription>
              Set the product listing's price and terms, then price its items
              and choose which sell on their own.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {licensePicker}

            <div className="space-y-2">
              <Label htmlFor="manage-product-price">Product price (USD)</Label>
              <Input
                id="manage-product-price"
                inputMode="decimal"
                value={priceUsd}
                onChange={(e) => setPriceUsd(e.target.value)}
                className="max-w-[10rem]"
              />
            </div>

            {productItems.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium">Item listings</h2>
                </div>

                <div className="flex items-end gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="manage-bulk-price">
                      Set every item price (USD)
                    </Label>
                    <Input
                      id="manage-bulk-price"
                      inputMode="decimal"
                      value={bulkItemPrice}
                      onChange={(e) => setBulkItemPrice(e.target.value)}
                      className="h-9 max-w-[10rem]"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setItemPriceOverride((p) => {
                        const next = { ...p };
                        for (const it of productItems)
                          next[it.uri] = bulkItemPrice;
                        return next;
                      })
                    }
                  >
                    Apply to all
                  </Button>
                </div>

                <ul className="m-0 list-none space-y-1.5 p-0">
                  {productItems.map((it) => {
                    const childRow = memberListing(it.uri);
                    const listed = !!childRow;
                    const status = childRow?.listing.status;
                    const wantStandalone =
                      childStandalone[it.uri] ??
                      (childRow ? !childRow.listing.parentListing : false);
                    const include = listed
                      ? true
                      : (itemSelected[it.uri] ?? false);
                    const priceVal =
                      itemPriceOverride[it.uri] ??
                      (childRow
                        ? (childRow.listing.price.amount / 100).toFixed(2)
                        : bulkItemPrice);
                    const attachLockedOn = wantStandalone && !productListingActive;
                    return (
                      <li
                        key={it.uri}
                        className="space-y-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
                      >
                        <div className="flex items-center gap-3">
                          {listed ? null : (
                            <input
                              type="checkbox"
                              className="size-4 shrink-0"
                              aria-label={`Create a listing for ${it.title}`}
                              checked={include}
                              onChange={(e) =>
                                setItemSelected((p) => ({
                                  ...p,
                                  [it.uri]: e.target.checked,
                                }))
                              }
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {it.title}
                          </span>
                          {listed ? (
                            <Badge
                              variant={listingStatusBadgeVariant(status!)}
                              className="shrink-0 text-[10px]"
                            >
                              {status}
                            </Badge>
                          ) : (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              No listing
                            </span>
                          )}
                        </div>
                        {listed || include ? (
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                Price
                              </span>
                              <Input
                                inputMode="decimal"
                                aria-label={`Price for ${it.title}`}
                                value={priceVal}
                                onChange={(e) =>
                                  setItemPriceOverride((p) => ({
                                    ...p,
                                    [it.uri]: e.target.value,
                                  }))
                                }
                                className="h-8 w-24"
                              />
                            </div>
                            <label className="flex cursor-pointer items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                className="size-4"
                                checked={wantStandalone}
                                disabled={attachLockedOn}
                                onChange={(e) =>
                                  setChildStandalone((p) => ({
                                    ...p,
                                    [it.uri]: e.target.checked,
                                  }))
                                }
                              />
                              Standalone
                            </label>
                          </div>
                        ) : null}
                        {attachLockedOn ? (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            Activate the product listing to sell this item under
                            it.
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Standalone items sell on their own and aren't affected when the
                  product listing is paused or deleted. Others sell under the
                  product listing and follow it.
                </p>
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button
                type="button"
                disabled={
                  busy ||
                  !licenseUri ||
                  !licenseCid ||
                  parsePrice(priceUsd) == null
                }
                onClick={() => void saveManage()}
              >
                {busy ? "Saving…" : "Save listings"}
              </Button>
              <Link
                to={`/merchant/inventory/products?uri=${encodeURIComponent(entity.uri)}`}
                className={cn(buttonVariants({ variant: "ghost" }))}
              >
                Cancel
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">{entity.title}</CardTitle>
            <CardDescription>
              {entity.kind === "product"
                ? "Listing the whole product. Its items are covered unless you also list one separately."
                : editMode
                  ? "Change how this item sells, its price, and its terms."
                  : "Choose how it's sold, pick license terms, and set a price."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {entity.kind === "item" && parentProductUri ? (
              <div className="space-y-2">
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0"
                    checked={standalone}
                    onChange={(e) => setStandalone(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">
                      List this as a standalone item
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {standalone
                        ? `Sells on its own, independent of ${titleByUri[parentProductUri] ?? "the product"} — pausing or editing the product doesn't touch it.`
                        : `Sells under the ${titleByUri[parentProductUri] ?? "product"} listing — follows it for pause, and is retired if the product listing is deleted.`}
                    </span>
                  </span>
                </label>
                {attachBlocked ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {titleByUri[parentProductUri] ?? "The product"} has no active
                    listing to attach to — list the product first, or keep this
                    standalone.
                  </p>
                ) : null}
              </div>
            ) : null}

            {licensePicker}

            <div className="space-y-2">
              <Label htmlFor="create-listing-price">
                {entity.kind === "product" ? "Product price (USD)" : "Price (USD)"}
              </Label>
              <Input
                id="create-listing-price"
                inputMode="decimal"
                value={priceUsd}
                onChange={(e) => setPriceUsd(e.target.value)}
                className="max-w-[10rem]"
              />
            </div>

            {entity.kind === "product" && productItems.length > 0 ? (
              <div className="space-y-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={batchEnabled}
                    onChange={(e) => setBatchEnabled(e.target.checked)}
                  />
                  Create individual listings for items
                </label>

                {batchEnabled ? (
                  <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="bulk-item-price">
                        Price for each item (USD)
                      </Label>
                      <Input
                        id="bulk-item-price"
                        inputMode="decimal"
                        value={bulkItemPrice}
                        onChange={(e) => setBulkItemPrice(e.target.value)}
                        className="max-w-[10rem]"
                      />
                      <p className="text-xs text-muted-foreground">
                        Applied to every selected item. Edit a row to override it —
                        that won't change this field.
                      </p>
                    </div>

                    <ul className="m-0 list-none space-y-1.5 p-0">
                      {productItems.map((it) => {
                        const already = childHasListing(it.uri);
                        const selected = already
                          ? false
                          : (itemSelected[it.uri] ?? true);
                        return (
                          <li
                            key={it.uri}
                            className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              className="size-4 shrink-0"
                              disabled={already}
                              checked={selected}
                              onChange={(e) =>
                                setItemSelected((p) => ({
                                  ...p,
                                  [it.uri]: e.target.checked,
                                }))
                              }
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {it.title}
                            </span>
                            {already ? (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                Already listed
                              </span>
                            ) : (
                              <Input
                                inputMode="decimal"
                                aria-label={`Price for ${it.title}`}
                                value={itemPriceOverride[it.uri] ?? bulkItemPrice}
                                onChange={(e) =>
                                  setItemPriceOverride((p) => ({
                                    ...p,
                                    [it.uri]: e.target.value,
                                  }))
                                }
                                disabled={!selected}
                                className="h-8 w-24 shrink-0"
                              />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button
                type="button"
                disabled={!canSubmit}
                onClick={() => void submit()}
              >
                {busy
                  ? editMode
                    ? "Saving…"
                    : "Creating…"
                  : editMode
                    ? "Save listing"
                    : entity.kind === "product" && batchEnabled
                      ? "Create listings"
                      : "Create listing"}
              </Button>
              <Link
                to="/merchant/inventory"
                className={cn(buttonVariants({ variant: "ghost" }))}
              >
                Cancel
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
