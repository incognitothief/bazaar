import { CID } from "multiformats/cid";
import * as rawCodec from "multiformats/codecs/raw";
import { create as mhCreate } from "multiformats/hashes/digest";

/** multiformats sha256 multihash code */
const SHA256_CODE = 0x12;

/**
 * IPLD CIDv1 (raw codec) where the multihash is SHA-256 of the file bytes.
 * Use when you already have the 32-byte SHA-256 digest of the content.
 */
export function cidFromSha256Digest32(digest32: Uint8Array): string {
  if (digest32.byteLength !== 32) {
    throw new Error("Expected 32-byte sha256 digest");
  }
  const mh = mhCreate(SHA256_CODE, digest32);
  return CID.createV1(rawCodec.code, mh).toString();
}

