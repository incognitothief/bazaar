import { createHash, createPrivateKey, sign } from "node:crypto";
import {
  normalizeAppServicePrivateKey,
} from "./atproto/sign";

export type BazaarIdentifierSigned = {
  id: string;
  sig: string;
  generatedAt: string;
};

function appPrivateKey() {
  const pem = process.env.APP_SERVICE_PRIVATE_KEY?.trim();
  if (!pem) {
    throw new Error("APP_SERVICE_PRIVATE_KEY not configured");
  }
  return createPrivateKey(normalizeAppServicePrivateKey(pem));
}

/** RFC 4648 base32 alphabet, lowercase, no padding — over raw digest bytes. */
export function base32LowerNoPad(buf: Buffer): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]!;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += alphabet[(value << (5 - bits)) & 31]!;
  }
  return out;
}

/** Sign the 32-byte SHA-256 digest (pre-hashed identifier payload). */
function signIdentifierDigest(digest: Buffer): string {
  const key = appPrivateKey();
  const sig = sign(null, digest, key);
  return Buffer.from(sig).toString("base64url");
}

/**
 * @see `.alignment/.../26_4_3-identifier-signing-strategy-v1.md` — bazaar:rid
 */
export function buildBazaarRid(params: {
  artistDid: string;
  fileCid: string;
  fileChecksum: string;
  createdAt: string;
}): BazaarIdentifierSigned {
  const canonical =
    "bazaar:rid:" +
    params.artistDid +
    ":" +
    params.fileCid +
    ":" +
    params.fileChecksum +
    ":" +
    params.createdAt;
  const digest = createHash("sha256").update(canonical, "utf8").digest();
  return {
    id: "bazaar:rid:" + base32LowerNoPad(digest),
    sig: signIdentifierDigest(digest),
    generatedAt: params.createdAt,
  };
}

export type WidWriterInput = {
  name?: string;
  ipi?: string;
  did?: string;
};

/**
 * writers_canonical = sort(writers[].ipi ?? writers[].did ?? writers[].name).join(",")
 * @see `.alignment/.../26_4_3-identifier-signing-strategy-v1.md` — bazaar:wid
 */
export function writersCanonicalForWid(writers: WidWriterInput[]): string {
  const keys = writers
    .map((w) =>
      (w.ipi?.trim() || w.did?.trim() || w.name?.trim() || "").trim(),
    )
    .filter(Boolean);
  keys.sort((a, b) => a.localeCompare(b));
  return keys.join(",");
}

export function buildBazaarWid(params: {
  artistDid: string;
  compositionTitle: string;
  writers: WidWriterInput[];
  createdAt: string;
}): BazaarIdentifierSigned {
  const writersCanonical = writersCanonicalForWid(params.writers);
  const canonical =
    "bazaar:wid:" +
    params.artistDid +
    ":" +
    params.compositionTitle +
    ":" +
    writersCanonical +
    ":" +
    params.createdAt;
  const digest = createHash("sha256").update(canonical, "utf8").digest();
  return {
    id: "bazaar:wid:" + base32LowerNoPad(digest),
    sig: signIdentifierDigest(digest),
    generatedAt: params.createdAt,
  };
}

/**
 * @see `.alignment/.../26_4_3-identifier-signing-strategy-v1.md` — bazaar:pid
 */
export function buildBazaarPid(params: {
  artistDid: string;
  collectionUri: string;
  releaseDate: string;
}): BazaarIdentifierSigned {
  const canonical =
    "bazaar:pid:" +
    params.artistDid +
    ":" +
    params.collectionUri +
    ":" +
    params.releaseDate;
  const digest = createHash("sha256").update(canonical, "utf8").digest();
  const generatedAt = new Date().toISOString();
  return {
    id: "bazaar:pid:" + base32LowerNoPad(digest),
    sig: signIdentifierDigest(digest),
    generatedAt,
  };
}

export function identifiersSigningConfigured(): boolean {
  return !!process.env.APP_SERVICE_PRIVATE_KEY?.trim();
}
