import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import {
  fetchLatestInventoryPrefill,
  type InventoryPrefillPayload,
} from "@/lib/api/inventoryApi";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import {
  buildItemRefFromUri,
  createListing,
  getRecordValue,
  listCatalogItemRows,
  listCatalogProductRows,
  listCollectionRows,
  listDigitalItemRows,
  listLicensesWithStatus,
  listListingRows,
  type CatalogProductRow,
  type LicenseListRow,
  type ListingRow,
} from "@/lib/atproto/records";
import { collectionFromAtUri } from "@/lib/atUri";
import { cn } from "@/lib/utils";
import type { CatalogItem } from "@/types/lexicons";
import { toast } from "sonner";

type CatalogPick = {
  uri: string;
  title: string;
  kind: "digital" | "collection" | "item" | "product";
};

function catalogItemKindFromAtUri(uri: string): CatalogPick["kind"] {
  if (uri.includes(`${BAZAAR_COLLECTION.collection}/`)) return "collection";
  if (uri.includes(`${BAZAAR_COLLECTION.product}/`)) return "product";
  if (uri.includes(`${BAZAAR_COLLECTION.item}/`)) return "item";
  return "digital";
}

const CATALOG_PICK_LABEL: Record<CatalogPick["kind"], string> = {
  digital: "Digital",
  collection: "Collection",
  item: "Item",
  product: "Product",
};

