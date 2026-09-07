import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServiceDidDocument, getMerchantKeys } from "./merchantKeys";

const here = dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONTEXT = [
  "https://www.w3.org/ns/did/v1",
  "https://w3id.org/security/multikey/v1",
];

const DOC_NAMES = [
  "did-document.template.json",
  "did-document.json",
] as const;

/** Bundled app: `dist/index.js` → `../config`. Dev: `src/lib/*.ts` → `../../config`. */
function documentCandidates(): string[] {
  const rels = [
    ["..", "config"],
    ["..", "..", "config"],
  ] as const;
  const out: string[] = [];
  for (const rel of rels) {
    for (const name of DOC_NAMES) {
      out.push(join(here, ...rel, name));
    }
  }
  return out;
}

/**
 * Base `@context` for the served DID document. Read from `did-document.template.json` so an
 * operator can add context entries without a code change; the storefront DID id itself comes
 * from `APP_DID` (see `merchantDid()`), and the key arrays + the hosted `keyHistory` context URL
 * are assembled in code. See `docs/adr/0013-key-rotation-and-did-document-v2.md`.
 */
function loadContextBase(): unknown[] {
  for (const path of documentCandidates()) {
    if (!existsSync(path)) continue;
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    if (Array.isArray(raw["@context"])) return raw["@context"] as unknown[];
  }
  return DEFAULT_CONTEXT;
}

/** Assemble the DID document served at `/.well-known/did.json` from env + the context base. */
export function loadServiceDidDocument(): Record<string, unknown> {
  const keys = getMerchantKeys();
  if (!keys.current && process.env.NODE_ENV !== "test") {
    console.warn(
      "service DID: APP_MERCHANT_PRIVATE_KEY / APP_MERCHANT_KID unset — " +
        "/.well-known/did.json will have no verificationMethod / assertionMethod.",
    );
  }
  return buildServiceDidDocument(keys, loadContextBase());
}
