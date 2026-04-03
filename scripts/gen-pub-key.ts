import { readFileSync } from "node:fs";
import { publicPemToMultibase } from "./pem-did";

const pemPath = process.argv[2];
if (!pemPath) {
  console.error("usage: npx tsx scripts/gen-pub-key.ts <path-to-service-public.pem>");
  process.exit(1);
}

const pem = readFileSync(pemPath);
console.log(publicPemToMultibase(pem));
