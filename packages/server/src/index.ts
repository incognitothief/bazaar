import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { createApiRouter } from "./api";
import { createDb } from "./db";
import { createOAuthClient } from "./lib/atproto/oauth";
import {
  backfillPaymentFulfillmentFromMeta,
  sweepPaymentFulfillment,
} from "./lib/stripe/fulfillCheckoutSession";
import { getStripe } from "./lib/stripe/getStripe";
import { lexicons } from "@bazaar/shared";

const port = Number(process.env.PORT ?? 3000);
const databasePath = process.env.DATABASE_PATH ?? "./data/app.db";
const staticRoot =
  process.env.STATIC_ROOT ?? join(import.meta.dir, "../../client/dist");

mkdirSync(dirname(databasePath), { recursive: true });

const db = createDb(databasePath);

const migrationsFolder =
  process.env.MIGRATIONS_FOLDER ?? join(import.meta.dir, "../drizzle");

try {
  await migrate(db, { migrationsFolder });
} catch (e) {
  console.error("Migration failed:", e);
  process.exit(1);
}

const oauthClient = await createOAuthClient(db);

await backfillPaymentFulfillmentFromMeta(db);

const sweepMs = Number(process.env.BAZAAR_FULFILLMENT_SWEEP_MS ?? "45000");
if (sweepMs > 0) {
  setInterval(() => {
    void (async () => {
      if (!(await getStripe(db))) return;
      await sweepPaymentFulfillment(db, oauthClient).catch((err) =>
        console.warn("payment fulfillment sweep:", err),
      );
    })();
  }, sweepMs);
}

const api = createApiRouter(db, oauthClient);
const app = new Hono();

app.get("/xrpc/com.atproto.lexicon.get", (c) => {
  const id = c.req.query("lexicon");
  if (!id) return c.json({ error: "LexiconNotFound" }, 404);
  const lex = lexicons[id];
  if (!lex) return c.json({ error: "LexiconNotFound" }, 404);
  return c.json(lex);
});

app.route("/api", api);

if (existsSync(staticRoot)) {
  app.use("/*", serveStatic({ root: staticRoot }));
}

app.notFound(async (c) => {
  if (c.req.path.startsWith("/api")) {
    return c.json({ error: "not_found" }, 404);
  }
  if (existsSync(staticRoot)) {
    const file = Bun.file(join(staticRoot, "index.html"));
    if (await file.exists()) return c.html(await file.text());
  }
  if (c.req.path === "/") {
    return c.text(
      "API is running. Build the client (packages/client) or set STATIC_ROOT.",
    );
  }
  return c.text("Not found", 404);
});

Bun.serve({
  port,
  fetch: app.fetch,
});
console.log(`Listening on :${port}`);
