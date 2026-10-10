import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { StaffRole } from "@/db/schema";
import { hashPassword, MIN_PASSWORD } from "./auth";
import { str } from "./format";

/**
 * Creates a login from a form with name (unless given), username and password.
 * Shared by company team pages and the hotel's company page. Call inside mutate().
 */
export async function createLogin(
  fd: FormData,
  values: { role: StaffRole; clientId?: string | null; occupantId?: string | null; name?: string },
): Promise<{ error: string } | { login: typeof schema.staff.$inferSelect }> {
  const name = values.name ?? str(fd.get("name"));
  const username = str(fd.get("username"))?.toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!name) return { error: "Enter their name." };
  if (!username || !/^[a-z0-9._-]{3,}$/.test(username)) return { error: "Username: at least 3 letters or numbers, no spaces." };
  if (password.length < MIN_PASSWORD) return { error: `Password must be at least ${MIN_PASSWORD} characters.` };
  const db = await getDb();
  if (await db.query.staff.findFirst({ where: eq(schema.staff.username, username) })) return { error: `Username ${username} is taken.` };
  const [login] = await db
    .insert(schema.staff)
    .values({
      name,
      username,
      role: values.role,
      clientId: values.clientId ?? null,
      occupantId: values.occupantId ?? null,
      email: str(fd.get("email")),
      phone: str(fd.get("phone")),
      passwordHash: await hashPassword(password),
    })
    .returning();
  return { login };
}

/** Turns a login on or off and optionally sets a new password; signs it out when either changes. */
export async function updateLogin(id: string, fd: FormData, extra: { role?: StaffRole } = {}): Promise<{ error: string } | { active: boolean; passwordReset: boolean }> {
  const active = fd.get("active") === "on";
  const password = String(fd.get("password") ?? "");
  if (password && password.length < MIN_PASSWORD) return { error: `Password must be at least ${MIN_PASSWORD} characters.` };
  const db = await getDb();
  await db
    .update(schema.staff)
    .set({ active, ...extra, ...(password ? { passwordHash: await hashPassword(password) } : {}) })
    .where(eq(schema.staff.id, id));
  if (!active || password) await db.delete(schema.sessions).where(eq(schema.sessions.staffId, id));
  return { active, passwordReset: !!password };
}
