import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createDb } from "./db";

const databasePath = process.env.DATABASE_PATH ?? "./data/app.db";
mkdirSync(dirname(databasePath), { recursive: true });

const db = createDb(databasePath);
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
