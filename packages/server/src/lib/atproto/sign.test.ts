import {
  createPrivateKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  storefrontKidFromEnv,
  normalizeStorefrontPrivateKey,
  signReceiptPayload,
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

describe("storefrontKidFromEnv", () => {
  test("returns null when unset", () => {
    const prev = process.env.STOREFRONT_KID;
    delete process.env.STOREFRONT_KID;
    try {
      expect(storefrontKidFromEnv()).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.STOREFRONT_KID;
      else process.env.STOREFRONT_KID = prev;
    }
  });

  test("returns trimmed value when set", () => {
    const prev = process.env.STOREFRONT_KID;
    process.env.STOREFRONT_KID = "  storefront-key-2026-08-29  ";
    try {
      expect(storefrontKidFromEnv()).toBe("storefront-key-2026-08-29");
    } finally {
      if (prev === undefined) delete process.env.STOREFRONT_KID;
      else process.env.STOREFRONT_KID = prev;
    }
  });
});

describe("signReceiptPayload / verifyReceiptPayload", () => {
  const LICENSE_GRANT_CID = "bafyreilicensegrantcid";
  const ENTITLEMENT_DIGEST = "Zm9vYmFyZW50aXRsZW1lbnRkaWdlc3RfXw";

  /** All seven payload fields. None are optional any more -- see ADR 0019. */
  const params = {
    purchasedAt: new Date().toISOString(),
    paymentRef: "pi_test",
    itemUri: "at://did:plc:test/diamonds.whereditgo.bazaar.catalog.item/rkey",
    listingCid: "bafyrei",
    buyerDid: "did:plc:buyer",
    licenseGrantCid: LICENSE_GRANT_CID,
    entitlementDigest: ENTITLEMENT_DIGEST,
  };

  test("round-trip with P-256 EC key (compact low-S storefrontSig)", () => {
    const { privateKeyPem, publicKeyPem } = p256Pems();
    const storefrontSig = signReceiptPayload({ ...params, privateKeyPem });

    // Wire format: 64-byte IEEE-P1363 (r || s).
    const raw = Buffer.from(storefrontSig, "base64url");
    expect(raw.length).toBe(64);
    // Low-S: s <= n/2.
    const s = BigInt(`0x${raw.subarray(32).toString("hex")}`);
    expect(s <= P256_HALF_N).toBe(true);

    expect(verifyReceiptPayload({ ...params, storefrontSig, publicKeyPem })).toBe(true);
  });

  test("tampered field fails verification", () => {
    const { privateKeyPem, publicKeyPem } = p256Pems();
    const storefrontSig = signReceiptPayload({ ...params, privateKeyPem });
    expect(
      verifyReceiptPayload({
        ...params,
        paymentRef: "pi_tampered",
        storefrontSig,
        publicKeyPem,
      }),
    ).toBe(false);
  });

  test("entitlementDigest is bound into the signature", () => {
    const { privateKeyPem, publicKeyPem } = p256Pems();
    const storefrontSig = signReceiptPayload({ ...params, privateKeyPem });
    expect(
      verifyReceiptPayload({
        ...params,
        entitlementDigest: `${ENTITLEMENT_DIGEST}x`,
        storefrontSig,
        publicKeyPem,
      }),
    ).toBe(false);
  });

  test("licenseGrantCid is bound into the signature (atomic license freeze)", () => {
    const { privateKeyPem, publicKeyPem } = p256Pems();
    const storefrontSig = signReceiptPayload({ ...params, privateKeyPem });
    // A buyer editing their own receipt's licenseGrant can't keep this valid.
    expect(
      verifyReceiptPayload({
        ...params,
        licenseGrantCid: `${LICENSE_GRANT_CID}x`,
        storefrontSig,
        publicKeyPem,
      }),
    ).toBe(false);
  });

  test("field order is fixed -- swapping the last two values must not verify", () => {
    const { privateKeyPem, publicKeyPem } = p256Pems();
    const storefrontSig = signReceiptPayload({ ...params, privateKeyPem });
    expect(
      verifyReceiptPayload({
        ...params,
        licenseGrantCid: ENTITLEMENT_DIGEST,
        entitlementDigest: LICENSE_GRANT_CID,
        storefrontSig,
        publicKeyPem,
      }),
    ).toBe(false);
  });

  /**
   * Regression for ADR 0019. Receipts issued before 2026-08-29 carry a
   * DER-encoded signature, and verifyCanonical used to fall back to accepting
   * one. It must not any more: a DER signature is not 64 bytes and is rejected
   * on length alone.
   */
  test("a DER-encoded signature is rejected", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
    const message = [
      params.purchasedAt,
      params.paymentRef,
      params.itemUri,
      params.listingCid,
      params.buyerDid,
      params.licenseGrantCid,
      params.entitlementDigest,
    ].join(":");
    // Default dsaEncoding is "der" -- what the pre-remediation signer produced.
    const derSig = Buffer.from(
      cryptoSign(
        "sha256",
        Buffer.from(message, "utf8"),
        createPrivateKey(normalizeStorefrontPrivateKey(privateKeyPem)),
      ),
    ).toString("base64url");

    expect(Buffer.from(derSig, "base64url").length).not.toBe(64);
    expect(
      verifyReceiptPayload({ ...params, storefrontSig: derSig, publicKeyPem }),
    ).toBe(false);
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
    expect(normalizeStorefrontPrivateKey(oneLine)).toContain("\n");

    const storefrontSig = signReceiptPayload({ ...params, privateKeyPem: oneLine });
    expect(verifyReceiptPayload({ ...params, storefrontSig, publicKeyPem })).toBe(true);
  });
});
