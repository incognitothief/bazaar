/** Repo DID from an AT-URI (`at://did:plc:…/collection/rkey`). */
export function repoDidFromAtUri(uri: string): string | null {
  if (!uri.startsWith("at://")) return null;
  const rest = uri.slice("at://".length);
  const i = rest.indexOf("/");
  if (i <= 0) return null;
  const host = rest.slice(0, i);
  return host.startsWith("did:") ? host : null;
}

/**
 * Which DID to query for `catalog.listing` when viewing an item: the item’s
 * repo (authoritative), else `VITE_ARTIST_DID`.
 */
export function resolveStorefrontArtistDid(itemUri: string): string {
  const fromUri = repoDidFromAtUri(itemUri);
  if (fromUri) return fromUri;
  const env = import.meta.env.VITE_ARTIST_DID?.trim() ?? "";
  return env.startsWith("did:") ? env : "";
}
