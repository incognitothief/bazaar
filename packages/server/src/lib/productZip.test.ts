import { describe, expect, it } from "bun:test";
import { entitlementMatchesCurrentItems } from "./productZip";

function productWithItems(uris: string[]) {
  return { items: JSON.stringify(uris.map((uri) => ({ uri, cid: "bafycid" }))) };
}

describe("entitlementMatchesCurrentItems", () => {
  it("is true for a legacy receipt (no frozen grant)", () => {
    expect(
      entitlementMatchesCurrentItems(productWithItems(["at://a/x/1"]), undefined),
    ).toBe(true);
  });

  it("is true when the grant covers exactly the current items, any order", () => {
    const product = productWithItems(["at://a/x/1", "at://a/x/2"]);
    expect(
      entitlementMatchesCurrentItems(product, ["at://a/x/2", "at://a/x/1"]),
    ).toBe(true);
  });

  it("is false when an item was removed from the product since the purchase", () => {
    const product = productWithItems(["at://a/x/1"]);
    expect(
      entitlementMatchesCurrentItems(product, ["at://a/x/1", "at://a/x/2"]),
    ).toBe(false);
  });

  it("is false when an item was added to the product since the purchase", () => {
    const product = productWithItems(["at://a/x/1", "at://a/x/2"]);
    expect(entitlementMatchesCurrentItems(product, ["at://a/x/1"])).toBe(false);
  });
});
