"use server";

import { mutate } from "@/lib/mutations";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, currentSessionId, hashPassword, MIN_PASSWORD, requireStaff, requireUser, STAFF_ROLES } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";
import type { StaffRole } from "@/db/schema";

const ROLES = STAFF_ROLES;

export async function createStaff(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageStaff);
    const name = str(fd.get("name"));
    const username = str(fd.get("username"))?.toLowerCase();
    const role = String(fd.get("role")) as StaffRole;
    const password = String(fd.get("password") ?? "");
    if (!name || !username) return { error: "Name and username are required." };
    if (!/^[a-z0-9._-]{3,}$/.test(username)) return { error: "Username: at least 3 letters or numbers, no spaces." };
    if (!ROLES.includes(role)) return { error: "Pick a role." };
    if (password.length < MIN_PASSWORD) return { error: `Password must be at least ${MIN_PASSWORD} characters.` };
    const db = await getDb();
    if (await db.query.staff.findFirst({ where: eq(schema.staff.username, username) }))
      return { error: `Username ${username} is taken.` };
    const [created] = await db
      .insert(schema.staff)
      .values({ name, username, role, passwordHash: await hashPassword(password) })
      .returning();
    await audit(user.id, "create", "staff", created.id, { username, role });
    revalidatePath("/staff");
    return { ok: `${name} can now sign in as ${username}.` };
  });
}

export async function updateStaff(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageStaff);
    const role = String(fd.get("role")) as StaffRole;
    const active = fd.get("active") === "on";
    const password = String(fd.get("password") ?? "");
    if (!ROLES.includes(role)) return { error: "Pick a role." };
    if (password && password.length < MIN_PASSWORD) return { error: `Password must be at least ${MIN_PASSWORD} characters.` };
    const db = await getDb();
    const target = await db.query.staff.findFirst({ where: eq(schema.staff.id, id) });
    if (!target || !STAFF_ROLES.includes(target.role)) return { error: "Staff account not found." };
    if (id === user.id && (!active || role !== "admin")) {
      return { error: "You can't remove your own admin access." };
    }
    if (role !== "admin" || !active) {
      const otherAdmins = await db.query.staff.findFirst({
        where: and(eq(schema.staff.role, "admin"), eq(schema.staff.active, true), ne(schema.staff.id, id)),
      });
      if (!otherAdmins) return { error: "There must be at least one active admin." };
    }
    await db
      .update(schema.staff)
      .set({ role, active, ...(password ? { passwordHash: await hashPassword(password) } : {}) })
      .where(eq(schema.staff.id, id));
    if (!active || password) await db.delete(schema.sessions).where(eq(schema.sessions.staffId, id));
    await audit(user.id, "update", "staff", id, { role, active, passwordReset: !!password });
    revalidatePath("/staff");
    return { ok: "Saved." };
  });
}

// Used by staff and tenants alike.
export async function changeOwnPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireUser();
    const current = String(fd.get("current") ?? "");
    const next = String(fd.get("next") ?? "");
    if (!(await bcrypt.compare(current, user.passwordHash))) return { error: "Current password is wrong." };
    if (next.length < MIN_PASSWORD) return { error: `New password must be at least ${MIN_PASSWORD} characters.` };
    if (next !== String(fd.get("confirm") ?? "")) return { error: "The new passwords don't match." };
    const db = await getDb();
    await db.update(schema.staff).set({ passwordHash: await hashPassword(next) }).where(eq(schema.staff.id, user.id));
    const keep = await currentSessionId();
    await db.delete(schema.sessions).where(and(eq(schema.sessions.staffId, user.id), keep ? ne(schema.sessions.id, keep) : undefined));
    await audit(user.id, "change_password", "staff", user.id);
    return { ok: "Password changed." };
  });
}
