import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import { toast } from "sonner";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import {
  getRecordValue,
  listListingRows,
  listPurchaseReceiptRows,
  type ListingRow,
} from "@/lib/atproto/records";
import { createBrowserApiURL } from "@/lib/browserApi";
import { useAtpSession } from "@/hooks/useAtpSession";
import { useMerchantAgent } from "@/hooks/useMerchantAgent";
import { fetchBlobObjectUrl } from "@/lib/atproto/blobUrl";
import { fetchActorPublicProfile } from "@/lib/actorTypeahead";
import { pdslsRepoCollectionsUrl } from "@/lib/pdsls";
import {
  buildDummyDigitalItem,
  buildDummyListing,
  buildDummyLicenseTerms,
  catalogDummyEnabled,
  DUMMY_LISTING_AT,
  isDummyStorefrontItem,
} from "@/lib/devCatalogDummy";
import { resolveStorefrontArtistDid } from "@/lib/atUri";
import { createPublicAgent } from "@/lib/atproto/session";
import { ArtworkImage } from "@/components/public/ArtworkImage";
import { BuyButton } from "@/components/public/BuyButton";
import { FormatBadge } from "@/components/shared/FormatBadge";
import { MetadataChip } from "@/components/shared/MetadataChip";
import {
  CollectionMemberDownloads,
  TrackList,
} from "@/components/public/TrackList";
import { Button } from "@/components/ui/button";
import type {
  ActorMerchant,
  CatalogItem,
  DigitalItem,
  LicenseTerms,
  Listing,
} from "@/types/lexicons";

function formatMoney(m: { amount: number; currency: string }): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: m.currency,
  }).format(m.amount / 100);
}

