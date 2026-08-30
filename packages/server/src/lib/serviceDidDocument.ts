import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAppMerchantPrivateKey } from "./atproto/sign";
import { publicSpkiPemToMultibase } from "./publicKeyMultibase";

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

function resolvePublicMultibase(): string {
  const fromEnv = process.env.APP_MERCHANT_PUBLIC_MULTIBASE?.trim();
  if (fromEnv) return fromEnv;
  const raw = process.env.APP_MERCHANT_PRIVATE_KEY?.trim();
  if (!raw || raw.includes("PLACEHOLDER")) return "";
  try {
    const priv = createPrivateKey(normalizeAppMerchantPrivateKey(raw));
    const pub = createPublicKey(priv);
    const spkiPem = pub.export({ type: "spki", format: "pem" }) as string;
    return publicSpkiPemToMultibase(spkiPem);
  } catch {
    return "";
  }
}

/**
 * Load DID document: prefer `did-document.template.json` with deploy-time substitution
 * (`__APP_MERCHANT_KID__`, `__PUBLIC_KEY_MULTIBASE__`); fall back to static `did-document.json`.
 */
export function loadServiceDidDocument(): Record<string, unknown> {
  const kid = process.env.APP_MERCHANT_KID?.trim() ?? "";
  const multibase = resolvePublicMultibase();

  for (const path of documentCandidates()) {
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, "utf-8");
    if (path.endsWith("did-document.template.json")) {
      const filled = raw
        .replaceAll("__APP_MERCHANT_KID__", kid)
        .replaceAll("__PUBLIC_KEY_MULTIBASE__", multibase);
      if ((!kid || !multibase) && process.env.NODE_ENV !== "test") {
        console.warn(
          "service DID template: set APP_MERCHANT_KID and APP_MERCHANT_PUBLIC_MULTIBASE (or a valid APP_MERCHANT_PRIVATE_KEY to derive multibase); /.well-known/did.json may be incomplete.",
        );
      }
      return JSON.parse(filled) as Record<string, unknown>;
    }
    return JSON.parse(raw) as Record<string, unknown>;
  }

  throw new Error(
    `No DID document found (tried: ${documentCandidates().join(", ")})`,
  );
}
