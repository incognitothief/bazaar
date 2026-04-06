import { Hono } from "hono";
import { presignInventoryArtworkGet } from "../lib/inventoryArtworkPresign";

/**
 * Presigned GET for cover art on R2. Public if the object exists (catalog item URI is public on ATProto).
 */
export function createInventoryPublicRouter() {
  const r = new Hono();

  r.get("/artwork-url", async (c) => {
    const itemUri = c.req.query("itemUri")?.trim();
    if (!itemUri) return c.json({ error: "itemUri_required" }, 400);

    const result = await presignInventoryArtworkGet(itemUri);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json({
      url: result.url,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  /** Stable URL for og:image — redirects to a fresh presigned R2 GET. */
  r.get("/artwork-open", async (c) => {
    const itemUri = c.req.query("itemUri")?.trim();
    if (!itemUri) return c.json({ error: "itemUri_required" }, 400);

    const result = await presignInventoryArtworkGet(itemUri);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    c.header("Cache-Control", "private, max-age=300");
    return c.redirect(result.url, 302);
  });

  return r;
}
