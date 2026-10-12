import path from "node:path";
import { mkdirSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// One database, two homes:
// - DATABASE_URL set: a hosted Postgres (Supabase). Use the pooler's connection string.
// - Not set: an embedded Postgres (PGlite) in .data/pglite, for local use and tests.
// The schema, migrations and queries are the same for both.

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");

export function usesHostedDb() {
  return !!process.env.DATABASE_URL;
}

export function pgliteDir() {
  return process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
}

export async function connect(options: { migrate: boolean }): Promise<{ db: DB; close: () => Promise<void> }> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    // prepare: false because Supabase's transaction pooler can't keep prepared statements.
    const client = postgres(url, { prepare: false, max: Number(process.env.DATABASE_POOL_SIZE ?? 5), onnotice: () => {} });
    const db = drizzle(client, { schema });
    if (options.migrate) {
      const { migrate } = await import("drizzle-orm/postgres-js/migrator");
      await migrate(db, { migrationsFolder: MIGRATIONS });
      await lockOutDataApi(db);
    }
    return { db, close: () => client.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dataDir = pgliteDir();
  mkdirSync(path.dirname(dataDir), { recursive: true });
  const client = await PGlite.create(dataDir);
  const db = drizzle(client, { schema });
  if (options.migrate) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db, { migrationsFolder: MIGRATIONS });
  }
  return { db, close: () => client.close() };
}

/**
 * Supabase also serves every table in "public" through its web API, to anyone holding the
 * project's public key. The app never uses that API, so row level security is turned on
 * with no policies: the API sees nothing, while the app's own database login is unaffected.
 * Runs after every migration so new tables are covered too.
 */
async function lockOutDataApi(db: DB) {
  await db.execute(sql`
    DO $$
    DECLARE t record;
    BEGIN
      FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
      END LOOP;
    END $$;`);
}
