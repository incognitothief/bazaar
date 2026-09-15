import { getAgentForDid } from "./atproto/resolvePds";

function lexiconNs(): string {
  return process.env.LEXICON_NAMESPACE?.trim() || "diamonds.whereditgo.bazaar";
}

/**
 * Resolve a storefront catalog AT-URI from a TID rkey by probing each
 * collection an /item/:rkey URL can name.
 *
 * Product first: a single-item release mints its catalog.product with the
 * same rkey as its item (see newProductItemKey's note), so both probes can
 * hit, and the product is the page a visitor should land on.
 */
export async function resolveCatalogItemUriFromRkey(
  repoDid: string,
  rkey: string,
): Promise<string | null> {
  if (!repoDid.startsWith("did:") || !rkey) return null;
  const ns = lexiconNs();
  const collections = [
    `${ns}.catalog.product`,
    `${ns}.catalog.item`,
  ] as const;
  const agent = await getAgentForDid(repoDid);
  for (const collection of collections) {
    try {
      await agent.com.atproto.repo.getRecord({
        repo: repoDid,
        collection,
        rkey,
      });
      return `at://${repoDid}/${collection}/${rkey}`;
    } catch {
      continue;
    }
  }
  return null;
}
