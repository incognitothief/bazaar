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
 * MERCHANT DID COMES FROM THE ENVIRONMENT, NEVER FROM AN ARGUMENT.
 * Every other authenticated route in this app (merchantGuard in
 * merchant.ts) determines "who is the merchant on this deployment" from
 * process.env.ARTIST_DID -- this script does the same, and refuses to
 * run if it's unset. If you pass a full at:// URI whose DID doesn't
 * match ARTIST_DID, the script aborts loudly instead of writing a row
 * under the wrong merchant. This isn't a hypothetical: an earlier
 * version took a bare DID as a copy-pasted argument, and running an
 * example command copied from one environment (with that environment's
 * DID baked into it) against a *different* environment (staging vs.
 * production) silently captured a row under the wrong merchant_did --
 * mechanically "successful," semantically wrong. Reading ARTIST_DID from
 * the environment the script is actually running in makes that class of
 * mistake structurally impossible instead of relying on the operator to
 * notice.
 *
 * DELIBERATELY DEPENDENCY-FREE: production's Docker image ships only
 * dist/ (a single bundled file, deps already inlined), config/, drizzle/,
 * and static/ -- no packages/server/src tree, no node_modules. This
 * script only uses bun:sqlite (built into the Bun runtime, not an npm
 * package) and the global fetch(). It doesn't need to live inside the
 * packages/server tree to run -- it's a single portable file.
 *
 * IMPORTANT: only run this after the `licenses` table migration
 * (0007_licenses.sql) has been deployed -- the table doesn't exist until
 * then.
 *
 * Usage (rkey only -- the normal case, DID always comes from ARTIST_DID):
 *   bun run backfill-license.ts <rkey>
 *
 * Usage (full at:// URI -- also accepted, but its DID must match
 * ARTIST_DID or the script refuses to proceed):
 *   bun run backfill-license.ts <at-uri>
 *
 * DATABASE_PATH defaults to ./data/app.db if unset, matching the app's
 * own default; on the production/staging container it's /data/app.db,
 * already set in that environment.
 *
 * Example:
 *   bun run backfill-license.ts 3mishw2b4pr2e
 *
 * Safe to re-run -- inserts are "on conflict do nothing" on the cid
 * primary key.
 */
import { Database } from "bun:sqlite";

const LICENSE_TERMS_COLLECTION = "diamonds.whereditgo.bazaar.license.terms";

function parseRkeyOrAtUri(
  arg: string,
  merchantDid: string,
): { did: string; collection: string; rkey: string } {
  if (!arg.startsWith("at://")) {
    // Bare rkey -- the merchant DID always comes from the environment.
    return { did: merchantDid, collection: LICENSE_TERMS_COLLECTION, rkey: arg };
  }
  const m = arg.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!m) throw new Error(`Not a valid at:// record URI: ${arg}`);
  const [, did, collection, rkey] = m;
  if (did !== merchantDid) {
    throw new Error(
      `Refusing to proceed: the URI's DID (${did}) does not match this ` +
        `deployment's ARTIST_DID (${merchantDid}). Running an example or ` +
        `copy-pasted URI from a different environment against this one ` +
        `would capture a row under the wrong merchant. If you actually ` +
        `mean to backfill a record on this deployment, pass just the ` +
        `rkey (${rkey}) instead of the full URI.`,
    );
  }
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
  const arg = process.argv[2];
  if (!arg) {
    console.error(
      "Usage: bun run backfill-license.ts <rkey>  (or a full at:// URI matching this deployment's ARTIST_DID)",
    );
    process.exit(1);
  }

  const merchantDid = process.env.ARTIST_DID?.trim();
  if (!merchantDid?.startsWith("did:")) {
    throw new Error(
      "ARTIST_DID is not set in this environment -- refusing to guess which merchant this is. " +
        "Same requirement as merchantGuard() in routes/merchant.ts.",
    );
  }
  console.log(`Merchant (from ARTIST_DID): ${merchantDid}`);

  const { did, collection, rkey } = parseRkeyOrAtUri(arg, merchantDid);

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
