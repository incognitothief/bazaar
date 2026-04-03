import { readFileSync } from "node:fs";
import { publicPemToDidKey } from "./pem-did";

const pemPath = process.argv[2];
if (!pemPath) {
  console.error("usage: npx tsx scripts/gen-did.ts <path-to-service-public.pem>");
  process.exit(1);
}

const pem = readFileSync(pemPath);
console.log(publicPemToDidKey(pem));
