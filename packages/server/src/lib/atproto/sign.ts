import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

/**
 * Explicit digest for receipt/consent signatures. OpenSSL 3 + some Bun builds throw
 * ERR_OSSL_NO_DEFAULT_DIGEST when verify(null, …) is used with SPKI public keys.
 */
const APP_SIG_DIGEST = "sha256";

const APP_MERCHANT_KID_MAX = 64;

/**
 * `appSig` is a 64-byte IEEE-P1363 (raw `r || s`) ECDSA/P-256 signature, normalised to low-S,
 * base64url-encoded. This is the AT Protocol convention (`@atproto/crypto`, and the
 * `bazaar-vault/Demos/verify-receipt.ts` reference verifier). Older field receipts carry a
 * DER-encoded signature instead — see the fallback in `verifyCanonical` below.
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
 * Optional lexicon `kid` (e.g. merchant-key-2026-08-29), matching the active fragment in
 * `packages/server/config/did-document.template.json` assertionMethod / verificationMethod.
 */
export function appMerchantKidFromEnv(): string | null {
  const k = process.env.APP_MERCHANT_KID?.trim();
  if (!k) return null;
  return k.length > APP_MERCHANT_KID_MAX ? k.slice(0, APP_MERCHANT_KID_MAX) : k;
}

/** SPKI PEM for verifyReceiptPayload / verifyConsentPayload when only APP_MERCHANT_PRIVATE_KEY is configured. */
export function appMerchantPublicKeyPemFromEnv(): string | null {
  const raw = process.env.APP_MERCHANT_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const priv = createPrivateKey(normalizeAppMerchantPrivateKey(raw));
  const pub = createPublicKey(priv);
  return pub.export({ type: "spki", format: "pem" }) as string;
}

/**
 * `APP_MERCHANT_PRIVATE_KEY` from `.env` is often a valid PEM that dotenv / shells mangle
 * (literal `\\n`, CRLF, or the whole base64 on one line). OpenSSL/Bun are picky.
 * Supports PKCS#8 (`BEGIN PRIVATE KEY`), SEC1 EC (`BEGIN EC PRIVATE KEY`), PKCS#1 RSA, etc.
 */
export function normalizeAppMerchantPrivateKey(raw: string): string {
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
  const key = createPrivateKey(normalizeAppMerchantPrivateKey(privateKeyPem));
  const raw = cryptoSign(APP_SIG_DIGEST, Buffer.from(message, "utf8"), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return toLowS(Buffer.from(raw)).toString("base64url");
}

/**
 * Verify `message` against a base64url signature.
 *
 * Current format: 64-byte IEEE-P1363 (`r || s`).
 *
 * TEMPORARY: falls back to a DER-encoded signature for pre-migration field receipts /
 * consent records. Remove this fallback once those records are migrated to the new
 * attestation structure — the target state is a single compact/low-S resolution path.
 * See `docs/adr/0013-key-rotation-and-did-document-v2.md` and the vault ticket
 * "2026-08-29 Remove DER appSig fallback after field-receipt migration".
 */
function verifyCanonical(
  message: string,
  appSig: string,
  publicKeyPem: string,
): boolean {
  const key = createPublicKey(publicKeyPem);
  const msg = Buffer.from(message, "utf8");
  const sig = Buffer.from(appSig, "base64url");
  if (sig.length === P256_SIG_BYTES) {
    try {
      if (cryptoVerify(APP_SIG_DIGEST, msg, { key, dsaEncoding: "ieee-p1363" }, sig)) {
        return true;
      }
    } catch {
      // fall through to the DER fallback
    }
  }
  try {
    return cryptoVerify(APP_SIG_DIGEST, msg, key, sig);
  } catch {
    return false;
  }
}

function receiptPayloadString(params: {
  purchasedAt: string;
  paymentRef: string;
  itemUri: string;
  listingCid: string;
  buyerDid: string;
}): string {
  return [
    params.purchasedAt,
    params.paymentRef,
    params.itemUri,
    params.listingCid,
    params.buyerDid,
  ].join(":");
}

function consentPayloadString(params: {
  buyerDid: string;
  licenseGrantCid: string;
  receiptCid: string;
  consentedAt: string;
}): string {
  return [
    params.buyerDid,
    params.licenseGrantCid,
    params.receiptCid,
    params.consentedAt,
  ].join(":");
}

export function signReceiptPayload(params: {
  purchasedAt: string;
  paymentRef: string;
  itemUri: string;
  listingCid: string;
  buyerDid: string;
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
  appSig: string;
  publicKeyPem: string;
}): boolean {
  return verifyCanonical(
    receiptPayloadString(params),
    params.appSig,
    params.publicKeyPem,
  );
}

export function signConsentPayload(params: {
  buyerDid: string;
  licenseGrantCid: string;
  receiptCid: string;
  consentedAt: string;
  privateKeyPem: string;
}): string {
  return signCanonical(consentPayloadString(params), params.privateKeyPem);
}

export function verifyConsentPayload(params: {
  buyerDid: string;
  licenseGrantCid: string;
  receiptCid: string;
  consentedAt: string;
  appSig: string;
  publicKeyPem: string;
}): boolean {
  return verifyCanonical(
    consentPayloadString(params),
    params.appSig,
    params.publicKeyPem,
  );
}
