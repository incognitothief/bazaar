import { createPublicKey } from "node:crypto";
import { formatMultikey } from "@atproto/crypto";

/**
 * SPKI PEM (P-256) → spec-conformant Multikey multibase string (`z…`).
 *
 * Encoding: multibase base58btc (`z`) over the `p256-pub` multicodec varint prefix
 * (`0x80 0x24`) followed by the **compressed** 33-byte EC point. This matches
 * `@atproto/crypto` `formatMultikey`, the W3C Multikey spec, and `did:key`, so a standard
 * `did:web` + Multikey resolver can decode `verificationMethod[].publicKeyMultibase`.
 *
 * (The earlier hand-rolled encoder used the raw bytes `0x12 0x00` and the uncompressed
 * 65-byte point — internally consistent but not decodable by any conformant resolver.)
 */
export function publicSpkiPemToMultibase(pem: string): string {
  const der = createPublicKey(pem).export({
    type: "spki",
    format: "der",
  }) as Buffer;
  // Trailing 65 bytes of the SPKI DER are the uncompressed point: 0x04 || X(32) || Y(32).
  const uncompressedPoint = der.subarray(-65);
  return formatMultikey("ES256", new Uint8Array(uncompressedPoint));
}
