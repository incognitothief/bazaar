/**
 * Manage the storefront signing key.
 *
 *   npx tsx scripts/gen-storefront-key.ts <your-store-address>   first key
 *   npx tsx scripts/gen-storefront-key.ts                        re-print the env block
 *   npx tsx scripts/gen-storefront-key.ts --rotate               new key, old one retired
 *   npx tsx scripts/gen-storefront-key.ts --revoke <kid>         disavow a key
 *
 * State lives in key files under keys/, one per key, not in environment variables. Every run
 * prints the full block of secrets to set; the files are what let a later run rebuild it.
 *
 * The storefront identity is always did:web. AT Protocol resolves it by fetching
 * https://<domain>/.well-known/did.json, which this app serves from those secrets, so the
 * domain must be the one the store is reachable at. (did:plc is AT Protocol's other resolution
 * method; it is for accounts on a PDS, not for a self-hosted storefront identity.)
 *
 * Retired vs revoked, which is the distinction the key files exist to record:
 *   active   the key being signed with. Exactly one, and the only entry in assertionMethod.
 *   retired  rotated away from, still trusted for receipts it already signed. Stays in
 *            verificationMethod.
 *   revoked  disavowed. Dropped from verificationMethod, and receipts naming it are rejected
 *            outright -- use it when a key leaked, not when you rotated on schedule.
 */
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatMultikey } from "@atproto/crypto";

const KEYS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "keys");

type KeyStatus = "active" | "retired" | "revoked";

