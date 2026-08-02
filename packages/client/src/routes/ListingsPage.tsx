import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { CompletenessIndicator } from "@/components/merchant/CompletenessIndicator";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import {
  fetchLatestInventoryPrefill,
  type InventoryPrefillPayload,
} from "@/lib/api/inventoryApi";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import { scoreCompleteness } from "@/hooks/useCompletenessScore";
import {
  buildItemRefFromUri,
  createListing,
  getRecordValue,
  listCollectionRows,
  listDigitalItemRows,
  listLicenseTermsRows,
  listListingRows,
  putListing,
  type LicenseTermsRow,
  type ListingRow,
} from "@/lib/atproto/records";
import {
  buildDummyListing,
  catalogDummyEnabled,
  DUMMY_LISTING_AT,
  isDummyListingRowUri,
  resolveDummyItemAtUri,
} from "@/lib/devCatalogDummy";
import { catalogItemRkey, itemPathPretty } from "@/lib/itemPath";
import { cn } from "@/lib/utils";
import type { CatalogItem, Listing } from "@/types/lexicons";
import { toast } from "sonner";

function isDummyListingRow(row: ListingRow): boolean {
  return isDummyListingRowUri(row.uri);
}

function devDummyListingRow(merchantDid: string | undefined): ListingRow | null {
  if (!catalogDummyEnabled() || !merchantDid?.startsWith("did:")) return null;
  const itemUri = resolveDummyItemAtUri(merchantDid);
  if (!itemUri) return null;
  return {
    uri: DUMMY_LISTING_AT,
    cid: "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    listing: buildDummyListing(itemUri),
  };
}

function formatMoney(m: { amount: number; currency: string }): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: m.currency,
  }).format(m.amount / 100);
}

type CatalogPick = {
  uri: string;
  title: string;
  kind: "digital" | "collection";
};

function catalogItemKindFromAtUri(uri: string): CatalogPick["kind"] {
  if (uri.includes(`${BAZAAR_COLLECTION.collection}/`)) return "collection";
  return "digital";
}

async function loadListingTitles(
  sessionDid: string,
  list: ListingRow[],
): Promise<Record<string, string>> {
  const t: Record<string, string> = {};
  const dummyRow = devDummyListingRow(sessionDid);
  const forTitles = list.length > 0 ? list : dummyRow ? [dummyRow] : [];
  for (const r of forTitles) {
    const item = await getRecordValue<CatalogItem>(r.listing.item.uri);
    t[r.uri] =
      item?.title ??
      (isDummyListingRow(r) ? "Sample listing (dev)" : r.listing.item.uri);
  }
  return t;
}

