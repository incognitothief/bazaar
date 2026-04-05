import { describe, expect, it } from "bun:test";
import {
  INVENTORY_MASTER_OBJECT_NAME,
  inventoryObjectKey,
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

describe("sanitizeInventoryFilename", () => {
  it("falls back for names outside safe charset", () => {
    expect(sanitizeInventoryFilename("bad@name")).toBe("file");
  });
});
