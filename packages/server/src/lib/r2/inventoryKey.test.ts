import { describe, expect, it } from "bun:test";
import {
  INVENTORY_MASTER_OBJECT_NAME,
  inventoryObjectKey,
  newProductAssetKey,
  newProductItemKey,
  sanitizeInventoryFilename,
} from "./inventoryKey";

describe("inventoryObjectKey", () => {
  it("builds deterministic path without itemClass", () => {
    expect(
      inventoryObjectKey(
        "did:plc:test",
        "3jzfcijpjner5",
        INVENTORY_MASTER_OBJECT_NAME,
      ),
    ).toBe("inventory/did:plc:test/digital/3jzfcijpjner5/master");
  });

  it("rejects invalid DID", () => {
    expect(() => inventoryObjectKey("plc:test", "3jzfcijpjner5", "f")).toThrow();
  });
});

describe("newProductItemKey / newProductAssetKey", () => {
  it("groups items and assets under the same product prefix", () => {
    expect(
      newProductItemKey("did:plc:test", "3jzfcijpjner5", "obj-1", "track.wav"),
    ).toBe("inventory/did:plc:test/3jzfcijpjner5/items/obj-1/track.wav");
    expect(
      newProductAssetKey("did:plc:test", "3jzfcijpjner5", "obj-2", "cover.png"),
    ).toBe("inventory/did:plc:test/3jzfcijpjner5/assets/obj-2/cover.png");
  });

  it("rejects invalid DID or missing product rkey", () => {
    expect(() =>
      newProductItemKey("plc:test", "3jzfcijpjner5", "obj-1", "f"),
    ).toThrow();
    expect(() =>
      newProductAssetKey("did:plc:test", "", "obj-1", "f"),
    ).toThrow();
  });
});

describe("sanitizeInventoryFilename", () => {
  it("falls back for names outside safe charset", () => {
    expect(sanitizeInventoryFilename("bad@name")).toBe("file");
  });
});
