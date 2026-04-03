import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { createApiRouter } from "./api";
import { createDb } from "./db";

function corsAllowedOrigins(): string[] {
  const fromEnv = process.env.CORS_ALLOWED_ORIGINS;
  if (fromEnv?.trim()) {
    return fromEnv.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const app = process.env.APP_URL?.replace(/\/$/, "");
  const defaults = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
  return app && !defaults.includes(app) ? [...defaults, app] : defaults;
}

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

const api = createApiRouter(db);
const app = new Hono();

const allowedOrigins = corsAllowedOrigins();
app.use(
  "/api/*",
  cors({
    origin: (origin) => (origin && allowedOrigins.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Cookie"],
    credentials: true,
  }),
);

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
    if (await file.exists()) return c.html(file);
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