export function CreateListingPage() {
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);
  const location = useLocation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ListingRow[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [catalogOptions, setCatalogOptions] = useState<CatalogPick[]>([]);
  const [productRows, setProductRows] = useState<CatalogProductRow[]>([]);
  const [licenseRows, setLicenseRows] = useState<LicenseListRow[]>([]);
  const [newItemUri, setNewItemUri] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newPrice, setNewPrice] = useState("9.99");
  const [newLicenseUri, setNewLicenseUri] = useState("");
  const [newLicenseCid, setNewLicenseCid] = useState("");
  const [newParentListingUri, setNewParentListingUri] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  /** From latest inventory publish — tracks marked “allow individual purchase” on upload. */
  const [prefillCollectionUri, setPrefillCollectionUri] = useState<string | null>(
    null,
  );
  const [prefillIndividualTrackUris, setPrefillIndividualTrackUris] = useState<
    string[]
  >([]);
  const [createIndividualTrackListings, setCreateIndividualTrackListings] =
    useState(false);
  const [individualTracksPriceUsd, setIndividualTracksPriceUsd] =
    useState("1.99");

  const refreshCatalogAndListings = useCallback(async () => {
    if (!agent || !session) return;
    const [list, digital, collections, items, products, licenses] =
      await Promise.all([
        listListingRows(session.did),
        listDigitalItemRows(session.did),
        listCollectionRows(session.did),
        listCatalogItemRows(),
        listCatalogProductRows(),
        listLicensesWithStatus(session.did),
      ]);
    setRows(list);
    setProductRows(products);
    const t: Record<string, string> = {};
    for (const r of list) {
      const item = await getRecordValue<CatalogItem>(r.listing.item.uri);
      t[r.uri] = item?.title ?? r.listing.item.uri;
    }
    setTitles(t);
    setLicenseRows(licenses.filter((l) => !l.retired));
    const listed = new Set(list.map((r) => r.listing.item.uri));
    const opts: CatalogPick[] = [
      ...digital
        .filter((r) => !listed.has(r.uri))
        .map((r) => ({
          uri: r.uri,
          title: r.item.title,
          kind: "digital" as const,
        })),
      ...collections
        .filter((r) => !listed.has(r.uri))
        .map((r) => ({
          uri: r.uri,
          title: r.item.title,
          kind: "collection" as const,
        })),
      ...items
        .filter((r) => !listed.has(r.uri))
        .map((r) => ({ uri: r.uri, title: r.title, kind: "item" as const })),
      ...products
        .filter((r) => !listed.has(r.uri))
        .map((r) => ({ uri: r.uri, title: r.title, kind: "product" as const })),
    ];
    opts.sort((a, b) => a.title.localeCompare(b.title));
    setCatalogOptions(opts);
  }, [agent, session]);

  useEffect(() => {
    void refreshCatalogAndListings();
  }, [refreshCatalogAndListings]);

  const applyInventoryPrefill = useCallback((p: InventoryPrefillPayload) => {
    setNewItemUri(p.primaryItemUri);
    setNewLicenseUri(
      typeof p.licenseUri === "string" ? p.licenseUri : "",
    );
    setNewLicenseCid(
      typeof p.licenseGrantCid === "string" ? p.licenseGrantCid : "",
    );
    setNewPrice(typeof p.priceUsd === "string" ? p.priceUsd : "9.99");
    setPrefillCollectionUri(p.primaryItemUri);
    const uris = Array.isArray(p.individualPurchaseTrackUris)
      ? p.individualPurchaseTrackUris.filter(
          (u): u is string => typeof u === "string" && u.length > 0,
        )
      : [];
    setPrefillIndividualTrackUris(uris);
    setCreateIndividualTrackListings(false);
  }, []);

  /** Load latest inventory publish into the form when the page is shown, unless a specific item was linked in. */
  useEffect(() => {
    if (!agent || !session?.did) return;
    const q = new URLSearchParams(location.search);
    if (q.get("source") === "upload" || q.get("prefillItemUri")) return;
    let cancelled = false;
    void fetchLatestInventoryPrefill()
      .then((data) => {
        if (cancelled || !data.prefill?.primaryItemUri) return;
        applyInventoryPrefill(data.prefill);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, session?.did, applyInventoryPrefill]);

  useEffect(() => {
    if (!agent || !session) return;
    const q = new URLSearchParams(location.search);
    const sourceUpload = q.get("source") === "upload";
    const legacyItem = q.get("prefillItemUri");
    if (!sourceUpload && !legacyItem) return;

    let cancelled = false;
    void (async () => {
      try {
        if (sourceUpload) {
          const data = await fetchLatestInventoryPrefill();
          if (cancelled) return;
          const p = data.prefill;
          if (p && typeof p.primaryItemUri === "string") {
            applyInventoryPrefill(p);
            return;
          }
        }
        if (legacyItem) {
          setNewItemUri(legacyItem);
          setPrefillCollectionUri(null);
          setPrefillIndividualTrackUris([]);
          const licenseUri = q.get("licenseUri");
          const licenseGrantCid = q.get("licenseGrantCid");
          const priceUsd = q.get("priceUsd");
          if (licenseUri && licenseGrantCid) {
            setNewLicenseUri(licenseUri);
            setNewLicenseCid(licenseGrantCid);
          }
          if (priceUsd) setNewPrice(priceUsd);
        }
      } catch {
        if (!cancelled && legacyItem) {
          setNewItemUri(legacyItem);
          setPrefillCollectionUri(null);
          setPrefillIndividualTrackUris([]);
        }
      } finally {
        if (!cancelled) navigate("/merchant/listings/new", { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.search, agent, session, navigate, applyInventoryPrefill]);

  useEffect(() => {
    if (!agent || !newItemUri) {
      setNewTitle("");
      return;
    }
    let cancelled = false;
    void getRecordValue<CatalogItem>(newItemUri).then((item) => {
      if (!cancelled) setNewTitle(item?.title ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [agent, newItemUri]);

  const selectCatalogOptions = useMemo(() => {
    if (
      newItemUri &&
      !catalogOptions.some((o) => o.uri === newItemUri)
    ) {
      return [
        {
          uri: newItemUri,
          title: newTitle || "(from link)",
          kind: catalogItemKindFromAtUri(newItemUri),
        },
        ...catalogOptions,
      ];
    }
    return catalogOptions;
  }, [catalogOptions, newItemUri, newTitle]);

  const collectionListingOptions = useMemo(
    () =>
      rows.filter(
        (r) => collectionFromAtUri(r.listing.item.uri) === BAZAAR_COLLECTION.collection,
      ),
    [rows],
  );

  const productListingOptions = useMemo(
    () =>
      rows.filter(
        (r) => collectionFromAtUri(r.listing.item.uri) === BAZAAR_COLLECTION.product,
      ),
    [rows],
  );

  const newItemKind = useMemo(() => {
    const o = selectCatalogOptions.find((x) => x.uri === newItemUri);
    return o?.kind;
  }, [selectCatalogOptions, newItemUri]);

  /** Item -> its containing product's catalog.product URI. An item is only ever created via exactly one product, so this is unambiguous. */
  const productUriByItemUri = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of productRows) {
      for (const ref of p.items) m.set(ref.uri, p.uri);
    }
    return m;
  }, [productRows]);

  /** Default the parent picker to the item's actual containing product's listing (if it has one) -- there's no ambiguity to ask the merchant to resolve, unlike legacy digital tracks which may not belong to any collection at all. */
  useEffect(() => {
    if (newItemKind !== "item") return;
    const productUri = productUriByItemUri.get(newItemUri);
    const productListing = productUri
      ? rows.find(
          (r) =>
            collectionFromAtUri(r.listing.item.uri) === BAZAAR_COLLECTION.product &&
            r.listing.item.uri === productUri,
        )
      : undefined;
    setNewParentListingUri(productListing?.uri ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newItemKind, newItemUri]);

  /** A single track/item can be sold under a parent collection/product listing -- same cascade-pause mechanics either way, just a different parent record type. */
  const parentListingOptions =
    newItemKind === "digital"
      ? collectionListingOptions
      : newItemKind === "item"
        ? productListingOptions
        : [];
  const showParentListingPicker =
    newItemKind === "digital" || newItemKind === "item";

  const showBulkIndividualTracks =
    newItemKind === "collection" &&
    prefillCollectionUri != null &&
    newItemUri === prefillCollectionUri &&
    prefillIndividualTrackUris.length > 0;

  async function submitNewListing() {
    if (!agent || !session) return;
    if (!newItemUri.trim()) {
      toast.error("Choose a catalog item");
      return;
    }
    if (!newLicenseUri || !newLicenseCid) {
      toast.error("Choose a license");
      return;
    }
    const dollars = parseFloat(newPrice);
    if (!Number.isFinite(dollars) || dollars < 0) {
      toast.error("Invalid price");
      return;
    }

    const doBulkTracks =
      showBulkIndividualTracks && createIndividualTrackListings;
    let trackCents = 0;
    if (doBulkTracks) {
      const td = parseFloat(individualTracksPriceUsd);
      if (!Number.isFinite(td) || td < 0) {
        toast.error("Invalid individual track price");
        return;
      }
      trackCents = Math.round(td * 100);
    }

    setCreateBusy(true);
    try {
      const itemRef = await buildItemRefFromUri(newItemUri);
      if (!itemRef?.cid) {
        toast.error("Could not load catalog item");
        return;
      }
      const cents = Math.round(dollars * 100);
      const parentForPrimary = showParentListingPicker
        ? newParentListingUri.trim() || undefined
        : undefined;

      const { uri: createdListingUri } = await createListing(agent, {
        item: itemRef,
        price: { amount: cents, currency: "USD" },
        status: "active",
        licenseUri: newLicenseUri,
        licenseGrantCid: newLicenseCid,
        parentListing: parentForPrimary,
      });

      let createdTrackCount = 0;
      if (doBulkTracks && createdListingUri) {
        const listedUris = new Set(rows.map((r) => r.listing.item.uri));
        listedUris.add(newItemUri);
        for (const trackUri of prefillIndividualTrackUris) {
          if (listedUris.has(trackUri)) continue;
          const tRef = await buildItemRefFromUri(trackUri);
          if (!tRef?.cid) continue;
          await createListing(agent, {
            item: tRef,
            price: { amount: trackCents, currency: "USD" },
            status: "active",
            licenseUri: newLicenseUri,
            licenseGrantCid: newLicenseCid,
            parentListing: createdListingUri,
          });
          createdTrackCount += 1;
          listedUris.add(trackUri);
        }
      }

      if (doBulkTracks) {
        if (createdTrackCount > 0) {
          toast.success(
            `Created collection listing and ${createdTrackCount} track listing(s).`,
          );
        } else {
          toast.success(
            "Collection listing created. No new track listings (already listed or items missing).",
          );
        }
      } else {
        toast.success("Listing created");
      }
      navigate("/merchant/listings");
    } catch (e) {
      toast.error("Could not create listing", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setCreateBusy(false);
    }
  }

  async function applyLatestPublishPrefill() {
    try {
      const data = await fetchLatestInventoryPrefill();
      const p = data.prefill;
      if (!p || typeof p.primaryItemUri !== "string") {
        toast.message("No inventory publish prefill found yet.");
        return;
      }
      applyInventoryPrefill(p);
      toast.success("Form filled from your latest publish.");
    } catch (e) {
      toast.error("Could not load prefill", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  if (!session || !agent) return null;

  const canSubmitCreate =
    Boolean(newItemUri.trim() && newLicenseUri && newLicenseCid) &&
    !createBusy &&
    !(
      showBulkIndividualTracks &&
      createIndividualTrackListings &&
      (!Number.isFinite(parseFloat(individualTracksPriceUsd)) ||
        parseFloat(individualTracksPriceUsd) < 0)
    );

  return (
    <div className="w-full min-w-0 max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">New listing</h1>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void applyLatestPublishPrefill()}
          >
            Prefill from latest publish
          </Button>
          <Link
            to="/merchant/listings"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            Cancel
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Listing details</CardTitle>
          <CardDescription>
            Pick a catalog item that is not already listed, choose license terms, set
            a price, then publish the listing to your PDS.{" "}
            <Link
              to="/merchant/inventory"
              className="text-foreground underline underline-offset-2"
            >
              Inventory
            </Link>{" "}
            shows everything in your repo;{" "}
            <Link
              to="/merchant/upload/tracks"
              className="text-foreground underline underline-offset-2"
            >
              Upload
            </Link>{" "}
            adds new tracks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="new-listing-item">Catalog item</Label>
            <select
              id="new-listing-item"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={newItemUri}
              onChange={(e) => setNewItemUri(e.target.value)}
            >
              <option value="">Select item…</option>
              {selectCatalogOptions.map((o) => (
                <option key={o.uri} value={o.uri}>
                  {o.title} ({CATALOG_PICK_LABEL[o.kind]})
                </option>
              ))}
            </select>
            {newItemUri ? (
              <p className="text-xs text-muted-foreground break-all">{newItemUri}</p>
            ) : null}
          </div>

          {showBulkIndividualTracks ? (
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
              <p className="text-sm font-medium">
                Individual tracks ({prefillIndividualTrackUris.length})
              </p>
              <p className="text-xs text-muted-foreground">
                These tracks were marked for individual sale when you published the
                collection. Create the collection listing first, then optionally add
                matching track listings with the same license.
              </p>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-input"
                  checked={createIndividualTrackListings}
                  onChange={(e) =>
                    setCreateIndividualTrackListings(e.target.checked)
                  }
                />
                <span>
                  Create listings for individual sale tracks
                  <span className="block text-xs text-muted-foreground font-normal mt-1">
                    Each track gets an active listing with{" "}
                    <code className="text-[11px]">parentListing</code> set to this
                    album listing.
                  </span>
                </span>
              </label>
              {createIndividualTrackListings ? (
                <div className="space-y-2 max-w-xs">
                  <Label htmlFor="individual-tracks-price">
                    Price for each track (USD)
                  </Label>
                  <Input
                    id="individual-tracks-price"
                    inputMode="decimal"
                    value={individualTracksPriceUsd}
                    onChange={(e) => setIndividualTracksPriceUsd(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Same price applied to all {prefillIndividualTrackUris.length}{" "}
                    track(s). Album price is set above.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {showParentListingPicker ? (
            <div className="space-y-2">
              <Label htmlFor="new-parent-listing">
                {newItemKind === "digital"
                  ? "Parent collection listing"
                  : "Parent product listing"}
              </Label>
              <select
                id="new-parent-listing"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={newParentListingUri}
                onChange={(e) => setNewParentListingUri(e.target.value)}
              >
                <option value="">None (list as a standalone single)</option>
                {parentListingOptions.map((r) => (
                  <option key={r.uri} value={r.uri}>
                    {titles[r.uri] ?? r.listing.item.uri}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {newItemKind === "digital"
                  ? "Set when selling a track as a single under an album listing. Pausing the album listing pauses linked track listings."
                  : "Set when selling an item as a single under a product listing. Pausing the product listing pauses linked item listings."}
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>License</Label>
            {licenseRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No licenses yet.{" "}
                <Link to="/merchant/license" className="underline underline-offset-2">
                  Create one
                </Link>
                .
              </p>
            ) : (
              <div className="grid gap-2 max-h-40 overflow-y-auto sm:grid-cols-2">
                {licenseRows.map((row) => {
                  const picked =
                    newLicenseUri === row.uri && newLicenseCid === row.cid;
                  return (
                    <button
                      key={row.uri}
                      type="button"
                      onClick={() => {
                        setNewLicenseUri(row.uri);
                        setNewLicenseCid(row.cid);
                      }}
                      className={cn(
                        "rounded-lg border p-3 text-left text-sm transition-colors",
                        picked && "ring-2 ring-ring bg-muted/40",
                      )}
                    >
                      <span className="font-medium">{row.title}</span>
                      <span className="block text-xs text-muted-foreground mt-1">
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

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="space-y-2 flex-1 min-w-[8rem] max-w-xs">
              <Label htmlFor="new-listing-price">Price (USD)</Label>
              <Input
                id="new-listing-price"
                inputMode="decimal"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
              />
            </div>
            <Button
              type="button"
              disabled={!canSubmitCreate}
              onClick={() => void submitNewListing()}
            >
              {createBusy
                ? showBulkIndividualTracks && createIndividualTrackListings
                  ? "Creating listings…"
                  : "Creating…"
                : showBulkIndividualTracks && createIndividualTrackListings
                  ? "Create album + track listings"
                  : "Create listing"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
