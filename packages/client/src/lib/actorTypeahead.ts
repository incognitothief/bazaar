export const TYPEAHEAD_URL = "https://typeahead.waow.tech" as const;

/** Stable client id for typeahead / profile relay requests. */
export const BAZAAR_TYPEAHEAD_CLIENT_ID = "bazaar.whereditgo.diamonds" as const;

const TYPEAHEAD_FETCH_HEADERS = {
  "X-Client": BAZAAR_TYPEAHEAD_CLIENT_ID,
} as const;

export type ActorTypeaheadHit = {
  did: string;
  handle: string;
  displayName?: string;
  /** HTTPS avatar URL when the relay returns it or after `getProfiles` enrichment. */
  avatar?: string;
};

type TypeaheadResponse = {
  actors?: Array<{
    did?: string;
    handle?: string;
    displayName?: string;
    avatar?: string;
  }>;
};

type GetProfilesResponse = {
  profiles?: Array<{
    did?: string;
    handle?: string;
    displayName?: string;
    avatar?: string;
  }>;
};

export type ActorPublicProfile = {
  avatar: string | null;
  handle: string | null;
  displayName: string | null;
};

/**
 * Bluesky-style public profile fields for a DID or handle (relay `getProfiles`).
 */
export async function fetchActorPublicProfile(
  actor: string,
  signal?: AbortSignal,
): Promise<ActorPublicProfile> {
  const a = actor.trim();
  if (!a) {
    return { avatar: null, handle: null, displayName: null };
  }

  const url = `${TYPEAHEAD_URL}/xrpc/app.bsky.actor.getProfiles?actors=${encodeURIComponent(a)}`;
  const response = await fetch(url, { signal, headers: TYPEAHEAD_FETCH_HEADERS });

  if (!response.ok) {
    throw new Error(`getProfiles failed: ${response.status}`);
  }

  const data = (await response.json()) as GetProfilesResponse;
  const p = data.profiles?.[0];
  return {
    avatar:
      typeof p?.avatar === "string" && p.avatar.length > 0 ? p.avatar : null,
    handle:
      typeof p?.handle === "string" && p.handle.length > 0 ? p.handle : null,
    displayName:
      typeof p?.displayName === "string" && p.displayName.length > 0
        ? p.displayName
        : null,
  };
}

function parseHits(raw: TypeaheadResponse["actors"]): ActorTypeaheadHit[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is ActorTypeaheadHit =>
      typeof a?.did === "string" &&
      typeof a?.handle === "string" &&
      a.did.length > 0 &&
      a.handle.length > 0,
  ).map((a) => ({
    did: a.did,
    handle: a.handle,
    displayName:
      typeof a.displayName === "string" ? a.displayName : undefined,
    avatar:
      typeof a.avatar === "string" && a.avatar.length > 0
        ? a.avatar
        : undefined,
  }));
}

/**
 * Batch profile lookup (same relay as typeahead). Each `actors` query param is a DID or handle.
 */
export async function fetchActorAvatarByActor(
  actor: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const profile = await fetchActorPublicProfile(actor, signal);
  return profile.avatar;
}

async function enrichHitsWithProfileAvatars(
  hits: ActorTypeaheadHit[],
  signal?: AbortSignal,
): Promise<ActorTypeaheadHit[]> {
  const missing = hits.filter((h) => !h.avatar).map((h) => h.did);
  if (missing.length === 0) return hits;

  const url = new URL(`${TYPEAHEAD_URL}/xrpc/app.bsky.actor.getProfiles`);
  for (const did of missing) {
    url.searchParams.append("actors", did);
  }

  const response = await fetch(url.toString(), {
    signal,
    headers: TYPEAHEAD_FETCH_HEADERS,
  });
  if (!response.ok) return hits;

  const data = (await response.json()) as GetProfilesResponse;
  const byDid = new Map<string, string>();
  for (const p of data.profiles ?? []) {
    if (
      typeof p.did === "string" &&
      typeof p.avatar === "string" &&
      p.avatar.length > 0
    ) {
      byDid.set(p.did, p.avatar);
    }
  }

  return hits.map((h) =>
    h.avatar ? h : { ...h, avatar: byDid.get(h.did) },
  );
}

/**
 * Prefix search against a public typeahead relay (Bluesky `searchActorsTypeahead`).
 */
export async function fetchActorTypeahead(
  query: string,
  limit = 10,
  signal?: AbortSignal,
): Promise<ActorTypeaheadHit[]> {
  const q = query.trim();
  if (!q) return [];

  const url = `${TYPEAHEAD_URL}/xrpc/app.bsky.actor.searchActorsTypeahead?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}`;

  const response = await fetch(url, { signal, headers: TYPEAHEAD_FETCH_HEADERS });

  if (!response.ok) {
    throw new Error(`typeahead failed: ${response.status}`);
  }

  const data = (await response.json()) as TypeaheadResponse;
  const hits = parseHits(data.actors);
  if (hits.length === 0) return hits;

  try {
    return await enrichHitsWithProfileAvatars(hits, signal);
  } catch {
    return hits;
  }
}
