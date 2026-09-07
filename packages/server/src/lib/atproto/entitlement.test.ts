import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  canonicalGrantedItems,
  entitlementDigest,
  resolveGrantedItems,
} from "./entitlement";

const A = "at://did:plc:aaa/diamonds.whereditgo.bazaar.catalog.item/1";
const B = "at://did:plc:bbb/diamonds.whereditgo.bazaar.catalog.item/2";
const C = "at://did:plc:ccc/diamonds.whereditgo.bazaar.catalog.item/3";
const PRODUCT = "at://did:plc:ppp/diamonds.whereditgo.bazaar.catalog.product/p1";
const COLLECTION =
  "at://did:plc:ppp/diamonds.whereditgo.bazaar.catalog.collection/c1";

describe("canonicalGrantedItems", () => {
  test("sorts by UTF-8 byte order and de-duplicates", () => {
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
});

describe("entitlementDigest", () => {
  test("base64url SHA-256 over the newline-joined canonical list", () => {
    const expected = createHash("sha256")
      .update([A, B, C].join("\n"), "utf8")
      .digest("base64url");
    expect(entitlementDigest([C, B, A])).toBe(expected);
  });

  test("stable regardless of input order or duplicates", () => {
    expect(entitlementDigest([A, B, C])).toBe(entitlementDigest([C, A, B, B]));
  });

  test("a different member set yields a different digest", () => {
    expect(entitlementDigest([A, B])).not.toBe(entitlementDigest([A, B, C]));
  });
});

describe("resolveGrantedItems", () => {
  test("single catalog.item grants itself", () => {
    expect(resolveGrantedItems(A, null)).toEqual([A]);
  });

  test("product grants its member items, canonicalized", () => {
    expect(
      resolveGrantedItems(PRODUCT, { items: [{ uri: C }, { uri: A }, { uri: B }] }),
    ).toEqual([A, B, C]);
  });

  test("product with no items falls back to live membership (undefined)", () => {
    expect(resolveGrantedItems(PRODUCT, { items: [] })).toBeUndefined();
    expect(resolveGrantedItems(PRODUCT, {})).toBeUndefined();
    expect(resolveGrantedItems(PRODUCT, null)).toBeUndefined();
  });

  test("collections stay on the legacy path", () => {
    expect(
      resolveGrantedItems(COLLECTION, { items: [{ uri: A }] }),
    ).toBeUndefined();
  });

  test("unparseable URI -> undefined", () => {
    expect(resolveGrantedItems("not-a-uri", null)).toBeUndefined();
  });
});
