import { Hono } from "hono";
import { loadServiceDidDocument } from "../lib/serviceDidDocument";

const didDocument = loadServiceDidDocument();

export const wellKnown = new Hono();

wellKnown.get("/did.json", (c) => {
  return c.body(JSON.stringify(didDocument), 200, {
    "Content-Type": "application/did+ld+json",
    "Cache-Control": "public, max-age=3600",
  });
});