type KeyFile = {
  did: string;
  kid: string;
  created: string;
  status: KeyStatus;
  publicKeyMultibase: string;
  /** Present while you still hold it. Only the active key ever needs one. */
  privateKeyPem?: string;
  /** Full DID URL of the key that replaced this one; null while active. */
  supersededBy: string | null;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * A PEM out of a file or a secret store is often mangled: literal \n, CRLF, wrapping quotes, or
 * the whole key on one line. Reflow it into something createPublicKey accepts. Mirrors
 * normalizeStorefrontPrivateKey in packages/server/src/lib/atproto/sign.ts -- keep them in step.
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
function multibaseOfPem(pem: string): string {
  const der = createPublicKey(normalizePem(pem)).export({
    type: "spki",
    format: "der",
  }) as Buffer;
  return formatMultikey("ES256", new Uint8Array(der.subarray(-65)));
}

/**
 * Pull a hostname out of whatever the operator pasted. People copy out of a browser bar, so
 * accept scheme, trailing slash, path, a did:web: prefix, quotes and stray whitespace. Ports are
 * refused rather than dropped: did:web encodes them (did:web:host%3A3000), and removing one
 * silently yields a DID that resolves somewhere the store is not.
 */
function hostnameFrom(raw: string): string {
  let v = raw.trim().replace(/^["']|["']$/g, "");
  v = v.replace(/^did:web:/i, "");
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  v = v.replace(/^[^/@]*@/, "");
  v = v.split(/[/?#]/)[0];
  v = v.replace(/\.+$/, "").toLowerCase();
  if (/:\d+$/.test(v) || v.includes("%3a")) {
    fail(
      `gen-storefront-key: "${raw.trim()}" includes a port.\n` +
        "A storefront DID must name the host your store is served from on 443, with no port.",
    );
  }
  return v;
}

function readKeyFiles(): { path: string; key: KeyFile }[] {
  if (!existsSync(KEYS_DIR)) return [];
  const out: { path: string; key: KeyFile }[] = [];
  for (const name of readdirSync(KEYS_DIR).sort()) {
    if (!name.endsWith(".json")) continue;
    const path = join(KEYS_DIR, name);
    let key: KeyFile;
    try {
      key = JSON.parse(readFileSync(path, "utf8")) as KeyFile;
    } catch (e) {
      fail(`gen-storefront-key: ${name} is not valid JSON (${(e as Error).message}).`);
    }
    for (const field of ["did", "kid", "created", "status", "publicKeyMultibase"] as const) {
      if (typeof key[field] !== "string" || !key[field]) {
        fail(`gen-storefront-key: ${name} is missing "${field}".`);
      }
    }
    if (!["active", "retired", "revoked"].includes(key.status)) {
      fail(`gen-storefront-key: ${name} has status "${key.status}" (expected active/retired/revoked).`);
    }
    out.push({ path, key });
  }
  out.sort((a, b) => a.key.created.localeCompare(b.key.created));
  return out;
}

function fileNameFor(created: string): string {
  return `storefront-${created.replace(/[:.]/g, "-")}.json`;
}

function write(path: string, key: KeyFile): void {
  mkdirSync(KEYS_DIR, { recursive: true });
  writeFileSync(path, `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600 });
}

/** STOREFRONT_KEY_HISTORY: every non-active key, oldest first, chained by supersededBy. */
function historyBlock(files: { key: KeyFile }[]): string | null {
  const entries = files
    .filter((f) => f.key.status !== "active")
    .map((f) => ({
      id: `${f.key.did}#${f.key.kid}`,
      type: "Multikey" as const,
      publicKeyMultibase: f.key.publicKeyMultibase,
      supersededBy: f.key.supersededBy ?? "",
      ...(f.key.status === "revoked" ? { revoked: true } : {}),
    }));
  if (!entries.length) return null;
  const missing = entries.filter((e) => !e.supersededBy);
  if (missing.length) {
    fail(
      `gen-storefront-key: ${missing.map((m) => m.id).join(", ")} is not active but has no\n` +
        "supersededBy. Every non-active key must record which key replaced it.",
    );
  }
  return Buffer.from(JSON.stringify(entries)).toString("base64");
}

function printEnv(active: KeyFile, files: { key: KeyFile }[]): void {
  const history = historyBlock(files);
  const retired = files.filter((f) => f.key.status === "retired").length;
  const revoked = files.filter((f) => f.key.status === "revoked").length;
  const divider = "─".repeat(72);
  console.log(`
Set these on your deployment
${divider}

  STOREFRONT_DID=${active.did}
  STOREFRONT_KID=${active.kid}
  STOREFRONT_PRIVATE_KEY=${
    active.privateKeyPem
      ? active.privateKeyPem.trim().replace(/\n/g, "\\n")
      : "(not in the key file — see below)"
  }
  STOREFRONT_PUBLIC_MULTIBASE=${active.publicKeyMultibase}${
    history ? `\n  STOREFRONT_KEY_HISTORY=${history}` : ""
  }

${divider}

Set them together, in one command. Deploying a new key without its matching
STOREFRONT_KEY_HISTORY drops the old key out of the DID document, and every receipt it signed
stops verifying until you fix it.

Keys: 1 active, ${retired} retired, ${revoked} revoked.

Your key files are in keys/. Keep them — a later rotation rebuilds STOREFRONT_KEY_HISTORY from
them, so losing them means losing the ability to prove past receipts were yours. They are
gitignored, but they hold private keys in plain text: keep them out of shared folders and
backups, and delete any you are certain you no longer need.

After deploying, check https://${active.did.slice("did:web:".length)}/.well-known/did.json lists a
verificationMethod whose fragment is ${active.kid}.
`);
}

function newKey(did: string, taken: Set<string>): KeyFile {
  const created = new Date().toISOString();
  const day = created.slice(0, 10);
  let kid = `storefront-key-${day}`;
  if (taken.has(kid)) {
    let n = 2;
    while (taken.has(`storefront-key-${day}-${n}`)) n++;
    kid = `storefront-key-${day}-${n}`;
  }
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return {
    did,
    kid,
    created,
    status: "active",
    publicKeyMultibase: multibaseOfPem(publicKey.export({ type: "spki", format: "pem" }) as string),
    privateKeyPem,
    supersededBy: null,
  };
}

// ─── main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const rotate = args.includes("--rotate");
const revokeAt = args.indexOf("--revoke");
const revokeKid = revokeAt === -1 ? null : args[revokeAt + 1];
// revokeAt is -1 when --revoke is absent; guard it, or index 0 gets eaten as its value.
const revokeValueAt = revokeAt === -1 ? -1 : revokeAt + 1;
const positional = args.filter((a, i) => !a.startsWith("--") && i !== revokeValueAt);

if (revokeAt !== -1 && !revokeKid) {
  fail("gen-storefront-key: --revoke needs a kid, e.g. --revoke storefront-key-2026-09-16");
}

const files = readKeyFiles();
const actives = files.filter((f) => f.key.status === "active");

if (actives.length > 1) {
  fail(
    "gen-storefront-key: more than one key file is marked active:\n" +
      actives.map((f) => `  ${f.key.kid}`).join("\n") +
      "\nExactly one key signs at a time. Set the others to retired or revoked.",
  );
}

if (revokeKid) {
  const target = files.find((f) => f.key.kid === revokeKid);
  if (!target) fail(`gen-storefront-key: no key file with kid "${revokeKid}" in keys/.`);
  if (target.key.status === "active") {
    fail(
      `gen-storefront-key: ${revokeKid} is the active key. Rotate first (--rotate), then revoke it.`,
    );
  }
  target.key.status = "revoked";
  write(target.path, target.key);
  console.log(`\nRevoked ${revokeKid}. Receipts naming it will now be rejected outright.`);
  const active = actives[0];
  if (!active) fail("gen-storefront-key: no active key to print an env block for.");
  printEnv(active.key, files);
  process.exit(0);
}

if (actives.length === 0) {
  // First key. Needs a domain; there is nothing on disk to take one from.
  const arg = positional[0];
  if (!arg) {
    fail(
      "gen-storefront-key: no key files in keys/, so this is a first key — pass the address\n" +
        "your store is reachable at.\n" +
        "  npx tsx scripts/gen-storefront-key.ts store.example.com",
    );
  }
  const host = hostnameFrom(arg);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host)) {
    fail(
      `gen-storefront-key: could not read a domain from "${arg}".\n` +
        "Pass the address your store is reachable at, e.g. store.example.com\n" +
        "(pasting https://store.example.com/ is fine).",
    );
  }
  const key = newKey(`did:web:${host}`, new Set());
  write(join(KEYS_DIR, fileNameFor(key.created)), key);
  console.log(`\nWrote keys/${fileNameFor(key.created)}`);
  printEnv(key, [{ key }]);
  process.exit(0);
}

const active = actives[0];

if (!rotate) {
  // Default is to re-print, never to rotate: generating a key is what you do deliberately.
  if (positional.length) {
    console.error(
      `gen-storefront-key: ignoring "${positional[0]}" — keys/ already has an active key, so the\n` +
        `DID comes from it (${active.key.did}). Use --rotate to replace the key.\n`,
    );
  }
  printEnv(active.key, files);
  process.exit(0);
}

const taken = new Set(files.map((f) => f.key.kid));
const next = newKey(active.key.did, taken);

active.key.status = "retired";
active.key.supersededBy = `${active.key.did}#${next.kid}`;
write(active.path, active.key);
write(join(KEYS_DIR, fileNameFor(next.created)), next);

console.log(
  `\nRotated ${active.key.kid} → ${next.kid}` +
    `\n  retired keys/${active.path.split("/").pop()}` +
    `\n  wrote   keys/${fileNameFor(next.created)}`,
);
printEnv(next, [...files, { key: next }]);
