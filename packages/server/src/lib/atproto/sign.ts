import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

/**
 * `APP_SERVICE_PRIVATE_KEY` from `.env` is often a valid PEM that dotenv / shells mangle
 * (literal `\\n`, CRLF, or the whole base64 on one line). OpenSSL/Bun are picky.
 * Supports PKCS#8 (`BEGIN PRIVATE KEY`), SEC1 EC (`BEGIN EC PRIVATE KEY`), PKCS#1 RSA, etc.
 */
export function normalizeAppServicePrivateKey(raw: string): string {
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
  const message = receiptPayloadString(params);
  const key = createPrivateKey(normalizeAppServicePrivateKey(params.privateKeyPem));
  const sig = cryptoSign(null, Buffer.from(message, "utf8"), key);
  return Buffer.from(sig).toString("base64url");
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
  const message = receiptPayloadString(params);
  const key = createPublicKey(params.publicKeyPem);
  return cryptoVerify(
    null,
    Buffer.from(message, "utf8"),
    key,
    Buffer.from(params.appSig, "base64url"),
  );
}

export function signConsentPayload(params: {
  buyerDid: string;
  licenseGrantCid: string;
  receiptCid: string;
  consentedAt: string;
  privateKeyPem: string;
}): string {
  const message = consentPayloadString(params);
  const key = createPrivateKey(normalizeAppServicePrivateKey(params.privateKeyPem));
  const sig = cryptoSign(null, Buffer.from(message, "utf8"), key);
  return Buffer.from(sig).toString("base64url");
}

export function verifyConsentPayload(params: {
  buyerDid: string;
  licenseGrantCid: string;
  receiptCid: string;
  consentedAt: string;
  appSig: string;
  publicKeyPem: string;
}): boolean {
  const message = consentPayloadString(params);
  const key = createPublicKey(params.publicKeyPem);
  return cryptoVerify(
    null,
    Buffer.from(message, "utf8"),
    key,
    Buffer.from(params.appSig, "base64url"),
  );
}
