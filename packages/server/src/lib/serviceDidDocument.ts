import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServiceDidDocument, getMerchantKeys } from "./merchantKeys";

const here = dirname(fileURLToPath(import.meta.url));

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
 * `{ "@context", id }` skeleton the served DID document is built on. Operators edit the
 * template's `id` / base `@context` for a different `did:web` host; the key arrays and the
 * `keyHistory` `@context` term are assembled in code from the environment (see
 * `merchantKeys.ts` and `docs/adr/0013-key-rotation-and-did-document-v2.md`).
 */
function loadSkeleton(): { "@context": unknown[]; id: string } {
  for (const path of documentCandidates()) {
    if (!existsSync(path)) continue;
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const context = Array.isArray(raw["@context"])
      ? (raw["@context"] as unknown[])
      : [
          "https://www.w3.org/ns/did/v1",
          "https://w3id.org/security/multikey/v1",
        ];
    const id =
      typeof raw.id === "string" && raw.id
        ? raw.id
        : "did:web:bazaar.whereditgo.diamonds";
    return { "@context": context, id };
  }
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
    ],
    id: "did:web:bazaar.whereditgo.diamonds",
  };
}

/** Assemble the DID document served at `/.well-known/did.json` from env + the skeleton file. */
export function loadServiceDidDocument(): Record<string, unknown> {
  const keys = getMerchantKeys();
  if (!keys.current && process.env.NODE_ENV !== "test") {
    console.warn(
      "service DID: APP_MERCHANT_PRIVATE_KEY / APP_MERCHANT_KID unset — " +
        "/.well-known/did.json will have no verificationMethod / assertionMethod.",
    );
  }
  return buildServiceDidDocument(keys, loadSkeleton());
}
