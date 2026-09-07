import { Hono } from "hono";
import { keyHistoryContextDocument } from "../lib/storefrontKeys";

/**
 * Hosted JSON-LD contexts for Bazaar DID vocabulary.
 * Canonical URL: https://bazaar.whereditgo.diamonds/ns/v1 (project-wide, every deployment serves it).
 */
export const ns = new Hono();

ns.get("/v1", (c) => {
  return c.json(keyHistoryContextDocument(), 200, {
    "Content-Type": "application/ld+json",
    "Cache-Control": "public, max-age=86400",
  });
});
