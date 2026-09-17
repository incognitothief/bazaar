/**
 * The one lexicon namespace.
 *
 * Not configurable. Record types are defined by this repo and served from it,
 * so a deployment that moved its NSIDs would also have to host its own lexicon
 * documents at its own authority, and its records would no longer be the same
 * type as any other Bazaar instance's. A single canonical namespace is what
 * makes a receipt written by one storefront readable by everyone else.
 *
 * This used to be overridable via LEXICON_NAMESPACE / VITE_LEXICON_NAMESPACE.
 * Only the server ever honoured it; the client hardcoded its NSIDs, so setting
 * it desynced the two halves.
 */
export const BAZAAR_NS = "diamonds.whereditgo.bazaar" as const;

/** Fully-qualified NSID for a record type, e.g. col("catalog.item"). */
export function col(suffix: string): string {
  return `${BAZAAR_NS}.${suffix}`;
}
