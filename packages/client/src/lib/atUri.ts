/**
 * Collection NSID from an AT-URI (`at://did:plc:…/collection/rkey`) --
 * this is what a record's "type" actually is. Use it instead of a stored
 * type field: `defs#ref` deliberately carries none, because the URI already
 * says what it points to.
 */
export function collectionFromAtUri(uri: string): string | null {
  if (!uri.startsWith("at://")) return null;
  const rest = uri.slice("at://".length);
  const parts = rest.split("/");
  return parts[1] || null;
}

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
 * repo (authoritative), else `VITE_MERCHANT_DID`.
 */
export function resolveListingMerchantDid(itemUri: string): string {
  const fromUri = repoDidFromAtUri(itemUri);
  if (fromUri) return fromUri;
  const env = import.meta.env.VITE_MERCHANT_DID?.trim() ?? "";
  return env.startsWith("did:") ? env : "";
}
