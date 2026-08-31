import type { LexiconDoc } from "@atproto/lexicon";

import actorMerchant from "./actor.merchant.json" with { type: "json" };
import actorMerchantKeys from "./actor.merchantKeys.json" with { type: "json" };
import catalogCollection from "./catalog.collection.json" with { type: "json" };
import catalogComposition from "./catalog.composition.json" with { type: "json" };
import catalogDigital from "./catalog.item.digital.json" with { type: "json" };
import catalogItem from "./catalog.item.json" with { type: "json" };
import catalogListing from "./catalog.listing.json" with { type: "json" };
import catalogPhysical from "./catalog.item.physical.json" with { type: "json" };
import catalogProduct from "./catalog.product.json" with { type: "json" };
import catalogRecording from "./catalog.recording.json" with { type: "json" };
import defs from "./defs.json" with { type: "json" };
import licenseTerms from "./license.terms.json" with { type: "json" };
import purchaseConsent from "./purchase.consent.json" with { type: "json" };
import purchaseFulfillment from "./purchase.fulfillment.json" with { type: "json" };
import purchaseReceipt from "./purchase.receipt.json" with { type: "json" };
import purchaseStock from "./purchase.stock.json" with { type: "json" };

const RAW_DOCS = [
  defs,
  catalogItem,
  catalogProduct,
  catalogDigital,
  catalogPhysical,
  catalogCollection,
  catalogListing,
  catalogRecording,
  catalogComposition,
  licenseTerms,
  purchaseReceipt,
  purchaseConsent,
  purchaseStock,
  purchaseFulfillment,
  actorMerchant,
  actorMerchantKeys,
] as const;

export const BAZAAR_LEXICON_DOCS = RAW_DOCS as unknown as readonly LexiconDoc[];

export const lexicons: Record<string, LexiconDoc> = Object.fromEntries(
  BAZAAR_LEXICON_DOCS.map((d) => [d.id, d]),
);

export const BAZAAR_LEXICON_IDS = Object.freeze(
  Object.keys(lexicons),
) as readonly string[];
