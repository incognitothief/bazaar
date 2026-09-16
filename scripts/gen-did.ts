import { readFileSync } from "node:fs";
import { publicPemToDidKey, publicPemToMultibase } from "./pem-did";

const pemPath = process.argv[2];
if (!pemPath) {
  console.error(
    "usage: npx tsx scripts/gen-did.ts <pem-file> [domain-or-did]\n" +
      "  Accepts a public OR private P-256 PEM, including a file holding the raw\n" +
      "  one-line STOREFRONT_PRIVATE_KEY value (it is reflowed before parsing).\n" +
      "  [domain-or-did] is your storefront host (store.example.com) or a full\n" +
      "  did:web: DID. Falls back to STOREFRONT_DID from the environment.",
  );
  process.exit(1);
}

const FALLBACK_DID = "did:web:bazaar.whereditgo.diamonds";

/**
 * The storefront DID must name the host that serves /.well-known/did.json --
 * that is what did:web resolution fetches. Taking it from an argument or the
 * environment keeps a fresh install from shipping someone else's identity.
 */
function resolveDidWeb(): string {
  const arg = process.argv[3]?.trim();
  if (arg) {
    if (arg.startsWith("did:web:")) return arg;
    if (arg.includes(":") || arg.includes("/")) {
      console.error(`gen-did: "${arg}" is not a bare host or a did:web: DID.`);
      process.exit(1);
    }
    return `did:web:${arg}`;
  }
  const envDid = process.env.STOREFRONT_DID?.trim();
  if (envDid?.startsWith("did:web:")) return envDid;
  if (envDid) {
    console.error(
      `gen-did: ignoring STOREFRONT_DID="${envDid}" — the storefront DID must be did:web.`,
    );
  }
  console.error(
    `gen-did: no domain given and STOREFRONT_DID is unset — using ${FALLBACK_DID}.\n` +
      "         This is the reference deployment, almost certainly NOT yours. Re-run as\n" +
      "         ./scripts/gen-did.sh <your-store-domain> unless you own that host.\n",
  );
  return FALLBACK_DID;
}

const DID_WEB = resolveDidWeb();
const pem = readFileSync(pemPath);
const multibase = publicPemToMultibase(pem);
const didKey = publicPemToDidKey(pem);
const kidDate = new Date().toISOString().slice(0, 10);
const storefrontKid = `storefront-key-${kidDate}`;
const vmId = `${DID_WEB}#${storefrontKid}`;

const verificationMethodEntry = {
  id: vmId,
  type: "Multikey",
  controller: DID_WEB,
  publicKeyMultibase: multibase,
};

const divider = "─".repeat(50);

console.log(`
Bazaar merchant (storefront) keypair (operator handoff)
${divider}

did:key (reference only; receipts use STOREFRONT_DID / did:web):
  ${didKey}

Public key (multibase, for did-document.template.json):
  ${multibase}

Suggested STOREFRONT_KID (must match verificationMethod fragment):
  ${storefrontKid}

Reference verificationMethod entry (append-only on rotation; production uses env injection — see below):
${JSON.stringify(verificationMethodEntry, null, 2)}

If this is your first key, set assertionMethod to:
  ${JSON.stringify([vmId])}

How the document gets served:
  You do not edit a template. The server builds /.well-known/did.json at runtime from the
  env vars below -- id from STOREFRONT_DID, the key entries from STOREFRONT_KID /
  STOREFRONT_PUBLIC_MULTIBASE / STOREFRONT_KEY_HISTORY. did-document.template.json supplies
  only the @context array, if you need to add entries to it.

Environment variables (Fly secrets / .env):
  STOREFRONT_PRIVATE_KEY=<contents of scripts/service-private.pem, PEM with \\n escapes for one line>
  STOREFRONT_KID=${storefrontKid}
  STOREFRONT_PUBLIC_MULTIBASE=${multibase}
  STOREFRONT_DID=${DID_WEB}

If STOREFRONT_PUBLIC_MULTIBASE is unset, the server derives multibase from STOREFRONT_PRIVATE_KEY when possible.
`);
