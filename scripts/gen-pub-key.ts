import { readFileSync } from "node:fs";
import { publicPemToMultibase } from "./pem-did";

const pemPath = process.argv[2];
if (!pemPath) {
  console.error(
    "usage: npx tsx scripts/gen-pub-key.ts <pem-file>\n" +
      "  Accepts a public OR private P-256 PEM. A file holding the raw one-line\n" +
      "  STOREFRONT_PRIVATE_KEY value (spaces / \\n escapes) is fine — it is reflowed.",
  );
  process.exit(1);
}

const pem = readFileSync(pemPath);
console.log(publicPemToMultibase(pem));
