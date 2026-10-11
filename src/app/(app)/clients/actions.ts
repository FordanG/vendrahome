"use server";

import { mutate } from "@/lib/mutations";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, COMPANY_ROLES, requireStaff } from "@/lib/auth";
import { isOwner } from "@/lib/hotel";
import { AGREEMENT_FIELDS } from "@/lib/company";
import { createLogin, updateLogin } from "@/lib/logins";
import type { StaffRole } from "@/db/schema";
import { audit } from "@/lib/audit";
import { str } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";

function readClient(fd: FormData) {
  return {
    name: str(fd.get("name")),
    tin: str(fd.get("tin")),
    address: str(fd.get("address")),
    contactName: str(fd.get("contactName")),
    contactPhone: str(fd.get("contactPhone")),
    contactEmail: str(fd.get("contactEmail")),
    notes: str(fd.get("notes")),
  };
}

export async function createClient(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageContracts);
    const values = readClient(fd);
    if (!values.name) return { error: "Company name is required." };
    const db = await getDb();
    const [client] = await db.insert(schema.clients).values({ ...values, name: values.name }).returning();
    await audit(user.id, "create", "client", client.id, { name: client.name });
    revalidatePath("/clients");
    return { redirectTo: `/clients/${client.id}` };
  });
}

export async function updateClient(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageContracts);
    const values = readClient(fd);
    if (!values.name) return { error: "Company name is required." };
    const db = await getDb();
    await db.update(schema.clients).set({ ...values, name: values.name }).where(eq(schema.clients.id, id));
    await audit(user.id, "update", "client", id, values);
    revalidatePath(`/clients/${id}`);
    return { ok: "Saved." };
  });
}

/** What this company's own logins may do: the agreement made with them. */
export async function saveAgreement(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageCompanyAccounts);
    if (!isOwner(user)) return { error: "Only the owner manages company accounts, since they cover every hotel." };
    const values = Object.fromEntries(AGREEMENT_FIELDS.map((f) => [f.key, fd.get(f.key) === "on"])) as Record<(typeof AGREEMENT_FIELDS)[number]["key"], boolean>;
    const db = await getDb();
    const [updated] = await db.update(schema.clients).set(values).where(eq(schema.clients.id, clientId)).returning({ id: schema.clients.id });
    if (!updated) return { error: "Company not found." };
    await audit(user.id, "update", "client_agreement", clientId, values);
    revalidatePath(`/clients/${clientId}`);
    return { ok: "Saved." };
  });
}

/** A login for someone at the company: usually their first company admin. */
export async function createCompanyLogin(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageCompanyAccounts);
    if (!isOwner(user)) return { error: "Only the owner manages company accounts, since they cover every hotel." };
    const role = String(fd.get("role")) as StaffRole;
    if (!COMPANY_ROLES.includes(role)) return { error: "Pick a role." };
    const db = await getDb();
    if (!(await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) }))) return { error: "Company not found." };
    const result = await createLogin(fd, { role, clientId });
    if ("error" in result) return result;
    await audit(user.id, "create", "company_login", result.login.id, { clientId, username: result.login.username, role });
    revalidatePath(`/clients/${clientId}`);
    return { ok: `${result.login.name} can now sign in as ${result.login.username}.` };
  });
}

export async function updateCompanyLogin(staffId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageCompanyAccounts);
    if (!isOwner(user)) return { error: "Only the owner manages company accounts, since they cover every hotel." };
    const role = String(fd.get("role")) as StaffRole;
    if (!COMPANY_ROLES.includes(role)) return { error: "Pick a role." };
    const db = await getDb();
    const target = await db.query.staff.findFirst({ where: eq(schema.staff.id, staffId) });
    if (!target?.clientId || !COMPANY_ROLES.includes(target.role)) return { error: "Login not found." };
    const result = await updateLogin(staffId, fd, { role });
    if ("error" in result) return result;
    await audit(user.id, "update", "company_login", staffId, { ...result, role });
    revalidatePath(`/clients/${target.clientId}`);
    return { ok: "Saved." };
  });
}
