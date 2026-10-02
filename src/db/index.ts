import "server-only";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

// Local development runs an embedded Postgres (PGlite) in this process.
// Moving to Supabase means swapping this file for a postgres-js client;
// the schema and queries stay the same.

type DB = PgliteDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { dbPromise?: Promise<DB> };

async function open(): Promise<DB> {
  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  mkdirSync(path.dirname(dataDir), { recursive: true });
  const client = await PGlite.create(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

export function getDb(): Promise<DB> {
  globalForDb.dbPromise ??= open();
  return globalForDb.dbPromise;
}

export { schema };
