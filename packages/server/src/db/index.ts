import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

export function createDb(databasePath: string) {
  const sqlite = new Database(databasePath, { create: true });
  sqlite.run("PRAGMA journal_mode = WAL;");
  sqlite.run("PRAGMA foreign_keys = ON;");
  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof createDb>;
