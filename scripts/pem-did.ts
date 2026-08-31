import { createPublicKey } from "node:crypto";
import { formatDidKey, formatMultikey } from "@atproto/crypto";

/**
 * A PEM pasted from `.env` or a Fly secret is often mangled: literal `\n`, CRLF, surrounding
 * quotes, or the whole key on one line with spaces where the newlines belong. Reflow it into
 * something `createPublicKey` accepts. A well-formed PEM passes through unchanged.
 *
 * Mirrors `normalizeAppMerchantPrivateKey` in
 * `packages/server/src/lib/atproto/sign.ts` — keep the two in step.
 */
export function normalizePem(raw: Buffer | string): string {
  const t = (typeof raw === "string" ? raw : raw.toString("utf8"))
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\r\n?/g, "\n");
  const begin = t.match(/-----BEGIN ([A-Z0-9 ]+?)-----/);
  const end = t.match(/-----END ([A-Z0-9 ]+?)-----/);
  if (!begin || !end || begin[1] !== end[1]) return t;
  const label = begin[1];
  const start = begin.index! + begin[0].length;
  const stop = t.indexOf(end[0], start);
  if (stop <= start) return t;
  const body = t.slice(start, stop).replace(/\s+/g, "");
  if (!body) return t;
  const wrapped = body.match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
}

/**
 * Trailing 65 bytes of an SPKI DER export are the uncompressed point: 0x04 || X(32) || Y(32).
 * `createPublicKey` accepts a private key PEM too (it derives the public half), so every helper
 * here works whether you pass the public or the private key.
 */
function uncompressedPoint(pem: Buffer | string): Uint8Array {
  const der = createPublicKey(normalizePem(pem)).export({
    type: "spki",
    format: "der",
  }) as Buffer;
  return new Uint8Array(der.subarray(-65));
}

/**
 * P-256 SPKI PEM → spec-conformant Multikey multibase string (`z…`): `p256-pub` multicodec
 * varint prefix (`0x80 0x24`) + compressed 33-byte point, base58btc. Matches `@atproto/crypto`,
 * W3C Multikey, and `did:key`, so a standard `did:web` resolver can decode it.
 */
export function publicPemToMultibase(pem: Buffer | string): string {
  return formatMultikey("ES256", uncompressedPoint(pem));
}

export function publicPemToDidKey(pem: Buffer | string): string {
  return formatDidKey("ES256", uncompressedPoint(pem));
}
