import { Lexicons } from "@atproto/lexicon";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../src/lexicons");
const files = readdirSync(root).filter((f) => f.endsWith(".json"));
const docs = files.map((f) => JSON.parse(readFileSync(join(root, f), "utf8")));
new Lexicons(docs);
console.log(`validate-lexicons: ok (${docs.length} docs)`);
