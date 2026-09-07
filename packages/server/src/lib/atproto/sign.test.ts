import {
  createPrivateKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  appMerchantKidFromEnv,
  normalizeAppMerchantPrivateKey,
  signConsentPayload,
  signReceiptPayload,
  verifyConsentPayload,
  verifyReceiptPayload,
} from "./sign";

// P-256 curve order, for low-S assertions.
const P256_N = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
);
const P256_HALF_N = P256_N >> 1n;

function p256Pems() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

describe("appMerchantKidFromEnv", () => {
  test("returns null when unset", () => {
    const prev = process.env.APP_MERCHANT_KID;
    delete process.env.APP_MERCHANT_KID;
    try {
      expect(appMerchantKidFromEnv()).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.APP_MERCHANT_KID;
      else process.env.APP_MERCHANT_KID = prev;
    }
  });

  test("returns trimmed value when set", () => {
    const prev = process.env.APP_MERCHANT_KID;
    process.env.APP_MERCHANT_KID = "  merchant-key-2026-08-29  ";
    try {
      expect(appMerchantKidFromEnv()).toBe("merchant-key-2026-08-29");
    } finally {
      if (prev === undefined) delete process.env.APP_MERCHANT_KID;
      else process.env.APP_MERCHANT_KID = prev;
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
  const params = {
    purchasedAt: new Date().toISOString(),
    paymentRef: "pi_test",
    itemUri: "at://did:plc:test/diamonds.whereditgo.bazaar.catalog.item.digital/rkey",
    listingCid: "bafyrei",
    buyerDid: "did:plc:buyer",
  };

  test("round-trip with P-256 EC key (compact low-S appSig)", () => {
    const { privateKeyPem, publicKeyPem } = p256Pems();
    const appSig = signReceiptPayload({ ...params, privateKeyPem });

    // Current wire format: 64-byte IEEE-P1363 (r || s).
    const raw = Buffer.from(appSig, "base64url");
    expect(raw.length).toBe(64);
    // Low-S: s <= n/2.
    const s = BigInt(`0x${raw.subarray(32).toString("hex")}`);
    expect(s <= P256_HALF_N).toBe(true);

    expect(verifyReceiptPayload({ ...params, appSig, publicKeyPem })).toBe(true);
  });

  test("tampered field fails verification", () => {
    const { privateKeyPem, publicKeyPem } = p256Pems();
    const appSig = signReceiptPayload({ ...params, privateKeyPem });
    expect(
      verifyReceiptPayload({
        ...params,
        paymentRef: "pi_tampered",
        appSig,
        publicKeyPem,
      }),
    ).toBe(false);
  });

  test("entitlementDigest is bound into the signature", () => {
    const { privateKeyPem, publicKeyPem } = p256Pems();
    const entitlementDigest = "Zm9vYmFyZW50aXRsZW1lbnRkaWdlc3RfXw";
    const appSig = signReceiptPayload({
      ...params,
      entitlementDigest,
      privateKeyPem,
    });

    expect(
      verifyReceiptPayload({ ...params, entitlementDigest, appSig, publicKeyPem }),
    ).toBe(true);
    // Same fields, digest dropped -> five-field payload -> mismatch.
    expect(verifyReceiptPayload({ ...params, appSig, publicKeyPem })).toBe(false);
    // Same fields, different digest -> mismatch.
    expect(
      verifyReceiptPayload({
        ...params,
        entitlementDigest: `${entitlementDigest}x`,
        appSig,
        publicKeyPem,
      }),
    ).toBe(false);
  });

  test("legacy five-field payload still round-trips when no digest is given", () => {
    const { privateKeyPem, publicKeyPem } = p256Pems();
    const appSig = signReceiptPayload({ ...params, privateKeyPem });
    expect(verifyReceiptPayload({ ...params, appSig, publicKeyPem })).toBe(true);
  });

  test("SEC1 EC PRIVATE KEY collapsed to one line (typical .env)", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const pemMulti = privateKey.export({ type: "sec1", format: "pem" }) as string;
    const oneLine = pemMulti.replace(/\n/g, " ").trim();
    const publicKeyPem = publicKey.export({
      type: "spki",
      format: "pem",
    }) as string;
    expect(normalizeAppMerchantPrivateKey(oneLine)).toContain("\n");

    const appSig = signReceiptPayload({ ...params, privateKeyPem: oneLine });
    expect(verifyReceiptPayload({ ...params, appSig, publicKeyPem })).toBe(true);
  });

  test("TRANSITIONAL: verifies a legacy DER-encoded EC signature (pre-migration field receipts)", () => {
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
    const message = [
      params.purchasedAt,
      params.paymentRef,
      params.itemUri,
      params.listingCid,
      params.buyerDid,
    ].join(":");
    // Default dsaEncoding is "der" — this is what the pre-remediation signer produced.
    const derSig = Buffer.from(
      cryptoSign(
        "sha256",
        Buffer.from(message, "utf8"),
        createPrivateKey(normalizeAppMerchantPrivateKey(privateKeyPem)),
      ),
    ).toString("base64url");

    expect(
      verifyReceiptPayload({ ...params, appSig: derSig, publicKeyPem }),
    ).toBe(true);
  });

  // Node/OpenSSL 3+ (and some Bun builds) reject crypto.sign(null, …) for EC keys with
  // ERR_OSSL_NO_DEFAULT_DIGEST -- see supportsNullDigestEcSign above. Skip rather than
  // fail on a capability this runtime lacks; the DER-compat test above already covers
  // legacy-signature verification with an explicit digest.
  test.skipIf(!supportsNullDigestEcSign())(
    "verifies legacy cryptoSign(null, …) EC signatures (pre–explicit digest, DER)",
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
      const message = [
        params.purchasedAt,
        params.paymentRef,
        params.itemUri,
        params.listingCid,
        params.buyerDid,
      ].join(":");
      const sk = createPrivateKey(normalizeAppMerchantPrivateKey(privateKeyPem));
      const legacySig = Buffer.from(
        cryptoSign(null, Buffer.from(message, "utf8"), sk),
      ).toString("base64url");

      expect(
        verifyReceiptPayload({ ...params, appSig: legacySig, publicKeyPem }),
      ).toBe(true);
    },
  );
});

describe("signConsentPayload / verifyConsentPayload", () => {
  const params = {
    buyerDid: "did:plc:buyer",
    licenseGrantCid: "bafyreiabc",
    receiptCid: "bafyreixyz",
    consentedAt: new Date().toISOString(),
  };

  test("round-trip with P-256 EC key (compact low-S appSig)", () => {
    const { privateKeyPem, publicKeyPem } = p256Pems();
    const appSig = signConsentPayload({ ...params, privateKeyPem });
    expect(Buffer.from(appSig, "base64url").length).toBe(64);
    expect(verifyConsentPayload({ ...params, appSig, publicKeyPem })).toBe(true);
  });
});
