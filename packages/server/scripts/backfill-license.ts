/**
 * One-time backfill: captures a pre-reshape license.terms record's raw
 * content into the `licenses` table, so the public inspector can show it
 * even though it predates the write-time capture hook (which only fires
 * on new writes going forward).
 *
 * Stores the full record verbatim as `license_text` -- no reshaping into
 * the new licenseText-only form. That's deliberate: writing translation
 * logic to turn the old tier/rightsType/usageRestrictions shape into
 * prose was explicitly ruled out as not worth building for what should be
 * a handful of historical records at most. This is a faithful, unedited
 * copy of exactly what was on the PDS at capture time, not a rewrite.
 *
 * IMPORTANT: only run this after the `licenses` table migration
 * (0007_licenses.sql) has been deployed -- the table doesn't exist on
 * production until this branch ships.
 *
 * Usage (from packages/server, against the same DATABASE_PATH the running
 * app itself uses -- e.g. via `fly ssh console` on the production machine):
 *
 *   bun run scripts/backfill-license.ts <at-uri>
 *
 * Example:
 *
 *   bun run scripts/backfill-license.ts \
 *     at://did:plc:t44345nyd7jmxfs5hxs4doch/diamonds.whereditgo.bazaar.license.terms/3mishw2b4pr2e
 *
 * Safe to re-run -- inserts are onConflictDoNothing() on the cid primary key.
 */
import { Agent } from "@atproto/api";
import { AtUri } from "@atproto/syntax";
import { createDb } from "../src/db";
import { licenses } from "../src/db/schema";
import { resolvePdsForDid } from "../src/lib/atproto/resolvePds";

const LICENSE_TERMS_COLLECTION = "diamonds.whereditgo.bazaar.license.terms";

async function main() {
  const atUriArg = process.argv[2];
  if (!atUriArg) {
    console.error("Usage: bun run scripts/backfill-license.ts <at-uri>");
    process.exit(1);
  }

  const at = new AtUri(atUriArg);
  const did = at.hostname;
  const rkey = at.rkey;
  if (at.collection !== LICENSE_TERMS_COLLECTION) {
    throw new Error(
      `Expected a ${LICENSE_TERMS_COLLECTION} URI, got collection "${at.collection}"`,
    );
  }

  console.log(`Resolving PDS for ${did}...`);
  const pds = await resolvePdsForDid(did);
  if (!pds) throw new Error(`Could not resolve a PDS for ${did}`);
  console.log(`PDS: ${pds}`);

  const agent = new Agent({ service: pds });
  const res = await agent.com.atproto.repo.getRecord({
    repo: did,
    collection: LICENSE_TERMS_COLLECTION,
    rkey,
  });

  const value = res.data.value as Record<string, unknown>;
  const title = value.title;
  const version = value.version;
  const checkoutConsentRequired = value.checkoutConsentRequired;
  if (
    typeof title !== "string" ||
    typeof version !== "string" ||
    typeof checkoutConsentRequired !== "boolean"
  ) {
    throw new Error(
      "Record is missing title/version/checkoutConsentRequired -- doesn't look like a valid license.terms record",
    );
  }

  const licenseText = JSON.stringify(value, null, 2);

  const databasePath = process.env.DATABASE_PATH ?? "./data/app.db";
  console.log(`Writing to ${databasePath}...`);
  const db = createDb(databasePath);

  await db
    .insert(licenses)
    .values({
      cid: res.data.cid,
      uri: res.data.uri,
      merchantDid: did,
      title,
      version,
      licenseText,
      checkoutConsentRequired,
    })
    .onConflictDoNothing();

  console.log(`Done. Captured ${res.data.uri} (${res.data.cid}) as raw content.`);
  console.log(`Inspect at: /license/${res.data.cid}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
