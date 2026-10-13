import path from "node:path";
import { mkdirSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// One database, two homes:
// - DATABASE_URL set: a hosted Postgres (Supabase). Use the transaction pooler's connection string (port 6543).
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
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    // Use Supabase's *transaction* pooler (port 6543): it shares a few database connections
    // among many app copies, which serverless hosting starts freely. (The session pooler gives
    // each app connection its own and refuses more than 15 at once.) The pg driver sends one
    // query at a time per connection, which this pooler needs. Idle connections close quickly
    // so short-lived app copies don't hold on to them.
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_SIZE ?? 3),
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 15_000,
    });
    const db = drizzle(pool, { schema });
    if (options.migrate) {
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      await migrate(db, { migrationsFolder: MIGRATIONS });
      await lockOutDataApi(db);
    }
    return { db, close: () => pool.end() };
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
 * with no policies and the API logins lose their table rights: the API sees nothing, while
 * the app's own database login is unaffected.
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
      -- Supabase's API logins (anon, authenticated) get no rights on app tables, now or later.
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
      END IF;
    END $$;`);
}
