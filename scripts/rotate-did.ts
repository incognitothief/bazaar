import { readFileSync } from "node:fs";
import { publicPemToMultibase } from "./pem-did";

/**
 * Storefront key rotation helper — see docs/adr/0013-key-rotation-and-did-document-v2.md §5.
 *
 * Reads the CURRENT key material from the environment (STOREFRONT_KID,
 * STOREFRONT_PUBLIC_MULTIBASE, STOREFRONT_KEY_HISTORY) and a freshly generated public PEM,
 * then prints the NEW environment block: the incoming key becomes current, the outgoing key is
 * appended to STOREFRONT_KEY_HISTORY.
 *
 * The private key never passes through this script — rotate-did.sh writes it to
 * scripts/service-private.pem for the operator to move into STOREFRONT_PRIVATE_KEY.
 */

const newPubPath = process.argv[2];
if (!newPubPath) {
  console.error("usage: npx tsx scripts/rotate-did.ts <path-to-new-service-public.pem>");
  process.exit(1);
}

const envDid = process.env.STOREFRONT_DID?.trim();
if (envDid && !envDid.startsWith("did:web:")) {
  console.error(
    `rotate-did: ignoring STOREFRONT_DID="${envDid}" — the storefront DID must be did:web. ` +
      "Using did:web:bazaar.whereditgo.diamonds; set STOREFRONT_DID to your own did:web host if different.",
  );
}
const DID_WEB = envDid?.startsWith("did:web:")
  ? envDid
  : "did:web:bazaar.whereditgo.diamonds";

const oldKid = process.env.STOREFRONT_KID?.trim();
const oldMultibase = process.env.STOREFRONT_PUBLIC_MULTIBASE?.trim();
if (!oldKid || !oldMultibase) {
  console.error(
    "rotate-did: STOREFRONT_KID and STOREFRONT_PUBLIC_MULTIBASE must be set to the current key.\n" +
      "If STOREFRONT_PUBLIC_MULTIBASE is unset, derive it once from your current public key:\n" +
      "  npx tsx scripts/gen-pub-key.ts <path-to-current-service-public.pem>",
  );
  process.exit(1);
}

type HistoryEntry = {
  id: string;
  type: "Multikey";
  publicKeyMultibase: string;
  supersededBy: string;
  revoked?: boolean;
};

function parseHistory(raw: string | undefined): HistoryEntry[] {
  const t = raw?.trim();
  if (!t || t.includes("PLACEHOLDER")) return [];
  const json = t.startsWith("[") ? t : Buffer.from(t, "base64").toString("utf8");
  const arr = JSON.parse(json);
  if (!Array.isArray(arr)) throw new Error("STOREFRONT_KEY_HISTORY is not a JSON array");
  return arr as HistoryEntry[];
}

const fragment = (v: string) => (v.includes("#") ? v.slice(v.indexOf("#") + 1) : v);
const didUrl = (v: string) => (v.includes("#") ? v : `${DID_WEB}#${v}`);

const newPub = readFileSync(newPubPath);
const newMultibase = publicPemToMultibase(newPub);

const today = new Date().toISOString().slice(0, 10);
let newKid = `storefront-key-${today}`;
const history = parseHistory(process.env.STOREFRONT_KEY_HISTORY);
const taken = new Set([oldKid, ...history.map((h) => fragment(h.id))]);
if (taken.has(newKid)) {
  let n = 2;
  while (taken.has(`storefront-key-${today}-${n}`)) n++;
  newKid = `storefront-key-${today}-${n}`;
}

const outgoing: HistoryEntry = {
  id: didUrl(oldKid),
  type: "Multikey",
  publicKeyMultibase: oldMultibase,
  supersededBy: `${DID_WEB}#${newKid}`,
};

const newHistory = [...history, outgoing];
const newHistoryB64 = Buffer.from(JSON.stringify(newHistory)).toString("base64");

const divider = "─".repeat(50);
console.log(`
Storefront key rotation — new environment block
${divider}

Move scripts/service-private.pem into STOREFRONT_PRIVATE_KEY, then set:

  STOREFRONT_DID=${DID_WEB}
  STOREFRONT_KID=${newKid}
  STOREFRONT_PUBLIC_MULTIBASE=${newMultibase}
  STOREFRONT_KEY_HISTORY=${newHistoryB64}

Outgoing key ${oldKid} moves into keyHistory (retired, still trusted for records it
signed). To HARD-REVOKE a key instead, add "revoked": true to its keyHistory entry.

Decoded STOREFRONT_KEY_HISTORY:
${JSON.stringify(newHistory, null, 2)}

After deploy, run the pre-flight checks in the storefront key handbook.
`);
