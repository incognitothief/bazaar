/**
 * Off-PDS stub for local Stripe checkout when using the storefront preview listing
 * (`at://dev.bazaar.invalid/...`). Enable only with `BAZAAR_DEV_CHECKOUT_STUB=true` on the server.
 */

export const DEV_STUB_LISTING_AT =
  "at://dev.bazaar.invalid/diamonds.whereditgo.bazaar.catalog.listing/dummy";

/** Stable CID embedded in Checkout metadata so the webhook can resolve the stub snapshot. */
export const DEV_STUB_LISTING_CID =
  "bafyreistubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export function devCheckoutStubAllowed(): boolean {
  return (
    typeof process !== "undefined" &&
    process.env?.BAZAAR_DEV_CHECKOUT_STUB === "true"
  );
}

export function isDevStubListingUri(listingUri: string): boolean {
  return listingUri === DEV_STUB_LISTING_AT;
}

function repoFromAtUri(uri: string): string | null {
  if (!uri.startsWith("at://")) return null;
  const rest = uri.slice("at://".length);
  const i = rest.indexOf("/");
  if (i <= 0) return null;
  const host = rest.slice(0, i);
  return host.startsWith("did:") ? host : null;
}

/** Lexicon-shaped listing; `item.uri` must match the checkout `itemUri`. */
export function buildDevStubListingJson(itemUri: string): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    $type: "diamonds.whereditgo.bazaar.catalog.listing",
    item: { uri: itemUri },
    price: { amount: 999, currency: "USD" },
    status: "active",
    licenseGrant: {
      uri: "at://dev.bazaar.invalid/diamonds.whereditgo.bazaar.license.terms/dummy",
      cid: "bafyreiccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
    createdAt: now,
  };
}

/** Minimal digital item JSON for merchantDid / title when the item is not on a PDS. */
export function buildDevStubItemJson(itemUri: string): Record<string, unknown> {
  const did = repoFromAtUri(itemUri);
  const now = new Date().toISOString();
  return {
    $type: "diamonds.whereditgo.bazaar.catalog.item.digital",
    title: "Dev checkout stub item",
    artistDid: did ?? "did:plc:unknown",
    itemClass: "track",
    formats: ["flac"],
    fileChecksum: "0".repeat(64),
    fileCid: "bafyreibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    createdAt: now,
  };
}

export function tryDevStubListingSnapshot(
  listingUri: string,
  listingCidMeta: string,
  itemUri: string,
): { listing: Record<string, unknown>; cid: string } | null {
  if (
    !devCheckoutStubAllowed() ||
    !isDevStubListingUri(listingUri) ||
    listingCidMeta !== DEV_STUB_LISTING_CID
  ) {
    return null;
  }
  return {
    listing: buildDevStubListingJson(itemUri),
    cid: DEV_STUB_LISTING_CID,
  };
}
