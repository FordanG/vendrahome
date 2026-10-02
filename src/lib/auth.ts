import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Staff, StaffRole } from "@/db/schema";

export const SESSION_COOKIE = "hotel_session";
const SESSION_DAYS = 14;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function signIn(username: string, password: string): Promise<boolean> {
  const db = await getDb();
  const user = await db.query.staff.findFirst({
    where: eq(schema.staff.username, username.trim().toLowerCase()),
  });
  if (!user || !user.active) return false;
  if (!(await bcrypt.compare(password, user.passwordHash))) return false;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({ id: hashToken(token), staffId: user.id, expiresAt });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return true;
}

export async function signOut() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

export const getCurrentStaff = cache(async (): Promise<Staff | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ staff: schema.staff })
    .from(schema.sessions)
    .innerJoin(schema.staff, eq(schema.sessions.staffId, schema.staff.id))
    .where(and(eq(schema.sessions.id, hashToken(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  if (!row || !row.staff.active) return null;
  return row.staff;
});

/** Roles that work at the hotel. Tenants are left out on purpose. */
export const STAFF_ROLES: StaffRole[] = ["admin", "front_desk", "maintenance"];

/** Any signed-in account, staff or tenant. */
export async function requireUser(): Promise<Staff> {
  const user = await getCurrentStaff();
  if (!user) redirect("/login");
  return user;
}

/**
 * Use in staff pages and server actions. With no roles given, any staff role passes.
 * A page someone isn't allowed to use behaves as if it doesn't exist (404), so
 * nobody learns what's behind it. Tenants are taken to their own home page instead.
 */
export async function requireStaff(roles: StaffRole[] = STAFF_ROLES): Promise<Staff> {
  const user = await requireUser();
  if (user.role === "tenant") redirect("/me");
  if (!roles.includes(user.role)) notFound();
  return user;
}

/** Where each account starts: tenants on their own page, staff on the room board. */
export const homeFor = (user: Pick<Staff, "role">) => (user.role === "tenant" ? "/me" : "/");

/** Use in tenant pages and actions. Returns the login and the occupant it belongs to. */
export const requireTenant = cache(async () => {
  const user = await requireUser();
  // Staff don't see tenant pages either: to them the address doesn't exist.
  if (user.role !== "tenant" || !user.occupantId) notFound();
  const db = await getDb();
  const occupant = await db.query.occupants.findFirst({ where: eq(schema.occupants.id, user.occupantId) });
  if (!occupant) redirect("/login");
  return { user, occupant };
});

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const MIN_PASSWORD = 8;

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Admin",
  front_desk: "Front desk & housekeeping",
  maintenance: "Maintenance",
  tenant: "Tenant",
};

// Who can do what. Pages and actions check these lists.
export const CAN = {
  manageContracts: ["admin"] as StaffRole[],
  manageRooms: ["admin"] as StaffRole[],
  manageStaff: ["admin"] as StaffRole[],
  manageOccupants: ["admin", "front_desk"] as StaffRole[],
  viewOccupantIds: ["admin", "front_desk"] as StaffRole[],
  viewClients: ["admin", "front_desk"] as StaffRole[],
  manageTenantLogins: ["admin", "front_desk"] as StaffRole[],
  handleRequests: ["admin", "front_desk", "maintenance"] as StaffRole[],
  manageVisits: ["admin", "front_desk", "maintenance"] as StaffRole[],
  manageSchedules: ["admin", "front_desk"] as StaffRole[],
  manageHouseRules: ["admin"] as StaffRole[],
};
