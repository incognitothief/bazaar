import { Lexicons } from "@atproto/lexicon";

import { BAZAAR_LEXICON_DOCS } from "./docs.js";

const DEFS_NSID = "diamonds.whereditgo.bazaar.defs";

let cached: Lexicons | undefined;

function getLexicons(): Lexicons {
  if (!cached) {
    cached = new Lexicons(BAZAAR_LEXICON_DOCS);
  }
  return cached;
}

/** Validate a record value against the Bazaar lexicon `main` def for the collection NSID. */
export function validateBazaarRecord(collectionNsid: string, value: unknown) {
  if (collectionNsid === DEFS_NSID) {
    return {
      success: false as const,
      error: new Error("defs lexicon has no record type"),
    };
  }
  return getLexicons().validate(`${collectionNsid}#main`, value);
}
