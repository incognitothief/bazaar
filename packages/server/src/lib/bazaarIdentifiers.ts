import { createHash, createPrivateKey, sign } from "node:crypto";
import { normalizeStorefrontPrivateKey } from "./atproto/sign";

/**
 * DEPRECATED: the self-issued `bazaarRid` / `bazaarWid` / `bazaarPid` identifier scheme is
 * slated for removal. Its `sig` is still a DER-encoded ECDSA signature (not the compact/low-S
 * `r || s` form used by `purchase.receipt` as of the 2026-08 remediation).
 * Do not extend this module — new signed-record work targets receipt only.
 * See `docs/adr/0013-key-rotation-and-did-document-v2.md`.
 */

export type BazaarIdentifierSigned = {
  id: string;
  sig: string;
  generatedAt: string;
};

function appPrivateKey() {
  const pem = process.env.STOREFRONT_PRIVATE_KEY?.trim();
  if (!pem) {
    throw new Error("STOREFRONT_PRIVATE_KEY not configured");
  }
  return createPrivateKey(normalizeStorefrontPrivateKey(pem));
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

/**
 * Sign the identifier payload. `id` is still base32(SHA-256(canonical)).
 *
 * Never use `sign(null, digest, key)` on a pre-hashed buffer — OpenSSL 3 + Bun throw
 * `ERR_OSSL_NO_DEFAULT_DIGEST` (NO_DEFAULT_DIGEST).
 *
 * - RSA / EC: `sign("sha256", canonicalUtf8, key)` (same hash input as `id`).
 * - Ed25519 / Ed448: `sign(null, canonicalUtf8, key)` (one-shot; message is full canonical).
 * - Unknown key types: try `sha256` first, then one-shot on the canonical bytes.
 */
function signIdentifierCanonical(canonical: string, _digest: Buffer): string {
  const key = appPrivateKey();
  const msg = Buffer.from(canonical, "utf8");
  const t = key.asymmetricKeyType;

  if (t === "rsa" || t === "ec") {
    return Buffer.from(sign("sha256", msg, key)).toString("base64url");
  }

  if (t === "ed25519" || t === "ed448") {
    return Buffer.from(sign(null, msg, key)).toString("base64url");
  }

  try {
    return Buffer.from(sign("sha256", msg, key)).toString("base64url");
  } catch {
    return Buffer.from(sign(null, msg, key)).toString("base64url");
  }
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
    sig: signIdentifierCanonical(canonical, digest),
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
    sig: signIdentifierCanonical(canonical, digest),
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
    sig: signIdentifierCanonical(canonical, digest),
    generatedAt,
  };
}

export function identifiersSigningConfigured(): boolean {
  return !!process.env.STOREFRONT_PRIVATE_KEY?.trim();
}
