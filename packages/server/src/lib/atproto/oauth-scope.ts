/**
 * ATProto OAuth scopes: base `atproto` plus per-collection repo actions.
 * @see https://atproto.com/specs/oauth
 */
import { col } from "@bazaar/shared";

function repoAction(
  collection: string,
  action: "create" | "update" | "delete",
): string {
  return `repo:${collection}?action=${action}`;
}

/**
 * Collections Bazaar writes via the browser → /api/atproto/repo/* proxy.
 * Keep in sync with client `BAZAAR_COLLECTION` + create/putRecord usage.
 */
export function bazaarRepoOAuthScopes(): string[] {
  return [
    repoAction(col("catalog.item"), "create"),
    repoAction(col("catalog.item"), "update"),
    repoAction(col("catalog.product"), "create"),
    repoAction(col("catalog.product"), "update"),
    repoAction(col("catalog.listing"), "create"),
    repoAction(col("catalog.listing"), "update"),
    repoAction(col("catalog.listing"), "delete"),
    // Permanent catalog deletion (lib/deleteCatalogEntry.ts). Declared for
    // correctness -- `transition:generic` is what actually authorizes these
    // today, but that scope is transitional and these become load-bearing
    // when it goes away.
    repoAction(col("catalog.item"), "delete"),
    repoAction(col("catalog.product"), "delete"),
    repoAction(col("license.terms"), "delete"),
    repoAction(col("license.terms"), "create"),
    repoAction(col("purchase.receipt"), "create"),
    repoAction(col("actor.merchant"), "create"),
    repoAction(col("actor.merchant"), "update"),
    repoAction(col("actor.storefrontKeys"), "create"),
    repoAction(col("actor.storefrontKeys"), "update"),
    repoAction(col("actor.storefrontKeys"), "delete"),
  ];
}

/**
 * Collections a BUYER's OAuth session ever needs to write to. Buyers only ever
 * create a purchase receipt in their own repo — they never touch catalog,
 * listing, license, or merchant-profile collections. Requesting only this at
 * sign-in (instead of the full `bazaarRepoOAuthScopes()` superset) keeps the
 * PDS consent screen honest about what Bazaar can actually do on a buyer's repo.
 */
export function buyerRepoOAuthScopes(): string[] {
  return [repoAction(col("purchase.receipt"), "create")];
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
