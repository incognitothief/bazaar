import { createPublicKey } from "node:crypto";
import { formatDidKey, formatMultikey } from "@atproto/crypto";

/** Trailing 65 bytes of an SPKI DER export are the uncompressed point: 0x04 || X(32) || Y(32). */
function uncompressedPoint(pem: Buffer | string): Uint8Array {
  const der = createPublicKey(pem).export({
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
