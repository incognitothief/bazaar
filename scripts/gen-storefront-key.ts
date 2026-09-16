/**
 * Generate a storefront signing key and print the STOREFRONT_* block to set.
 *
 *   npx tsx scripts/gen-storefront-key.ts <your-store-domain | did:web:...>
 *
 * The storefront identity is always did:web. AT Protocol resolves did:web by fetching
 * https://<domain>/.well-known/did.json, which this app serves from the env vars below, so the
 * domain in the DID must be the domain the store is reachable at. (did:plc is the other
 * resolution method AT Protocol supports; it is for accounts on a PDS, not for a self-hosted
 * storefront identity, so nothing here produces one.)
 *
 * Run it again to rotate. If a current key is in the environment, the outgoing key is appended
 * to STOREFRONT_KEY_HISTORY as retired -- still trusted for receipts it already signed. To
 * hard-revoke instead, add "revoked": true to its entry by hand.
 *
 * Nothing is written to disk. The private key is printed once, in the one-line form the env
 * var takes; store it wherever your secrets live.
 */
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { formatMultikey } from "@atproto/crypto";

type HistoryEntry = {
  id: string;
  type: "Multikey";
  publicKeyMultibase: string;
  supersededBy: string;
  revoked?: boolean;
};

/**
 * A PEM out of .env or a Fly secret is often mangled: literal \n, CRLF, wrapping quotes, or the
 * whole key on one line. Reflow it into something createPublicKey accepts; a well-formed PEM
 * passes through unchanged. Mirrors normalizeStorefrontPrivateKey in
 * packages/server/src/lib/atproto/sign.ts -- keep the two in step.
 */
function normalizePem(raw: string): string {
  const t = raw
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
  return `-----BEGIN ${label}-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;
}

/** Trailing 65 bytes of an SPKI DER export are the uncompressed point: 0x04 || X(32) || Y(32). */
function multibaseOf(pem: string): string {
  const der = createPublicKey(normalizePem(pem)).export({
    type: "spki",
    format: "der",
  }) as Buffer;
  return formatMultikey("ES256", new Uint8Array(der.subarray(-65)));
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** did:web only -- from the argument, else STOREFRONT_DID. */
function resolveDid(): string {
  const arg = process.argv[2]?.trim();
  if (arg) {
    if (arg.startsWith("did:web:")) return arg;
    if (arg.startsWith("did:")) {
      fail(`gen-storefront-key: "${arg}" is not a did:web DID. A storefront identity is always did:web.`);
    }
    if (arg.includes("/") || arg.includes(":")) {
      fail(`gen-storefront-key: "${arg}" is not a bare domain. Pass e.g. store.example.com`);
    }
    return `did:web:${arg}`;
  }
  const env = process.env.STOREFRONT_DID?.trim();
  if (env?.startsWith("did:web:")) return env;
  if (env) fail(`gen-storefront-key: STOREFRONT_DID="${env}" is not did:web.`);
  return fail(
    "gen-storefront-key: pass your store's domain.\n" +
      "  npx tsx scripts/gen-storefront-key.ts store.example.com\n" +
      "It becomes did:web:store.example.com, resolved at https://store.example.com/.well-known/did.json.",
  );
}

function parseHistory(raw: string | undefined): HistoryEntry[] {
  const t = raw?.trim();
  if (!t || t.includes("PLACEHOLDER")) return [];
  const json = t.startsWith("[") ? t : Buffer.from(t, "base64").toString("utf8");
  const arr = JSON.parse(json);
  if (!Array.isArray(arr)) throw new Error("STOREFRONT_KEY_HISTORY is not a JSON array");
  return arr as HistoryEntry[];
}

const did = resolveDid();
const fragmentOf = (v: string) => (v.includes("#") ? v.slice(v.indexOf("#") + 1) : v);

// A current kid in the environment makes this a rotation rather than a first key.
const currentKid = process.env.STOREFRONT_KID?.trim();
const currentPrivate = process.env.STOREFRONT_PRIVATE_KEY?.trim();
const currentMultibaseEnv = process.env.STOREFRONT_PUBLIC_MULTIBASE?.trim();

let outgoing: HistoryEntry | null = null;
if (currentKid) {
  // Prefer deriving from the current private key: STOREFRONT_PUBLIC_MULTIBASE is optional in
  // normal operation (the server derives it), so it is often simply not set.
  let currentMultibase = currentMultibaseEnv;
  if (currentPrivate && !currentPrivate.includes("PLACEHOLDER")) {
    try {
      currentMultibase = multibaseOf(currentPrivate);
    } catch {
      /* fall back to the env value below */
    }
  }
  if (!currentMultibase) {
    fail(
      `gen-storefront-key: STOREFRONT_KID is set (${currentKid}) but the outgoing key's public\n` +
        "multibase could not be determined. Set STOREFRONT_PRIVATE_KEY to the current key, or\n" +
        "STOREFRONT_PUBLIC_MULTIBASE to its public multibase, then re-run.",
    );
  }
  outgoing = {
    id: currentKid.includes("#") ? currentKid : `${did}#${currentKid}`,
    type: "Multikey",
    publicKeyMultibase: currentMultibase,
    supersededBy: "",
  };
}

const history = parseHistory(process.env.STOREFRONT_KEY_HISTORY);

const today = new Date().toISOString().slice(0, 10);
let kid = `storefront-key-${today}`;
const taken = new Set(
  [currentKid, ...history.map((h) => h.id)].filter(Boolean).map((v) => fragmentOf(v as string)),
);
if (taken.has(kid)) {
  let n = 2;
  while (taken.has(`storefront-key-${today}-${n}`)) n++;
  kid = `storefront-key-${today}-${n}`;
}

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const publicPem = publicKey.export({ type: "spki", format: "pem" }) as string;
const multibase = formatMultikey(
  "ES256",
  new Uint8Array(
    (createPublicKey(publicPem).export({ type: "spki", format: "der" }) as Buffer).subarray(-65),
  ),
);
const onelinePrivate = privatePem.trim().replace(/\n/g, "\\n");

let newHistoryB64: string | null = null;
if (outgoing) {
  outgoing.supersededBy = `${did}#${kid}`;
  newHistoryB64 = Buffer.from(JSON.stringify([...history, outgoing])).toString("base64");
}

const divider = "─".repeat(72);
console.log(`
${outgoing ? "Storefront key rotation" : "Storefront signing key"} — set these
${divider}

  STOREFRONT_DID=${did}
  STOREFRONT_KID=${kid}
  STOREFRONT_PRIVATE_KEY=${onelinePrivate}
  STOREFRONT_PUBLIC_MULTIBASE=${multibase}${
    newHistoryB64 ? `\n  STOREFRONT_KEY_HISTORY=${newHistoryB64}` : ""
  }

${divider}

The private key is printed once and written nowhere. Store it with your other secrets; it is
the only thing that proves a receipt came from this store, and receipts already signed with it
cannot be re-signed.

STOREFRONT_PUBLIC_MULTIBASE is optional — the server derives it from the private key and uses
this only as a mismatch check.
${
  outgoing
    ? `\nOutgoing key ${fragmentOf(outgoing.id)} moves into keyHistory as retired: still trusted for
receipts it already signed. To hard-revoke it instead, add "revoked": true to its entry.

Decoded STOREFRONT_KEY_HISTORY:
${JSON.stringify(JSON.parse(Buffer.from(newHistoryB64!, "base64").toString("utf8")), null, 2)}
`
    : ""
}
After deploying, check https://${did.slice("did:web:".length)}/.well-known/did.json lists a
verificationMethod whose fragment is ${kid}.
`);
