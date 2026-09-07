import { readFileSync } from "node:fs";
import { publicPemToDidKey, publicPemToMultibase } from "./pem-did";

const pemPath = process.argv[2];
if (!pemPath) {
  console.error(
    "usage: npx tsx scripts/gen-did.ts <pem-file>\n" +
      "  Accepts a public OR private P-256 PEM, including a file holding the raw\n" +
      "  one-line STOREFRONT_PRIVATE_KEY value (it is reflowed before parsing).",
  );
  process.exit(1);
}

const DID_WEB = "did:web:bazaar.whereditgo.diamonds";
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

Deploy-time injection (packages/server/config/did-document.template.json):
  The server replaces __STOREFRONT_KID__ and __PUBLIC_KEY_MULTIBASE__ at startup from env.

Environment variables (Fly secrets / .env):
  STOREFRONT_PRIVATE_KEY=<contents of scripts/service-private.pem, PEM with \\n escapes for one line>
  STOREFRONT_KID=${storefrontKid}
  STOREFRONT_PUBLIC_MULTIBASE=${multibase}
  STOREFRONT_DID=${DID_WEB}

If STOREFRONT_PUBLIC_MULTIBASE is unset, the server derives multibase from STOREFRONT_PRIVATE_KEY when possible.
`);
