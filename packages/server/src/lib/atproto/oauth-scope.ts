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
    repoAction(col(ns, "catalog.item.digital"), "create"),
    repoAction(col(ns, "catalog.collection"), "create"),
    repoAction(col(ns, "catalog.listing"), "create"),
    repoAction(col(ns, "catalog.listing"), "update"),
    repoAction(col(ns, "license.terms"), "create"),
    repoAction(col(ns, "purchase.receipt"), "create"),
    repoAction(col(ns, "purchase.consent"), "create"),
    repoAction(col(ns, "actor.profile"), "create"),
    repoAction(col(ns, "actor.profile"), "update"),
  ];
}

/**
 * Full `scope` query value for authorize + client metadata.
 * Must include the `atproto` token (see @atproto/oauth-types).
 *
 * `transition:generic` is the standard Bluesky/ATProto umbrella for app lexicon writes
 * (see @atproto/oauth-client-node README). Some auth servers require it for fine-grained
 * `repo:…?action=…` tokens to count as declared in client metadata.
 */
export function buildOAuthScopeString(): string {
  const parts = ["atproto", "transition:generic", ...bazaarRepoOAuthScopes()];
  const extra = process.env.BAZAAR_OAUTH_SCOPE_EXTRA?.trim();
  if (extra) {
    for (const t of extra.split(/\s+/).filter(Boolean)) {
      if (!parts.includes(t)) parts.push(t);
    }
  }
  return parts.join(" ");
}
