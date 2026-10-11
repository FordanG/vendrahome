"use server";

import { mutate } from "@/lib/mutations";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, currentSessionId, hashPassword, MIN_PASSWORD, requireStaff, requireUser, STAFF_ROLES } from "@/lib/auth";
import { isOwner } from "@/lib/hotel";
import { audit } from "@/lib/audit";
import { str } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";
import type { Staff, StaffRole } from "@/db/schema";

const ROLES = STAFF_ROLES;

/**
 * Which hotel a login works at. Only the owner may leave it blank ("every hotel"),
 * and only for an admin, who then becomes another owner. A hotel's own admin can
 * only add and change staff at their hotel.
 */
async function readHotel(user: Staff, role: StaffRole, fd: FormData): Promise<{ error: string } | { propertyId: string | null }> {
  if (!isOwner(user)) return { propertyId: user.propertyId };
  const id = str(fd.get("propertyId"));
  if (!id) return role === "admin" ? { propertyId: null } : { error: "Pick the hotel they work at." };
  const db = await getDb();
  if (!(await db.query.properties.findFirst({ where: eq(schema.properties.id, id) }))) return { error: "Pick the hotel they work at." };
  return { propertyId: id };
}

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
    const hotel = await readHotel(user, role, fd);
    if ("error" in hotel) return hotel;
    const db = await getDb();
    if (await db.query.staff.findFirst({ where: eq(schema.staff.username, username) }))
      return { error: `Username ${username} is taken.` };
    const [created] = await db
      .insert(schema.staff)
      .values({ name, username, role, propertyId: hotel.propertyId, passwordHash: await hashPassword(password) })
      .returning();
    await audit(user.id, "create", "staff", created.id, { username, role, propertyId: hotel.propertyId });
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
    if (!isOwner(user) && target.propertyId !== user.propertyId) return { error: "Staff account not found." };
    const hotel = await readHotel(user, role, fd);
    if ("error" in hotel) return hotel;
    if (id === user.id && (!active || role !== "admin" || hotel.propertyId !== user.propertyId)) {
      return { error: "You can't remove your own admin access." };
    }
    // Someone must always be able to see every hotel.
    const staysOwner = role === "admin" && active && hotel.propertyId === null;
    if (isOwner(target) && !staysOwner) {
      const otherOwners = await db.query.staff.findFirst({
        where: and(eq(schema.staff.role, "admin"), eq(schema.staff.active, true), isNull(schema.staff.propertyId), ne(schema.staff.id, id)),
      });
      if (!otherOwners) return { error: "There must be at least one active admin who sees every hotel." };
    }
    await db
      .update(schema.staff)
      .set({ role, active, propertyId: hotel.propertyId, ...(password ? { passwordHash: await hashPassword(password) } : {}) })
      .where(eq(schema.staff.id, id));
    if (!active || password) await db.delete(schema.sessions).where(eq(schema.sessions.staffId, id));
    await audit(user.id, "update", "staff", id, { role, active, propertyId: hotel.propertyId, passwordReset: !!password });
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
