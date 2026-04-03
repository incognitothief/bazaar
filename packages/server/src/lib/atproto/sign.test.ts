import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { signReceiptPayload, verifyReceiptPayload } from "./sign";

describe("signReceiptPayload / verifyReceiptPayload", () => {
  test("round-trip", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const privateKeyPem = privateKey.export({
      type: "pkcs1",
      format: "pem",
    }) as string;
    const publicKeyPem = publicKey.export({
      type: "pkcs1",
      format: "pem",
    }) as string;
    const params = {
      purchasedAt: new Date().toISOString(),
      paymentRef: "pi_test",
      itemUri: "at://did:plc:test/diamonds.whereditgo.bazaar.catalog.item.digital/rkey",
      listingCid: "bafyrei",
      buyerDid: "did:plc:buyer",
    };
    const appSig = signReceiptPayload({
      ...params,
      privateKeyPem,
    });
    expect(
      verifyReceiptPayload({
        ...params,
        appSig,
        publicKeyPem,
      }),
    ).toBe(true);
  });
});
