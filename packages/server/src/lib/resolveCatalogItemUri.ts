import { getAgentForDid } from "./atproto/resolvePds";

function lexiconNs(): string {
  return process.env.LEXICON_NAMESPACE?.trim() || "diamonds.whereditgo.bazaar";
}

/**
 * Resolve storefront catalog item AT-URI from TID rkey (digital → collection → physical).
 */
export async function resolveCatalogItemUriFromRkey(
  repoDid: string,
  rkey: string,
): Promise<string | null> {
  if (!repoDid.startsWith("did:") || !rkey) return null;
  const ns = lexiconNs();
  const collections = [
    `${ns}.catalog.item.digital`,
    `${ns}.catalog.collection`,
    `${ns}.catalog.item.physical`,
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
