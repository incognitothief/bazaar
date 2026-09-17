import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { Context } from "hono";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { createApiRouter } from "./api";
import { createDb } from "./db";
import { createOAuthClient } from "./lib/atproto/oauth";
import { checkStorefrontKeySync, reconcileStorefrontKeys } from "./lib/storefrontKeys";
import { injectSpaHead } from "./lib/spaHtmlMeta";
import {
  backfillPaymentFulfillmentFromMeta,
  sweepPaymentFulfillment,
} from "./lib/stripe/fulfillCheckoutSession";
import { getStripe } from "./lib/stripe/getStripe";
import { markInterruptedZipRebuildsFailed, waitForInFlightZipRebuilds } from "./lib/productZip";
import { lexicons } from "@bazaar/shared";
import { ns } from "./routes/ns";
import { wellKnown } from "./routes/wellKnown";

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

markInterruptedZipRebuildsFailed(db);

try {
  await reconcileStorefrontKeys(db);
} catch (e) {
  console.error(
    "Storefront key config invalid (STOREFRONT_KEY_HISTORY / STOREFRONT_*):",
    e,
  );
  process.exit(1);
}

// Best-effort: compare the merchant PDS's actor.storefrontKeys mirror against the current
// key history and stash the result for the merchant panel. Never blocks boot.
void checkStorefrontKeySync(db).catch((e) =>
  console.warn("storefront key sync check:", e),
);

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

/**
 * Safety net for any uncaught exception in any route -- without this, Hono's
 * own default just returns bare "Internal Server Error" text with no detail
 * client-side and nothing beyond Bun's own crash-dump in the server logs.
 * Logs the full error server-side (name/message/stack) and returns enough
 * of it to the client to diagnose without needing to go pull `fly logs`.
 */
app.onError((err, c) => {
  console.error(`[unhandled] ${c.req.method} ${c.req.path}:`, err);
  const name = err instanceof Error ? err.name : "Error";
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: "internal_error", name, message }, 500);
});

app.get("/xrpc/com.atproto.lexicon.get", (c) => {
  const id = c.req.query("lexicon");
  if (!id) return c.json({ error: "LexiconNotFound" }, 404);
  const lex = lexicons[id];
  if (!lex) return c.json({ error: "LexiconNotFound" }, 404);
  return c.json(lex);
});

app.route("/api", api);
app.route("/.well-known", wellKnown);
app.route("/ns", ns);

async function htmlWithMeta(
  c: Context,
  pathname: string,
): Promise<Response | null> {
  const indexPath = join(staticRoot, "index.html");
  const file = Bun.file(indexPath);
  if (!(await file.exists())) return null;
  let html = await file.text();
  html = await injectSpaHead(html, pathname, db);
  return c.html(html);
}

if (existsSync(staticRoot)) {
  app.get("/", async (c) => {
    const out = await htmlWithMeta(c, "/");
    return out ?? c.text("Not found", 404);
  });
}

if (existsSync(staticRoot)) {
  app.use("/*", serveStatic({ root: staticRoot }));
}

app.notFound(async (c) => {
  if (c.req.path.startsWith("/api")) {
    return c.json({ error: "not_found" }, 404);
  }
  if (
    existsSync(staticRoot) &&
    (c.req.method === "GET" || c.req.method === "HEAD")
  ) {
    const out = await htmlWithMeta(c, c.req.path);
    if (out) return out;
  }
  if (c.req.path === "/") {
    return c.text(
      "API is running. Build the client (packages/client) or set STATIC_ROOT.",
    );
  }
  return c.text("Not found", 404);
});

if (!process.env.STOREFRONT_KID?.trim() && process.env.NODE_ENV === "production") {
  console.warn(
    "[WARN] STOREFRONT_KID is not set. Signed records will not carry a kid field. " +
      "Key rotation verification will require exhaustive key search. " +
      "Set STOREFRONT_KID (storefront-key-YYYY-MM-DD) alongside STOREFRONT_PRIVATE_KEY.",
  );
}

Bun.serve({
  port,
  fetch: app.fetch,
});
console.log(`Listening on :${port}`);

/**
 * Product zip rebuilds now run in the background after their triggering
 * request already responded (see productZip.ts's rebuildProductZipCache*).
 * Fly's scale-to-zero (and a plain redeploy) only track HTTP connections,
 * not that in-process work. Zip rebuilds open a proxy-visible hold
 * (flyZipAutostopHold) so autostop should not fire during a package.
 * A deploy/stop still can; wait (bounded) before exiting.
 */
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, waiting for in-flight zip rebuilds before exit...`);
  await waitForInFlightZipRebuilds(25_000);
  console.log("shutdown: proceeding");
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
