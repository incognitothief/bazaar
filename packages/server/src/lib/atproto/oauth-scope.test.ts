import { buildAtprotoLoopbackClientId } from "@atproto/oauth-client";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bazaarRepoOAuthScopes, buildOAuthScopeString } from "./oauth-scope";

describe("oauth-scope", () => {
  const savedNs = process.env.LEXICON_NAMESPACE;
  const savedExtra = process.env.BAZAAR_OAUTH_SCOPE_EXTRA;

  beforeEach(() => {
    delete process.env.LEXICON_NAMESPACE;
    delete process.env.BAZAAR_OAUTH_SCOPE_EXTRA;
  });

  afterEach(() => {
    if (savedNs === undefined) delete process.env.LEXICON_NAMESPACE;
    else process.env.LEXICON_NAMESPACE = savedNs;
    if (savedExtra === undefined) delete process.env.BAZAAR_OAUTH_SCOPE_EXTRA;
    else process.env.BAZAAR_OAUTH_SCOPE_EXTRA = savedExtra;
  });

  test("includes atproto, transition:generic, and purchase receipt create", () => {
    const s = buildOAuthScopeString();
    expect(s.startsWith("atproto transition:generic ")).toBe(true);
    expect(s).toContain(
      "repo:diamonds.whereditgo.bazaar.purchase.receipt?action=create",
    );
    expect(s).toContain(
      "repo:diamonds.whereditgo.bazaar.purchase.consent?action=create",
    );
  });

  test("respects LEXICON_NAMESPACE", () => {
    process.env.LEXICON_NAMESPACE = "com.example.bazaar";
    const scopes = bazaarRepoOAuthScopes();
    expect(scopes.some((x) => x.includes("com.example.bazaar.purchase.receipt"))).toBe(
      true,
    );
  });

  test("loopback client_id embeds repo scopes in query string", () => {
    const scope = buildOAuthScopeString();
    const id = buildAtprotoLoopbackClientId({
      scope,
      redirect_uris: ["http://127.0.0.1:3000/api/atproto/callback"],
    });
    expect(id.startsWith("http://localhost?")).toBe(true);
    const scopeParam = new URL(id).searchParams.get("scope");
    expect(scopeParam).toContain(
      "repo:diamonds.whereditgo.bazaar.purchase.receipt?action=create",
    );
  });
});
