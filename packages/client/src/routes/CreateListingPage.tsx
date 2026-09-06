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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type LicenseListRow,
  type ListingRow,
} from "@/lib/atproto/records";
import { collectionFromAtUri } from "@/lib/atUri";
import { cn } from "@/lib/utils";

type EntityKind = "item" | "product" | "other";
type ParentChoice = "part-of-product" | "separately";

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
  const [parentChoice, setParentChoice] = useState<ParentChoice>("separately");
  const [busy, setBusy] = useState(false);

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

      if (prefill) {
        setLicenseUri(prefill.licenseUri ?? "");
        setLicenseCid(prefill.licenseGrantCid ?? "");
        if (prefill.priceUsd) setPriceUsd(prefill.priceUsd);
      }
      setParentChoice(pbi.get(targetUri) ? "part-of-product" : "separately");
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

  useEffect(() => {
    if (!canSellUnderProduct && parentChoice === "part-of-product") {
      setParentChoice("separately");
    }
  }, [canSellUnderProduct, parentChoice]);

  const priceValid = useMemo(() => {
    const n = parseFloat(priceUsd);
    return Number.isFinite(n) && n >= 0;
  }, [priceUsd]);

  const canSubmit =
    !!entity &&
    !busy &&
    !existingListing &&
    priceValid &&
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
        entity.kind === "item" &&
        parentChoice === "part-of-product" &&
        parentProductListing
          ? parentProductListing.uri
          : undefined;

      await createListing(agent, {
        item: itemRef,
        price: { amount: cents, currency: "USD" },
        status: "active",
        licenseUri,
        licenseGrantCid: licenseCid,
        parentListing,
      });
      toast.success("Listing created");
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

  return (
    <div className="w-full min-w-0 max-w-xl space-y-6">
      {backLink}
      <h1 className="text-2xl font-semibold">Create listing</h1>

      {existingListing ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{entity.title}</span>{" "}
            already has a listing (currently {existingListing.listing.status}). An
            entity keeps a single listing for its whole life — edit or reactivate
            that one from its inventory row instead of creating another.
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
      ) : (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">{entity.title}</CardTitle>
            <CardDescription>
              {entity.kind === "product"
                ? "Listing the whole product. Its items are covered unless you also list one separately."
                : "Choose how it's sold, pick license terms, and set a price."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {entity.kind === "item" && parentProductUri ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  How is this item sold?
                </legend>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm",
                    !canSellUnderProduct && "cursor-not-allowed opacity-50",
                    parentChoice === "part-of-product" &&
                      canSellUnderProduct &&
                      "bg-muted/40 ring-2 ring-ring",
                  )}
                >
                  <input
                    type="radio"
                    name="parent-choice"
                    className="mt-1"
                    disabled={!canSellUnderProduct}
                    checked={parentChoice === "part-of-product"}
                    onChange={() => setParentChoice("part-of-product")}
                  />
                  <span>
                    <span className="font-medium">
                      Sell as part of{" "}
                      {titleByUri[parentProductUri] ?? "its product"}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {canSellUnderProduct
                        ? "The listing follows the product listing — pausing the product pauses this one."
                        : `List ${titleByUri[parentProductUri] ?? "the product"} first to sell this item under it.`}
                    </span>
                  </span>
                </label>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm",
                    parentChoice === "separately" && "bg-muted/40 ring-2 ring-ring",
                  )}
                >
                  <input
                    type="radio"
                    name="parent-choice"
                    className="mt-1"
                    checked={parentChoice === "separately"}
                    onChange={() => setParentChoice("separately")}
                  />
                  <span>
                    <span className="font-medium">Sell separately</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      A standalone listing, independent of any product it also
                      ships inside.
                    </span>
                  </span>
                </label>
              </fieldset>
            ) : null}

            <div className="space-y-2">
              <Label>License</Label>
              {licenseRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No licenses yet.{" "}
                  <Link
                    to="/merchant/license"
                    className="underline underline-offset-2"
                  >
                    Create one
                  </Link>
                  .
                </p>
              ) : (
                <div className="grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2">
                  {licenseRows.map((row) => {
                    const picked =
                      licenseUri === row.uri && licenseCid === row.cid;
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

            <div className="space-y-2">
              <Label htmlFor="create-listing-price">Price (USD)</Label>
              <Input
                id="create-listing-price"
                inputMode="decimal"
                value={priceUsd}
                onChange={(e) => setPriceUsd(e.target.value)}
                className="max-w-[10rem]"
              />
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                disabled={!canSubmit}
                onClick={() => void submit()}
              >
                {busy ? "Creating…" : "Create listing"}
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
