import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  canonicalGrantedItems,
  entitlementDigest,
  resolveGrantedItems,
} from "./entitlement";

const A = { uri: "at://did:plc:aaa/diamonds.whereditgo.bazaar.catalog.item/1", cid: "bafyreiaaa" };
const B = { uri: "at://did:plc:bbb/diamonds.whereditgo.bazaar.catalog.item/2", cid: "bafyreibbb" };
const C = { uri: "at://did:plc:ccc/diamonds.whereditgo.bazaar.catalog.item/3", cid: "bafyreiccc" };
const PRODUCT = "at://did:plc:ppp/diamonds.whereditgo.bazaar.catalog.product/p1";
const COLLECTION =
  "at://did:plc:ppp/diamonds.whereditgo.bazaar.catalog.collection/c1";

describe("canonicalGrantedItems", () => {
  test("sorts by UTF-8 byte order and de-duplicates by uri", () => {
    expect(canonicalGrantedItems([C, A, B, A])).toEqual([A, B, C]);
  });

  test("is order-independent", () => {
    expect(canonicalGrantedItems([B, C, A])).toEqual(
      canonicalGrantedItems([A, B, C]),
    );
  });

  test("empty stays empty", () => {
    expect(canonicalGrantedItems([])).toEqual([]);
  });

  test("last write wins for a duplicate uri with a different cid", () => {
    const aStale = { uri: A.uri, cid: "bafyreistale" };
    expect(canonicalGrantedItems([aStale, A])).toEqual([A]);
  });
});

describe("entitlementDigest", () => {
  function expectedDigest(items: { uri: string; cid?: string }[]): string {
    const canonical = items.map((i) => `${i.uri}|${i.cid ?? ""}`).join("\n");
    return createHash("sha256").update(canonical, "utf8").digest("base64url");
  }

  test("base64url SHA-256 over the newline-joined uri|cid canonical list", () => {
    expect(entitlementDigest([C, B, A])).toBe(expectedDigest([A, B, C]));
  });

  test("stable regardless of input order or duplicates", () => {
    expect(entitlementDigest([A, B, C])).toBe(entitlementDigest([C, A, B, B]));
  });

  test("a different member set yields a different digest", () => {
    expect(entitlementDigest([A, B])).not.toBe(entitlementDigest([A, B, C]));
  });

  test("a changed cid on the same uri yields a different digest", () => {
    const aOtherCid = { uri: A.uri, cid: "bafyreidifferent" };
    expect(entitlementDigest([aOtherCid])).not.toBe(entitlementDigest([A]));
  });

  test("missing cid canonicalizes to an empty string, not 'undefined'", () => {
    const noCid = { uri: A.uri };
    expect(entitlementDigest([noCid])).toBe(expectedDigest([{ uri: A.uri, cid: "" }]));
  });
});

describe("resolveGrantedItems", () => {
  test("single catalog.item grants itself with the pinned cid", () => {
    expect(resolveGrantedItems(A.uri, null, A.cid)).toEqual([
      { uri: A.uri, cid: A.cid },
    ]);
  });

  test("single catalog.item with no pinned cid still grants itself", () => {
    expect(resolveGrantedItems(A.uri, null)).toEqual([
      { uri: A.uri, cid: undefined },
    ]);
  });

  test("product grants its member items with their own cids, canonicalized", () => {
    expect(
      resolveGrantedItems(PRODUCT, { items: [C, A, B] }),
    ).toEqual([A, B, C]);
  });

  test("product with no items falls back to live membership (undefined)", () => {
    expect(resolveGrantedItems(PRODUCT, { items: [] })).toBeUndefined();
    expect(resolveGrantedItems(PRODUCT, {})).toBeUndefined();
    expect(resolveGrantedItems(PRODUCT, null)).toBeUndefined();
  });

  test("collections stay on the legacy path", () => {
    expect(
      resolveGrantedItems(COLLECTION, { items: [A] }),
    ).toBeUndefined();
  });

  test("unparseable URI -> undefined", () => {
    expect(resolveGrantedItems("not-a-uri", null)).toBeUndefined();
  });
});
