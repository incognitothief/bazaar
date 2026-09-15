import { DEV_STUB_LISTING_AT } from "@bazaar/shared";
import type { LicenseTerms, Listing, Product } from "@/types/lexicons";

/** Placeholder rkey — usually no record; storefront still shows a card in dev. */
export const DUMMY_ITEM_RKEY = "3l7j6vooln2f2";

/** Same URI as server stub (`@bazaar/shared`); not on a PDS unless you enable `BAZAAR_DEV_CHECKOUT_STUB`). */
export const DUMMY_LISTING_AT = DEV_STUB_LISTING_AT;

export function catalogDummyEnabled(): boolean {
  return (
    import.meta.env.DEV ||
    import.meta.env.VITE_SHOW_LISTINGS_DUMMY === "true"
  );
}

/**
 * Item AT-URI for storefront / item-detail dummy: env override, else `VITE_MERCHANT_DID`, else `primaryDid`.
 * `primaryDid` is `VITE_MERCHANT_DID` on the storefront, or the signed-in merchant DID on Listings.
 */
export function resolveDummyItemAtUri(primaryDid: string | undefined): string | null {
  if (!primaryDid?.startsWith("did:")) return null;
  const explicit = import.meta.env.VITE_DEV_DUMMY_ITEM_URI?.trim();
  if (explicit?.startsWith("at://")) return explicit;
  const merchant = import.meta.env.VITE_MERCHANT_DID?.trim();
  if (merchant?.startsWith("did:")) {
    return `at://${merchant}/diamonds.whereditgo.bazaar.catalog.product/${DUMMY_ITEM_RKEY}`;
  }
  return `at://${primaryDid}/diamonds.whereditgo.bazaar.catalog.product/${DUMMY_ITEM_RKEY}`;
}

export function isDummyStorefrontItem(
  itemUri: string,
  merchantDid: string | undefined,
): boolean {
  if (!catalogDummyEnabled()) return false;
  const resolved = resolveDummyItemAtUri(merchantDid);
  return resolved != null && itemUri === resolved;
}

/**
 * Stands in for a real catalog.product so an empty storefront still renders a
 * card in dev. `items` names a catalog.item under the same rkey -- the product
 * lexicon requires at least one member, and nothing resolves it: the preview
 * never fetches members.
 */
export function buildDummyProduct(itemUri: string, merchantDid: string): Product {
  return {
    $type: "diamonds.whereditgo.bazaar.catalog.product",
    title: "Sample product (preview)",
    description:
      `Placeholder catalog entry for local storefront preview (${itemUri}). Replace by publishing a real product and listing.`,
    items: [
      {
        uri: `at://${merchantDid}/diamonds.whereditgo.bazaar.catalog.item/${DUMMY_ITEM_RKEY}`,
      },
    ],
    createdAt: new Date().toISOString(),
  };
}

export function buildDummyListing(itemUri: string): Listing {
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

export function buildDummyLicenseTerms(): LicenseTerms {
  return {
    $type: "diamonds.whereditgo.bazaar.license.terms",
    title: "Personal use (preview)",
    version: "preview",
    licenseText:
      "Sample license for UI preview only. Stripe checkout needs real listing and license records on your PDS.",
    checkoutConsentRequired: true,
    createdAt: new Date().toISOString(),
  };
}

export function isDummyListingRowUri(listingUri: string): boolean {
  return listingUri === DEV_STUB_LISTING_AT;
}
