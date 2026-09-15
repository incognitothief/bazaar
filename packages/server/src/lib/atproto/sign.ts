import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

/**
 * Explicit digest for receipt signatures. OpenSSL 3 + some Bun builds throw
 * ERR_OSSL_NO_DEFAULT_DIGEST when verify(null, …) is used with SPKI public keys.
 */
const STOREFRONT_SIG_DIGEST = "sha256";

const STOREFRONT_KID_MAX = 64;

/**
 * `storefrontSig` is a 64-byte IEEE-P1363 (raw `r || s`) ECDSA/P-256 signature, normalised to low-S,
 * base64url-encoded. This is the AT Protocol convention (`@atproto/crypto`, and the
 * `bazaar-vault/Demos/verify-receipt.ts` reference verifier). This is the only accepted
 * encoding; the DER fallback for pre-2026-08-29 field receipts was removed (ADR 0019).
 */
const P256_SIG_BYTES = 64;

/** P-256 curve order n and n/2, for low-S normalisation of a raw `r || s` signature. */
const P256_N = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
);
const P256_HALF_N = P256_N >> 1n;

/** Normalise a 64-byte IEEE-P1363 (`r || s`) signature to low-S form; pass through anything else. */
function toLowS(sig: Buffer): Buffer {
  if (sig.length !== P256_SIG_BYTES) return sig;
  const r = sig.subarray(0, 32);
  let s = BigInt(`0x${sig.subarray(32).toString("hex")}`);
  if (s <= P256_HALF_N) return sig;
  s = P256_N - s;
  return Buffer.concat([r, Buffer.from(s.toString(16).padStart(64, "0"), "hex")]);
}

/**
 * Optional lexicon `kid` (e.g. storefront-key-2026-08-29), matching the active fragment in
 * `packages/server/config/did-document.template.json` assertionMethod / verificationMethod.
 */
export function storefrontKidFromEnv(): string | null {
  const k = process.env.STOREFRONT_KID?.trim();
  if (!k) return null;
  return k.length > STOREFRONT_KID_MAX ? k.slice(0, STOREFRONT_KID_MAX) : k;
}

/** SPKI PEM for verifyReceiptPayload when only STOREFRONT_PRIVATE_KEY is configured. */
export function storefrontPublicKeyPemFromEnv(): string | null {
  const raw = process.env.STOREFRONT_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const priv = createPrivateKey(normalizeStorefrontPrivateKey(raw));
  const pub = createPublicKey(priv);
  return pub.export({ type: "spki", format: "pem" }) as string;
}

/**
 * `STOREFRONT_PRIVATE_KEY` from `.env` is often a valid PEM that dotenv / shells mangle
 * (literal `\\n`, CRLF, or the whole base64 on one line). OpenSSL/Bun are picky.
 * Supports PKCS#8 (`BEGIN PRIVATE KEY`), SEC1 EC (`BEGIN EC PRIVATE KEY`), PKCS#1 RSA, etc.
 */
export function normalizeStorefrontPrivateKey(raw: string): string {
  let t = raw
    .trim()
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!t.includes("BEGIN")) {
    const body = t.replace(/\s+/g, "");
    return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
  }
  const beginM = t.match(/^-----BEGIN ([^-]+)-----/m);
  const endM = t.match(/-----END ([^-]+)-----/m);
  if (!beginM || !endM || beginM[1] !== endM[1]) return t;
  const label = beginM[1];
  const start = beginM.index! + beginM[0].length;
  const end = t.indexOf(endM[0], start);
  if (end <= start) return t;
  const body = t.slice(start, end).replace(/\s+/g, "");
  if (!body) return t;
  const chunked = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN ${label}-----\n${chunked}\n-----END ${label}-----`;
}

/** Sign `message` and return a base64url low-S IEEE-P1363 (`r || s`) ECDSA/P-256 signature. */
function signCanonical(message: string, privateKeyPem: string): string {
  const key = createPrivateKey(normalizeStorefrontPrivateKey(privateKeyPem));
  const raw = cryptoSign(STOREFRONT_SIG_DIGEST, Buffer.from(message, "utf8"), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return toLowS(Buffer.from(raw)).toString("base64url");
}

/**
 * Verify `message` against a base64url signature.
 *
 * Single resolution path: a 64-byte IEEE-P1363 (`r || s`) low-S signature.
 * Anything else -- including the DER encoding this used to accept from
 * pre-2026-08-29 field receipts -- fails on length alone. See ADR 0013 §6
 * and ADR 0019.
 */
function verifyCanonical(
  message: string,
  storefrontSig: string,
  publicKeyPem: string,
): boolean {
  const sig = Buffer.from(storefrontSig, "base64url");
  if (sig.length !== P256_SIG_BYTES) return false;
  try {
    const key = createPublicKey(publicKeyPem);
    const msg = Buffer.from(message, "utf8");
    return cryptoVerify(STOREFRONT_SIG_DIGEST, msg, { key, dsaEncoding: "ieee-p1363" }, sig);
  } catch {
    return false;
  }
}

/**
 * The signed payload: seven colon-delimited fields, always all seven.
 *
 * `licenseGrantCid` freezes the license terms atomically with the purchase
 * (ADR 0016); `entitlementDigest` freezes exactly what was bought (see
 * `entitlement.ts`). Both used to be optional and appended only when present,
 * so a receipt could be verified against a five-, six- or seven-field payload.
 * That variadic form is what made pre-2026-09 receipts verifiable, and it is
 * gone: a receipt missing either field cannot produce this string and will not
 * verify. See ADR 0019.
 */
function receiptPayloadString(params: {
  purchasedAt: string;
  paymentRef: string;
  itemUri: string;
  listingCid: string;
  buyerDid: string;
  licenseGrantCid: string;
  entitlementDigest: string;
}): string {
  return [
    params.purchasedAt,
    params.paymentRef,
    params.itemUri,
    params.listingCid,
    params.buyerDid,
    params.licenseGrantCid,
    params.entitlementDigest,
  ].join(":");
}

export function signReceiptPayload(params: {
  purchasedAt: string;
  paymentRef: string;
  itemUri: string;
  listingCid: string;
  buyerDid: string;
  licenseGrantCid: string;
  entitlementDigest: string;
  privateKeyPem: string;
}): string {
  return signCanonical(receiptPayloadString(params), params.privateKeyPem);
}

export function verifyReceiptPayload(params: {
  purchasedAt: string;
  paymentRef: string;
  itemUri: string;
  listingCid: string;
  buyerDid: string;
  licenseGrantCid: string;
  entitlementDigest: string;
  storefrontSig: string;
  publicKeyPem: string;
}): boolean {
  return verifyCanonical(
    receiptPayloadString(params),
    params.storefrontSig,
    params.publicKeyPem,
  );
}
