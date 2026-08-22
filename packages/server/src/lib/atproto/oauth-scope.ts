/**
 * ATProto OAuth scopes: base `atproto` plus per-collection repo actions.
 * @see https://atproto.com/specs/oauth
 */

const DEFAULT_LEXICON_NS = "diamonds.whereditgo.bazaar";

function lexiconNamespace(): string {
  const raw = process.env.LEXICON_NAMESPACE?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_LEXICON_NS;
}

function col(ns: string, suffix: string): string {
  return `${ns}.${suffix}`;
}

function repoAction(collection: string, action: "create" | "update"): string {
  return `repo:${collection}?action=${action}`;
}

/**
 * Collections Bazaar writes via the browser → /api/atproto/repo/* proxy.
 * Keep in sync with client `BAZAAR_COLLECTION` + create/putRecord usage.
 */
export function bazaarRepoOAuthScopes(): string[] {
  const ns = lexiconNamespace();
  return [
    repoAction(col(ns, "catalog.item"), "create"),
    repoAction(col(ns, "catalog.item"), "update"),
    repoAction(col(ns, "catalog.product"), "create"),
    repoAction(col(ns, "catalog.product"), "update"),
    repoAction(col(ns, "catalog.item.digital"), "create"),
    repoAction(col(ns, "catalog.collection"), "create"),
    repoAction(col(ns, "catalog.listing"), "create"),
    repoAction(col(ns, "catalog.listing"), "update"),
    repoAction(col(ns, "license.terms"), "create"),
    repoAction(col(ns, "purchase.receipt"), "create"),
    repoAction(col(ns, "purchase.consent"), "create"),
    repoAction(col(ns, "actor.merchant"), "create"),
    repoAction(col(ns, "actor.merchant"), "update"),
  ];
}

/**
 * Collections a BUYER's OAuth session ever needs to write to. Buyers only ever
 * create purchase attestations in their own repo — they never touch catalog,
 * listing, license, or merchant-profile collections. Requesting only these at
 * sign-in (instead of the full `bazaarRepoOAuthScopes()` superset) keeps the
 * PDS consent screen honest about what Bazaar can actually do on a buyer's repo.
 */
export function buyerRepoOAuthScopes(): string[] {
  const ns = lexiconNamespace();
  return [
    repoAction(col(ns, "purchase.receipt"), "create"),
    repoAction(col(ns, "purchase.consent"), "create"),
  ];
}

/**
 * Full `scope` query value for client metadata (the maximum superset any
 * session may ever request) and for the merchant sign-in flow.
 * Must include the `atproto` token (see @atproto/oauth-types).
 *
 * `transition:generic` is the standard Bluesky/ATProto umbrella for app lexicon writes
 * (see @atproto/oauth-client-node README). Some auth servers require it for fine-grained
 * `repo:…?action=…` tokens to count as declared in client metadata.
 */
export function buildOAuthScopeString(): string {
  return buildScopeString(bazaarRepoOAuthScopes());
}

/**
 * Narrower `scope` value for the buyer sign-in flow. Must remain a subset of
 * `buildOAuthScopeString()` — the authorization server rejects any requested
 * scope not already declared in client metadata.
 */
export function buildBuyerOAuthScopeString(): string {
  return buildScopeString(buyerRepoOAuthScopes());
}

function buildScopeString(repoScopes: string[]): string {
  const parts = ["atproto", "transition:generic", ...repoScopes];
  const extra = process.env.BAZAAR_OAUTH_SCOPE_EXTRA?.trim();
  if (extra) {
    for (const t of extra.split(/\s+/).filter(Boolean)) {
      if (!parts.includes(t)) parts.push(t);
    }
  }
  return parts.join(" ");
}
