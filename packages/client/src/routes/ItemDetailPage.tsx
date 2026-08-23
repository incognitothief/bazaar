import { useEffect, useMemo, useState } from "react";
import { AtUri } from "@atproto/syntax";
import { Helmet } from "react-helmet-async";
import { Link, Navigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { BAZAAR_COLLECTION } from "@/lib/atproto/ns";
import {
  getCatalogItem,
  getCatalogProduct,
  getRecordValue,
  getRecordValueWithCid,
  listListingRows,
  listPurchaseReceiptRows,
  resolveCatalogItemUriFromRkey,
  type ListingRow,
} from "@/lib/atproto/records";
import { createBrowserApiURL, triggerFileDownload } from "@/lib/browserApi";
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
  DUMMY_ITEM_RKEY,
  DUMMY_LISTING_AT,
  isDummyStorefrontItem,
  resolveDummyItemAtUri,
} from "@/lib/devCatalogDummy";
import { resolveStorefrontArtistDid } from "@/lib/atUri";
import {
  catalogItemRkey,
  isLegacyItemPathSegment,
  itemPathCanonical,
  itemPathPretty,
} from "@/lib/itemPath";
import { createPublicAgent } from "@/lib/atproto/session";
import { agentForRepo } from "@/lib/atproto/pdsResolve";
import {
  defaultOgImageAbsolute,
  firstLineForItemMeta,
  itemSupportsOgArtwork,
  publicSiteOrigin,
  siteBrandName,
  stableArtworkOpenUrl,
  truncMeta,
} from "@/lib/seo";
import { ArtworkImage } from "@/components/public/ArtworkImage";
import { BuyButton } from "@/components/public/BuyButton";
import { FormatBadge } from "@/components/shared/FormatBadge";
import { MarkdownBody } from "@/components/shared/MarkdownBody";
import { MetadataChip } from "@/components/shared/MetadataChip";
import { productTypeConfig } from "@/lib/productTypes";
import {
  CollectionMemberDownloads,
  TrackList,
} from "@/components/public/TrackList";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  catalogItemArtworkCid,
  catalogItemSellerDid,
  type ActorMerchant,
  type CatalogItem,
  type DigitalItem,
  type LicenseTerms,
  type Listing,
} from "@/types/lexicons";

