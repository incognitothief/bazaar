import { readFileSync } from "node:fs";
import { publicPemToMultibase } from "./pem-did";

/**
 * Storefront key rotation helper — see docs/adr/0013-key-rotation-and-did-document-v2.md §5.
 *
 * Reads the CURRENT key material from the environment (APP_MERCHANT_KID,
 * APP_MERCHANT_PUBLIC_MULTIBASE, APP_MERCHANT_KEY_HISTORY) and a freshly generated public PEM,
 * then prints the NEW environment block: the incoming key becomes current, the outgoing key is
 * appended to APP_MERCHANT_KEY_HISTORY.
 *
 * The private key never passes through this script — gen-did.sh / rotate-did.sh write it to
 * scripts/service-private.pem for the operator to move into APP_MERCHANT_PRIVATE_KEY.
 *
 *   ROTATE_KEEP_ACTIVE=1  keep the outgoing key in verificationMethod (status "active");
 *                         default is an immediate "retired".
 */

const newPubPath = process.argv[2];
if (!newPubPath) {
  console.error("usage: npx tsx scripts/rotate-did.ts <path-to-new-service-public.pem>");
  process.exit(1);
}

const envDid = process.env.APP_DID?.trim();
if (envDid && !envDid.startsWith("did:web:")) {
  console.error(
    `rotate-did: ignoring APP_DID="${envDid}" — the storefront DID must be did:web. ` +
      "Using did:web:bazaar.whereditgo.diamonds; set APP_DID to your own did:web host if different.",
  );
}
const DID_WEB = envDid?.startsWith("did:web:")
  ? envDid
  : "did:web:bazaar.whereditgo.diamonds";

const oldKid = process.env.APP_MERCHANT_KID?.trim();
const oldMultibase = process.env.APP_MERCHANT_PUBLIC_MULTIBASE?.trim();
if (!oldKid || !oldMultibase) {
  console.error(
    "rotate-did: APP_MERCHANT_KID and APP_MERCHANT_PUBLIC_MULTIBASE must be set to the current key.\n" +
      "If APP_MERCHANT_PUBLIC_MULTIBASE is unset, derive it once from your current private key:\n" +
      "  npx tsx scripts/gen-pub-key.ts <path-to-current-service-public.pem>",
  );
  process.exit(1);
}

type HistoryEntry = {
  kid: string;
  publicKeyMultibase: string;
  status: "active" | "retired" | "revoked";
  supersededBy: string;
  activatedAt?: string;
  retiredAt?: string;
  notes?: string;
};

function parseHistory(raw: string | undefined): HistoryEntry[] {
  const t = raw?.trim();
  if (!t || t.includes("PLACEHOLDER")) return [];
  const json = t.startsWith("[") ? t : Buffer.from(t, "base64").toString("utf8");
  const arr = JSON.parse(json);
  if (!Array.isArray(arr)) throw new Error("APP_MERCHANT_KEY_HISTORY is not a JSON array");
  return arr as HistoryEntry[];
}

const newPub = readFileSync(newPubPath);
const newMultibase = publicPemToMultibase(newPub);

const today = new Date().toISOString().slice(0, 10);
let newKid = `merchant-key-${today}`;
const history = parseHistory(process.env.APP_MERCHANT_KEY_HISTORY);
const taken = new Set([oldKid, ...history.map((h) => h.kid)]);
if (taken.has(newKid)) {
  let n = 2;
  while (taken.has(`merchant-key-${today}-${n}`)) n++;
  newKid = `merchant-key-${today}-${n}`;
}

const keepActive = process.env.ROTATE_KEEP_ACTIVE === "1";
const nowIso = new Date().toISOString();
const outgoing: HistoryEntry = {
  kid: oldKid,
  publicKeyMultibase: oldMultibase,
  status: keepActive ? "active" : "retired",
  supersededBy: newKid,
  ...(keepActive ? {} : { retiredAt: nowIso }),
};

const newHistory = [...history, outgoing];
const newHistoryB64 = Buffer.from(JSON.stringify(newHistory)).toString("base64");

const divider = "─".repeat(50);
console.log(`
Storefront key rotation — new environment block
${divider}

Move scripts/service-private.pem into APP_MERCHANT_PRIVATE_KEY, then set:

  APP_DID=${DID_WEB}
  APP_MERCHANT_KID=${newKid}
  APP_MERCHANT_PUBLIC_MULTIBASE=${newMultibase}
  APP_MERCHANT_KEY_HISTORY=${newHistoryB64}

Outgoing key ${oldKid} → status "${outgoing.status}"${
  keepActive
    ? " (still in verificationMethod; flip to \"retired\" later to drop it)"
    : ""
}.

Decoded APP_MERCHANT_KEY_HISTORY:
${JSON.stringify(newHistory, null, 2)}

After deploy, run the pre-flight checks in the storefront key handbook.
`);
