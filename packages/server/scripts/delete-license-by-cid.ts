/**
 * One-time cleanup: deletes a single row from the `licenses` table by CID.
 *
 * For fixing a bad backfill/capture -- e.g. a row written under the wrong
 * merchant_did from an earlier mistake. Dependency-free for the same
 * reason as backfill-license.ts -- production/staging containers have no
 * packages/server/src tree or node_modules, only bun:sqlite (built into
 * the Bun runtime).
 *
 * Usage:
 *   bun run delete-license-by-cid.ts <cid>
 *
 * DATABASE_PATH defaults to ./data/app.db if unset; on production/staging
 * it's /data/app.db, already set in that environment.
 */
import { Database } from "bun:sqlite";

async function main() {
  const cid = process.argv[2];
  if (!cid) {
    console.error("Usage: bun run delete-license-by-cid.ts <cid>");
    process.exit(1);
  }

  const databasePath = process.env.DATABASE_PATH ?? "./data/app.db";
  console.log(`Opening ${databasePath}...`);
  const db = new Database(databasePath);
  try {
    const before = db
      .query("SELECT cid, uri, merchant_did, title FROM licenses WHERE cid = ?")
      .get(cid);
    if (!before) {
      console.log(`No row found for cid ${cid} -- nothing to delete.`);
      return;
    }
    console.log("Found:", before);
    db.query("DELETE FROM licenses WHERE cid = ?").run(cid);
    console.log(`Deleted ${cid}.`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
