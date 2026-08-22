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
 * DELIBERATELY DEPENDENCY-FREE: production's Docker image ships only
 * dist/ (a single bundled file, deps already inlined), config/, drizzle/,
 * and static/ -- no packages/server/src tree, no node_modules. This
 * script can't import from "../src/*" or any @atproto/* package the way
 * the app itself does; it only uses bun:sqlite (built into the Bun
 * runtime, not an npm package) and the global fetch(). That also means
 * it doesn't need to live inside the packages/server tree to run --
 * it's a single file you can copy anywhere bun is available and point at
 * the database.
 *
 * IMPORTANT: only run this after the `licenses` table migration
 * (0007_licenses.sql) has been deployed -- the table doesn't exist on
 * production until this branch ships.
 *
 * Usage:
 *   DATABASE_PATH=/path/to/app.db bun run backfill-license.ts <at-uri>
 *
 * (DATABASE_PATH defaults to ./data/app.db if unset, matching the app's
 * own default; on the production container it's /data/app.db.)
 *
 * Example:
 *   bun run backfill-license.ts \
 *     at://did:plc:t44345nyd7jmxfs5hxs4doch/diamonds.whereditgo.bazaar.license.terms/3mishw2b4pr2e
 *
 * Safe to re-run -- inserts are "on conflict do nothing" on the cid
 * primary key.
 */
import { Database } from "bun:sqlite";

const LICENSE_TERMS_COLLECTION = "diamonds.whereditgo.bazaar.license.terms";

function parseAtUri(uri: string): {
  did: string;
  collection: string;
  rkey: string;
} {
  const m = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!m) throw new Error(`Not a valid at:// record URI: ${uri}`);
  const [, did, collection, rkey] = m;
  return { did, collection, rkey };
}

type DidDoc = {
  service?: Array<{ id: string; type: string; serviceEndpoint: string }>;
};

async function resolvePds(did: string): Promise<string> {
  let doc: DidDoc;
  if (did.startsWith("did:plc:")) {
    const res = await fetch(`https://plc.directory/${did}`);
    if (!res.ok) {
      throw new Error(`plc.directory lookup failed for ${did}: ${res.status}`);
    }
    doc = (await res.json()) as DidDoc;
  } else if (did.startsWith("did:web:")) {
    const domain = did.slice("did:web:".length).replace(/%3[Aa]/g, ":");
    const res = await fetch(`https://${domain}/.well-known/did.json`);
    if (!res.ok) {
      throw new Error(`did:web lookup failed for ${did}: ${res.status}`);
    }
    doc = (await res.json()) as DidDoc;
  } else {
    throw new Error(`Unsupported DID method: ${did}`);
  }
  const svc = doc.service?.find(
    (s) => s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer",
  );
  if (!svc?.serviceEndpoint) {
    throw new Error(`No atproto_pds service found in DID document for ${did}`);
  }
  return svc.serviceEndpoint;
}

async function main() {
  const atUriArg = process.argv[2];
  if (!atUriArg) {
    console.error("Usage: bun run backfill-license.ts <at-uri>");
    process.exit(1);
  }

  const { did, collection, rkey } = parseAtUri(atUriArg);
  if (collection !== LICENSE_TERMS_COLLECTION) {
    throw new Error(
      `Expected a ${LICENSE_TERMS_COLLECTION} URI, got collection "${collection}"`,
    );
  }

  console.log(`Resolving PDS for ${did}...`);
  const pds = await resolvePds(did);
  console.log(`PDS: ${pds}`);

  const recordUrl = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;
  const res = await fetch(recordUrl);
  if (!res.ok) {
    throw new Error(`getRecord failed: ${res.status} ${await res.text()}`);
  }
  const record = (await res.json()) as {
    uri: string;
    cid: string;
    value: Record<string, unknown>;
  };

  const { value } = record;
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
  const db = new Database(databasePath);
  try {
    db.query(
      `INSERT INTO licenses
         (cid, uri, merchant_did, title, version, license_text, checkout_consent_required, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cid) DO NOTHING`,
    ).run(
      record.cid,
      record.uri,
      did,
      title,
      version,
      licenseText,
      checkoutConsentRequired ? 1 : 0,
      Math.floor(Date.now() / 1000), // drizzle's bun-sqlite timestamp mode stores unix seconds
    );
  } finally {
    db.close();
  }

  console.log(`Done. Captured ${record.uri} (${record.cid}) as raw content.`);
  console.log(`Inspect at: /license/${record.cid}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
