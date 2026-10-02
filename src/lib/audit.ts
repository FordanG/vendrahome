import "server-only";
import { getDb, schema } from "@/db";

export async function audit(
  staffId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  detail?: Record<string, unknown>,
) {
  const db = await getDb();
  await db.insert(schema.auditLog).values({ staffId, action, entity, entityId, detail });
}