export function ListingsPage() {
  const { session } = useAtpSession();
  const agent = useMerchantAgent(session);
  const location = useLocation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ListingRow[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [catalogOptions, setCatalogOptions] = useState<CatalogPick[]>([]);
  const [licenseRows, setLicenseRows] = useState<LicenseTermsRow[]>([]);
  const [editRow, setEditRow] = useState<ListingRow | null>(null);
  const [editDollars, setEditDollars] = useState("");
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

  const refreshListingsAndCatalog = useCallback(async () => {
    if (!agent || !session) return;
    const [list, digital, collections, licenses] = await Promise.all([
      listListingRows(session.did),
      listDigitalItemRows(session.did),
      listCollectionRows(session.did),
      listLicenseTermsRows(session.did),
    ]);
    setRows(list);
    setTitles(await loadListingTitles(session.did, list));
    setLicenseRows(licenses);
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
    ];
    opts.sort((a, b) => a.title.localeCompare(b.title));
    setCatalogOptions(opts);
  }, [agent, session]);

  useEffect(() => {
    void refreshListingsAndCatalog();
  }, [refreshListingsAndCatalog]);

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

  /** Load latest inventory publish into the form when the page is shown. */
  useEffect(() => {
    if (!agent || !session?.did) return;
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
        const data = await fetchLatestInventoryPrefill();
        if (cancelled) return;
        const p = data.prefill;
        if (p && typeof p.primaryItemUri === "string") {
          applyInventoryPrefill(p);
        } else if (legacyItem) {
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
        if (!cancelled) navigate("/merchant/listings", { replace: true });
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
        (r) => r.listing.item.itemType === BAZAAR_COLLECTION.collection,
      ),
    [rows],
  );

  const newItemKind = useMemo(() => {
    const o = selectCatalogOptions.find((x) => x.uri === newItemUri);
    return o?.kind;
  }, [selectCatalogOptions, newItemUri]);

  const showBulkIndividualTracks =
    newItemKind === "collection" &&
    prefillCollectionUri != null &&
    newItemUri === prefillCollectionUri &&
    prefillIndividualTrackUris.length > 0;

  async function savePrice() {
    if (!agent || !editRow) return;
    const dollars = parseFloat(editDollars);
    if (!Number.isFinite(dollars) || dollars < 0) {
      toast.error("Invalid price");
      return;
    }
    const cents = Math.round(dollars * 100);
    const next: Listing = {
      ...editRow.listing,
      price: { ...editRow.listing.price, amount: cents },
    };
    try {
      await putListing(agent, editRow.uri, next);
      setRows((prev) =>
        prev.map((x) =>
          x.uri === editRow.uri ? { ...x, listing: next } : x,
        ),
      );
      setEditRow(null);
      toast.success("Price updated");
    } catch (e) {
      toast.error("Update failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

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
      const parentForPrimary =
        newItemKind === "digital"
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

      setNewItemUri("");
      setNewTitle("");
      setNewLicenseUri("");
      setNewLicenseCid("");
      setNewParentListingUri("");
      setNewPrice("9.99");
      setPrefillCollectionUri(null);
      setPrefillIndividualTrackUris([]);
      setCreateIndividualTrackListings(false);
      setIndividualTracksPriceUsd("1.99");
      await refreshListingsAndCatalog();
    } catch (e) {
      toast.error("Could not create listing", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setCreateBusy(false);
    }
  }

  async function toggleStatus(row: ListingRow) {
    if (!agent) return;
    if (isDummyListingRow(row)) return;
    const nextStatus =
      row.listing.status === "active" ? "paused" : "active";
    const next: Listing = { ...row.listing, status: nextStatus };
    const isCollectionListing =
      row.listing.item.itemType === BAZAAR_COLLECTION.collection;
    const activeChildren = rows.filter(
      (x) =>
        x.listing.parentListing === row.uri && x.listing.status === "active",
    );
    try {
      if (nextStatus === "paused" && isCollectionListing) {
        for (const ch of activeChildren) {
          const paused: Listing = { ...ch.listing, status: "paused" };
          await putListing(agent, ch.uri, paused);
        }
      }
      await putListing(agent, row.uri, next);
      setRows((prev) =>
        prev.map((x) => {
          if (x.uri === row.uri) return { ...x, listing: next };
          if (
            nextStatus === "paused" &&
            isCollectionListing &&
            activeChildren.some((c) => c.uri === x.uri)
          ) {
            return { ...x, listing: { ...x.listing, status: "paused" } };
          }
          return x;
        }),
      );
    } catch (e) {
      toast.error("Could not update status");
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

  const dummy = devDummyListingRow(session.did);
  const displayRows = rows.length > 0 ? rows : dummy ? [dummy] : [];
  const showingListingsDummy = rows.length === 0 && dummy != null;
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
    <div className="w-full min-w-0 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Listings</h1>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void applyLatestPublishPrefill()}
        >
          Prefill from latest publish
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">New listing</CardTitle>
          <CardDescription>
            The latest inventory publish loads automatically when you open this page.
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
                  {o.title} ({o.kind === "digital" ? "Digital" : "Collection"})
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

          {newItemKind === "digital" ? (
            <div className="space-y-2">
              <Label htmlFor="new-parent-listing">Parent collection listing</Label>
              <select
                id="new-parent-listing"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={newParentListingUri}
                onChange={(e) => setNewParentListingUri(e.target.value)}
              >
                <option value="">None (standalone single)</option>
                {collectionListingOptions.map((r) => (
                  <option key={r.uri} value={r.uri}>
                    {titles[r.uri] ?? r.listing.item.uri}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Set when selling a track as a single under an album listing. Pausing the
                album listing pauses linked track listings.
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>License</Label>
            {licenseRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Save templates on{" "}
                <Link to="/merchant/license" className="underline underline-offset-2">
                  License templates
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
                      <span className="font-medium">{row.terms.title}</span>
                      <span className="block text-xs text-muted-foreground mt-1">
                        {row.terms.tier} · {row.terms.version}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
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

      {showingListingsDummy ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
          Preview row only (not stored in your repo). Uses your signed-in DID for the
          sample item URI unless <code className="text-xs">VITE_DEV_DUMMY_ITEM_URI</code>{" "}
          or <code className="text-xs">VITE_ARTIST_DID</code> is set. Create a real
          listing here after you publish catalog items from Upload.
        </p>
      ) : null}
      {displayRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          <p>No listings yet.</p>
          <p className="mt-2 text-xs">
            Run <code className="text-foreground">npm run dev</code> (Vite dev mode) to
            see a dummy row here, or set{" "}
            <code className="text-foreground">VITE_SHOW_LISTINGS_DUMMY=true</code> for
            preview/production builds.
          </p>
          <Link
            to="/merchant/upload/tracks"
            className={cn(buttonVariants(), "mt-4 inline-flex")}
          >
            Upload an item
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left p-3 font-medium">Item</th>
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-left p-3 font-medium">Price</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Completeness</th>
                <th className="text-right p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={row.uri} className="border-b border-border">
                  <td className="p-3">
                    {isDummyListingRow(row)
                      ? (titles[row.uri] ?? "Sample listing (dev)")
                      : (titles[row.uri] ?? "…")}
                    {isDummyListingRow(row) ? (
                      <Badge variant="secondary" className="ml-2 align-middle text-[10px]">
                        dev
                      </Badge>
                    ) : null}
                  </td>
                  <td className="p-3">
                    <Badge variant="outline">{row.listing.item.itemType}</Badge>
                  </td>
                  <td className="p-3">
                    {formatMoney(row.listing.price)}
                  </td>
                  <td className="p-3">
                    <Badge
                      variant={
                        row.listing.status === "active" ? "default" : "secondary"
                      }
                    >
                      {row.listing.status}
                    </Badge>
                  </td>
                  <td className="p-3 min-w-[120px]">
                    <CompletenessIndicator
                      compact
                      score={scoreCompleteness({
                        hasAudioFile: true,
                      })}
                    />
                  </td>
                  <td className="p-3 text-right space-x-2">
                    {isDummyListingRow(row) ? null : (
                      <>
                        <button
                          type="button"
                          className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                          onClick={() => {
                            setEditRow(row);
                            setEditDollars(
                              (row.listing.price.amount / 100).toFixed(2),
                            );
                          }}
                        >
                          Edit price
                        </button>
                        <button
                          type="button"
                          className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
                          onClick={() => void toggleStatus(row)}
                        >
                          {row.listing.status === "active" ? "Pause" : "Activate"}
                        </button>
                      </>
                    )}
                    <Link
                      to={itemPathPretty(
                        catalogItemRkey(row.listing.item.uri),
                        titles[row.uri],
                      )}
                      className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "inline-flex")}
                    >
                      Storefront
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Sheet open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit price</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div>
              <Label htmlFor="edit-price">Price (USD)</Label>
              <Input
                id="edit-price"
                value={editDollars}
                onChange={(e) => setEditDollars(e.target.value)}
                className="mt-1"
              />
            </div>
            <button
              type="button"
              className={cn(buttonVariants())}
              onClick={() => void savePrice()}
            >
              Save
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
