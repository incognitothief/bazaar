import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db";
import { licenses } from "../db/schema";

/**
 * Public license inspector data — reads only from the local capture table,
 * never the PDS. A license's content must stay viewable even after the
 * merchant edits or retires the record it came from.
 */
export function createLicensesRouter(db: Db) {
  const r = new Hono();

  r.get("/:cid", async (c) => {
    const cid = c.req.param("cid");
    const row = await db
      .select()
      .from(licenses)
      .where(eq(licenses.cid, cid))
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({
      cid: row.cid,
      uri: row.uri,
      title: row.title,
      version: row.version,
      licenseText: row.licenseText,
      checkoutConsentRequired: row.checkoutConsentRequired,
      capturedAt: row.capturedAt,
    });
  });

  return r;
}
