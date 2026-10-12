import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { connect, usesHostedDb, type DB } from "./connect";
import * as schema from "./schema";

type Store = Pick<DB, "query" | "select" | "insert" | "update" | "delete" | "execute">;
const transactionStore = new AsyncLocalStorage<Store>();

const globalForDb = globalThis as unknown as { dbPromise?: Promise<DB> };

// The local database migrates itself on start. A hosted one is migrated once per deploy
// with `pnpm db:migrate`, so many app instances never race to migrate it.
async function open(): Promise<DB> {
  return (await connect({ migrate: !usesHostedDb() })).db;
}

function rootDb(): Promise<DB> {
  globalForDb.dbPromise ??= open();
  return globalForDb.dbPromise;
}

export async function getDb(): Promise<Store> {
  return transactionStore.getStore() ?? rootDb();
}

/** All business checks, writes and audit events use the same transaction.
 * A small property's mutations are serialized to prevent check-then-write races.
 * PostgreSQL table locks also protect this invariant if the app gains processes.
 */
export async function withTransaction<T>(work: () => Promise<T>): Promise<T> {
  if (transactionStore.getStore()) return work();
  const db = await rootDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE rooms, occupants, room_assignments, contracts,
      contract_rooms, rent_steps, tenant_requests, maintenance_visits, staff, sessions,
      charges, payments, statements, deposit_entries, utility_bills, room_items, inventory_checks
      IN SHARE ROW EXCLUSIVE MODE`);
    return transactionStore.run(tx, work);
  });
}

export { schema };
