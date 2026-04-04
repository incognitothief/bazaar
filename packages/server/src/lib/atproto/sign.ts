import { createSign, createVerify } from "node:crypto";

export function signReceiptPayload(params: {
  purchasedAt: string;
  paymentRef: string;
  itemUri: string;
  listingCid: string;
  buyerDid: string;
  privateKeyPem: string;
}): string {
  const payload = [
    params.purchasedAt,
    params.paymentRef,
    params.itemUri,
    params.listingCid,
    params.buyerDid,
  ].join(":");
  const sign = createSign("RSA-SHA256");
  sign.update(payload);
  sign.end();
  return sign.sign(params.privateKeyPem, "base64url");
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
  const payload = [
    params.purchasedAt,
    params.paymentRef,
    params.itemUri,
    params.listingCid,
    params.buyerDid,
  ].join(":");
  const verify = createVerify("RSA-SHA256");
  verify.update(payload);
  verify.end();
  return verify.verify(
    params.publicKeyPem,
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
  const payload = [
    params.buyerDid,
    params.licenseGrantCid,
    params.receiptCid,
    params.consentedAt,
  ].join(":");
  const sign = createSign("RSA-SHA256");
  sign.update(payload);
  sign.end();
  return sign.sign(params.privateKeyPem, "base64url");
}

export function verifyConsentPayload(params: {
  buyerDid: string;
  licenseGrantCid: string;
  receiptCid: string;
  consentedAt: string;
  appSig: string;
  publicKeyPem: string;
}): boolean {
  const payload = [
    params.buyerDid,
    params.licenseGrantCid,
    params.receiptCid,
    params.consentedAt,
  ].join(":");
  const verify = createVerify("RSA-SHA256");
  verify.update(payload);
  verify.end();
  return verify.verify(
    params.publicKeyPem,
    Buffer.from(params.appSig, "base64url"),
  );
}
