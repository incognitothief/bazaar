import { readFileSync } from "node:fs";
import { publicPemToDidKey, publicPemToMultibase } from "./pem-did";

const pemPath = process.argv[2];
if (!pemPath) {
  console.error("usage: npx tsx scripts/gen-did.ts <path-to-service-public.pem>");
  process.exit(1);
}

const DID_WEB = "did:web:bazaar.whereditgo.diamonds";
const pem = readFileSync(pemPath);
const multibase = publicPemToMultibase(pem);
const didKey = publicPemToDidKey(pem);
const kidDate = new Date().toISOString().slice(0, 10);
const appServiceKid = `app-key-${kidDate}`;
const vmId = `${DID_WEB}#${appServiceKid}`;

const verificationMethodEntry = {
  id: vmId,
  type: "Multikey",
  controller: DID_WEB,
  publicKeyMultibase: multibase,
};

const divider = "─".repeat(50);

console.log(`
Bazaar app service keypair (operator handoff)
${divider}

did:key (reference only; receipts use APP_DID / did:web):
  ${didKey}

Public key (multibase, for did-document.json):
  ${multibase}

Suggested APP_SERVICE_KID (must match verificationMethod fragment):
  ${appServiceKid}

Reference verificationMethod entry (append-only on rotation; production uses env injection — see below):
${JSON.stringify(verificationMethodEntry, null, 2)}

If this is your first key, set assertionMethod to:
  ${JSON.stringify([vmId])}

Deploy-time injection (packages/server/config/did-document.template.json):
  The server replaces __APP_SERVICE_KID__ and __PUBLIC_KEY_MULTIBASE__ at startup from env.

Environment variables (Fly secrets / .env):
  APP_SERVICE_PRIVATE_KEY=<contents of scripts/service-private.pem, PEM with \\n escapes for one line>
  APP_SERVICE_KID=${appServiceKid}
  APP_SERVICE_PUBLIC_MULTIBASE=${multibase}
  APP_DID=${DID_WEB}

If APP_SERVICE_PUBLIC_MULTIBASE is unset, the server derives multibase from APP_SERVICE_PRIVATE_KEY when possible.
`);
