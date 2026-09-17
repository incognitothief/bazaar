import { buildAtprotoLoopbackClientId } from "@atproto/oauth-client";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  bazaarRepoOAuthScopes,
  buildBuyerOAuthScopeString,
  buildOAuthScopeString,
  buyerRepoOAuthScopes,
} from "./oauth-scope";

describe("oauth-scope", () => {
  /** Saved only so the "canonical namespace" test can set it without leaking. */
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
      "repo:diamonds.whereditgo.bazaar.license.terms?action=create",
    );
  });

  test("merchant scope includes actor.storefrontKeys create/update/delete", () => {
    const s = buildOAuthScopeString();
    for (const action of ["create", "update", "delete"]) {
      expect(s).toContain(
        `repo:diamonds.whereditgo.bazaar.actor.storefrontKeys?action=${action}`,
      );
    }
  });

  /** The namespace is not configurable -- see BAZAAR_NS in @bazaar/shared. */
  test("every scope is under the canonical namespace", () => {
    process.env.LEXICON_NAMESPACE = "com.example.bazaar";
    for (const scope of bazaarRepoOAuthScopes()) {
      expect(scope.startsWith("repo:diamonds.whereditgo.bazaar.")).toBe(true);
    }
    expect(buildOAuthScopeString()).not.toContain("com.example.bazaar");
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

  test("buyer scope is limited to purchase receipt create", () => {
    const scopes = buyerRepoOAuthScopes();
    expect(scopes).toEqual([
      "repo:diamonds.whereditgo.bazaar.purchase.receipt?action=create",
    ]);
  });

  test("buyer scope string excludes merchant-only collections", () => {
    const s = buildBuyerOAuthScopeString();
    expect(s.startsWith("atproto transition:generic ")).toBe(true);
    expect(s).toContain(
      "repo:diamonds.whereditgo.bazaar.purchase.receipt?action=create",
    );
    expect(s).not.toContain("catalog.item");
    expect(s).not.toContain("catalog.product");
    expect(s).not.toContain("catalog.listing");
    expect(s).not.toContain("license.terms");
    expect(s).not.toContain("actor.merchant");
  });

  test("buyer scope is a subset of the full scope string", () => {
    const full = buildOAuthScopeString().split(" ");
    const buyer = buildBuyerOAuthScopeString().split(" ");
    for (const token of buyer) {
      expect(full).toContain(token);
    }
  });
});