function formatMoney(m: { amount: number; currency: string }): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: m.currency,
  }).format(m.amount / 100);
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function ItemDetailPage() {
  const { rkey: rkeyParam, slug: _slugParam } = useParams<{
    rkey: string;
    slug?: string;
  }>();
  const storefrontDid = import.meta.env.VITE_ARTIST_DID?.trim() ?? "";
  const legacySegment = !!rkeyParam && isLegacyItemPathSegment(rkeyParam);

  const agent = useMemo(() => createPublicAgent(), []);
  const { session } = useAtpSession();
  const buyerAgent = useMerchantAgent(session);

  const [resolvedItemUri, setResolvedItemUri] = useState<string | null>(null);
  const [rkeyResolved, setRkeyResolved] = useState(false);

  const [item, setItem] = useState<CatalogItem | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [listingUri, setListingUri] = useState<string | null>(null);
  const [allArtistListings, setAllArtistListings] = useState<ListingRow[]>([]);
  const [ownsCollection, setOwnsCollection] = useState(false);
  const [ownsProduct, setOwnsProduct] = useState(false);
  /** catalog.product's own cover art, or a catalog.item single's borrowed from its owning product -- neither is ever a PDS blob CID. */
  const [coverImages, setCoverImages] = useState<
    Array<{ objectId: string; url: string }>
  >([]);
  const [productItemMeta, setProductItemMeta] = useState<
    Record<string, { title: string; durationMs: number | null }>
  >({});
  const [productType, setProductType] = useState<string | null>(null);
  const [license, setLicense] = useState<LicenseTerms | null>(null);
  const [licenseCid, setLicenseCid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadBusyUri, setDownloadBusyUri] = useState<string | null>(null);
  const [zipBusy, setZipBusy] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
  const [artworkPreviewOpen, setArtworkPreviewOpen] = useState(false);
  const [relayAvatarUrl, setRelayAvatarUrl] = useState<string | null>(null);
  const [relayAvatarBroken, setRelayAvatarBroken] = useState(false);
  const [bazaarAvatarObjectUrl, setBazaarAvatarObjectUrl] = useState<
    string | null
  >(null);
  const [authorDisplayName, setAuthorDisplayName] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!rkeyParam) {
      setResolvedItemUri(null);
      setRkeyResolved(true);
      return;
    }
    if (legacySegment) {
      setResolvedItemUri(null);
      setRkeyResolved(true);
      return;
    }
    setResolvedItemUri(null);
    setRkeyResolved(false);
    let cancelled = false;
    void (async () => {
      if (!storefrontDid.startsWith("did:")) {
        if (!cancelled) {
          setResolvedItemUri(null);
          setRkeyResolved(true);
        }
        return;
      }
      let uri = await resolveCatalogItemUriFromRkey(
        storefrontDid,
        rkeyParam,
      );
      if (!uri && catalogDummyEnabled() && rkeyParam === DUMMY_ITEM_RKEY) {
        uri = resolveDummyItemAtUri(storefrontDid);
      }
      if (!cancelled) {
        setResolvedItemUri(uri);
        setRkeyResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rkeyParam, storefrontDid, legacySegment]);

  const itemUri = legacySegment ? "" : (resolvedItemUri ?? "");
  const artistDid = resolveStorefrontArtistDid(itemUri);

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
        let v = await getRecordValue<CatalogItem>(itemUri);
        if (cancelled) return;
        if (!v && dummyTarget) {
          v = buildDummyDigitalItem(itemUri, artistDid);
        }
        setItem(v ?? null);

        const rows = await listListingRows(artistDid);
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
          const receipts = await listPurchaseReceiptRows(session.did);
          if (!cancelled) {
            setOwnsCollection(
              receipts.some(
                (r) =>
                  r.receipt.item.uri === itemUri &&
                  new AtUri(r.receipt.item.uri).collection ===
                    BAZAAR_COLLECTION.collection,
              ),
            );
          }
        } else if (!cancelled) {
          setOwnsCollection(false);
        }

        if (v && "$type" in v && v.$type === BAZAAR_COLLECTION.product) {
          if (buyerAgent && session?.did) {
            const receipts = await listPurchaseReceiptRows(session.did);
            if (!cancelled) {
              setOwnsProduct(receipts.some((r) => r.receipt.item.uri === itemUri));
            }
          } else if (!cancelled) {
            setOwnsProduct(false);
          }
          const [p, resolvedItems] = await Promise.all([
            getCatalogProduct(itemUri),
            Promise.all(v.items.map((ref) => getCatalogItem(ref.uri))),
          ]);
          if (!cancelled) {
            setCoverImages(p?.coverImages ?? []);
            setProductType(p?.productType ?? null);
            setProductItemMeta(
              Object.fromEntries(
                v.items.map((ref, i) => [
                  ref.uri,
                  {
                    title: resolvedItems[i]?.title ?? ref.uri,
                    durationMs: resolvedItems[i]?.durationMs ?? null,
                  },
                ]),
              ),
            );
          }
        } else if (v && "$type" in v && v.$type === BAZAAR_COLLECTION.item) {
          setOwnsProduct(false);
          setProductType(null);
          setProductItemMeta({});
          // A single has no cover art of its own -- borrowed from its owning
          // product, resolved server-side (see catalog.ts's GET /items).
          const r = await getCatalogItem(itemUri);
          if (!cancelled) setCoverImages(r?.coverImages ?? []);
        } else if (!cancelled) {
          setOwnsProduct(false);
          setCoverImages([]);
          setProductType(null);
          setProductItemMeta({});
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
          const lt = await getRecordValueWithCid<LicenseTerms>(licUri);
          if (cancelled) return;
          setLicense(lt?.value ?? (dummyTarget ? buildDummyLicenseTerms() : null));
          setLicenseCid(lt?.cid ?? null);
        } else {
          setLicense(dummyTarget ? buildDummyLicenseTerms() : null);
          setLicenseCid(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemUri, artistDid, buyerAgent, session?.did]);

  useEffect(() => {
    setRelayAvatarBroken(false);
  }, [relayAvatarUrl]);

  useEffect(() => {
    const authorDid = (item ? catalogItemSellerDid(item) : undefined)?.trim();
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
      const authorAgent = await agentForRepo(authorDid);
      const [profile, merchantList] = await Promise.all([
        fetchActorPublicProfile(authorDid, ac.signal).catch(() => emptyProfile),
        authorAgent.com.atproto.repo
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
  }, [agent, item ? catalogItemSellerDid(item) : undefined]);

  const isCollection =
    item?.$type === "diamonds.whereditgo.bazaar.catalog.collection";
  const isProduct = item?.$type === BAZAAR_COLLECTION.product;
  const isCatalogItemSingle = item?.$type === BAZAAR_COLLECTION.item;
  const isMusicProduct = isProduct && productTypeConfig(productType).value === "music";

  const purchaseByTrackUri = useMemo(() => {
    const m = new Map<string, { listingUri: string; listing: Listing }>();
    if (!isCollection || !listingUri) return m;
    for (const row of allArtistListings) {
      const L = row.listing;
      if (L.status !== "active") continue;
      if (L.parentListing !== listingUri) continue;
      if (new AtUri(L.item.uri).collection !== BAZAAR_COLLECTION.digitalItem) continue;
      m.set(L.item.uri, { listingUri: row.uri, listing: L });
    }
    return m;
  }, [isCollection, listingUri, allArtistListings]);

  /** Active per-item listings sold as singles under this product's own listing -- same parentListing convention as purchaseByTrackUri above. */
  const purchaseByProductItemUri = useMemo(() => {
    const m = new Map<string, { listingUri: string; listing: Listing }>();
    if (!isProduct || !listingUri) return m;
    for (const row of allArtistListings) {
      const L = row.listing;
      if (L.status !== "active") continue;
      if (L.parentListing !== listingUri) continue;
      if (new AtUri(L.item.uri).collection !== BAZAAR_COLLECTION.item) continue;
      m.set(L.item.uri, { listingUri: row.uri, listing: L });
    }
    return m;
  }, [isProduct, listingUri, allArtistListings]);

  if (legacySegment && rkeyParam) {
    try {
      const at = new AtUri(decodeURIComponent(rkeyParam));
      if (at.rkey) {
        return <Navigate to={itemPathCanonical(at.rkey)} replace />;
      }
    } catch {
      /* invalid legacy segment */
    }
  }

  if (!rkeyParam) {
    return <p className="text-muted-foreground">Missing item.</p>;
  }

  void _slugParam;

  if (!rkeyResolved) {
    return (
      <div className="space-y-6 animate-pulse" aria-busy>
        <Helmet>
          <title>{`Item · ${siteBrandName()}`}</title>
        </Helmet>
        <div className="aspect-[21/9] w-full rounded-xl bg-muted" />
        <div className="h-8 bg-muted rounded w-1/2" />
        <div className="h-4 bg-muted rounded w-1/3" />
      </div>
    );
  }

  if (!legacySegment && !itemUri) {
    return <p className="text-muted-foreground">Item not found.</p>;
  }

  if (legacySegment) {
    return <p className="text-muted-foreground">Invalid item link.</p>;
  }

  if (!artistDid.startsWith("did:")) {
    return (
      <p className="text-muted-foreground">
        Set <code className="text-xs">VITE_ARTIST_DID</code> in{" "}
        <code className="text-xs">packages/client/.env</code> to load catalog
        items. Item URLs use the record TID, e.g.{" "}
        <code className="text-xs">/item/3jui7kd5z2f2x</code>.
      </p>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse" aria-busy>
        <Helmet>
          <title>{`Item · ${siteBrandName()}`}</title>
        </Helmet>
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
  const collectionTrackCount = isCollection
    ? item.items.filter((i) => i.role === "track").length
    : 0;
  const authorDid = catalogItemSellerDid(item);
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
      const { url: signed, filename } = (await res.json()) as {
        url: string;
        filename?: string;
      };
      triggerFileDownload(signed, filename);
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

  async function downloadProductZip() {
    if (!session) {
      toast.error("Sign in to download");
      return;
    }
    setZipBusy(true);
    try {
      const url = createBrowserApiURL("/api/download/product-zip");
      url.searchParams.set("productUri", itemUri);
      const res = await fetch(url.href, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const blob = await res.blob();
      const dispo = res.headers.get("Content-Disposition");
      const match = dispo?.match(/filename="([^"]+)"/);
      const name = match?.[1] ?? "product.zip";
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

  const isDigital = item.$type === BAZAAR_COLLECTION.digitalItem;

  const blobDid = isDigital ? item.artistDid : (artistDid ?? "");

  const showDummyBanner =
    catalogDummyEnabled() && isDummyStorefrontItem(itemUri, artistDid);

  const pageRkey = catalogItemRkey(itemUri);
  const canonicalRel = itemPathPretty(pageRkey, item.title);
  const canonicalAbs = `${publicSiteOrigin()}${canonicalRel}`;
  const metaDesc =
    firstLineForItemMeta(item.description) ||
    `Available on ${siteBrandName()}.`;
  const ogImage = itemSupportsOgArtwork(item)
    ? stableArtworkOpenUrl(itemUri)
    : defaultOgImageAbsolute();
  const twSite = import.meta.env.VITE_PUBLIC_TWITTER_SITE?.trim();

  const coverUrl =
    (isProduct || isCatalogItemSingle) && coverImages[0]
      ? coverImages[0].url
      : null;
  const artworkCid = catalogItemArtworkCid(item);
  const hasArtwork = !!coverUrl || !!artworkCid;

  return (
    <article className="space-y-10">
      <Helmet>
        <title>{`${item.title} · ${siteBrandName()}`}</title>
        <meta name="description" content={truncMeta(metaDesc, 160)} />
        <link rel="canonical" href={canonicalAbs} />
        <meta property="og:type" content="article" />
        <meta property="og:site_name" content={siteBrandName()} />
        <meta
          property="og:title"
          content={`${item.title} · ${siteBrandName()}`}
        />
        <meta property="og:description" content={truncMeta(metaDesc, 200)} />
        <meta property="og:url" content={canonicalAbs} />
        <meta property="og:image" content={ogImage} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="twitter:title"
          content={`${item.title} · ${siteBrandName()}`}
        />
        <meta name="twitter:description" content={truncMeta(metaDesc, 200)} />
        <meta name="twitter:image" content={ogImage} />
        {twSite ? (
          <meta
            name="twitter:site"
            content={twSite.startsWith("@") ? twSite : `@${twSite}`}
          />
        ) : null}
      </Helmet>
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
        {hasArtwork ? (
          <button
            type="button"
            onClick={() => setArtworkPreviewOpen(true)}
            aria-label="View full-size artwork"
            className="block overflow-hidden rounded-xl border border-border bg-muted aspect-square max-h-[min(70vw,28rem)] cursor-zoom-in transition-opacity hover:opacity-90"
          >
            {coverUrl ? (
              <img src={coverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <ArtworkImage
                agent={agent}
                did={blobDid}
                cid={artworkCid}
                itemUri={itemUri}
                alt=""
                className="h-full w-full"
              />
            )}
          </button>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-muted aspect-square max-h-[min(70vw,28rem)]">
            <ArtworkImage
              agent={agent}
              did={blobDid}
              cid={artworkCid}
              itemUri={itemUri}
              alt=""
              className="h-full w-full"
            />
          </div>
        )}
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
            <>
              <p className="text-2xl font-medium">
                {formatMoney(listing.price)}
              </p>
              {isDigital || isCollection || isProduct || isCatalogItemSingle ? (
                <p className="text-sm text-muted-foreground">
                  After purchase, you can{" "}
                  <a
                    href="/dashboard"
                    className="text-primary underline underline-offset-2"
                  >
                    download this{" "}
                    {isCollection || isMusicProduct
                      ? "release"
                      : isProduct
                        ? "product"
                        : "item"}
                    .
                  </a>
                </p>
              ) : null}
            </>
          ) : (
            <div className="space-y-2 text-muted-foreground">
              <p>Not currently for sale.</p>
              <p className="text-sm">
                Publish an active{" "}
                <code className="text-xs">catalog.listing</code> (with{" "}
                <code className="text-xs">licenseUri</code> and{" "}
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
          <MetadataChip>
            Released:{" "}
            {new Date(item.releaseDate).toLocaleDateString("en-US", {
              timeZone: "UTC",
            })}
          </MetadataChip>
        ) : null}
        {"durationMs" in item && item.durationMs ? (
          <MetadataChip>{Math.round(item.durationMs / 60000)} min</MetadataChip>
        ) : null}
        {isCollection ? (
          <MetadataChip>
            {collectionTrackCount}{" "}
            {collectionTrackCount === 1 ? "track" : "tracks"}
          </MetadataChip>
        ) : null}
        {isProduct && "items" in item ? (
          <MetadataChip>
            {item.items.length}{" "}
            {isMusicProduct
              ? item.items.length === 1
                ? "track"
                : "tracks"
              : item.items.length === 1
                ? "item"
                : "items"}
          </MetadataChip>
        ) : null}
        {"genre" in item && item.genre
          ? item.genre.map((g: string) => (
              <MetadataChip key={g}>{g}</MetadataChip>
            ))
          : null}
      </section>

      {isCollection ? (
        <section className="space-y-4">
          <h2 className="text-lg font-medium">
            {ownsCollection ? "Your downloads" : "Tracks"}
          </h2>
          {ownsCollection ? (
            <CollectionMemberDownloads
              collection={item}
              onDownloadItem={(u) => void downloadDigitalItemUri(u)}
              onDownloadZip={() => void downloadCollectionZip()}
              zipBusy={zipBusy}
              itemBusyUri={downloadBusyUri}
            />
          ) : (
            <TrackList
              collection={item}
              purchaseByTrackUri={purchaseByTrackUri}
            />
          )}
        </section>
      ) : null}

      {isProduct && "items" in item ? (
        <section className="space-y-4">
          <h2 className="text-lg font-medium">
            {ownsProduct ? "Your downloads" : isMusicProduct ? "Tracks" : "Items"}
          </h2>
          <ol className="list-none space-y-2 m-0 p-0">
            {item.items.map((ref, index) => {
              const purchase = purchaseByProductItemUri.get(ref.uri);
              const meta = productItemMeta[ref.uri];
              return (
                <li
                  key={ref.uri}
                  className="flex items-center justify-between gap-2 py-1.5"
                >
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    {isMusicProduct ? (
                      <span className="tabular-nums text-muted-foreground shrink-0 w-5 text-right">
                        {index + 1}.
                      </span>
                    ) : null}
                    <span
                      className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm font-medium"
                      style={{
                        maskImage:
                          "linear-gradient(to right, black 85%, transparent 100%)",
                        WebkitMaskImage:
                          "linear-gradient(to right, black 85%, transparent 100%)",
                      }}
                    >
                      {meta?.title ?? ref.uri}
                    </span>
                    {meta?.durationMs != null ? (
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {formatDuration(meta.durationMs)}
                      </span>
                    ) : null}
                  </span>
                  {ownsProduct ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={downloadBusyUri === ref.uri}
                      onClick={() => void downloadDigitalItemUri(ref.uri)}
                    >
                      {downloadBusyUri === ref.uri ? "Preparing…" : "Download"}
                    </Button>
                  ) : purchase ? (
                    <Link
                      to={itemPathPretty(
                        catalogItemRkey(ref.uri),
                        meta?.title ?? ref.uri,
                      )}
                      className={cn(
                        buttonVariants({ size: "sm", variant: "outline" }),
                        "shrink-0",
                      )}
                    >
                      Buy · {formatMoney(purchase.listing.price)}
                    </Link>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Not sold separately
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {ownsProduct ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={zipBusy}
              onClick={() => void downloadProductZip()}
            >
              {zipBusy ? "Preparing…" : "Download all (.zip)"}
            </Button>
          ) : null}
        </section>
      ) : null}

      {"description" in item && item.description ? (
        <section className="max-w-none text-sm text-foreground">
          <h2 className="mb-2 text-lg font-medium">Description</h2>
          <MarkdownBody>{item.description}</MarkdownBody>
        </section>
      ) : null}

      <section>
        <h2 className="text-lg font-medium mb-2">License</h2>
        <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
          {license
            ? typeof license.licenseText === "string"
              ? license.licenseText
              : "Legacy license format — see full terms."
            : "Personal use license. Download and listen for your own enjoyment."}
        </p>
        {licenseCid ? (
          <a
            href={`/license/${encodeURIComponent(licenseCid)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-sm text-primary underline-offset-2 hover:underline"
          >
            View full license →
          </a>
        ) : null}
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

      {listing &&
      listingUri &&
      !(isCollection && ownsCollection) &&
      !(isProduct && ownsProduct) ? (
        <section>
          <BuyButton
            listingUri={listingUri}
            listing={listing}
            item={item}
            licenseTerms={license}
          />
        </section>
      ) : null}

      <Dialog open={artworkPreviewOpen} onOpenChange={setArtworkPreviewOpen}>
        <DialogContent
          overlayClassName="bg-black/90 backdrop-blur-sm"
          className="flex w-auto max-w-[95vw] items-center justify-center border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-[95vw]"
          showCloseButton={false}
        >
          <div className="bg-muted leading-none">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt=""
                className="block max-h-[85vh] max-w-[85vw] object-contain"
              />
            ) : (
              <ArtworkImage
                agent={agent}
                did={blobDid}
                cid={artworkCid}
                itemUri={itemUri}
                alt=""
                className="max-h-[85vh] max-w-[85vw]"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </article>
  );
}