export function ItemDetailPage() {
  const { uri: uriParam } = useParams<{ uri: string }>();
  const itemUri = uriParam ? decodeURIComponent(uriParam) : "";
  const artistDid = resolveStorefrontArtistDid(itemUri);
  const agent = useMemo(() => createPublicAgent(), []);
  const { session } = useAtpSession();
  const buyerAgent = useMerchantAgent(session);

  const [item, setItem] = useState<CatalogItem | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [listingUri, setListingUri] = useState<string | null>(null);
  const [allArtistListings, setAllArtistListings] = useState<ListingRow[]>([]);
  const [ownsCollection, setOwnsCollection] = useState(false);
  const [license, setLicense] = useState<LicenseTerms | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadBusyUri, setDownloadBusyUri] = useState<string | null>(null);
  const [zipBusy, setZipBusy] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
  const [relayAvatarUrl, setRelayAvatarUrl] = useState<string | null>(null);
  const [relayAvatarBroken, setRelayAvatarBroken] = useState(false);
  const [bazaarAvatarObjectUrl, setBazaarAvatarObjectUrl] = useState<
    string | null
  >(null);
  const [authorDisplayName, setAuthorDisplayName] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!itemUri) {
      setLoading(false);
      return;
    }
    if (!artistDid.startsWith("did:")) {
      setLoading(false);
      return;
    }
    const dummyTarget =
      catalogDummyEnabled() && isDummyStorefrontItem(itemUri, artistDid);
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        let v = await getRecordValue<CatalogItem>(agent, itemUri);
        if (cancelled) return;
        if (!v && dummyTarget) {
          v = buildDummyDigitalItem(itemUri, artistDid);
        }
        setItem(v ?? null);

        const rows = await listListingRows(agent, artistDid);
        if (cancelled) return;
        setAllArtistListings(rows);
        const row = rows.find((r) => r.listing.item.uri === itemUri);
        let listingRow: Listing | null = row?.listing ?? null;
        let listingUriVal: string | null = row?.uri ?? null;
        if (!listingRow && dummyTarget) {
          listingRow = buildDummyListing(itemUri);
          listingUriVal = DUMMY_LISTING_AT;
        }
        setListing(listingRow);
        setListingUri(listingUriVal);

        if (
          v &&
          "$type" in v &&
          v.$type === "diamonds.whereditgo.bazaar.catalog.collection" &&
          buyerAgent &&
          session?.did
        ) {
          const receipts = await listPurchaseReceiptRows(
            buyerAgent,
            session.did,
          );
          if (!cancelled) {
            setOwnsCollection(
              receipts.some(
                (r) =>
                  r.receipt.item.uri === itemUri &&
                  r.receipt.item.itemType === BAZAAR_COLLECTION.collection,
              ),
            );
          }
        } else if (!cancelled) {
          setOwnsCollection(false);
        }

        let licUri = listingRow?.licenseUri;
        if (
          !licUri &&
          v &&
          "$type" in v &&
          v.$type === "diamonds.whereditgo.bazaar.catalog.item.digital"
        ) {
          licUri = (v as DigitalItem).defaultLicenseUri;
        }
        if (licUri) {
          const lt = await getRecordValue<LicenseTerms>(agent, licUri);
          if (cancelled) return;
          setLicense(
            lt ?? (dummyTarget ? buildDummyLicenseTerms() : null),
          );
        } else {
          setLicense(dummyTarget ? buildDummyLicenseTerms() : null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, itemUri, artistDid, buyerAgent, session?.did]);

  useEffect(() => {
    setRelayAvatarBroken(false);
  }, [relayAvatarUrl]);

  useEffect(() => {
    const authorDid = item?.artistDid?.trim();
    if (!authorDid?.startsWith("did:")) {
      setRelayAvatarUrl(null);
      setAuthorDisplayName(null);
      setBazaarAvatarObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    let cancelled = false;
    const ac = new AbortController();

    setRelayAvatarUrl(null);
    setAuthorDisplayName(null);
    setBazaarAvatarObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    void (async () => {
      const emptyProfile = {
        avatar: null as string | null,
        handle: null as string | null,
        displayName: null as string | null,
      };
      const [profile, merchantList] = await Promise.all([
        fetchActorPublicProfile(authorDid, ac.signal).catch(() => emptyProfile),
        agent.com.atproto.repo
          .listRecords({
            repo: authorDid,
            collection: BAZAAR_COLLECTION.actorMerchant,
            limit: 1,
          })
          .catch(() => ({ data: { records: [] as { value?: unknown }[] } })),
      ]);
      if (cancelled) return;

      const v = merchantList.data.records[0]?.value as
        | ActorMerchant
        | undefined;
      const merchantName = v?.displayName?.trim() || null;
      const relayName = profile.displayName?.trim() || null;
      setAuthorDisplayName(merchantName ?? relayName);

      if (profile.avatar) setRelayAvatarUrl(profile.avatar);

      const cid = v?.avatarCid;
      if (!cid) return;
      try {
        const url = await fetchBlobObjectUrl(agent, authorDid, cid);
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        if (!url) return;
        setBazaarAvatarObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch {
        if (!cancelled) {
          setBazaarAvatarObjectUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
      setRelayAvatarUrl(null);
      setAuthorDisplayName(null);
      setBazaarAvatarObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [agent, item?.artistDid]);

  const isCollection =
    item?.$type === "diamonds.whereditgo.bazaar.catalog.collection";

  const purchaseByTrackUri = useMemo(() => {
    const m = new Map<string, { listingUri: string; listing: Listing }>();
    if (!isCollection || !listingUri) return m;
    for (const row of allArtistListings) {
      const L = row.listing;
      if (L.status !== "active") continue;
      if (L.parentListing !== listingUri) continue;
      if (L.item.itemType !== BAZAAR_COLLECTION.digitalItem) continue;
      m.set(L.item.uri, { listingUri: row.uri, listing: L });
    }
    return m;
  }, [isCollection, listingUri, allArtistListings]);

  if (!itemUri) {
    return <p className="text-muted-foreground">Missing item.</p>;
  }

  if (!artistDid.startsWith("did:")) {
    return (
      <p className="text-muted-foreground">
        Invalid item URL. Use an AT-URI such as{" "}
        <code className="text-xs">at://did:plc:…/diamonds.whereditgo.bazaar.catalog.item.digital/…</code>
        , or set <code className="text-xs">VITE_ARTIST_DID</code> in{" "}
        <code className="text-xs">.env</code>.
      </p>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse" aria-busy>
        <div className="aspect-[21/9] w-full rounded-xl bg-muted" />
        <div className="h-8 bg-muted rounded w-1/2" />
        <div className="h-4 bg-muted rounded w-1/3" />
      </div>
    );
  }

  if (!item) {
    return <p className="text-muted-foreground">Item not found.</p>;
  }

  const title = item.title;
  const authorDid = item.artistDid;
  const authorInitial =
    authorDisplayName?.trim()?.charAt(0)?.toUpperCase() ?? "?";

  async function downloadDigitalItemUri(targetUri: string) {
    if (!session) {
      toast.error("Sign in to download");
      return;
    }
    setDownloadBusyUri(targetUri);
    try {
      const url = createBrowserApiURL("/api/download");
      url.searchParams.set("itemUri", targetUri);
      const res = await fetch(url.href, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const { url: signed } = (await res.json()) as { url: string };
      window.location.href = signed;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloadBusyUri(null);
    }
  }

  async function downloadCollectionZip() {
    if (!session) {
      toast.error("Sign in to download");
      return;
    }
    setZipBusy(true);
    try {
      const url = createBrowserApiURL("/api/download/collection-zip");
      url.searchParams.set("collectionUri", itemUri);
      const res = await fetch(url.href, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const blob = await res.blob();
      const dispo = res.headers.get("Content-Disposition");
      const match = dispo?.match(/filename="([^"]+)"/);
      const name = match?.[1] ?? "collection.zip";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setZipBusy(false);
    }
  }

  const blobDid =
    item.$type === "diamonds.whereditgo.bazaar.catalog.item.digital"
      ? item.artistDid
      : artistDid ?? "";

  const showDummyBanner =
    catalogDummyEnabled() && isDummyStorefrontItem(itemUri, artistDid);

  return (
    <article className="space-y-10">
      {showDummyBanner ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
          Preview catalog: listing and license are synthetic. For Stripe without
          publishing to your PDS, set{" "}
          <code className="text-xs">BAZAAR_DEV_CHECKOUT_STUB=true</code> on the
          API server; otherwise create real{" "}
          <code className="text-xs">catalog.listing</code> /{" "}
          <code className="text-xs">license.terms</code> records.
        </p>
      ) : null}
      <section className="grid gap-8 lg:grid-cols-[1fr_minmax(0,24rem)] lg:items-start">
        <div className="overflow-hidden rounded-xl border border-border bg-muted aspect-square max-h-[min(70vw,28rem)]">
          <ArtworkImage
            agent={agent}
            did={blobDid}
            cid={item.artworkCid}
            itemUri={itemUri}
            alt=""
            className="h-full w-full"
          />
        </div>
        <div className="space-y-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
            {authorDid.startsWith("did:") ? (
              <div className="mt-3 flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3">
                {relayAvatarUrl && !relayAvatarBroken ? (
                  <img
                    src={relayAvatarUrl}
                    alt=""
                    className="size-12 shrink-0 rounded-full object-cover ring-1 ring-border"
                    onError={() => setRelayAvatarBroken(true)}
                  />
                ) : bazaarAvatarObjectUrl ? (
                  <img
                    src={bazaarAvatarObjectUrl}
                    alt=""
                    className="size-12 shrink-0 rounded-full object-cover ring-1 ring-border"
                  />
                ) : (
                  <span
                    className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground ring-1 ring-border"
                    aria-hidden
                  >
                    {authorInitial}
                  </span>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Published By
                  </p>
                  <p className="truncate text-sm font-medium text-foreground">
                    {authorDisplayName ?? "—"}
                  </p>
                  <p className="text-sm">
                    <a
                      href={pdslsRepoCollectionsUrl(authorDid)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all font-mono text-xs text-primary underline-offset-2 hover:underline"
                      title="Open repo in pdsls"
                    >
                      {authorDid}
                    </a>
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-muted-foreground">{authorDid}</p>
            )}
          </div>
          {listing ? (
            <p className="text-2xl font-medium">
              {formatMoney(listing.price)}
            </p>
          ) : (
            <div className="space-y-2 text-muted-foreground">
              <p>Not currently for sale.</p>
              <p className="text-sm">
                Publish an active <code className="text-xs">catalog.listing</code>{" "}
                (with <code className="text-xs">licenseUri</code> and{" "}
                <code className="text-xs">licenseGrantCid</code>) on the artist
                repo, or use{" "}
                <Link
                  to="/merchant/upload/tracks"
                  className="text-primary underline underline-offset-2"
                >
                  Upload
                </Link>{" "}
                as the merchant.
              </p>
            </div>
          )}
          {"formats" in item && item.formats?.length ? (
            <div className="flex flex-wrap gap-2">
              {item.formats.map((f: string) => (
                <FormatBadge key={f} format={f} />
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="flex flex-wrap gap-2" aria-label="Metadata">
        {"releaseDate" in item && item.releaseDate ? (
          <MetadataChip>Release {item.releaseDate}</MetadataChip>
        ) : null}
        {"durationMs" in item && item.durationMs ? (
          <MetadataChip>
            {Math.round(item.durationMs / 60000)} min
          </MetadataChip>
        ) : null}
        {isCollection ? (
          <MetadataChip>
            {item.items.filter((i) => i.role === "track").length} tracks
          </MetadataChip>
        ) : null}
        {item.genre?.map((g) => (
          <MetadataChip key={g}>{g}</MetadataChip>
        ))}
      </section>

      {isCollection ? (
        <section className="space-y-4">
          <h2 className="text-lg font-medium">
            {ownsCollection ? "Your downloads" : "Tracks"}
          </h2>
          {ownsCollection ? (
            <CollectionMemberDownloads
              agent={agent}
              collection={item}
              onDownloadItem={(u) => void downloadDigitalItemUri(u)}
              onDownloadZip={() => void downloadCollectionZip()}
              zipBusy={zipBusy}
              itemBusyUri={downloadBusyUri}
            />
          ) : (
            <TrackList
              agent={agent}
              collection={item}
              purchaseByTrackUri={purchaseByTrackUri}
            />
          )}
        </section>
      ) : null}

      {"description" in item && item.description ? (
        <section className="prose prose-neutral dark:prose-invert max-w-none text-sm">
          <h2 className="text-lg font-medium mb-2 not-prose">Description</h2>
          <Markdown>{item.description}</Markdown>
        </section>
      ) : null}

      <section>
        <h2 className="text-lg font-medium mb-2">License</h2>
        <p className="text-sm text-muted-foreground">
          {license?.summary ??
            "Personal use license. Download and listen for your own enjoyment."}
        </p>
      </section>

      {"isrc" in item && item.isrc ? (
        <section>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-2 -ml-2"
            onClick={() => setLegalOpen((o) => !o)}
            aria-expanded={legalOpen}
          >
            Legal identifiers {legalOpen ? "▼" : "▶"}
          </Button>
          {legalOpen ? (
            <ul className="text-sm text-muted-foreground space-y-1">
              {item.isrc ? <li>ISRC: {item.isrc}</li> : null}
            </ul>
          ) : null}
        </section>
      ) : null}

      {listing && listingUri && !(isCollection && ownsCollection) ? (
        <section>
          <BuyButton
            listingUri={listingUri}
            listing={listing}
            item={item}
            licenseTerms={license}
          />
        </section>
      ) : null}
    </article>
  );
}
