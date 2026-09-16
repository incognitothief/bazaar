import type { LexiconDoc } from "@atproto/lexicon";

import actorMerchant from "./actor.merchant.json" with { type: "json" };
import actorStorefrontKeys from "./actor.storefrontKeys.json" with { type: "json" };
import catalogItem from "./catalog.item.json" with { type: "json" };
import catalogListing from "./catalog.listing.json" with { type: "json" };
import catalogProduct from "./catalog.product.json" with { type: "json" };
import defs from "./defs.json" with { type: "json" };
import licenseTerms from "./license.terms.json" with { type: "json" };
import purchaseReceipt from "./purchase.receipt.json" with { type: "json" };

const RAW_DOCS = [
  defs,
  catalogItem,
  catalogProduct,
  catalogListing,
  licenseTerms,
  purchaseReceipt,
  actorMerchant,
  actorStorefrontKeys,
] as const;

export const BAZAAR_LEXICON_DOCS = RAW_DOCS as unknown as readonly LexiconDoc[];

export const lexicons: Record<string, LexiconDoc> = Object.fromEntries(
  BAZAAR_LEXICON_DOCS.map((d) => [d.id, d]),
);

export const BAZAAR_LEXICON_IDS = Object.freeze(
  Object.keys(lexicons),
) as readonly string[];
