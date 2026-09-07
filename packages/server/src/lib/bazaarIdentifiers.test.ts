import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { buildBazaarRid } from "./bazaarIdentifiers";

describe("bazaarIdentifiers", () => {
  test("buildBazaarRid does not use sign(null, digest) — EC P-256 PKCS#8 (OpenSSL3-safe)", () => {
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const prev = process.env.STOREFRONT_PRIVATE_KEY;
    process.env.STOREFRONT_PRIVATE_KEY = pem;
    try {
      const out = buildBazaarRid({
        artistDid: "did:plc:test",
        fileCid: "bafyrei",
        fileChecksum: "abc",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      expect(out.id.startsWith("bazaar:rid:")).toBe(true);
      expect(out.sig.length).toBeGreaterThan(10);
    } finally {
      if (prev === undefined) delete process.env.STOREFRONT_PRIVATE_KEY;
      else process.env.STOREFRONT_PRIVATE_KEY = prev;
    }
  });
});
