import { AtUri } from "@atproto/syntax";

/** pdsls explorer: repo collections for this DID. */
export function pdslsRepoCollectionsUrl(did: string): string {
  return `https://pdsls.dev/at://${did}#collections`;
}

/** pdsls explorer: single record by AT-URI (`at://repo/collection/rkey`). */
export function pdslsRecordUrl(atUri: string): string | null {
  try {
    const at = new AtUri(atUri);
    if (!at.hostname || !at.collection || !at.rkey) return null;
    return `https://pdsls.dev/at://${at.hostname}/${at.collection}/${at.rkey}`;
  } catch {
    return null;
  }
}
