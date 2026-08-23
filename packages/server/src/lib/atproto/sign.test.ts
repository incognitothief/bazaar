import {
  createPrivateKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  appServiceKidFromEnv,
  normalizeAppServicePrivateKey,
  signConsentPayload,
  signReceiptPayload,
  verifyConsentPayload,
  verifyReceiptPayload,
} from "./sign";

describe("appServiceKidFromEnv", () => {
  test("returns null when unset", () => {
    const prev = process.env.APP_SERVICE_KID;
    delete process.env.APP_SERVICE_KID;
    try {
      expect(appServiceKidFromEnv()).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.APP_SERVICE_KID;
      else process.env.APP_SERVICE_KID = prev;
    }
  });

  test("returns trimmed value when set", () => {
    const prev = process.env.APP_SERVICE_KID;
    process.env.APP_SERVICE_KID = "  app-key-2026-04-19  ";
    try {
      expect(appServiceKidFromEnv()).toBe("app-key-2026-04-19");
    } finally {
      if (prev === undefined) delete process.env.APP_SERVICE_KID;
      else process.env.APP_SERVICE_KID = prev;
    }
  });
});

/**
 * Node/OpenSSL 3+ (and some Bun builds) reject `crypto.sign(null, …)` for EC keys with
 * ERR_OSSL_NO_DEFAULT_DIGEST -- the very reason sign.ts always passes an explicit digest
 * now. Environments built against that OpenSSL can no longer produce the "legacy"
 * null-digest signature the test below checks backward-compat against, so there's
 * nothing to verify here; skip rather than fail on a capability the runtime lacks.
 */
function supportsNullDigestEcSign(): boolean {
  try {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    cryptoSign(null, Buffer.from("probe"), privateKey);
    return true;
  } catch {
    return false;
  }
}

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

  test.skipIf(!supportsNullDigestEcSign())(
    "verifies legacy cryptoSign(null, …) EC signatures (pre–explicit digest)",
    () => {
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
    },
  );
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
