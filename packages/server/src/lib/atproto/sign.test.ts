import {
  createPrivateKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  normalizeAppServicePrivateKey,
  signConsentPayload,
  signReceiptPayload,
  verifyConsentPayload,
  verifyReceiptPayload,
} from "./sign";

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

  test("round-trip with P-256 EC key (typical ATProto PEM shape)", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const privateKeyPem = privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string;
    const publicKeyPem = publicKey.export({
      type: "spki",
      format: "pem",
    }) as string;
    const params = {
      purchasedAt: new Date().toISOString(),
      paymentRef: "pi_test_ec",
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

  test("SEC1 EC PRIVATE KEY collapsed to one line (typical .env)", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const pemMulti = privateKey.export({
      type: "sec1",
      format: "pem",
    }) as string;
    const oneLine = pemMulti.replace(/\n/g, " ").trim();
    const publicKeyPem = publicKey.export({
      type: "spki",
      format: "pem",
    }) as string;
    expect(normalizeAppServicePrivateKey(oneLine)).toContain("\n");
    const params = {
      purchasedAt: new Date().toISOString(),
      paymentRef: "pi_test_sec1",
      itemUri: "at://did:plc:test/diamonds.whereditgo.bazaar.catalog.item.digital/rkey",
      listingCid: "bafyrei",
      buyerDid: "did:plc:buyer",
    };
    const appSig = signReceiptPayload({
      ...params,
      privateKeyPem: oneLine,
    });
    expect(
      verifyReceiptPayload({
        ...params,
        appSig,
        publicKeyPem,
      }),
    ).toBe(true);
  });

  test("verifies legacy cryptoSign(null, …) EC signatures (pre–explicit digest)", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const privateKeyPem = privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string;
    const publicKeyPem = publicKey.export({
      type: "spki",
      format: "pem",
    }) as string;
    const params = {
      purchasedAt: new Date().toISOString(),
      paymentRef: "pi_legacy_null_digest",
      itemUri: "at://did:plc:test/diamonds.whereditgo.bazaar.catalog.item.digital/rkey",
      listingCid: "bafyrei",
      buyerDid: "did:plc:buyer",
    };
    const message = [
      params.purchasedAt,
      params.paymentRef,
      params.itemUri,
      params.listingCid,
      params.buyerDid,
    ].join(":");
    const sk = createPrivateKey(normalizeAppServicePrivateKey(privateKeyPem));
    const legacySig = Buffer.from(
      cryptoSign(null, Buffer.from(message, "utf8"), sk),
    ).toString("base64url");
    expect(
      verifyReceiptPayload({
        ...params,
        appSig: legacySig,
        publicKeyPem,
      }),
    ).toBe(true);
  });
});

describe("signConsentPayload / verifyConsentPayload", () => {
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
      buyerDid: "did:plc:buyer",
      licenseGrantCid: "bafyreiabc",
      receiptCid: "bafyreixyz",
      consentedAt: new Date().toISOString(),
    };
    const appSig = signConsentPayload({
      ...params,
      privateKeyPem,
    });
    expect(
      verifyConsentPayload({
        ...params,
        appSig,
        publicKeyPem,
      }),
    ).toBe(true);
  });
});
